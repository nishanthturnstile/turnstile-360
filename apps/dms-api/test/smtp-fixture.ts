import { createServer, type Socket } from 'node:net';

export async function smtpFixture() {
  const messages: string[] = [];
  let rejectedDeliveries = 0;
  const sockets = new Set<Socket>();
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.write('220 fixture ESMTP\r\n');
    let buffer = '';
    let data = false;
    let message = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      let boundary = buffer.indexOf('\r\n');
      while (boundary !== -1) {
        const line = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        if (data) {
          if (line === '.') {
            if (rejectedDeliveries) {
              rejectedDeliveries--;
              socket.write('550 fixture delivery rejected\r\n');
            } else {
              messages.push(message);
              socket.write('250 queued\r\n');
            }
            message = '';
            data = false;
          } else message += `${line.replace(/^\.\./, '.')}\r\n`;
        } else if (/^EHLO|^HELO/.test(line)) socket.write('250-fixture\r\n250 8BITMIME\r\n');
        else if (line === 'DATA') {
          data = true;
          socket.write('354 continue\r\n');
        } else if (line === 'QUIT') {
          socket.end('221 bye\r\n');
        } else socket.write('250 OK\r\n');
        boundary = buffer.indexOf('\r\n');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('SMTP fixture did not listen');
  return {
    port: address.port,
    messages,
    rejectNextDelivery() {
      rejectedDeliveries++;
    },
    link(purpose: 'verify' | 'reset') {
      const raw = messages.findLast((message) =>
        message.includes(purpose === 'verify' ? 'Verify your account' : 'Reset your account'),
      );
      if (!raw) throw new Error('Expected account email was not delivered');
      const decoded = raw
        .replace(/=\r\n/g, '')
        .replace(/=([a-fA-F0-9]{2})/g, (_match, hex: string) =>
          String.fromCharCode(Number.parseInt(hex, 16)),
        );
      const link = decoded.match(/http:\/\/(?:localhost|127\.0\.0\.1):\d+\/identity\/[^\s]+/)?.[0];
      if (!link) throw new Error('Expected account link was not delivered');
      return new URL(link);
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    },
  };
}
