// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: Disposable uncached image qualification helper.
// Private canonical customer transport for the packaged backends; public browser ingress is separate.
import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';

https
  .createServer(
    { key: readFileSync('/qualification/key.pem'), cert: readFileSync('/qualification/cert.pem') },
    (request, response) => {
      const path = (request.url ?? '/').split('?')[0];
      const fault = readFileSync('/qualification/browser-fault', 'utf8');
      const identity =
        path.startsWith('/identity/') ||
        path.startsWith('/internal/identity/') ||
        path.startsWith('/.well-known/');
      if (
        (fault === 'authority' && identity) ||
        (fault === 'logout' && /\/(revoke|end-session|sign-out)$/.test(path)) ||
        (fault === 'dms' && path.startsWith('/v1/'))
      ) {
        response.writeHead(503).end();
        return;
      }
      const authority = identity || path.startsWith('/v1');
      const upstream = http.request(
        {
          hostname: authority
            ? process.env.QUALIFICATION_AUTHORITY
            : process.env.QUALIFICATION_PRODUCT,
          port: authority ? 3001 : 3002,
          path: request.url,
          method: request.method,
          headers: { ...request.headers, connection: 'close' },
        },
        (incoming) => {
          incoming.on('error', () => response.destroy());
          response.writeHead(incoming.statusCode, incoming.headers);
          incoming.pipe(response);
        },
      );
      upstream.on('error', () => response.writeHead(503).end());
      request.pipe(upstream);
    },
  )
  .listen(Number(process.env.QUALIFICATION_PORT), '0.0.0.0');
