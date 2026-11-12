import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { parseEnv } from 'node:util';
import { decodeJwt, importPKCS8, SignJWT } from 'jose';
import { parse as yamlParse } from 'yaml';
import { catalogueDigest } from '../../packages/module-catalog/dist/index.js';
import { provisionDatabase } from '../provision-auth-database.mjs';
export async function verifyCombinedPreparation({
  admin,
  anonymous,
  origin,
  fixture,
  temporary,
  run,
  referenceDirectory,
  publicTrust,
  signEvidence,
  reauthenticateAdmin,
}) {
  const call = async (actor, path, body, expected = 200) => {
    const r = await actor.call(path, body);
    assert.equal(r.status, expected, r.text);
    return r.json();
  };
  const registry = (body) =>
    call(admin, '/api/registry', {
      requestId: randomUUID(),
      reason: 'actual combined preparation fixture',
      ...body,
    });
  const catalogue = (body) =>
    call(admin, '/api/module-catalogues', {
      requestId: randomUUID(),
      reason: 'actual source-backed initializer fixture',
      ...body,
    });
  await reauthenticateAdmin();
  const c = fixture.request.catalogue;
  await catalogue({
    type: 'code.import',
    attestation: await signEvidence({ version: 1, kind: 'code', catalogue: c }),
  });
  await catalogue({
    type: 'draft.create',
    id: c.id,
    sourceId: c.id,
    categories: c.modules.map(({ id, category }) => ({ id, category })),
  });
  const draft = await call(admin, `/api/module-catalogues/${c.id}`);
  await catalogue({
    type: 'catalogue.publish',
    id: c.id,
    revision: draft.revision,
    attestation: await signEvidence({
      version: 1,
      kind: 'classification',
      catalogueId: c.id,
      catalogueDigest: draft.digest,
      codeCatalogueDigest: await catalogueDigest(c),
      draftRevision: draft.revision,
    }),
  });
  const client = await registry({
    type: 'client.create',
    code: 'PREPARE-FIXTURE',
    name: 'Actual private preparation',
  });
  const reserve = await registry({
    type: 'installation.reserve',
    clientId: client.clientId,
    environment: 'region-one',
    label: 'Fresh combined fixture',
  });
  const detail = await call(admin, `/api/registry/clients/${client.clientId}`),
    products = detail.products.filter((p) => p.installationId === reserve.resourceId);
  const ts = products.find((p) => p.product === 'turnstile'),
    dms = products.find((p) => p.product === 'dms');
  const path = `/api/registry/products/${ts.id}/modules`;
  const view = await call(admin, path);
  const assignment = (revision, requested = [], resolved = ['foundation']) => ({
    version: 1,
    operationId: randomUUID(),
    expectedRevision: revision,
    binding: view.binding,
    catalogueDigest: draft.digest,
    requestedIndividualIds: requested,
    confirmedResolvedIds: resolved,
    explicitlyRemovedIds: [],
    confirmedRemovalClosureIds: [],
    activeBasis: null,
    reason: 'actual private setup selection',
  });
  await call(admin, path, { type: 'assignment.draft', command: assignment(view.productRevision) });
  await call(admin, path, {
    type: 'assignment.approve',
    command: assignment(view.productRevision + 1),
  });
  await writeFile(
    join(referenceDirectory, `${fixture.request.profileDigest}.json`),
    await readFile(join(fixture.bundleDirectory, 'delivery.json')),
    { mode: 0o644 },
  );
  const issue = async () =>
    call(admin, `${path}/installation-intent`, {
      operationId: randomUUID(),
      expectedRevision: (await call(admin, path)).productRevision,
      reason: 'actual initializer qualification',
    });
  let issued = await issue();
  assert.deepEqual(await call(anonymous, '/api/installation-intents/status', issued), {
    current: true,
  });
  await call(anonymous, '/api/installation-intents/status', { intent: 'forged.token.value' }, 400);
  const base = join(temporary, 'private-preparation');
  await mkdir(base, { mode: 0o700 });
  const trustFile = join(base, 'central-trust.json'),
    releaseTrustFile = join(base, 'release-trust.json'),
    intentFile = join(base, 'intent.json'),
    inputFile = join(base, 'input.json'),
    directory = join(base, 'customer');
  await writeFile(trustFile, JSON.stringify(publicTrust), { mode: 0o600 });
  await writeFile(releaseTrustFile, JSON.stringify(fixture.releaseTrust), { mode: 0o600 });
  await writeFile(intentFile, JSON.stringify(issued), { mode: 0o600 });
  const input = {
    directory,
    bundleDirectory: fixture.bundleDirectory,
    centralTrustFile: trustFile,
    releaseTrustFile,
    intentFile,
    dmsImage: fixture.dmsImage,
    authorityOrigin: 'https://turnstile.customer.test',
    resourceOrigin: 'https://dms.customer.test',
    transferOrigin: 'https://files.customer.test',
    ingressNetwork: 'preparation-fixture',
    smtp: { host: 'smtp.customer.test', port: 587, mode: 'starttls', from: 'test@customer.test' },
    turnstileSmtp: { host: 'mailpit', port: 1025, mode: 'starttls', from: 'test@customer.test' },
    structured: false,
  };
  await writeFile(inputFile, JSON.stringify(input), { mode: 0o600 });
  const env = { ...process.env, NODE_EXTRA_CA_CERTS: join(temporary, 'cert.pem') };
  const prepare = () =>
    run(
      process.execPath,
      [
        '--input-type=module',
        '-e',
        "import {protectedFile} from './packages/deployment-control/dist/index.js';import{prepareInstallation}from'./scripts/prepare-installation.mjs';await prepareInstallation(JSON.parse(protectedFile(process.argv[1])));",
        inputFile,
      ],
      { env },
    );
  await writeFile(
    inputFile,
    JSON.stringify({ ...input, turnstileSmtp: { ...input.turnstileSmtp, mode: 'tls' } }),
    { mode: 0o600 },
  );
  await assert.rejects(prepare());
  await assert.rejects(
    stat(directory),
    /ENOENT/,
    'Invalid owning input must not commit a preparation plan',
  );
  await writeFile(inputFile, JSON.stringify(input), { mode: 0o600 });
  await prepare();
  const originalDms = await readFile(join(directory, '.env.dms'), 'utf8');
  const missing = join(directory, '.env.dms-download');
  await rm(missing);
  await mkdir(missing);
  // A real filesystem obstruction during committed-plan replay exercises the production Docker initializer failure path.
  await assert.rejects(prepare());
  assert.ok(
    (await readFile(join(directory, '.env.dms'), 'utf8')) === originalDms,
    'Failed replay must preserve secrets',
  );
  await rm(missing, { recursive: true });
  await prepare();
  assert.ok(
    (await readFile(join(directory, '.env.dms'), 'utf8')) === originalDms,
    'Retry must preserve secrets',
  );
  const receipt = await readFile(join(directory, 'preparation-receipt.json'), 'utf8');
  await prepare();
  assert.equal(await readFile(join(directory, 'preparation-receipt.json'), 'utf8'), receipt);
  const dmsEnv = parseEnv(originalDms),
    tsEnv = parseEnv(await readFile(join(directory, '.env.turnstile'), 'utf8'));
  assert.equal(dmsEnv.AUTH_MODE, 'combined');
  assert.equal(dmsEnv.INSTALLATION_LOCAL_ID, view.binding.localInstallationId);
  assert.equal(tsEnv.INSTALLATION_TENANT_ID, dmsEnv.INSTALLATION_TENANT_ID);
  assert.equal(tsEnv.TURNSTILE_APPLICATION_ID, view.binding.applicationId);
  assert.equal(
    tsEnv.TURNSTILE_INVITATION_RECOVERY_EPOCH.length,
    43,
    'Owning invitation recovery key format',
  );
  assert.ok(tsEnv.AUTH_LOGIN_CLIENT_SECRET === '', 'OAuth provisioning must remain closed');
  assert.ok(tsEnv.DMS_MACHINE_CLIENT_SECRET === '', 'OAuth provisioning must remain closed');
  assert.ok(tsEnv.IDENTITY_SERVICE_CLIENT_SECRET === '', 'OAuth provisioning must remain closed');
  assert.equal(
    new Set([
      dmsEnv.AUTH_SECRET,
      tsEnv.TURNSTILE_COOKIE_SECRET,
      tsEnv.TURNSTILE_TOKEN_ENCRYPTION_KEY,
      tsEnv.TURNSTILE_INVITATION_ENCRYPTION_KEY,
    ]).size,
    4,
  );
  for (const file of await readdir(directory)) {
    const info = await stat(join(directory, file));
    assert.equal(info.mode & 0o077, 0, `Private mode required: ${file}`);
  }
  const badExisting = join(base, 'existing');
  await mkdir(badExisting, { mode: 0o700 });
  await writeFile(join(badExisting, '.env.dms'), 'retained', { mode: 0o600 });
  await writeFile(inputFile, JSON.stringify({ ...input, directory: badExisting }), { mode: 0o600 });
  await assert.rejects(prepare());
  assert.equal(await readFile(join(badExisting, '.env.dms'), 'utf8'), 'retained');
  await writeFile(inputFile, JSON.stringify(input), { mode: 0o600 });
  // Expiry cannot reset committed configuration; renewal retains both IDs and every secret.
  const signer = JSON.parse(await readFile(join(temporary, 'deployment-signer.json'), 'utf8')),
    payload = decodeJwt(issued.intent),
    now = Math.floor(Date.now() / 1000);
  const expired = await new SignJWT({ ...payload, iat: now - 100, nbf: now - 100, exp: now - 1 })
    .setProtectedHeader({ alg: 'RS256', typ: 'thaarei-installation-intent+jwt', kid: signer.kid })
    .sign(await importPKCS8(signer.privateKey, 'RS256'));
  await writeFile(intentFile, JSON.stringify({ intent: expired }), { mode: 0o600 });
  await assert.rejects(prepare());
  assert.equal(await readFile(join(directory, 'preparation-receipt.json'), 'utf8'), receipt);
  issued = await issue();
  await writeFile(intentFile, JSON.stringify(issued), { mode: 0o600 });
  await prepare();
  assert.equal(await readFile(join(directory, 'preparation-receipt.json'), 'utf8'), receipt);
  const cliOutput = await run(process.execPath, ['scripts/prepare-installation.mjs', inputFile], {
    env,
  });
  assert.ok(cliOutput.includes('Combined private configuration prepared'));
  // Another valid central reservation cannot replace this directory's committed identities.
  const otherReservation = await registry({
    type: 'installation.reserve',
    clientId: client.clientId,
    environment: 'region-two',
    label: 'Independent identity fixture',
  });
  const otherProduct = (
    await call(admin, `/api/registry/clients/${client.clientId}`)
  ).products.find(
    (p) => p.installationId === otherReservation.resourceId && p.product === 'turnstile',
  );
  const otherPath = `/api/registry/products/${otherProduct.id}/modules`,
    otherView = await call(admin, otherPath);
  const otherCommand = (revision) => ({ ...assignment(revision), binding: otherView.binding });
  await call(admin, otherPath, { type: 'assignment.draft', command: otherCommand(1) });
  await call(admin, otherPath, { type: 'assignment.approve', command: otherCommand(2) });
  const otherIntent = await call(admin, `${otherPath}/installation-intent`, {
    operationId: randomUUID(),
    expectedRevision: 3,
    reason: 'independent setup identities',
  });
  await writeFile(intentFile, JSON.stringify(otherIntent), { mode: 0o600 });
  await assert.rejects(prepare());
  assert.equal(await readFile(join(directory, 'preparation-receipt.json'), 'utf8'), receipt);
  await writeFile(intentFile, JSON.stringify(issued), { mode: 0o600 });
  // Exercise owning role provision/migration/bootstrap commands against a separate disposable customer PostgreSQL.
  const dbName = `mod-i05-db-${randomBytes(6).toString('hex')}`,
    services = yamlParse(await readFile('deploy/compose.local.yaml', 'utf8')).services;
  await run('docker', [
    'run',
    '--detach',
    '--name',
    dbName,
    '--tmpfs',
    '/var/lib/postgresql:rw,size=1g',
    '--env-file',
    join(directory, '.env.dms.compose'),
    '-e',
    'POSTGRES_USER=workspace',
    '-e',
    'POSTGRES_DB=dms',
    '-p',
    '127.0.0.1::5432',
    services.postgres.image,
  ]);
  try {
    for (let i = 0; i < 100; i++) {
      try {
        await run('docker', [
          'exec',
          dbName,
          'pg_isready',
          '-h',
          '127.0.0.1',
          '-U',
          'workspace',
          '-d',
          'dms',
        ]);
        break;
      } catch {
        await delay(100);
      }
    }
    const inspected = JSON.parse(await run('docker', ['inspect', dbName])),
      port = inspected[0].NetworkSettings.Ports['5432/tcp'][0].HostPort;
    const localize = (values) =>
      Object.fromEntries(
        Object.entries(values).map(([k, v]) => {
          if (k.endsWith('_DATABASE_URL')) {
            const u = new URL(v);
            u.hostname = '127.0.0.1';
            u.port = port;
            return [k, u.href];
          }
          if (k.endsWith('_FILE') && v.startsWith('/run/thaarei/'))
            return [k, join(directory, v.slice('/run/thaarei/'.length))];
          return [k, v];
        }),
      );
    const dmsConfig = {
      ...env,
      ...localize(parseEnv(await readFile(join(directory, '.env.dms-maintenance'), 'utf8'))),
      ...localize(parseEnv(await readFile(join(directory, '.env.coordinator'), 'utf8'))),
      ...localize(parseEnv(await readFile(join(directory, '.env.dms.deployment'), 'utf8'))),
    };
    const tsConfig = {
      ...env,
      ...localize(parseEnv(await readFile(join(directory, '.env.turnstile.migrate'), 'utf8'))),
      ...localize(parseEnv(await readFile(join(directory, '.env.turnstile.reporter'), 'utf8'))),
      ...localize(parseEnv(await readFile(join(directory, '.env.turnstile.deployment'), 'utf8'))),
    };
    await provisionDatabase(
      localize(parseEnv(await readFile(join(directory, '.env.provision'), 'utf8'))),
    );
    await provisionDatabase(
      localize(parseEnv(await readFile(join(directory, '.env.turnstile-provision'), 'utf8'))),
    );
    const own = (app, entry, args, config, input) => {
      const argv = [`apps/${app}/dist/${entry}`, ...args];
      if (input === undefined) return run(process.execPath, argv, { env: config });
      return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, argv, {
          env: config,
          stdio: ['pipe', 'pipe', 'pipe'],
        });
        let output = '';
        child.stdout.on('data', (data) => {
          output += data;
        });
        child.stderr.on('data', (data) => {
          output += data;
        });
        child.on('error', reject);
        child.on('close', (code) =>
          code === 0
            ? resolve(output)
            : reject(new Error(`Owning ${app} command failed: ${output.slice(-1500)}`)),
        );
        child.stdin.end(JSON.stringify(input));
      });
    };

    for (const owner of ['auth', 'dms'])
      await own('dms-api', 'infrastructure/database/migrate.js', [owner], dmsConfig);
    await own('turnstile-api', 'infrastructure/database/migrate.js', ['turnstile'], tsConfig);
    for (let repeat = 0; repeat < 2; repeat++) {
      await own('dms-api', 'infrastructure/database/migrate.js', ['bootstrap'], dmsConfig);
      await own('turnstile-api', 'infrastructure/database/migrate.js', ['bootstrap'], tsConfig);
    }
    for (const entry of [
      'modules/organization/configuration-operator.js',
      'modules/access/access-operator.js',
    ])
      await own('turnstile-api', entry, ['initialize'], tsConfig, {
        operatorId: 'installation-preparation-qualification',
      });
    await assert.rejects(
      own('dms-api', 'infrastructure/database/migrate.js', ['bootstrap'], {
        ...dmsConfig,
        INSTALLATION_LOCAL_ID: randomUUID(),
      }),
    );
    await assert.rejects(
      own('turnstile-api', 'infrastructure/database/migrate.js', ['bootstrap'], {
        ...tsConfig,
        TURNSTILE_APPLICATION_ID: randomUUID(),
      }),
    );
    for (const [app, config, product] of [
      ['dms-api', dmsConfig, dms],
      ['turnstile-api', tsConfig, ts],
    ]) {
      const manifest = join(base, `${app}-manifest.json`);
      await own(app, 'modules/deployment/operator.js', [], config, {
        action: 'manifest',
        outputFile: manifest,
        environment: 'region-one',
      });
      const actual = JSON.parse(await readFile(manifest, 'utf8'));
      assert.equal(actual.localInstallationId, view.binding.localInstallationId);
      assert.equal(actual.tenantId, view.binding.tenantId);
      const current = (await call(admin, `/api/registry/clients/${client.clientId}`)).products.find(
          (p) => p.id === product.id,
        ),
        code = randomBytes(32).toString('base64url'),
        pairingId = randomUUID();
      const pair = await call(admin, '/api/pairing', {
        requestId: randomUUID(),
        productId: product.id,
        revision: current.revision,
        action: 'issue',
        pairingId,
        code,
        reason: 'actual independent prepared product pairing',
      });
      const exported = await call(admin, `/api/registry/products/${product.id}/manifest`),
        pairing = join(base, `${app}-pairing.json`);
      await writeFile(
        pairing,
        JSON.stringify({
          version: 1,
          origin,
          binding: exported.binding,
          pairingId,
          code,
          expiresAt: pair.expiresAt,
        }),
        { mode: 0o600 },
      );
      await own(app, 'modules/deployment/operator.js', [], config, {
        action: 'setup',
        pairingFile: pairing,
      });
      const productFile = join(directory, app === 'dms-api' ? 'dms' : 'turnstile', 'product.json'),
        privateBefore = await readFile(productFile, 'utf8');
      // Re-running preparation while DMS alone is paired must preserve its owning credential/candidate state.
      await prepare();
      assert.ok(
        (await readFile(productFile, 'utf8')) === privateBefore,
        'Preparation must preserve the paired credential',
      );
      await own(app, 'modules/deployment/operator.js', [], config, {
        action: 'setup',
        pairingFile: pairing,
      }).catch(() => {});
      const retained = JSON.parse(await readFile(productFile, 'utf8')),
        before = JSON.parse(privateBefore);
      assert.ok(
        before.current !== null &&
          JSON.stringify(retained.current) === JSON.stringify(before.current),
        'Duplicate setup must retain the owning credential',
      );
      const after = (await call(admin, `/api/registry/clients/${client.clientId}`)).products.find(
        (p) => p.id === product.id,
      );
      assert.equal(after.policyState, 'pending');
      assert.ok(after.pairingVerifiedAt);
    }
    assert.equal(await readFile(join(directory, 'preparation-receipt.json'), 'utf8'), receipt);
  } finally {
    await run('docker', ['rm', '--force', dbName]);
  }
  // A subsequent centrally approved assignment invalidates the retained intent before any write.
  const revision = (await call(admin, path)).productRevision;
  await call(admin, path, {
    type: 'assignment.draft',
    command: assignment(revision, ['incident-management'], ['foundation', 'incident-management']),
  });
  await call(admin, path, {
    type: 'assignment.approve',
    command: assignment(
      revision + 1,
      ['incident-management'],
      ['foundation', 'incident-management'],
    ),
  });
  assert.deepEqual(await call(anonymous, '/api/installation-intents/status', issued), {
    current: false,
  });
  await assert.rejects(prepare());
  assert.equal(await readFile(join(directory, 'preparation-receipt.json'), 'utf8'), receipt);
  console.log(
    'MOD-I05 actual central HTTPS + Docker initializers: interrupted writes/resume, expiry/renewal, immutable reserved bootstrap, existing-state refusal, private modes, independent partial pairing/duplicate setup and changed assignment fences passed.',
  );
}
