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
import { dmsSchema, installation } from '../../access/persistence/dms.schema.js';
import { admission } from '../../documents/persistence/registry.schema.js';
import { processingRun } from './results.schema.js';

const tenant = sql`tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid`;
const grant = sql`${tenant} AND EXISTS (SELECT 1 FROM dms.operator_authorization oa WHERE oa.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND oa.subject_id=current_setting('app.actor_id',true) AND oa.revoked_at IS NULL)`;
const coordinator = pgRole('thaarei_dms_coordinator').existing(),
  migrator = pgRole('thaarei_dms_migrator').existing(),
  operator = pgRole('thaarei_dms_operator').existing();
const policies = () => [
  pgPolicy('coordinator', { for: 'all', to: coordinator, using: tenant, withCheck: tenant }),
  pgPolicy('maintenance', { for: 'all', to: migrator, using: tenant, withCheck: tenant }),
  pgPolicy('operator_read', { for: 'select', to: operator, using: grant }),
];
const date = (name: string) => timestamp(name, { withTimezone: true });
export const workIdentity = dmsSchema
  .table(
    'work_identity',
    {
      id: uuid().primaryKey(),
      tenantId: uuid('tenant_id')
        .notNull()
        .references(() => installation.tenantId),
      issuer: text().notNull(),
      clientId: text('client_id').notNull(),
      role: text().notNull(),
      enabled: boolean().notNull().default(false),
    },
    (t) => [
      unique('work_client_identity').on(t.tenantId, t.issuer, t.clientId),
      check(
        'work_identity_bounds',
        sql`${t.role} IN ('publisher','scanner','extractor','heavy') AND ${t.clientId} ~ '^[A-Za-z0-9_-]{3,128}$' AND length(${t.issuer}) BETWEEN 1 AND 2048`,
      ),
      ...policies(),
      pgPolicy('operator_write', { for: 'all', to: operator, using: grant, withCheck: grant }),
    ],
  )
  .enableRLS();
export const workJob = dmsSchema
  .table(
    'work_job',
    {
      id: uuid().primaryKey(),
      tenantId: uuid('tenant_id').notNull(),
      applicationId: uuid('application_id').notNull(),
      uploadId: uuid('upload_id').notNull(),
      processingRunId: uuid('processing_run_id'),
      task: text().notNull(),
      state: text().notNull().default('QUEUED'),
      generation: integer().notNull().default(1),
      lifecycleGeneration: integer('lifecycle_generation').notNull().default(1),
      executions: integer().notNull().default(0),
      recoveries: integer().notNull().default(0),
      currentAttemptId: uuid('current_attempt_id'),
      budgetStartedAt: date('budget_started_at'),
      deadline: date('deadline'),
      nextEligibleAt: date('next_eligible_at'),
      recoverAt: date('recover_at'),
      resultCode: text('result_code'),
      createdAt: date('created_at').notNull().defaultNow(),
      updatedAt: date('updated_at').notNull().defaultNow(),
    },
    (t) => [
      uniqueIndex('work_job_legacy_source')
        .on(t.tenantId, t.uploadId, t.task)
        .where(sql`${t.processingRunId} IS NULL`),
      unique('work_job_run_source').on(t.tenantId, t.uploadId, t.task, t.processingRunId),
      foreignKey({
        columns: [t.tenantId, t.applicationId, t.uploadId, t.processingRunId],
        foreignColumns: [
          processingRun.tenantId,
          processingRun.applicationId,
          processingRun.uploadId,
          processingRun.id,
        ],
      }),
      unique('work_job_tenant_identity').on(t.tenantId, t.id),
      foreignKey({
        columns: [t.tenantId, t.applicationId, t.uploadId],
        foreignColumns: [admission.tenantId, admission.applicationId, admission.id],
      }),
      check(
        'work_job_bounds',
        sql`${t.task} IN ('document.scan','document.extract','document.heavy') AND ${t.state} IN ('QUEUED','RUNNING','RETRY_WAIT','SUCCEEDED','FAILED','UNSUPPORTED','CANCELLED') AND ${t.generation}>0 AND ${t.executions} BETWEEN 0 AND 3 AND ${t.recoveries} BETWEEN 0 AND 3 AND ((${t.deadline} IS NULL)=(${t.budgetStartedAt} IS NULL)) AND (${t.deadline} IS NULL OR ${t.deadline}<=${t.budgetStartedAt}+interval '30 minutes') AND (${t.resultCode} IS NULL OR length(${t.resultCode})<=64)`,
      ),
      index('work_job_recovery_idx').on(t.tenantId, t.state, t.recoverAt),
      ...policies(),
    ],
  )
  .enableRLS();
