import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
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
import { applicationRegistration, dmsSchema } from '../../access/persistence/dms.schema.js';
import { admission } from '../../documents/persistence/registry.schema.js';

const tenant = sql`tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid`;
const owner = sql`${tenant} AND current_setting('app.principal_kind',true)='machine' AND application_id=nullif(current_setting('app.application_id',true),'')::uuid`;
const policies = () => [
  pgPolicy('runtime_owner', {
    for: 'all',
    to: pgRole('thaarei_dms_runtime').existing(),
    using: owner,
    withCheck: owner,
  }),
  pgPolicy('maintenance', {
    for: 'all',
    to: pgRole('thaarei_dms_migrator').existing(),
    using: tenant,
    withCheck: tenant,
  }),
  pgPolicy('coordinator_read', {
    for: 'select',
    to: pgRole('thaarei_dms_coordinator').existing(),
    using: tenant,
  }),
  pgPolicy('operator_read', {
    for: 'select',
    to: pgRole('thaarei_dms_operator').existing(),
    using: sql`${tenant} AND EXISTS (SELECT 1 FROM dms.operator_authorization oa WHERE oa.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND oa.subject_id=current_setting('app.actor_id',true) AND oa.revoked_at IS NULL)`,
  }),
];
const owning = () => ({
  tenantId: uuid('tenant_id').notNull(),
  applicationId: uuid('application_id').notNull(),
});
export const uploadBatch = dmsSchema
  .table(
    'upload_batch',
    {
      id: uuid().primaryKey(),
      ...owning(),
      state: text().notNull().default('OPEN'),
      expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      unique('batch_owner_identity').on(t.tenantId, t.applicationId, t.id),
      foreignKey({
        columns: [t.tenantId, t.applicationId],
        foreignColumns: [applicationRegistration.tenantId, applicationRegistration.id],
      }),
      check('batch_state', sql`${t.state} IN ('OPEN','CLOSED','CANCELLED','EXPIRED')`),
      index('batch_open_expiry_idx').on(t.tenantId, t.state, t.expiresAt),
      ...policies(),
    ],
  )
  .enableRLS();
export const uploadBatchItem = dmsSchema
  .table(
    'upload_batch_item',
    {
      ...owning(),
      batchId: uuid('batch_id').notNull(),
      itemId: text('item_id').notNull(),
      ordinal: integer().notNull(),
      operation: text().notNull(),
      descriptor: jsonb().notNull(),
      state: text().notNull().default('UNSTARTED'),
      uploadId: uuid('upload_id'),
      admissionError: text('admission_error'),
    },
    (t) => [
      unique('batch_item_identity').on(t.tenantId, t.applicationId, t.batchId, t.itemId),
      unique('batch_item_ordinal').on(t.batchId, t.ordinal),
      unique('batch_item_upload').on(t.uploadId),
      foreignKey({
        columns: [t.tenantId, t.applicationId, t.batchId],
        foreignColumns: [uploadBatch.tenantId, uploadBatch.applicationId, uploadBatch.id],
      }),
      foreignKey({
        columns: [t.tenantId, t.applicationId, t.uploadId],
        foreignColumns: [admission.tenantId, admission.contributorApplicationId, admission.id],
      }),
      check(
        'batch_item_bounds',
        sql`${t.itemId} ~ '^[A-Za-z0-9_-]{1,64}$' AND ${t.ordinal} BETWEEN 0 AND 99 AND ${t.operation} IN ('create','new-version') AND jsonb_typeof(${t.descriptor})='object' AND octet_length(${t.descriptor}::text)<=32768 AND ${t.state} IN ('UNSTARTED','BOUND','CLOSED','CANCELLED','EXPIRED') AND ((${t.state}='BOUND')=(${t.uploadId} IS NOT NULL)) AND (${t.admissionError} IS NULL OR ${t.admissionError} IN ('POLICY_DENIED','CAPACITY_EXCEEDED','CAPACITY_UNAVAILABLE','OPERATION_DENIED','REVISION_CONFLICT'))`,
      ),
      ...policies(),
    ],
  )
  .enableRLS();
