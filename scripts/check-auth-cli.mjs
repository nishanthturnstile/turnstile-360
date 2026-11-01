import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const temporary = await mkdtemp(join(tmpdir(), 'thaarei-auth-cli-'));
const output = join(temporary, 'auth.generated.ts');
const probeEnvironment = {
  ...process.env,
  NODE_ENV: 'test',
  AUTH_PROFILE: 'test',
  INSTALLATION_TENANT_ID: '11111111-1111-4111-8111-111111111111',
  INSTALLATION_CUSTOMER_KEY: 'cli-probe',
  AUTH_SMTP_HOST: 'localhost',
  AUTH_SMTP_PORT: '1',
  AUTH_SMTP_MODE: 'plain',
  AUTH_MAIL_FROM: 'probe@example.test',
  AUTH_PUBLIC_ORIGIN: 'http://localhost:5173',
  AUTH_ISSUER_URL: 'http://localhost:5173/identity',
  AUTH_LOGIN_CALLBACK_URL: 'http://localhost:5173/api/auth/callback',
  DMS_RESOURCE_URL: 'http://localhost:3001/v1',
  AUTH_DATABASE_URL: 'postgresql://auth_probe:unused@localhost:1/auth_probe',
  DMS_DATABASE_URL: 'postgresql://dms_probe:unused@localhost:1/dms_probe',
  AUTH_SECRET: randomBytes(48).toString('base64url'),
  AUTH_LOGIN_CLIENT_ID: 'cli-login-probe',
  DMS_MACHINE_CLIENT_ID: 'cli-machine-probe',
  AUTH_SIGNING_ALGORITHM: 'RS256',
};
try {
  // Disposable offline configuration, never an application startup default or client provisioning.
  const result = spawnSync(
    'pnpm',
    [
      'exec',
      'auth',
      'generate',
      '--config',
      'src/modules/platform-auth/auth.ts',
      '--output',
      output,
      '--yes',
    ],
    {
      cwd: resolve('apps/dms-api'),
      encoding: 'utf8',
      timeout: 30000,
      env: probeEnvironment,
    },
  );
  assert.equal(
    result.status,
    0,
    `Official CLI generation failed: ${result.stderr || result.error}`,
  );
  const schema = await readFile(output, 'utf8');
  for (const model of [
    'user',
    'session',
    'account',
    'verification',
    'rateLimit',
    'jwks',
    'oauthClient',
    'oauthResource',
    'oauthClientResource',
    'oauthClientAssertion',
    'oauthRefreshToken',
    'oauthAccessToken',
    'oauthConsent',
  ]) {
    assert.ok(schema.includes(`export const ${model} =`), `Missing ${model} in CLI schema`);
  }
  assert.ok(schema.includes('banned'), 'Administrator plugin fields are missing');
  assert.ok(schema.includes('pgSchema("auth")'), 'Authority schema namespace is missing');
  const check = spawnSync(
    'pnpm',
    ['exec', 'auth', 'check', 'schema', '--config', 'src/modules/platform-auth/auth.ts'],
    { cwd: resolve('apps/dms-api'), encoding: 'utf8', timeout: 30000, env: probeEnvironment },
  );
  assert.equal(check.status, 0, `Official schema check failed: ${check.stderr}`);
  console.log(
    'Pinned Better Auth CLI generated all auth-schema plugin models and validated the committed Drizzle schema offline; temporary output removed.',
  );
} finally {
  await rm(temporary, { recursive: true, force: true });
}
