import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { test } from 'node:test';
import { audience, DECISION_TYPE } from '@thaarei/control-plane-contracts';
import {
  createProfile,
  DELIVERY_AUDIENCE,
  DELIVERY_TYPE,
  deliveryReleaseId,
  deliveryRequestDigest,
  profileDigest,
  versionedSyncRequest,
} from '@thaarei/module-catalog';
import { exportSPKI, generateKeyPair, SignJWT } from 'jose';
import {
  applyDecision,
  DeploymentClient,
  evaluateDecision,
  evaluateModuleDecision,
  initialDecisionState,
  verifyInstalledModuleRelease,
  verifyModuleDecision,
} from '../dist/index.js';

const now = 1800000000,
  epoch = randomUUID();
const keys = await generateKeyPair('RS256');
const trust = {
  version: 1,
  revision: 1,
  issuer: 'https://central.example',
  keys: [
    { kid: 'test', pem: await exportSPKI(keys.publicKey), status: 'active', lastIssuedAt: null },
  ],
};
const binding = {
  clientId: randomUUID(),
  installationId: randomUUID(),
  productId: randomUUID(),
  localInstallationId: randomUUID(),
  tenantId: randomUUID(),
  product: 'turnstile',
  applicationId: randomUUID(),
};
const catalogue = {
  version: 1,
  id: randomUUID(),
  sourceDigest: 'a'.repeat(64),
  platform: 'linux/amd64',
  contractVersion: 2,
  migrationVersion: 1,
  modules: ['foundation', 'incident-management', 'risk-management'].map((id) => ({
    id,
    label: id,
    version: '1.0.0',
    category: id === 'foundation' ? 'core' : 'individual',
    requires: id === 'foundation' ? [] : ['foundation'],
    optionalIntegrations: [],
  })),
};
const profile = await createProfile(
  catalogue,
  { requestedIndividualIds: ['incident-management', 'risk-management'] },
  catalogue.modules.map((m) => m.id),
);
const request = { version: 1, catalogue, profile, profileDigest: await profileDigest(profile) };
const evidence = {
  version: 1,
  kind: 'delivery',
  requestDigest: await deliveryRequestDigest(request),
  inventory: {
    version: 1,
    catalogueDigest: profile.catalogueDigest,
    profileDigest: request.profileDigest,
    sourceDigest: profile.sourceDigest,
    releaseId: '0'.repeat(64),
    platform: profile.platform,
    images: [
      { role: 'turnstile-api', digest: 'a'.repeat(64) },
      { role: 'turnstile-web', digest: 'b'.repeat(64) },
    ],
    archiveDigest: 'c'.repeat(64),
    noticesDigest: 'd'.repeat(64),
    sourceInventoryDigest: 'e'.repeat(64),
  },
  artifactInventoryDigest: 'f'.repeat(64),
  documentationDigest: 'a'.repeat(64),
};
evidence.inventory.releaseId = await deliveryReleaseId(evidence);
const releaseToken = await new SignJWT({
  ...evidence,
  iss: trust.issuer,
  aud: DELIVERY_AUDIENCE,
  iat: now,
  nbf: now,
  exp: now + 100,
})
  .setProtectedHeader({ alg: 'RS256', typ: DELIVERY_TYPE, kid: 'test' })
  .sign(keys.privateKey);
const release = await verifyInstalledModuleRelease(releaseToken, request, profile, trust, now);
const modulePolicy = {
  active: {
    catalogueDigest: profile.catalogueDigest,
    profileDigest: request.profileDigest,
    releaseId: release.releaseId,
    assignmentRevision: 2,
    policyRevision: 3,
  },
  changeAssignmentRevision: 2,
  desired: {
    catalogueDigest: profile.catalogueDigest,
    profileDigest: request.profileDigest,
    assignmentRevision: 2,
  },
  allowedModuleIds: ['foundation', 'incident-management', 'risk-management'],
};
const claims = (changes = {}) => ({
  version: 2,
  iss: trust.issuer,
  aud: audience(binding),
  binding,
  epoch,
  policyRevision: 3,
  decisionSequence: 1,
  decisionId: randomUUID(),
  iat: now,
  nbf: now,
  exp: now + 100,
  state: 'approved',
  entitlement: 'product-business',
  modulePolicy,
  ...changes,
});
const sign = (raw) =>
  new SignJWT(raw)
    .setProtectedHeader({ alg: 'RS256', typ: DECISION_TYPE, kid: 'test' })
    .sign(keys.privateKey);
