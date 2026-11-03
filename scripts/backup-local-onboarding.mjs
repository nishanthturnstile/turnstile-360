// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: Explicit private local backup command; no credentials are printed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  mkdirSync,
  openSync,
  readFileSync,
  realpathSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import pg from 'pg';
import { accessAssignmentSchema } from '../packages/turnstile-contracts/dist/index.js';
import {
  fingerprintTables,
  readLocalRelease,
  releasePrivateFiles,
} from './rehearse-local-onboarding-upgrade.mjs';

let stage = 'private-input';
let admin;
try {
  const directory = process.argv[2];
  const [apiImage, webImage] = process.argv.slice(3);
  assert.ok(
    [3, 5].includes(process.argv.length) && isAbsolute(directory),
    'Use an absolute private backup directory and optional matching API/web image pair',
  );
  const candidateImages = {};
  if (apiImage && webImage) {
    for (const [application, reference] of [
      ['api', apiImage],
      ['web', webImage],
    ]) {
      assert.ok(!reference.startsWith('-'));
      const result = spawnSync('docker', ['image', 'inspect', '--format', '{{.Id}}', reference], {
        encoding: 'utf8',
        timeout: 15000,
      });
      assert.equal(result.status, 0, 'Build and verify both candidate images before backup');
      candidateImages[application] = { reference, id: result.stdout.trim() };
    }
  }
  mkdirSync(dirname(directory), { recursive: true, mode: 0o700 });
  const parent = relative(realpathSync('.'), realpathSync(dirname(directory)));
  assert.ok(
    parent === '..' || parent.startsWith('../') || isAbsolute(parent),
    'Keep backups outside the checkout',
  );
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
    assert.ok(Buffer.byteLength(input) <= 4096, 'Bounded private JSON input required');
  }
  const assignment = accessAssignmentSchema.parse(JSON.parse(input));
  assert.ok(
    assignment.enabled && assignment.permissions.includes('turnstile:configuration:manage'),
  );
  const services = ['dms-api', 'turnstile-api', 'turnstile-web'];
  const images = {};
  for (const service of services) {
    const status = spawnSync('docker', ['compose', 'ps', '--all', '--format', 'json', service], {
      encoding: 'utf8',
      timeout: 15000,
    });
    assert.equal(status.status, 0);
    const container = JSON.parse(status.stdout.trim());
    assert.equal(
      container.State,
      'exited',
      'Pause all local application writers before the coherent backup',
    );
    const image = spawnSync('docker', ['inspect', '--format', '{{.Image}}', container.ID], {
      encoding: 'utf8',
      timeout: 15000,
    });
    assert.equal(image.status, 0);
    images[service] = image.stdout.trim();
  }
  mkdirSync(directory, { mode: 0o700 }); // Refuse an existing directory/archive.
  for (const [source, name] of releasePrivateFiles)
    writeFileSync(resolve(directory, name), readFileSync(source), { mode: 0o600, flag: 'wx' });
  const env = readLocalRelease(directory);
  stage = 'existing-verified-account';
  admin = new pg.Pool({ connectionString: env.PROVISION_DATABASE_URL, max: 1 });
  const installed = (
    await admin.query(
      'SELECT tenant_id,customer_key,application_id FROM turnstile.installation WHERE singleton=1',
    )
  ).rows[0];
  assert.deepEqual(installed, {
    tenant_id: env.INSTALLATION_TENANT_ID,
    customer_key: env.INSTALLATION_CUSTOMER_KEY,
    application_id: env.TURNSTILE_APPLICATION_ID,
  });
  const account = (
    await admin.query('SELECT email_verified,banned FROM auth."user" WHERE id = $1', [
      assignment.userId,
    ])
  ).rows[0];
  assert.ok(
    account?.email_verified && !account.banned,
    'An existing verified eligible account is required',
  );
  const previous = (
    await admin.query(
      'SELECT enabled,permissions FROM turnstile.user_access WHERE tenant_id = $1 AND user_id = $2',
      [env.INSTALLATION_TENANT_ID, assignment.userId],
    )
  ).rows[0];
  assert.ok(previous?.enabled && previous.permissions.includes('turnstile:access'));
  assert.ok(
    previous.permissions.every((permission) => assignment.permissions.includes(permission)),
    'Preserve every intended existing permission',
  );
  const fingerprints = await fingerprintTables(admin);
  const roles = (
    await admin.query(
      "SELECT rolname,rolsuper,rolbypassrls,rolcreaterole,rolcreatedb,rolcanlogin FROM pg_roles WHERE rolname LIKE 'thaarei\\_%' ESCAPE '\\' ORDER BY rolname",
    )
  ).rows;
  const installedProductMigrations = (
    await admin.query(
      'SELECT id,hash,created_at FROM turnstile_migrations.__drizzle_migrations ORDER BY id',
    )
  ).rows;
  stage = 'coherent-database-dump';
  const url = new URL(env.PROVISION_DATABASE_URL);
  const partial = resolve(directory, 'database.dump.partial');
  const fd = openSync(partial, 'wx', 0o600);
  try {
    const result = spawnSync(
      'docker',
      [
        'compose',
        'exec',
        '-T',
        'postgres',
        'pg_dump',
        '-U',
        decodeURIComponent(url.username),
        '-d',
        decodeURIComponent(url.pathname.slice(1)),
        '--format=custom',
      ],
      { stdio: ['ignore', fd, 'pipe'], timeout: 120000 },
    );
    assert.equal(result.status, 0, 'Local database dump failed');
  } finally {
    closeSync(fd);
  }
  assert.deepEqual(
    await fingerprintTables(admin),
    fingerprints,
    'Writers changed data during the backup',
  );
  const archive = resolve(directory, 'database.dump');
  renameSync(partial, archive);
  writeFileSync(resolve(directory, 'manager-access.json'), JSON.stringify(assignment), {
    mode: 0o600,
    flag: 'wx',
  });
  writeFileSync(
    resolve(directory, 'operator.json'),
    JSON.stringify({ operatorId: assignment.operatorId }),
    { mode: 0o600, flag: 'wx' },
  );
  writeFileSync(
    resolve(directory, 'manifest.json'),
    JSON.stringify({
      version: 1,
      createdAt: new Date().toISOString(),
      target: 'local-development',
      node: process.version,
      images,
      candidateImages,
      roles,
      installedProductMigrations,
      databaseSha256: createHash('sha256').update(readFileSync(archive)).digest('hex'),
      fingerprints,
    }),
    { mode: 0o600, flag: 'wx' },
  );
  console.log(
    'Coherent local database/configuration backup captured privately. Rehearse its restore before upgrading; no original database rows were changed.',
  );
} catch {
  console.error(
    `Local backup failed (${stage}); keep application writers paused and inspect the private backup directory. Do not treat a partial archive as recoverable.`,
  );
  process.exitCode = 1;
} finally {
  await admin?.end();
}
