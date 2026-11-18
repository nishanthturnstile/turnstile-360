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
import {
  applicationRegistration,
  dmsSchema,
  installation,
} from '../../access/persistence/dms.schema.js';

const runtime = pgRole('thaarei_dms_runtime').existing(),
  migrator = pgRole('thaarei_dms_migrator').existing(),
  operator = pgRole('thaarei_dms_operator').existing(),
  coordinator = pgRole('thaarei_dms_coordinator').existing();
const tenant = sql`tenant_id = nullif(current_setting('app.tenant_id',true),'')::uuid`;
const owner = sql`${tenant} AND current_setting('app.principal_kind',true)='machine' AND application_id=nullif(current_setting('app.application_id',true),'')::uuid`;
const operatorGrant = sql`${tenant} AND EXISTS (SELECT 1 FROM dms.operator_authorization oa WHERE oa.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND oa.subject_id=current_setting('app.actor_id',true) AND oa.revoked_at IS NULL)`;
const tenantPolicies = () => [
  pgPolicy('runtime_tenant', { for: 'all', to: runtime, using: tenant, withCheck: tenant }),
  pgPolicy('maintenance', { for: 'all', to: migrator, using: tenant, withCheck: tenant }),
  pgPolicy('coordinator_tenant', { for: 'all', to: coordinator, using: tenant, withCheck: tenant }),
  pgPolicy('operator_tenant', {
    for: 'all',
    to: operator,
    using: operatorGrant,
    withCheck: operatorGrant,
  }),
];
const ownerPolicies = () => [
  pgPolicy('runtime_owner', { for: 'all', to: runtime, using: owner, withCheck: owner }),
  pgPolicy('maintenance', { for: 'all', to: migrator, using: tenant, withCheck: tenant }),
  pgPolicy('coordinator_tenant', { for: 'all', to: coordinator, using: tenant, withCheck: tenant }),
  pgPolicy('operator_read', { for: 'select', to: operator, using: operatorGrant }),
];
export const document = dmsSchema
  .table(
    'document',
    {
      id: uuid().primaryKey(),
      tenantId: uuid('tenant_id').notNull(),
      applicationId: uuid('application_id').notNull(),
      title: text().notNull(),
      fileName: text('file_name').notNull(),
      metadata: jsonb().notNull(),
      tags: jsonb().notNull().default(sql`'[]'::jsonb`),
      references: jsonb().notNull().default(sql`'[]'::jsonb`),
      lifecycle: text().notNull().default('ACTIVE'),
      lifecycleGeneration: integer('lifecycle_generation').notNull().default(1),
      deletedAt: timestamp('deleted_at', { withTimezone: true }),
      restoreDeadline: timestamp('restore_deadline', { withTimezone: true }),
      restoredAt: timestamp('restored_at', { withTimezone: true }),
      revision: bigint({ mode: 'number' }).notNull().default(1),
      nextVersion: integer('next_version').notNull().default(1),
      currentVersionId: uuid('current_version_id'),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      unique('document_owner_identity').on(t.tenantId, t.applicationId, t.id),
      foreignKey({
        columns: [t.tenantId, t.applicationId],
        foreignColumns: [applicationRegistration.tenantId, applicationRegistration.id],
      }),
      check(
        'document_baseline',
        sql`${t.lifecycle} IN ('ACTIVE','SOFT_DELETED','PURGING','PURGED') AND ${t.lifecycleGeneration} BETWEEN 1 AND 2147483646 AND (${t.lifecycle}='ACTIVE' OR (${t.deletedAt} IS NOT NULL AND ${t.restoreDeadline}=${t.deletedAt}+interval '30 days')) AND ${t.revision} BETWEEN 1 AND 999999999999999 AND ${t.nextVersion}>0`,
      ),
      check(
        'document_labels',
        sql`length(${t.title}) BETWEEN 1 AND 240 AND octet_length(${t.title}) BETWEEN 1 AND 960 AND length(${t.fileName}) BETWEEN 1 AND 255 AND octet_length(${t.fileName}) BETWEEN 1 AND 1020 AND ${t.title} !~ '[[:cntrl:]]' AND ${t.fileName} !~ '[[:cntrl:]]' AND position('/' in ${t.fileName})=0 AND position(chr(92) in ${t.fileName})=0`,
      ),
      check(
        'document_metadata',
        sql`jsonb_typeof(${t.metadata})='object' AND octet_length(${t.metadata}::text)<=32768`,
      ),
      check(
        'document_tags_bounds',
        sql`jsonb_typeof(${t.tags})='array' AND jsonb_array_length(${t.tags})<=32 AND octet_length(${t.tags}::text)<=16384`,
      ),
      check(
        'document_references_bounds',
        sql`jsonb_typeof(${t.references})='array' AND jsonb_array_length(${t.references})<=32 AND octet_length(${t.references}::text)<=65536`,
      ),
      index('document_tags_idx').using('gin', t.tags),
      index('document_references_idx').using('gin', t.references),
      index('document_title_idx').on(t.tenantId, t.applicationId, t.title),
      index('document_owner_page_idx').on(t.tenantId, t.applicationId, t.createdAt, t.id),
      ...ownerPolicies(),
    ],
  )
  .enableRLS();
