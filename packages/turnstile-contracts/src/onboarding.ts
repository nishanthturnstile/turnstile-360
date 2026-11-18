import { z } from 'zod';
import { SUPPORTED_TIME_ZONES } from './time-zones.js';

export const CONFIGURATION_LIMITS = {
  bodyBytes: 4096,
  responseBytes: 1048576,
  requestTimeoutMs: 10000,
  rawNameCodePoints: 1024,
  organizationNameCodePoints: 160,
  unitNameCodePoints: 120,
  units: 500,
  depth: 8,
  revision: 2147483647,
  fieldErrors: 8,
  createReceiptSeconds: 86400,
  createReceipts: 1024,
  auditRetentionDays: 90,
  maintenanceRows: 1000,
} as const;
export const SETUP_REQUIREMENT_VERSION = 2;
export const CONFIGURATION_MANAGE_PERMISSION = 'turnstile:configuration:manage';

export function normalizeConfigurationName(value: string): string {
  return value
    .normalize('NFC')
    .replace(/\p{White_Space}+/gu, ' ')
    .replace(/^ | $/g, '');
}

export function configurationNameKey(normalizedName: string): string {
  return normalizedName.toLowerCase().normalize('NFC');
}

function canonicalName(max: number) {
  return z
    .string()
    .regex(/[\p{L}\p{N}]/u, 'Name must contain a letter or number')
    .regex(/^[^\p{Cc}\p{Cf}\p{Cs}]*$/u, 'Unsupported name characters')
    .refine((value) => [...value].length <= max, 'Name is too long')
    .refine((value) => normalizeConfigurationName(value) === value, 'Name is not normalized')
    .meta({
      minLength: 1,
      maxLength: max,
      description:
        'Canonical NFC name with collapsed Unicode whitespace; display case and accents preserved.',
    });
}

function submittedName(max: number) {
  return z
    .string()
    .refine((value) => !/\p{Cs}/u.test(value), 'Invalid Unicode')
    .refine(
      (value) => [...value].length <= CONFIGURATION_LIMITS.rawNameCodePoints,
      'Raw name is too long',
    )
    .meta({
      maxLength: CONFIGURATION_LIMITS.rawNameCodePoints,
      description: `At most 1024 raw Unicode code points; normalize NFC and collapse/trim Unicode White_Space, then require 1–${max} code points, a letter/number and no remaining Cc/Cf/Cs characters. Executable validation applies these semantic rules.`,
    })
    .transform(normalizeConfigurationName)
    .pipe(canonicalName(max));
}

export const organizationNameSchema = submittedName(
  CONFIGURATION_LIMITS.organizationNameCodePoints,
);
export const unitNameSchema = submittedName(CONFIGURATION_LIMITS.unitNameCodePoints);
export const canonicalOrganizationNameSchema = canonicalName(
  CONFIGURATION_LIMITS.organizationNameCodePoints,
);
export const canonicalUnitNameSchema = canonicalName(CONFIGURATION_LIMITS.unitNameCodePoints);
export const configurationIdSchema = z.uuid().toLowerCase();
const canonicalIdSchema = z.uuid().regex(/^[0-9a-f-]+$/);
export const configurationActorSchema = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
export const organizationRevisionSchema = z
  .number()
  .int()
  .min(0)
  .max(CONFIGURATION_LIMITS.revision);
export const timeZoneSchema = z.enum(SUPPORTED_TIME_ZONES).meta({
  description:
    'Exact shared time-zone allowlist, including Asia/Kolkata, retained Asia/Calcutta and UTC. List provenance is independent of setup requirement version. An explicitly submitted value confirms the zone; no browser/OS default or numeric offset is accepted.',
});
export const configurationQuerySchema = z.strictObject({});
export const unitPathSchema = z.strictObject({ id: configurationIdSchema });
export const unitCreateHeadersSchema = z
  .strictObject({ 'idempotency-key': configurationIdSchema })
  .meta({
    description:
      'Only the projected Idempotency-Key header; transport and CSRF headers are validated separately by the HTTP boundary.',
  });

