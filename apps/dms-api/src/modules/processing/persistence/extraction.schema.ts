import { sql } from 'drizzle-orm';
import {
  bigint,
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
import { workAttempt, workJob } from './work.schema.js';

const tenant = sql`tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid`;
export const extractionStage = dmsSchema
  .table(
    'extraction_stage',
    {
      id: uuid().primaryKey(),
      tenantId: uuid('tenant_id').notNull(),
      jobId: uuid('job_id').notNull(),
      attemptId: uuid('attempt_id').notNull(),
      generation: integer().notNull(),
      objectId: uuid('object_id').notNull(),
      size: bigint({ mode: 'number' }).notNull(),
      sha256: text().notNull(),
      state: text().notNull().default('ISSUED'),
      manifest: jsonb(),
      capabilityExpiresAt: timestamp('capability_expires_at', { withTimezone: true }).notNull(),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      unique('extraction_stage_tenant').on(t.tenantId, t.id),
      unique('extraction_attempt_output').on(t.tenantId, t.attemptId),
      foreignKey({
        columns: [t.tenantId, t.jobId],
        foreignColumns: [workJob.tenantId, workJob.id],
      }),
      foreignKey({
        columns: [t.tenantId, t.jobId, t.attemptId, t.generation],
        foreignColumns: [
          workAttempt.tenantId,
          workAttempt.jobId,
          workAttempt.id,
          workAttempt.generation,
        ],
      }),
      check(
        'extraction_stage_bounds',
        sql`${t.generation}>0 AND ${t.size} BETWEEN 1 AND 26214400 AND ${t.sha256} ~ '^[a-f0-9]{64}$' AND ${t.state} IN ('ISSUED','ACCEPTED') AND (${t.manifest} IS NULL OR octet_length(${t.manifest}::text)<=8192) AND (${t.state}<>'ACCEPTED' OR ${t.manifest} IS NOT NULL)`,
      ),
      index('extraction_job_generation').on(t.tenantId, t.jobId, t.generation),
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
    ],
  )
  .enableRLS();
