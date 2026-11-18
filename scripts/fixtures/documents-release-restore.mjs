// biome-ignore-all lint/suspicious/noUndeclaredEnvVars: Uncached disposable exact-image rehearsal.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { closeSync, openSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import { fingerprintTables } from '../rehearse-local-onboarding-upgrade.mjs';
import { prepareModuleAccess } from './module-access.mjs';
import { seedTurnstileDeployment } from './turnstile-deployment.mjs';

const tables = [
  ['auth', 'user'],
  ['dms', 'application_registration'],
  ['dms', 'document'],
  ['turnstile', 'access_assignment'],
  ['turnstile', 'access_command_receipt'],
  ['turnstile', 'access_context'],
  ['turnstile', 'access_role'],
  ['turnstile', 'access_role_permission'],
  ['turnstile', 'documents_intent'],
  ['turnstile', 'installation'],
  ['turnstile', 'organization_configuration'],
].map(([schemaname, tablename]) => ({ schemaname, tablename }));

function docker(args, options = {}) {
  const result = spawnSync('docker', args, { encoding: 'utf8', timeout: 60000, ...options });
  assert.equal(result.status, 0, `Disposable Documents archive command failed: ${args[0]}`);
  return result.stdout?.trim();
}
const probe = `
import {readFileSync} from 'node:fs';
import {createApplication} from './dist/bootstrap.js';
const input=JSON.parse(readFileSync(0,'utf8'));
const app=await createApplication(false);
try {
  await app.init();
  const server=app.getHttpAdapter().getInstance();
  const responses=[];
  for(const query of input.requests) {
    const response=await server.inject({
      url:query.path, method:query.method??'GET',
      headers:{
        cookie:input.cookie, host:new URL(process.env.AUTH_PUBLIC_ORIGIN).host,
        'x-forwarded-proto':'https',
        ...(query.legacy?{}:{'x-turnstile-access-contract':'3'}),
        ...(query.body?{origin:process.env.AUTH_PUBLIC_ORIGIN,'x-csrf-token':input.csrf}:{}),
      },
      ...(query.body?{payload:query.body}:{}),
    });
    const value=response.json();
    responses.push({
      status:response.statusCode, code:value.code, id:value.id??value.receipt?.id, state:value.receipt?.state,
      digest:value.receipt?.digest, reason:value.reason,
    });
  }
  console.log(JSON.stringify(responses));
} finally { await app.close(); }
`;

