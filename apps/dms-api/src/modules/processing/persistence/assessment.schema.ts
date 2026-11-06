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
import { admission } from '../../documents/persistence/registry.schema.js';

const tenant = sql`tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid`;
// One selected immutable candidate per upload. No worker can select an object/key.
export const securityCandidate = dmsSchema
  .table(
    'security_candidate',
    {
      id: uuid().primaryKey(),
      tenantId: uuid('tenant_id').notNull(),
      applicationId: uuid('application_id').notNull(),
      uploadId: uuid('upload_id').notNull(),
      objectId: uuid('object_id').notNull(),
      etag: text().notNull(),
      size: bigint({ mode: 'number' }).notNull(),
      invalidationGeneration: integer('invalidation_generation').notNull().default(0),
      state: text().notNull().default('PENDING'),
      sha256: text(),
      expectedSha256: text('expected_sha256'),
      evidence: jsonb(),
      assessedAt: timestamp('assessed_at', { withTimezone: true }),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    },
    (t) => [
      unique('candidate_upload').on(t.tenantId, t.uploadId),
      unique('candidate_owner_identity').on(t.tenantId, t.applicationId, t.id),
      index('candidate_object_refs').on(t.tenantId, t.objectId),
      check('candidate_generation', sql`${t.invalidationGeneration} BETWEEN 0 AND 2147483646`),
      foreignKey({
        columns: [t.tenantId, t.applicationId, t.uploadId],
        foreignColumns: [admission.tenantId, admission.applicationId, admission.id],
      }),
      check(
        'candidate_bounds',
        sql`${t.size} BETWEEN 1 AND 52428800 AND length(${t.etag}) BETWEEN 1 AND 130 AND ${t.state} IN ('COPYING','PENDING','PASSED','REJECTED','INCONCLUSIVE','INVALIDATED') AND (${t.sha256} IS NULL OR ${t.sha256} ~ '^[a-f0-9]{64}$') AND (${t.evidence} IS NULL OR octet_length(${t.evidence}::text)<=8192) AND (${t.state}<>'PASSED' OR (${t.sha256} IS NOT NULL AND ${t.evidence} IS NOT NULL AND ${t.assessedAt} IS NOT NULL))`,
      ),
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
      pgPolicy('operator_read', {
        for: 'select',
        to: pgRole('thaarei_dms_operator').existing(),
        using: sql`${tenant} AND EXISTS (SELECT 1 FROM dms.operator_authorization oa WHERE oa.tenant_id=security_candidate.tenant_id AND oa.subject_id=current_setting('app.actor_id',true) AND oa.revoked_at IS NULL)`,
      }),
      pgPolicy('runtime_read', {
        for: 'select',
        to: pgRole('thaarei_dms_runtime').existing(),
        using: sql`${tenant} AND application_id=nullif(current_setting('app.application_id',true),'')::uuid AND current_setting('app.principal_kind',true)='machine'`,
      }),
    ],
  )
  .enableRLS();
