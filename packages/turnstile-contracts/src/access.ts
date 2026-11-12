import { z } from 'zod';
import {
  CONFIGURATION_LIMITS,
  canonicalOrganizationNameSchema,
  canonicalUnitNameSchema,
  configurationNameKey,
} from './onboarding.js';
import {
  accessRevisionSchema,
  COMPANY_ONLY_PERMISSIONS,
  canonicalPeopleIdSchema,
  canonicalRoleDescriptionSchema,
  canonicalRoleNameSchema,
  PEOPLE_CATALOG_VERSION,
  PEOPLE_PERMISSIONS,
  peopleDigestSchema,
  peopleIdSchema,
  peopleInstantSchema,
  peoplePageSchema,
  peoplePermissionSchema,
  peopleSecretSchema,
  peopleSubjectSchema,
  peopleVersionSchema,
  rolePermissionsSchema,
  SYSTEM_ROLE_KEYS,
  SYSTEM_ROLE_TEMPLATES,
  uniqueValues,
} from './people-common.js';

export const assignmentScopeSchema = z.discriminatedUnion('kind', [
  z.strictObject({ kind: z.literal('company') }),
  z.strictObject({
    kind: z.literal('units'),
    unitIds: z.array(peopleIdSchema).min(1).max(16).refine(uniqueValues),
    includeChildren: z.boolean(),
  }),
]);
export const roleDefinitionSchema = z
  .strictObject({
    id: canonicalPeopleIdSchema,
    version: peopleVersionSchema,
    // Permission version is independent of harmless display-only edits.
    permissionVersion: peopleVersionSchema,
    systemKey: z.enum(SYSTEM_ROLE_KEYS).nullable(),
    name: canonicalRoleNameSchema,
    description: canonicalRoleDescriptionSchema,
    permissions: rolePermissionsSchema,
  })
  .superRefine((role, context) => {
    if (role.permissionVersion > role.version)
      context.addIssue({ code: 'custom', message: 'Permission version exceeds entity version' });
    const system = SYSTEM_ROLE_TEMPLATES.find((row) => row.systemKey === role.systemKey);
    if (system) {
      if (
        role.name !== system.name ||
        role.description !== null ||
        role.permissions.length !== system.permissions.length ||
        role.permissions.some(
          (permission) => !(system.permissions as readonly string[]).includes(permission),
        )
      )
        context.addIssue({ code: 'custom', message: 'System template is read-only' });
    } else if (
      SYSTEM_ROLE_TEMPLATES.some(
        (row) => configurationNameKey(row.name) === configurationNameKey(role.name),
      )
    ) {
      context.addIssue({ code: 'custom', message: 'Reserved role name' });
    }
  });
export const roleAssignmentRequestSchema = z.strictObject({
  roleId: peopleIdSchema,
  expectedRoleVersion: peopleVersionSchema,
  scope: assignmentScopeSchema,
});

type ScopedAssignment = { scope: z.infer<typeof assignmentScopeSchema> };
type AssignmentKey = ScopedAssignment & { roleId: string };
function assignmentKey(assignment: AssignmentKey): string {
  const scope = assignment.scope;
  return `${assignment.roleId}:${scope.kind === 'company' ? 'company' : `${scope.includeChildren}:${[...scope.unitIds].sort().join(',')}`}`;
}
export function validAssignmentSet(assignments: readonly AssignmentKey[]): boolean {
  return (
    uniqueValues(assignments.map(assignmentKey)) &&
    assignments.reduce(
      (count, assignment) =>
        count + (assignment.scope.kind === 'units' ? assignment.scope.unitIds.length : 0),
      0,
    ) <= 64
  );
}
export const roleAssignmentRequestsSchema = z
  .array(roleAssignmentRequestSchema)
  .max(32)
  .refine(validAssignmentSet, 'Duplicate assignments or payload anchor limit');