export const documentVersion = dmsSchema
  .table(
    'document_version',
    {
      id: uuid().primaryKey(),
      tenantId: uuid('tenant_id').notNull(),
      applicationId: uuid('application_id').notNull(),
      documentId: uuid('document_id').notNull(),
      number: integer().notNull(),
      lifecycleGeneration: integer('lifecycle_generation').notNull().default(1),
      availability: text().notNull().default('PENDING'),
      size: bigint({ mode: 'number' }).notNull(),
      contentType: text('content_type').notNull(),
      fileName: text('file_name').notNull(),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      unique('version_owner_identity').on(t.tenantId, t.applicationId, t.documentId, t.id),
      unique('document_version_number').on(t.tenantId, t.documentId, t.number),
      foreignKey({
        columns: [t.tenantId, t.applicationId, t.documentId],
        foreignColumns: [document.tenantId, document.applicationId, document.id],
      }),
      check(
        'version_baseline',
        sql`${t.number}>0 AND ${t.availability} IN ('PENDING','AVAILABLE','UNAVAILABLE') AND ${t.size} BETWEEN 1 AND 52428800 AND length(${t.contentType}) BETWEEN 3 AND 100 AND length(${t.fileName}) BETWEEN 1 AND 255`,
      ),
      ...ownerPolicies(),
    ],
  )
  .enableRLS();
export const admissionPolicy = dmsSchema
  .table(
    'admission_policy',
    {
      tenantId: uuid('tenant_id')
        .primaryKey()
        .references(() => installation.tenantId),
      revision: bigint({ mode: 'number' }).notNull(),
      settings: jsonb().notNull(),
      updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      check(
        'admission_policy_bounds',
        sql`${t.revision} BETWEEN 1 AND 999999999999999 AND jsonb_typeof(${t.settings})='object' AND octet_length(${t.settings}::text)<=16384`,
      ),
      ...tenantPolicies(),
    ],
  )
  .enableRLS();
export const admissionCapacity = dmsSchema
  .table(
    'admission_capacity',
    {
      tenantId: uuid('tenant_id')
        .primaryKey()
        .references(() => installation.tenantId),
      sharedDevice: boolean('shared_device').notNull().default(false),
      storageFreeBytes: bigint('storage_free_bytes', { mode: 'number' }).notNull(),
      scratchFreeBytes: bigint('scratch_free_bytes', { mode: 'number' }).notNull(),
      usedAtObservation: bigint('used_at_observation', { mode: 'number' }).notNull(),
      observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      check(
        'capacity_bounds',
        sql`${t.storageFreeBytes}>=0 AND ${t.scratchFreeBytes}>=0 AND ${t.usedAtObservation}>=0`,
      ),
      ...tenantPolicies(),
    ],
  )
  .enableRLS();
const usageColumns = () => ({
  reservedStorage: bigint('reserved_storage', { mode: 'number' }).notNull().default(0),
  reservedScratch: bigint('reserved_scratch', { mode: 'number' }).notNull().default(0),
  stagingBytes: bigint('staging_bytes', { mode: 'number' }).notNull().default(0),
  originalBytes: bigint('original_bytes', { mode: 'number' }).notNull().default(0),
  artifactBytes: bigint('artifact_bytes', { mode: 'number' }).notNull().default(0),
  retainedBytes: bigint('retained_bytes', { mode: 'number' }).notNull().default(0),
  active: integer().notNull().default(0),
  queued: integer().notNull().default(0),
});
const usageCheck = () =>
  check(
    'usage_nonnegative',
    sql`reserved_storage>=0 AND reserved_scratch>=0 AND staging_bytes>=0 AND original_bytes>=0 AND artifact_bytes>=0 AND retained_bytes>=0 AND active>=0 AND queued>=0`,
  );
