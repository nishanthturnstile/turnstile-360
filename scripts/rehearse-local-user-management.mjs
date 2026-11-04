// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: Private isolated release rehearsal; credentials remain in environments/protected files.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { closeSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';
import { parse } from 'yaml';
import { provisionDatabase } from './provision-auth-database.mjs';
import { fingerprintTables, readLocalRelease } from './rehearse-local-onboarding-upgrade.mjs';
import {
  replacementCredentials,
  retireDatabaseCredentials,
} from './user-management-credentials.mjs';
import { readCandidateInventory, sha256 } from './user-management-release-inventory.mjs';

let stage = 'private-input';
let admin;
let created = false;
const name = `thaarei-upgrade-rehearsal-${randomBytes(6).toString('hex')}`;
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { encoding: 'utf8', timeout: 180000, ...options });
  assert.equal(result.status, 0, `Private user-management rehearsal operation failed (${stage})`);
  return result.stdout?.trim() ?? '';
}
try {
  const [directory, candidatePath, outputPath, ...extra] = process.argv.slice(2);
  assert.ok(directory && !extra.length);
  const source = readLocalRelease(directory);
  const candidate = readCandidateInventory(
    candidatePath ?? resolve(directory, 'user-management-release.json'),
  );
  const manifest = JSON.parse(readFileSync(resolve(directory, 'manifest.json'), 'utf8'));
  const archive = resolve(directory, 'database.dump');
  assert.equal(sha256(readFileSync(archive)), manifest.databaseSha256);
  const password = randomBytes(48).toString('base64url');
  const image = parse(readFileSync('deploy/compose.local.yaml', 'utf8')).services.postgres.image;
  stage = 'isolated-cluster';
  run(
    'docker',
    [
      'run',
      '--detach',
      '--rm',
      '--name',
      name,
      '--tmpfs',
      '/var/lib/postgresql:rw,size=2g',
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
  assert.ok(ready);
  const environment = {
    ...source,
    PROVISION_DATABASE_URL: `postgresql://postgres:${password}@127.0.0.1:${port}/onboarding_upgrade`,
  };
  for (const owner of ['AUTH', 'DMS', 'TURNSTILE'])
    for (const role of ['runtime', 'migrator']) {
      const key = `${owner}_${role === 'runtime' ? '' : 'MIGRATION_'}DATABASE_URL`;
      environment[key] =
        `postgresql://thaarei_${owner.toLowerCase()}_${role}:${randomBytes(48).toString('base64url')}@127.0.0.1:${port}/onboarding_upgrade`;
    }
  await provisionDatabase(environment);
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
  admin = new pg.Pool({ connectionString: environment.PROVISION_DATABASE_URL, max: 1 });
  assert.deepEqual(await fingerprintTables(admin), manifest.fingerprints);
  const originalInventory = (
    await admin.query('SELECT * FROM turnstile.user_access ORDER BY user_id')
  ).rows;
  const before = (
    await admin.query('SELECT * FROM turnstile.organization_configuration ORDER BY tenant_id')
  ).rows;
  const oldTables = manifest.fingerprints.filter(
    (table) => !table.schemaname.endsWith('_migrations') && table.tablename !== 'access_context',
  );
  const oldContext = manifest.fingerprints.some((table) => table.tablename === 'access_context')
    ? (await admin.query('SELECT to_jsonb(t) AS row FROM turnstile.access_context t')).rows.map(
        (r) => r.row,
      )
    : [];
  stage = 'owning-migrations';
  for (let repeat = 0; repeat < 2; repeat++) {
    for (const owner of ['auth', 'dms'])
      run(process.execPath, ['apps/dms-api/dist/infrastructure/database/migrate.js', owner], {
        env: environment,
      });
    run(
      process.execPath,
      ['apps/turnstile-api/dist/infrastructure/database/migrate.js', 'turnstile'],
      { env: environment },
    );
  }
  // The selected user-management source is the preserved onboarding release;
  // this package does not alter its configuration, clients, accounts or inventory.
  assert.deepEqual(await fingerprintTables(admin, oldTables), oldTables);
  if (oldContext.length) {
    const current = (
      await admin.query('SELECT to_jsonb(t) AS row FROM turnstile.access_context t')
    ).rows.map((r) => r.row);
    assert.deepEqual(
      current.map((row, i) =>
        Object.fromEntries(Object.keys(oldContext[i]).map((key) => [key, row[key]])),
      ),
      oldContext,
    );
  }

  const operator = { operatorId: 'um-release-rehearsal' };
  const access = 'apps/turnstile-api/dist/modules/access/access-operator.js';
  run(process.execPath, [access, 'initialize'], {
    env: environment,
    input: JSON.stringify(operator),
  });
  const imported = run(process.execPath, [access, 'inspect'], {
    env: environment,
    input: JSON.stringify(operator),
  });
  assert.equal(
    JSON.parse(
      run(process.execPath, [access, 'initialize'], {
        env: environment,
        input: JSON.stringify(operator),
      }),
    ).changed,
    false,
  );
  assert.equal(
    run(process.execPath, [access, 'inspect'], {
      env: environment,
      input: JSON.stringify(operator),
    }),
    imported,
  );
  assert.deepEqual(
    (await admin.query('SELECT * FROM turnstile.user_access ORDER BY user_id')).rows,
    originalInventory,
  );
  assert.deepEqual(
    (await admin.query('SELECT * FROM turnstile.organization_configuration ORDER BY tenant_id'))
      .rows,
    before,
  );
  let importedState = (
    await admin.query('SELECT revision,public_writes_enabled FROM turnstile.access_context')
  ).rows[0];
  if (importedState.public_writes_enabled) {
    run(process.execPath, ['apps/turnstile-api/dist/modules/access/release-operator.js', 'close'], {
      env: environment,
      input: JSON.stringify({
        ...operator,
        key: randomUUID(),
        expectedRevision: importedState.revision,
      }),
    });
    importedState = (
      await admin.query('SELECT revision,public_writes_enabled FROM turnstile.access_context')
    ).rows[0];
  }
  assert.equal(importedState.public_writes_enabled, false);
  // Exercise credential retirement only in this disposable cluster. Rotation
  // alone leaves established connections alive; terminate them explicitly.
  stage = 'retired-connections';
  const replacement = replacementCredentials(environment);
  const oldPool = new pg.Pool({ connectionString: environment.TURNSTILE_DATABASE_URL, max: 1 });
  const oldConnection = await oldPool.connect();
  oldConnection.on('error', () => {});
  const closed = new Promise((resolve) => oldConnection.once('end', resolve));
  try {
    await oldConnection.query('SELECT 1');
    const retired = await retireDatabaseCredentials(environment, replacement);
    assert.ok(retired.establishedConnectionsBeforeTermination >= 1);
    assert.ok(retired.terminatedConnections >= 1);
    assert.equal(retired.previousCredentialsDenied, true);
    await Promise.race([
      closed,
      delay(5000).then(() => {
        throw new Error('Old connection did not terminate');
      }),
    ]);
  } finally {
    oldConnection.release(true);
    await oldPool.end();
  }
  Object.assign(environment, replacement);
  stage = 'restore-epoch';
  environment.TURNSTILE_INVITATION_RECOVERY_EPOCH = randomBytes(32).toString('base64url');
  const recovery = {
    ...operator,
    key: randomUUID(),
    expectedRevision: importedState.revision,
    incompatibleProcessesStopped: true,
  };
  const command = 'apps/turnstile-api/dist/modules/access/release-operator.js';
  const recovered = JSON.parse(
    run(process.execPath, [command, 'recover'], {
      env: environment,
      input: JSON.stringify(recovery),
    }),
  );
  assert.equal(recovered.publicWritesEnabled, false);
  assert.equal(recovered.ready, true);
  assert.equal(
    JSON.parse(
      run(process.execPath, [command, 'recover'], {
        env: environment,
        input: JSON.stringify(recovery),
      }),
    ).replayed,
    true,
  );
  assert.equal(
    (
      await admin.query(
        "SELECT count(*)::int AS n FROM turnstile.invitation_delivery WHERE payload IS NOT NULL OR state IN ('queued','sending')",
      )
    ).rows[0].n,
    0,
  );
  const preserved = oldTables.filter(
    (table) =>
      !['access_audit', 'access_command_receipt'].includes(table.tablename) &&
      !table.tablename.startsWith('invitation'),
  );
  assert.deepEqual(await fingerprintTables(admin, preserved), preserved);
  stage = 'synthetic-archive-matrix';
  run(
    'pnpm',
    [
      '--filter',
      '@thaarei/turnstile-api',
      'test:database',
      'test/user-management-upgrade.database-spec.ts',
    ],
    {
      env: {
        ...environment,
        AUTH_PROFILE: 'test',
        NODE_ENV: 'test',
        ONBOARDING_ARCHIVE_CONTAINER: name,
      },
    },
  );
  writeFileSync(
    outputPath ?? resolve(directory, 'user-management-rehearsal.json'),
    `${JSON.stringify({ version: 1, releaseId: candidate.releaseId, sourceArchiveSha256: manifest.databaseSha256, legacyInventoryPreserved: true, existingIdentitySetupPreserved: true, retiredCredentialsAndConnectionsDenied: true, restoreEpochRotated: true, mailQuarantined: true, publicWritersOpened: false, syntheticArchiveCases: 6 }, null, 2)}\n`,
    { mode: 0o600, flag: 'wx' },
  );
  console.log(
    'User-management archive rehearsal passed: exact legacy/setup/identity preservation, compiled owning commands, retired credentials/connections, external epoch quarantine and six synthetic upgrade round trips. Only the isolated clone changed.',
  );
} catch {
  console.error(
    `User-management rehearsal failed (${stage}); the original installation and archive were not modified.`,
  );
  process.exitCode = 1;
} finally {
  await admin?.end();
  if (created)
    spawnSync('docker', ['rm', '--force', '--volumes', name], { stdio: 'ignore', timeout: 15000 });
}