// Resolve roles from the owning repository before using this validator. Request-supplied
// permission snapshots are never authority for a grant.
export const resolvedRoleAssignmentSchema = z
  .strictObject({
    id: canonicalPeopleIdSchema,
    role: roleDefinitionSchema,
    scope: assignmentScopeSchema,
  })
  .refine(
    (assignment) =>
      assignment.scope.kind === 'company' ||
      !assignment.role.permissions.some((permission) =>
        COMPANY_ONLY_PERMISSIONS.includes(permission),
      ),
    'Company-only action cannot be assigned to units',
  );
export const resolvedRoleAssignmentsSchema = z
  .array(resolvedRoleAssignmentSchema)
  .max(32)
  .refine(
    (values) =>
      uniqueValues(values.map((value) => value.id)) &&
      validAssignmentSet(values.map((value) => ({ roleId: value.role.id, scope: value.scope }))),
    'Duplicate assignments or payload anchor limit',
  );

const displayFields = {
  // Existing authority profiles are preserved; stricter setup rules apply only to new names.
  name: z.string().min(1).max(200),
  email: z.email().max(254),
  verifiedAt: peopleInstantSchema,
};
export const memberIdentityDisplaySchema = z.discriminatedUnion('state', [
  z.strictObject({ state: z.literal('fresh'), ...displayFields }),
  z.strictObject({ state: z.literal('stale'), ...displayFields }),
  z.strictObject({ state: z.literal('deleted'), checkedAt: peopleInstantSchema }),
  z.strictObject({ state: z.literal('unavailable') }),
]);
export const legacyGrantSourceSchema = z.strictObject({
  kind: z.literal('legacy'),
  version: peopleVersionSchema,
  // Legacy sets may intentionally lack shell entry. Preserve their original names exactly.
  permissions: z
    .array(
      z.enum([
        'turnstile:access',
        'turnstile:dms:capabilities:read',
        'turnstile:configuration:manage',
      ]),
    )
    .max(3)
    .refine(uniqueValues),
  retired: z.boolean(),
});
export const memberSchema = z.strictObject({
  id: canonicalPeopleIdSchema,
  userId: peopleSubjectSchema,
  version: peopleVersionSchema,
  status: z.enum(['active', 'suspended']),
  identity: memberIdentityDisplaySchema,
  assignments: resolvedRoleAssignmentsSchema,
  legacySource: legacyGrantSourceSchema.nullable(),
});
export const memberListResponseSchema = peoplePageSchema(memberSchema);
export const roleListResponseSchema = peoplePageSchema(roleDefinitionSchema);
export const eligibleRoleSchema = z
  .strictObject({
    role: roleDefinitionSchema,
    allowedScopes: z
      .array(z.enum(['company', 'units']))
      .min(1)
      .max(2)
      .refine(uniqueValues),
  })
  .refine(
    (value) =>
      !value.allowedScopes.includes('units') ||
      !value.role.permissions.some((permission) => COMPANY_ONLY_PERMISSIONS.includes(permission)),
  );
export const eligibleRolesResponseSchema = peoplePageSchema(eligibleRoleSchema);