export const organizationPatchSchema = z
  .strictObject({
    expectedRevision: organizationRevisionSchema,
    name: organizationNameSchema.optional(),
    timeZone: timeZoneSchema.optional(),
  })
  .refine(
    (value) => value.name !== undefined || value.timeZone !== undefined,
    'Supply name or timeZone',
  )
  .meta({ anyOf: [{ required: ['name'] }, { required: ['timeZone'] }] });
export const unitCreateSchema = z.strictObject({
  expectedRevision: organizationRevisionSchema,
  type: z.enum(['site', 'department']),
  parentId: configurationIdSchema,
  name: unitNameSchema,
});
export const unitRenameSchema = z.strictObject({
  expectedRevision: organizationRevisionSchema,
  name: unitNameSchema,
});
export const unitMoveSchema = z
  .strictObject({
    expectedRevision: organizationRevisionSchema,
    parentId: configurationIdSchema,
  })
  .meta({
    description:
      'Move a non-root unit to a saved parent. Backend validation checks current authorization/revision, relationships, cycles, full subtree depth, sibling names, references and required-unit preservation. Same-parent/current-revision is a no-op. Reconcile an uncertain response through canonical readback before explicit retry; never automatically replay.',
  });
export const revisionMutationSchema = z.strictObject({
  expectedRevision: organizationRevisionSchema,
});
export const setupCompleteSchema = revisionMutationSchema;
export const unitDeleteSchema = revisionMutationSchema;

export const organizationSchema = z
  .strictObject({
    name: canonicalOrganizationNameSchema.nullable(),
    timeZone: timeZoneSchema.nullable(),
    rootId: canonicalIdSchema.nullable(),
  })
  .refine(
    (value) => (value.name === null) === (value.rootId === null),
    'A saved name and root must exist together',
  )
  .meta({
    description:
      'Canonical partial profile. Name and rootId are either both null or both present; saved timeZone means explicitly confirmed.',
  });
const ancestrySchema = z.array(canonicalIdSchema).max(CONFIGURATION_LIMITS.depth - 1);
export const organizationUnitSchema = z.discriminatedUnion('type', [
  z.strictObject({
    id: canonicalIdSchema,
    type: z.literal('organization'),
    parentId: z.null(),
    name: canonicalOrganizationNameSchema,
    ancestorIds: z.tuple([]),
  }),
  z.strictObject({
    id: canonicalIdSchema,
    type: z.literal('site'),
    parentId: canonicalIdSchema,
    name: canonicalUnitNameSchema,
    ancestorIds: z.tuple([canonicalIdSchema]),
  }),
  z.strictObject({
    id: canonicalIdSchema,
    type: z.literal('department'),
    parentId: canonicalIdSchema,
    name: canonicalUnitNameSchema,
    ancestorIds: ancestrySchema.min(1),
  }),
]);
const unitsSchema = z.array(organizationUnitSchema).max(CONFIGURATION_LIMITS.units);
export const workspaceStatusSchema = z.strictObject({
  status: z.enum(['incomplete', 'complete']),
  canManageConfiguration: z.boolean(),
});
export const setupRequirementsV1Schema = z.tuple([
  z.strictObject({ id: z.literal('organization_name'), satisfied: z.boolean() }),
  z.strictObject({ id: z.literal('time_zone'), satisfied: z.boolean() }),
  z.strictObject({ id: z.literal('organization_root'), satisfied: z.boolean() }),
  z.strictObject({ id: z.literal('configuration_manager'), satisfied: z.boolean() }),
]);
export const setupRequirementsV2Schema = z.tuple([
  z.strictObject({ id: z.literal('organization_name'), satisfied: z.boolean() }),
  z.strictObject({ id: z.literal('time_zone'), satisfied: z.boolean() }),
  z.strictObject({ id: z.literal('organization_root'), satisfied: z.boolean() }),
  z.strictObject({ id: z.literal('first_unit'), satisfied: z.boolean() }),
  z.strictObject({ id: z.literal('configuration_manager'), satisfied: z.boolean() }),
]);
export const setupRequirementsSchema = z.union([
  setupRequirementsV1Schema,
  setupRequirementsV2Schema,
]);
function completionForVersion<const Version extends 1 | 2>(version: Version) {
  return z.strictObject({
    completedAt: z.iso.datetime(),
    completedBy: configurationActorSchema,
    requirementVersion: z.literal(version),
  });
}
export const setupCompletionSchema = z.discriminatedUnion('requirementVersion', [
  completionForVersion(1),
  completionForVersion(SETUP_REQUIREMENT_VERSION),
]);
function setupForVersion<
  const Version extends 1 | 2,
  Requirements extends typeof setupRequirementsV1Schema | typeof setupRequirementsV2Schema,
  NextStep extends z.ZodType,
