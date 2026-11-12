import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { test } from 'node:test';
import { decision as v1 } from '@thaarei/control-plane-contracts';
import {
  assignmentCommand,
  canonicalCatalogue,
  canonicalProfile,
  catalogue,
  catalogueDigest,
  createProfile,
  installationIntent,
  moduleDecision,
  profileDigest,
  removalClosure,
  resolveSelection,
  validateDecisionContext,
} from '../dist/index.js';

// Synthetic catalogue only: neither placeholder is published/implemented by MOD-I01.
const uuid = '00000000-0000-4000-8000-000000000001';
const hash = 'a'.repeat(64);
const definition = (id, category = 'individual', requires = ['foundation']) => ({
  id,
  label: id,
  version: '1.0.0',
  category,
  requires,
  optionalIntegrations: [],
});
const fixture = () => ({
  version: 1,
  id: uuid,
  sourceDigest: hash,
  platform: 'linux/amd64',
  contractVersion: 2,
  migrationVersion: 1,
  modules: [
    definition('foundation', 'core', []),
    definition('incident-management'),
    definition('risk-management'),
  ],
});
const request = (...requestedIndividualIds) => ({ requestedIndividualIds });
const binding = {
  clientId: uuid,
  installationId: uuid,
  productId: uuid,
  localInstallationId: uuid,
  tenantId: uuid,
  product: 'turnstile',
  applicationId: uuid,
};
const desired = { catalogueDigest: hash, profileDigest: hash, assignmentRevision: 1 };
const active = { ...desired, releaseId: hash, policyRevision: 1 };
const approved = () => ({
  version: 2,
  iss: 'https://central.example.test',
  aud: `urn:thaarei:deployment:${uuid}`,
  binding,
  epoch: uuid,
  policyRevision: 1,
  decisionSequence: 1,
  decisionId: uuid,
  iat: 1000,
  nbf: 1000,
  exp: 2000,
  state: 'approved',
  entitlement: 'product-business',
  modulePolicy: { active, desired, changeAssignmentRevision: 1, allowedModuleIds: ['foundation'] },
});

test('version-one canonical wire identity has fixed SHA256 fixtures', async () => {
  const c = fixture();
  assert.equal(
    await catalogueDigest(c),
    '3b51142c2a8820d19a6a6497eaf81092aeafa972df154f391a2c2d20d168bfaa',
  );
  const p = await createProfile(c, request(), ['foundation']);
  assert.equal(
    await profileDigest(p),
    '1b5cad283e613c7240a1694b6de0e9840c14abaf60109ca4b9e963717d401efd',
  );
});

test('all four independent selections resolve without mutating input', async () => {
  const c = fixture(),
    before = structuredClone(c);
  for (const ids of [
    [],
    ['incident-management'],
    ['risk-management'],
    ['risk-management', 'incident-management'],
  ]) {
    const r = resolveSelection(c, request(...ids));
    assert.deepEqual(r.resolvedIds, ['foundation', ...ids].sort());
    assert.deepEqual(r.additionalRequiredIds, []);
    const p = await createProfile(c, request(...ids), r.resolvedIds);
    assert.equal(p.modules.length, ids.length + 1);
  }
  assert.deepEqual(c, before);
});
test('required closure needs exact explicit confirmation and optional integration adds no rights', async () => {
  const c = fixture();
  c.modules[2].requires.push('incident-management');
  const r = resolveSelection(c, request('risk-management'));
  assert.deepEqual(r.additionalRequiredIds, ['incident-management']);
  await assert.rejects(
    createProfile(c, request('risk-management'), ['foundation', 'risk-management']),
    { code: 'DEPENDENCY_REVIEW_REQUIRED' },
  );
  await createProfile(c, request('risk-management'), r.resolvedIds);
  const independent = fixture();
  independent.modules[1].optionalIntegrations.push('risk-management');
  assert.deepEqual(
    resolveSelection(independent, request('incident-management')).optionalIntegrations,
    [],
  );
  assert.deepEqual(
    resolveSelection(independent, request('incident-management', 'risk-management'))
      .optionalIntegrations,
    [{ from: 'incident-management', to: 'risk-management' }],
  );
});
for (const [label, mutate] of [
  [
    'missing fixed foundation',
    (c) => {
      c.modules = [definition('other-core', 'core', [])];
    },
  ],
  [
    'demoted foundation',
    (c) => {
      c.modules[0].category = 'individual';
      c.modules[2].category = 'core';
      c.modules[2].requires = [];
    },
  ],
  ['unknown reference', (c) => c.modules[1].requires.push('unknown-module')],
  [
    'cycle',
    (c) => {
      c.modules[1].requires.push('risk-management');
      c.modules[2].requires.push('incident-management');
    },
  ],
  ['self edge', (c) => c.modules[1].optionalIntegrations.push('incident-management')],
  ['core to individual', (c) => c.modules[0].requires.push('risk-management')],
  ['duplicate module', (c) => c.modules.push(c.modules[0])],
  ['duplicate edge', (c) => c.modules[1].requires.push('foundation')],
  [
    'executable metadata',
    (c) => {
      c.modules[1].entrypoint = '/tmp/code.js';
    },
  ],
  [
    'version range',
    (c) => {
      c.modules[1].version = '^1.0.0';
    },
  ],
])
  test(`rejects ${label}`, () => {
    const c = fixture();
    mutate(c);
    assert.equal(catalogue.safeParse(c).success, false);
  });