export const permissionCatalogSchema = z
  .strictObject({
    organizationRevision: accessRevisionSchema.optional(),
    grantableCompanyPermissions: z
      .array(peoplePermissionSchema)
      .max(PEOPLE_PERMISSIONS.length)
      .refine(uniqueValues)
      .optional(),
    catalogVersion: z.literal(PEOPLE_CATALOG_VERSION),
    permissions: z
      .array(
        z.strictObject({
          id: peoplePermissionSchema,
          applicability: z.enum(['scope_neutral', 'company_only', 'scope_aware']),
          implies: z.array(peoplePermissionSchema).max(2).refine(uniqueValues),
        }),
      )
      .length(PEOPLE_PERMISSIONS.length),
    starters: z.array(roleDefinitionSchema).length(4),
  })
  .superRefine((catalog, context) => {
    if (
      !uniqueValues(catalog.permissions.map((permission) => permission.id)) ||
      !uniqueValues(catalog.starters.map((role) => role.systemKey)) ||
      catalog.starters.some((role) => role.systemKey === null)
    )
      context.addIssue({
        code: 'custom',
        message: 'Catalog must contain each action and starter once',
      });
    for (const permission of catalog.permissions) {
      const applicability =
        permission.id === 'turnstile:access'
          ? 'scope_neutral'
          : COMPANY_ONLY_PERMISSIONS.includes(permission.id)
            ? 'company_only'
            : 'scope_aware';
      const implies =
        permission.id === 'turnstile:configuration:manage'
          ? ['turnstile:units:read', 'turnstile:units:manage']
          : permission.id === 'turnstile:units:manage'
            ? ['turnstile:units:read']
            : [];
      if (
        permission.applicability !== applicability ||
        permission.implies.length !== implies.length ||
        permission.implies.some((id) => !implies.includes(id))
      )
        context.addIssue({
          code: 'custom',
          message: 'Catalog applicability/implications disagree',
        });
    }
  });

export const scopedUnitSchema = z
  .strictObject({
    id: canonicalPeopleIdSchema,
    type: z.enum(['site', 'department']),
    parentId: canonicalPeopleIdSchema,
    name: canonicalUnitNameSchema,
    ancestorIds: z
      .array(canonicalPeopleIdSchema)
      .min(1)
      .max(CONFIGURATION_LIMITS.depth - 1)
      .refine(uniqueValues),
  })
  .refine(
    (unit) =>
      !unit.ancestorIds.includes(unit.id) &&
      unit.ancestorIds.at(-1) === unit.parentId &&
      (unit.type !== 'site' || unit.ancestorIds.length === 1),
  );
export const unitAncestorContextSchema = z.discriminatedUnion('type', [
  z.strictObject({
    id: canonicalPeopleIdSchema,
    type: z.literal('organization'),
    name: canonicalOrganizationNameSchema,
    actionable: z.literal(false),
  }),
  z.strictObject({
    id: canonicalPeopleIdSchema,
    type: z.enum(['site', 'department']),
    name: canonicalUnitNameSchema,
    actionable: z.literal(false),
  }),
]);
export const scopedUnitsResponseSchema = z
  .strictObject({
    revision: accessRevisionSchema,
    accessRevision: accessRevisionSchema,
    units: z.array(scopedUnitSchema).max(100),
    ancestors: z.array(unitAncestorContextSchema).max(CONFIGURATION_LIMITS.units),
    nextCursor: z.string().min(1).max(2048).nullable(),
    total: z.number().int().min(0).max(CONFIGURATION_LIMITS.units),
  })
  .superRefine((value, context) => {
    const rows = [...value.units, ...value.ancestors];
    const referenced = new Set(value.units.flatMap((unit) => unit.ancestorIds));
    if (
      !uniqueValues(rows.map((row) => row.id)) ||
      value.total < value.units.length ||
      rows.length > CONFIGURATION_LIMITS.units ||
      [...referenced].some((id) => !rows.some((row) => row.id === id)) ||
      value.ancestors.some((row) => !referenced.has(row.id))
    )
      context.addIssue({ code: 'custom', message: 'Invalid scoped rows/context/total' });
  });
export const scopedUnitContextSchema = z
  .strictObject({
    unit: scopedUnitSchema,
    ancestors: z.array(unitAncestorContextSchema).max(CONFIGURATION_LIMITS.depth - 1),
  })
  .refine(
    (value) =>
      uniqueValues(value.ancestors.map((row) => row.id)) &&
      value.ancestors.length === value.unit.ancestorIds.length &&
      value.ancestors.every((row, index) => row.id === value.unit.ancestorIds[index]),
  );
export const scopedUnitDetailSchema = scopedUnitContextSchema.safeExtend({
  revision: accessRevisionSchema,
  accessRevision: accessRevisionSchema,
});

