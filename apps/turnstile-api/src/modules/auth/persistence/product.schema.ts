import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgPolicy,
  pgRole,
  pgSchema,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';

export const productSchema = pgSchema('turnstile');
export const installation = productSchema.table(
  'installation',
  {
    singleton: integer().primaryKey().default(1),
    tenantId: uuid('tenant_id').notNull().unique(),
    customerKey: text('customer_key').notNull().unique(),
    applicationId: uuid('application_id').notNull().unique(),
  },
  (table) => [check('one_installation', sql`${table.singleton} = 1`)],
);

export const userAccess = productSchema
  .table(
    'user_access',
    {
      tenantId: uuid('tenant_id').notNull(),
      userId: text('user_id').notNull(),
      enabled: boolean().notNull().default(false),
      permissions: text().array().notNull().default(sql`'{}'::text[]`),
    },
    (table) => [
      primaryKey({ columns: [table.tenantId, table.userId] }),
      foreignKey({ columns: [table.tenantId], foreignColumns: [installation.tenantId] }),
      pgPolicy('tenant_isolation', {
        for: 'all',
        to: [
          pgRole('thaarei_turnstile_runtime').existing(),
          pgRole('thaarei_turnstile_migrator').existing(),
        ],
        using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '')::uuid`,
        withCheck: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '')::uuid`,
      }),
    ],
  )
  .enableRLS();

export const productSession = productSchema
  .table(
    'session',
    {
      idHash: text('id_hash').primaryKey(),
      tenantId: uuid('tenant_id').notNull(),
      ciphertext: text().notNull(),
      expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    },
    (table) => [
      foreignKey({ columns: [table.tenantId], foreignColumns: [installation.tenantId] }),
      pgPolicy('tenant_isolation', {
        for: 'all',
        to: [
          pgRole('thaarei_turnstile_runtime').existing(),
          pgRole('thaarei_turnstile_migrator').existing(),
        ],
        using: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '')::uuid`,
        withCheck: sql`${table.tenantId} = nullif(current_setting('app.tenant_id', true), '')::uuid`,
      }),
      index('session_expiry_idx').on(table.expiresAt),
    ],
  )
  .enableRLS();
