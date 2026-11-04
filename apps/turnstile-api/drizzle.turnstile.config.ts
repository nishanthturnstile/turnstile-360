import { existsSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

if (existsSync('.env.migrate')) process.loadEnvFile('.env.migrate');

export default defineConfig({
  dialect: 'postgresql',
  schema: [
    './src/modules/auth/persistence/product.schema.ts',
    './src/modules/organization/persistence/organization.schema.ts',
    './src/modules/access/access.schema.ts',
    './src/modules/people/persistence/invitation.schema.ts',
    './src/modules/people/persistence/people.schema.ts',
  ],
  out: './database/migrations',
  migrations: { schema: 'turnstile_migrations' },
  dbCredentials: { url: process.env.TURNSTILE_MIGRATION_DATABASE_URL ?? '' },
  strict: true,
});
