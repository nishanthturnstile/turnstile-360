import { sql } from 'drizzle-orm';
import {
  boolean,
  foreignKey,
  index,
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

export {
  installation,
  productSchema,
} from '../../../infrastructure/database/installation.schema.js';

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
