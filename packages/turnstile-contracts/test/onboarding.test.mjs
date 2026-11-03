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
  SETUP_REQUIREMENT_VERSION,
  SUPPORTED_TIME_ZONES,
  setupSchema,
  TIME_ZONE_PROVENANCE,
  timeZoneSchema,
  unitCreateResponseSchema,
  unitCreateSchema,
  unitMoveSchema,
  unitNameSchema,
  workspaceStatusSchema,
} from '../dist/index.js';

const rootId = '11111111-1111-4111-8111-111111111111';
const requirements = (values, version = 1) =>
  [
    'organization_name',
    'time_zone',
    'organization_root',
    ...(version === 2 ? ['first_unit'] : []),
    'configuration_manager',
  ].map((id, index) => ({ id, satisfied: values[index] }));
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
  assert.equal(TIME_ZONE_PROVENANCE.version, 2);
  assert.deepEqual(TIME_ZONE_PROVENANCE.additions, ['UTC', 'Asia/Kolkata', 'Asia/Calcutta']);
  for (const zone of ['UTC', 'Europe/London', 'Asia/Kolkata', 'Asia/Calcutta'])
    assert.equal(timeZoneSchema.safeParse(zone).success, true);
  for (const zone of [
    'utc',
    '+05:30',
    'Etc/Unknown',
    'US/Eastern',
    ' Asia/Kolkata',
    'asia/kolkata',
  ])
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

const v2RootOnly = {
  ...completedSnapshot,
  revision: 1,
  setup: {
    state: 'in_progress',
    requirementVersion: 2,
    revision: 1,
    requirements: requirements([true, true, true, false, true], 2),
    nextStep: 'structure',
    completion: null,
  },
};

test('v2 resumes missing business requirements and requires a saved direct-child Site or Department', () => {
  assert.equal(SETUP_REQUIREMENT_VERSION, 2);
  const empty = {
    ...incompleteSnapshot,
    setup: {
      ...incompleteSnapshot.setup,
      requirementVersion: 2,
      requirements: requirements([false, false, false, false, true], 2),
    },
  };
  assert.deepEqual(configurationSnapshotSchema.parse(empty), empty);
  const partial = {
    ...v2RootOnly,
    organization: { ...v2RootOnly.organization, timeZone: null },
    setup: {
      ...v2RootOnly.setup,
      requirements: requirements([true, false, true, false, true], 2),
      nextStep: 'organization',
    },
  };
  assert.deepEqual(configurationSnapshotSchema.parse(partial), partial);
  assert.deepEqual(configurationSnapshotSchema.parse(v2RootOnly), v2RootOnly);
  for (const type of ['site', 'department']) {
    const ready = {
      ...v2RootOnly,
      revision: 2,
      units: [
        ...v2RootOnly.units,
        {
          id: '22222222-2222-4222-8222-222222222222',
          type,
          parentId: rootId,
          name: 'Operations',
          ancestorIds: [rootId],
        },
      ],
      setup: {
        ...v2RootOnly.setup,
        revision: 2,
        requirements: requirements([true, true, true, true, true], 2),
        nextStep: 'review',
      },
    };
    assert.deepEqual(configurationSnapshotSchema.parse(ready), ready);
    const completed = {
      ...ready,
      revision: 3,
      setup: {
        ...ready.setup,
        state: 'completed',
        revision: 3,
        nextStep: null,
        completion: { ...completedSnapshot.setup.completion, requirementVersion: 2 },
      },
    };
    assert.deepEqual(configurationSnapshotSchema.parse(completed), completed);
    assert.equal(
      configurationSnapshotSchema.safeParse({ ...completed, units: completedSnapshot.units })
        .success,
      false,
    );
    assert.equal(
      configurationSnapshotSchema.safeParse({ ...v2RootOnly, units: ready.units }).success,
      false,
    );
  }
});

test('setup versions cannot mix requirement tuples, completion versions or bypass the next step', () => {
  for (const setup of [
    { ...completedSnapshot.setup, state: 'in_progress', nextStep: 'structure', completion: null },
    { ...completedSnapshot.setup, requirementVersion: 2 },
    { ...v2RootOnly.setup, requirementVersion: 1 },
    { ...v2RootOnly.setup, requirementVersion: 3 },
    { ...v2RootOnly.setup, nextStep: 'review' },
    { ...v2RootOnly.setup, nextStep: 'organization' },
    {
      ...v2RootOnly.setup,
      state: 'completed',
      nextStep: null,
      completion: { ...completedSnapshot.setup.completion, requirementVersion: 2 },
    },
    {
      ...completedSnapshot.setup,
      requirementVersion: 2,
      requirements: requirements([true, true, true, true, true], 2),
    },
    {
      ...completedSnapshot.setup,
      completion: { ...completedSnapshot.setup.completion, requirementVersion: 2 },
    },
    {
      ...incompleteSnapshot.setup,
      requirementVersion: 2,
      requirements: requirements([false, false, false, true, true], 2),
    },
  ])
    assert.equal(setupSchema.safeParse(setup).success, false, JSON.stringify(setup));
});

test('legacy completed root-only snapshots retain saved zone identifiers and completion metadata', () => {
  for (const timeZone of ['UTC', 'Asia/Calcutta', 'Asia/Kolkata']) {
    const saved = {
      ...completedSnapshot,
      organization: { ...completedSnapshot.organization, timeZone },
    };
    assert.deepEqual(configurationSnapshotSchema.parse(saved), saved);
  }
});

test('move requests are strict revision-bound parent changes with finite conflict errors', () => {
  const input = { expectedRevision: 4, parentId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' };
  assert.deepEqual(unitMoveSchema.parse(input), {
    ...input,
    parentId: input.parentId.toLowerCase(),
  });
  for (const value of [
    { parentId: rootId },
    { expectedRevision: 0 },
    { expectedRevision: -1, parentId: rootId },
    { expectedRevision: CONFIGURATION_LIMITS.revision + 1, parentId: rootId },
    { expectedRevision: '1', parentId: rootId },
    { expectedRevision: 1, parentId: null },
    { expectedRevision: 1, parentId: 'unknown' },
    ...['tenantId', 'actorId', 'type', 'name', 'id'].map((field) => ({
      ...input,
      [field]: rootId,
    })),
  ])
    assert.equal(unitMoveSchema.safeParse(value).success, false);
  assert.deepEqual(
    configurationErrorSchema.parse({
      code: 'CONFIGURATION_CONFLICT',
      reason: 'required_unit',
      revision: 4,
    }),
    { code: 'CONFIGURATION_CONFLICT', reason: 'required_unit', revision: 4 },
  );
  assert.equal(
    configurationErrorSchema.safeParse({
      code: 'CONFIGURATION_CONFLICT',
      reason: 'arbitrary_failure',
      revision: 4,
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
  assert.equal(schemas.UnitMove.additionalProperties, false);
  assert.deepEqual(schemas.UnitMove.required, ['expectedRevision', 'parentId']);
});
