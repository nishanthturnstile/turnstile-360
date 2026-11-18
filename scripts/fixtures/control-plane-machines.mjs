import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import pg from 'pg';
import {
  applyDecision,
  DeploymentClient,
  evaluateDecision,
  ProtectedFileStore,
  verifyDecision,
} from '../../packages/deployment-control/dist/index.js';
import { verifyReports } from './control-plane-reports.mjs';

const fixtureLicenceEnd = new Date(Date.now() + 365 * 86400000).toISOString();

export async function verifyCentralMachines({
  admin,
  viewer,
  anonymous,
  database,
  publicTrust,
  temporary,
  origin,
  runtimeUrl,
  markerFile,
  backup,
  restore,
  reconcile,
  verifyOffline,
}) {
  const fresh = (input) => ({
    requestId: randomUUID(),
    reason: 'isolated machine protocol verification',
    ...input,
  });
  const command = async (input) => {
    const r = await admin.call('/api/registry', fresh(input));
    assert.equal(r.status, 200, r.text);
    return r.json();
  };
  const customer = await command({
    type: 'client.create',
    code: 'MACHINE-PROTOCOL',
    name: 'Protocol fixture',
  });
  const installation = await command({
    type: 'installation.create',
    clientId: customer.clientId,
    environment: 'protocol',
    label: 'Protocol fixture',
    localInstallationId: randomUUID(),
    tenantId: randomUUID(),
  });
  const product = await command({
    type: 'product.create',
    clientId: customer.clientId,
    installationId: installation.resourceId,
    binding: { product: 'dms', applicationId: null },
  });
  const exported = await admin.call(`/api/registry/products/${product.resourceId}/manifest`);
  assert.equal(exported.status, 200, exported.text);
  const expected = exported.json().binding;
  const getProduct = async () => {
    const r = await admin.call(`/api/registry/clients/${customer.clientId}`);
    assert.equal(r.status, 200, r.text);
    return r.json().products.find((p) => p.id === product.resourceId);
  };
  const issue = async (action = 'issue') => {
    const revision = (await getProduct()).revision;
    const code = randomBytes(32).toString('base64url');
    const pairingId = randomUUID();
    const input = fresh({ productId: product.resourceId, revision, action, pairingId, code });
    assert.equal((await viewer.call('/api/pairing', input)).status, 403);
    const result = await admin.call('/api/pairing', input);
    assert.equal(result.status, 200, result.text);
    assert.equal((await admin.call('/api/pairing', { ...input, reason: 'different' })).status, 409);
    assert.deepEqual((await admin.call('/api/pairing', input)).json(), result.json());
    return {
      version: 1,
      origin,
      binding: expected,
      pairingId,
      code,
      expiresAt: result.json().expiresAt,
    };
  };
  const call = async (path, input, key, options = {}) =>
    anonymous.call(`/api/machine/v1/${path}`, input, {
      ...options,
      headers: { ...(key ? { authorization: `Bearer ${key}` } : {}) },
    });
  const syncInput = (epoch = null) => ({
    version: 1,
    reportId: randomUUID(),
    binding: expected,
    epoch,
    applied: null,
  });
  for (const actor of [admin, viewer, anonymous])
    assert.equal(
      (await actor.call('/api/machine/v1/sync', syncInput())).status,
      401,
      'Cookies never authenticate machines',
    );
  assert.equal(
    (await call('sync', syncInput(), 'eyJhbGciOiJSUzI1NiJ9.payload.signature')).status,
    401,
    'Customer JWT rejected',
  );
  let file = await issue();
  const activation = {
    version: 1,
    requestId: randomUUID(),
    binding: expected,
    pairingId: file.pairingId,
    code: file.code,
    candidateSecret: randomBytes(32).toString('base64url'),
  };
  assert.equal(
    (await call('activate', { ...activation, code: randomBytes(32).toString('base64url') })).status,
    401,
  );
  assert.equal(
    (await call('activate', { ...activation, binding: { ...expected, tenantId: randomUUID() } }))
      .status,
    409,
  );
  await database.query(
    "UPDATE control_plane.pairing SET expires_at=now()-interval '1 second' WHERE id=$1",
    [file.pairingId],
  );
  assert.equal((await call('activate', activation)).status, 409);
  file = await issue();
  const revoke = fresh({
    action: 'revoke',
    productId: product.resourceId,
    revision: 1,
    pairingId: file.pairingId,
    code: null,
  });
  assert.equal((await admin.call('/api/pairing', revoke)).status, 200);
  assert.equal(
    (await call('activate', { ...activation, pairingId: file.pairingId, code: file.code })).status,
    401,
  );
  file = await issue();
  const race = await Promise.all([
    call('activate', { ...activation, pairingId: file.pairingId, code: file.code }),
    call('activate', {
      ...activation,
      requestId: randomUUID(),
      pairingId: file.pairingId,
      code: file.code,
      candidateSecret: randomBytes(32).toString('base64url'),
    }),
  ]);
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 401]);
  const winning = (
    await database.query('SELECT request_id FROM control_plane.pairing WHERE id=$1', [
      file.pairingId,
    ])
  ).rows[0].request_id;
  // Race winner can be either request; use replacement for a deterministic lost-response client.
  assert.ok(winning);
  file = await issue('replace');
  const directory = join(temporary, 'private-product');
  await mkdir(directory, { mode: 0o700 });
  const localMarker = join(temporary, 'local-marker');
  await writeFile(localMarker, randomBytes(36).toString('base64url'), { mode: 0o600 });
  const store = new ProtectedFileStore(directory, localMarker);
  let dropActivation = true;
  let dropRotation = false;
  let failPromotion = '';
  const realSave = store.save.bind(store);
  store.save = async (value) => {
    if (failPromotion && value.current && !value.operation) {
      const mode = failPromotion;
      failPromotion = '';
      if (mode === 'after') await realSave(value);
      throw new Error('Fixture crash during local promotion');
    }
    return realSave(value);
  };
  const transport = async (path, input, key) => {
    if (path === 'activate') {
      const saved = await store.load();
      assert.equal(
        saved.operation.request.candidateSecret,
        input.candidateSecret,
        'Secret was durable before transmission',
      );
    }
    const drop = (path === 'activate' && dropActivation) || (path === 'rotate' && dropRotation);
    const result = await call(path, input, key, drop ? { dropResponse: true } : {});
    if (result.status !== 200)
      throw new Error(`Fixture protocol HTTP ${result.status}: ${result.text}`);
    return result.json();
  };
  let client = new DeploymentClient(store, transport, async () => publicTrust);
  await assert.rejects(client.setup(file), /discarded/);
  dropActivation = false;
  let saved = await store.load();
  assert.equal(saved.current, null);
  assert.ok(saved.operation);
  const candidate = saved.operation.request.candidateSecret;
  // Pairing receipt and code have expired; candidate-authenticated sync still recovers.
  await database.query(
    "UPDATE control_plane.pairing SET consumed_at=now()-interval '25 hours',expires_at=now()-interval '1 hour' WHERE id=$1",
    [file.pairingId],
  );
  assert.equal((await call('activate', saved.operation.request)).status, 409);
  client = new DeploymentClient(store, transport, async () => publicTrust);
  await client.sync();
  saved = await store.load();
  assert.equal(saved.current.secret, candidate);
  assert.equal(saved.operation, null);
  assert.equal((await client.access()).access, 'closed', 'Pairing is never approval');
  const pending = await client.sync();
  const epoch = pending.epoch;
  assert.equal(
    (
      await verifyDecision(
        pending.decision,
        expected,
        epoch,
        publicTrust,
        Math.floor(Date.now() / 1000),
      )
    ).state,
    'pending',
    'Replacement does not create approval',
  );
  assert.equal(
    (await call('sync', syncInput(epoch), randomBytes(32).toString('base64url'))).status,
    401,
  );
  assert.equal(
    (
      await call(
        'sync',
        { ...syncInput(epoch), binding: { ...expected, productId: randomUUID() } },
        candidate,
      )
    ).status,
    409,
  );
  assert.equal(
    (
      await call(
        'sync',
        { ...syncInput(epoch), binding: { ...expected, tenantId: randomUUID() } },
        candidate,
      )
    ).status,
    409,
  );
  assert.equal(
    (await call('sync', { ...syncInput(epoch), unexpected: 'customer contents' }, candidate))
      .status,
    400,
  );
  assert.equal(
    (await call('sync', { ...syncInput(epoch), payload: 'x'.repeat(33000) }, candidate)).status,
    413,
  );
  const policy = async (decision) =>
    command({
      type: 'product.policy',
      id: product.resourceId,
      revision: (await getProduct()).revision,
      decision,
      ...(decision === 'approve' ? { licenceExpiresAt: fixtureLicenceEnd } : {}),
    });
  await policy('approve');
  const active = await client.sync();
  assert.equal((await client.access()).access, 'full');
  await client.sync();
  const dto = await getProduct();
  assert.ok(dto.firstIssuedApprovalAt);
  assert.ok(dto.firstActivationAcknowledgedAt);
  assert.ok(dto.currentActivationAcknowledgedAt);
  assert.ok(dto.lastContactAt);
  await verifyReports({
    admin,
    viewer,
    anonymous,
    database,
    runtimeUrl,
    call,
    syncInput,
    epoch,
    secret: candidate,
    productId: product.resourceId,
    clientId: customer.clientId,
    policy,
  });
  await verifyOffline((await store.load()).decision, expected);
  // Actual staff command and issuer: online renewal cannot outlive a contractual end.
  const licencePolicy = async (licenceExpiresAt) =>
    command({
      type: 'product.policy',
      id: product.resourceId,
      revision: (await getProduct()).revision,
      decision: 'approve',
      licenceExpiresAt,
    });
  const deadline = Math.floor(Date.now() / 1000) + 5;
  await licencePolicy(new Date(deadline * 1000).toISOString());
  const short = await client.sync();
  const signed = await verifyDecision(
    short.decision,
    expected,
    epoch,
    publicTrust,
    Math.floor(Date.now() / 1000),
  );
  assert.equal(signed.licenceExpiresAt, deadline);
  assert.equal(signed.exp, deadline, 'Cached longer approvals must not survive licence shortening');
  await new Promise((done) => setTimeout(done, Math.max(0, deadline * 1000 - Date.now()) + 100));
  assert.deepEqual(await client.access(), { access: 'closed', state: 'licence-expired' });
  assert.equal(
    (await call('sync', syncInput(epoch), candidate)).status,
    403,
    'Online clients cannot renew expired licences',
  );
  await licencePolicy(fixtureLicenceEnd);
  await client.sync();
  assert.equal(
    (await client.access()).access,
    'full',
    'New licence revision restores approved access',
  );
  console.log(
    'Contractual licence: actual HTTP shortening, bounded signed expiry, offline closure, online renewal denial and staff renewal passed.',
  );
  const preDenialBackup = await backup();
  const report = syncInput(epoch);
  const first = (await call('sync', report, candidate)).json();
  assert.equal(
    (
      await call(
        'sync',
        {
          ...report,
          applied: {
            decisionId: randomUUID(),
            policyRevision: 1,
            decisionSequence: 1,
            appliedAt: 1,
          },
        },
        candidate,
      )
    ).status,
    409,
  );
  await policy('suspend');
  client = new DeploymentClient(
    store,
    transport,
    async () => publicTrust,
    undefined,
    async () => {
      throw new Error('Owning metrics temporarily unavailable');
    },
  );
  const denied = await client.sync();
  client = new DeploymentClient(store, transport, async () => publicTrust);
  assert.equal((await client.access()).access, 'existing-reads');
  await assert.rejects(
    store.locked(async () => {
      const current = await store.load();
      await applyDecision(
        current.decision,
        active.decision,
        expected,
        publicTrust,
        Math.floor(Date.now() / 1000),
      );
    }),
    /Stale/,
  );
  const retry = (await call('sync', report, candidate)).json();
  assert.equal(retry.receiptId, first.receiptId);
  assert.notEqual(retry.decision, first.decision, 'Retry returns current denial');
  const deniedClaims = await verifyDecision(
    denied.decision,
    expected,
    epoch,
    publicTrust,
    Math.floor(Date.now() / 1000),
  );
  const local = await store.load();
  assert.equal(
    (await evaluateDecision(local.decision, expected, publicTrust, deniedClaims.exp + 1)).access,
    'existing-reads',
    'Expired denial never falls back to approval',
  );
  await policy('approve');
  await client.sync();
  // Lost rotation response recovers via the already durable candidate without old-secret replay.
  const before = await store.load();
  dropRotation = true;
  await assert.rejects(client.rotate(), /discarded/);
  dropRotation = false;
  assert.ok((await store.load()).operation);
  await client.sync();
  saved = await store.load();
  assert.equal(saved.current.generation, before.current.generation + 1);
  assert.notEqual(saved.current.secret, before.current.secret);
  assert.equal((await call('sync', syncInput(epoch), before.current.secret)).status, 401);
  // Shared product lock serializes simultaneous operator/reporter rotations across instances.
  const peer = new DeploymentClient(
    new ProtectedFileStore(directory, localMarker),
    transport,
    async () => publicTrust,
  );
  const gen = saved.current.generation;
  await Promise.all([client.rotate(), peer.rotate()]);
  assert.equal((await store.load()).current.generation, gen + 2);
  for (const crash of ['before', 'after']) {
    failPromotion = crash;
    await assert.rejects(client.rotate());
    client = new DeploymentClient(store, transport, async () => publicTrust);
    await client.sync();
    assert.equal((await store.load()).operation, null);
    assert.equal((await client.access()).access, 'full');
  }
  // Explicit new binding epoch rejects all old-epoch proofs and old credentials.
  const old = await store.load();
  file = await issue('replace');
  await client.setup(file, true);
  const rebound = await store.load();
  assert.notEqual(rebound.current.epoch, epoch);
  const reboundReports = await viewer.call(`/api/reports/products/${product.resourceId}`);
  assert.equal(reboundReports.status, 200, reboundReports.text);
  assert.equal(reboundReports.json().product.freshness, 'never');
  assert.equal(
    reboundReports.json().product.report,
    null,
    'Reports from an old binding epoch cannot describe a rebound installation',
  );
  assert.equal(rebound.decision.activation, null);
  await assert.rejects(
    verifyDecision(
      active.decision,
      expected,
      rebound.current.epoch,
      publicTrust,
      Math.floor(Date.now() / 1000),
    ),
    /binding/,
  );
  assert.equal((await call('sync', syncInput(epoch), old.current.secret)).status, 401);
  assert.equal((await client.access()).access, 'closed');
  assert.equal((await getProduct()).currentActivationAcknowledgedAt, null);
  await policy('approve');
  await client.sync();
  const clockState = await store.load();
  clockState.decision.lastTime = Math.floor(Date.now() / 1000) + 100;
  await realSave(clockState);
  assert.equal((await client.access()).access, 'closed');
  assert.equal((await store.load()).decision.quarantined, true);
  await writeFile(localMarker, randomBytes(36).toString('base64url'), { mode: 0o600 });
  assert.equal(
    (await client.access()).access,
    'closed',
    'External restore marker fences cached business',
  );
  const limited = new pg.Pool({ connectionString: runtimeUrl, max: 1 });
  try {
    for (const sql of [
      'UPDATE control_plane.machine_authority SET marker_digest=marker_digest',
      'DELETE FROM control_plane.machine',
      'UPDATE control_plane.machine_receipt SET digest=digest',
      'UPDATE control_plane.machine_decision SET state=state',
    ])
      await assert.rejects(limited.query(sql), (e) => e.code === '42501');
  } finally {
    await limited.end();
  }
  const machineRow = (
    await database.query('SELECT secret_digest FROM control_plane.machine WHERE product_id=$1', [
      product.resourceId,
    ])
  ).rows[0];
  assert.match(machineRow.secret_digest, /^[a-f0-9]{64}$/);
  assert.notEqual(machineRow.secret_digest, (await store.load()).current.secret);
  // A real backup predates suspension, credential rotations and replacement. The independent
  // marker must quarantine issuance BEFORE database replacement, including disconnected recovery.
  await writeFile(markerFile, randomBytes(48).toString('base64url'), { mode: 0o600 });
  assert.equal((await call('sync', syncInput(epoch), candidate)).status, 503);
  await restore(preDenialBackup);
  assert.equal(
    (await getProduct()).policyState,
    'approved',
    'Backup really contains stale approval',
  );
  assert.equal(
    (await call('sync', syncInput(epoch), candidate)).status,
    503,
    'Restored approval cannot issue while marker differs',
  );
  const deniedApproval = await admin.call(
    '/api/registry',
    fresh({
      type: 'product.policy',
      id: product.resourceId,
      revision: (await getProduct()).revision,
      decision: 'approve',
      licenceExpiresAt: fixtureLicenceEnd,
    }),
  );
  assert.equal(deniedApproval.status, 503);
  await reconcile();
  assert.equal((await getProduct()).policyState, 'suspended');
  assert.equal(
    (await call('sync', syncInput(epoch), candidate)).status,
    401,
    'Reconciliation revokes restored machine credentials',
  );
  const recoveryDirectory = join(temporary, 'recovered-product');
  await mkdir(recoveryDirectory, { mode: 0o700 });
  const recovered = new DeploymentClient(
    new ProtectedFileStore(recoveryDirectory, localMarker),
    async (path, input, key) => {
      const result = await call(path, input, key);
      assert.equal(result.status, 200, result.text);
      return result.json();
    },
    async () => publicTrust,
  );
  await recovered.setup(await issue('replace'), true);
  assert.equal(
    (await recovered.access()).access,
    'closed',
    'Reconciliation never implicitly reapproves',
  );
  await policy('approve');
  await recovered.sync();
  assert.equal((await recovered.access()).access, 'full');
  console.log(
    'Central machine HTTPS/PostgreSQL: actual pre-denial backup restore, external-marker quarantine, missing-evidence reconciliation, credential revocation, fresh pairing and explicit approval passed.',
  );
}
