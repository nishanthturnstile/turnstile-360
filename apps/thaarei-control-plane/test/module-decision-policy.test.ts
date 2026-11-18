import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { binding } from '@thaarei/control-plane-contracts';
import { createProfile, profileDigest } from '@thaarei/module-catalog';
import { moduleDecisionPolicy } from '../src/server/module-decision-policy.ts';

const catalogue = {
  version: 1,
  id: randomUUID(),
  sourceDigest: 'a'.repeat(64),
  platform: 'linux/amd64',
  contractVersion: 2,
  migrationVersion: 1,
  modules: [
    {
      id: 'foundation',
      label: 'Foundation',
      version: '1.0.0',
      category: 'core',
      requires: [],
      optionalIntegrations: [],
    },
    {
      id: 'incident-management',
      label: 'Incident',
      version: '1.0.0',
      category: 'individual',
      requires: ['foundation'],
      optionalIntegrations: [],
    },
  ],
};
const profile = await createProfile(
  catalogue,
  { requestedIndividualIds: ['incident-management'] },
  ['foundation', 'incident-management'],
);
const request = { version: 1, catalogue, profile, profileDigest: await profileDigest(profile) };
const installed = {
  catalogueDigest: profile.catalogueDigest,
  profileDigest: request.profileDigest,
  releaseId: 'b'.repeat(64),
};
const policy = {
  active: { ...installed, assignmentRevision: 3, policyRevision: 4 },
  desired: {
    catalogueDigest: installed.catalogueDigest,
    profileDigest: installed.profileDigest,
    assignmentRevision: 3,
  },
  changeAssignmentRevision: 3,
  allowedModuleIds: ['foundation', 'incident-management'],
};
const base = {
  binding: binding.parse({
    product: 'turnstile',
    applicationId: randomUUID(),
    clientId: randomUUID(),
    productId: randomUUID(),
    installationId: randomUUID(),
    localInstallationId: randomUUID(),
    tenantId: randomUUID(),
  }),
  epoch: randomUUID(),
  policyRevision: 5,
};
const authority = { version: 1, epoch: base.epoch, request, policy };

test('issuer keeps missing activation and replacement epochs pending; product restrictions win', async () => {
  assert.deepEqual(await moduleDecisionPolicy(base, 'approved', null, installed), {
    state: 'pending',
  });
  assert.deepEqual(
    await moduleDecisionPolicy({ ...base, epoch: randomUUID() }, 'approved', authority, installed),
    { state: 'pending' },
  );
  for (const state of ['pending', 'suspended', 'rejected'] as const)
    assert.deepEqual(await moduleDecisionPolicy(base, state, authority, installed), { state });
});
test('issuer signs only exact persisted active context and valid allowed closure', async () => {
  const result = await moduleDecisionPolicy(base, 'approved', authority, installed);
  assert.equal(result.state, 'approved');
  assert.equal(result.modulePolicy?.active.policyRevision, base.policyRevision);
  for (const change of [
    { releaseId: 'c'.repeat(64) },
    { profileDigest: 'c'.repeat(64) },
    { catalogueDigest: 'c'.repeat(64) },
  ])
    await assert.rejects(
      moduleDecisionPolicy(base, 'approved', authority, { ...installed, ...change }),
    );
  for (const allowedModuleIds of [['incident-management'], ['foundation', 'unknown-module']])
    await assert.rejects(
      moduleDecisionPolicy(
        base,
        'approved',
        { ...authority, policy: { ...policy, allowedModuleIds } },
        installed,
      ),
    );
  await assert.rejects(
    moduleDecisionPolicy(base, 'approved', { ...authority, version: 2 }, installed),
  );
});