export const userAccessContextSchema = z
  .strictObject({
    catalogVersion: z.literal(PEOPLE_CATALOG_VERSION),
    accessRevision: accessRevisionSchema,
    fingerprint: peopleDigestSchema,
    grants: z
      .array(
        z
          .strictObject({
            sourceId: canonicalPeopleIdSchema,
            permissions: z
              .array(peoplePermissionSchema)
              .max(PEOPLE_PERMISSIONS.length)
              .refine(uniqueValues),
            scope: assignmentScopeSchema,
          })
          .refine(
            (grant) =>
              grant.scope.kind === 'company' ||
              !grant.permissions.some((permission) =>
                COMPANY_ONLY_PERMISSIONS.includes(permission),
              ),
          ),
      )
      .max(33),
  })
  .refine(
    (value) =>
      uniqueValues(value.grants.map((grant) => grant.sourceId)) &&
      value.grants.reduce(
        (count, grant) => count + (grant.scope.kind === 'units' ? grant.scope.unitIds.length : 0),
        0,
      ) <= 64,
    'Duplicate grant pairs',
  );
export const accessAwareUserSessionSchema = z
  .strictObject({
    user: z.strictObject({
      id: peopleSubjectSchema,
      name: z.string().max(200),
      email: z.email().max(254),
    }),
    permissions: z
      .array(peoplePermissionSchema)
      .max(PEOPLE_PERMISSIONS.length)
      .refine(uniqueValues),
    session: z.strictObject({ expiresAt: peopleInstantSchema, idleExpiresAt: peopleInstantSchema }),
    csrfToken: peopleSecretSchema,
    access: userAccessContextSchema,
  })
  .refine((value) => {
    const names = new Set(value.access.grants.flatMap((grant) => grant.permissions));
    if (names.has('turnstile:configuration:manage')) names.add('turnstile:units:manage');
    if (names.has('turnstile:units:manage')) names.add('turnstile:units:read');
    return (
      names.has('turnstile:access') &&
      names.size === value.permissions.length &&
      value.permissions.every((permission) => names.has(permission)) &&
      Date.parse(value.session.idleExpiresAt) <= Date.parse(value.session.expiresAt)
    );
  }, 'Shell entry or session expiry invalid');

export const accessSchemas = {
  PermissionCatalog: permissionCatalogSchema,
  RoleDefinition: roleDefinitionSchema,
  AssignmentScope: assignmentScopeSchema,
  RoleAssignmentRequest: roleAssignmentRequestSchema,
  RoleAssignmentRequests: roleAssignmentRequestsSchema,
  ResolvedRoleAssignment: resolvedRoleAssignmentSchema,
  ResolvedRoleAssignments: resolvedRoleAssignmentsSchema,
  LegacyGrantSource: legacyGrantSourceSchema,
  Member: memberSchema,
  MemberListResponse: memberListResponseSchema,
  RoleListResponse: roleListResponseSchema,
  EligibleRolesResponse: eligibleRolesResponseSchema,
  ScopedUnit: scopedUnitSchema,
  UnitAncestorContext: unitAncestorContextSchema,
  ScopedUnitsResponse: scopedUnitsResponseSchema,
  ScopedUnitDetail: scopedUnitDetailSchema,
  ScopedUnitContext: scopedUnitContextSchema,
  UserAccessContext: userAccessContextSchema,
  AccessAwareUserSession: accessAwareUserSessionSchema,
};
export type AssignmentScopeDto = z.infer<typeof assignmentScopeSchema>;
export type RoleDefinitionDto = z.infer<typeof roleDefinitionSchema>;
export type RoleAssignmentRequestDto = z.infer<typeof roleAssignmentRequestSchema>;
export type ResolvedRoleAssignmentDto = z.infer<typeof resolvedRoleAssignmentSchema>;
export type MemberDto = z.infer<typeof memberSchema>;
export type UserAccessContextDto = z.infer<typeof userAccessContextSchema>;
export type AccessAwareUserSessionDto = z.infer<typeof accessAwareUserSessionSchema>;
