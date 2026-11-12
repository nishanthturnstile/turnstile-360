import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgPolicy,
  pgRole,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { installation, productSchema } from '../../infrastructure/database/installation.schema.js';
import { organizationUnit } from '../organization/persistence/organization.schema.js';

const tenant = () =>
  uuid('tenant_id')
    .notNull()
    .references(() => installation.tenantId);
const policy = (column: AnyPgColumn) =>
  pgPolicy('tenant_isolation', {
    for: 'all',
    to: [
      pgRole('thaarei_turnstile_runtime').existing(),
      pgRole('thaarei_turnstile_migrator').existing(),
    ],
    using: sql`${column} = nullif(current_setting('app.tenant_id', true), '')::uuid`,
    withCheck: sql`${column} = nullif(current_setting('app.tenant_id', true), '')::uuid`,
  });
const version = (column: AnyPgColumn) => sql`${column} BETWEEN 1 AND 2147483647`;
const instant = (name: string) =>
  timestamp(name, { withTimezone: true }).notNull().default(sql`statement_timestamp()`);

// The absence of this row is the pre-import state. Creating it is an explicit,
// private, atomic cutover; application startup never initializes access data.
export const accessContext = productSchema
  .table(
    'access_context',
    {
      tenantId: tenant().primaryKey(),
      modelVersion: integer('model_version').notNull().default(1),
      publicWritesEnabled: boolean('public_writes_enabled').notNull().default(false),
      releaseVersion: integer('release_version').notNull().default(1),
      releaseId: text('release_id'),
      recoveryEpoch: text('recovery_epoch'),
      releasedBy: text('released_by'),
      releasedAt: timestamp('released_at', { withTimezone: true }),
      revision: integer().notNull().default(0),
      initializedBy: text('initialized_by').notNull(),
      initializedAt: instant('initialized_at'),
    },
    (t) => [
      policy(t.tenantId),
      check('access_model_version', sql`${t.modelVersion} = 1 AND ${t.releaseVersion} = 1`),
      check(
        'access_release_state',
        sql`(${t.releaseId} IS NULL OR ${t.releaseId} ~ '^[0-9a-f]{64}$') AND (${t.recoveryEpoch} IS NULL OR ${t.recoveryEpoch} ~ '^[0-9a-f]{64}$') AND (${t.releasedBy} IS NULL OR ${t.releasedBy} ~ '^[A-Za-z0-9_-]{1,200}$') AND (NOT ${t.publicWritesEnabled} OR (${t.releaseId} IS NOT NULL AND ${t.recoveryEpoch} IS NOT NULL AND ${t.releasedBy} IS NOT NULL AND ${t.releasedAt} IS NOT NULL))`,
      ),
      check('access_revision', sql`${t.revision} BETWEEN 0 AND 2147483647`),
      check('access_initializer', sql`${t.initializedBy} ~ '^[A-Za-z0-9_-]{1,200}$'`),
    ],
  )
  .enableRLS();

export const accessMember = productSchema
  .table(
    'access_member',
    {
      tenantId: tenant(),
      id: uuid().notNull(),
      userId: text('user_id').notNull(),
      version: integer().notNull().default(1),
      status: text().notNull(),
    },
    (t) => [
      primaryKey({ columns: [t.tenantId, t.id] }),
      policy(t.tenantId),
      uniqueIndex('access_member_subject_idx').on(t.tenantId, t.userId),
      check('access_member_subject', sql`${t.userId} ~ '^[A-Za-z0-9_-]{1,200}$'`),
      check('access_member_version', version(t.version)),
      check('access_member_status', sql`${t.status} IN ('active','suspended')`),
    ],
  )
  .enableRLS();

