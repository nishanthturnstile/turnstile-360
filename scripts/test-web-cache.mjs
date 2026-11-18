import assert from 'node:assert/strict';
import http from 'node:http';
import https from 'node:https';

// Read-only verification against the deployed ingress, including real Nginx headers.
const origin = new URL(process.argv[2] ?? 'https://turnstile.localhost:23600');
const local =
  origin.hostname.endsWith('.localhost') ||
  ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
async function get(path, headers = {}) {
  return new Promise((resolve, reject) => {
    const request = (origin.protocol === 'https:' ? https : http).get(
      new URL(path, origin),
      {
        headers,
        rejectUnauthorized: !local,
        timeout: 10000,
      },
      (response) => {
        let body = '';
        response.setEncoding('utf8');
        response.on('data', (chunk) => {
          body += chunk;
        });
        response.on('end', () =>
          resolve({ status: response.statusCode, headers: response.headers, body }),
        );
        response.on('error', reject);
      },
    );
    request.on('timeout', () => request.destroy(new Error('Ingress probe timed out')));
    request.on('error', reject);
  });
}
function secure(response) {
  for (const [name, expected] of [
    ['referrer-policy', 'no-referrer'],
    ['x-content-type-options', 'nosniff'],
  ]) {
    const values = response.headers[name]?.split(',').map((value) => value.trim());
    assert.ok(
      values?.length && values.every((value) => value === expected),
      `${name}: every ingress/backend value must preserve the security policy`,
    );
  }
  assert.match(response.headers['content-security-policy'] ?? '', /frame-ancestors 'none'/);
}
for (const path of [
  '/',
  '/index.html',
  '/people/members',
  '/people/invitations',
  '/people/roles',
  '/settings',
]) {
  const page = await get(path);
  assert.equal(page.status, 200, path);
  assert.equal(
    page.headers['cache-control'],
    'no-store',
    `${path}: stale SPA shells must not be cached`,
  );
  secure(page);
}
const page = await get('/people/members');
const assetPath = page.body.match(/src="([^"]+\.js)"/)?.[1];
assert.ok(assetPath, 'Compiled entry asset required');
const asset = await get(assetPath);
assert.equal(asset.status, 200);
assert.equal(asset.headers['cache-control'], 'public, max-age=31536000, immutable');
secure(asset);
const conditional = await get(assetPath, { 'if-none-match': asset.headers.etag });
assert.equal(conditional.status, 304);
assert.equal(conditional.headers['cache-control'], 'public, max-age=31536000, immutable');
const missing = await get('/assets/not-a-released-asset.js');
assert.equal(missing.status, 404, 'Missing old chunks must not receive the SPA document');
assert.equal(
  missing.headers['cache-control'],
  'no-store',
  'Missing chunks must not be cached as immutable assets',
);
secure(missing);
console.log(
  'Deployed ingress: uncached SPA documents, immutable hashed assets/304, uncached missing-chunk 404 and security headers verified.',
);
