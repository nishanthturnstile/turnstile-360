import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
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
import {
  installation,
  productSchema,
} from '../../../infrastructure/database/installation.schema.js';

const operator = pgRole('thaarei_turnstile_migrator').existing();
const runtime = pgRole('thaarei_turnstile_runtime').existing();
const tenantPolicy = (tenant: AnyPgColumn) =>
  pgPolicy('tenant_isolation', {
    for: 'all',
    to: [operator, runtime],
    using: sql`${tenant} = nullif(current_setting('app.tenant_id', true), '')::uuid`,
    withCheck: sql`${tenant} = nullif(current_setting('app.tenant_id', true), '')::uuid`,
  });

export const organizationConfiguration = productSchema
  .table(
    'organization_configuration',
    {
      tenantId: uuid('tenant_id')
        .primaryKey()
        .references(() => installation.tenantId),
      revision: integer().notNull().default(0),
      name: text(),
      timeZone: text('time_zone'),
      rootId: uuid('root_id'),
      requirementVersion: integer('requirement_version').notNull().default(2),
      completedAt: timestamp('completed_at', { withTimezone: true }),
      completedBy: text('completed_by'),
    },
    (table) => [
      tenantPolicy(table.tenantId),
      foreignKey({
        name: 'configuration_root_fk',
        columns: [table.tenantId, table.rootId],
        foreignColumns: [organizationUnit.tenantId, organizationUnit.id],
      }),
      check(
        'configuration_revision_bound',
        sql`${table.revision} >= 0 AND ${table.revision} <= 2147483647`,
      ),
      check(
        'configuration_name_bound',
        sql`${table.name} IS NULL OR char_length(${table.name}) BETWEEN 1 AND 160`,
      ),
      check(
        'configuration_zone_bound',
        sql`${table.timeZone} IS NULL OR (octet_length(${table.timeZone}) = char_length(${table.timeZone}) AND char_length(${table.timeZone}) BETWEEN 1 AND 100)`,
      ),
      check('configuration_root_pair', sql`(${table.name} IS NULL) = (${table.rootId} IS NULL)`),
      check('configuration_version', sql`${table.requirementVersion} IN (1, 2)`),
      check(
        'configuration_completion',
        sql`(${table.completedAt} IS NULL AND ${table.completedBy} IS NULL) OR (${table.completedAt} IS NOT NULL AND ${table.completedBy} IS NOT NULL AND ${table.completedBy} ~ '^[A-Za-z0-9_-]{1,200}$' AND ${table.name} IS NOT NULL AND ${table.timeZone} IS NOT NULL AND ${table.rootId} IS NOT NULL AND ${table.revision} > 0)`,
      ),
    ],
  )
  .enableRLS();

export const organizationUnit = productSchema
  .table(
    'organization_unit',
    {
      tenantId: uuid('tenant_id')
        .notNull()
        .references((): AnyPgColumn => organizationConfiguration.tenantId),
      id: uuid().notNull(),
      type: text().notNull(),
      parentId: uuid('parent_id'),
      // Root display is derived from organization_configuration.name, not a second profile field.
      name: text(),
      nameKey: text('name_key'),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      foreignKey({
        name: 'organization_unit_parent_fk',
        columns: [table.tenantId, table.parentId],
        foreignColumns: [table.tenantId, table.id],
      }),
      tenantPolicy(table.tenantId),
      check('unit_type', sql`${table.type} IN ('organization', 'site', 'department')`),
      check(
        'unit_shape',
        sql`(${table.type} = 'organization' AND ${table.parentId} IS NULL AND ${table.name} IS NULL AND ${table.nameKey} IS NULL) OR (${table.type} IN ('site', 'department') AND ${table.parentId} IS NOT NULL AND ${table.parentId} <> ${table.id} AND ${table.name} IS NOT NULL AND char_length(${table.name}) BETWEEN 1 AND 120 AND ${table.nameKey} IS NOT NULL AND char_length(${table.nameKey}) BETWEEN 1 AND 240)`,
      ),
      uniqueIndex('organization_one_root_idx')
        .on(table.tenantId)
        .where(sql`${table.type} = 'organization'`),
      uniqueIndex('organization_sibling_name_idx').on(
        table.tenantId,
        table.parentId,
        sql`${table.nameKey} COLLATE "C"`,
      ),
    ],
  )
  .enableRLS();

