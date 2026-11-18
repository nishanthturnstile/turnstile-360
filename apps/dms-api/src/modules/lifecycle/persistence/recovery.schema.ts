import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  foreignKey,
  index,
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

const tenant = sql`tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid`;
const grant = sql`${tenant} AND EXISTS(SELECT 1 FROM dms.operator_authorization o WHERE o.tenant_id=tenant_id AND o.tenant_id=nullif(current_setting('app.tenant_id',true),'')::uuid AND o.subject_id=current_setting('app.actor_id',true) AND o.revoked_at IS NULL)`;
const policies = () => [
  pgPolicy('maintenance', {
    for: 'all',
    to: pgRole('thaarei_dms_migrator').existing(),
    using: tenant,
    withCheck: tenant,
  }),
  pgPolicy('coordinator', {
    for: 'select',
    to: pgRole('thaarei_dms_coordinator').existing(),
    using: tenant,
  }),
  pgPolicy('operator', {
    for: 'select',
    to: pgRole('thaarei_dms_operator').existing(),
    using: grant,
  }),
];
export const recoveryState = dmsSchema
  .table(
    'recovery_state',
    {
      tenantId: uuid('tenant_id')
        .primaryKey()
        .references(() => installation.tenantId),
      state: text().notNull().default('OPEN'),
      backupId: uuid('backup_id'),
      manifestSha256: text('manifest_sha256'),
      verifiedAt: timestamp('verified_at', { withTimezone: true }),
      openedAt: timestamp('opened_at', { withTimezone: true }),
    },
    (t) => [
      check(
        'recovery_state_bounds',
        sql`${t.state} IN ('OPEN','CLOSED') AND (${t.manifestSha256} IS NULL OR ${t.manifestSha256} ~ '^[a-f0-9]{64}$')`,
      ),
      ...policies(),
      pgPolicy('runtime', {
        for: 'select',
        to: pgRole('thaarei_dms_runtime').existing(),
        using: tenant,
      }),
    ],
  )
  .enableRLS();
export const backupCatalog = dmsSchema
  .table(
    'backup_catalog',
    {
      id: uuid().primaryKey(),
      tenantId: uuid('tenant_id')
        .notNull()
        .references(() => installation.tenantId),
      recoveryPoint: timestamp('recovery_point', { withTimezone: true }).notNull(),
      expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
      manifestSha256: text('manifest_sha256'),
      repositoryId: text('repository_id').notNull(),
      confirmedOffHost: boolean('confirmed_off_host').notNull().default(false),
      bytes: bigint({ mode: 'number' }),
      verifiedAt: timestamp('verified_at', { withTimezone: true }).defaultNow(),
    },
    (t) => [
      unique('backup_tenant_id').on(t.tenantId, t.id),
      check(
        'backup_catalog_bounds',
        sql`${t.expiresAt}>=${t.recoveryPoint}+interval '7 days' AND ${t.repositoryId} ~ '^[A-Za-z0-9_-]{1,64}$' AND ((${t.manifestSha256} IS NULL AND ${t.bytes} IS NULL AND ${t.verifiedAt} IS NULL AND NOT ${t.confirmedOffHost}) OR (${t.manifestSha256} IS NOT NULL AND ${t.manifestSha256} ~ '^[a-f0-9]{64}$' AND ${t.bytes}>0 AND ${t.bytes} IS NOT NULL AND ${t.verifiedAt} IS NOT NULL))`,
      ),
      index('backup_recovery_horizon').on(t.tenantId, t.expiresAt, t.recoveryPoint),
      ...policies(),
    ],
  )
  .enableRLS();
export const disposalIntent = dmsSchema
  .table(
    'disposal_intent',
    {
      id: uuid().primaryKey(),
      tenantId: uuid('tenant_id')
        .notNull()
        .references(() => installation.tenantId),
      applicationId: uuid('application_id').notNull(),
      area: text().notNull(),
      objectId: uuid('object_id').notNull(),
      state: text().notNull().default('PENDING'),
      requestedBy: text('requested_by').notNull(),
      requestedAt: timestamp('requested_at', { withTimezone: true }).notNull().defaultNow(),
      nextAttemptAt: timestamp('next_attempt_at', { withTimezone: true }).notNull().defaultNow(),
      leaseId: uuid('lease_id'),
      leaseUntil: timestamp('lease_until', { withTimezone: true }),
      completedAt: timestamp('completed_at', { withTimezone: true }),
    },
    (t) => [
      foreignKey({
        name: 'disposal_application_integrity',
        columns: [t.tenantId, t.applicationId],
        foreignColumns: [applicationRegistration.tenantId, applicationRegistration.id],
      }),
      unique('disposal_object_identity').on(t.tenantId, t.applicationId, t.area, t.objectId),
      check(
        'disposal_bounds',
        sql`${t.area} IN ('staging','originals','artifacts') AND ${t.state} IN ('PENDING','DELETING','COMPLETE') AND length(${t.requestedBy}) BETWEEN 1 AND 128 AND ((${t.state}='COMPLETE')=(${t.completedAt} IS NOT NULL))`,
      ),
      index('disposal_due').on(t.tenantId, t.state, t.nextAttemptAt, t.leaseUntil),
      ...policies(),
    ],
  )
  .enableRLS();
