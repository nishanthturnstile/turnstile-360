import { randomBytes } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { preparePrivateFiles, rawEnvironment } from '@thaarei/deployment-control';
import { z } from 'zod';

const origin = z.url().refine((v) => new URL(v).origin === v && new URL(v).protocol === 'https:');
const input = z
  .object({
    tenantId: z.uuid(),
    localInstallationId: z.uuid(),
    applicationId: z.uuid(),
    customerKey: z.string().regex(/^[a-z0-9][a-z0-9-]{0,47}$/),
    publicOrigin: origin,
    dmsOrigin: origin,
    provisionDatabaseUrl: z.url(),
    smtp: z
      .object({
        host: z.enum(['localhost', '127.0.0.1', '::1', 'mailpit']),
        port: z.number().int().min(1).max(65535),
        mode: z.literal('starttls'),
        from: z.email(),
      })
      .strict(),
  })
  .strict();
export function validateTurnstileInput(raw: unknown) {
  const c = input.parse(raw),
    db = new URL(c.provisionDatabaseUrl);
  if (!['postgres:', 'postgresql:'].includes(db.protocol) || !db.password)
    throw new Error('Private provision connection required');
  return c;
}
export function initializeTurnstile(raw: unknown, directory: string) {
  const c = validateTurnstileInput(raw),
    db = new URL(c.provisionDatabaseUrl);
  if (!['postgres:', 'postgresql:'].includes(db.protocol) || !db.password)
    throw new Error('Private provision connection required');
  return preparePrivateFiles(
    directory,
    'turnstile',
    c,
    [
      '.env.turnstile',
      '.env.turnstile.migrate',
      '.env.turnstile.reporter',
      '.env.turnstile-provision',
    ],
    () => {
      const secret = () => randomBytes(36).toString('base64url'),
        connection = (role: string) => {
          const value = new URL(db);
          value.username = `thaarei_turnstile_${role}`;
          value.password = secret();
          return value.href;
        };
      const runtime = connection('runtime'),
        migrator = connection('migrator'),
        reporter = connection('reporter');
      const common = {
        INSTALLATION_LOCAL_ID: c.localInstallationId,
        INSTALLATION_TENANT_ID: c.tenantId,
        INSTALLATION_CUSTOMER_KEY: c.customerKey,
        TURNSTILE_APPLICATION_ID: c.applicationId,
      };
      const authority = {
        AUTH_PROFILE: 'production',
        AUTH_PUBLIC_ORIGIN: c.publicOrigin,
        AUTH_ISSUER_URL: `${c.publicOrigin}/identity`,
        AUTH_LOGIN_CALLBACK_URL: `${c.publicOrigin}/api/auth/callback`,
        AUTH_LOGIN_CLIENT_ID: 'turnstile-web-login',
        AUTH_LOGIN_CLIENT_SECRET: '',
        DMS_MACHINE_CLIENT_ID: 'turnstile-dms-machine',
        DMS_MACHINE_CLIENT_SECRET: '',
        IDENTITY_SERVICE_CLIENT_ID: 'turnstile-identity-service',
        IDENTITY_SERVICE_CLIENT_SECRET: '',
        IDENTITY_SERVICE_RESOURCE_URL: `${c.publicOrigin}/identity/services/accounts`,
        IDENTITY_SERVICE_API_URL: 'http://dms-api:3001',
        DMS_RESOURCE_URL: `${c.dmsOrigin}/v1`,
        DMS_API_URL: 'http://dms-api:3001/v1',
      };
      const product = {
        ...common,
        ...authority,
        TURNSTILE_DATABASE_URL: runtime,
        TURNSTILE_COOKIE_SECRET: secret(),
        TURNSTILE_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
        TURNSTILE_INVITATION_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
        TURNSTILE_INVITATION_RECOVERY_EPOCH: randomBytes(32).toString('base64url'),
        TURNSTILE_SMTP_HOST: c.smtp.host,
        TURNSTILE_SMTP_PORT: String(c.smtp.port),
        TURNSTILE_MAIL_FROM: c.smtp.from,
      };
      return {
        files: {
          '.env.turnstile': rawEnvironment(product),
          '.env.turnstile.migrate': rawEnvironment({
            ...common,
            TURNSTILE_MIGRATION_DATABASE_URL: migrator,
          }),
          '.env.turnstile.reporter': rawEnvironment({
            ...common,
            TURNSTILE_REPORTER_DATABASE_URL: reporter,
          }),
          '.env.turnstile-provision': rawEnvironment({
            DATABASE_PROFILE: 'turnstile',
            PROVISION_DATABASE_URL: c.provisionDatabaseUrl,
            TURNSTILE_DATABASE_URL: runtime,
            TURNSTILE_MIGRATION_DATABASE_URL: migrator,
            TURNSTILE_REPORTER_DATABASE_URL: reporter,
          }),
        },
        result: { version: 1, ...common },
      };
    },
  );
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    let raw = '';
    for await (const chunk of process.stdin) {
      raw += chunk;
      if (Buffer.byteLength(raw) > 16384) throw new Error();
    }
    if (process.argv[2] === '--validate') validateTurnstileInput(JSON.parse(raw));
    else {
      if (process.argv[2]) throw new Error('Unknown initializer option');
      initializeTurnstile(JSON.parse(raw), '/configuration');
    }
    console.log('Turnstile private configuration prepared; client provisioning remains closed.');
  } catch {
    console.error('Turnstile private preparation rejected; retained configuration preserved');
    process.exitCode = 1;
  }
}
