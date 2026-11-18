// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: Disposable uncached image qualification helper.
// Disposable TLS ingress. The candidate central runtime handles every application request.
// Faults discard actual committed responses or disconnect the upstream, never replace handlers.
import { readFileSync, writeFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';

const directory = '/qualification';
https
  .createServer(
    {
      key: readFileSync(`${directory}/key.pem`),
      cert: readFileSync(`${directory}/cert.pem`),
    },
    (request, response) => {
      const faults = JSON.parse(readFileSync(`${directory}/faults.json`, 'utf8'));
      const upstream = http.request(
        {
          hostname: process.env.QUALIFICATION_UPSTREAM,
          port: faults.unavailable ? 1 : 3000,
          path: request.url,
          method: request.method,
          headers: {
            ...request.headers,
            'x-forwarded-proto': 'https',
            'x-forwarded-for': request.socket.remoteAddress,
          },
        },
        (incoming) => {
          incoming.on('error', () => response.destroy());
          const fault =
            request.url === '/api/machine/v1/rotate'
              ? 'rotation'
              : request.url === '/api/machine/v1/sync'
                ? 'report'
                : null;
          if (fault && faults[fault] && incoming.statusCode === 200) {
            faults[fault] = false;
            writeFileSync(`${directory}/faults.json`, JSON.stringify(faults), { mode: 0o600 });
            incoming.resume();
            response.destroy();
            return;
          }
          response.writeHead(incoming.statusCode, incoming.headers);
          incoming.pipe(response);
        },
      );
      upstream.on('error', () => response.writeHead(503).end());
      request.pipe(upstream);
    },
  )
  .listen(Number(process.env.QUALIFICATION_PORT), '0.0.0.0');