const apply = (state, token, clock = now, installed = release) =>
  applyDecision(state, token, binding, trust, clock, installed);
const verify = (token) => verifyModuleDecision(token, binding, epoch, trust, now, release);

test('verified installed release pins signed build and profile; historical proof is not a business grant', async () => {
  assert.equal(
    (await verifyInstalledModuleRelease(releaseToken, request, profile, trust, now + 1000))
      .releaseId,
    release.releaseId,
  );
  await assert.rejects(
    verifyInstalledModuleRelease(
      releaseToken,
      request,
      { ...profile, modules: profile.modules.slice(0, 1) },
      trust,
      now,
    ),
  );
  await assert.rejects(
    verifyInstalledModuleRelease(
      releaseToken,
      request,
      profile,
      { ...trust, keys: trust.keys.map((k) => ({ ...k, status: 'revoked' })) },
      now,
    ),
  );
  assert.throws(() => {
    release.request.catalogue.modules[0].category = 'individual';
  });
  await assert.rejects(
    verifyModuleDecision(await sign(claims()), binding, epoch, trust, now, {
      ...release,
      releaseId: 'a'.repeat(64),
    }),
  );
});

test('v2 signature verifier rejects malformed, downgrade, binding and installed context substitutions', async () => {
  assert.equal((await verify(await sign(claims()))).version, 2);
  for (const changed of [
    { version: 3 },
    { version: 1, modulePolicy: undefined },
    { epoch: randomUUID() },
    { binding: { ...binding, applicationId: randomUUID() } },
    { aud: 'wrong' },
    {
      modulePolicy: {
        ...modulePolicy,
        active: { ...modulePolicy.active, releaseId: 'a'.repeat(64) },
      },
    },
    { modulePolicy: { ...modulePolicy, allowedModuleIds: ['foundation', 'unknown-module'] } },
    { modulePolicy: { ...modulePolicy, allowedModuleIds: ['incident-management'] } },
    { modulePolicy: { ...modulePolicy, active: { ...modulePolicy.active, policyRevision: 2 } } },
    { exp: now },
    { nbf: now - 1 },
    { extra: true },
  ])
    await assert.rejects(verify(await sign(claims(changed))));
  const state = await apply(initialDecisionState(epoch), await sign(claims()));
  await assert.rejects(
    applyDecision(
      state,
      await sign(claims({ version: 1, modulePolicy: undefined })),
      binding,
      trust,
      now,
    ),
  );
  assert.equal((await evaluateDecision(state, binding, trust, now)).access, 'closed');
});

test('equal revision renewals cannot change any module policy context; newer removal fences stale replay', async () => {
  const original = await sign(claims());
  let state = await apply(initialDecisionState(epoch), original);
  for (const changed of [
    { allowedModuleIds: ['foundation'] },
    { changeAssignmentRevision: 3 },
    { desired: { ...modulePolicy.desired, assignmentRevision: 3 } },
    { active: { ...modulePolicy.active, assignmentRevision: 3 } },
  ])
    await assert.rejects(
      apply(
        state,
        await sign(claims({ decisionSequence: 2, modulePolicy: { ...modulePolicy, ...changed } })),
      ),
      /equal revision/,
    );
  state = await apply(
    state,
    await sign(
      claims({
        decisionSequence: 2,
        modulePolicy: {
          ...modulePolicy,
          allowedModuleIds: [...modulePolicy.allowedModuleIds].reverse(),
        },
      }),
    ),
  );
  const removed = await sign(
    claims({
      policyRevision: 4,
      decisionSequence: 3,
      modulePolicy: {
        ...modulePolicy,
        active: { ...modulePolicy.active, policyRevision: 4 },
        allowedModuleIds: ['foundation'],
      },
    }),
  );
  state = await apply(state, removed);
  assert.deepEqual(
    (await evaluateModuleDecision(state, binding, trust, now, release)).allowedModuleIds,
    ['foundation'],
  );
  await assert.rejects(apply(state, original), /Stale/);
  assert.deepEqual(
    (
      await evaluateModuleDecision(
        JSON.parse(JSON.stringify(state)),
        binding,
        trust,
        now + 101,
        release,
      )
    ).allowedModuleIds,
    [],
  );
});

