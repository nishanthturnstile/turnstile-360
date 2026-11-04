import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';
import pg from 'pg';
import { parse } from 'yaml';
import { provisionDatabase } from './provision-auth-database.mjs';

function run(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    env,
    encoding: 'utf8',
    // Keep a finite budget for each owning database file. Separate processes
    // retain complete failure output for the expanded serial suite. This
    // runner budget does not alter application/request deadlines.
    timeout:
      args[0] === 'scripts/test-auth-browser.mjs'
        ? 240000
        : args.includes('test:database')
          ? 360000
          : 120000,
  });
  assert.equal(
    result.status,
    0,
    `${command} failed${result.error ? ` (${result.error.code ?? result.error.name})` : ''}${result.signal ? ` (${result.signal})` : ''}: ${result.stdout}\n${result.stderr}`,
  );
  return result.stdout.trim();
}

const name = `thaarei-auth-test-${randomBytes(6).toString('hex')}`;
const password = randomBytes(48).toString('base64url');
const image = parse(readFileSync('deploy/compose.local.yaml', 'utf8')).services.postgres.image;
const browser = process.argv.includes('--browser');
let created = false;
let mailpitCreated = false;
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
      // Disposable fixtures need storage only for this run. Preserve PostgreSQL
      // sync/constraint behavior while avoiding host-disk contention in tests.
      '--tmpfs',
      '/var/lib/postgresql:rw,size=2g',
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
    ONBOARDING_ARCHIVE_CONTAINER: name,
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
  // Optional capabilities are configured only by their disposable fixtures, never inherited live secrets/transports.
  for (const key of [
    'IDENTITY_SERVICE_CLIENT_ID',
    'IDENTITY_SERVICE_CLIENT_SECRET',
    'IDENTITY_SERVICE_RESOURCE_URL',
    'IDENTITY_SERVICE_API_URL',
    'TURNSTILE_INVITATION_ENCRYPTION_KEY',
    'TURNSTILE_INVITATION_RECOVERY_EPOCH',
    'TURNSTILE_SMTP_HOST',
    'TURNSTILE_SMTP_PORT',
    'TURNSTILE_MAIL_FROM',
  ])
    delete env[key];
  delete env.AUTH_SMTP_USER;
  delete env.AUTH_SMTP_PASSWORD;
  for (const owner of ['auth', 'dms', 'turnstile']) {
    for (const kind of ['runtime', 'migrator']) {
      env[`${owner.toUpperCase()}_${kind === 'runtime' ? '' : 'MIGRATION_'}DATABASE_URL`] =
        `postgresql://thaarei_${owner}_${kind}:${randomBytes(48).toString('base64url')}@127.0.0.1:${port}/auth_fixture`;
    }
  }
  if (!browser) {
    const mailpitImage = parse(readFileSync('deploy/compose.local.yaml', 'utf8')).services.mailpit
      .image;
    run('docker', [
      'run',
      '--detach',
      '--rm',
      '--name',
      `${name}-mailpit`,
      '-e',
      'MP_MAX_MESSAGES=200',
      '-e',
      'MP_MAX_AGE=24h',
      '-e',
      'MP_DISABLE_VERSION_CHECK=true',
      '-p',
      '127.0.0.1::1025',
      '-p',
      '127.0.0.1::8025',
      mailpitImage,
    ]);
    mailpitCreated = true;
    env.TURNSTILE_TEST_MAILPIT_SMTP_PORT = run('docker', [
      'inspect',
      '--format',
      '{{(index (index .NetworkSettings.Ports "1025/tcp") 0).HostPort}}',
      `${name}-mailpit`,
    ]);
    const apiPort = run('docker', [
      'inspect',
      '--format',
      '{{(index (index .NetworkSettings.Ports "8025/tcp") 0).HostPort}}',
      `${name}-mailpit`,
    ]);
    env.TURNSTILE_TEST_MAILPIT_URL = `http://127.0.0.1:${apiPort}`;
    let mailReady = false;
    for (let attempt = 0; attempt < 40; attempt++) {
      try {
        if ((await fetch(`${env.TURNSTILE_TEST_MAILPIT_URL}/readyz`)).ok) {
          mailReady = true;
          break;
        }
      } catch {}
      await setTimeout(100);
    }
    assert.ok(mailReady, 'Disposable Mailpit did not become ready');
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
      assert.equal(
        (
          await pool.query(
            "SELECT current_setting('fsync')='on' AND current_setting('full_page_writes')='on' AND current_setting('synchronous_commit')='on' AS safe",
          )
        ).rows[0].safe,
        true,
        'Disposable PostgreSQL must retain normal synchronization',
      );
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
  if (browser)
    console.log(
      run(
        'node',
        [
          'scripts/test-auth-browser.mjs',
          ...(process.argv.includes('--structured-onboarding') ? ['--structured-onboarding'] : []),
          ...(process.argv.includes('--structure-editor') ? ['--structure-editor'] : []),
          ...(process.argv.includes('--people-ui') ? ['--people-ui'] : []),
        ],
        env,
      ),
    );
  else
    for (const application of process.argv.includes('--identity-service') ||
    process.argv.includes('--invitations') ||
    process.argv.includes('--recipients') ||
    process.argv.includes('--people') ||
    process.argv.includes('--scoped-structure') ||
    process.argv.includes('--user-management-release')
      ? ['turnstile-api']
      : process.argv.includes('--dms-only')
        ? ['dms-api']
        : ['dms-api', 'turnstile-api']) {
      const selected = process.argv.includes('--user-management-release')
        ? ['test/user-management-upgrade.database-spec.ts', 'test/recipients.database-spec.ts']
        : process.argv.includes('--identity-service')
          ? ['test/identity-service.database-spec.ts']
          : process.argv.includes('--people')
            ? ['test/people.database-spec.ts']
            : process.argv.includes('--scoped-structure')
              ? ['test/scoped-structure.database-spec.ts']
              : process.argv.includes('--recipients')
                ? ['test/recipients.database-spec.ts']
                : process.argv.includes('--invitations')
                  ? ['test/invitations.database-spec.ts']
                  : readdirSync(`apps/${application}/test`)
                      .filter((file) => file.endsWith('.database-spec.ts'))
                      .sort()
                      .map((file) => `test/${file}`);
      assert.ok(selected.length, `No database tests for ${application}`);
      for (const file of selected)
        console.log(
          run('pnpm', ['--filter', `@thaarei/${application}`, 'test:database', file], env),
        );
    }
  console.log(
    'Disposable PostgreSQL: repeatable owned migrations/bootstrap, runtime privilege isolation and auth persistence tests passed.',
  );
} finally {
  if (mailpitCreated)
    spawnSync('docker', ['rm', '--force', `${name}-mailpit`], { stdio: 'ignore' });
  if (created) spawnSync('docker', ['rm', '--force', '--volumes', name], { stdio: 'ignore' });
}
