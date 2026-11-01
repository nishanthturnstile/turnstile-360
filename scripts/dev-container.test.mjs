import assert from 'node:assert/strict';
import { createServer, request } from 'node:http';
import test from 'node:test';
import { forwardLoopback } from './dev-container.mjs';

test('container loopback forwarding preserves the canonical host and private request headers', async (t) => {
  const upstream = createServer((request, response) => {
    response.setHeader('content-type', 'application/json');
    response.end(
      JSON.stringify({
        host: request.headers.host,
        path: request.url,
        auth: request.headers.authorization,
      }),
    );
  });
  await new Promise((done) => upstream.listen(0, '127.0.0.1', done));
  const bridge = await forwardLoopback(0, '127.0.0.1', upstream.address().port);
  t.after(async () => {
    upstream.closeAllConnections();
    await Promise.all([
      new Promise((done) => upstream.close(done)),
      new Promise((done) => bridge.close(done)),
    ]);
  });
  const value = await new Promise((done, fail) => {
    const outgoing = request(
      {
        hostname: '127.0.0.1',
        port: bridge.address().port,
        path: '/identity/.well-known/openid-configuration',
        headers: { host: 'localhost:23600', authorization: 'Bearer fixture-only' },
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () => done(JSON.parse(body)));
      },
    );
    outgoing.on('error', fail);
    outgoing.end();
  });
  assert.deepEqual(value, {
    host: 'localhost:23600',
    path: '/identity/.well-known/openid-configuration',
    auth: 'Bearer fixture-only',
  });
  assert.equal(bridge.address().address, '127.0.0.1');
});

test('an unavailable upstream closes only that connection and accepts subsequent requests', async (t) => {
  const upstream = createServer((_request, response) => response.end('recovered'));
  await new Promise((done) => upstream.listen(0, '127.0.0.1', done));
  const port = upstream.address().port;
  await new Promise((done) => upstream.close(done));
  const bridge = await forwardLoopback(0, '127.0.0.1', port);
  t.after(async () => {
    upstream.closeAllConnections();
    await Promise.all([
      new Promise((done) => upstream.close(done)),
      new Promise((done) => bridge.close(done)),
    ]);
  });
  const url = `http://127.0.0.1:${bridge.address().port}/`;
  await assert.rejects(fetch(url, { signal: AbortSignal.timeout(2000) }));
  await new Promise((done) => upstream.listen(port, '127.0.0.1', done));
  const response = await fetch(url, { signal: AbortSignal.timeout(2000) });
  assert.equal(await response.text(), 'recovered');
});
