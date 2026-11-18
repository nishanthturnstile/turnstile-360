import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createServer, request } from 'node:http';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

// The pinned customer gateway reaches the real local product through a private Unix
// socket in the disposable fixture directory. Production routes and limits are unchanged.
export async function documentsDraftIngress(directory, productPort) {
  const suffix = randomUUID();
  const image = 'thaarei-documents-gateway:batch-fixture';
  const network = `documents-batch-${suffix}`;
  const bridge = `${network}-bridge`;
  const gateway = `${network}-gateway`;
  const socket = join(directory, 'product.sock');
  const relay = createServer((incoming, outgoing) => {
    if (incoming.url !== '/api/documents/operations') return outgoing.writeHead(404).end();
    const upstream = request(
      {
        host: '127.0.0.1',
        port: productPort(),
        path: incoming.url,
        method: incoming.method,
        headers: incoming.headers,
      },
      (reply) => {
        outgoing.writeHead(reply.statusCode, reply.headers);
        reply.pipe(outgoing);
      },
    );
    upstream.on('error', () => outgoing.writeHead(503).end());
    incoming.pipe(upstream);
  });
  function docker(...args) {
    const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 120000 });
    assert.equal(result.status, 0, `Documents gateway fixture failed on Docker ${args[0]}`);
    return result.stdout.trim();
  }
  async function close() {
    for (const name of [gateway, bridge])
      spawnSync('docker', ['rm', '-f', name], { stdio: 'ignore' });
    spawnSync('docker', ['network', 'rm', network], { stdio: 'ignore' });
    if (relay.listening) {
      relay.closeAllConnections();
      await new Promise((resolve) => relay.close(resolve));
    }
  }
  try {
    relay.listen(socket);
    await once(relay, 'listening');
    docker('build', '--quiet', '-f', 'deploy/customer/Dockerfile', '-t', image, '.');
    docker('network', 'create', network);
    docker(
      'run',
      '-d',
      '--name',
      bridge,
      '--network',
      network,
      '--network-alias',
      'backend',
      '--read-only',
      '--cap-drop',
      'ALL',
      '--user',
      `${process.getuid()}:${process.getgid()}`,
      '--mount',
      `type=bind,src=${socket},dst=/product.sock,readonly`,
      'node:24.21.0-bookworm-slim',
      'node',
      '-e',
      `const {createServer,request}=require('node:http');
      createServer((req,res)=>{
        const out=request({socketPath:'/product.sock',path:req.url,method:req.method,headers:req.headers},
          upstream=>{res.writeHead(upstream.statusCode,upstream.headers);upstream.pipe(res)});
        out.on('error',()=>res.writeHead(503).end());req.pipe(out);
      }).listen(3002,'0.0.0.0');`,
    );
    docker(
      'run',
      '-d',
      '--name',
      gateway,
      '--network',
      network,
      '-p',
      '127.0.0.1::8080',
      '--read-only',
      '--cap-drop',
      'ALL',
      '--tmpfs',
      '/tmp',
      '-e',
      'TURNSTILE_API_UPSTREAM=backend',
      '-e',
      'TURNSTILE_WEB_UPSTREAM=backend',
      '-e',
      'DMS_API_UPSTREAM=backend',
      image,
    );
    const port = Number(
      docker(
        'inspect',
        '--format',
        '{{(index (index .NetworkSettings.Ports "8080/tcp") 0).HostPort}}',
        gateway,
      ),
    );
    assert.ok(port);
    for (let attempt = 0; attempt < 40; attempt++) {
      const ready = await fetch(`http://127.0.0.1:${port}/health/gateway`).catch(() => null);
      if (ready?.ok) return { port, close };
      await delay(250);
    }
    throw new Error('Documents gateway fixture readiness deadline');
  } catch (error) {
    await close();
    throw error;
  }
}
