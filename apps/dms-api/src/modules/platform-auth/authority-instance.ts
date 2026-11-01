import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';
import { getTableName, is } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { PgTable } from 'drizzle-orm/pg-core';
import type { Pool } from 'pg';
import type { AuthorityConfiguration } from './authority-configuration.js';
import { createAuthorityOptions } from './authority-options.js';
import * as schema from './persistence/auth.generated.js';
import type { RecoveryDelivery } from './recovery-delivery.js';

export const authorityTables = Object.values(schema).flatMap((value) =>
  is(value, PgTable) ? [`auth."${getTableName(value)}"`] : [],
);

export function createAuthority(
  config: AuthorityConfiguration,
  pool: Pool,
  delivery: RecoveryDelivery,
) {
  return betterAuth({
    ...createAuthorityOptions(config, delivery),
    database: drizzleAdapter(drizzle(pool, { schema }), {
      provider: 'pg',
      schemaName: 'auth',
      schema,
      transaction: true,
    }),
  });
}

export type Authority = ReturnType<typeof createAuthority>;