test('module expiry and durable denial never inherit foundation read exceptions; rollback and epoch close', async () => {
  const approved = await apply(initialDecisionState(epoch), await sign(claims()));
  assert.equal(
    (await evaluateDecision(approved, binding, trust, now + 101, release)).access,
    'existing-reads',
  );
  assert.deepEqual(
    (await evaluateModuleDecision(approved, binding, trust, now + 101, release)).allowedModuleIds,
    [],
  );
  for (const status of ['pending', 'rejected', 'suspended']) {
    const denied = claims({ state: status, policyRevision: 4, decisionSequence: 2 });
    delete denied.modulePolicy;
    delete denied.entitlement;
    const state = await apply(approved, await sign(denied));
    assert.equal(
      (await evaluateDecision(state, binding, trust, now + 101, release)).access,
      status === 'suspended' ? 'existing-reads' : 'closed',
    );
    assert.deepEqual(
      (await evaluateModuleDecision(state, binding, trust, now + 101, release)).allowedModuleIds,
      [],
    );
  }
  for (const changes of [
    { quarantined: true },
    { epoch: randomUUID() },
    { lastTime: now + 1 },
    { trustRevision: 2 },
    { releaseTrustRevision: 2 },
  ])
    assert.equal(
      (await evaluateModuleDecision({ ...approved, ...changes }, binding, trust, now, release))
        .state,
      'reconciliation-required',
    );
});

test('client persists exact v2 request across lost response and rejects unsigned v1 response downgrade', async () => {
  const operationId = randomUUID();
  let durable = {
    version: 1,
    origin: trust.issuer,
    binding,
    recoveryMarker: 'm'.repeat(43),
    trustRevision: 0,
    current: { secret: 's'.repeat(43), generation: 1, epoch, operationId },
    operation: null,
    decision: null,
    report: null,
  };
  const store = {
    locked: (fn) => fn(),
    load: async () => structuredClone(durable),
    save: async (value) => {
      durable = structuredClone(value);
    },
    recoveryMarker: async () => 'm'.repeat(43),
    moduleRelease: async () => release,
  };
  const inputs = [];
  let lost = true,
    downgrade = false;
  const token = await sign(claims());
  const transport = async (_path, input) => {
    inputs.push(structuredClone(input));
    versionedSyncRequest.parse(input);
    if (lost) {
      lost = false;
      throw new Error('lost acknowledgement');
    }
    return {
      version: downgrade ? 1 : 2,
      receiptId: input.reportId,
      binding,
      epoch,
      generation: 1,
      operationId,
      decision: token,
    };
  };
  const client = new DeploymentClient(
    store,
    transport,
    async () => trust,
    () => now,
  );
  await assert.rejects(client.sync(), /lost/);
  assert.equal(durable.report.version, 2);
  downgrade = true;
  await assert.rejects(client.sync(), /version mismatch/);
  assert.equal(durable.decision, null);
  downgrade = false;
  await client.sync();
  assert.deepEqual(inputs[0], inputs[2]);
  assert.equal(durable.report, null);
  assert.equal(durable.decision.minimumVersion, 2);
  assert.equal((await client.access()).access, 'full');
  store.moduleRelease = async () => null;
  await assert.rejects(client.sync(), /downgrade/);
  assert.equal((await client.access()).access, 'closed');
});
