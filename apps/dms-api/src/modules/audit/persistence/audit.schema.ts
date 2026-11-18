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
import { document } from '../../documents/persistence/registry.schema.js';
import { uploadBatch } from '../../uploads/persistence/uploads.schema.js';

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
      actorKind: text('actor_kind').notNull().default('machine'),
      documentId: uuid('document_id'),
      batchId: uuid('batch_id'),
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
        sql`(${t.resourceType}='application' AND ${t.resourceId}=${t.applicationId} AND ${t.documentId} IS NULL AND ${t.batchId} IS NULL AND ${t.action}='application.enrolled' AND ${t.actorKind}='machine') OR (${t.resourceType}='document' AND ${t.documentId} IS NOT NULL AND ${t.batchId} IS NULL AND ${t.resourceId}=${t.documentId} AND ${t.action} IN ('document.admitted','admission.reconciled','upload.authorized','upload.completion-requested','upload.cancelled','upload.expired','upload.object-verified','upload.failed','work.queued','work.completed','work.recovered','work.cancelled','security.assessed','security.invalidated','document.published','document.download-authorized','document.soft-deleted','document.logical-restored','processing.requested','processing.promoted','processing.content-authorized','document.permissions-changed','document.version-restored','document.metadata-updated','document.reference-linked','document.reference-unlinked','disposal.requested','disposal.completed','document.purged') AND ${t.actorKind} IN ('machine','coordinator','operator')) OR (${t.resourceType}='upload-batch' AND ${t.batchId} IS NOT NULL AND ${t.documentId} IS NULL AND ${t.resourceId}=${t.batchId} AND ${t.action} IN ('batch.created','batch.closed','batch.cancelled','batch.expired') AND ${t.actorKind} IN ('machine','coordinator'))`,
      ),
      check(
        'audit_actor_bounds',
        sql`length(${t.actorId}) BETWEEN 1 AND 200 AND (${t.assertedHuman} IS NULL OR ${t.assertedHuman} ~ '^[A-Za-z0-9_.:@-]{1,128}$')`,
      ),
      foreignKey({
        columns: [t.tenantId, t.applicationId, t.documentId],
        foreignColumns: [document.tenantId, document.applicationId, document.id],
      }),
      foreignKey({
        columns: [t.tenantId, t.applicationId, t.batchId],
        foreignColumns: [uploadBatch.tenantId, uploadBatch.applicationId, uploadBatch.id],
      }),
      index('audit_document_page_idx').on(
        t.tenantId,
        t.applicationId,
        t.documentId,
        t.createdAt,
        t.id,
      ),
      pgPolicy('coordinator_insert', {
        for: 'insert',
        to: coordinator,
        withCheck: sql`${tenant} AND actor_kind='coordinator' AND actor_id='thaarei_dms_coordinator'`,
      }),
      index('audit_application_page_idx').on(t.tenantId, t.applicationId, t.createdAt, t.id),
      index('audit_operator_page_idx').on(t.tenantId, t.createdAt, t.id),
      pgPolicy('machine_read', { for: 'select', to: runtime, using: machine }),
      pgPolicy('machine_insert', {
        for: 'insert',
        to: runtime,
        withCheck: sql`${machine} AND actor_kind='machine' AND actor_id = current_setting('app.actor_id',true)`,
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
      check(
        'outbox_kind',
        sql`${t.kind} IN ('application.enrolled','document.admitted','admission.reconciled','upload.authorized','upload.completion-requested','upload.cancelled','upload.expired','upload.object-verified','upload.failed','work.queued','work.completed','work.recovered','work.cancelled','security.assessed','security.invalidated','document.published','document.download-authorized','document.soft-deleted','document.logical-restored','processing.requested','processing.promoted','processing.content-authorized','document.permissions-changed','document.version-restored','document.metadata-updated','document.reference-linked','document.reference-unlinked','batch.created','batch.closed','batch.cancelled','batch.expired','disposal.requested','disposal.completed','document.purged')`,
      ),
      index('outbox_pending_idx').on(t.tenantId, t.createdAt, t.id),
      pgPolicy('machine_insert', { for: 'insert', to: runtime, withCheck: machine }),
      pgPolicy('coordinator_insert', { for: 'insert', to: coordinator, withCheck: tenant }),
      pgPolicy('coordinator_read', { for: 'select', to: coordinator, using: tenant }),
      pgPolicy('maintenance', { for: 'all', to: migrator, using: tenant, withCheck: tenant }),
    ],
  )
  .enableRLS();
