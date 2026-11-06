import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgRole,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';
import { dmsSchema } from '../../access/persistence/dms.schema.js';
import {
  admission,
  document,
  documentVersion,
} from '../../documents/persistence/registry.schema.js';
import { securityCandidate } from '../../processing/persistence/assessment.schema.js';

const tenant = sql`tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid`;
const owner = sql`${tenant} AND current_setting('app.principal_kind',true)='machine' AND application_id=nullif(current_setting('app.application_id',true),'')::uuid`;
const operator = sql`${tenant} AND current_setting('app.principal_kind',true)='operator' AND EXISTS(SELECT 1 FROM dms.operator_authorization WHERE tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND subject_id=current_setting('app.actor_id',true) AND revoked_at IS NULL)`;
const policies = () => [
  pgPolicy('maintenance', {
    for: 'all',
    to: pgRole('thaarei_dms_migrator').existing(),
    using: tenant,
    withCheck: tenant,
  }),
  pgPolicy('owner_read', {
    for: 'select',
    to: pgRole('thaarei_dms_runtime').existing(),
    using: owner,
  }),
  pgPolicy('operator_read', {
    for: 'select',
    to: pgRole('thaarei_dms_operator').existing(),
    using: operator,
  }),
];
export const lifecycleRestore = dmsSchema
  .table(
    'lifecycle_restore',
    {
      id: uuid().primaryKey(),
      tenantId: uuid('tenant_id').notNull(),
      applicationId: uuid('application_id').notNull(),
      documentId: uuid('document_id').notNull(),
      versionId: uuid('version_id').notNull(),
      uploadId: uuid('upload_id').notNull(),
      generation: integer().notNull(),
      state: text().notNull().default('PENDING'),
      failureCode: text('failure_code'),
      nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      unique('lifecycle_restore_version').on(t.tenantId, t.versionId, t.generation),
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
        'lifecycle_restore_bounds',
        sql`${t.generation} BETWEEN 1 AND 2147483646 AND ${t.state} IN ('PENDING','SCANNING','COMPLETE','FAILED','OBSOLETE') AND (${t.failureCode} IS NULL OR ${t.failureCode} IN ('OBJECT_UNAVAILABLE','INTEGRITY_MISMATCH','SECURITY_ASSESSMENT_FAILED','POLICY_DENIED','CAPACITY_UNAVAILABLE'))`,
      ),
      index('lifecycle_restore_pending').on(t.tenantId, t.state, t.nextAttemptAt, t.id),
      index('lifecycle_restore_document').on(t.tenantId, t.documentId, t.generation),
      ...policies(),
      pgPolicy('coordinator', {
        for: 'all',
        to: pgRole('thaarei_dms_coordinator').existing(),
        using: tenant,
        withCheck: tenant,
      }),
    ],
  )
  .enableRLS();
export const assessmentHistory = dmsSchema
  .table(
    'security_assessment_history',
    {
      id: uuid().primaryKey(),
      tenantId: uuid('tenant_id').notNull(),
      applicationId: uuid('application_id').notNull(),
      candidateId: uuid('candidate_id').notNull(),
      generation: integer().notNull(),
      state: text().notNull(),
      sha256: text(),
      evidence: jsonb(),
      assessedAt: timestamp('assessed_at', { withTimezone: true }),
    },
    (t) => [
      unique('assessment_history_generation').on(t.tenantId, t.candidateId, t.generation),
      foreignKey({
        columns: [t.tenantId, t.applicationId, t.candidateId],
        foreignColumns: [
          securityCandidate.tenantId,
          securityCandidate.applicationId,
          securityCandidate.id,
        ],
      }),
      check(
        'assessment_history_bounds',
        sql`${t.generation} BETWEEN 0 AND 2147483646 AND ${t.state} IN ('COPYING','PENDING','PASSED','REJECTED','INCONCLUSIVE','INVALIDATED') AND (${t.sha256} IS NULL OR ${t.sha256} ~ '^[a-f0-9]{64}$') AND (${t.evidence} IS NULL OR octet_length(${t.evidence}::text)<=8192)`,
      ),
      ...policies(),
      pgPolicy('coordinator_insert', {
        for: 'insert',
        to: pgRole('thaarei_dms_coordinator').existing(),
        withCheck: tenant,
      }),
      pgPolicy('coordinator_read', {
        for: 'select',
        to: pgRole('thaarei_dms_coordinator').existing(),
        using: tenant,
      }),
    ],
  )
  .enableRLS();
export const lifecycleReceipt = dmsSchema
  .table(
    'lifecycle_receipt',
    {
      id: uuid().primaryKey(),
      tenantId: uuid('tenant_id').notNull(),
      applicationId: uuid('application_id').notNull(),
      documentId: uuid('document_id').notNull(),
      actorKind: text('actor_kind').notNull(),
      actorId: text('actor_id').notNull(),
      keyHash: text('key_hash').notNull(),
      expectedRevision: text('expected_revision').notNull(),
      expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    },
    (t) => [
      unique('lifecycle_receipt_key').on(
        t.tenantId,
        t.actorKind,
        t.actorId,
        t.documentId,
        t.keyHash,
      ),
      foreignKey({
        columns: [t.tenantId, t.applicationId, t.documentId],
        foreignColumns: [document.tenantId, document.applicationId, document.id],
      }),
      check(
        'lifecycle_receipt_bounds',
        sql`${t.actorKind} IN ('machine','operator') AND length(${t.actorId}) BETWEEN 1 AND 200 AND length(${t.keyHash})=64 AND ${t.expectedRevision} ~ '^[1-9][0-9]{0,14}$'`,
      ),
      ...policies(),
    ],
  )
  .enableRLS();