>(version: Version, requirements: Requirements, nextStep: NextStep) {
  const base = {
    requirementVersion: z.literal(version),
    revision: organizationRevisionSchema,
    requirements,
  };
  return z.discriminatedUnion('state', [
    z.strictObject({
      ...base,
      state: z.literal('not_started'),
      nextStep: z.literal('organization'),
      completion: z.null(),
    }),
    z.strictObject({
      ...base,
      state: z.literal('in_progress'),
      nextStep,
      completion: z.null(),
    }),
    z.strictObject({
      ...base,
      state: z.literal('completed'),
      nextStep: z.null(),
      completion: completionForVersion(version),
    }),
  ]);
}
export const setupSchema = z
  .union([
    setupForVersion(1, setupRequirementsV1Schema, z.enum(['organization', 'review'])),
    setupForVersion(
      SETUP_REQUIREMENT_VERSION,
      setupRequirementsV2Schema,
      z.enum(['organization', 'structure', 'review']),
    ),
  ])
  .superRefine((value, ctx) => {
    const profileReady = value.requirements.slice(0, 3).every((item) => item.satisfied);
    const businessRequirements = value.requirements.slice(0, -1);
    const businessReady = businessRequirements.every((item) => item.satisfied);
    const nextStep = !profileReady ? 'organization' : !businessReady ? 'structure' : 'review';
    if (
      value.state === 'not_started' &&
      (value.revision !== 0 || businessRequirements.some((item) => item.satisfied))
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Not-started setup must have empty profile and units at revision zero',
      });
    if (value.state !== 'not_started' && value.revision === 0)
      ctx.addIssue({ code: 'custom', message: 'Saved setup must have a positive revision' });
    if (
      (value.state === 'completed' && !value.requirements.every((item) => item.satisfied)) ||
      (value.state === 'in_progress' && value.nextStep !== nextStep) ||
      (value.requirementVersion === 2 &&
        value.requirements[3].satisfied &&
        !value.requirements[2].satisfied)
    )
      ctx.addIssue({
        code: 'custom',
        message: 'Setup requirements do not match the lifecycle/next step',
      });
  })
  .meta({
    description:
      'Versioned setup: v1 retains its four requirements and valid root-only completion. V2 adds first_unit before configuration_manager; Review additionally requires a saved direct-child Site/Department. Resume Organization for profile/root gaps, Structure for a v2 first-unit gap, otherwise Review. Not-started is revision 0 with no saved business values; saved/completed revisions are positive. Completion matches the setup version and requires every check. Cross-field rules are enforced by executable validation.',
  });
