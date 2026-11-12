import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import {
  applyDecision,
  evaluateModuleDecision,
  initialDecisionState,
  verifyInstalledModuleRelease,
  verifyModuleDecision,
} from '../../packages/deployment-control/dist/index.js';
import {
  createProfile,
  deliveryReleaseId,
  deliveryRequestDigest,
  profileDigest,
} from '../../packages/module-catalog/dist/index.js';
import { codeModules } from '../module-source-map.mjs';

/** Actual HTTPS handler and PostgreSQL path; synthetic metadata is explicit fixture seed. */
export async function verifyModuleMachines({
  admin,
  viewer,
  anonymous,
  database,
  publicTrust,
  releaseTrust,
  signDelivery,
  reauthenticateAdmin,
}) {
  await reauthenticateAdmin();
  const command = async (input) => {
    const r = await admin.call('/api/registry', {
      requestId: randomUUID(),
      reason: 'isolated v2 protocol qualification',
      ...input,
    });
    assert.equal(r.status, 200, r.text);
    return r.json();
  };
  const customer = await command({
    type: 'client.create',
    code: 'MODULE-MACHINE',
    name: 'V2 protocol fixture',
  });
  const installation = await command({
    type: 'installation.create',
    clientId: customer.clientId,
    environment: 'protocol',
    label: 'V2',
    localInstallationId: randomUUID(),
    tenantId: randomUUID(),
  });
  const product = await command({
    type: 'product.create',
    clientId: customer.clientId,
    installationId: installation.resourceId,
    binding: { product: 'turnstile', applicationId: randomUUID() },
  });
  const id = product.resourceId;
  const manifest = await admin.call(`/api/registry/products/${id}/manifest`);
  assert.equal(manifest.status, 200, manifest.text);
  const binding = manifest.json().binding;
  const revision = async () =>
    Number(
      (
        await database.query('SELECT revision FROM control_plane.registry_product WHERE id=$1', [
          id,
        ])
      ).rows[0].revision,
    );
  const enforce = {
    operationId: randomUUID(),
    expectedRevision: await revision(),
    reason: 'Reviewed enforcing release upgrade',
  };
  const route = `/api/registry/products/${id}/modules/enforce`;
  assert.equal((await viewer.call(route, enforce)).status, 403);
  assert.equal((await anonymous.call(route, enforce)).status, 401);
  await assert.rejects(admin.call(route, enforce, { dropResponse: true }));
  const recovered = await admin.call(route, enforce);
  assert.equal(recovered.status, 200, recovered.text);
  assert.equal(recovered.json().revision, enforce.expectedRevision + 1);
  assert.equal((await admin.call(route, { ...enforce, reason: 'changed' })).status, 409);
  const call = (path, raw, key, options = {}) =>
    anonymous.call(`/api/machine/v1/${path}`, raw, {
      ...options,
      headers: { authorization: `Bearer ${key}` },
    });
  const pair = async (action = 'issue') => {
    const code = randomBytes(32).toString('base64url'),
      pairingId = randomUUID();
    const issue = await admin.call('/api/pairing', {
      requestId: randomUUID(),
      reason: 'isolated module pairing',
      productId: id,
      revision: await revision(),
      action,
      pairingId,
      code,
    });
    assert.equal(issue.status, 200, issue.text);
    const secret = randomBytes(32).toString('base64url');
    const activated = await call('activate', {
      version: 1,
      requestId: randomUUID(),
      binding,
      pairingId,
      code,
      candidateSecret: secret,
    });
    assert.equal(activated.status, 200, activated.text);
    return { secret, epoch: activated.json().epoch };
  };
  let machine = await pair();
  const catalogue = {
    version: 1,
    id: randomUUID(),
    sourceDigest: 'a'.repeat(64),
    platform: 'linux/amd64',
    contractVersion: 2,
    migrationVersion: 1,
    modules: codeModules,
  };
  const profile = await createProfile(
    catalogue,
    { requestedIndividualIds: ['incident-management'] },
    ['foundation', 'incident-management'],
  );
  const request = { version: 1, catalogue, profile, profileDigest: await profileDigest(profile) };
  const evidence = {
    version: 1,
    kind: 'delivery',
    requestDigest: await deliveryRequestDigest(request),
    inventory: {
      version: 1,
      catalogueDigest: profile.catalogueDigest,
      profileDigest: request.profileDigest,
      sourceDigest: profile.sourceDigest,
      releaseId: '0'.repeat(64),
      platform: profile.platform,
      images: [
        { role: 'turnstile-api', digest: 'a'.repeat(64) },
        { role: 'turnstile-web', digest: 'b'.repeat(64) },
      ],
      archiveDigest: 'c'.repeat(64),
      noticesDigest: 'd'.repeat(64),
      sourceInventoryDigest: 'e'.repeat(64),
    },
    artifactInventoryDigest: 'f'.repeat(64),
    documentationDigest: 'a'.repeat(64),
  };
  evidence.inventory.releaseId = await deliveryReleaseId(evidence);
  const release = await verifyInstalledModuleRelease(
    await signDelivery(evidence),
    request,
    profile,
    releaseTrust,
    Math.floor(Date.now() / 1000),
  );
  const installed = {
    catalogueDigest: profile.catalogueDigest,
    profileDigest: request.profileDigest,
    releaseId: release.releaseId,
  };
  const input = () => ({
    version: 2,
    reportId: randomUUID(),
    binding,
    epoch: machine.epoch,
    applied: null,
    installed,
  });
  const legacy = input();
  delete legacy.installed;
  legacy.version = 1;
  assert.equal((await call('sync', legacy, machine.secret)).status, 409);
  assert.equal((await call('sync', { ...input(), version: 3 }, machine.secret)).status, 400);
  const sync = async (raw = input(), options) => {
    const response = await call('sync', raw, machine.secret, options);
    assert.equal(response.status, 200, response.text);
    return response.json();
  };
  const verify = (token) =>
    verifyModuleDecision(
      token,
      binding,
      machine.epoch,
      publicTrust,
      Math.floor(Date.now() / 1000),
      release,
    );
  assert.equal((await verify((await sync()).decision)).state, 'pending');
  await command({ type: 'product.policy', id, revision: await revision(), decision: 'approve' });
  assert.equal(
    (await verify((await sync()).decision)).state,
    'pending',
    'Ordinary product approval cannot grant modules',
  );
  // Only the private fixture seeds active approval. The production runtime has no such
  // write privilege; reviewed activation/cutover is MOD-I08 work, not inferred from inventory.
  const policy = {
    active: { ...installed, assignmentRevision: 2, policyRevision: await revision() },
    desired: {
      catalogueDigest: installed.catalogueDigest,
      profileDigest: installed.profileDigest,
      assignmentRevision: 2,
    },
    changeAssignmentRevision: 2,
    allowedModuleIds: ['foundation', 'incident-management'],
  };
  await database.query(
    'UPDATE control_plane.module_authority SET document=$2 WHERE product_id=$1',
    [id, JSON.stringify({ version: 1, epoch: machine.epoch, request, policy })],
  );
  await database.query(
    'UPDATE control_plane.registry_product SET revision=revision+1 WHERE id=$1',
    [id],
  );
  const journal = input();
  await assert.rejects(sync(journal, { dropResponse: true }));
  const approved = (await sync(journal)).decision;
  const accepted = await applyDecision(
    initialDecisionState(machine.epoch),
    approved,
    binding,
    publicTrust,
    Math.floor(Date.now() / 1000),
    release,
  );
  assert.deepEqual(
    (
      await evaluateModuleDecision(
        accepted,
        binding,
        publicTrust,
        Math.floor(Date.now() / 1000),
        release,
      )
    ).allowedModuleIds.sort(),
    ['foundation', 'incident-management'],
  );
  assert.equal(
    (
      await call(
        'sync',
        { ...input(), installed: { ...installed, profileDigest: 'c'.repeat(64) } },
        machine.secret,
      )
    ).status,
    409,
  );
  policy.allowedModuleIds = ['foundation'];
  await database.query(
    'UPDATE control_plane.module_authority SET document=$2 WHERE product_id=$1',
    [id, JSON.stringify({ version: 1, epoch: machine.epoch, request, policy })],
  );
  await database.query(
    'UPDATE control_plane.registry_product SET revision=revision+1 WHERE id=$1',
    [id],
  );
  const restricted = (await sync(journal)).decision;
  const state = await applyDecision(
    accepted,
    restricted,
    binding,
    publicTrust,
    Math.floor(Date.now() / 1000),
    release,
  );
  await assert.rejects(
    applyDecision(state, approved, binding, publicTrust, Math.floor(Date.now() / 1000), release),
    /Stale/,
  );
  assert.deepEqual(
    (
      await evaluateModuleDecision(
        state,
        binding,
        publicTrust,
        Math.floor(Date.now() / 1000),
        release,
      )
    ).allowedModuleIds,
    ['foundation'],
  );
  machine = await pair('replace');
  assert.equal((await verify((await sync()).decision)).state, 'suspended');
  await command({ type: 'product.policy', id, revision: await revision(), decision: 'approve' });
  assert.equal((await verify((await sync()).decision)).state, 'pending');
  console.log(
    'Actual module machine HTTPS/PostgreSQL fixture passed: MFA enforcement receipt recovery, strict versions, pending activation, exact approved context, lost sync, removal/stale replay and replacement epoch. Selected installed-image qualification is separate.',
  );
}
