import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  pgPolicy,
  pgRole,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { dmsSchema, installation } from '../access/persistence/dms.schema.js';

const tenant = sql`tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid`;
const policies = () => [
  pgPolicy('maintenance', {
    for: 'all',
    to: pgRole('thaarei_dms_migrator').existing(),
    using: tenant,
    withCheck: tenant,
  }),
];
export const deploymentUsage = dmsSchema
  .table(
    'deployment_usage',
    {
      tenantId: uuid('tenant_id')
        .primaryKey()
        .references(() => installation.tenantId),
      epoch: uuid('epoch').notNull().defaultRandom(),
      boundEpoch: uuid('bound_epoch'),
      startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
      publishedDocuments: bigint('published_documents', { mode: 'number' }).notNull().default(0),
      publishedVersions: bigint('published_versions', { mode: 'number' }).notNull().default(0),
      completedProcessingJobs: bigint('completed_processing_jobs', { mode: 'number' })
        .notNull()
        .default(0),
      overflow: boolean('overflow').notNull().default(false),
    },
    policies,
  )
  .enableRLS();
export const deploymentUsageEvent = dmsSchema
  .table(
    'deployment_usage_event',
    {
      tenantId: uuid('tenant_id')
        .notNull()
        .references(() => installation.tenantId),
      kind: text('kind').notNull(),
      subjectId: uuid('subject_id').notNull(),
    },
    (t) => [primaryKey({ columns: [t.tenantId, t.kind, t.subjectId] }), ...policies()],
  )
  .enableRLS();
