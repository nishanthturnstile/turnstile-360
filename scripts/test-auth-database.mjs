import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import pg from 'pg';
import { parse } from 'yaml';
import { provisionDatabase } from './provision-auth-database.mjs';

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, { env, encoding: 'utf8', timeout: 120000 });
  assert.equal(result.status, 0, `${command} failed: ${result.stdout}\n${result.stderr}`);
  return result.stdout.trim();
}

const name = `thaarei-auth-test-${randomBytes(6).toString('hex')}`;
const password = randomBytes(48).toString('base64url');
const image = parse(readFileSync('deploy/compose.local.yaml', 'utf8')).services.postgres.image;
const browser = process.argv.includes('--browser');
let created = false;
try {
  run('pnpm', [
    'exec',
    'turbo',
    'run',
    'build',
    '--filter=@thaarei/dms-api',
    '--filter=@thaarei/turnstile-api',
    ...(browser ? ['--filter=@thaarei/turnstile-web'] : []),
  ]);
  // Test credentials stay in environment/memory, never shell command text or recorded output.
  run(
    'docker',
    [
      'run',
      '--detach',
      '--rm',
      '--name',
      name,
      '-e',
      'POSTGRES_PASSWORD',
      '-e',
      'POSTGRES_DB=auth_fixture',
      '-p',
      '127.0.0.1::5432',
      image,
    ],
    { ...process.env, POSTGRES_PASSWORD: password },
  );
  created = true;
  const port = run('docker', [
    'inspect',
    '--format',
    '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}',
    name,
  ]);
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    const check = spawnSync(
      'docker',
      ['exec', name, 'pg_isready', '-h', '127.0.0.1', '-U', 'postgres', '-d', 'auth_fixture'],
      { encoding: 'utf8' },
    );
    if (check.status === 0) {
      ready = true;
      break;
    }
    await setTimeout(250);
  }
  assert.ok(ready, 'Disposable PostgreSQL did not become ready');
  const env = {
    ...process.env,
    NODE_ENV: 'test',
    AUTH_PROFILE: 'test',
    PROVISION_DATABASE_URL: `postgresql://postgres:${password}@127.0.0.1:${port}/auth_fixture`,
    INSTALLATION_TENANT_ID: randomUUID(),
    INSTALLATION_CUSTOMER_KEY: 'auth-fixture',
    TURNSTILE_APPLICATION_ID: randomUUID(),
    AUTH_PUBLIC_ORIGIN: 'http://localhost:5173',
    AUTH_ISSUER_URL: 'http://localhost:5173/identity',
    AUTH_LOGIN_CALLBACK_URL: 'http://localhost:5173/api/auth/callback',
    DMS_RESOURCE_URL: 'http://localhost:3001/v1',
    DMS_API_URL: 'http://localhost:3001/v1',
    AUTH_SECRET: randomBytes(48).toString('base64url'),
    AUTH_LOGIN_CLIENT_ID: 'fixture-login',
    AUTH_LOGIN_CLIENT_SECRET: randomBytes(48).toString('base64url'),
    DMS_MACHINE_CLIENT_ID: 'fixture-machine',
    DMS_MACHINE_CLIENT_SECRET: randomBytes(48).toString('base64url'),
    TURNSTILE_COOKIE_SECRET: randomBytes(48).toString('base64url'),
    TURNSTILE_TOKEN_ENCRYPTION_KEY: randomBytes(32).toString('hex'),
    AUTH_SMTP_HOST: '127.0.0.1',
    AUTH_SMTP_PORT: '1',
    AUTH_SMTP_MODE: 'plain',
    AUTH_MAIL_FROM: 'identity@example.test',
  };
  delete env.AUTH_SMTP_USER;
  delete env.AUTH_SMTP_PASSWORD;
  for (const owner of ['auth', 'dms', 'turnstile']) {
    for (const kind of ['runtime', 'migrator']) {
      env[`${owner.toUpperCase()}_${kind === 'runtime' ? '' : 'MIGRATION_'}DATABASE_URL`] =
        `postgresql://thaarei_${owner}_${kind}:${randomBytes(48).toString('base64url')}@127.0.0.1:${port}/auth_fixture`;
    }
  }
  await provisionDatabase(env);
  // Deployment scripts are exercised as compiled Node ESM commands with dedicated migrators.
  for (let repeat = 0; repeat < 2; repeat++) {
    for (const [application, owner] of [
      ['dms-api', 'auth'],
      ['dms-api', 'dms'],
      ['turnstile-api', 'turnstile'],
    ]) {
      run('pnpm', ['--filter', `@thaarei/${application}`, `db:migrate:${owner}`], env);
    }
    for (const application of ['dms-api', 'turnstile-api'])
      run('pnpm', ['--filter', `@thaarei/${application}`, 'db:bootstrap'], env);
  }
  // Check ownership across all six roles without importing either application's data code.
  for (const owner of ['auth', 'dms', 'turnstile']) {
    const pool = new pg.Pool({ connectionString: env[`${owner.toUpperCase()}_DATABASE_URL`] });
    try {
      for (const other of ['auth', 'dms', 'turnstile'].filter((value) => value !== owner)) {
        await assert.rejects(
          pool.query(`SELECT * FROM ${other}.${other === 'auth' ? '"user"' : 'installation'}`),
          { code: '42501' },
        );
      }
      for (const query of [
        `CREATE TABLE ${owner}.forbidden (id int)`,
        'CREATE TEMP TABLE forbidden (id int)',
        `SET ROLE thaarei_${owner}_migrator`,
      ]) {
        await assert.rejects(pool.query(query), { code: '42501' });
      }
      const {
        rows: [role],
      } = await pool.query(
        'SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user',
      );
      assert.equal(role.rolsuper || role.rolbypassrls, false);
    } finally {
      await pool.end();
    }
  }
  if (browser) console.log(run('node', ['scripts/test-auth-browser.mjs'], env));
  else
    for (const application of ['dms-api', 'turnstile-api']) {
      console.log(run('pnpm', ['--filter', `@thaarei/${application}`, 'test:database'], env));
    }
  console.log(
    'Disposable PostgreSQL: repeatable owned migrations/bootstrap, runtime privilege isolation and auth persistence tests passed.',
  );
} finally {
  if (created) spawnSync('docker', ['rm', '--force', '--volumes', name], { stdio: 'ignore' });
}