export const configurationCreateReceipt = productSchema
  .table(
    'configuration_create_receipt',
    {
      tenantId: uuid('tenant_id')
        .notNull()
        .references(() => organizationConfiguration.tenantId),
      key: uuid().notNull(),
      actorId: text('actor_id').notNull(),
      fingerprint: text().notNull(),
      unitId: uuid('unit_id').notNull(),
      createdAt: timestamp('created_at', { withTimezone: true })
        .notNull()
        .default(sql`statement_timestamp()`),
      // Immutable migration window; keep aligned with CONFIGURATION_LIMITS.createReceiptSeconds.
      expiresAt: timestamp('expires_at', { withTimezone: true })
        .notNull()
        .default(sql`statement_timestamp() + interval '24 hours'`),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.key] }),
      // Separate policies prevent runtime deletion of live recovery receipts.
      pgPolicy('operator_tenant', {
        for: 'all',
        to: operator,
        using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '')::uuid`,
        withCheck: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '')::uuid`,
      }),
      pgPolicy('runtime_read', {
        for: 'select',
        to: runtime,
        using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '')::uuid`,
      }),
      pgPolicy('runtime_insert', {
        for: 'insert',
        to: runtime,
        withCheck: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '')::uuid`,
      }),
      pgPolicy('runtime_expired_delete', {
        for: 'delete',
        to: runtime,
        using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '')::uuid AND ${table.expiresAt} <= statement_timestamp()`,
      }),
      check('receipt_actor_bound', sql`${table.actorId} ~ '^[A-Za-z0-9_-]{1,200}$'`),
      check('receipt_fingerprint_bound', sql`${table.fingerprint} ~ '^[0-9a-f]{64}$'`),
      check('receipt_window', sql`${table.expiresAt} = ${table.createdAt} + interval '24 hours'`),
      index('configuration_receipt_expiry_idx').on(table.tenantId, table.expiresAt),
    ],
  )
  .enableRLS();

export const configurationAudit = productSchema
  .table(
    'configuration_audit',
    {
      tenantId: uuid('tenant_id')
        .notNull()
        .references(() => organizationConfiguration.tenantId),
      id: uuid().notNull(),
      actorKind: text('actor_kind').notNull(),
      actorId: text('actor_id').notNull(),
      requestId: uuid('request_id').notNull(),
      action: text().notNull(),
      subjectId: uuid('subject_id').notNull(),
      subjectUserId: text('subject_user_id'),
      changedFields: text('changed_fields').array().notNull(),
      revisionBefore: integer('revision_before'),
      revisionAfter: integer('revision_after').notNull(),
      occurredAt: timestamp('occurred_at', { withTimezone: true })
        .notNull()
        .default(sql`statement_timestamp()`),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.id] }),
      tenantPolicy(table.tenantId),
      check(
        'audit_actor_bound',
        sql`${table.actorKind} IN ('user', 'operator') AND ${table.actorId} ~ '^[A-Za-z0-9_-]{1,200}$'`,
      ),
      check(
        'audit_action',
        sql`${table.action} IN ('initialized', 'profile_saved', 'unit_created', 'unit_renamed', 'unit_moved', 'unit_deleted', 'setup_completed', 'access_changed')`,
      ),
      check(
        'audit_fields',
        sql`cardinality(${table.changedFields}) <= 6 AND ${table.changedFields} <@ ARRAY['name','timeZone','type','parentId','completion','permissions','enabled']::text[]`,
      ),
      check(
        'audit_subject_user',
        sql`(${table.action} = 'access_changed' AND ${table.actorKind} = 'operator' AND ${table.subjectUserId} IS NOT NULL AND ${table.subjectUserId} ~ '^[A-Za-z0-9_-]{1,200}$') OR (${table.action} <> 'access_changed' AND ${table.subjectUserId} IS NULL)`,
      ),
      check(
        'audit_revisions',
        sql`(${table.revisionBefore} IS NULL OR ${table.revisionBefore} >= 0) AND ${table.revisionAfter} >= 0`,
      ),
      index('configuration_audit_time_idx').on(table.tenantId, table.occurredAt, table.id),
    ],
  )
  .enableRLS();
