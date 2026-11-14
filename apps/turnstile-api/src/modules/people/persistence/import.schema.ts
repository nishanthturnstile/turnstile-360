import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgPolicy,
  pgRole,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  installation,
  productSchema,
} from '../../../infrastructure/database/installation.schema.js';

const tenantPolicy = () =>
  pgPolicy('installation_isolation', {
    for: 'all',
    to: [
      pgRole('thaarei_turnstile_runtime').existing(),
      pgRole('thaarei_turnstile_migrator').existing(),
    ],
    using: sql`tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid`,
    withCheck: sql`tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid`,
  });
export const peopleImportJob = productSchema
  .table(
    'people_import_job',
    {
      tenantId: uuid('tenant_id').notNull(),
      id: uuid().notNull(),
      actorId: text('actor_id').notNull(),
      filename: text().notNull(),
      digest: text().notNull(),
      state: text().notNull().default('draft'),
      version: integer().notNull().default(1),
      assignments: jsonb().notNull(),
      snapshot: jsonb().notNull(),
      organizationRevision: integer('organization_revision').notNull(),
      recoveryEpoch: text('recovery_epoch').notNull(),
      reason: text(),
      leaseId: uuid('lease_id'),
      leaseExpiresAt: timestamp('lease_expires_at', { withTimezone: true }),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
      updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
      reviewExpiresAt: timestamp('review_expires_at', { withTimezone: true }).notNull(),
      nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      primaryKey({ columns: [t.tenantId, t.id] }),
      foreignKey({ columns: [t.tenantId], foreignColumns: [installation.tenantId] }),
      index('people_import_due_idx').on(t.tenantId, t.state, t.nextAttemptAt),
      index('people_import_history_idx').on(t.tenantId, t.createdAt, t.id),
      tenantPolicy(),
      check(
        'people_import_job_shape',
        sql`${t.version}>0 AND ${t.organizationRevision}>=0 AND length(${t.filename}) BETWEEN 1 AND 120 AND ${t.state} IN ('draft','queued','running','paused','completed','cancelled') AND ((${t.leaseId} IS NULL AND ${t.leaseExpiresAt} IS NULL) OR (${t.leaseId} IS NOT NULL AND ${t.leaseExpiresAt} IS NOT NULL))`,
      ),
    ],
  )
  .enableRLS();
export const peopleImportRow = productSchema
  .table(
    'people_import_row',
    {
      tenantId: uuid('tenant_id').notNull(),
      jobId: uuid('job_id').notNull(),
      number: integer().notNull(),
      email: text().notNull(),
      state: text().notNull(),
      reason: text(),
      commandKey: uuid('command_key').notNull(),
      command: jsonb(),
      attempts: integer().notNull().default(0),
      invitationId: uuid('invitation_id'),
    },
    (t) => [
      primaryKey({ columns: [t.tenantId, t.jobId, t.number] }),
      foreignKey({
        columns: [t.tenantId, t.jobId],
        foreignColumns: [peopleImportJob.tenantId, peopleImportJob.id],
      }).onDelete('cascade'),
      index('people_import_row_due_idx').on(t.tenantId, t.jobId, t.state, t.number),
      tenantPolicy(),
      check(
        'people_import_row_shape',
        sql`${t.number} BETWEEN 2 AND 501 AND length(${t.email})<=320 AND ${t.attempts} BETWEEN 0 AND 5 AND ${t.state} IN ('pending','processing','succeeded','failed','skipped','cancelled') AND (${t.state}<>'succeeded' OR ${t.invitationId} IS NOT NULL)`,
      ),
    ],
  )
  .enableRLS();
