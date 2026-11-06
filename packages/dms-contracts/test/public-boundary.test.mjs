import assert from 'node:assert/strict';
import test from 'node:test';
import * as privateContract from '../dist/private.js';
import * as publicContract from '../dist/public.js';

test('consumer exports exclude identity-service and internal principal contracts', () => {
  assert.ok(Object.keys(publicContract).every((key) => !/identity|principal/i.test(key)));
  assert.ok(privateContract.IDENTITY_SERVICE_ROUTES);
  assert.ok(privateContract.DMS_PRINCIPAL_KINDS);
  assert.deepEqual(publicContract.DMS_MACHINE_SCOPES, [
    'dms:capabilities:read',
    'dms:audit:read',
    'dms:documents:read',
    'dms:documents:write',
  ]);
});

test('discovery rejects PostgreSQL-invalid text and preserves Unicode and optional defaults', () => {
  const schema = publicContract.discoveryRequestSchema;
  assert.equal(schema.parse({ q: 'finance 😀' }).limit, 20);
  for (const q of ['abc\0def', 'abc\ud800def'])
    assert.equal(schema.safeParse({ q }).success, false);
  assert.equal(
    schema.safeParse({ metadataField: 'category', metadataValue: 'invoice\0' }).success,
    false,
  );
  assert.equal(
    publicContract.dmsPublicJsonSchemas.DiscoveryRequest.required?.includes('limit') ?? false,
    false,
  );
});
