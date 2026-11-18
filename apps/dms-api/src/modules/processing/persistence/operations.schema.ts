import { sql } from 'drizzle-orm';
import {
  check,
  integer,
  pgPolicy,
  pgRole,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { dmsSchema, installation } from '../../access/persistence/dms.schema.js';
import { workIdentity } from './work.schema.js';

const tenant = sql`tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid`;
export const serviceObservation = dmsSchema
  .table(
    'service_observation',
    {
      tenantId: uuid('tenant_id')
        .notNull()
        .references(() => installation.tenantId),
      component: text().notNull(),
      identityId: uuid('identity_id').references(() => workIdentity.id),
      state: text().notNull(),
      observedAt: timestamp('observed_at', { withTimezone: true }).notNull().defaultNow(),
      evidenceAt: timestamp('evidence_at', { withTimezone: true }),
      evidenceHash: text('evidence_hash'),
      failures: integer().notNull().default(0),
    },
    (t) => [
      primaryKey({ columns: [t.tenantId, t.component] }),
      check(
        'service_observation_bounds',
        sql`${t.component} IN ('coordinator','publisher','scanner','extractor','heavy','backup') AND ${t.state} IN ('ready','degraded','stopping') AND ${t.failures}>=0 AND (${t.evidenceHash} IS NULL OR ${t.evidenceHash} ~ '^[a-f0-9]{64}$') AND ((${t.component} IN ('coordinator','backup'))=(${t.identityId} IS NULL))`,
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
        using: sql`${tenant} AND EXISTS(SELECT 1 FROM dms.operator_authorization o WHERE o.tenant_id=service_observation.tenant_id AND o.subject_id=current_setting('app.actor_id',true) AND o.revoked_at IS NULL)`,
      }),
    ],
  )
  .enableRLS();