export const accessLegacySource = productSchema
  .table(
    'access_legacy_source',
    {
      tenantId: tenant(),
      memberId: uuid('member_id').notNull(),
      id: uuid().notNull(),
      version: integer().notNull().default(1),
      permissions: text().array().notNull(),
      retired: boolean().notNull().default(false),
      importedAt: instant('imported_at'),
    },
    (t) => [
      primaryKey({ columns: [t.tenantId, t.memberId] }),
      policy(t.tenantId),
      uniqueIndex('access_legacy_source_id_idx').on(t.tenantId, t.id),
      foreignKey({
        columns: [t.tenantId, t.memberId],
        foreignColumns: [accessMember.tenantId, accessMember.id],
      }),
      check('access_legacy_version', version(t.version)),
      check(
        'access_legacy_permissions',
        sql`cardinality(${t.permissions}) <= 3 AND array_position(${t.permissions},NULL) IS NULL AND ${t.permissions} <@ ARRAY['turnstile:access','turnstile:dms:capabilities:read','turnstile:configuration:manage']::text[]`,
      ),
    ],
  )
  .enableRLS();

export const accessRole = productSchema
  .table(
    'access_role',
    {
      tenantId: tenant(),
      id: uuid().notNull(),
      systemKey: text('system_key'),
      name: text().notNull(),
      nameKey: text('name_key').notNull(),
      description: text(),
      version: integer().notNull().default(1),
      permissionVersion: integer('permission_version').notNull().default(1),
    },
    (t) => [
      primaryKey({ columns: [t.tenantId, t.id] }),
      policy(t.tenantId),
      uniqueIndex('access_role_name_idx').on(t.tenantId, sql`${t.nameKey} COLLATE "C"`),
      uniqueIndex('access_role_system_idx').on(t.tenantId, t.systemKey),
      check(
        'access_role_version',
        sql`${version(t.version)} AND ${t.permissionVersion} BETWEEN 1 AND ${t.version}`,
      ),
      check(
        'access_role_system',
        sql`${t.systemKey} IS NULL OR ${t.systemKey} IN ('workspace_administrator','configuration_manager','unit_manager','member')`,
      ),
      check(
        'access_role_name',
        sql`char_length(${t.name}) BETWEEN 1 AND 80 AND char_length(${t.nameKey}) BETWEEN 1 AND 160`,
      ),
      check(
        'access_role_description',
        sql`${t.description} IS NULL OR char_length(${t.description}) BETWEEN 1 AND 500`,
      ),
    ],
  )
  .enableRLS();

export const accessRolePermission = productSchema
  .table(
    'access_role_permission',
    {
      tenantId: tenant(),
      roleId: uuid('role_id').notNull(),
      permission: text().notNull(),
    },
    (t) => [
      primaryKey({ columns: [t.tenantId, t.roleId, t.permission] }),
      policy(t.tenantId),
      foreignKey({
        columns: [t.tenantId, t.roleId],
        foreignColumns: [accessRole.tenantId, accessRole.id],
      }),
      check(
        'access_permission_catalog',
        sql`${t.permission} IN ('turnstile:access','turnstile:dms:capabilities:read','turnstile:configuration:manage','turnstile:people:manage','turnstile:roles:manage','turnstile:units:read','turnstile:units:manage','turnstile:incidents:read','turnstile:risks:read')`,
      ),
    ],
  )
  .enableRLS();

export const accessAssignment = productSchema
  .table(
    'access_assignment',
    {
      tenantId: tenant(),
      id: uuid().notNull(),
      memberId: uuid('member_id').notNull(),
      roleId: uuid('role_id').notNull(),
      scopeKind: text('scope_kind').notNull(),
      includeChildren: boolean('include_children').notNull(),
      scopeKey: text('scope_key').notNull(),
    },
    (t) => [
      primaryKey({ columns: [t.tenantId, t.id] }),
      policy(t.tenantId),
      foreignKey({
        columns: [t.tenantId, t.memberId],
        foreignColumns: [accessMember.tenantId, accessMember.id],
      }),
      foreignKey({
        columns: [t.tenantId, t.roleId],
        foreignColumns: [accessRole.tenantId, accessRole.id],
      }),
      uniqueIndex('access_assignment_scope_idx').on(t.tenantId, t.memberId, t.roleId, t.scopeKey),
      index('access_assignment_role_idx').on(t.tenantId, t.roleId),
      check(
        'access_assignment_scope',
        // units:false: + sixteen UUIDs + fifteen commas = 603 characters.
        sql`(${t.scopeKind} = 'company' AND NOT ${t.includeChildren} AND ${t.scopeKey} = 'company') OR (${t.scopeKind} = 'units' AND char_length(${t.scopeKey}) BETWEEN 43 AND 603)`,
      ),
    ],
  )
  .enableRLS();

