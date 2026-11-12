import { z } from 'zod';
import { configurationNameKey, normalizeConfigurationName } from './onboarding.js';

// Public product catalogue. Legacy private replacement inputs remain a separate v1 contract.
export const PEOPLE_CATALOG_VERSION = 2;
export const PEOPLE_API_VERSION = '1.1.0';
export const PEOPLE_LIMITS = {
  bodyBytes: 16_384,
  responseBytes: 1_048_576,
  requestTimeoutMs: 10_000,
  roles: 128,
  assignments: 32,
  anchorsPerAssignment: 16,
  anchorsPerPayload: 64,
  defaultPageSize: 25,
  pageSize: 100,
  rawNameCodePoints: 1024,
  roleNameCodePoints: 80,
  descriptionCodePoints: 500,
  searchCodePoints: 120,
  revision: 2_147_483_647,
  invitationSeconds: 604_800,
  oidcTransactionSeconds: 300,
  restrictedIdentitySeconds: 600,
  setupContinuationSeconds: 1800,
  impactSeconds: 300,
  commandReceiptSeconds: 86_400,
  acceptanceReceiptSeconds: 604_800,
  pendingInvitations: 1000,
  unfinishedDeliveries: 2048,
  administratorActionsPerMinute: 10,
  installationActionsPerHour: 100,
  publicAttemptsPerMinute: 10,
  publicRateBuckets: 10000,
  deliveryBatch: 10,
  deliveryIntervalSeconds: 5,
  deliveryLeaseSeconds: 30,
  deliveryAttempts: 5,
  smtpDeadlineSeconds: 10,
  auditRetentionDays: 90,
  maintenanceRows: 1000,
} as const;

export const PEOPLE_PERMISSIONS = [
  'turnstile:access',
  'turnstile:dms:capabilities:read',
  'turnstile:configuration:manage',
  'turnstile:people:manage',
  'turnstile:roles:manage',
  'turnstile:incidents:read',
  'turnstile:risks:read',
  'turnstile:units:read',
  'turnstile:units:manage',
] as const;
export type PeoplePermission = (typeof PEOPLE_PERMISSIONS)[number];
export const COMPANY_ONLY_PERMISSIONS: readonly PeoplePermission[] = [
  'turnstile:dms:capabilities:read',
  'turnstile:configuration:manage',
  'turnstile:people:manage',
  'turnstile:roles:manage',
  'turnstile:incidents:read',
  'turnstile:risks:read',
];
export const peoplePermissionSchema = z.enum(PEOPLE_PERMISSIONS);
export const peopleIdSchema = z.uuid().toLowerCase();
export const canonicalPeopleIdSchema = z.uuid().regex(/^[0-9a-f-]+$/);
export const peopleSubjectSchema = z.string().regex(/^[A-Za-z0-9_-]{1,200}$/);
export const accessRevisionSchema = z.number().int().min(0).max(PEOPLE_LIMITS.revision);
export const peopleVersionSchema = accessRevisionSchema.min(1);
export const peopleDigestSchema = z.string().regex(/^[0-9a-f]{64}$/);
// 32-byte base64url credentials, including canonical trailing pad bits.
export const peopleSecretSchema = z.string().regex(/^[A-Za-z0-9_-]{42}[AEIMQUYcgkosw048]$/);
export const impactTokenSchema = z
  .string()
  .min(43)
  .max(2048)
  .regex(/^[A-Za-z0-9_.-]+$/);
export const peopleInstantSchema = z.iso.datetime();

export function uniqueValues<T>(values: readonly T[]): boolean {
  return new Set(values).size === values.length;
}

export const rolePermissionsSchema = z
  .array(peoplePermissionSchema)
  .min(1)
  .max(PEOPLE_PERMISSIONS.length)
  .refine(uniqueValues, 'Duplicate permissions')
  .refine((values) => values.includes('turnstile:access'), 'Explicit shell entry required');

export const SYSTEM_ROLE_KEYS = [
  'workspace_administrator',
  'configuration_manager',
  'unit_manager',
  'member',
] as const;
export const SYSTEM_ROLE_TEMPLATES = [
  {
    systemKey: 'workspace_administrator',
    name: 'Workspace administrator',
    permissions: [
      'turnstile:access',
      'turnstile:configuration:manage',
      'turnstile:people:manage',
      'turnstile:roles:manage',
      'turnstile:units:read',
      'turnstile:units:manage',
    ],
  },
  {
    systemKey: 'configuration_manager',
    name: 'Configuration manager',
    permissions: [
      'turnstile:access',
      'turnstile:configuration:manage',
      'turnstile:units:read',
      'turnstile:units:manage',
    ],
  },
  {
    systemKey: 'unit_manager',
    name: 'Unit manager',
    permissions: ['turnstile:access', 'turnstile:units:read', 'turnstile:units:manage'],
  },
  { systemKey: 'member', name: 'Member', permissions: ['turnstile:access'] },
] as const;