export const organizationResponseSchema = z.strictObject({
  revision: organizationRevisionSchema,
  organization: organizationSchema,
});
export const organizationUnitsResponseSchema = z.strictObject({
  revision: organizationRevisionSchema,
  units: unitsSchema,
});
export const configurationSnapshotSchema = z
  .strictObject({
    revision: organizationRevisionSchema,
    organization: organizationSchema,
    units: unitsSchema,
    setup: setupSchema,
  })
  .superRefine((value, ctx) => {
    const root = value.units.filter((unit) => unit.type === 'organization');
    if (
      value.revision !== value.setup.revision ||
      (value.organization.rootId === null
        ? value.units.length !== 0
        : root.length !== 1 ||
          root[0]?.id !== value.organization.rootId ||
          root[0]?.name !== value.organization.name)
    )
      ctx.addIssue({ code: 'custom', message: 'Snapshot revisions or canonical root disagree' });
    const actual = [
      value.organization.name !== null,
      value.organization.timeZone !== null,
      value.organization.rootId !== null,
    ];
    if (actual.some((satisfied, index) => value.setup.requirements[index]?.satisfied !== satisfied))
      ctx.addIssue({ code: 'custom', message: 'Setup checklist disagrees with saved profile' });
    if (value.setup.requirementVersion === 2) {
      const firstUnit = value.units.some(
        (unit) => unit.type !== 'organization' && unit.parentId === value.organization.rootId,
      );
      if (value.setup.requirements[3].satisfied !== firstUnit)
        ctx.addIssue({
          code: 'custom',
          message: 'First-unit checklist disagrees with saved units',
        });
    }
  })
  .meta({
    description:
      'One consistent canonical revision. Snapshot/setup revisions agree, root identity/name match the profile and the first three requirements reflect saved values. V2 first_unit agrees with a saved direct-child Site/Department; completed v1 needs no first unit. Graph/reference/uniqueness authorization rules remain backend domain validation.',
  });
export const unitCreateResponseSchema = z
  .strictObject({
    configuration: configurationSnapshotSchema,
    unitId: canonicalIdSchema,
    replayed: z.boolean(),
  })
  .refine(
    (value) =>
      value.replayed ||
      value.configuration.units.some(
        (unit) => unit.id === value.unitId && unit.type !== 'organization',
      ),
    'A first create response must contain the created non-root unit',
  )
  .meta({
    description:
      'A first create includes the created non-root unit in the snapshot. Authorized replay returns its original identity plus current configuration, which may no longer contain that unit.',
  });

export const configurationFieldSchema = z.enum([
  'body',
  'name',
  'timeZone',
  'type',
  'parentId',
  'id',
  'expectedRevision',
  'idempotencyKey',
]);
export const configurationFieldErrorSchema = z.strictObject({
  field: configurationFieldSchema,
  reason: z.enum(['required', 'invalid', 'too_long', 'unsupported', 'limit_reached']),
});
export const configurationInvalidSchema = z.strictObject({
  code: z.literal('CONFIGURATION_INVALID'),
  fieldErrors: z.array(configurationFieldErrorSchema).min(1).max(CONFIGURATION_LIMITS.fieldErrors),
});
export const configurationConflictSchema = z.strictObject({
  code: z.literal('CONFIGURATION_CONFLICT'),
  reason: z.enum([
    'revision',
    'duplicate_name',
    'unit_in_use',
    'idempotency_mismatch',
    'required_unit',
  ]),
  revision: organizationRevisionSchema,
});
export const configurationNotFoundSchema = z.strictObject({
  code: z.literal('CONFIGURATION_NOT_FOUND'),
});
export const setupRequiredSchema = z.strictObject({ code: z.literal('SETUP_REQUIRED') });
export const configurationTooLargeSchema = z.strictObject({
  code: z.literal('CONFIGURATION_TOO_LARGE'),
});
export const configurationMediaTypeSchema = z.strictObject({
  code: z.literal('CONFIGURATION_MEDIA_TYPE_UNSUPPORTED'),
});
export const configurationUnavailableSchema = z.strictObject({
  code: z.literal('CONFIGURATION_UNAVAILABLE'),
});
export const configurationErrorSchema = z.discriminatedUnion('code', [
  z.strictObject({ code: z.literal('DEPLOYMENT_RESTRICTED'), requestId: z.uuid().optional() }),
  configurationInvalidSchema,
  configurationConflictSchema,
  configurationNotFoundSchema,
  setupRequiredSchema,
  configurationTooLargeSchema,
  configurationMediaTypeSchema,
  configurationUnavailableSchema,
]);
export const CONFIGURATION_ERROR_STATUS = {
  DEPLOYMENT_RESTRICTED: 403,
  CONFIGURATION_INVALID: 400,
  CONFIGURATION_NOT_FOUND: 404,
  CONFIGURATION_CONFLICT: 409,
  SETUP_REQUIRED: 409,
  CONFIGURATION_TOO_LARGE: 413,
  CONFIGURATION_MEDIA_TYPE_UNSUPPORTED: 415,
  CONFIGURATION_UNAVAILABLE: 503,
} as const satisfies Record<z.infer<typeof configurationErrorSchema>['code'], number>;

