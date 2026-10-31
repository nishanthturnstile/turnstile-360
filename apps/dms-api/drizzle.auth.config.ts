import { existsSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

if (existsSync('.env.migrate')) process.loadEnvFile('.env.migrate');

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/modules/platform-auth/persistence/auth.generated.ts',
  out: './database/auth/migrations',
  migrations: { schema: 'auth_migrations' },
  dbCredentials: { url: process.env.AUTH_MIGRATION_DATABASE_URL ?? '' },
  strict: true,
});