export const uploadSession = dmsSchema
  .table(
    'upload_session',
    {
      id: uuid().primaryKey(),
      ...owning(),
      stagingId: uuid('staging_id').notNull().unique(),
      descriptor: jsonb().notNull(),
      batchId: uuid('batch_id'),
      batchApplicationId: uuid('batch_application_id').notNull(),
      itemId: text('item_id'),
      uploadState: text('upload_state').notNull().default('INITIATED'),
      completionRequestedAt: timestamp('completion_requested_at', { withTimezone: true }),
      discoveryToken: uuid('discovery_token'),
      discoveryUntil: timestamp('discovery_until', { withTimezone: true }),
      discoveryNextAt: timestamp('discovery_next_at', { withTimezone: true })
        .notNull()
        .defaultNow(),
      observedEtag: text('observed_etag'),
      observedSize: bigint('observed_size', { mode: 'number' }),
      observedAt: timestamp('observed_at', { withTimezone: true }),
      failureCode: text('failure_code'),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      unique('session_tenant_identity').on(t.tenantId, t.id),
      unique('session_contributor_identity').on(t.tenantId, t.batchApplicationId, t.id),
      foreignKey({
        columns: [t.tenantId, t.batchApplicationId, t.id],
        foreignColumns: [admission.tenantId, admission.contributorApplicationId, admission.id],
      }),
      unique('session_owner_identity').on(t.tenantId, t.applicationId, t.id),
      unique('session_batch_item_identity').on(t.tenantId, t.applicationId, t.batchId, t.itemId),
      foreignKey({
        columns: [t.tenantId, t.applicationId, t.id],
        foreignColumns: [admission.tenantId, admission.applicationId, admission.id],
      }),
      foreignKey({
        columns: [t.tenantId, t.batchApplicationId, t.batchId, t.itemId],
        foreignColumns: [
          uploadBatchItem.tenantId,
          uploadBatchItem.applicationId,
          uploadBatchItem.batchId,
          uploadBatchItem.itemId,
        ],
      }),
      check(
        'session_bounds',
        sql`${t.uploadState} IN ('INITIATED','OBJECT_VERIFIED','COMPLETED','EXPIRED','CANCELLED','FAILED') AND jsonb_typeof(${t.descriptor})='object' AND octet_length(${t.descriptor}::text)<=32768 AND ((${t.batchId} IS NULL)=(${t.itemId} IS NULL))`,
      ),
      check(
        'session_observation_bounds',
        sql`(${t.observedSize} IS NULL OR ${t.observedSize} BETWEEN 0 AND 1125899906842624) AND (${t.observedEtag} IS NULL OR length(${t.observedEtag}) BETWEEN 1 AND 256) AND (${t.failureCode} IS NULL OR ${t.failureCode} IN ('SIZE_MISMATCH','CONTENT_TYPE_MISMATCH','SECURITY_ASSESSMENT_FAILED'))`,
      ),
      index('session_discovery_due_idx').on(
        t.tenantId,
        t.uploadState,
        t.discoveryNextAt,
        t.discoveryUntil,
      ),
      index('session_recovery_idx').on(t.tenantId, t.uploadState, t.createdAt),
      ...policies(),
    ],
  )
  .enableRLS();
export const uploadReceipt = dmsSchema
  .table(
    'upload_receipt',
    {
      id: uuid().primaryKey(),
      ...owning(),
      namespace: text().notNull(),
      keyHash: text('key_hash').notNull(),
      requestHash: text('request_hash').notNull(),
      batchId: uuid('batch_id'),
      uploadId: uuid('upload_id'),
      expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    },
    (t) => [
      foreignKey({
        columns: [t.tenantId, t.applicationId],
        foreignColumns: [applicationRegistration.tenantId, applicationRegistration.id],
      }),
      unique('upload_operation_receipt').on(t.tenantId, t.applicationId, t.namespace, t.keyHash),
      foreignKey({
        columns: [t.tenantId, t.applicationId, t.batchId],
        foreignColumns: [uploadBatch.tenantId, uploadBatch.applicationId, uploadBatch.id],
      }),
      foreignKey({
        columns: [t.tenantId, t.uploadId],
        foreignColumns: [uploadSession.tenantId, uploadSession.id],
      }),
      check(
        'upload_receipt_bounds',
        sql`length(${t.keyHash})=64 AND length(${t.requestHash})=64 AND ((${t.namespace} IN ('batch.create','batch.close') AND ${t.batchId} IS NOT NULL AND ${t.uploadId} IS NULL) OR (${t.namespace}='upload.complete' AND ${t.batchId} IS NULL AND ${t.uploadId} IS NOT NULL))`,
      ),
      index('upload_receipt_expiry_idx').on(t.tenantId, t.expiresAt),
      ...policies(),
    ],
  )
  .enableRLS();

// Tenant-visible quota identities only; manifests/sessions remain strictly owner-scoped.
export const uploadBatchSlot = dmsSchema
  .table(
    'upload_batch_slot',
    {
      id: uuid().primaryKey(),
      ...owning(),
      active: boolean().notNull().default(true),
      expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    },
    (t) => [
      foreignKey({
        columns: [t.tenantId, t.applicationId, t.id],
        foreignColumns: [uploadBatch.tenantId, uploadBatch.applicationId, uploadBatch.id],
      }),
      index('batch_slot_capacity_idx').on(t.tenantId, t.active, t.expiresAt),
      pgPolicy('runtime_read', {
        for: 'select',
        to: pgRole('thaarei_dms_runtime').existing(),
        using: tenant,
      }),
      pgPolicy('runtime_insert', {
        for: 'insert',
        to: pgRole('thaarei_dms_runtime').existing(),
        withCheck: owner,
      }),
      pgPolicy('runtime_update', {
        for: 'update',
        to: pgRole('thaarei_dms_runtime').existing(),
        using: owner,
        withCheck: owner,
      }),
      pgPolicy('maintenance', {
        for: 'all',
        to: pgRole('thaarei_dms_migrator').existing(),
        using: tenant,
        withCheck: tenant,
      }),
    ],
  )
  .enableRLS();
