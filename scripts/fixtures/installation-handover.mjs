// Fresh operator journey from signed artifacts. No customer SQL seed or source mount.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { chmod, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import { decodeJwt, decodeProtectedHeader, importPKCS8, SignJWT } from 'jose';
import { catalogueDigest } from '../../packages/module-catalog/dist/index.js';

const fixtureLicenceEnd = new Date(Date.now() + 365 * 86400000).toISOString();

export async function verifyInstallationHandover({
  fixture,
  admin,
  anonymous,
  origin,
  publicTrust,
  temporary,
  referenceDirectory,
  signEvidence,
  reauthenticateAdmin,
  run,
  centralIngress,
  mailContainer,
  mailUrl,
  services,
}) {
  const call = async (path, body, expected = 200) => {
    const r = await admin.call(path, body);
    assert.equal(r.status, expected, `Staff ${path}: ${r.text}`);
    return r.json();
  };
  const registry = (body) =>
    call('/api/registry', {
      requestId: randomUUID(),
      reason: 'artifact-only installation gate',
      ...body,
    });
  const catalogue = fixture.request.catalogue;
  await reauthenticateAdmin();
  await call('/api/module-catalogues', {
    type: 'code.import',
    requestId: randomUUID(),
    reason: 'actual source',
    attestation: await signEvidence({ version: 1, kind: 'code', catalogue }),
  });
  await call('/api/module-catalogues', {
    type: 'draft.create',
    requestId: randomUUID(),
    reason: 'actual classification',
    id: catalogue.id,
    sourceId: catalogue.id,
    categories: catalogue.modules.map(({ id, category }) => ({ id, category })),
  });
  const draft = await call(`/api/module-catalogues/${catalogue.id}`);
  await call('/api/module-catalogues', {
    type: 'catalogue.publish',
    requestId: randomUUID(),
    reason: 'actual classification',
    id: catalogue.id,
    revision: draft.revision,
    attestation: await signEvidence({
      version: 1,
      kind: 'classification',
      catalogueId: catalogue.id,
      catalogueDigest: draft.digest,
      codeCatalogueDigest: await catalogueDigest(catalogue),
      draftRevision: draft.revision,
    }),
  });
  const client = await registry({
    type: 'client.create',
    code: 'MOD-I09-FRESH',
    name: 'Independent artifact operator',
  });
  const reservation = await registry({
    type: 'installation.reserve',
    clientId: client.clientId,
    environment: 'local-mod9',
    label: 'Artifact-only fresh installation',
  });
  const products = (await call(`/api/registry/clients/${client.clientId}`)).products.filter(
    (p) => p.installationId === reservation.resourceId,
  );
  const ts = products.find((p) => p.product === 'turnstile'),
    dms = products.find((p) => p.product === 'dms');
  const path = `/api/registry/products/${ts.id}/modules`,
    read = () => call(path);
  for (const type of ['assignment.draft', 'assignment.approve']) {
    const v = await read();
    await call(path, {
      type,
      command: {
        version: 1,
        operationId: randomUUID(),
        expectedRevision: v.productRevision,
        binding: v.binding,
        catalogueDigest: draft.digest,
        requestedIndividualIds: ['incident-management'],
        confirmedResolvedIds: ['foundation', 'incident-management'],
        explicitlyRemovedIds: [],
        confirmedRemovalClosureIds: [],
        activeBasis: null,
        reason: 'Incident-only installation',
      },
    });
  }
  await writeFile(
    join(referenceDirectory, `${fixture.request.profileDigest}.json`),
    await readFile(join(fixture.moduleBundleDirectory, 'delivery.json')),
    { mode: 0o644 },
  );
  await call(`${path}/enforce`, {
    operationId: randomUUID(),
    expectedRevision: (await read()).productRevision,
    reason: 'Verified v2 selected image',
  });
  const issued = await call(`${path}/installation-intent`, {
    operationId: randomUUID(),
    expectedRevision: (await read()).productRevision,
    reason: 'Fresh artifact operator',
  });
  assert.deepEqual((await anonymous.call('/api/installation-intents/status', issued)).json(), {
    current: true,
  });
  const base = join(fixture.root, `operator-${randomUUID()}`),
    privateDir = join(base, 'inputs'),
    state = join(base, 'installation');
  await mkdir(base, { mode: 0o700 });
  await mkdir(privateDir, { mode: 0o700 });
  await mkdir(state, { mode: 0o700 });
  const network = `mod9-${randomBytes(6).toString('hex')}`,
    ingress = `${network}-ingress`;
  await run('docker', ['network', 'create', '--subnet', '10.240.90.0/24', network]);
  await run('docker', [
    'network',
    'connect',
    '--alias',
    'central.fixture.test',
    network,
    centralIngress,
  ]);
  await run('docker', ['network', 'connect', '--alias', 'mailpit', network, mailContainer]);
  const protectedWrite = (name, value) =>
    writeFile(join(privateDir, name), typeof value === 'string' ? value : JSON.stringify(value), {
      mode: 0o600,
    });
  await protectedWrite('intent.json', issued);
  await protectedWrite('central-trust.json', publicTrust);
  await protectedWrite('release-trust.json', fixture.runtimeTrust);
  await protectedWrite('ca.pem', await readFile(join(temporary, 'cert.pem'), 'utf8'));
  const authorityOrigin = 'https://turnstile.fixture.test:23600',
    resourceOrigin = 'https://dms.fixture.test:23600';
  const input = {
    version: 1,
    directory: state,
    bundleDirectory: fixture.bundleDirectory,
    intentFile: join(privateDir, 'intent.json'),
    centralTrustFile: join(privateDir, 'central-trust.json'),
    releaseTrustFile: join(privateDir, 'release-trust.json'),
    caFile: join(privateDir, 'ca.pem'),
    ingressNetwork: network,
    privateSubnet: '10.240.91.0/24',
    authorityOrigin,
    resourceOrigin,
    transferOrigin: 'https://files.fixture.test:23600',
    smtp: { host: 'mailpit', port: 1025, mode: 'starttls', from: 'setup@customer.test' },
    turnstileSmtp: { host: 'mailpit', port: 1025, mode: 'starttls', from: 'setup@customer.test' },
    operatorId: 'independent-installation-operator',
  };
  await protectedWrite('input.json', input);
  const env = {
    ...process.env,
    THAAREI_INSTALLER_IMAGE: fixture.engineImage,
    THAAREI_INSTALLER_NETWORK: network,
    THAAREI_INSTALLATION_DIRECTORY: state,
    THAAREI_INSTALLER_CA_FILE: join(privateDir, 'ca.pem'),
  };
  const invoke = (action, command, expected = [0, 10]) =>
    new Promise((done, reject) => {
      const args = [
        action,
        join(privateDir, 'input.json'),
        ...(command ? [join(privateDir, command)] : []),
      ];
      const child = spawn(join(fixture.bundleDirectory, 'installer'), args, {
        cwd: base,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let output = '',
        error = '';
      child.stdout.on('data', (c) => (output += c));
      child.stderr.on('data', (c) => (error += c));
      const timer = setTimeout(() => child.kill(), 360000);
      child.once('error', reject);
      child.once('close', async (code) => {
        clearTimeout(timer);
        await writeFile(join(base, 'launcher-output.log'), `${output}\n${error}`, { mode: 0o600 });
        if (!expected.includes(code))
          reject(new Error(`Installer ${action} exit ${code}; private evidence ${base}`));
        else done({ code, result: JSON.parse(output.trim()) });
      });
    });
  const owner = async (name, operation, subcommand, body) => {
    await protectedWrite(`${name}.json`, {
      operation,
      ...(subcommand ? { subcommand } : {}),
      input: body,
    });
    const r = await invoke('owner', `${name}.json`);
    await rm(join(privateDir, `${name}.json`));
    return r;
  };
  const created = [];
  let browser;
  try {
    await chmod(state, 0o755);
    try {
      await invoke('plan', undefined, [20]);
    } finally {
      await chmod(state, 0o700);
    }
    const readme = join(fixture.bundleDirectory, 'README.md'),
      originalReadme = await readFile(readme);
    try {
      await writeFile(readme, 'substituted release documentation');
      await invoke('plan', undefined, [20]);
    } finally {
      await writeFile(readme, originalReadme);
    }
    await protectedWrite('release-trust.json', {
      ...fixture.runtimeTrust,
      keys: fixture.runtimeTrust.keys.map((k) => ({ ...k, status: 'revoked' })),
    });
    await invoke('plan', undefined, [20]);
    await protectedWrite('release-trust.json', fixture.runtimeTrust);
    assert.equal((await invoke('plan')).result.conditions[0], 'installation-not-initialized');
    const installed = await invoke('install');
    assert.ok(installed.result.conditions.includes('dms-pairing-required'));
    const database = JSON.parse(
      await run('docker', [
        'inspect',
        `thaarei-${(await read()).binding.localInstallationId}-postgres`,
      ]),
    )[0];
    assert.equal(database.HostConfig.RestartPolicy.Name, 'unless-stopped');
    const marker = randomUUID();
    const sql = (statement) =>
      run('docker', [
        'exec',
        database.Id,
        'sh',
        '-c',
        'exec psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "$1"',
        'restart-verification',
        statement,
      ]);
    await sql(
      `CREATE TABLE public.thaarei_restart_probe(value uuid PRIMARY KEY); INSERT INTO public.thaarei_restart_probe VALUES('${marker}');`,
    );
    // PostgreSQL SIGQUIT performs immediate shutdown without a clean checkpoint.
    // Unlike SIGKILL sent inside its namespace, this reaches the container's PID 1 handler.
    // Do not use Docker's manually-stopped container path, which suppresses restart policy.
    await run('docker', [
      'exec',
      '-d',
      '--user',
      'postgres',
      database.Id,
      'sh',
      '-c',
      'sleep 1; kill -QUIT 1',
    ]);
    let restarted = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      await delay(1000);
      const current = JSON.parse(await run('docker', ['inspect', database.Id]))[0];
      if (current.RestartCount > database.RestartCount && current.State.Running) {
        try {
          assert.equal(
            (await sql('SELECT value FROM public.thaarei_restart_probe')).trim(),
            marker,
          );
          restarted = true;
          break;
        } catch {
          /* Wait for PostgreSQL crash recovery to finish. */
        }
      }
    }
    assert.ok(restarted, 'Installer database must restart automatically and retain committed data');
    await sql('DROP TABLE public.thaarei_restart_probe');
    console.log(
      'Fresh installer PostgreSQL: automatic restart and committed-data recovery passed.',
    );
    const original = await readFile(join(state, '.env.dms'), 'utf8');
    await Promise.all([invoke('resume'), invoke('resume')]);
    assert.equal(await readFile(join(state, '.env.dms'), 'utf8'), original);
    const descriptorFile = join(fixture.bundleDirectory, 'installation.json'),
      descriptorBefore = await readFile(descriptorFile, 'utf8');
    const signed = JSON.parse(descriptorBefore),
      claims = decodeJwt(signed.attestation),
      signing = JSON.parse(await readFile(join(fixture.root, 'signer.json'), 'utf8')),
      now = Math.floor(Date.now() / 1000);
    try {
      const expired = await new SignJWT({ ...claims, iat: now - 100, nbf: now - 100, exp: now - 1 })
        .setProtectedHeader(decodeProtectedHeader(signed.attestation))
        .sign(await importPKCS8(signing.privateKey, 'RS256'));
      await writeFile(descriptorFile, JSON.stringify({ attestation: expired }));
      await invoke('resume');
      assert.equal(await readFile(join(state, '.env.dms'), 'utf8'), original);
    } finally {
      await writeFile(descriptorFile, descriptorBefore);
    }

    // Use generated routing directly; no transcribed local/tenant/application UUIDs.
    await run('docker', [
      'run',
      '--detach',
      '--name',
      ingress,
      '--network',
      network,
      '--network-alias',
      'turnstile.fixture.test',
      '--network-alias',
      'dms.fixture.test',
      '--network-alias',
      'files.fixture.test',
      '-p',
      '127.0.0.1:23600:23600',
      '--mount',
      `type=bind,source=${join(state, 'ingress.nginx.conf')},target=/etc/nginx/conf.d/default.conf,readonly`,
      '--mount',
      `type=bind,source=${join(temporary, 'cert.pem')},target=/tls/tls.crt,readonly`,
      '--mount',
      `type=bind,source=${join(temporary, 'key.pem')},target=/tls/tls.key,readonly`,
      services['turnstile-web']?.image ??
        'nginx:1.30.2-alpine@sha256:5f979dcfed4ce6461873f087e8c980d6e29b084b9e8776d9704a7e989b5f4898',
    ]);
    created.push(ingress);
    for (const p of [dms, ts]) {
      const current = (await call(`/api/registry/clients/${client.clientId}`)).products.find(
        (v) => v.id === p.id,
      );
      const pairingId = randomUUID(),
        code = randomBytes(32).toString('base64url');
      const receipt = await call('/api/pairing', {
        requestId: randomUUID(),
        productId: p.id,
        revision: current.revision,
        action: 'issue',
        pairingId,
        code,
        reason: 'Protected independent pairing',
      });
      const manifest = await call(`/api/registry/products/${p.id}/manifest`);
      await protectedWrite(`${p.product}-pairing.json`, {
        version: 1,
        origin,
        binding: manifest.binding,
        pairingId,
        code,
        expiresAt: receipt.expiresAt,
      });
      await protectedWrite('pair-command.json', {
        product: p.product,
        file: join(privateDir, `${p.product}-pairing.json`),
      });
      await invoke('pair', 'pair-command.json');
      await rm(join(privateDir, `${p.product}-pairing.json`));
    }
    await invoke('sync');
    let v = await read();
    assert.equal(v.effective, null);
    assert.ok(v.inventory);
    await reauthenticateAdmin();
    for (const p of [dms, ts]) {
      const row = (await call(`/api/registry/clients/${client.clientId}`)).products.find(
        (v) => v.id === p.id,
      );
      await registry({
        type: 'product.policy',
        id: p.id,
        revision: row.revision,
        decision: 'approve',
        licenceExpiresAt: fixtureLicenceEnd,
      });
    }
    v = await read();
    await call(`${path}/activate`, {
      operationId: randomUUID(),
      expectedRevision: v.productRevision,
      desiredRevision: v.desired.revision,
      epoch: v.inventory.epoch,
      installed: v.inventory.installed,
      activeBasis: v.authority?.active ?? null,
      reason: 'Exact installed profile confirmed by staff',
    });
    await invoke('sync');
    v = await read();
    assert.deepEqual(v.effective.allowedIds, ['foundation', 'incident-management']);
    assert.ok(v.handover.products.every((p) => p.paired && p.acknowledged));
    // Public, historical evidence only: never persist tokens, cookies or credential files here.
    const appliedSnapshot = {
      binding: v.binding,
      desiredRevision: v.desired.revision,
      acknowledged: v.effective,
      products: v.handover.products.map(
        ({ product, productId, policyState, revision, paired, acknowledged }) => ({
          product,
          productId,
          policyState,
          revision,
          paired,
          acknowledged,
        }),
      ),
    };
    for (
      let attempt = 0;
      attempt < 60 && v.handover.products.some((p) => p.reportFreshness !== 'current');
      attempt++
    ) {
      await delay(500);
      v = await read();
    }
    assert.ok(
      v.handover.products.every((p) => p.reportFreshness === 'current'),
      'Both actual scoped reporters must publish independently',
    );
    const email = 'administrator@customer.test',
      password = randomBytes(24).toString('base64url');
    await owner('prepare-administrator', 'provision-user', undefined, {
      email,
      name: 'Customer administrator',
      role: 'admin',
      password,
    });
    browser = await chromium.launch({
      headless: true,
      args: [
        '--host-resolver-rules=MAP turnstile.fixture.test 127.0.0.1, MAP dms.fixture.test 127.0.0.1',
      ],
    });
    const context = await browser.newContext({ ignoreHTTPSErrors: true }),
      page = await context.newPage();
    page.setDefaultTimeout(20000);
    let link;
    for (let i = 0; i < 60 && !link; i++) {
      const messages = await (await fetch(`${mailUrl}/api/v1/messages`)).json();
      const message = messages.messages.find((m) => m.To.some((r) => r.Address === email));
      if (message) {
        const detail = await (await fetch(`${mailUrl}/api/v1/message/${message.ID}`)).json();
        link = detail.Text.match(/https?:\/\/[^\s]+/)?.[0];
      } else await delay(250);
    }
    assert.ok(link, 'Real verification mail required');
    const rejected = new URL(link);
    rejected.searchParams.set('callbackURL', 'https://attacker.test/setup-preparation');
    const denied = await page.goto(rejected.href);
    assert.equal(denied.status(), 400);
    assert.deepEqual(await denied.json(), { code: 'INVALID_CALLBACK' });
    await page.goto(link);
    await page.getByRole('heading', { name: 'Sign-in preparation', exact: true }).waitFor();
    assert.equal(new URL(page.url()).pathname, '/setup-preparation');
    assert.equal(
      await context.cookies().then((c) => c.some((v) => v.name === '__Host-turnstile')),
      false,
    );
    await protectedWrite('identity.json', {
      operatorEmail: email,
      operatorPassword: password,
      initialPermissions: ['turnstile:access', 'turnstile:dms:capabilities:read'],
    });
    await invoke('identity', 'identity.json');
    await rm(join(privateDir, 'identity.json'));
    await page.goto(`${authorityOrigin}/api/auth/login`);
    await page.getByLabel('Email address', { exact: true }).fill(email);
    await page.getByLabel('Password', { exact: true }).fill(password);
    await page.getByRole('button', { name: 'Sign in', exact: true }).click();
    await page.getByRole('heading', { name: 'Waiting for setup', exact: true }).waitFor();
    const api = (path, expected = 200) =>
      page.evaluate(
        async ({ path, expected }) => {
          const r = await fetch(path);
          const data = await r.json();
          if (r.status !== expected) throw new Error(`${path}: ${r.status}`);
          return data;
        },
        { path, expected },
      );
    const cookie = (await context.cookies()).find((c) => c.name === '__Host-turnstile');
    assert.ok(cookie);
    const proof = {
      administratorUserId: '@prepared-user',
      administratorCookie: `${cookie.name}=${cookie.value}`,
    };
    await owner('bootstrap', 'release', 'bootstrap-administrator', proof);
    await owner('open', 'release', 'open', proof);
    await page.goto(authorityOrigin);
    await page
      .getByRole('heading', { name: 'Tell us about your organization', exact: true })
      .waitFor();
    await page.getByLabel('Organization name', { exact: true }).fill('Fresh artifact customer');
    await page.getByLabel('Time zone', { exact: true }).selectOption('UTC');
    await page.getByRole('button', { name: 'Save and continue', exact: true }).click();
    await page.getByRole('heading', { name: 'First unit', exact: true }).waitFor();
    await page.getByLabel('Unit name', { exact: true }).fill('Head office');
    await page.getByRole('button', { name: 'Add unit', exact: true }).click();
    await page.getByRole('link', { name: 'Continue to review', exact: true }).click();
    await page.getByRole('button', { name: 'Finish setup', exact: true }).click();
    await page
      .getByRole('heading', { name: 'Welcome, Customer administrator.', exact: true })
      .waitFor();
    assert.deepEqual((await api('/api/modules')).modules, []);
    await api('/api/modules/incident-management/entry', 403);
    await api('/api/modules/risk-management/entry', 404);
    await owner('incident-permission', 'module-access', undefined, {
      action: 'grant',
      userId: '@prepared-user',
      moduleId: 'incident-management',
      reason: 'Explicit company-wide Incident reader',
      userCookie: await context.cookies().then((cookies) => {
        const current = cookies.find((c) => c.name === '__Host-turnstile');
        assert.ok(current);
        return `${current.name}=${current.value}`;
      }),
    });
    await page.goto(`${authorityOrigin}/modules/incident-management`);
    await page.getByText('You are in Incident Management', { exact: true }).waitFor();
    await api('/api/dms/capabilities');
    const sensitive = [password, new URL(link).searchParams.get('token'), cookie.value];
    for (const file of await readdir(join(state, 'credentials'))) {
      const value = JSON.parse(await readFile(join(state, 'credentials', file), 'utf8'));
      sensitive.push(value.clientSecret, value.enrollmentKey);
    }
    const ownedLogs = await run('docker', [
      'ps',
      '-aq',
      '--filter',
      `label=thaarei.installation=${v.binding.localInstallationId}`,
    ]);
    for (const container of [ingress, ...ownedLogs.split('\n').filter(Boolean)]) {
      const logs = await run('docker', ['logs', container]);
      const leaked = sensitive
        .map((secret, index) => (secret && logs.includes(secret) ? index : null))
        .filter((index) => index !== null);
      if (leaked.length)
        await writeFile(
          join(base, 'runtime-log-privacy.json'),
          JSON.stringify({ container, categories: leaked }),
          { mode: 0o600 },
        );
      assert.equal(
        leaked.length,
        0,
        `General runtime log privacy failed for ${container}; inspect private category evidence`,
      );
    }

    await reauthenticateAdmin();
    // Current central changes cannot be bypassed by a completed installer receipt.
    const before = await readFile(join(state, '.env.dms'), 'utf8');
    v = await read();
    for (const type of ['assignment.draft', 'assignment.approve']) {
      v = await read();
      await call(path, {
        type,
        command: {
          version: 1,
          operationId: randomUUID(),
          expectedRevision: v.productRevision,
          binding: v.binding,
          catalogueDigest: draft.digest,
          requestedIndividualIds: [],
          confirmedResolvedIds: ['foundation'],
          explicitlyRemovedIds: ['incident-management'],
          confirmedRemovalClosureIds: ['incident-management'],
          activeBasis: v.authority.active,
          reason: 'Reconciliation fence qualification',
        },
      });
    }
    assert.equal((await invoke('resume', undefined, [20])).code, 20);
    assert.equal(await readFile(join(state, '.env.dms'), 'utf8'), before);
    const status = await invoke('status');
    assert.ok(
      status.result.conditions.includes('assigned-profile-changed-reconciliation-required'),
    );
    await writeFile(
      join(base, 'qualification.json'),
      JSON.stringify({
        version: 1,
        passed: true,
        scope: 'artifact-only-local-module-poc',
        releaseId: fixture.inventory.releaseId,
        profileDigest: fixture.request.profileDigest,
        installationId: reservation.resourceId,
        sourceDigest: fixture.request.profile.sourceDigest,
        catalogueDigest: fixture.request.profile.catalogueDigest,
        appliedSnapshot,
        productionAccepted: false,
      }),
      { mode: 0o600 },
    );
    console.log(
      'MOD-I09 fresh signed bundle: owning configuration/roles/migrations, independent pairing/approval/activation/acknowledgement, real email before client issuance, normal login/private handover, company setup, explicit Incident permission, DMS capabilities and desired-change fence passed.',
    );
  } finally {
    if (browser) await browser.close();
    const list = await run('docker', [
      'ps',
      '-aq',
      '--filter',
      `label=thaarei.installation=${(await read()).binding.localInstallationId}`,
    ]);
    for (const id of [...created, ...list.split('\n').filter(Boolean)])
      await run('docker', ['rm', '--force', id]).catch(() => {});
    await run('docker', ['network', 'disconnect', network, centralIngress]).catch(() => {});
    await run('docker', ['network', 'disconnect', network, mailContainer]).catch(() => {});
    await run('docker', ['network', 'rm', network]).catch(() => {});
    await run('docker', [
      'network',
      'rm',
      `thaarei-${(await read()).binding.localInstallationId}`,
    ]).catch(() => {});
    // Persistent database volume is intentionally retained; no existing or new DB volume is deleted.
  }
}
