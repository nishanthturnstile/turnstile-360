import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import pg from 'pg';

// Uses the owning real Next HTTP fixture, including the TCP-I04 pairing protocol.
export async function verifyCentralRegistry({
  admin,
  viewer,
  anonymous,
  database,
  runtimeUrl,
  reauthenticateAdmin,
}) {
  const fresh = (input) => ({
    requestId: randomUUID(),
    reason: 'isolated registry verification',
    ...input,
  });
  const command = async (actor, input, expected = 200) => {
    const response = await actor.call('/api/registry', input);
    assert.equal(response.status, expected, response.text);
    return expected === 200 ? response.json() : response;
  };
  const read = async (id, actor = admin) => {
    const response = await actor.call(`/api/registry/clients/${id}`);
    assert.equal(response.status, 200, response.text);
    return response.json();
  };
  const adminId = (await admin.call('/api/session')).json().id;
  const viewerId = (await viewer.call('/api/session')).json().id;
  const count = async (table) =>
    (await database.query(`SELECT count(*)::int AS count FROM control_plane.${table}`)).rows[0]
      .count;
  const original = fresh({
    type: 'client.create',
    code: 'mrr-01',
    name: 'MRR_100% Group',
    contactName: 'Business contact',
    contactEmail: 'contact@example.test',
  });
  assert.equal((await anonymous.call('/api/registry/clients')).status, 401);
  assert.equal((await anonymous.call('/clients')).status, 307);
  await command(anonymous, original, 401);
  await command(viewer, original, 403);
  const viewerList = await viewer.call('/clients');
  assert.equal(viewerList.status, 200);
  assert.ok(!viewerList.text.includes('Register a client'));
  const auditBefore = await count('registry_audit');
  const [first, repeat] = await Promise.all([command(admin, original), command(admin, original)]);
  assert.deepEqual(first, repeat, 'Concurrent identical retries preserve one receipt');
  assert.equal(await count('registry_audit'), auditBefore + 1);
  const clientId = first.clientId;
  let saved = await read(clientId);
  assert.equal(saved.client.code, 'MRR-01');
  assert.equal(saved.client.contactEmail, 'contact@example.test');
  assert.equal((await viewer.call(`/clients/${clientId}`)).status, 200);
  assert.deepEqual(
    (await admin.call(`/api/registry/receipts/${original.requestId}`)).json(),
    first,
  );
  assert.equal((await viewer.call(`/api/registry/receipts/${original.requestId}`)).status, 404);
  await command(admin, { ...original, name: 'Different inputs' }, 409);
  await command(
    admin,
    {
      ...fresh({
        type: 'client.update',
        id: clientId,
        revision: 1,
        name: 'Invalid',
        archived: false,
      }),
      code: 'REPLACE',
    },
    400,
  );
  const lost = fresh({ type: 'client.create', code: 'LOST-ACK', name: 'Recovered client' });
  await assert.rejects(
    admin.call('/api/registry', lost, { dropResponse: true }),
    /Fixture discarded a committed response/,
  );
  const recovered = await command(admin, lost);
  assert.equal((await read(recovered.clientId)).client.name, 'Recovered client');
  assert.equal(
    (
      await database.query(
        "SELECT count(*)::int AS count FROM control_plane.registry_audit WHERE client_id=$1 AND action='client.created'",
        [recovered.clientId],
      )
    ).rows[0].count,
    1,
  );
  const duplicateCode = await Promise.all([
    admin.call(
      '/api/registry',
      fresh({ type: 'client.create', code: 'RACE', name: 'First contender' }),
    ),
    admin.call(
      '/api/registry',
      fresh({ type: 'client.create', code: 'race', name: 'Second contender' }),
    ),
  ]);
  assert.deepEqual(duplicateCode.map((r) => r.status).sort(), [200, 409]);
  const percent = (await admin.call('/api/registry/clients?q=%25&archived=all')).json();
  assert.equal(percent.clients.length, 1);
  assert.equal(percent.clients[0].id, clientId);
  assert.equal((await admin.call('/api/registry/clients?q=mrr-01')).json().clients[0].id, clientId);
  const update = fresh({
    type: 'client.update',
    id: clientId,
    revision: 1,
    name: 'MRR Updated',
    contactName: null,
    contactEmail: null,
    archived: false,
  });
  await command(admin, update);
  await command(admin, { ...update, requestId: randomUUID(), name: 'Stale overwrite' }, 409);
  saved = await read(clientId);
  assert.equal(saved.client.revision, 2);
  assert.equal(saved.client.name, 'MRR Updated');
  const other = await command(
    admin,
    fresh({ type: 'client.create', code: 'OTHER', name: 'Other client' }),
  );
  const installation = fresh({
    type: 'installation.create',
    clientId,
    environment: 'production',
    label: 'Production',
    localInstallationId: randomUUID(),
    tenantId: randomUUID(),
  });
  const installed = await command(admin, installation);
  assert.deepEqual(await command(admin, installation), installed);
  await command(
    admin,
    { ...installation, requestId: randomUUID(), localInstallationId: randomUUID() },
    409,
  );
  await command(admin, { ...installation, requestId: randomUUID(), clientId: other.clientId }, 409);
  const secondInstall = await command(admin, {
    ...installation,
    requestId: randomUUID(),
    environment: 'test',
    label: 'Test',
    localInstallationId: randomUUID(),
    tenantId: randomUUID(),
  });
  const dmsInput = fresh({
    type: 'product.create',
    clientId,
    installationId: installed.resourceId,
    binding: { product: 'dms', applicationId: null },
  });
  await command(admin, { ...dmsInput, clientId: other.clientId }, 404);
  const dms = await command(admin, dmsInput);
  await command(admin, { ...dmsInput, requestId: randomUUID() }, 409);
  const turnstile = await command(
    admin,
    fresh({
      type: 'product.create',
      clientId,
      installationId: installed.resourceId,
      binding: { product: 'turnstile', applicationId: randomUUID() },
    }),
  );
  const neverApproved = await command(
    admin,
    fresh({
      type: 'product.create',
      clientId,
      installationId: secondInstall.resourceId,
      binding: { product: 'dms', applicationId: null },
    }),
  );
  const policy = (id, revision, decision) =>
    fresh({ type: 'product.policy', id, revision, decision });
  await command(admin, policy(dms.resourceId, 1, 'approve'), 409);
  await command(
    admin,
    { ...policy(dms.resourceId, 1, 'approve'), pairingVerifiedAt: new Date().toISOString() },
    400,
  );
  for (const input of [
    original,
    update,
    installation,
    dmsInput,
    policy(dms.resourceId, 1, 'approve'),
    policy(turnstile.resourceId, 1, 'reject'),
    policy(neverApproved.resourceId, 1, 'suspend'),
  ])
    await command(viewer, input, 403);
  const limited = new pg.Pool({ connectionString: runtimeUrl, max: 1 });
  try {
    for (const sql of [
      'UPDATE control_plane.registry_installation SET tenant_id=gen_random_uuid()',
      "UPDATE control_plane.registry_client SET code='FORGED'",
      'DELETE FROM control_plane.registry_client',
      'DELETE FROM control_plane.registry_product',
      'UPDATE control_plane.registry_audit SET reason=reason',
      'DELETE FROM control_plane.registry_audit',
      'UPDATE control_plane.registry_receipt SET digest=digest',
      'DELETE FROM control_plane.registry_receipt',
    ])
      await assert.rejects(limited.query(sql), (error) => error.code === '42501');
  } finally {
    await limited.end();
  }
  await assert.rejects(
    database.query(
      "UPDATE control_plane.registry_product SET policy_state='approved',first_approved_at=now(),last_approved_at=now() WHERE id=$1",
      [dms.resourceId],
    ),
    (error) => error.code === '23514',
  );
  await assert.rejects(
    database.query(
      `INSERT INTO control_plane.registry_product(id,client_id,installation_id,product,application_id,policy_changed_by)
    VALUES($1,$2,$3,'turnstile',$4,$5)`,
      [randomUUID(), other.clientId, secondInstall.resourceId, randomUUID(), adminId],
    ),
    (error) => error.code === '23503',
  );
  const pair = async (id, revision) => {
    const exported = (await admin.call(`/api/registry/products/${id}/manifest`)).json();
    const code = randomBytes(32).toString('base64url');
    const pairingId = randomUUID();
    const issued = await admin.call('/api/pairing', {
      requestId: randomUUID(),
      productId: id,
      revision,
      action: 'issue',
      pairingId,
      code,
      reason: 'isolated pairing verification',
    });
    assert.equal(issued.status, 200, issued.text);
    const response = await anonymous.call('/api/machine/v1/activate', {
      version: 1,
      requestId: randomUUID(),
      binding: exported.binding,
      pairingId,
      code,
      candidateSecret: randomBytes(32).toString('base64url'),
    });
    assert.equal(response.status, 200, response.text);
  };
  await pair(dms.resourceId, 1);
  const approve = policy(dms.resourceId, 1, 'approve');
  const approved = await command(admin, approve);
  let product = (await read(clientId)).products.find((p) => p.id === dms.resourceId);
  assert.equal(product.policyState, 'approved');
  assert.equal(product.revision, 2);
  assert.ok(product.firstApprovedAt);
  assert.equal(product.firstActivationAcknowledgedAt, null);
  assert.equal(product.lastContactAt, null);
  const firstApprovedAt = product.firstApprovedAt;
  assert.ok(
    (await admin.call(`/clients/${clientId}`)).text.includes('awaiting activation acknowledgement'),
  );
  const beforeRepeat = await count('registry_audit');
  await command(admin, policy(dms.resourceId, 2, 'approve'), 409);
  assert.equal(await count('registry_audit'), beforeRepeat);
  await command(admin, policy(dms.resourceId, 2, 'reject'), 409);
  await database.query("UPDATE control_plane.staff SET role='operator' WHERE user_id=$1", [
    viewerId,
  ]);
  try {
    const opClient = await command(
      viewer,
      fresh({ type: 'client.create', code: 'OPERATOR', name: 'Operator client' }),
    );
    assert.ok(opClient.clientId);
    await command(viewer, policy(dms.resourceId, 2, 'suspend'), 403);
    await command(viewer, policy(turnstile.resourceId, 1, 'reject'));
    await command(viewer, policy(turnstile.resourceId, 2, 'approve'), 409);
    await pair(turnstile.resourceId, 2);
    await command(viewer, policy(turnstile.resourceId, 2, 'approve'));
    await command(admin, policy(dms.resourceId, 2, 'suspend'));
    await command(viewer, policy(dms.resourceId, 3, 'approve'));
  } finally {
    await database.query("UPDATE control_plane.staff SET role='viewer' WHERE user_id=$1", [
      viewerId,
    ]);
  }
  product = (await read(clientId)).products.find((p) => p.id === dms.resourceId);
  assert.equal(product.revision, 4);
  assert.equal(product.firstApprovedAt, firstApprovedAt);
  assert.ok(product.lastApprovedAt >= firstApprovedAt);
  assert.deepEqual(
    await command(admin, approve),
    approved,
    'A delayed retry preserves its historical receipt',
  );
  assert.equal(
    (await read(clientId)).products.find((p) => p.id === dms.resourceId).revision,
    4,
    'Historical receipt replay cannot repeat a policy transition',
  );
  const simultaneous = await command(
    admin,
    fresh({
      type: 'product.create',
      clientId,
      installationId: secondInstall.resourceId,
      binding: { product: 'turnstile', applicationId: randomUUID() },
    }),
  );
  await pair(simultaneous.resourceId, 1);
  const raceAudit = await count('registry_audit');
  const race = await Promise.all([
    admin.call('/api/registry', policy(simultaneous.resourceId, 1, 'approve')),
    admin.call('/api/registry', policy(simultaneous.resourceId, 1, 'suspend')),
  ]);
  assert.deepEqual(race.map((r) => r.status).sort(), [200, 409]);
  assert.equal(await count('registry_audit'), raceAudit + 1);
  assert.equal(
    (await read(clientId)).products.find((p) => p.id === simultaneous.resourceId).revision,
    2,
  );
  await command(admin, policy(neverApproved.resourceId, 1, 'suspend'));
  const never = (await read(clientId)).products.find((p) => p.id === neverApproved.resourceId);
  assert.equal(never.firstApprovedAt, null);
  await command(admin, policy(neverApproved.resourceId, 2, 'approve'), 409);
  await database.query(
    "UPDATE control_plane.staff_session SET mfa_at=now()-interval '11 minutes' WHERE session_id IN (SELECT id FROM control_plane.session WHERE user_id=$1)",
    [adminId],
  );
  await command(admin, policy(dms.resourceId, 4, 'suspend'), 403);
  assert.equal((await admin.call(`/api/registry/receipts/${approve.requestId}`)).status, 200);
  await reauthenticateAdmin();
  const archive = fresh({
    type: 'client.update',
    id: clientId,
    revision: 2,
    name: 'MRR Updated',
    contactName: null,
    contactEmail: null,
    archived: true,
  });
  await command(admin, archive);
  assert.equal(
    (await read(clientId)).products.find((p) => p.id === dms.resourceId).policyState,
    'approved',
    'Archive never silently suspends products',
  );
  assert.equal((await admin.call('/api/registry/clients?q=MRR-01')).json().clients.length, 0);
  assert.equal(
    (await admin.call('/api/registry/clients?q=MRR-01&archived=archived')).json().clients[0].id,
    clientId,
  );
  await command(
    admin,
    {
      ...installation,
      requestId: randomUUID(),
      environment: 'new',
      localInstallationId: randomUUID(),
    },
    409,
  );
  await command(
    admin,
    { ...dmsInput, requestId: randomUUID(), installationId: secondInstall.resourceId },
    409,
  );
  await command(admin, policy(dms.resourceId, 4, 'suspend'));
  await command(admin, { ...archive, requestId: randomUUID(), revision: 3, archived: false });
  saved = await read(clientId);
  assert.equal(saved.client.archived, false);
  assert.equal(saved.products.find((p) => p.id === dms.resourceId).policyState, 'suspended');
  // Bounded keyset pagination against explicit owning read fixtures, not mocked HTTP.
  await database.query(`INSERT INTO control_plane.registry_client(id,code,name)
    SELECT gen_random_uuid(),'PAGE_'||lpad(n::text,3,'0'),'Pagination fixture' FROM generate_series(1,51) AS n`);
  const page = (await admin.call('/api/registry/clients?q=PAGE_')).json();
  assert.equal(page.clients.length, 50);
  assert.equal(page.nextCursor, 'PAGE_050');
  const next = (await admin.call(`/api/registry/clients?q=PAGE_&after=${page.nextCursor}`)).json();
  assert.equal(next.clients.length, 1);
  assert.equal(next.clients[0].code, 'PAGE_051');
  assert.equal(next.nextCursor, null);
  assert.equal(
    await count('registry_receipt'),
    await count('registry_audit'),
    'Only committed commands have an immutable receipt and one audit mutation',
  );
  const latest = (await read(clientId)).activity;
  assert.ok(latest.some((a) => a.action === 'product.reapproved'));
  assert.ok(latest.every((a) => a.actorId && a.reason && a.committedAt));
  console.log(
    'Central registry HTTP/PostgreSQL: retry/lost response, duplicate and policy races, immutable cross-record bindings, archive independence, live roles, recent MFA, approval pairing prerequisite, audit atomicity and bounded reads passed.',
  );
}
