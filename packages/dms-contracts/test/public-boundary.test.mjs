import assert from 'node:assert/strict';
import test from 'node:test';
import * as privateContract from '../dist/private.js';
import * as publicContract from '../dist/public.js';

test('consumer exports exclude identity-service and internal principal contracts', () => {
  assert.ok(Object.keys(publicContract).every((key) => !/identity|principal/i.test(key)));
  assert.ok(privateContract.IDENTITY_SERVICE_ROUTES);
  assert.ok(privateContract.DMS_PRINCIPAL_KINDS);
  assert.deepEqual(publicContract.DMS_MACHINE_SCOPES, ['dms:capabilities:read', 'dms:audit:read']);
});