export const workDispatch = dmsSchema
  .table(
    'work_dispatch',
    {
      id: uuid().primaryKey(),
      tenantId: uuid('tenant_id').notNull(),
      jobId: uuid('job_id').notNull(),
      generation: integer().notNull(),
      task: text().notNull(),
      state: text().notNull().default('READY'),
      deliveryHash: text('delivery_hash'),
      deliveryClient: text('delivery_client'),
      deliveryUntil: date('delivery_until'),
      nextPublishAt: date('next_publish_at').notNull().defaultNow(),
      publishedAt: date('published_at'),
      failures: integer().notNull().default(0),
      lastError: text('last_error'),
      createdAt: date('created_at').notNull().defaultNow(),
    },
    (t) => [
      unique('work_dispatch_generation').on(t.tenantId, t.jobId, t.generation),
      unique('work_dispatch_identity').on(t.tenantId, t.jobId, t.id, t.generation),
      foreignKey({
        columns: [t.tenantId, t.jobId],
        foreignColumns: [workJob.tenantId, workJob.id],
      }),
      check(
        'dispatch_bounds',
        sql`${t.generation}>0 AND ${t.task} IN ('document.scan','document.extract','document.heavy') AND ${t.state} IN ('READY','LEASED','DELIVERED','OBSOLETE') AND ${t.failures}>=0 AND (${t.deliveryHash} IS NULL OR length(${t.deliveryHash})=64) AND (${t.lastError} IS NULL OR ${t.lastError} IN ('UNROUTABLE','BROKER_UNAVAILABLE'))`,
      ),
      index('work_dispatch_due_idx').on(t.tenantId, t.state, t.nextPublishAt, t.deliveryUntil),
      ...policies(),
    ],
  )
  .enableRLS();
export const workAttempt = dmsSchema
  .table(
    'work_attempt',
    {
      id: uuid().primaryKey(),
      tenantId: uuid('tenant_id').notNull(),
      jobId: uuid('job_id').notNull(),
      dispatchId: uuid('dispatch_id').notNull(),
      generation: integer().notNull(),
      execution: integer().notNull(),
      clientId: text('client_id').notNull(),
      leaseHash: text('lease_hash').notNull(),
      state: text().notNull().default('RUNNING'),
      leaseExpiresAt: date('lease_expires_at').notNull(),
      deadline: date('deadline').notNull(),
      resultHash: text('result_hash'),
      resultCode: text('result_code'),
      retryAfter: integer('retry_after'),
      startedAt: date('started_at').notNull().defaultNow(),
      finishedAt: date('finished_at'),
    },
    (t) => [
      unique('work_attempt_tenant_identity').on(t.tenantId, t.jobId, t.id, t.generation),
      unique('work_execution_identity').on(t.tenantId, t.jobId, t.generation, t.execution),
      uniqueIndex('work_one_active_attempt')
        .on(t.tenantId, t.jobId)
        .where(sql`${t.state}='RUNNING'`),
      foreignKey({
        columns: [t.tenantId, t.jobId, t.dispatchId, t.generation],
        foreignColumns: [
          workDispatch.tenantId,
          workDispatch.jobId,
          workDispatch.id,
          workDispatch.generation,
        ],
      }),
      check(
        'attempt_bounds',
        sql`${t.execution} BETWEEN 1 AND 3 AND ${t.state} IN ('RUNNING','RETRY','SUCCEEDED','FAILED','UNSUPPORTED','LOST','CANCELLED') AND length(${t.leaseHash})=64 AND ${t.leaseExpiresAt}<=${t.deadline} AND ${t.deadline}<=${t.startedAt}+interval '10 minutes' AND (${t.resultHash} IS NULL OR length(${t.resultHash})=64) AND (${t.retryAfter} IS NULL OR ${t.retryAfter} BETWEEN 1 AND 60)`,
      ),
      index('work_attempt_lease_idx').on(t.tenantId, t.state, t.leaseExpiresAt),
      ...policies(),
    ],
  )
  .enableRLS();
