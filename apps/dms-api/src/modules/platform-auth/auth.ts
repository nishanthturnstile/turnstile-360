import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';
import { drizzle } from 'drizzle-orm/node-postgres';
import { parseAuthorityEnvironment } from './authority-configuration.js';
import { createAuthorityOptions } from './authority-options.js';
import * as schema from './persistence/auth.generated.js';

// CLI instance only. Drizzle's pool is lazy; generation/schema checks open no connection.
// Runtime uses its own managed pool and SMTP delivery in AuthorityService.
const config = parseAuthorityEnvironment(process.env);
export const auth = betterAuth({
  ...createAuthorityOptions(config),
  database: drizzleAdapter(drizzle({ connection: config.AUTH_DATABASE_URL, schema }), {
    provider: 'pg',
    schemaName: 'auth',
    schema,
    transaction: true,
  }),
});
