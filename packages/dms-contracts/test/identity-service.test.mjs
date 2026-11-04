import assert from 'node:assert/strict';
import test from 'node:test';
import { identityExamples } from '../../../scripts/fixtures/user-management.mjs';
import {
  DMS_MACHINE_SCOPES,
  IDENTITY_SERVICE_AUDIENCE_PATH,
  IDENTITY_SERVICE_SCOPES,
  identityPreparationRequestSchema,
  identityProjectionRequestSchema,
  identityServiceSchemas,
  identitySetupCompleteSchema,
} from '../dist/index.js';

test('authority contracts keep the new service purpose separate from DMS trust', () => {
  assert.deepEqual(DMS_MACHINE_SCOPES, ['dms:capabilities:read']);
  assert.deepEqual(IDENTITY_SERVICE_SCOPES, [
    'identity:invitation:prepare',
    'identity:subjects:read',
  ]);
  assert.equal(IDENTITY_SERVICE_AUDIENCE_PATH, '/identity/services/accounts');
  for (const [name, example] of Object.entries(identityExamples))
    identityServiceSchemas[name].parse(example);
});
test('preparation cannot carry account-administration fields or passwords', () => {
  const input = identityExamples.IdentityPreparationRequest;
  for (const injected of [
    { password: 'never through product' },
    { role: 'admin' },
    { emailVerified: true },
    { banned: false },
    { userId: 'replace-subject' },
  ])
    assert.equal(
      identityPreparationRequestSchema.safeParse({ ...input, ...injected }).success,
      false,
    );
  assert.equal(identityPreparationRequestSchema.parse(input).email, 'samira@example.test');
  assert.equal(
    identityPreparationRequestSchema.safeParse({ ...input, email: ' samira@example.test ' })
      .success,
    false,
  );
});
test('display projection requires bounded product membership assertions rather than directory search', () => {
  const input = identityExamples.IdentityProjectionRequest;
  assert.equal(
    identityProjectionRequestSchema.safeParse({ ...input, email: 'someone@example.test' }).success,
    false,
  );
  assert.equal(
    identityProjectionRequestSchema.safeParse({
      ...input,
      subjects: [input.subjects[0], input.subjects[0]],
    }).success,
    false,
  );
  assert.equal(
    identityProjectionRequestSchema.safeParse({ ...input, subjects: [{ userId: 'unlinked' }] })
      .success,
    false,
  );
});
test('only purpose-bound authority setup receives name/password, with pinned bounds and no privilege fields', () => {
  const input = identityExamples.IdentitySetupComplete;
  assert.equal(
    identitySetupCompleteSchema.parse({ ...input, name: '  Cafe\u0301 lead  ' }).name,
    'Café lead',
  );
  assert.equal(
    identitySetupCompleteSchema.safeParse({ ...input, password: 'short' }).success,
    false,
  );
  assert.equal(identitySetupCompleteSchema.safeParse({ ...input, role: 'admin' }).success, false);
  assert.equal(
    identitySetupCompleteSchema.safeParse({ ...input, email: 'different@example.test' }).success,
    false,
  );
});