export const tenantUsage = dmsSchema
  .table(
    'admission_tenant_usage',
    {
      tenantId: uuid('tenant_id')
        .primaryKey()
        .references(() => installation.tenantId),
      ...usageColumns(),
    },
    () => [usageCheck(), ...tenantPolicies()],
  )
  .enableRLS();
export const applicationUsage = dmsSchema
  .table(
    'admission_application_usage',
    {
      id: uuid().primaryKey(),
      tenantId: uuid('tenant_id').notNull(),
      applicationId: uuid('application_id').notNull(),
      ...usageColumns(),
    },
    (t) => [
      unique('application_usage_identity').on(t.tenantId, t.applicationId),
      foreignKey({
        columns: [t.tenantId, t.applicationId],
        foreignColumns: [applicationRegistration.tenantId, applicationRegistration.id],
      }),
      usageCheck(),
      ...ownerPolicies(),
    ],
  )
  .enableRLS();
export const admission = dmsSchema
  .table(
    'upload_admission',
    {
      id: uuid().primaryKey(),
      tenantId: uuid('tenant_id').notNull(),
      applicationId: uuid('application_id').notNull(),
      contributorApplicationId: uuid('contributor_application_id').notNull(),
      documentId: uuid('document_id').notNull(),
      versionId: uuid('version_id').notNull(),
      lifecycleGeneration: integer('lifecycle_generation').notNull().default(1),
      reassessmentUntil: timestamp('reassessment_until', { withTimezone: true }),
      idempotencyHash: text('idempotency_hash').notNull(),
      requestHash: text('request_hash').notNull(),
      policyRevision: bigint('policy_revision', { mode: 'number' }).notNull(),
      profile: text().notNull(),
      size: bigint({ mode: 'number' }).notNull(),
      state: text().notNull().default('RESERVED'),
      storageMode: text('storage_mode').notNull().default('UPLOAD'),
      workReleased: boolean('work_released').notNull().default(false),
      reservedStorage: bigint('reserved_storage', { mode: 'number' }).notNull(),
      reservedScratch: bigint('reserved_scratch', { mode: 'number' }).notNull(),
      stagingBytes: bigint('staging_bytes', { mode: 'number' }).notNull().default(0),
      originalBytes: bigint('original_bytes', { mode: 'number' }).notNull().default(0),
      capabilityExpiresAt: timestamp('capability_expires_at', { withTimezone: true }),
      expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      unique('admission_version_identity').on(t.tenantId, t.versionId),
      unique('admission_receipt_identity').on(
        t.tenantId,
        t.contributorApplicationId,
        t.idempotencyHash,
      ),
      unique('admission_contributor_identity').on(t.tenantId, t.contributorApplicationId, t.id),
      foreignKey({
        columns: [t.tenantId, t.contributorApplicationId],
        foreignColumns: [applicationRegistration.tenantId, applicationRegistration.id],
      }),
      unique('admission_owner_identity').on(t.tenantId, t.applicationId, t.id),
      foreignKey({
        columns: [t.tenantId, t.applicationId, t.documentId, t.versionId],
        foreignColumns: [
          documentVersion.tenantId,
          documentVersion.applicationId,
          documentVersion.documentId,
          documentVersion.id,
        ],
      }),
      check(
        'admission_bounds',
        sql`${t.storageMode} IN ('UPLOAD','REUSE') AND (${t.storageMode}<>'REUSE' OR (${t.reservedStorage}=0 AND ${t.stagingBytes}=0 AND ${t.originalBytes}=0 AND ${t.capabilityExpiresAt} IS NULL)) AND ${t.size} BETWEEN 1 AND 52428800 AND ${t.reservedStorage}>=0 AND ${t.reservedScratch}>=0 AND ${t.stagingBytes}>=0 AND ${t.originalBytes}>=0 AND ${t.state} IN ('RESERVED','RELEASED','SETTLED') AND ${t.profile} IN ('secure-only','searchable','structured') AND length(${t.requestHash})=64 AND length(${t.idempotencyHash})=64 AND (${t.capabilityExpiresAt} IS NULL OR ${t.capabilityExpiresAt}<=${t.expiresAt})`,
      ),
      index('admission_document_idx').on(t.tenantId, t.documentId, t.id),
      index('admission_expiry_idx').on(t.tenantId, t.state, t.expiresAt),
      ...ownerPolicies(),
    ],
  )
  .enableRLS();
