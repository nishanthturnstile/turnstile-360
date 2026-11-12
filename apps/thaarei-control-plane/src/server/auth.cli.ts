import { drizzleAdapter } from '@better-auth/drizzle-adapter';
import { betterAuth } from 'better-auth';
import { drizzle } from 'drizzle-orm/node-postgres';
import * as schema from './auth.generated.ts';
import { authOptions } from './auth-options.ts';

// Offline schema generation only; no runtime defaults, database connections or seeds.
export const auth = betterAuth({
  ...authOptions({
    supportedVersions: { dms: [], turnstile: [] },
    moduleReferenceDirectory: undefined,
    moduleReleaseTrustFile: undefined,
    signingKeyFile: undefined,
    recoveryMarkerFile: undefined,
    origin: 'https://schema.invalid',
    databaseUrl: '',
    secret: 'offline-schema-generation-only-not-a-runtime-secret',
    smtpUrl: '',
    smtpFrom: '',
    production: true,
    trustProxy: false,
  }),
  database: drizzleAdapter(
    drizzle({ connection: 'postgresql://unused:unused@localhost:1/unused', schema }),
    {
      provider: 'pg',
      schemaName: 'control_plane',
      transaction: true,
    },
  ),
});