export const accessScopeAnchor = productSchema
  .table(
    'access_scope_anchor',
    {
      tenantId: tenant(),
      assignmentId: uuid('assignment_id').notNull(),
      unitId: uuid('unit_id').notNull(),
    },
    (t) => [
      primaryKey({ columns: [t.tenantId, t.assignmentId, t.unitId] }),
      policy(t.tenantId),
      foreignKey({
        columns: [t.tenantId, t.assignmentId],
        foreignColumns: [accessAssignment.tenantId, accessAssignment.id],
      }).onDelete('cascade'),
      foreignKey({
        columns: [t.tenantId, t.unitId],
        foreignColumns: [organizationUnit.tenantId, organizationUnit.id],
      }),
      index('access_scope_unit_idx').on(t.tenantId, t.unitId),
    ],
  )
  .enableRLS();

export const accessCommandReceipt = productSchema
  .table(
    'access_command_receipt',
    {
      tenantId: tenant(),
      actorId: text('actor_id').notNull(),
      key: uuid().notNull(),
      operation: text().notNull(),
      digest: text().notNull(),
      subjectId: uuid('subject_id'),
      scopeParentId: uuid('scope_parent_id'),
      peopleChanged: boolean('people_changed'),
      organizationRevisionAfter: integer('organization_revision_after'),
      accessRevisionAfter: integer('access_revision_after'),
      createdAt: instant('created_at'),
      expiresAt: timestamp('expires_at', { withTimezone: true })
        .notNull()
        .default(sql`statement_timestamp() + interval '24 hours'`),
    },
    (t) => [
      primaryKey({ columns: [t.tenantId, t.actorId, t.key] }),
      policy(t.tenantId),
      check('access_receipt_actor', sql`${t.actorId} ~ '^[A-Za-z0-9_-]{1,200}$'`),
      check('access_receipt_digest', sql`${t.digest} ~ '^[0-9a-f]{64}$'`),
      check(
        'access_receipt_operation',
        sql`${t.operation} IN ('legacy.replace','legacy.retire','administrator.bootstrap','administrator.handover','member.assignments','member.suspend','member.reactivate','role.create','role.patch','role.delete','invitation.issue','invitation.resend','invitation.cancel','invitation.reapprove','unit.create','unit.rename','unit.delete','unit.move','release.open','release.close','release.recover','module.grant','module.revoke')`,
      ),
      check(
        'access_receipt_structure_revisions',
        sql`(${t.organizationRevisionAfter} IS NULL AND ${t.accessRevisionAfter} IS NULL) OR (${t.operation} IN ('unit.create','unit.rename','unit.delete','unit.move') AND ${t.organizationRevisionAfter} IS NOT NULL AND ${t.accessRevisionAfter} IS NOT NULL AND ${t.organizationRevisionAfter} >= 0 AND ${t.accessRevisionAfter} >= 0)`,
      ),
      check('access_receipt_window', sql`${t.expiresAt} = ${t.createdAt} + interval '24 hours'`),
      index('access_receipt_expiry_idx').on(t.tenantId, t.expiresAt),
    ],
  )
  .enableRLS();

