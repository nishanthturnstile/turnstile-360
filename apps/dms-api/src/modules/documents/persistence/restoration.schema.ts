import { sql } from 'drizzle-orm';
import {
  check,
  foreignKey,
  index,
  integer,
  pgPolicy,
  pgRole,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { dmsSchema } from '../../access/persistence/dms.schema.js';
import { securityCandidate } from '../../processing/persistence/assessment.schema.js';
import { admission } from './registry.schema.js';

const tenant = sql`tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid`;
const owner = sql`${tenant} AND current_setting('app.principal_kind',true)='machine' AND application_id=nullif(current_setting('app.application_id',true),'')::uuid`;
// Immutable intent keeps the historical candidate alive, including before assessment starts.
export const binaryRestore = dmsSchema
  .table(
    'binary_restore',
    {
      id: uuid().primaryKey(),
      tenantId: uuid('tenant_id').notNull(),
      applicationId: uuid('application_id').notNull(),
      sourceCandidateId: uuid('source_candidate_id').notNull(),
      sourceGeneration: integer('source_generation').notNull(),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      foreignKey({
        columns: [t.tenantId, t.applicationId, t.id],
        foreignColumns: [admission.tenantId, admission.applicationId, admission.id],
      }),
      foreignKey({
        columns: [t.tenantId, t.applicationId, t.sourceCandidateId],
        foreignColumns: [
          securityCandidate.tenantId,
          securityCandidate.applicationId,
          securityCandidate.id,
        ],
      }),
      index('restore_source_reference').on(t.tenantId, t.applicationId, t.sourceCandidateId),
      check('restore_generation', sql`${t.sourceGeneration} BETWEEN 0 AND 2147483646`),
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
    ],
  )
  .enableRLS();