// Convert validation issues to a finite projection; rejected input/messages never leave the server.
export function configurationValidationError(error: z.ZodError): ConfigurationErrorDto {
  const fieldErrors: z.infer<typeof configurationFieldErrorSchema>[] = [];
  for (const issue of error.issues) {
    const candidate = issue.path[0];
    const field =
      candidate === 'idempotency-key'
        ? 'idempotencyKey'
        : (configurationFieldSchema.safeParse(candidate).data ?? 'body');
    const reason =
      issue.code === 'unrecognized_keys'
        ? 'unsupported'
        : issue.code === 'too_big'
          ? 'too_long'
          : 'invalid';
    if (!fieldErrors.some((item) => item.field === field && item.reason === reason))
      fieldErrors.push({ field, reason });
    if (fieldErrors.length === CONFIGURATION_LIMITS.fieldErrors) break;
  }
  return {
    code: 'CONFIGURATION_INVALID',
    fieldErrors: fieldErrors.length ? fieldErrors : [{ field: 'body', reason: 'invalid' }],
  };
}

export type OrganizationPatch = z.infer<typeof organizationPatchSchema>;
export type UnitCreate = z.infer<typeof unitCreateSchema>;
export type UnitRename = z.infer<typeof unitRenameSchema>;
export type UnitMove = z.infer<typeof unitMoveSchema>;
export type RevisionMutation = z.infer<typeof revisionMutationSchema>;
export type SetupComplete = z.infer<typeof setupCompleteSchema>;
export type UnitDelete = z.infer<typeof unitDeleteSchema>;
export type OrganizationDto = z.infer<typeof organizationSchema>;
export type OrganizationUnitDto = z.infer<typeof organizationUnitSchema>;
export type OrganizationResponseDto = z.infer<typeof organizationResponseSchema>;
export type OrganizationUnitsResponseDto = z.infer<typeof organizationUnitsResponseSchema>;
export type WorkspaceStatusDto = z.infer<typeof workspaceStatusSchema>;
export type SetupDto = z.infer<typeof setupSchema>;
export type SetupCompletionDto = z.infer<typeof setupCompletionSchema>;
export type ConfigurationSnapshotDto = z.infer<typeof configurationSnapshotSchema>;
export type UnitCreateResponseDto = z.infer<typeof unitCreateResponseSchema>;
export type ConfigurationErrorDto = z.infer<typeof configurationErrorSchema>;
export type ConfigurationErrorCode = ConfigurationErrorDto['code'];

export const onboardingSchemas = {
  TimeZone: timeZoneSchema,
  OrganizationPatch: organizationPatchSchema,
  UnitCreate: unitCreateSchema,
  UnitRename: unitRenameSchema,
  UnitMove: unitMoveSchema,
  RevisionMutation: revisionMutationSchema,
  UnitPath: unitPathSchema,
  UnitCreateHeaders: unitCreateHeadersSchema,
  WorkspaceStatus: workspaceStatusSchema,
  Setup: setupSchema,
  Organization: organizationSchema,
  OrganizationUnit: organizationUnitSchema,
  OrganizationResponse: organizationResponseSchema,
  OrganizationUnitsResponse: organizationUnitsResponseSchema,
  ConfigurationSnapshot: configurationSnapshotSchema,
  UnitCreateResponse: unitCreateResponseSchema,
  ConfigurationInvalid: configurationInvalidSchema,
  ConfigurationConflict: configurationConflictSchema,
  ConfigurationNotFound: configurationNotFoundSchema,
  SetupRequired: setupRequiredSchema,
  ConfigurationTooLarge: configurationTooLargeSchema,
  ConfigurationMediaType: configurationMediaTypeSchema,
  ConfigurationUnavailable: configurationUnavailableSchema,
};

export function onboardingJsonSchemas() {
  return Object.fromEntries(
    Object.entries(onboardingSchemas).map(([name, schema]) => [
      name,
      z.toJSONSchema(schema, { io: 'input' }),
    ]),
  );
}
