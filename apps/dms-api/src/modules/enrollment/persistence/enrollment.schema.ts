import { sql } from 'drizzle-orm';
import { check, foreignKey, index, text, timestamp, unique, uuid } from 'drizzle-orm/pg-core';
import {
  applicationRegistration,
  dmsSchema,
  tenantPolicy,
} from '../../access/persistence/dms.schema.js';

export const enrollmentKey = dmsSchema
  .table(
    'enrollment_key',
    {
      id: uuid().primaryKey(),
      tenantId: uuid('tenant_id').notNull(),
      applicationId: uuid('application_id').notNull(),
      deploymentId: text('deployment_id').notNull(),
      issuer: text().notNull(),
      clientId: text('client_id').notNull(),
      digest: text().notNull(),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
      expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
      consumedAt: timestamp('consumed_at', { withTimezone: true }),
      revokedAt: timestamp('revoked_at', { withTimezone: true }),
    },
    (table) => [
      unique('enrollment_key_tenant_identity').on(table.tenantId, table.id),
      foreignKey({
        columns: [table.tenantId, table.applicationId, table.issuer, table.clientId],
        foreignColumns: [
          applicationRegistration.tenantId,
          applicationRegistration.id,
          applicationRegistration.issuer,
          applicationRegistration.clientId,
        ],
      }),
      check('enrollment_digest', sql`${table.digest} ~ '^[0-9a-f]{64}$'`),
      check(
        'enrollment_expiry',
        sql`${table.expiresAt} > ${table.createdAt} AND ${table.expiresAt} <= ${table.createdAt} + interval '24 hours'`,
      ),
      index('enrollment_key_application_idx').on(table.tenantId, table.applicationId),
      tenantPolicy(table.tenantId),
    ],
  )
  .enableRLS();

export const enrollmentReceipt = dmsSchema
  .table(
    'enrollment_receipt',
    {
      id: uuid().primaryKey(),
      tenantId: uuid('tenant_id').notNull(),
      applicationId: uuid('application_id').notNull(),
      deploymentId: text('deployment_id').notNull(),
      issuer: text().notNull(),
      clientId: text('client_id').notNull(),
      operation: text().notNull(),
      idempotencyHash: text('idempotency_hash').notNull(),
      requestHash: text('request_hash').notNull(),
      enrollmentKeyId: uuid('enrollment_key_id').notNull().unique(),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
      expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    },
    (table) => [
      foreignKey({
        columns: [table.tenantId, table.applicationId],
        foreignColumns: [applicationRegistration.tenantId, applicationRegistration.id],
      }),
      foreignKey({
        columns: [table.tenantId, table.enrollmentKeyId],
        foreignColumns: [enrollmentKey.tenantId, enrollmentKey.id],
      }),
      unique('enrollment_idempotency_scope').on(
        table.tenantId,
        table.deploymentId,
        table.issuer,
        table.clientId,
        table.operation,
        table.idempotencyHash,
      ),
      check(
        'enrollment_receipt_hashes',
        sql`${table.idempotencyHash} ~ '^[0-9a-f]{64}$' AND ${table.requestHash} ~ '^[0-9a-f]{64}$'`,
      ),
      check(
        'enrollment_receipt_expiry',
        sql`${table.expiresAt} > ${table.createdAt} AND ${table.expiresAt} <= ${table.createdAt} + interval '24 hours'`,
      ),
      index('enrollment_receipt_expiry_idx').on(table.expiresAt),
      tenantPolicy(table.tenantId),
    ],
  )
  .enableRLS();
