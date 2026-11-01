import { connect, createServer } from 'node:net';
import { fileURLToPath, pathToFileURL } from 'node:url';
import ports from '../deploy/development-ports.json' with { type: 'json' };

// Development-only loopback forwarding preserves canonical localhost issuer/resource
// URLs without changing OAuth validation or injecting credentials into the frontend.
export async function forwardLoopback(port, host, remotePort = port) {
  const server = createServer((socket) => {
    const upstream = connect({ host, port: remotePort });
    socket.on('error', () => upstream.destroy());
    upstream.on('error', () => socket.destroy());
    socket.on('close', () => upstream.destroy());
    upstream.on('close', () => socket.destroy());
    socket.pipe(upstream).pipe(socket);
  });
  await new Promise((done, fail) => {
    server.once('error', fail);
    server.listen(port, '127.0.0.1', done);
  });
  return server;
}

async function main() {
  const service = process.argv[2];
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: this local entry point runs directly in Compose, outside Turbo.
  if (process.env.DEV_CONTAINER !== '1' || !['dms-api', 'turnstile-api'].includes(service))
    throw new Error('This entry point is only for Compose development API services.');
  process.chdir(fileURLToPath(new URL(`../apps/${service}/`, import.meta.url)));
  process.loadEnvFile();
  // biome-ignore lint/suspicious/noUndeclaredEnvVars: private runtime config never belongs in build task inputs.
  if (process.env.AUTH_PROFILE !== 'local' || process.env.NODE_ENV === 'production')
    throw new Error('Container development requires the local authentication profile.');
  process.env.HOST = '0.0.0.0';
  process.env.PORT = service === 'dms-api' ? '3001' : '3002';
  await forwardLoopback(ports.web, 'turnstile-web', 5173);
  await forwardLoopback(ports.postgres, 'postgres', 5432);
  if (service === 'dms-api') await forwardLoopback(ports.smtp, 'mailpit', 1025);
  else await forwardLoopback(ports.dmsApi, 'dms-api', 3001);
  await import(`../apps/${service}/dist/${service === 'dms-api' ? 'main.api' : 'main'}.js`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
