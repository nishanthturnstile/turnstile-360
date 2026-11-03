// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: Explicit private local operator rehearsal; credentials stay in process environments.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import {
  closeSync,
  mkdtempSync,
  openSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { isAbsolute, relative, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import pg from 'pg';
import { parse } from 'yaml';
import {
  accessAssignmentSchema,
  TURNSTILE_PERMISSIONS,
} from '../packages/turnstile-contracts/dist/index.js';
import { provisionDatabase } from './provision-auth-database.mjs';

export const releasePrivateFiles = [
  ['.env', 'compose.env'],
  ['.env.provision', 'provision.env'],
  ['apps/dms-api/.env', 'dms-runtime.env'],
  ['apps/dms-api/.env.migrate', 'dms-migrator.env'],
  ['apps/turnstile-api/.env', 'product-runtime.env'],
  ['apps/turnstile-api/.env.migrate', 'product-migrator.env'],
];

// Compare data without exporting account text, password hashes, keys or tokens to logs.
export async function fingerprintTables(pool, selected) {
  const tables =
    selected ??
    (
      await pool.query(
        "SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('auth','dms','turnstile','auth_migrations','dms_migrations') ORDER BY schemaname,tablename",
      )
    ).rows;
  const quote = (name) => `"${name.replaceAll('"', '""')}"`;
  const result = [];
  for (const { schemaname, tablename } of tables) {
    const {
      rows: [state],
    } = await pool.query(
      `SELECT count(*)::text AS count,md5(coalesce(string_agg(md5(row_to_json(t)::text),'' ORDER BY md5(row_to_json(t)::text)),'')) AS digest FROM ${quote(schemaname)}.${quote(tablename)} t`,
    );
    result.push({ schemaname, tablename, ...state });
  }
  return result;
}

export function readLocalRelease(directory) {
  assert.ok(isAbsolute(directory), 'Use an absolute private release directory');
  const location = relative(realpathSync('.'), realpathSync(directory));
  assert.ok(
    location === '..' || location.startsWith('../') || isAbsolute(location),
    'Keep backups outside the checkout',
  );
  assert.equal(statSync(directory).mode & 0o077, 0, 'Private release directory required');
  const env = { ...process.env };
  for (const [, name] of releasePrivateFiles) {
    const path = resolve(directory, name);
    assert.equal(statSync(path).mode & 0o077, 0, 'Private configuration files required');
    Object.assign(env, parseEnv(readFileSync(path, 'utf8')));
  }
  assert.equal(
    env.AUTH_PROFILE,
    'local',
    'This rehearsal is for the selected local installation only',
  );
  assert.equal(env.AUTH_PUBLIC_ORIGIN, 'http://localhost:23600');
  const database = new URL(env.PROVISION_DATABASE_URL).pathname;
  assert.ok(database.length > 1, 'An explicit installation database is required');
  for (const key of [
    'PROVISION_DATABASE_URL',
    'AUTH_DATABASE_URL',
    'DMS_DATABASE_URL',
    'TURNSTILE_DATABASE_URL',
    'AUTH_MIGRATION_DATABASE_URL',
    'DMS_MIGRATION_DATABASE_URL',
    'TURNSTILE_MIGRATION_DATABASE_URL',
  ]) {
    const url = new URL(env[key]);
    assert.ok(
      ['postgres:', 'postgresql:'].includes(url.protocol) &&
        ['localhost', '127.0.0.1'].includes(url.hostname) &&
        url.port === '23603' &&
        url.pathname === database &&
        !url.hash,
      'The same reserved local installation database is required',
    );
  }
  return env;
}

async function rehearse(directory) {
  let stage = 'private-input';
  let created = false;
  let admin;
  const name = `thaarei-upgrade-rehearsal-${randomBytes(6).toString('hex')}`;
  function run(command, args, options = {}) {
    const result = spawnSync(command, args, { encoding: 'utf8', timeout: 120000, ...options });
    // Subprocess diagnostics can contain connection details or restored row values.
    if (result.status !== 0) {
      const diagnostic = resolve(
        mkdtempSync(resolve(tmpdir(), 'thaarei-rehearsal-diagnostic-')),
        'failure.log',
      );
      writeFileSync(diagnostic, `${result.stdout ?? ''}\n${result.stderr ?? ''}`, { mode: 0o600 });
      console.error(`Private rehearsal diagnostic retained: ${diagnostic}`);
    }
    assert.equal(result.status, 0, `Rehearsal command failed (${stage})`);
    return result.stdout?.trim() ?? '';
  }
  try {
    const source = readLocalRelease(directory);
    const manifest = JSON.parse(readFileSync(resolve(directory, 'manifest.json'), 'utf8'));
    const archive = resolve(directory, 'database.dump');
    assert.equal(
      createHash('sha256').update(readFileSync(archive)).digest('hex'),
      manifest.databaseSha256,
    );
    const input = accessAssignmentSchema.parse(
      JSON.parse(readFileSync(resolve(directory, 'manager-access.json'), 'utf8')),
    );
    assert.ok(input.enabled && input.permissions.includes('turnstile:configuration:manage'));
    const image = parse(readFileSync('deploy/compose.local.yaml', 'utf8')).services.postgres.image;
    const password = randomBytes(48).toString('base64url');
    stage = 'isolated-database';
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
        'POSTGRES_DB=onboarding_upgrade',
        '-p',
        '127.0.0.1::5432',
        image,
      ],
      { env: { ...process.env, POSTGRES_PASSWORD: password } },
    );
    created = true;
    const port = run('docker', [
      'inspect',
      '--format',
      '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}',
      name,
    ]);
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      if (
        spawnSync(
          'docker',
          [
            'exec',
            name,
            'pg_isready',
            '-h',
            '127.0.0.1',
            '-U',
            'postgres',
            '-d',
            'onboarding_upgrade',
          ],
          { stdio: 'ignore' },
        ).status === 0
      ) {
        ready = true;
        break;
      }
      await delay(250);
    }
    assert.ok(ready, 'Disposable database unavailable');
    const env = {
      ...source,
      PROVISION_DATABASE_URL: `postgresql://postgres:${password}@127.0.0.1:${port}/onboarding_upgrade`,
    };
    for (const owner of ['AUTH', 'DMS', 'TURNSTILE'])
      for (const kind of ['runtime', 'migrator'])
        env[`${owner}_${kind === 'runtime' ? '' : 'MIGRATION_'}DATABASE_URL`] =
          `postgresql://thaarei_${owner.toLowerCase()}_${kind}:${randomBytes(48).toString('base64url')}@127.0.0.1:${port}/onboarding_upgrade`;
    stage = 'isolated-role-provisioning';
    await provisionDatabase(env);
    stage = 'archive-restore';
    const fd = openSync(archive, 'r');
    try {
      run(
        'docker',
        [
          'exec',
          '-i',
          name,
          'pg_restore',
          '--exit-on-error',
          '-U',
          'postgres',
          '-d',
          'onboarding_upgrade',
        ],
        { stdio: [fd, 'pipe', 'pipe'] },
      );
    } finally {
      closeSync(fd);
    }
    admin = new pg.Pool({ connectionString: env.PROVISION_DATABASE_URL, max: 1 });
    stage = 'restored-data';
    const baseline = await fingerprintTables(admin);
    assert.deepEqual(baseline, manifest.fingerprints);
    const originalGrants = (
      await admin.query('SELECT * FROM turnstile.user_access ORDER BY user_id')
    ).rows;
    const hadConfiguration = baseline.some(
      (table) => table.tablename === 'organization_configuration',
    );
    const configuration = hadConfiguration
      ? (await admin.query('SELECT * FROM turnstile.organization_configuration ORDER BY tenant_id'))
          .rows
      : [];
    const expectedConfiguration = configuration.map((row) =>
      row.requirement_version === 1 && row.completed_at === null
        ? { ...row, requirement_version: 2 }
        : row,
    );
    const unchanged = baseline.filter((table) => table.tablename !== 'organization_configuration');
    const previous = originalGrants.find((grant) => grant.user_id === input.userId);
    assert.ok(previous?.enabled, 'Expected an existing enabled local account');
    assert.ok(
      previous.permissions.every((permission) => input.permissions.includes(permission)),
      'Preserve every existing permission',
    );
    stage = 'owned-migration';
    const command = 'apps/turnstile-api/dist/modules/organization/configuration-operator.js';
    const operator = JSON.stringify({ operatorId: input.operatorId });
    run(process.execPath, [command, 'verify-installation'], { env, input: operator });
    const migrate = 'apps/turnstile-api/dist/infrastructure/database/migrate.js';
    run(process.execPath, [migrate, 'turnstile'], { env });
    run(process.execPath, [migrate, 'bootstrap'], { env });
    assert.deepEqual(await fingerprintTables(admin, unchanged), unchanged);
    if (hadConfiguration)
      assert.deepEqual(
        (await admin.query('SELECT * FROM turnstile.organization_configuration ORDER BY tenant_id'))
          .rows,
        expectedConfiguration,
      );
    stage = 'initialization';
    run(process.execPath, [command, 'initialize'], { env, input: operator });
    const first = JSON.parse(run(process.execPath, [command, 'inspect'], { env, input: operator }));
    const repeated = JSON.parse(
      run(process.execPath, [command, 'initialize'], { env, input: operator }),
    );
    assert.equal(repeated.alreadyInitialized, true);
    assert.equal(repeated.revision, first.revision);
    assert.equal(repeated.requirementVersion, first.requirementVersion);
    if (!baseline.some((table) => table.tablename === 'organization_configuration')) {
      assert.equal(first.state, 'not_started');
      assert.equal(first.requirementVersion, 2);
      assert.equal(first.revision, 0);
      assert.equal(first.completion, null);
      assert.equal(
        (await admin.query('SELECT count(*)::int AS n FROM turnstile.organization_unit')).rows[0].n,
        0,
      );
    }
    stage = 'preserving-grant';
    const grant = 'apps/turnstile-api/dist/modules/auth/set-user-access.js';
    run(process.execPath, [grant], { env, input: JSON.stringify(input) });
    assert.equal(
      JSON.parse(run(process.execPath, [grant], { env, input: JSON.stringify(input) })).changed,
      false,
    );
    const expected = originalGrants.map((row) =>
      row.user_id === input.userId
        ? {
            ...row,
            permissions: TURNSTILE_PERMISSIONS.filter((permission) =>
              input.permissions.includes(permission),
            ),
          }
        : row,
    );
    assert.deepEqual(
      (await admin.query('SELECT * FROM turnstile.user_access ORDER BY user_id')).rows,
      expected,
    );
    const final = JSON.parse(run(process.execPath, [command, 'inspect'], { env, input: operator }));
    assert.equal(final.revision, first.revision);
    assert.deepEqual(final.completion, first.completion);
    assert.ok(final.managers.ids.includes(input.userId));
    const untouched = baseline.filter(
      (table) =>
        !['user_access', 'configuration_audit', 'organization_configuration'].includes(
          table.tablename,
        ),
    );
    assert.deepEqual(await fingerprintTables(admin, untouched), untouched);
    if (hadConfiguration)
      assert.deepEqual(
        (await admin.query('SELECT * FROM turnstile.organization_configuration ORDER BY tenant_id'))
          .rows,
        expectedConfiguration,
      );
    stage = 'runtime-privileges';
    const runtime = new pg.Pool({ connectionString: env.TURNSTILE_DATABASE_URL, max: 1 });
    try {
      await assert.rejects(runtime.query('SELECT id FROM auth."user"'), { code: '42501' });
      await assert.rejects(
        runtime.query('UPDATE turnstile.user_access SET enabled = false WHERE false'),
        {
          code: '42501',
        },
      );
      assert.equal(
        (await runtime.query('SELECT count(*)::int AS n FROM turnstile.organization_configuration'))
          .rows[0].n,
        0,
      );
    } finally {
      await runtime.end();
    }
    stage = 'v1-archive-matrix';
    run(
      'pnpm',
      [
        '--filter',
        '@thaarei/turnstile-api',
        'exec',
        'vitest',
        'run',
        '--config',
        'vitest.config.database.ts',
        'test/configuration-upgrade.database-spec.ts',
      ],
      {
        env: { ...env, NODE_ENV: 'test', AUTH_PROFILE: 'test', ONBOARDING_ARCHIVE_CONTAINER: name },
      },
    );
    console.log(
      'Local archive restore/upgrade rehearsal passed: old data/identities/sessions/clients/enrollment preserved, owning migrations, repeat-safe initialization/grant, unchanged completion and runtime isolation.',
    );
    console.log(
      'Six real v1 dump/restore upgrade cases passed: empty/partial, Calcutta/Kolkata, completed root-only and completed structure; values, revisions, receipts, audit and activation preserved.',
    );
    console.log(
      'Only a disposable database was changed; the selected installation and backup archive were not modified.',
    );
  } catch {
    console.error(
      `Local upgrade rehearsal failed (${stage}); original installation and archive were not modified.`,
    );
    process.exitCode = 1;
  } finally {
    await admin?.end();
    if (created)
      spawnSync('docker', ['rm', '--force', '--volumes', name], {
        stdio: 'ignore',
        timeout: 15000,
      });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 3) {
    console.error(
      'Usage: pnpm release:rehearse:onboarding:local /absolute/private/release-directory',
    );
    process.exitCode = 1;
  } else await rehearse(process.argv[2]);
}
