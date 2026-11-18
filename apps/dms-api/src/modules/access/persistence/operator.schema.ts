import { sql } from 'drizzle-orm';
import {
  foreignKey,
  pgPolicy,
  pgRole,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import { dmsSchema, installation } from './dms.schema.js';

export const operatorAuthorization = dmsSchema
  .table(
    'operator_authorization',
    {
      tenantId: uuid('tenant_id').notNull(),
      subjectId: text('subject_id').notNull(),
      createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
      revokedAt: timestamp('revoked_at', { withTimezone: true }),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.subjectId] }),
      foreignKey({ columns: [table.tenantId], foreignColumns: [installation.tenantId] }),
      pgPolicy('tenant_isolation', {
        for: 'all',
        to: pgRole('thaarei_dms_migrator').existing(),
        using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '')::uuid`,
        withCheck: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '')::uuid`,
      }),
    ],
  )
  .enableRLS();
