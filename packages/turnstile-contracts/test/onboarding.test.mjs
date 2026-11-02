import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  CONFIGURATION_ERROR_STATUS,
  CONFIGURATION_LIMITS,
  configurationErrorSchema,
  configurationNameKey,
  configurationSnapshotSchema,
  configurationValidationError,
  onboardingJsonSchemas,
  organizationNameSchema,
  organizationPatchSchema,
  SUPPORTED_TIME_ZONES,
  setupSchema,
  TIME_ZONE_PROVENANCE,
  timeZoneSchema,
  unitCreateResponseSchema,
  unitCreateSchema,
  unitNameSchema,
  workspaceStatusSchema,
} from '../dist/index.js';

const rootId = '11111111-1111-4111-8111-111111111111';
const requirements = (values) =>
  ['organization_name', 'time_zone', 'organization_root', 'configuration_manager'].map(
    (id, index) => ({ id, satisfied: values[index] }),
  );
const incompleteSnapshot = {
  revision: 0,
  organization: { name: null, timeZone: null, rootId: null },
  units: [],
  setup: {
    state: 'not_started',
    requirementVersion: 1,
    revision: 0,
    requirements: requirements([false, false, false, true]),
    nextStep: 'organization',
    completion: null,
  },
};
const completedSnapshot = {
  revision: 2,
  organization: { name: 'Example Company', timeZone: 'UTC', rootId },
  units: [
    { id: rootId, type: 'organization', parentId: null, name: 'Example Company', ancestorIds: [] },
  ],
  setup: {
    state: 'completed',
    requirementVersion: 1,
    revision: 2,
    requirements: requirements([true, true, true, true]),
    nextStep: null,
    completion: {
      completedAt: '2026-11-01T12:00:00Z',
      completedBy: 'fixture-user',
      requirementVersion: 1,
    },
  },
};

test('normalizes Unicode without truncating supplementary letters, hiding controls or folding accents', () => {
  assert.equal(organizationNameSchema.parse(' \tCafe\u0301\u00a0Company\n '), 'Café Company');
  assert.equal(configurationNameKey('Café Company'), configurationNameKey('CAFÉ COMPANY'));
  assert.notEqual(configurationNameKey('Café Company'), configurationNameKey('Cafe Company'));
  const astralLetter = '\u{20000}';
  assert.equal([...organizationNameSchema.parse(astralLetter.repeat(160))].length, 160);
  for (const input of [
    '&',
    '  ',
    '\ud800',
    'A\u0000B',
    'A\u200bB',
    '\ufeffName',
    astralLetter.repeat(161),
    `${' '.repeat(1025)}A`,
  ])
    assert.equal(organizationNameSchema.safeParse(input).success, false);
  assert.equal(unitNameSchema.safeParse('A'.repeat(121)).success, false);
});

test('rejects forged identity/state/parent fields and ambiguous partial mutations', () => {
  assert.deepEqual(organizationPatchSchema.parse({ expectedRevision: 0, name: '  Example  ' }), {
    expectedRevision: 0,
    name: 'Example',
  });
  for (const input of [
    { expectedRevision: 0 },
    { expectedRevision: 0, name: null },
    { expectedRevision: '0', name: 'Example' },
    { expectedRevision: 0, name: 'Example', tenantId: rootId },
    { expectedRevision: 0, name: 'Example', completed: true },
    { expectedRevision: CONFIGURATION_LIMITS.revision + 1, name: 'Example' },
  ])
    assert.equal(organizationPatchSchema.safeParse(input).success, false);
  assert.equal(
    unitCreateSchema.safeParse({
      expectedRevision: 0,
      type: 'organization',
      parentId: rootId,
      name: 'Example',
    }).success,
    false,
  );
  assert.equal(
    workspaceStatusSchema.safeParse({
      status: 'incomplete',
      canManageConfiguration: false,
      organization: completedSnapshot.organization,
    }).success,
    false,
  );
});

