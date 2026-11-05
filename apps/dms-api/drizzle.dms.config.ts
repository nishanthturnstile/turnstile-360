import { existsSync } from 'node:fs';
import { defineConfig } from 'drizzle-kit';

if (existsSync('.env.migrate')) process.loadEnvFile('.env.migrate');

export default defineConfig({
  dialect: 'postgresql',
  schema: [
    './src/modules/access/persistence/dms.schema.ts',
    './src/modules/access/persistence/operator.schema.ts',
    './src/modules/enrollment/persistence/enrollment.schema.ts',
    './src/modules/audit/persistence/security.schema.ts',
    './src/modules/audit/persistence/audit.schema.ts',
  ],
  out: './database/dms/migrations',
  migrations: { schema: 'dms_migrations' },
  dbCredentials: { url: process.env.DMS_MIGRATION_DATABASE_URL ?? '' },
  strict: true,
});
