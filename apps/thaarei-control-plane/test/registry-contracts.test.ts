import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { registryCommand } from '../src/contracts/registry.ts';

test('registry rejects asserted pairing, policy and inconsistent product bindings', () => {
  const base = {
    type: 'product.create',
    requestId: randomUUID(),
    clientId: randomUUID(),
    installationId: randomUUID(),
    reason: 'Register expected binding',
    binding: { product: 'dms', applicationId: null },
  };
  assert.equal(registryCommand.safeParse(base).success, true);
  for (const input of [
    { ...base, pairingVerifiedAt: new Date().toISOString() },
    { ...base, policyState: 'approved' },
    { ...base, binding: { product: 'dms', applicationId: randomUUID() } },
    { ...base, binding: { product: 'turnstile', applicationId: null } },
  ])
    assert.equal(registryCommand.safeParse(input).success, false);
});
test('retry identity uses normalized inputs and client updates explicitly preserve or clear contacts', () => {
  const requestId = randomUUID();
  const left = registryCommand.parse({
    type: 'client.create',
    requestId,
    code: 'mrr-01',
    name: ' Example ',
    reason: ' Register ',
  });
  const right = registryCommand.parse({
    reason: 'Register',
    name: 'Example',
    code: 'MRR-01',
    requestId,
    type: 'client.create',
    contactEmail: null,
    contactName: null,
  });
  assert.equal(JSON.stringify(left), JSON.stringify(right));
  const update = {
    type: 'client.update',
    requestId: randomUUID(),
    id: randomUUID(),
    revision: 1,
    name: 'Example',
    archived: true,
    reason: 'Archive',
  };
  assert.equal(registryCommand.safeParse(update).success, false);
  assert.equal(
    registryCommand.safeParse({ ...update, contactName: null, contactEmail: null }).success,
    true,
  );
  assert.equal(
    registryCommand.safeParse({ ...update, contactName: null, contactEmail: null, code: 'CHANGED' })
      .success,
    false,
  );
});
