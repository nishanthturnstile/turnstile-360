import { existsSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

if (existsSync('.env.migrate')) process.loadEnvFile('.env.migrate');

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/modules/auth/persistence/product.schema.ts',
  out: './database/migrations',
  migrations: { schema: 'turnstile_migrations' },
  dbCredentials: { url: process.env.TURNSTILE_MIGRATION_DATABASE_URL ?? '' },
  strict: true,
});