export async function verifyDocumentsRestore({
  environment,
  temporary,
  network,
  candidate,
  legacyImage,
  documentId,
  resolved,
  pending,
  cookie,
  csrf,
  clearRateLimits,
}) {
  assert.equal(environment.INSTALLATION_CUSTOMER_KEY, 'auth-fixture');
  const databaseContainer = process.env.ONBOARDING_ARCHIVE_CONTAINER;
  assert.match(databaseContainer ?? '', /^thaarei-auth-test-[a-f0-9]+$/);
  const admin = new pg.Client({ connectionString: environment.PROVISION_DATABASE_URL });
  const targetName = `documents_restore_${randomUUID().replaceAll('-', '')}`;
  const archive = join(temporary, 'documents-archive.dump');
  let target, recoveryDirectory;
  await admin.connect();
  try {
    await admin.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const baseline = await fingerprintTables(admin, tables);
    const { snapshot } = (await admin.query('SELECT pg_export_snapshot() AS snapshot')).rows[0];
    const fd = openSync(archive, 'wx', 0o600);
    try {
      docker(
        [
          'exec',
          databaseContainer,
          'pg_dump',
          '-U',
          'postgres',
          '-d',
          'auth_fixture',
          '--format=custom',
          `--snapshot=${snapshot}`,
        ],
        { stdio: ['ignore', fd, 'pipe'] },
      );
    } finally {
      closeSync(fd);
      await admin.query('ROLLBACK');
    }
    await admin.query(`CREATE DATABASE ${targetName}`);
    await admin.query(`REVOKE ALL ON DATABASE ${targetName} FROM PUBLIC`);
    await admin.query(`GRANT CONNECT ON DATABASE ${targetName} TO thaarei_turnstile_runtime`);
    await admin.query(
      `GRANT CONNECT, CREATE ON DATABASE ${targetName} TO thaarei_turnstile_migrator`,
    );
    const source = openSync(archive, 'r');
    try {
      docker(
        [
          'exec',
          '-i',
          databaseContainer,
          'pg_restore',
          '--exit-on-error',
          '--single-transaction',
          '-U',
          'postgres',
          '-d',
          targetName,
        ],
        { stdio: [source, 'pipe', 'pipe'] },
      );
    } finally {
      closeSync(source);
    }
    function urlFor(raw, inside = false) {
      const url = new URL(raw);
      url.pathname = `/${targetName}`;
      if (inside) {
        url.hostname = databaseContainer;
        url.port = '5432';
      }
      return url.href;
    }
    target = new pg.Client({ connectionString: urlFor(environment.PROVISION_DATABASE_URL) });
    await target.connect();
    assert.deepEqual(
      await fingerprintTables(target, tables),
      baseline,
      'Archive changed owned data',
    );
    console.log('Documents release archive: restored owning table fingerprints');

    const runtime = {
      ...candidate.runtime,
      TURNSTILE_DATABASE_URL: urlFor(environment.TURNSTILE_DATABASE_URL, true),
    };
    const envFile = join(temporary, 'documents-restore-runtime.env');
    async function invoke(image, args, config, files, input) {
      await writeFile(
        envFile,
        Object.entries(config)
          .map(([k, v]) => `${k}=${v}`)
          .join('\n'),
        { mode: 0o600 },
      );
      return docker(
        [
          'run',
          '--rm',
          '-i',
          '--network',
          network,
          '--read-only',
          '--tmpfs',
          '/tmp',
          '--env-file',
          envFile,
          ...[...new Set(files)].flatMap((file) => [
            '--mount',
            `type=bind,source=${file},target=${file},readonly`,
          ]),
          image,
          'node',
          ...args,
        ],
        input ? { input: JSON.stringify(input) } : {},
      );
    }
    for (const command of ['turnstile', 'bootstrap']) {
      await invoke(
        candidate.image,
        ['dist/infrastructure/database/migrate.js', command],
        {
          ...runtime,
          TURNSTILE_MIGRATION_DATABASE_URL: urlFor(
            environment.TURNSTILE_MIGRATION_DATABASE_URL,
            true,
          ),
        },
        candidate.mounts,
      );
    }
    assert.deepEqual(
      await fingerprintTables(target, tables),
      baseline,
      'Candidate migration rewrote retained rows',
    );
    console.log('Documents release archive: repeat packaged migration and bootstrap');
    const freshMarker = join(temporary, 'documents-rotated-marker');
    await writeFile(freshMarker, randomBytes(36).toString('base64url'), { mode: 0o600 });
    const requests = async (image, items, files = candidate.mounts) => {
      await clearRateLimits();
      const out = await invoke(image, ['--input-type=module', '-e', probe], runtime, files, {
        cookie,
        csrf,
        requests: items,
      });
      return JSON.parse(out.split('\n').at(-1));
    };
    runtime.TURNSTILE_CONTROL_PLANE_RECOVERY_MARKER_FILE = freshMarker;
    const documentPath = `/api/documents/${documentId}`;
    const [readiness, closed] = await requests(
      candidate.image,
      [{ path: '/health/ready/auth' }, { path: documentPath }],
      [...candidate.mounts, freshMarker],
    );
    console.log(
      'Documents release archive: packaged readiness and closed-read status',
      readiness.status,
      readiness.reason,
      closed.status,
      closed.code,
    );
    assert.equal(
      readiness.status,
      200,
      'Database and identity readiness must remain available during recovery',
    );
    assert.equal(
      closed.status,
      403,
      'An older archive must stay closed with a rotated independent marker',
    );
    console.log('Documents release archive: rotated marker keeps the archive closed');

    // The local lab signs a fresh decision for the clone only. The production
    // customer recovery procedure requires its own explicit authority review.
    const restoredEnvironment = {
      ...environment,
      TURNSTILE_MIGRATION_DATABASE_URL: urlFor(environment.TURNSTILE_MIGRATION_DATABASE_URL),
    };
    recoveryDirectory = await seedTurnstileDeployment(restoredEnvironment);
    await prepareModuleAccess(restoredEnvironment);
    // This disposable approval stands in for an independently reviewed online
    // rebind. The deployed rebind owns this clock transition in production.
    const clock = await target.query(
      `UPDATE turnstile.deployment_clock_state
          SET last_time=floor(extract(epoch FROM clock_timestamp())), quarantined=false
        WHERE tenant_id=$1 AND quarantined`,
      [environment.INSTALLATION_TENANT_ID],
    );
    assert.equal(clock.rowCount, 1, 'The older archive must record durable quarantine');
    for (const key of [
      'TURNSTILE_CONTROL_PLANE_ORIGIN',
      'TURNSTILE_CONTROL_PLANE_VERIFICATION_KEYS_FILE',
      'TURNSTILE_CONTROL_PLANE_RECOVERY_MARKER_FILE',
      'TURNSTILE_MODULE_RELEASE_FILE',
      'TURNSTILE_MODULE_RELEASE_TRUST_FILE',
    ])
      runtime[key] = restoredEnvironment[key];
    const mounts = [
      ...candidate.mounts,
      runtime.TURNSTILE_CONTROL_PLANE_VERIFICATION_KEYS_FILE,
      runtime.TURNSTILE_CONTROL_PLANE_RECOVERY_MARKER_FILE,
      runtime.TURNSTILE_MODULE_RELEASE_FILE,
      runtime.TURNSTILE_MODULE_RELEASE_TRUST_FILE,
    ];
    const operation = (receipt) => `/api/documents/operations/${receipt.id}`;
    const [read, completed, held, legacy, deniedRetry] = await requests(
      candidate.image,
      [
        { path: documentPath },
        { path: operation(resolved) },
        { path: operation(pending) },
        { path: '/api/auth/session', legacy: true },
        { path: `${operation(pending)}/execute`, method: 'POST', body: { digest: pending.digest } },
      ],
      mounts,
    );
    console.log(
      'Documents release archive: recovered read, receipts, v2 session and replay statuses',
      [read, completed, held, legacy, deniedRetry].map((result) => [
        result.status,
        result.code,
        result.state,
      ]),
    );
    assert.deepEqual(read, { status: 200, id: documentId });
    assert.deepEqual(completed, {
      status: 200,
      id: resolved.id,
      digest: resolved.digest,
      state: 'RESOLVED',
    });
    assert.deepEqual(held, {
      status: 200,
      id: pending.id,
      digest: pending.digest,
      state: 'UNRESOLVED_REQUIRES_REVIEW',
    });
    assert.equal(legacy.status, 401);
    assert.equal(deniedRetry.status, 410);
    const [old] = await requests(
      legacyImage,
      [{ path: '/health/ready/auth', legacy: true }],
      mounts,
    );
    assert.equal(old.status, 503, 'The previous API must fail readiness against restored v3 state');
    assert.equal(old.reason, 'database_unavailable');

    const owner = new pg.Client({
      connectionString: restoredEnvironment.TURNSTILE_MIGRATION_DATABASE_URL,
    });
    await owner.connect();
    try {
      await owner.query('BEGIN');
      await owner.query("SELECT set_config('app.tenant_id',$1,true)", [
        environment.INSTALLATION_TENANT_ID,
      ]);
      const aged = await owner.query(
        "UPDATE turnstile.documents_intent SET terminal_at=statement_timestamp()-interval '91 days', resolved_at=CASE WHEN state='RESOLVED' THEN statement_timestamp()-interval '91 days' END WHERE id=ANY($1::uuid[])",
        [[resolved.id, pending.id]],
      );
      assert.equal(aged.rowCount, 2);
      await owner.query('COMMIT');
    } finally {
      await owner.end();
    }
    const [pruned, retained, oldKey] = await requests(
      candidate.image,
      [
        { path: operation(resolved) },
        { path: operation(pending) },
        {
          path: `${operation(resolved)}/execute`,
          method: 'POST',
          body: { digest: resolved.digest },
        },
      ],
      mounts,
    );
    assert.equal(pruned.status, 410);
    assert.equal(retained.id, pending.id);
    assert.equal(oldKey.status, 410);
    const row = (
      await target.query('SELECT command FROM turnstile.documents_intent WHERE id=$1', [pending.id])
    ).rows[0];
    assert.equal(row.command, null);
    console.log(
      'Exact Documents archive rehearsal passed: retained setup, identities, grants, documents and receipts; recovery marker, v3 rollback fence and pruning.',
    );
  } finally {
    await target?.end();
    await admin.query(`DROP DATABASE IF EXISTS ${targetName} WITH (FORCE)`);
    await admin.end();
    if (recoveryDirectory) await rm(recoveryDirectory, { recursive: true, force: true });
  }
}