test('shares a stable exact zone list without accepting browser aliases or numeric offsets', () => {
  assert.equal(TIME_ZONE_PROVENANCE.node, '24.21.0');
  assert.equal(new Set(SUPPORTED_TIME_ZONES).size, SUPPORTED_TIME_ZONES.length);
  for (const zone of ['UTC', 'Europe/London'])
    assert.equal(timeZoneSchema.safeParse(zone).success, true);
  for (const zone of ['utc', '+05:30', 'Etc/Unknown', 'US/Eastern', ' Asia/Kolkata'])
    assert.equal(timeZoneSchema.safeParse(zone).success, false);
});

test('keeps response lifecycle, canonical root and revisions consistent while supporting root-only completion', () => {
  assert.deepEqual(configurationSnapshotSchema.parse(incompleteSnapshot), incompleteSnapshot);
  assert.deepEqual(configurationSnapshotSchema.parse(completedSnapshot), completedSnapshot);
  assert.equal(
    configurationSnapshotSchema.safeParse({ ...completedSnapshot, revision: 3 }).success,
    false,
  );
  assert.equal(
    configurationSnapshotSchema.safeParse({
      ...completedSnapshot,
      units: [{ ...completedSnapshot.units[0], name: 'Different root' }],
    }).success,
    false,
  );
  assert.equal(
    setupSchema.safeParse({ ...completedSnapshot.setup, completion: null }).success,
    false,
  );
  assert.equal(
    setupSchema.safeParse({
      ...incompleteSnapshot.setup,
      state: 'in_progress',
      revision: 1,
      nextStep: 'review',
    }).success,
    false,
  );
  const replay = {
    configuration: completedSnapshot,
    unitId: '22222222-2222-4222-8222-222222222222',
    replayed: true,
  };
  assert.equal(unitCreateResponseSchema.safeParse(replay).success, true);
  assert.equal(unitCreateResponseSchema.safeParse({ ...replay, replayed: false }).success, false);
});

test('projects validation failures to bounded finite fields without rejected values or arbitrary paths', () => {
  const rejectedValue = 'private-rejected-input';
  const result = organizationPatchSchema.safeParse({
    expectedRevision: -1,
    name: `\u200b${rejectedValue}`,
    tenantId: rejectedValue,
  });
  assert.equal(result.success, false);
  const safe = configurationValidationError(result.error);
  assert.equal(configurationErrorSchema.safeParse(safe).success, true);
  assert.ok(safe.fieldErrors.length <= CONFIGURATION_LIMITS.fieldErrors);
  assert.equal(JSON.stringify(safe).includes(rejectedValue), false);
  assert.equal(JSON.stringify(safe).includes('tenantId'), false);
  assert.equal(CONFIGURATION_ERROR_STATUS.CONFIGURATION_CONFLICT, 409);
  assert.equal(CONFIGURATION_ERROR_STATUS.CONFIGURATION_UNAVAILABLE, 503);
  assert.equal(
    configurationErrorSchema.safeParse({
      code: 'CONFIGURATION_CONFLICT',
      reason: 'revision',
      revision: 1,
      message: rejectedValue,
    }).success,
    false,
  );
});

test('JSON Schema preserves strict request structure, scalar bounds and partial-save alternatives', () => {
  const schemas = onboardingJsonSchemas();
  assert.equal(schemas.OrganizationPatch.additionalProperties, false);
  assert.deepEqual(schemas.OrganizationPatch.anyOf, [
    { required: ['name'] },
    { required: ['timeZone'] },
  ]);
  assert.equal(
    schemas.OrganizationPatch.properties.expectedRevision.maximum,
    CONFIGURATION_LIMITS.revision,
  );
  assert.deepEqual(schemas.OrganizationPatch.properties.timeZone.enum, [...SUPPORTED_TIME_ZONES]);
  assert.equal(
    schemas.OrganizationPatch.properties.name.maxLength,
    CONFIGURATION_LIMITS.rawNameCodePoints,
  );
  assert.match(schemas.OrganizationPatch.properties.name.description, /semantic rules/);
});