export function canonicalPeopleName(maximum: number) {
  return z
    .string()
    .regex(/[\p{L}\p{N}]/u)
    .regex(/^[^\p{Cc}\p{Cf}\p{Cs}]*$/u)
    .refine((value) => [...value].length <= maximum, 'Name is too long')
    .refine((value) => normalizeConfigurationName(value) === value, 'Noncanonical name')
    .meta({ minLength: 1, maxLength: maximum });
}

export const canonicalRoleNameSchema = canonicalPeopleName(PEOPLE_LIMITS.roleNameCodePoints);
export const roleNameSchema = z
  .string()
  .refine((value) => !/\p{Cs}/u.test(value) && [...value].length <= 1024)
  .meta({ maxLength: 1024, description: 'Normalize NFC and Unicode whitespace before validation.' })
  .transform(normalizeConfigurationName)
  .pipe(canonicalRoleNameSchema)
  .refine(
    (name) =>
      !SYSTEM_ROLE_TEMPLATES.some(
        (role) => configurationNameKey(role.name) === configurationNameKey(name),
      ),
    'Reserved system role name',
  );
export const canonicalRoleDescriptionSchema = z
  .string()
  .refine((value) => [...value].length <= 500)
  .refine((value) => !/[\p{Cc}\p{Cf}\p{Cs}]/u.test(value.replaceAll('\n', '')))
  .refine((value) => value.length > 0 && value.normalize('NFC').trim() === value)
  .meta({ minLength: 1, maxLength: 500 })
  .nullable();
export const roleDescriptionSchema = z
  .string()
  .refine((value) => !/\p{Cs}/u.test(value) && [...value].length <= 1024)
  .meta({ maxLength: 1024 })
  .transform((value) => value.normalize('NFC').trim() || null)
  .pipe(canonicalRoleDescriptionSchema)
  .nullable();

// Match the pinned authority: lowercase, validate; never trim or merge provider aliases.
export const invitationEmailSchema = z
  .string()
  .max(254)
  .transform((value) => value.toLowerCase())
  .pipe(z.email());
export const canonicalInvitationEmailSchema = z
  .email()
  .max(254)
  .refine((value) => value === value.toLowerCase());
export const peoplePathSchema = z.strictObject({ id: peopleIdSchema });
export const peopleMutationHeadersSchema = z
  .strictObject({ 'idempotency-key': peopleIdSchema })
  .meta({
    description:
      'Only the projected Idempotency-Key header; transport/CSRF headers are validated separately.',
  });
export const peopleEmptySchema = z.strictObject({});
const searchSchema = z
  .string()
  .refine((value) => !/\p{Cs}/u.test(value) && [...value].length <= 1024)
  .meta({ maxLength: 1024 })
  .transform((value) => value.normalize('NFC').trim())
  .pipe(
    z
      .string()
      .refine((value) => [...value].length <= 120)
      .meta({ maxLength: 120 }),
  );
export const peopleListQuerySchema = z.strictObject({
  cursor: z
    .string()
    .min(1)
    .max(2048)
    .regex(/^[A-Za-z0-9_.-]+$/)
    .optional(),
  limit: z
    .union([
      z.number().int(),
      z
        .string()
        .regex(/^[1-9][0-9]{0,2}$/)
        .transform(Number),
    ])
    .pipe(z.number().int().min(1).max(100))
    .default(25),
  search: searchSchema.transform((value) => value || undefined).optional(),
});
export const memberListQuerySchema = peopleListQuerySchema.extend({
  status: z.enum(['active', 'suspended']).optional(),
});
export const roleListQuerySchema = peopleListQuerySchema.extend({
  kind: z.enum(['system', 'custom']).optional(),
});
export const invitationListQuerySchema = peopleListQuerySchema.extend({
  state: z.enum(['pending', 'needs_reapproval', 'accepted', 'cancelled', 'expired']).optional(),
});

export function peoplePageSchema<T extends z.ZodType>(item: T) {
  return z
    .strictObject({
      items: z.array(item).max(100),
      nextCursor: z
        .string()
        .min(1)
        .max(2048)
        .regex(/^[A-Za-z0-9_.-]+$/)
        .nullable(),
      total: accessRevisionSchema,
      accessRevision: accessRevisionSchema,
    })
    .refine((value) => value.total >= value.items.length, 'Invalid authorized total');
}
