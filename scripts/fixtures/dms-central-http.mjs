import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import pg from 'pg';
import { provisionDatabase } from '../provision-auth-database.mjs';
import { verifyProductKeyRecovery } from './control-plane-key-recovery.mjs';
import { verifyContainerReporter } from './control-plane-reporter.mjs';
// Separate owning DMS database/roles and real central HTTPS. No cross-database business reads.
export async function verifyDmsCentralHttp({
  admin,
  origin,
  publicTrust,
  temporary,
  env,
  run,
  freePort,
  network,
  postgres,
  centralUnavailable,
  dropRotation,
  dropReport,
  qualifyRecovery = false,
  containerQualification = false,
  signerFile,
}) {
  const root = resolve(import.meta.dirname, '../..');
  await run('pnpm', ['exec', 'turbo', 'run', 'build', '--filter=@thaarei/dms-api']);
  const provision = new pg.Client({ connectionString: env.CONTROL_PLANE_PROVISION_DATABASE_URL });
  await provision.connect();
  try {
    await provision.query('CREATE DATABASE dms_protocol_fixture');
  } finally {
    await provision.end();
  }
  const source = new URL(env.CONTROL_PLANE_PROVISION_DATABASE_URL);
  source.pathname = '/dms_protocol_fixture';
  const port = await freePort();
  const dmsOrigin = `http://127.0.0.1:${port}`;
  const config = {
    PATH: process.env.PATH,
    NODE_OPTIONS: env.NODE_OPTIONS,
    NODE_ENV: 'test',
    DATABASE_PROFILE: 'dms',
    PROVISION_DATABASE_URL: source.href,
    INSTALLATION_TENANT_ID: randomUUID(),
    INSTALLATION_CUSTOMER_KEY: 'tcp-i05-fixture',
    AUTH_MODE: 'standalone',
    AUTH_PROFILE: 'test',
    AUTH_LOGIN_CLIENTS: '[]',
    AUTH_PUBLIC_ORIGIN: dmsOrigin,
    AUTH_ISSUER_URL: `${dmsOrigin}/identity`,
    DMS_RESOURCE_URL: `${dmsOrigin}/v1`,
    AUTH_SECRET: randomBytes(48).toString('base64url'),
    AUTH_SMTP_HOST: '127.0.0.1',
    AUTH_SMTP_PORT: new URL(env.CONTROL_PLANE_SMTP_URL).port,
    AUTH_SMTP_MODE: 'plain',
    AUTH_MAIL_FROM: 'dms@fixture.test',
    HOST: '127.0.0.1',
    PORT: String(port),
    CONTROL_PLANE_ORIGIN: origin,
    CONTROL_PLANE_VERIFICATION_KEYS_FILE: join(temporary, 'dms-public-trust.json'),
    CONTROL_PLANE_RECOVERY_MARKER_FILE: join(temporary, 'dms-recovery-marker'),
    CONTROL_PLANE_MACHINE_SECRET_FILE: join(temporary, 'dms-private', 'product.json'),
    NODE_EXTRA_CA_CERTS: join(temporary, 'cert.pem'),
  };
  for (const owner of ['auth', 'dms'])
    for (const kind of ['runtime', 'migrator']) {
      const u = new URL(source);
      u.username = `thaarei_${owner}_${kind}`;
      u.password = randomBytes(36).toString('base64url');
      config[`${owner.toUpperCase()}_${kind === 'runtime' ? '' : 'MIGRATION_'}DATABASE_URL`] =
        u.href;
    }
  for (const kind of ['coordinator', 'operator']) {
    const u = new URL(source);
    u.username = `thaarei_dms_${kind}`;
    u.password = randomBytes(36).toString('base64url');
    config[`DMS_${kind.toUpperCase()}_DATABASE_URL`] = u.href;
  }
  await provisionDatabase(config);
  for (const owner of ['auth', 'dms'])
    await run(process.execPath, ['apps/dms-api/dist/infrastructure/database/migrate.js', owner], {
      env: config,
    });
  await run(
    process.execPath,
    ['apps/dms-api/dist/infrastructure/database/migrate.js', 'bootstrap'],
    { env: config },
  );
  await mkdir(join(temporary, 'dms-private'), { mode: 0o700 });
  await writeFile(config.CONTROL_PLANE_VERIFICATION_KEYS_FILE, JSON.stringify(publicTrust), {
    mode: 0o600,
  });
  await writeFile(
    config.CONTROL_PLANE_RECOVERY_MARKER_FILE,
    randomBytes(36).toString('base64url'),
    { mode: 0o600 },
  );
  const cli = async (input, expected = 0) => {
    const child = spawn(process.execPath, ['apps/dms-api/dist/modules/deployment/operator.js'], {
      env: config,
      cwd: root,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let error = '';
    child.stderr.on('data', (chunk) => {
      error += chunk;
    });
    child.stdin.end(JSON.stringify(input));
    const code = await new Promise((done) => child.on('close', done));
    assert.equal(code, expected, error);
  };
  const manifestFile = join(temporary, 'dms-local-manifest.json');
  await cli({
    action: 'manifest',
    outputFile: manifestFile,
    environment: 'fixture',
    buildVersion: '0.20.0-tcp-i05',
  });
  const local = JSON.parse(await readFile(manifestFile, 'utf8'));
  const staff = async (body) => {
    const r = await admin.call('/api/registry', {
      requestId: randomUUID(),
      reason: 'isolated DMS integration',
      ...body,
    });
    assert.equal(r.status, 200, r.text);
    return r.json();
  };
  const client = await staff({
    type: 'client.create',
    code: `DMS-${randomBytes(6).toString('hex')}`,
    name: 'DMS HTTP fixture',
  });
  const installation = await staff({
    type: 'installation.create',
    clientId: client.clientId,
    environment: 'fixture',
    label: 'DMS protocol fixture',
    localInstallationId: local.localInstallationId,
    tenantId: local.tenantId,
  });
  const product = await staff({
    type: 'product.create',
    clientId: client.clientId,
    installationId: installation.resourceId,
    binding: { product: 'dms', applicationId: null },
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
    reason: 'isolated real DMS setup',
  });
  assert.equal(issued.status, 200, issued.text);
  const pairing = join(temporary, 'dms-pairing.json');
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
  await cli({ action: 'setup', pairingFile: pairing });
  const apiEnv = { ...config };
  for (const key of Object.keys(apiEnv))
    if (
      key.includes('MIGRATION_DATABASE_URL') ||
      key === 'PROVISION_DATABASE_URL' ||
      key === 'DMS_COORDINATOR_DATABASE_URL' ||
      key === 'DMS_OPERATOR_DATABASE_URL' ||
      key === 'CONTROL_PLANE_MACHINE_SECRET_FILE'
    )
      delete apiEnv[key];
  let child;
  let container;
  const image = process.env.DMS_CONTROL_TEST_IMAGE;
  try {
    if (image) {
      for (const owner of ['AUTH', 'DMS']) {
        const key = `${owner}_DATABASE_URL`;
        apiEnv[key] = apiEnv[key].replace(source.host, `${postgres}:5432`);
      }
      apiEnv.HOST = '0.0.0.0';
      apiEnv.PORT = '3001';
      apiEnv.CONTROL_PLANE_VERIFICATION_KEYS_FILE = '/run/dms-public-trust';
      apiEnv.CONTROL_PLANE_RECOVERY_MARKER_FILE = '/run/dms-marker';
      delete apiEnv.NODE_EXTRA_CA_CERTS;
      const file = join(temporary, 'dms-api-runtime.env');
      await writeFile(
        file,
        Object.entries(apiEnv)
          .filter(([key]) =>
            /^(AUTH_|DMS_|INSTALLATION_|CONTROL_PLANE_|HOST$|PORT$|NODE_ENV$)/.test(key),
          )
          .map(([k, v]) => `${k}=${v}`)
          .join('\n'),
        { mode: 0o600 },
      );
      container = `${network}-dms-api`;
      await run('docker', [
        'run',
        '--detach',
        '--rm',
        '--name',
        container,
        '--network',
        network,
        '-p',
        `127.0.0.1:${port}:3001`,
        '--read-only',
        '--tmpfs',
        '/tmp',
        '--cap-drop',
        'ALL',
        '--security-opt',
        'no-new-privileges:true',
        '--env-file',
        file,
        '--mount',
        `type=bind,source=${config.CONTROL_PLANE_VERIFICATION_KEYS_FILE},target=/run/dms-public-trust,readonly`,
        '--mount',
        `type=bind,source=${config.CONTROL_PLANE_RECOVERY_MARKER_FILE},target=/run/dms-marker,readonly`,
        image,
      ]);
    } else
      child = spawn(process.execPath, ['apps/dms-api/dist/main.api.js'], {
        env: apiEnv,
        cwd: root,
        stdio: 'ignore',
      });
    for (let i = 0; i < 100; i++) {
      try {
        if ((await fetch(`${dmsOrigin}/health/live`)).ok) break;
      } catch {}
      if (i === 99) throw new Error('DMS API fixture unavailable');
      await new Promise((done) => setTimeout(done, 100));
    }
    const status = async () => {
      const r = await fetch(`${dmsOrigin}/health/deployment`);
      assert.equal(r.status, 200);
      return r.json();
    };
    assert.equal((await status()).access, 'closed', 'Pairing is not approval');
    let revision = 1;
    const policy = async (decision) => {
      await staff({ type: 'product.policy', id: product.resourceId, revision, decision });
      revision++;
    };
    await policy('approve');
    await cli({ action: 'sync' });
    const approved = await status();
    assert.equal(approved.access, 'full', JSON.stringify(approved));
    await cli({ action: 'sync' });
    const secret = JSON.parse(await readFile(config.CONTROL_PLANE_MACHINE_SECRET_FILE, 'utf8'))
      .current.secret;
    assert.equal(
      (await fetch(`${dmsOrigin}/v1/documents`, { headers: { authorization: `Bearer ${secret}` } }))
        .status,
      401,
      'Central credential never authenticates a local consumer',
    );
    dropRotation();
    await cli({ action: 'rotate' }, 1);
    await cli({ action: 'sync' });
    const rotated = JSON.parse(await readFile(config.CONTROL_PLANE_MACHINE_SECRET_FILE, 'utf8'));
    assert.equal(rotated.current.generation, 2);
    assert.equal(rotated.operation, null);
    await policy('suspend');
    assert.equal((await status()).access, 'full', 'Suspension applies at contact');
    await cli({ action: 'sync' });
    assert.equal((await status()).access, 'existing-reads');
    await policy('approve');
    await cli({ action: 'sync' });
    const scheduledSource = () =>
      run(
        process.execPath,
        [
          '--input-type=module',
          '-e',
          "import pg from 'pg'; import {startDeploymentReporter} from './apps/dms-api/dist/modules/deployment/reporter.js'; const pool=new pg.Pool({connectionString:process.env.DMS_COORDINATOR_DATABASE_URL,max:5});const stop=startDeploymentReporter(pool,process.env.INSTALLATION_TENANT_ID);await new Promise(resolve=>setTimeout(resolve,500));await stop();await pool.end();",
        ],
        { env: { ...config, DMS_BUILD_VERSION: 'tcp-i07' } },
      );
    const sourceDb = new pg.Pool({ connectionString: config.DMS_MIGRATION_DATABASE_URL, max: 1 });
    const journal = async () => {
      const db = await sourceDb.connect();
      try {
        await db.query('BEGIN');
        await db.query("SELECT set_config('app.tenant_id',$1,true)", [local.tenantId]);
        const metadata = (
          await db.query(
            "UPDATE dms.deployment_control SET credential_metadata=credential_metadata-'nextAttemptAt' RETURNING credential_metadata",
          )
        ).rows[0].credential_metadata;
        await db.query('COMMIT');
        return metadata;
      } finally {
        db.release();
      }
    };
    const scheduled = async () => {
      if (!containerQualification) return scheduledSource();
      await journal();
      await verifyContainerReporter({
        product: 'dms',
        image,
        config: { ...config, DMS_BUILD_VERSION: 'tcp-i07' },
        temporary,
        network,
        postgres,
        run,
        completed: async () => {
          const db = await sourceDb.connect();
          try {
            await db.query('BEGIN');
            await db.query("SELECT set_config('app.tenant_id',$1,true)", [local.tenantId]);
            const metadata = (
              await db.query('SELECT credential_metadata FROM dms.deployment_control')
            ).rows[0].credential_metadata;
            await db.query('COMMIT');
            return Boolean(metadata.nextAttemptAt);
          } finally {
            db.release();
          }
        },
      });
    };
    try {
      dropReport();
      await scheduled();
      const pending = await journal();
      assert.equal(pending.reportFailures, 1);
      assert.ok(pending.report.report.sequence >= 1);
      const firstReport = await admin.call(`/api/reports/products/${product.resourceId}`);
      assert.equal(firstReport.status, 200, firstReport.text);
      assert.equal(
        firstReport.json().items.length,
        1,
        'Actual reporter committed despite lost response',
      );
      // Restarting the owning process replays the exact durable payload despite intervening suspension.
      await policy('suspend');
      await scheduled();
      const metadata = await journal();
      assert.equal(metadata.report, null);
      assert.equal(metadata.reportFailures, 0);
      const reports = await admin.call(`/api/reports/products/${product.resourceId}`);
      assert.equal(reports.status, 200, reports.text);
      assert.equal(reports.json().items.length, 1);
      assert.equal(reports.json().product.report?.product, 'dms');
      assert.equal(reports.json().product.report?.activeDocuments, 0);
      assert.equal(reports.json().product.report?.counters.publishedDocuments, 0);
      assert.equal(reports.json().product.sequence, pending.report.report.sequence);
      assert.equal((await status()).access, 'existing-reads');
      await policy('approve');
      await cli({ action: 'sync' });
    } finally {
      await sourceDb.end();
    }
    const rebind = async (reason) => {
      const newCode = randomBytes(32).toString('base64url'),
        newPairing = randomUUID();
      const replaced = await admin.call('/api/pairing', {
        requestId: randomUUID(),
        productId: product.resourceId,
        revision,
        action: 'replace',
        pairingId: newPairing,
        code: newCode,
        reason: reason,
      });
      assert.equal(replaced.status, 200, replaced.text);
      revision++;
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
      assert.equal((await status()).access, 'closed');
      await policy('approve');
      await cli({ action: 'sync' });
      assert.equal((await status()).access, 'full');
    };
    if (containerQualification) {
      const owner = new pg.Pool({ connectionString: config.DMS_MIGRATION_DATABASE_URL, max: 1 });
      const withOwner = async (work) => {
        const db = await owner.connect();
        try {
          await db.query('BEGIN');
          await db.query("SELECT set_config('app.tenant_id',$1,true)", [local.tenantId]);
          const value = await work(db);
          await db.query('COMMIT');
          return value;
        } catch (error) {
          await db.query('ROLLBACK');
          throw error;
        } finally {
          db.release();
        }
      };
      try {
        await verifyProductKeyRecovery({
          signerFile,
          trust: publicTrust,
          trustFile: config.CONTROL_PLANE_VERIFICATION_KEYS_FILE,
          status,
          sync: () => cli({ action: 'sync' }),
          rebind,
          centralUnavailable,
          loadState: () =>
            withOwner(async (db) => {
              const row = (await db.query('SELECT decision,binding FROM dms.deployment_control'))
                .rows[0];
              return { state: row.decision, binding: row.binding };
            }),
          saveState: (state) =>
            withOwner((db) =>
              db.query('UPDATE dms.deployment_control SET decision=$1', [JSON.stringify(state)]),
            ),
        });
      } finally {
        await owner.end();
      }
    }
    if (qualifyRecovery) {
      const backup = await run('docker', [
        'exec',
        postgres,
        'pg_dump',
        '-U',
        'postgres',
        '-d',
        'dms_protocol_fixture',
        '--clean',
        '--if-exists',
      ]);
      const privateBackup = await readFile(config.CONTROL_PLANE_MACHINE_SECRET_FILE, 'utf8');
      await policy('suspend');
      await cli({ action: 'sync' });
      assert.equal((await status()).access, 'existing-reads');
      await writeFile(
        config.CONTROL_PLANE_RECOVERY_MARKER_FILE,
        randomBytes(36).toString('base64url'),
        { mode: 0o600 },
      );
      assert.equal(
        (await status()).access,
        'closed',
        'External marker closes business before database restore',
      );
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
          '-v',
          'VERBOSITY=sqlstate',
          '-U',
          'postgres',
          '-d',
          'dms_protocol_fixture',
        ],
        { stdio: ['pipe', 'ignore', 'pipe'] },
      );
      let restoreCodes = '';
      restoring.stderr.on('data', (chunk) => {
        restoreCodes +=
          String(chunk)
            .match(/ERROR: {2}[A-Z0-9]{5}/g)
            ?.join(' ') ?? '';
      });
      restoring.stdin.end(backup);
      assert.equal(
        await new Promise((resolve) => restoring.once('close', resolve)),
        0,
        `Owning DMS database restore failed (${restoreCodes})`,
      );
      await writeFile(config.CONTROL_PLANE_MACHINE_SECRET_FILE, privateBackup, { mode: 0o600 });
      assert.equal(
        (await status()).access,
        'closed',
        'Restored database and private journal cannot revive old approval',
      );
      await centralUnavailable(async () => {
        await cli({ action: 'sync' }, 1);
        assert.equal((await status()).access, 'closed');
      });
      await rebind('Isolated pre-denial customer restore');
      console.log(
        'DMS actual pre-denial SQL/private-journal restore: external marker, disconnected quarantine, reviewed rebind and explicit reapproval passed.',
      );
    }
    await centralUnavailable(async () => {
      await cli({ action: 'sync' }, 1);
      assert.equal((await status()).access, 'full');
      assert.equal(
        (await fetch(`${dmsOrigin}/identity/.well-known/openid-configuration`)).status,
        200,
      );
    });
    await cli({ action: 'sync' });
    console.log(
      `DMS central HTTPS${image ? ' / packaged API' : ''}: owned bootstrap/export, real pairing, signed approval, lost rotation response, suspension/read exception, reapproval, credential isolation and independent central outage passed.`,
    );
    return {
      clientId: client.clientId,
      installationId: installation.resourceId,
      localInstallationId: local.localInstallationId,
      tenantId: local.tenantId,
      customerKey: config.INSTALLATION_CUSTOMER_KEY,
    };
  } finally {
    if (child) {
      if (child.exitCode === null && child.signalCode === null) {
        const exited = new Promise((done) => child.once('exit', done));
        child.kill('SIGTERM');
        await exited;
      }
    }
    if (container) await run('docker', ['rm', '--force', container]).catch(() => {});
  }
}