test('selection rejects unknown/core/duplicate IDs and unknown input fields', () => {
  for (const r of [
    request('unknown-module'),
    request('foundation'),
    request('risk-management', 'risk-management'),
    { ...request(), script: 'x' },
  ])
    assert.throws(() => resolveSelection(fixture(), r), { code: 'SELECTION_INVALID' });
});
test('promotion is metadata-only, preserves ID and changes immutable catalogue digest', async () => {
  const c = fixture(),
    next = structuredClone(c);
  next.modules[2].category = 'core';
  assert.deepEqual(resolveSelection(next, request()).resolvedIds, [
    'foundation',
    'risk-management',
  ]);
  assert.notEqual(await catalogueDigest(c), await catalogueDigest(next));
  next.modules[2].requires.push('incident-management');
  assert.equal(catalogue.safeParse(next).success, false);
});
test('canonical hashes are independent of object/module/edge order and match Node SHA256', async () => {
  const c = fixture();
  const other = Object.fromEntries(Object.entries(c).reverse());
  other.modules = [...c.modules].reverse();
  assert.equal(canonicalCatalogue(c), canonicalCatalogue(other));
  const p = await createProfile(c, request('risk-management', 'incident-management'), [
    'risk-management',
    'foundation',
    'incident-management',
  ]);
  assert.equal(
    await profileDigest(p),
    createHash('sha256').update(canonicalProfile(p)).digest('hex'),
  );
  assert.equal(
    await profileDigest(p),
    await profileDigest({ ...p, modules: [...p.modules].reverse() }),
  );
  for (const patch of [
    { platform: 'linux/arm64' },
    { sourceDigest: 'b'.repeat(64) },
    { contractVersion: 3 },
    { migrationVersion: 2 },
  ])
    assert.notEqual(await profileDigest(p), await profileDigest({ ...p, ...patch }));
});
test('mixed replacement removes active dependants before considering new target catalogue', () => {
  const activeCatalogue = fixture();
  activeCatalogue.modules[2].requires.push('incident-management');
  const closure = removalClosure(
    activeCatalogue,
    ['foundation', 'incident-management', 'risk-management'],
    ['incident-management'],
  );
  assert.deepEqual(closure, ['incident-management', 'risk-management']);
  const target = fixture();
  assert.deepEqual(resolveSelection(target, request('risk-management')).resolvedIds, [
    'foundation',
    'risk-management',
  ]);
  assert.throws(() => removalClosure(activeCatalogue, ['foundation'], ['foundation']), {
    code: 'MODULE_SET_INVALID',
  });
});
test('v2 is strict, Turnstile-only and cannot be parsed as v1; denial cannot carry rights', () => {
  assert.equal(moduleDecision.safeParse(approved()).success, true);
  assert.equal(v1.safeParse(approved()).success, false);
  for (const d of [
    { ...approved(), version: 1 },
    { ...approved(), binding: { ...binding, product: 'dms', applicationId: null } },
    { ...approved(), exp: 1000 + 7 * 86400 + 1 },
    { ...approved(), policyRevision: 2 },
  ])
    assert.equal(moduleDecision.safeParse(d).success, false);
  const d = approved();
  delete d.modulePolicy;
  delete d.entitlement;
  d.state = 'suspended';
  assert.equal(moduleDecision.safeParse(d).success, true);
  assert.equal(
    moduleDecision.safeParse({ ...d, modulePolicy: approved().modulePolicy }).success,
    false,
  );
});
test('approved context must match actual catalogue, profile, release and dependency-closed allowed subset', async () => {
  const c = fixture();
  const p = await createProfile(c, request('incident-management'), [
    'foundation',
    'incident-management',
  ]);
  const d = approved();
  d.modulePolicy.active = {
    ...active,
    catalogueDigest: await catalogueDigest(c),
    profileDigest: await profileDigest(p),
  };
  await validateDecisionContext(d, c, p, hash);
  await assert.rejects(validateDecisionContext(d, c, p, 'b'.repeat(64)), {
    code: 'CONTEXT_MISMATCH',
  });
  d.modulePolicy.allowedModuleIds.push('risk-management');
  await assert.rejects(validateDecisionContext(d, c, p, hash), { code: 'CONTEXT_MISMATCH' });
});
test('intent expiry, credential injection and fresh removal without active basis fail', () => {
  const intent = {
    version: 1,
    iss: 'https://central.example.test',
    aud: 'urn:thaarei:installer',
    intentId: uuid,
    intentRevision: 1,
    mode: 'fresh',
    binding,
    dmsProductId: '00000000-0000-4000-8000-000000000002',
    desired,
    releaseId: hash,
    environment: 'production',
    customerKey: 'customer',
    iat: 1000,
    nbf: 1000,
    exp: 2000,
  };
  assert.equal(installationIntent.safeParse(intent).success, true);
  assert.equal(installationIntent.safeParse({ ...intent, exp: 87401 }).success, false);
  assert.equal(installationIntent.safeParse({ ...intent, secret: 'private' }).success, false);
  assert.equal(
    assignmentCommand.safeParse({
      version: 1,
      operationId: uuid,
      expectedRevision: 1,
      binding,
      catalogueDigest: hash,
      requestedIndividualIds: [],
      confirmedResolvedIds: ['foundation'],
      explicitlyRemovedIds: ['incident-management'],
      confirmedRemovalClosureIds: [],
      activeBasis: null,
      reason: 'test',
    }).success,
    false,
  );
});
