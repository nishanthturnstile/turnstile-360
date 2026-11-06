import { readFileSync } from 'node:fs';
import http from 'node:http';
import https from 'node:https';

// Fixture ingress: real certificate verification remains enabled in every caller.
https
  .createServer(
    { key: readFileSync('/tls/key.pem'), cert: readFileSync('/tls/cert.pem') },
    (req, res) => {
      const host = req.headers.host;
      const target =
        host === 'identity.dms.test'
          ? ['dms-api', 3001]
          : host === 'files.dms.test'
            ? ['dms-transfer', 8333]
            : null;
      if (!target) {
        res.writeHead(404).end();
        return;
      }
      const upstream = http.request(
        {
          hostname: target[0],
          port: target[1],
          method: req.method,
          path: req.url,
          headers: { ...req.headers, 'x-forwarded-proto': 'https' },
        },
        (response) => {
          res.writeHead(response.statusCode, response.headers);
          response.pipe(res);
        },
      );
      upstream.on('error', () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      req.pipe(upstream);
    },
  )
  .listen(443, '0.0.0.0');
