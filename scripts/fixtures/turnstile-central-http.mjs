import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import pg from 'pg';
import { evaluateDecision } from '../../packages/deployment-control/dist/index.js';
import { provisionDatabase } from '../provision-auth-database.mjs';
import { verifyContainerReporter } from './control-plane-reporter.mjs';
export async function verifyTurnstileCentralHttp({
  installationBinding,
  admin,
  origin,
  publicTrust,
  temporary,
  env,
  run,
  dropRotation,
  centralUnavailable,
  postgres,
  network,
  qualifyRecovery = false,
  containerQualification = false,
}) {
  const root = resolve(import.meta.dirname, '../..');
  await run('pnpm', ['exec', 'turbo', 'run', 'build', '--filter=@thaarei/turnstile-api']);
  const adminDb = new pg.Client({ connectionString: env.CONTROL_PLANE_PROVISION_DATABASE_URL });
  await adminDb.connect();
  try {
    await adminDb.query('CREATE DATABASE turnstile_protocol_fixture');
  } finally {
    await adminDb.end();
  }
  const source = new URL(env.CONTROL_PLANE_PROVISION_DATABASE_URL);
  source.pathname = '/turnstile_protocol_fixture';
  const config = {
    PATH: process.env.PATH,
    NODE_OPTIONS: env.NODE_OPTIONS,
    DATABASE_PROFILE: 'turnstile',
    PROVISION_DATABASE_URL: source.href,
    INSTALLATION_TENANT_ID: installationBinding.tenantId,
    INSTALLATION_LOCAL_ID: installationBinding.localInstallationId,
    INSTALLATION_CUSTOMER_KEY: installationBinding.customerKey,
    TURNSTILE_APPLICATION_ID: randomUUID(),
    TURNSTILE_CONTROL_PLANE_ORIGIN: origin,
    TURNSTILE_CONTROL_PLANE_MACHINE_SECRET_FILE: join(
      temporary,
      'turnstile-private',
      'product.json',
    ),
    TURNSTILE_CONTROL_PLANE_VERIFICATION_KEYS_FILE: join(temporary, 'turnstile-public-trust.json'),
    TURNSTILE_CONTROL_PLANE_RECOVERY_MARKER_FILE: join(temporary, 'turnstile-marker'),
    NODE_EXTRA_CA_CERTS: join(temporary, 'cert.pem'),
  };
  for (const kind of ['runtime', 'migrator', 'reporter']) {
    const url = new URL(source);
    url.username = `thaarei_turnstile_${kind}`;
    url.password = randomBytes(32).toString('base64url');
    config[
      kind === 'runtime'
        ? 'TURNSTILE_DATABASE_URL'
        : kind === 'migrator'
          ? 'TURNSTILE_MIGRATION_DATABASE_URL'
          : 'TURNSTILE_REPORTER_DATABASE_URL'
    ] = url.href;
  }
  await provisionDatabase(config);
  for (const action of ['turnstile', 'bootstrap'])
    await run(
      process.execPath,
      ['apps/turnstile-api/dist/infrastructure/database/migrate.js', action],
      { env: config },
    );
  await mkdir(join(temporary, 'turnstile-private'), { mode: 0o700 });
  await writeFile(
    config.TURNSTILE_CONTROL_PLANE_VERIFICATION_KEYS_FILE,
    JSON.stringify(publicTrust),
    { mode: 0o600 },
  );
  await writeFile(
    config.TURNSTILE_CONTROL_PLANE_RECOVERY_MARKER_FILE,
    randomBytes(36).toString('base64url'),
    { mode: 0o600 },
  );
  const cli = async (input, expected = 0) => {
    const child = spawn(
      process.execPath,
      ['apps/turnstile-api/dist/modules/deployment/operator.js'],
      { cwd: root, env: config, stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let error = '';
    child.stderr.on('data', (c) => {
      error += c;
    });
    child.stdin.end(JSON.stringify(input));
    assert.equal(await new Promise((done) => child.on('close', done)), expected, error);
  };
  const localFile = join(temporary, 'turnstile-manifest.json');
  await cli({
    action: 'manifest',
    outputFile: localFile,
    environment: 'fixture',
    buildVersion: 'tcp-i06',
  });
  const local = JSON.parse(await readFile(localFile, 'utf8'));
  const staff = async (body) => {
    const r = await admin.call('/api/registry', {
      requestId: randomUUID(),
      reason: 'isolated Turnstile integration',
      ...body,
    });
    assert.equal(r.status, 200, r.text);
    return r.json();
  };
  assert.equal(local.localInstallationId, installationBinding.localInstallationId);
  assert.equal(local.tenantId, installationBinding.tenantId);
  const client = { clientId: installationBinding.clientId };
  const installation = { resourceId: installationBinding.installationId };
  const product = await staff({
    type: 'product.create',
    clientId: client.clientId,
    installationId: installation.resourceId,
    binding: { product: 'turnstile', applicationId: local.applicationId },
  });
  const exported = (
    await admin.call(`/api/registry/products/${product.resourceId}/manifest`)
  ).json();
  const code = randomBytes(32).toString('base64url'),
    pairingId = randomUUID();
  const issued = await admin.call('/api/pairing', {
    requestId: randomUUID(),
    productId: product.resourceId,
    revision: 1,
    action: 'issue',
    pairingId,
    code,
    reason: 'isolated private Turnstile setup',
  });
  assert.equal(issued.status, 200, issued.text);
  const pairing = join(temporary, 'turnstile-pairing.json');
  await writeFile(
    pairing,
    JSON.stringify({
      version: 1,
      origin,
      binding: exported.binding,
      pairingId,
      code,
      expiresAt: issued.json().expiresAt,
    }),
    { mode: 0o600 },
  );
  const database = new pg.Pool({ connectionString: config.TURNSTILE_DATABASE_URL, max: 1 });
  const status = async () => {
    const db = await database.connect();
    try {
      await db.query('BEGIN');
      await db.query("SELECT set_config('app.tenant_id',$1,true)", [local.tenantId]);
      const row = (await db.query('SELECT turnstile.deployment_read() AS value')).rows[0].value;
      await db.query('COMMIT');
      return evaluateDecision(
        row.decision,
        row.binding,
        publicTrust,
        Math.floor(Date.now() / 1000),
      );
    } finally {
      db.release();
    }
  };
  try {
    await cli({ action: 'setup', pairingFile: pairing });
    assert.equal((await status()).access, 'closed');
    await staff({
      type: 'product.policy',
      id: product.resourceId,
      revision: 1,
      decision: 'approve',
    });
    await cli({ action: 'sync' });
    assert.equal((await status()).access, 'full');
    dropRotation();
    await cli({ action: 'rotate' }, 1);
    await cli({ action: 'sync' });
    const file = JSON.parse(
      await readFile(config.TURNSTILE_CONTROL_PLANE_MACHINE_SECRET_FILE, 'utf8'),
    );
    assert.equal(file.current.generation, 2);
    assert.equal(file.operation, null);
    await staff({
      type: 'product.policy',
      id: product.resourceId,
      revision: 2,
      decision: 'suspend',
    });
    await cli({ action: 'sync' });
    assert.equal((await status()).access, 'existing-reads');
    await staff({
      type: 'product.policy',
      id: product.resourceId,
      revision: 3,
      decision: 'approve',
    });
    await cli({ action: 'sync' });
    if (containerQualification) {
      const reporterDb = new pg.Pool({
        connectionString: config.TURNSTILE_MIGRATION_DATABASE_URL,
        max: 1,
      });
      try {
        await verifyContainerReporter({
          product: 'turnstile',
          // biome-ignore lint/suspicious/noUndeclaredEnvVars: Uncached fixture candidate reference.
          image: process.env.TURNSTILE_CONTROL_TEST_IMAGE,
          config: { ...config, TURNSTILE_BUILD_VERSION: 'tcp-i06' },
          temporary,
          network,
          postgres,
          run,
          completed: async () => {
            const db = await reporterDb.connect();
            try {
              await db.query('BEGIN');
              await db.query("SELECT set_config('app.tenant_id',$1,true)", [local.tenantId]);
              const metadata = (
                await db.query('SELECT credential_metadata FROM turnstile.deployment_control')
              ).rows[0].credential_metadata;
              await db.query('COMMIT');
              return Boolean(metadata.nextAttemptAt);
            } finally {
              db.release();
            }
          },
        });
      } finally {
        await reporterDb.end();
      }
    } else
      await run(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          "import {startReporter} from './apps/turnstile-api/dist/modules/deployment/reporter.js'; const stop=startReporter(); await new Promise(resolve=>setTimeout(resolve,300)); await stop();",
        ],
        { env: { ...config, TURNSTILE_BUILD_VERSION: 'tcp-i06' } },
      );
    const reportConnection = await database.connect();
    try {
      await reportConnection.query('BEGIN');
      await reportConnection.query("SELECT set_config('app.tenant_id',$1,true)", [local.tenantId]);
      const metadata = (
        await reportConnection.query('SELECT credential_metadata FROM turnstile.deployment_control')
      ).rows[0].credential_metadata;
      assert.equal(
        metadata.reportFailures,
        0,
        'The actual scheduled SQL aggregate must be accepted over central HTTPS',
      );
      assert.ok(Date.parse(metadata.nextAttemptAt) > Date.now());
      await reportConnection.query('COMMIT');
    } finally {
      reportConnection.release();
    }
    const reports = await admin.call(`/api/reports/products/${product.resourceId}`);
    assert.equal(reports.status, 200, reports.text);
    assert.equal(reports.json().product.report?.product, 'turnstile');
    assert.equal(reports.json().product.report?.activeMembers, 0);
    assert.equal(reports.json().product.versionReview, 'accepted');
    assert.ok(reports.json().product.sequence >= 1);
    if (qualifyRecovery) {
      const backup = await run('docker', [
        'exec',
        postgres,
        'pg_dump',
        '-U',
        'postgres',
        '-d',
        'turnstile_protocol_fixture',
        '--clean',
        '--if-exists',
      ]);
      const journal = await readFile(config.TURNSTILE_CONTROL_PLANE_MACHINE_SECRET_FILE, 'utf8');
      const preflight = async () =>
        JSON.parse(
          await run(
            process.execPath,
            [
              '--input-type=module',
              '-e',
              "import {createPool} from './apps/turnstile-api/dist/infrastructure/database/postgres.js';import{deploymentPreflight}from './apps/turnstile-api/dist/modules/deployment/access.js';const pool=createPool(process.env.TURNSTILE_DATABASE_URL);try{try{await deploymentPreflight(pool,process.env.INSTALLATION_TENANT_ID,'full');console.log(JSON.stringify({access:'full'}));}catch{console.log(JSON.stringify({access:'closed'}));}}finally{await pool.end();}",
            ],
            { env: config },
          ),
        );
      assert.equal((await preflight()).access, 'full');
      await staff({
        type: 'product.policy',
        id: product.resourceId,
        revision: 4,
        decision: 'suspend',
      });
      await cli({ action: 'sync' });
      await writeFile(
        config.TURNSTILE_CONTROL_PLANE_RECOVERY_MARKER_FILE,
        randomBytes(36).toString('base64url'),
        { mode: 0o600 },
      );
      assert.equal((await preflight()).access, 'closed');
      const restoring = spawn(
        'docker',
        [
          'exec',
          '-i',
          postgres,
          'psql',
          '-X',
          '-v',
          'ON_ERROR_STOP=1',
          '-U',
          'postgres',
          '-d',
          'turnstile_protocol_fixture',
        ],
        { stdio: ['pipe', 'ignore', 'ignore'] },
      );
      restoring.stdin.end(backup);
      assert.equal(
        await new Promise((resolve) => restoring.once('close', resolve)),
        0,
        'Turnstile owning database restore failed',
      );
      await writeFile(config.TURNSTILE_CONTROL_PLANE_MACHINE_SECRET_FILE, journal, { mode: 0o600 });
      assert.equal(
        (await preflight()).access,
        'closed',
        'Restored SQL and private journal stay closed behind the independent marker',
      );
      await centralUnavailable(async () => {
        await cli({ action: 'sync' }, 1);
        assert.equal((await preflight()).access, 'closed');
      });
      const newCode = randomBytes(32).toString('base64url'),
        newPairing = randomUUID();
      const replaced = await admin.call('/api/pairing', {
        requestId: randomUUID(),
        productId: product.resourceId,
        revision: 5,
        action: 'replace',
        pairingId: newPairing,
        code: newCode,
        reason: 'Isolated Turnstile pre-denial database restore',
      });
      assert.equal(replaced.status, 200, replaced.text);
      await writeFile(
        pairing,
        JSON.stringify({
          version: 1,
          origin,
          binding: exported.binding,
          pairingId: newPairing,
          code: newCode,
          expiresAt: replaced.json().expiresAt,
        }),
        { mode: 0o600 },
      );
      await cli({ action: 'rebind', pairingFile: pairing });
      assert.equal((await preflight()).access, 'closed');
      await staff({
        type: 'product.policy',
        id: product.resourceId,
        revision: 6,
        decision: 'approve',
      });
      await cli({ action: 'sync' });
      assert.equal((await preflight()).access, 'full');
      console.log(
        'Turnstile owning PostgreSQL/preflight: pre-denial SQL/private-journal restore, disconnected marker quarantine, rebind and explicit approval passed (direct production preflight; not image HTTP).',
      );
    }
    await centralUnavailable(async () => {
      await cli({ action: 'sync' }, 1);
      assert.equal((await status()).access, 'full');
    });
    console.log(
      'Turnstile central HTTPS: owned manifest/tuple, real private pairing, approval publication/ack, lost rotation response, scheduled SQL aggregate/report acknowledgement, reapproval and independent outage passed.',
    );
  } finally {
    await database.end();
  }
}
