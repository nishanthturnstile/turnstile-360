import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { audience, DECISION_TYPE } from '@thaarei/control-plane-contracts';
import { exportSPKI, generateKeyPair, SignJWT } from 'jose';
import {
  DeploymentClient,
  DeploymentTransportError,
  httpsTransport,
  nextSyncDelay,
  ProtectedFileStore,
  readProtectedTrust,
} from '../dist/index.js';

test('HTTPS client bounds retries/response sizes and rejects redirects/noncanonical origins', async () => {
  for (const origin of [
    'http://central.example',
    'https://central.example/path',
    'https://user:secret@central.example',
  ])
    assert.throws(() => httpsTransport(origin));
  let options;
  const transport = httpsTransport('https://central.example', async (_url, init) => {
    options = init;
    return new Response('{}');
  });
  assert.deepEqual(await transport('sync', {}, 'secret'), {});
  assert.equal(options.redirect, 'error');
  assert.equal(options.signal.aborted, false);
  assert.equal(options.headers.authorization, 'Bearer secret');
  await assert.rejects(
    httpsTransport(
      'https://central.example',
      async () => new Response('unavailable', { status: 429, headers: { 'retry-after': '50' } }),
    )('sync', {}),
    (e) => e instanceof DeploymentTransportError && e.retryAfterSeconds === 50,
  );
  await assert.rejects(
    httpsTransport('https://central.example', async () => new Response('x'.repeat(32769)))(
      'sync',
      {},
    ),
    /too large/,
  );
  for (let failures = 0; failures < 100; failures++)
    assert.ok(nextSyncDelay(failures, 900, () => 1) <= 900000);
  assert.ok(nextSyncDelay(1, 50, () => 0) >= 50000);
  for (const failures of [1, 4, 10])
    assert.ok(
      Number.isSafeInteger(nextSyncDelay(failures, null, () => 0.123456789)),
      'Persisted retry delay must fit the integer SQL scheduler',
    );
});

test('kernel lock fences independent processes and releases on process death', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'thaarei-lock-'));
  await mkdir(join(dir, 'state'), { mode: 0o700 });
  const marker = join(dir, 'marker');
  await writeFile(marker, randomBytes(48).toString('base64url'), { mode: 0o600 });
  const store = new ProtectedFileStore(join(dir, 'state'), marker);
  const module = new URL('../dist/index.js', import.meta.url).href;
  const script = `import {ProtectedFileStore} from ${JSON.stringify(module)};const store=new ProtectedFileStore(process.argv[1],process.argv[2]);await store.locked(async()=>{process.stdout.write('locked');await new Promise(()=>{});});`;
  const child = spawn(
    process.execPath,
    ['--input-type=module', '-e', script, store.directory, marker],
    { stdio: ['pipe', 'pipe', 'pipe'] },
  );
  try {
    await new Promise((done, reject) => {
      child.stdout.once('data', done);
      child.once('error', reject);
      child.once('exit', (code) => reject(new Error(`Child lock exited ${code}`)));
    });
    let acquired = false;
    const waiting = store.locked(async () => {
      acquired = true;
    });
    await new Promise((done) => setTimeout(done, 30));
    assert.equal(acquired, false);
    child.kill('SIGKILL');
    await waiting;
    assert.equal(acquired, true);
  } finally {
    child.kill('SIGKILL');
    await rm(dir, { recursive: true, force: true });
  }
});

