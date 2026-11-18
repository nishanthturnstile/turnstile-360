import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgPolicy,
  pgRole,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { dmsSchema } from '../../access/persistence/dms.schema.js';
import { admission, documentVersion } from '../../documents/persistence/registry.schema.js';

const tenant = sql`tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid`;
export const processingRun = dmsSchema
  .table(
    'processing_run',
    {
      id: uuid().primaryKey(),
      tenantId: uuid('tenant_id').notNull(),
      applicationId: uuid('application_id').notNull(),
      documentId: uuid('document_id').notNull(),
      versionId: uuid('version_id').notNull(),
      uploadId: uuid('upload_id').notNull(),
      number: integer().notNull(),
      lifecycleGeneration: integer('lifecycle_generation').notNull(),
      profile: text().notNull(),
      sourceSha256: text('source_sha256').notNull(),
      state: text().notNull().default('QUEUED'),
      active: boolean().notNull().default(false),
      acceptedStageId: uuid('accepted_stage_id'),
      actorKind: text('actor_kind').notNull(),
      actorId: text('actor_id').notNull(),
      keyHash: text('key_hash'),
      requestHash: text('request_hash'),
      expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
      completedAt: timestamp('completed_at', { withTimezone: true }),
    },
    (t) => [
      unique('processing_run_tenant').on(t.tenantId, t.id),
      unique('processing_run_version_identity').on(t.tenantId, t.applicationId, t.uploadId, t.id),
      unique('processing_run_number').on(t.tenantId, t.versionId, t.number),
      unique('processing_run_receipt').on(
        t.tenantId,
        t.actorKind,
        t.actorId,
        t.versionId,
        t.keyHash,
      ),
      uniqueIndex('processing_one_active').on(t.tenantId, t.versionId).where(sql`${t.active}`),
      foreignKey({
        columns: [t.tenantId, t.applicationId, t.documentId, t.versionId],
        foreignColumns: [
          documentVersion.tenantId,
          documentVersion.applicationId,
          documentVersion.documentId,
          documentVersion.id,
        ],
      }),
      foreignKey({
        columns: [t.tenantId, t.applicationId, t.uploadId],
        foreignColumns: [admission.tenantId, admission.applicationId, admission.id],
      }),
      check(
        'processing_run_bounds',
        sql`${t.number}>0 AND ${t.lifecycleGeneration} BETWEEN 1 AND 2147483646 AND ${t.profile} IN ('searchable','structured') AND ${t.sourceSha256} ~ '^[a-f0-9]{64}$' AND ${t.state} IN ('QUEUED','RUNNING','SUCCEEDED','PARTIAL','FAILED','UNSUPPORTED','CANCELLED') AND ${t.actorKind} IN ('machine','operator','coordinator') AND length(${t.actorId}) BETWEEN 1 AND 200 AND (${t.keyHash} IS NULL OR ${t.keyHash} ~ '^[a-f0-9]{64}$') AND (${t.requestHash} IS NULL OR ${t.requestHash} ~ '^[a-f0-9]{64}$') AND (NOT ${t.active} OR (${t.acceptedStageId} IS NOT NULL AND ${t.state} IN ('SUCCEEDED','PARTIAL')))`,
      ),
      index('processing_history').on(t.tenantId, t.documentId, t.versionId, t.number),
      pgPolicy('maintenance', {
        for: 'all',
        to: pgRole('thaarei_dms_migrator').existing(),
        using: tenant,
        withCheck: tenant,
      }),
      pgPolicy('coordinator', {
        for: 'all',
        to: pgRole('thaarei_dms_coordinator').existing(),
        using: tenant,
        withCheck: tenant,
      }),
      pgPolicy('reader', {
        for: 'select',
        to: pgRole('thaarei_dms_runtime').existing(),
        using: sql`${tenant} AND dms.has_document_right(document_id,'READ') AND EXISTS(SELECT 1 FROM dms.document d WHERE d.id=document_id AND d.lifecycle='ACTIVE')`,
      }),
      pgPolicy('operator_read', {
        for: 'select',
        to: pgRole('thaarei_dms_operator').existing(),
        using: sql`${tenant} AND current_setting('app.principal_kind',true)='operator' AND EXISTS(SELECT 1 FROM dms.operator_authorization o WHERE o.tenant_id=processing_run.tenant_id AND o.subject_id=current_setting('app.actor_id',true) AND o.revoked_at IS NULL)`,
      }),
    ],
  )
  .enableRLS();
