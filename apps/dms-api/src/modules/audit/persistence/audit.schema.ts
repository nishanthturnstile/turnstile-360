import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  pgPolicy,
  pgRole,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { applicationRegistration, dmsSchema } from '../../access/persistence/dms.schema.js';

const runtime = pgRole('thaarei_dms_runtime').existing();
const operator = pgRole('thaarei_dms_operator').existing();
const migrator = pgRole('thaarei_dms_migrator').existing();
const coordinator = pgRole('thaarei_dms_coordinator').existing();
const tenant = sql`tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid`;
const machine = sql`${tenant} AND current_setting('app.principal_kind',true) = 'machine' AND application_id = nullif(current_setting('app.application_id',true),'')::uuid`;
export const auditEvent = dmsSchema
  .table(
    'audit_event',
    {
      id: uuid().primaryKey(),
      tenantId: uuid('tenant_id').notNull(),
      applicationId: uuid('application_id').notNull(),
      resourceId: uuid('resource_id').notNull(),
      resourceType: text('resource_type').notNull(),
      action: text().notNull(),
      actorId: text('actor_id').notNull(),
      assertedHuman: text('asserted_human'),
      requestId: uuid('request_id'),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      unique('audit_tenant_identity').on(t.tenantId, t.applicationId, t.id),
      foreignKey({
        columns: [t.tenantId, t.applicationId],
        foreignColumns: [applicationRegistration.tenantId, applicationRegistration.id],
      }),
      check(
        'audit_application_resource',
        sql`${t.resourceType} = 'application' AND ${t.resourceId} = ${t.applicationId} AND ${t.action} = 'application.enrolled'`,
      ),
      check(
        'audit_actor_bounds',
        sql`length(${t.actorId}) BETWEEN 1 AND 200 AND (${t.assertedHuman} IS NULL OR ${t.assertedHuman} ~ '^[A-Za-z0-9_.:@-]{1,128}$')`,
      ),
      index('audit_application_page_idx').on(t.tenantId, t.applicationId, t.createdAt, t.id),
      index('audit_operator_page_idx').on(t.tenantId, t.createdAt, t.id),
      pgPolicy('machine_read', { for: 'select', to: runtime, using: machine }),
      pgPolicy('machine_insert', {
        for: 'insert',
        to: runtime,
        withCheck: sql`${machine} AND actor_id = current_setting('app.actor_id',true)`,
      }),
      pgPolicy('operator_read', {
        for: 'select',
        to: operator,
        using: sql`${tenant} AND current_setting('app.principal_kind',true) = 'operator' AND EXISTS (SELECT 1 FROM dms.operator_authorization oa WHERE oa.tenant_id = audit_event.tenant_id AND oa.subject_id = current_setting('app.actor_id',true) AND oa.revoked_at IS NULL)`,
      }),
      pgPolicy('maintenance', { for: 'all', to: migrator, using: tenant, withCheck: tenant }),
    ],
  )
  .enableRLS();

// Identifier-only intent for the implemented enrollment change. Dispatch belongs to I07.
export const outboxIntent = dmsSchema
  .table(
    'outbox_intent',
    {
      id: uuid().primaryKey(),
      tenantId: uuid('tenant_id').notNull(),
      applicationId: uuid('application_id').notNull(),
      auditId: uuid('audit_id').notNull(),
      kind: text().notNull(),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      unique('outbox_audit_identity').on(t.tenantId, t.auditId),
      foreignKey({
        columns: [t.tenantId, t.applicationId, t.auditId],
        foreignColumns: [auditEvent.tenantId, auditEvent.applicationId, auditEvent.id],
      }),
      foreignKey({
        columns: [t.tenantId, t.applicationId],
        foreignColumns: [applicationRegistration.tenantId, applicationRegistration.id],
      }),
      check('outbox_kind', sql`${t.kind} = 'application.enrolled'`),
      index('outbox_pending_idx').on(t.tenantId, t.createdAt, t.id),
      pgPolicy('machine_insert', { for: 'insert', to: runtime, withCheck: machine }),
      pgPolicy('coordinator_read', { for: 'select', to: coordinator, using: tenant }),
      pgPolicy('maintenance', { for: 'all', to: migrator, using: tenant, withCheck: tenant }),
    ],
  )
  .enableRLS();
