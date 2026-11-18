import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  jsonb,
  pgPolicy,
  pgRole,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { installation, productSchema } from '../../infrastructure/database/installation.schema.js';

const instant = (name: string) => timestamp(name, { withTimezone: true });
const tenant = sql`tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid`;

export const documentsIntent = productSchema
  .table(
    'documents_intent',
    {
      tenantId: uuid('tenant_id').notNull(),
      id: uuid().notNull(),
      actorId: text('actor_id').notNull(),
      recoveryMarker: text('recovery_marker').notNull(),
      kind: text().notNull(),
      digest: text().notNull(),
      subjectKey: text('subject_key').notNull(),
      command: jsonb(),
      state: text().notNull().default('DRAFT'),
      createdAt: instant('created_at').notNull().defaultNow(),
      reconciliationUntil: instant('reconciliation_until'),
      leaseUntil: instant('lease_until'),
      attemptId: uuid('attempt_id'),
      terminalAt: instant('terminal_at'),
      resolvedAt: instant('resolved_at'),
      uploadId: uuid('upload_id'),
      batchId: uuid('batch_id'),
      mode: text().notNull().default('ordinary'),
      documentId: uuid('document_id'),
      versionId: uuid('version_id'),
      runId: uuid('run_id'),
      disposition: jsonb(),
    },
    (t) => [
      primaryKey({ columns: [t.tenantId, t.id] }),
      foreignKey({ columns: [t.tenantId], foreignColumns: [installation.tenantId] }),
      index('documents_intent_actor_history').on(
        t.tenantId,
        t.actorId,
        t.createdAt.desc(),
        t.id.desc(),
      ),
      index('documents_intent_active_subject')
        .on(t.tenantId, t.kind, t.subjectKey)
        .where(sql`state IN ('DRAFT','DISPATCHING','UNCERTAIN','UNRESOLVED_REQUIRES_REVIEW')`),
      index('documents_intent_binding')
        .on(t.tenantId, t.uploadId)
        .where(
          sql`kind IN ('upload.begin','version.begin','version.restore','batch.item') AND state='RESOLVED'`,
        ),
      uniqueIndex('documents_intent_created_batch')
        .on(t.tenantId, t.batchId)
        .where(sql`kind='batch.create' AND state='RESOLVED'`),
      pgPolicy('installation_isolation', {
        for: 'all',
        to: [
          pgRole('thaarei_turnstile_runtime').existing(),
          pgRole('thaarei_turnstile_migrator').existing(),
        ],
        using: tenant,
        withCheck: tenant,
      }),
      pgPolicy('documents_intent_runtime_prune', {
        as: 'restrictive',
        for: 'delete',
        to: pgRole('thaarei_turnstile_runtime').existing(),
        using: sql`(state='DRAFT' AND created_at<=statement_timestamp()-interval '1 day')
          OR (state IN ('RESOLVED','DISPOSED') AND resolved_at<=statement_timestamp()-interval '90 days')`,
      }),
      check(
        'documents_intent_shape',
        sql`
    length(actor_id) BETWEEN 1 AND 200 AND digest ~ '^[0-9a-f]{64}$'
    AND recovery_marker ~ '^[0-9a-f]{64}$' AND subject_key ~ '^[0-9a-f]{64}$'
    AND kind IN ('upload.begin','upload.complete','upload.refresh','upload.cancel','version.begin','version.restore','document.edit','reference.link','reference.unlink','batch.create','batch.item','batch.close','batch.cancel','document.delete','document.restore','permissions.replace','version.reprocess')
    AND (mode='ordinary' OR (mode='contribute' AND kind IN ('document.edit','reference.link','reference.unlink','version.begin','upload.complete','upload.refresh','upload.cancel')))
    AND ((document_id IS NOT NULL) = (kind IN ('document.delete','document.restore','version.reprocess')))
    AND ((version_id IS NOT NULL) = (kind='version.reprocess'))
    AND ((run_id IS NOT NULL) = (kind='version.reprocess' AND state='RESOLVED'))
    AND state IN ('DRAFT','DISPATCHING','UNCERTAIN','RESOLVED','UNRESOLVED_REQUIRES_REVIEW','DISPOSED')
    AND (command IS NULL OR (jsonb_typeof(command)='object' AND octet_length(command::text)<=CASE WHEN kind='batch.create' THEN 409600 ELSE 40960 END))
    AND (state NOT IN ('DRAFT','DISPATCHING','UNCERTAIN') OR command IS NOT NULL)
    AND ((state='DISPATCHING') = (attempt_id IS NOT NULL AND lease_until IS NOT NULL))
    AND ((state IN ('RESOLVED','UNRESOLVED_REQUIRES_REVIEW','DISPOSED')) = (terminal_at IS NOT NULL))
    AND ((state IN ('RESOLVED','DISPOSED')) = (resolved_at IS NOT NULL))
    AND (kind NOT IN ('batch.item','batch.close','batch.cancel') OR batch_id IS NOT NULL)
    AND (kind NOT IN ('batch.create','batch.close','batch.cancel') OR upload_id IS NULL)
    AND (kind LIKE 'batch.%' OR batch_id IS NULL)
    AND (state<>'RESOLVED' OR CASE
      WHEN kind IN ('batch.create','batch.close','batch.cancel') THEN batch_id IS NOT NULL
      WHEN kind='version.reprocess' THEN run_id IS NOT NULL AND upload_id IS NULL
      ELSE upload_id IS NOT NULL OR kind IN ('document.edit','reference.link','reference.unlink','document.delete','document.restore','permissions.replace') END)
  `,
      ),
    ],
  )
  .enableRLS();