test('private file client survives lost pairing/rotation and promotion crashes; restore marker and trust revoke close cached access', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'thaarei-client-'));
  const stateDir = join(directory, 'state');
  await mkdir(stateDir, { mode: 0o700 });
  const marker = join(directory, 'marker');
  await writeFile(marker, randomBytes(36).toString('base64url'), { mode: 0o600 });
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const trust = {
    version: 1,
    revision: 1,
    issuer: 'https://central.example',
    keys: [{ kid: 'test', pem: await exportSPKI(publicKey), status: 'active', lastIssuedAt: null }],
  };
  const expected = {
    clientId: randomUUID(),
    installationId: randomUUID(),
    productId: randomUUID(),
    localInstallationId: randomUUID(),
    tenantId: randomUUID(),
    product: 'dms',
    applicationId: null,
  };
  const epoch = randomUUID();
  const file = {
    version: 1,
    origin: trust.issuer,
    binding: expected,
    pairingId: randomUUID(),
    code: randomBytes(32).toString('base64url'),
    expiresAt: new Date(Date.now() + 86400000).toISOString(),
  };
  const store = new ProtectedFileStore(stateDir, marker);
  const save = store.save.bind(store);
  let failure = '';
  store.save = async (value) => {
    if (failure && value.current && !value.operation) {
      const mode = failure;
      failure = '';
      if (mode === 'after') await save(value);
      throw new Error('Promotion crash');
    }
    return save(value);
  };
  let live = null;
  let dropPair = true;
  let dropRotate = false;
  let sequence = 0;
  let unsignedState = false;
  const transport = async (path, input, secret) => {
    if (path === 'activate') {
      assert.equal((await store.load()).operation.request.candidateSecret, input.candidateSecret);
      assert.equal(live, null);
      live = { secret: input.candidateSecret, generation: 1, operationId: input.requestId };
      if (dropPair) throw new Error('Pairing response lost');
    } else if (!live || live.secret !== secret) throw new Error('Unauthorized candidate');
    if (path === 'rotate') {
      assert.equal(input.expectedGeneration, live.generation);
      live = {
        secret: input.candidateSecret,
        generation: live.generation + 1,
        operationId: input.operationId,
      };
      if (dropRotate) throw new Error('Rotation response lost');
    }
    if (path !== 'sync')
      return {
        version: 1,
        requestId: live.operationId,
        binding: expected,
        epoch,
        generation: live.generation,
        operationId: live.operationId,
      };
    const now = Math.floor(Date.now() / 1000);
    const decision = await new SignJWT({
      version: 1,
      iss: trust.issuer,
      aud: audience(expected),
      binding: expected,
      epoch,
      policyRevision: 1,
      decisionSequence: ++sequence,
      decisionId: randomUUID(),
      iat: now,
      nbf: now,
      exp: now + 604800,
      state: 'approved',
      entitlement: 'product-business',
    })
      .setProtectedHeader({ alg: 'RS256', typ: DECISION_TYPE, kid: 'test' })
      .sign(privateKey);
    return {
      version: 1,
      receiptId: input.reportId,
      binding: expected,
      epoch,
      generation: live.generation,
      operationId: live.operationId,
      decision,
      ...(unsignedState ? { state: 'approved' } : {}),
    };
  };
  const make = () => new DeploymentClient(store, transport, async () => trust);
  try {
    let client = make();
    await assert.rejects(client.setup(file), /response lost/);
    assert.equal((await store.load()).current, null);
    dropPair = false;
    client = make();
    await client.sync();
    assert.equal((await client.access()).access, 'full');
    client = make();
    assert.equal(
      (await client.access()).access,
      'full',
      'Restart verifies retained proof without network',
    );
    unsignedState = true;
    await assert.rejects(client.sync());
    unsignedState = false;
    assert.equal(
      (await client.access()).access,
      'full',
      'Unsigned outer state cannot replace retained proof',
    );
    const misconfigured = new DeploymentClient(
      store,
      httpsTransport('https://different.example', async () => {
        throw new Error('Must never transmit the paired secret');
      }),
      async () => trust,
    );
    await assert.rejects(misconfigured.sync(), /origin/);
    const first = (await store.load()).current;
    dropRotate = true;
    await assert.rejects(client.rotate(), /response lost/);
    dropRotate = false;
    client = make();
    await client.sync();
    assert.equal((await store.load()).current.generation, first.generation + 1);
    for (const crash of ['before', 'after']) {
      failure = crash;
      await assert.rejects(client.rotate());
      client = make();
      await client.sync();
      assert.equal((await store.load()).operation, null);
      assert.equal((await client.access()).access, 'full');
    }
    const pem = join(directory, 'trust');
    await writeFile(pem, JSON.stringify(trust), { mode: 0o600 });
    assert.deepEqual(await readProtectedTrust(pem), trust);
    const pristine = await store.load();
    const rollback = new DeploymentClient(
      store,
      transport,
      async () => trust,
      () => pristine.decision.lastTime - 1,
    );
    assert.equal((await rollback.access()).access, 'closed');
    assert.equal(
      (await store.load()).decision.quarantined,
      true,
      'Clock rollback quarantine survives restart',
    );
    await save(pristine);
    const previousMarker = await readFile(marker, 'utf8');
    await writeFile(marker, randomBytes(36).toString('base64url'), { mode: 0o600 });
    assert.equal(
      (await make().access()).access,
      'closed',
      'Restore marker mismatch closes previously full access',
    );
    assert.equal((await store.load()).decision.quarantined, true);
    await writeFile(marker, previousMarker, { mode: 0o600 });
    await save(pristine); // Fixture-only reset separates independent trust/clock/restore cases.
    trust.revision = 2;
    trust.keys[0].status = 'revoked';
    assert.equal((await client.access()).access, 'closed');
    assert.equal((await store.load()).decision.quarantined, true);
    trust.revision = 1;
    trust.keys[0].status = 'active';
    assert.equal((await client.access()).access, 'closed');
    const content = JSON.parse(await readFile(join(stateDir, 'product.json'), 'utf8'));
    assert.equal(content.current.secret, live.secret);
    await writeFile(marker, randomBytes(36).toString('base64url'), { mode: 0o600 });
    assert.equal((await client.access()).access, 'closed');
    await assert.rejects(client.setup(file), /rebind/);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
