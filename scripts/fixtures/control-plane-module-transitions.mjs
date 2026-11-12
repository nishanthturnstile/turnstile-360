// Real HTTPS mutations, machine signing and owning SQL. Pipeline inventories below are
// synthetic signed fixture metadata; selected-container qualification is separate.
import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { decodeJwt } from 'jose';
import {
  catalogueDigest,
  createProfile,
  deliveryReleaseId,
  deliveryRequestDigest,
  profileDigest,
  resolveSelection,
} from '../../packages/module-catalog/dist/index.js';
import { codeModules } from '../module-source-map.mjs';

export async function verifyModuleTransitions({
  admin,
  viewer,
  anonymous,
  database,
  referenceDirectory,
  signEvidence,
  reauthenticateAdmin,
  reauthenticateViewer,
}) {
  await reauthenticateAdmin();
  const call = async (actor, path, body, status = 200) => {
    const r = await actor.call(path, body);
    assert.equal(r.status, status, `${path}: ${r.text}`);
    return status === 200 ? r.json() : r;
  };
  const registry = (body) =>
    call(admin, '/api/registry', {
      requestId: randomUUID(),
      reason: 'isolated module transitions',
      ...body,
    });
  const catalog = (body) =>
    call(admin, '/api/module-catalogues', {
      requestId: randomUUID(),
      reason: 'isolated module transitions',
      ...body,
    });
  const code = {
    version: 1,
    id: randomUUID(),
    sourceDigest: 'd'.repeat(64),
    platform: 'linux/amd64',
    contractVersion: 2,
    migrationVersion: 1,
    modules: codeModules,
  };
  await catalog({
    type: 'code.import',
    attestation: await signEvidence({ version: 1, kind: 'code', catalogue: code }),
  });
  const publish = async (categories) => {
    const id = randomUUID();
    await catalog({ type: 'draft.create', id, sourceId: code.id, categories });
    const record = await call(admin, `/api/module-catalogues/${id}`);
    await catalog({
      type: 'catalogue.publish',
      id,
      revision: record.revision,
      attestation: await signEvidence({
        version: 1,
        kind: 'classification',
        catalogueId: id,
        catalogueDigest: record.digest,
        codeCatalogueDigest: await catalogueDigest(code),
        draftRevision: record.revision,
      }),
    });
    return record.catalogue;
  };
  const c = await publish(code.modules.map(({ id, category }) => ({ id, category })));
  const client = await registry({
    type: 'client.create',
    code: 'MODULE-TRANSITIONS',
    name: 'Module transitions',
  });
  const installation = await registry({
    type: 'installation.reserve',
    clientId: client.clientId,
    environment: 'transitions',
    label: 'Isolated module transitions',
  });
  const detail = await call(admin, `/api/registry/clients/${client.clientId}`);
  const id = detail.products.find(
    (p) => p.installationId === installation.resourceId && p.product === 'turnstile',
  ).id;
  const path = `/api/registry/products/${id}/modules`,
    read = () => call(admin, path);
  let pairing;
  const assign = async (source, ids, removed = [], options = {}) => {
    const prepare = async (type) => {
      const v = await read();
      const resolution = resolveSelection(source, { requestedIndividualIds: ids });
      return {
        type,
        command: {
          version: 1,
          operationId: randomUUID(),
          expectedRevision: v.productRevision,
          binding: v.binding,
          catalogueDigest: await catalogueDigest(source),
          requestedIndividualIds: ids,
          confirmedResolvedIds: resolution.resolvedIds,
          explicitlyRemovedIds: removed,
          confirmedRemovalClosureIds: removed,
          activeBasis: v.authority?.active ?? null,
          reason: 'reviewed isolated replacement',
        },
      };
    };
    const draft = await prepare('assignment.draft');
    await call(admin, path, draft);
    const approval = await prepare('assignment.approve');
    if (options.lost) await assert.rejects(admin.call(path, approval, { dropResponse: true }));
    await call(admin, path, approval);
    return approval;
  };
  const deliver = async (source, ids) => {
    const profile = await createProfile(
      source,
      { requestedIndividualIds: ids },
      resolveSelection(source, { requestedIndividualIds: ids }).resolvedIds,
    );
    const request = {
      version: 1,
      catalogue: source,
      profile,
      profileDigest: await profileDigest(profile),
    };
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
    const attestation = await signEvidence(evidence, 86400, 'delivery');
    await writeFile(
      join(referenceDirectory, `${request.profileDigest}.json`),
      JSON.stringify({ request, attestation }),
      { mode: 0o644 },
    );
    return {
      catalogueDigest: profile.catalogueDigest,
      profileDigest: request.profileDigest,
      releaseId: evidence.inventory.releaseId,
    };
  };
  const machineCall = (name, input) =>
    anonymous.call(`/api/machine/v1/${name}`, input, {
      headers: { authorization: `Bearer ${pairing.secret}` },
    });
  const sync = async (installed, status = 200, applied = null) => {
    const v = await read();
    const r = await machineCall('sync', {
      version: 2,
      reportId: randomUUID(),
      binding: v.binding,
      epoch: pairing.epoch,
      applied,
      installed,
    });
    assert.equal(r.status, status, r.text);
    return status === 200 ? decodeJwt(r.json().decision) : null;
  };
  const activation = async () => {
    const v = await read();
    return {
      operationId: randomUUID(),
      expectedRevision: v.productRevision,
      desiredRevision: v.desired.revision,
      epoch: pairing.epoch,
      installed: v.inventory.installed,
      activeBasis: v.authority?.active ?? null,
      reason: 'reviewed isolated activation',
    };
  };
  await assign(c, ['incident-management']);
  const incident = await deliver(c, ['incident-management']);
  await call(admin, `${path}/enforce`, {
    operationId: randomUUID(),
    expectedRevision: (await read()).productRevision,
    reason: 'Reviewed v2 transition',
  });
  const pair = async (action = 'issue') => {
    const code = randomBytes(32).toString('base64url'),
      pairingId = randomUUID(),
      v = await read();
    await call(admin, '/api/pairing', {
      requestId: randomUUID(),
      reason: 'transition pairing',
      productId: id,
      revision: v.productRevision,
      action,
      pairingId,
      code,
    });
    const secret = randomBytes(32).toString('base64url');
    const activated = await call(anonymous, '/api/machine/v1/activate', {
      version: 1,
      requestId: randomUUID(),
      binding: v.binding,
      pairingId,
      code,
      candidateSecret: secret,
    });
    return { secret, epoch: activated.epoch };
  };
  pairing = await pair();
  await registry({
    type: 'product.policy',
    id,
    revision: (await read()).productRevision,
    decision: 'approve',
  });
  assert.equal((await sync(incident)).state, 'pending');
  let approved = await activation();
  await call(viewer, `${path}/activate`, approved, 403);
  await call(anonymous, `${path}/activate`, approved, 401);
  await assert.rejects(admin.call(`${path}/activate`, approved, { dropResponse: true }));
  await call(admin, `${path}/activate`, approved);
  assert.deepEqual((await sync(incident)).modulePolicy.allowedModuleIds, [
    'foundation',
    'incident-management',
  ]);
  const initialReceipt = approved;
  const firstGrant = await sync(incident);
  assert.ok((await read()).statuses.includes('awaiting-acknowledgement'));
  assert.equal(
    (await read()).effective,
    null,
    'Approval and installed observation alone are not application acknowledgement',
  );
  const applied = {
    decisionId: firstGrant.decisionId,
    policyRevision: firstGrant.policyRevision,
    decisionSequence: firstGrant.decisionSequence,
    appliedAt: Math.max(firstGrant.iat, Math.floor(Date.now() / 1000)),
  };
  await sync(incident, 200, { ...applied, decisionId: randomUUID() });
  assert.equal(
    (await read()).effective,
    null,
    'Unknown decision cannot become application evidence',
  );
  const acknowledgedRequest = {
    version: 2,
    reportId: randomUUID(),
    binding: (await read()).binding,
    epoch: pairing.epoch,
    applied,
    installed: incident,
  };
  await assert.rejects(
    anonymous.call('/api/machine/v1/sync', acknowledgedRequest, {
      headers: { authorization: `Bearer ${pairing.secret}` },
      dropResponse: true,
    }),
  );
  const ackRetry = await machineCall('sync', acknowledgedRequest);
  assert.equal(ackRetry.status, 200, ackRetry.text);
  assert.ok((await read()).statuses.includes('active'));
  assert.equal((await read()).effective.decisionId, firstGrant.decisionId);
  const statusRequest = { version: 1, binding: (await read()).binding, epoch: pairing.epoch };
  const reported = await machineCall('status', statusRequest);
  assert.equal(reported.status, 200, reported.text);
  assert.equal(reported.json().activationAcknowledged, true);
  assert.equal(reported.json().reportFreshness, 'never');
  await call(anonymous, '/api/machine/v1/status', statusRequest, 401);
  const wrongStatus = await machineCall('status', {
    ...statusRequest,
    binding: { ...statusRequest.binding, productId: randomUUID() },
  });
  assert.equal(wrongStatus.status, 409);

  // Addition preserves current authority, and metadata alone cannot activate a missing package.
  await assign(c, ['incident-management', 'risk-management']);
  await sync(incident, 200, applied);
  assert.equal(
    (await read()).effective,
    null,
    'A delayed old acknowledgement cannot report a newer revision as active',
  );
  assert.deepEqual((await sync(incident)).modulePolicy.allowedModuleIds, [
    'foundation',
    'incident-management',
  ]);
  await call(admin, `${path}/activate`, await activation(), 409);
  const both = await deliver(c, ['incident-management', 'risk-management']);
  await sync(both, 409); // Observation commits; no conflicting pending policy is issued at the same revision.
  approved = await activation();
  await call(admin, `${path}/activate`, approved);
  assert.deepEqual((await sync(both)).modulePolicy.allowedModuleIds, [
    'foundation',
    'incident-management',
    'risk-management',
  ]);
  // Mixed removal before target delivery, lost assignment/activation acknowledgements, stale retries.
  const removal = await assign(c, ['risk-management'], ['incident-management'], { lost: true });
  assert.deepEqual((await sync(both)).modulePolicy.allowedModuleIds, [
    'foundation',
    'risk-management',
  ]);
  await call(admin, `${path}/activate`, initialReceipt);
  await call(admin, path, removal);
  assert.deepEqual((await sync(both)).modulePolicy.allowedModuleIds, [
    'foundation',
    'risk-management',
  ]);
  await call(admin, `${path}/activate`, { ...approved, operationId: randomUUID() }, 409);
  const risk = await deliver(c, ['risk-management']);
  await sync(risk, 409);
  approved = await activation();
  const viewerId = (await call(viewer, '/api/session')).id;
  await database.query(
    "UPDATE control_plane.staff SET role='operator',revision=revision+1 WHERE user_id=$1",
    [viewerId],
  );
  try {
    await reauthenticateViewer();
    const race = await Promise.all([
      admin.call(`${path}/activate`, approved),
      viewer.call(`${path}/activate`, {
        ...approved,
        operationId: randomUUID(),
        reason: 'second operator competing activation',
      }),
    ]);
    assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
  } finally {
    await database.query(
      "UPDATE control_plane.staff SET role='viewer',revision=revision+1 WHERE user_id=$1",
      [viewerId],
    );
  }
  assert.deepEqual((await sync(risk)).modulePolicy.allowedModuleIds, [
    'foundation',
    'risk-management',
  ]);
  // A new catalogue cannot keep an explicitly unassigned active Individual alive while delivery waits.
  const next = await publish(code.modules.map(({ id, category }) => ({ id, category })));
  await assign(next, ['incident-management'], ['risk-management'], { lost: true });
  assert.deepEqual((await sync(risk)).modulePolicy.allowedModuleIds, ['foundation']);
  const nextIncident = await deliver(next, ['incident-management']);
  await sync(nextIncident, 409);
  await call(admin, `${path}/activate`, await activation());
  assert.deepEqual((await sync(nextIncident)).modulePolicy.allowedModuleIds, [
    'foundation',
    'incident-management',
  ]);
  // Classification alone preserves active rights; demoting Core does not remove it in place.
  const promoted = await publish(
    code.modules.map(({ id, category }) => ({
      id,
      category: id === 'incident-management' ? 'core' : category,
    })),
  );
  await assign(promoted, []);
  assert.deepEqual((await sync(nextIncident)).modulePolicy.allowedModuleIds, [
    'foundation',
    'incident-management',
  ]);
  const promotedIncident = await deliver(promoted, []);
  await sync(promotedIncident, 409);
  await call(admin, `${path}/activate`, await activation());
  await assign(c, []);
  assert.deepEqual((await sync(promotedIncident)).modulePolicy.allowedModuleIds, [
    'foundation',
    'incident-management',
  ]);
  const bad = await read();
  await call(
    admin,
    path,
    {
      type: 'assignment.draft',
      command: {
        version: 1,
        operationId: randomUUID(),
        expectedRevision: bad.productRevision,
        binding: bad.binding,
        catalogueDigest: await catalogueDigest(c),
        requestedIndividualIds: [],
        confirmedResolvedIds: ['foundation'],
        explicitlyRemovedIds: ['incident-management'],
        confirmedRemovalClosureIds: ['incident-management'],
        activeBasis: bad.authority.active,
        reason: 'invalid old Core removal',
      },
    },
    409,
  );
  // Replacement epoch requires fresh reviewed activation; neither a receipt nor old inventory can grant it.
  pairing = await pair('replace');
  await registry({
    type: 'product.policy',
    id,
    revision: (await read()).productRevision,
    decision: 'approve',
  });
  const core = await deliver(c, []);
  assert.equal((await sync(core)).state, 'pending');
  await call(admin, `${path}/activate`, initialReceipt);
  assert.equal((await sync(core)).state, 'pending');
  await call(admin, `${path}/activate`, await activation());
  assert.deepEqual((await sync(core)).modulePolicy.allowedModuleIds, ['foundation']);
  console.log(
    'Central MOD-I08 actual HTTPS/PostgreSQL: explicit activation, immediate mixed/cross-catalogue removal, delayed package, lost acknowledgements/stale replay, current MFA/basis/revision, two-operator conflict, classification/Core and replacement-epoch fencing passed. Inventory metadata was synthetic signed fixture evidence.',
  );
}