export const accessImpactReceipt = productSchema
  .table(
    'access_impact_receipt',
    {
      tenantId: tenant(),
      id: uuid().notNull(),
      actorId: text('actor_id').notNull(),
      tokenHash: text('token_hash').notNull(),
      commandDigest: text('command_digest').notNull(),
      actorFingerprint: text('actor_fingerprint').notNull(),
      accessRevision: integer('access_revision').notNull(),
      organizationRevision: integer('organization_revision'),
      createdAt: instant('created_at'),
      expiresAt: timestamp('expires_at', { withTimezone: true })
        .notNull()
        .default(sql`statement_timestamp() + interval '5 minutes'`),
    },
    (t) => [
      primaryKey({ columns: [t.tenantId, t.id] }),
      policy(t.tenantId),
      uniqueIndex('access_impact_token_idx').on(t.tenantId, t.tokenHash),
      check('access_impact_actor', sql`${t.actorId} ~ '^[A-Za-z0-9_-]{1,200}$'`),
      check(
        'access_impact_digests',
        sql`${t.tokenHash} ~ '^[0-9a-f]{64}$' AND ${t.commandDigest} ~ '^[0-9a-f]{64}$' AND ${t.actorFingerprint} ~ '^[0-9a-f]{64}$'`,
      ),
      check(
        'access_impact_revisions',
        sql`${t.accessRevision} >= 0 AND (${t.organizationRevision} IS NULL OR ${t.organizationRevision} >= 0)`,
      ),
      check('access_impact_window', sql`${t.expiresAt} = ${t.createdAt} + interval '5 minutes'`),
      index('access_impact_expiry_idx').on(t.tenantId, t.expiresAt),
    ],
  )
  .enableRLS();

export const accessAudit = productSchema
  .table(
    'access_audit',
    {
      tenantId: tenant(),
      id: uuid().notNull(),
      actorKind: text('actor_kind').notNull(),
      actorId: text('actor_id').notNull(),
      requestId: uuid('request_id').notNull(),
      action: text().notNull(),
      subjectId: uuid('subject_id'),
      subjectUserId: text('subject_user_id'),
      revisionBefore: integer('revision_before').notNull(),
      revisionAfter: integer('revision_after').notNull(),
      occurredAt: instant('occurred_at'),
    },
    (t) => [
      primaryKey({ columns: [t.tenantId, t.id] }),
      pgPolicy('operator_tenant', {
        for: 'all',
        to: pgRole('thaarei_turnstile_migrator').existing(),
        using: sql`${t.tenantId} = nullif(current_setting('app.tenant_id', true), '')::uuid`,
        withCheck: sql`${t.tenantId} = nullif(current_setting('app.tenant_id', true), '')::uuid`,
      }),
      pgPolicy('runtime_append_user', {
        for: 'insert',
        to: pgRole('thaarei_turnstile_runtime').existing(),
        withCheck: sql`${t.tenantId} = nullif(current_setting('app.tenant_id', true), '')::uuid AND ${t.actorKind} = 'user'`,
      }),
      check(
        'access_audit_actor',
        sql`${t.actorKind} IN ('operator','user') AND ${t.actorId} ~ '^[A-Za-z0-9_-]{1,200}$'`,
      ),
      check(
        'access_audit_subject',
        sql`${t.subjectUserId} IS NULL OR ${t.subjectUserId} ~ '^[A-Za-z0-9_-]{1,200}$'`,
      ),
      check(
        'access_audit_action',
        sql`${t.action} IN ('legacy_imported','legacy_replaced','legacy_retired','administrator_bootstrapped','administrator_handed_over','member_assignments_changed','member_suspended','member_reactivated','role_created','role_details_changed','role_permissions_changed','role_deleted','unit_coverage_changed','invitation_changed','release_opened','release_closed','release_recovered')`,
      ),
      check(
        'access_audit_operator',
        sql`${t.action} NOT IN ('legacy_imported','legacy_replaced','administrator_bootstrapped','administrator_handed_over','release_opened','release_closed','release_recovered') OR ${t.actorKind} = 'operator'`,
      ),
      check(
        'access_audit_revisions',
        sql`${t.revisionBefore} >= 0 AND ${t.revisionAfter}::bigint = ${t.revisionBefore}::bigint + 1`,
      ),
      index('access_audit_time_idx').on(t.tenantId, t.occurredAt, t.id),
    ],
  )
  .enableRLS();
