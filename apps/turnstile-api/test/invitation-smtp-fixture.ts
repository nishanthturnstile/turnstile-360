import { createServer, type Socket } from 'node:net';
export async function invitationSmtpFixture() {
  const messages: string[] = [];
  const sockets = new Set<Socket>();
  let mode: 'accept' | 'reject' | 'drop' | 'pause' = 'accept';
  let entered: () => void = () => {};
  let release: () => void = () => {};
  const server = createServer((socket) => {
    sockets.add(socket);
    socket.on('error', () => {});
    socket.on('close', () => sockets.delete(socket));
    socket.write('220 invitation fixture\r\n');
    let buffer = '';
    let data = false;
    let message = '';
    socket.on('data', (chunk) => {
      buffer += chunk.toString();
      let end = buffer.indexOf('\r\n');
      while (end >= 0) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (data) {
          if (line === '.') {
            const current = mode;
            const finish = () => {
              if (current === 'drop') {
                messages.push(message);
                socket.destroy();
              } else if (current === 'reject') socket.write('550 rejected\r\n');
              else {
                messages.push(message);
                socket.write('250 accepted\r\n');
              }
              message = '';
            };
            if (current === 'pause') {
              release = finish;
              entered();
            } else finish();
            data = false;
          } else message += `${line}\r\n`;
        } else if (/^EHLO|^HELO/.test(line)) socket.write('250-fixture\r\n250 8BITMIME\r\n');
        else if (line === 'DATA') {
          data = true;
          socket.write('354 send\r\n');
        } else if (line === 'QUIT') socket.end('221 bye\r\n');
        else socket.write('250 ok\r\n');
        end = buffer.indexOf('\r\n');
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('SMTP fixture');
  return {
    port: address.port,
    messages,
    setMode(value: typeof mode) {
      mode = value;
    },
    pause() {
      mode = 'pause';
      return new Promise<void>((resolve) => {
        entered = resolve;
      });
    },
    release() {
      release();
      mode = 'accept';
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
