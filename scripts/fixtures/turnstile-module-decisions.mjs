import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decodeJwt, importPKCS8, SignJWT } from 'jose';
import pg from 'pg';
import { DECISION_TYPE } from '../../packages/control-plane-contracts/dist/index.js';
import { provisionDatabase } from '../provision-auth-database.mjs';
import { verifyContainerReporter } from './control-plane-reporter.mjs';

/** Real selected image, owning CLI/store/API evaluator, independent roles and HTTPS ingress.
 * Private SQL seeds initial/restrictive authority; staff activation remains MOD-I08. */
export async function verifyInstalledModuleDecisions({
  fixture,
  admin,
  anonymous,
  database,
  publicTrust,
  temporary,
  env,
  run,
  origin,
  postgres,
  network,
  reauthenticateAdmin,
  dropRotation,
  dropReport,
  centralUnavailable,
}) {
  await reauthenticateAdmin();
  const directory = join(temporary, 'selected-module-installation');
  await mkdir(directory, { mode: 0o700 });
  await mkdir(join(directory, 'private'), { mode: 0o700 });
  const descriptor = JSON.parse(
    await readFile(join(fixture.bundleDirectory, 'delivery.json'), 'utf8'),
  );
  const evidence = decodeJwt(descriptor.attestation);
  const image = `sha256:${evidence.inventory.images.find((i) => i.role === 'turnstile-api').digest}`;
  const provisionUrl = new URL(env.CONTROL_PLANE_PROVISION_DATABASE_URL);
  const adminDb = new pg.Client({ connectionString: provisionUrl.href });
  await adminDb.connect();
  await adminDb.query('CREATE DATABASE turnstile_modules_fixture');
  await adminDb.end();
  provisionUrl.pathname = '/turnstile_modules_fixture';
  const tenant = randomUUID(),
    local = randomUUID(),
    application = randomUUID();
  const config = {
    DATABASE_PROFILE: 'turnstile',
    PROVISION_DATABASE_URL: provisionUrl.href,
    INSTALLATION_TENANT_ID: tenant,
    INSTALLATION_LOCAL_ID: local,
    INSTALLATION_CUSTOMER_KEY: 'module-fixture',
    TURNSTILE_APPLICATION_ID: application,
    TURNSTILE_BUILD_VERSION: 'tcp-i06',
    TURNSTILE_CONTROL_PLANE_ORIGIN: origin,
    TURNSTILE_CONTROL_PLANE_MACHINE_SECRET_FILE: '/qualification/private/product.json',
    TURNSTILE_CONTROL_PLANE_VERIFICATION_KEYS_FILE: '/qualification/central-trust.json',
    TURNSTILE_CONTROL_PLANE_RECOVERY_MARKER_FILE: '/qualification/marker',
    TURNSTILE_MODULE_RELEASE_FILE: '/qualification/module-release.json',
    TURNSTILE_MODULE_RELEASE_TRUST_FILE: '/qualification/release-trust.json',
    NODE_EXTRA_CA_CERTS: '/qualification/ca.pem',
  };
  for (const kind of ['runtime', 'migrator', 'reporter']) {
    const url = new URL(provisionUrl);
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
  const sql = new pg.Pool({
    connectionString: config.TURNSTILE_MIGRATION_DATABASE_URL,
    max: 1,
    options: `-c app.tenant_id=${tenant}`,
  });
  const releaseTrust = {
    version: 1,
    revision: 1,
    issuer: fixture.releaseTrust.issuer,
    keys: fixture.releaseTrust.keys.map((k) => ({
      kid: k.kid,
      pem: k.publicKey,
      status: 'active',
      lastIssuedAt: null,
    })),
  };
  await writeFile(join(directory, 'module-release.json'), JSON.stringify(descriptor), {
    mode: 0o600,
  });
  await writeFile(join(directory, 'release-trust.json'), JSON.stringify(releaseTrust), {
    mode: 0o600,
  });
  await writeFile(join(directory, 'central-trust.json'), JSON.stringify(publicTrust), {
    mode: 0o600,
  });
  await writeFile(join(directory, 'marker'), randomBytes(48).toString('base64url'), {
    mode: 0o600,
  });
  await writeFile(join(directory, 'ca.pem'), await readFile(join(temporary, 'cert.pem')), {
    mode: 0o600,
  });
  const containerConfig = { ...config };
  delete containerConfig.PROVISION_DATABASE_URL;
  for (const key of [
    'TURNSTILE_DATABASE_URL',
    'TURNSTILE_MIGRATION_DATABASE_URL',
    'TURNSTILE_REPORTER_DATABASE_URL',
  ]) {
    const url = new URL(config[key]);
    url.host = `${postgres}:5432`;
    containerConfig[key] = url.href;
  }
  const envFiles = {};
  for (const role of ['bootstrap', 'operator', 'runtime']) {
    const scoped = Object.fromEntries(
      Object.entries(containerConfig).filter(([key]) => {
        if (!key.endsWith('_DATABASE_URL')) return true;
        return (
          key ===
          (role === 'bootstrap'
            ? 'TURNSTILE_MIGRATION_DATABASE_URL'
            : role === 'operator'
              ? 'TURNSTILE_REPORTER_DATABASE_URL'
              : 'TURNSTILE_DATABASE_URL')
        );
      }),
    );
    envFiles[role] = join(temporary, `selected-${role}.env`);
    await writeFile(
      envFiles[role],
      Object.entries(scoped)
        .map(([key, value]) => `${key}=${value}`)
        .join('\n'),
      { mode: 0o600 },
    );
  }
  // Environment files are private. CLI input and output are never printed on failure.
  const dockerArgs = (role) => [
    'run',
    '--rm',
    '--interactive',
    '--network',
    network,
    '--read-only',
    '--tmpfs',
    '/tmp',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '--env-file',
    envFiles[role],
    ...(role === 'runtime'
      ? [
          'marker',
          'central-trust.json',
          'module-release.json',
          'release-trust.json',
          'ca.pem',
        ].flatMap((file) => [
          '--mount',
          `type=bind,source=${join(directory, file)},target=/qualification/${file},readonly`,
        ])
      : ['--mount', `type=bind,source=${directory},target=/qualification`]),
    image,
  ];
  const invoke = (args, input = '', expected = 0, role = 'operator') =>
    new Promise((resolve, reject) => {
      const child = spawn('docker', [...dockerArgs(role), ...args], {
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let output = '',
        error = '';
      child.stdout.on('data', (c) => {
        output += c;
      });
      child.stderr.on('data', (c) => {
        error += c;
      });
      child.once('error', reject);
      child.stdin.end(input);
      child.once('close', (code) => {
        if (code !== expected) {
          writeFile(join(fixture.bundleDirectory, '../../selected-container-error.log'), error, {
            mode: 0o600,
          }).then(
            () =>
              reject(
                new Error(
                  `Selected image command exit ${code}; expected ${expected}. Inspect private selected-container-error.log in the fixture root`,
                ),
              ),
            reject,
          );
        } else resolve(output.trim());
      });
    });
  const cli = (body, expected = 0) =>
    invoke(['node', 'dist/modules/deployment/operator.js'], JSON.stringify(body), expected);
  const script = (code, expected = 0, role = 'operator') =>
    invoke(['node', '--input-type=module', '-e', code], '', expected, role);
  const status = async (clock = null) =>
    JSON.parse(
      await script(
        `
    ${clock === null ? '' : `Date.now=()=>${clock}*1000;`}
    import {createPool,withTenant} from './dist/infrastructure/database/postgres.js';
    import {deploymentPreflight,deploymentStatus} from './dist/modules/deployment/access.js';
    import {installedModuleRelease} from './dist/modules/deployment/module-release.js';
    import {readProtectedTrust,evaluateModuleDecision} from '@thaarei/deployment-control';
    if(process.env.TURNSTILE_REPORTER_DATABASE_URL || process.env.TURNSTILE_MIGRATION_DATABASE_URL || (await import('node:fs')).existsSync('/qualification/private/product.json')) throw new Error('API qualification must have only its owning SQL credential and public trust');
    const pool=createPool(process.env.TURNSTILE_DATABASE_URL,1), tenant=process.env.INSTALLATION_TENANT_ID;
    try {
      await deploymentPreflight(pool,tenant,'read').catch(()=>{});
      const value=await withTenant(pool,tenant,async db=>{
        const result=await deploymentStatus(db), row=(await db.query('SELECT turnstile.deployment_read() AS snapshot')).rows[0].snapshot;
        let modules=[];
        if(row.decision && result.state!=='reconciliation-required') modules=(await evaluateModuleDecision(row.decision,row.binding,await readProtectedTrust(process.env.TURNSTILE_CONTROL_PLANE_VERIFICATION_KEYS_FILE),Math.floor(Date.now()/1000),await installedModuleRelease())).allowedModuleIds;
        return {...result,allowedModuleIds:modules};
      });process.stdout.write(JSON.stringify(value));
    } finally {await pool.end();}
  `,
        0,
        'runtime',
      ),
    );
  const privateValue = async () =>
    JSON.parse(await readFile(join(directory, 'private/product.json'), 'utf8'));
  const staff = async (body) => {
    const response = await admin.call('/api/registry', {
      requestId: randomUUID(),
      reason: 'selected module qualification',
      ...body,
    });
    assert.equal(response.status, 200, response.text);
    return response.json();
  };
  let id, binding;
  const revision = async () =>
    Number(
      (
        await database.query('SELECT revision FROM control_plane.registry_product WHERE id=$1', [
          id,
        ])
      ).rows[0].revision,
    );
  const pair = async (action = 'issue') => {
    const code = randomBytes(32).toString('base64url'),
      pairingId = randomUUID();
    const response = await admin.call('/api/pairing', {
      requestId: randomUUID(),
      reason: 'selected image pairing',
      productId: id,
      revision: await revision(),
      action,
      code,
      pairingId,
    });
    assert.equal(response.status, 200, response.text);
    await writeFile(
      join(directory, 'pairing.json'),
      JSON.stringify({
        version: 1,
        origin,
        binding,
        pairingId,
        code,
        expiresAt: response.json().expiresAt,
      }),
      { mode: 0o600 },
    );
    await cli({
      action: action === 'replace' ? 'rebind' : 'setup',
      pairingFile: '/qualification/pairing.json',
    });
  };
  const productPolicy = async (decision) =>
    staff({ type: 'product.policy', id, revision: await revision(), decision });
  const installAuthority = async (allowedModuleIds) => {
    const value = await privateValue(),
      profile = fixture.request.profile;
    const active = {
      catalogueDigest: profile.catalogueDigest,
      profileDigest: fixture.request.profileDigest,
      releaseId: evidence.inventory.releaseId,
      assignmentRevision: 2,
      policyRevision: await revision(),
    };
    await database.query(
      'UPDATE control_plane.module_authority SET document=$2 WHERE product_id=$1',
      [
        id,
        JSON.stringify({
          version: 1,
          epoch: value.current.epoch,
          request: fixture.request,
          policy: {
            active,
            desired: {
              catalogueDigest: active.catalogueDigest,
              profileDigest: active.profileDigest,
              assignmentRevision: 2,
            },
            changeAssignmentRevision: 2,
            allowedModuleIds,
          },
        }),
      ],
    );
    await database.query(
      'UPDATE control_plane.registry_product SET revision=revision+1 WHERE id=$1',
      [id],
    );
  };
  const saveAttempt = (expected = 7) =>
    script(
      `
    import {readFile} from 'node:fs/promises';
    import {createPool} from './dist/infrastructure/database/postgres.js';
    import {TurnstileDeploymentStore} from './dist/modules/deployment/store.js';
    const pool=createPool(process.env.TURNSTILE_REPORTER_DATABASE_URL,3);
    try{const store=new TurnstileDeploymentStore('/qualification/private',process.env.TURNSTILE_CONTROL_PLANE_RECOVERY_MARKER_FILE,pool,process.env.INSTALLATION_TENANT_ID);await store.locked(async()=>{await store.save(JSON.parse(await readFile('/qualification/attempt.json','utf8')));});}
    catch(error){process.stderr.write(String(error.message));await (await import('node:fs/promises')).writeFile('/qualification/store-rejection.txt',String(error.message),{mode:0o600});process.exitCode=7;}finally{await pool.end();}
  `,
      expected,
    );
  const signer = JSON.parse(await readFile(env.CONTROL_PLANE_SIGNING_KEY_FILE, 'utf8'));
  const key = await importPKCS8(signer.privateKey, 'RS256');
  try {
    for (const action of ['turnstile', 'bootstrap'])
      await invoke(['node', 'dist/infrastructure/database/migrate.js', action], '', 0, 'bootstrap');
    const customer = await staff({
      type: 'client.create',
      code: 'SELECTED-MODULE',
      name: 'Selected module fixture',
    });
    const installation = await staff({
      type: 'installation.create',
      clientId: customer.clientId,
      environment: 'module',
      label: 'Selected',
      localInstallationId: local,
      tenantId: tenant,
    });
    const product = await staff({
      type: 'product.create',
      clientId: customer.clientId,
      installationId: installation.resourceId,
      binding: { product: 'turnstile', applicationId: application },
    });
    id = product.resourceId;
    const response = await admin.call(`/api/registry/products/${id}/manifest`);
    assert.equal(response.status, 200, response.text);
    binding = response.json().binding;
    const fence = await admin.call(`/api/registry/products/${id}/modules/enforce`, {
      operationId: randomUUID(),
      expectedRevision: await revision(),
      reason: 'Verified selected image',
    });
    assert.equal(fence.status, 200, fence.text);
    await pair();
    assert.equal((await status()).access, 'closed');
    await productPolicy('approve');
    await cli({ action: 'sync' });
    assert.equal((await status()).state, 'pending');
    await installAuthority(['foundation', 'incident-management']);
    await cli({ action: 'sync' });
    const approved = await privateValue(),
      original = decodeJwt(approved.decision.accepted.token);
    assert.equal((await status()).access, 'full');
    assert.ok((await status()).allowedModuleIds.includes('incident-management'));
    await writeFile(join(directory, 'attempt.json'), JSON.stringify(approved), { mode: 0o600 });
    await saveAttempt(0);
    console.log('Selected image: actual pairing, SQL apply and API module authority passed.');
    await verifyContainerReporter({
      product: 'turnstile',
      image,
      temporary,
      network,
      postgres,
      run,
      privateDirectory: join(directory, 'private'),
      diagnostic: async (logs) => {
        const metadata = (
          await sql.query(
            'SELECT credential_metadata FROM turnstile.deployment_control WHERE tenant_id=$1',
            [tenant],
          )
        ).rows[0]?.credential_metadata;
        await writeFile(
          join(fixture.bundleDirectory, '../../reporter-diagnostic.json'),
          JSON.stringify({ metadata, logs }),
          { mode: 0o600 },
        );
      },
      config: {
        ...config,
        TURNSTILE_CONTROL_PLANE_RECOVERY_MARKER_FILE: join(directory, 'marker'),
        TURNSTILE_CONTROL_PLANE_VERIFICATION_KEYS_FILE: join(directory, 'central-trust.json'),
        TURNSTILE_MODULE_RELEASE_FILE: join(directory, 'module-release.json'),
        TURNSTILE_MODULE_RELEASE_TRUST_FILE: join(directory, 'release-trust.json'),
      },
      completed: async () => {
        const row = (
          await sql.query(
            'SELECT credential_metadata FROM turnstile.deployment_control WHERE tenant_id=$1',
            [tenant],
          )
        ).rows[0];
        return (
          Number(row?.credential_metadata?.lastReportSequence) >= 1 &&
          row.credential_metadata.report === null &&
          row.credential_metadata.reportFailures === 0 &&
          (
            await database.query('SELECT 1 FROM control_plane.report_latest WHERE product_id=$1', [
              id,
            ])
          ).rowCount === 1
        );
      },
    });

    // Equal-revision content conflicts, malformed/unknown/downgrade, full binding and
    // catalogue/profile/release/module substitutions hit the real owning SQL save handler.
    for (const changes of [
      { version: 1, modulePolicy: undefined },
      { version: 3 },
      { epoch: randomUUID() },
      ...[
        'clientId',
        'installationId',
        'productId',
        'localInstallationId',
        'tenantId',
        'applicationId',
      ].map((field) => ({ binding: { ...binding, [field]: randomUUID() } })),
      { modulePolicy: { ...original.modulePolicy, allowedModuleIds: ['foundation'] } },
      {
        modulePolicy: {
          ...original.modulePolicy,
          allowedModuleIds: ['foundation', 'unknown-module'],
        },
      },
      ...['catalogueDigest', 'profileDigest', 'releaseId'].map((field) => ({
        modulePolicy: {
          ...original.modulePolicy,
          active: { ...original.modulePolicy.active, [field]: 'c'.repeat(64) },
        },
      })),
    ]) {
      const value = structuredClone(approved),
        token = await new SignJWT({
          ...original,
          decisionId: randomUUID(),
          decisionSequence: original.decisionSequence + 1,
          ...changes,
        })
          .setProtectedHeader({ alg: 'RS256', typ: DECISION_TYPE, kid: signer.kid })
          .sign(key);
      value.decision.accepted = {
        token,
        digest: (await import('node:crypto')).createHash('sha256').update(token).digest('hex'),
        appliedAt: Math.floor(Date.now() / 1000),
      };
      await writeFile(join(directory, 'attempt.json'), JSON.stringify(value), { mode: 0o600 });
      await saveAttempt();
      if (changes.modulePolicy?.allowedModuleIds?.length === 1)
        assert.match(
          await readFile(join(directory, 'store-rejection.txt'), 'utf8'),
          /equal revision/,
        );
    }
    assert.match(
      await readFile(join(directory, 'store-rejection.txt'), 'utf8'),
      /CONTEXT_MISMATCH/,
    );
    assert.equal((await status()).access, 'full');
    await centralUnavailable(async () => {
      await cli({ action: 'sync' }, 1);
      assert.equal((await status()).access, 'full');
      assert.deepEqual((await status(original.exp + 1)).allowedModuleIds, []);
      assert.equal((await status(original.exp + 1)).access, 'existing-reads');
    });
    await cli({ action: 'sync' });
    dropReport();
    await cli({ action: 'sync' }, 1);
    const pending = (await privateValue()).report;
    assert.equal(pending.version, 2);
    await installAuthority(['foundation']);
    const current = await privateValue();
    const issued = await anonymous.call(
      '/api/machine/v1/sync',
      {
        version: 2,
        reportId: randomUUID(),
        binding,
        epoch: current.current.epoch,
        applied: null,
        installed: {
          catalogueDigest: fixture.request.profile.catalogueDigest,
          profileDigest: fixture.request.profileDigest,
          releaseId: evidence.inventory.releaseId,
        },
      },
      { headers: { authorization: `Bearer ${current.current.secret}` } },
    );
    assert.equal(issued.status, 200);
    const token = issued.json().decision;
    current.decision.accepted = {
      token,
      digest: (await import('node:crypto')).createHash('sha256').update(token).digest('hex'),
      appliedAt: Math.floor(Date.now() / 1000),
    };
    await writeFile(join(directory, 'attempt.json'), JSON.stringify(current), { mode: 0o600 });
    // Real rename obstruction occurs after the owning SQL commit. A restored private file
    // must reconcile to the current SQL restriction, never reopen its old cached approval.
    await rename(join(directory, 'private/product.json'), join(directory, 'private/product.saved'));
    await mkdir(join(directory, 'private/product.json'), { mode: 0o700 });
    await saveAttempt();
    assert.match(
      await readFile(join(directory, 'store-rejection.txt'), 'utf8'),
      /EISDIR|directory/,
    );
    assert.deepEqual((await status()).allowedModuleIds, ['foundation']);
    await rm(join(directory, 'private/product.json'), { recursive: true });
    await rename(join(directory, 'private/product.saved'), join(directory, 'private/product.json'));
    await cli({ action: 'sync' });
    assert.equal((await privateValue()).decision.accepted.digest, current.decision.accepted.digest);
    assert.deepEqual((await status()).allowedModuleIds, ['foundation']);
    await writeFile(join(directory, 'attempt.json'), JSON.stringify(approved), { mode: 0o600 });
    await saveAttempt();
    assert.match(await readFile(join(directory, 'store-rejection.txt'), 'utf8'), /Stale/);
    assert.deepEqual((await status()).allowedModuleIds, ['foundation']);
    dropRotation();
    await cli({ action: 'rotate' }, 1);
    await cli({ action: 'sync' });
    assert.equal((await privateValue()).current.generation, 2);
    assert.equal((await privateValue()).operation, null);
    await productPolicy('suspend');
    await cli({ action: 'sync' });
    const denied = decodeJwt((await privateValue()).decision.accepted.token);
    assert.equal((await status()).access, 'existing-reads');
    assert.deepEqual((await status(denied.exp + 1)).allowedModuleIds, []);
    await productPolicy('approve');
    await cli({ action: 'sync' });
    const snapshot = (
      await sql.query('SELECT * FROM turnstile.deployment_control WHERE tenant_id=$1', [tenant])
    ).rows[0];
    await writeFile(join(directory, 'marker'), randomBytes(48).toString('base64url'), {
      mode: 0o600,
    });
    // Restore old approval rows with the current independent host recovery marker.
    await sql.query(
      'UPDATE turnstile.deployment_control SET decision=$2,marker_digest=$3,quarantined=false WHERE tenant_id=$1',
      [tenant, JSON.stringify(snapshot.decision), snapshot.marker_digest],
    );
    assert.equal((await status()).state, 'reconciliation-required');
    await cli({ action: 'sync' }, 1);
    await pair('replace');
    await productPolicy('approve');
    await cli({ action: 'sync' });
    assert.equal((await status()).state, 'pending');
    const replacement = await privateValue();
    assert.notEqual(replacement.current.epoch, approved.current.epoch);
    await writeFile(join(directory, 'attempt.json'), JSON.stringify(approved), { mode: 0o600 });
    await saveAttempt();
    assert.equal((await status()).access, 'closed');
    await installAuthority(['foundation']);
    await cli({ action: 'sync' });
    // Invalid unsigned release metadata cannot become authority, even after a restart.
    await writeFile(
      join(directory, 'module-release.json'),
      JSON.stringify({
        ...descriptor,
        request: { ...descriptor.request, profileDigest: 'c'.repeat(64) },
      }),
      { mode: 0o600 },
    );
    assert.equal((await status()).state, 'reconciliation-required');
    await writeFile(join(directory, 'module-release.json'), JSON.stringify(descriptor), {
      mode: 0o600,
    });
    assert.equal(
      (await status()).state,
      'reconciliation-required',
      'Proof repair alone cannot clear durable quarantine',
    );
    await writeFile(
      join(fixture.bundleDirectory, '../../selected-qualification.json'),
      JSON.stringify({
        version: 1,
        passed: true,
        scope: 'selected-installed-adapter',
        profileDigest: fixture.request.profileDigest,
        releaseId: evidence.inventory.releaseId,
        apiImage: image,
        centralImage: env.CONTROL_PLANE_TEST_IMAGE,
        checks: [
          'paired-sql-and-api',
          'shipped-reporter-https-and-sql',
          'full-binding',
          'strict-version-and-downgrade',
          'equal-revision-conflict',
          'outage-and-expired-module-reads',
          'durable-suspension',
          'lost-sync-and-rotation',
          'sql-commit-before-private-file-rename-failure',
          'removal-stale-replay',
          'marker-restore-quarantine',
          'replacement-epoch',
          'invalid-release-proof-and-durable-repair-fence',
        ],
      }),
      { mode: 0o600 },
    );
    console.log(
      'Selected image/real SQL/HTTPS: binding and context substitutions, downgrade/equal-revision conflict, outage/expiry with foundation reads, lost sync/rotation, removal stale replay, external-marker restore quarantine, replacement epoch and unsigned proof repair fences passed.',
    );
  } finally {
    await sql.end();
  }
}
