import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { chromium } from '@playwright/test';
import pg from 'pg';
import {
  catalogueDigest,
  deliveryReleaseId,
  deliveryRequestDigest,
  resolveSelection,
} from '../../packages/module-catalog/dist/index.js';

export async function verifyModuleAssignments({
  admin,
  viewer,
  anonymous,
  database,
  origin,
  runtimeUrl,
  signEvidence,
  referenceDirectory,
  signDelivery,
  verifyIntent,
  reauthenticateAdmin,
  code,
  unreleasedId,
}) {
  const call = async (actor, path, body, expected = 200) => {
    const r = await actor.call(path, body);
    assert.equal(r.status, expected, r.text);
    return expected === 200 ? r.json() : r;
  };
  const registry = (input) =>
    call(admin, '/api/registry', {
      requestId: randomUUID(),
      reason: 'isolated module assignment verification',
      ...input,
    });
  const catalogue = (input) =>
    call(admin, '/api/module-catalogues', {
      requestId: randomUUID(),
      reason: 'isolated assignment catalogue',
      ...input,
    });
  const publish = async (categories) => {
    const id = randomUUID();
    await catalogue({ type: 'draft.create', id, sourceId: code.id, categories });
    const record = await call(admin, `/api/module-catalogues/${id}`);
    await catalogue({
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
    return record;
  };
  const published = await publish(code.modules.map(({ id, category }) => ({ id, category })));
  const available = await call(viewer, '/api/module-catalogues/assignable');
  assert.ok(available.catalogues.some((c) => c.id === published.id));
  assert.ok(!available.catalogues.some((c) => c.id === unreleasedId));
  const client = await registry({
    type: 'client.create',
    code: 'MODULE-ASSIGN',
    name: 'Module assignment fixture',
  });
  const products = [];
  let dmsId;
  for (const environment of ['one', 'two']) {
    const command = {
      type: 'installation.reserve',
      requestId: randomUUID(),
      clientId: client.clientId,
      environment,
      label: environment,
      reason: 'isolated fresh reservation',
    };
    await call(viewer, '/api/registry', command, 403);
    await assert.rejects(
      admin.call('/api/registry', command, { dropResponse: true }),
      /Fixture discarded/,
    );
    const installation = await call(admin, '/api/registry', command);
    assert.deepEqual(await call(admin, '/api/registry', command), installation);
    await call(admin, '/api/registry', { ...command, label: 'changed' }, 409);
    await call(admin, '/api/registry', { ...command, requestId: randomUUID() }, 409);
    const detail = await call(viewer, `/api/registry/clients/${client.clientId}`);
    const registered = detail.products.filter((p) => p.installationId === installation.resourceId);
    assert.equal(registered.length, 2);
    assert.ok(registered.every((p) => p.policyState === 'pending' && p.pairingVerifiedAt === null));
    products.push(registered.find((p) => p.product === 'turnstile').id);
    if (environment === 'one') dmsId = registered.find((p) => p.product === 'dms').id;
    if (environment === 'two')
      assert.notEqual(
        registered[0].tenantId,
        detail.products.find((p) => p.id === products[0]).tenantId,
      );
  }
  const path = (id) => `/api/registry/products/${id}/modules`;
  const read = (id, actor = admin) => call(actor, path(id));
  const send = (actor, id, input, expected = 200) => call(actor, path(id), input, expected);
  const prepare = async (id, requested, type = 'assignment.draft') => {
    const view = await read(id);
    const resolved = resolveSelection(published.catalogue, { requestedIndividualIds: requested });
    return {
      type,
      command: {
        version: 1,
        operationId: randomUUID(),
        expectedRevision: view.productRevision,
        binding: view.binding,
        catalogueDigest: published.digest,
        requestedIndividualIds: requested,
        confirmedResolvedIds: resolved.resolvedIds,
        explicitlyRemovedIds: [],
        confirmedRemovalClosureIds: [],
        activeBasis: null,
        reason: 'isolated assignment selection',
      },
    };
  };
  const approve = async (id) => {
    const view = await read(id);
    assert.ok(view.draft);
    return {
      type: 'assignment.approve',
      command: {
        ...view.draft.document.command,
        operationId: randomUUID(),
        expectedRevision: view.productRevision,
        reason: 'approve isolated desired assignment',
      },
    };
  };
  const firstId = products[0],
    secondId = products[1];
  const initial = await prepare(firstId, ['risk-management']);
  await call(anonymous, path(firstId), undefined, 401);
  await send(anonymous, firstId, initial, 401);
  await send(viewer, firstId, initial, 403);
  await call(admin, path(dmsId), undefined, 409);
  await send(admin, secondId, initial, 409);
  await send(
    admin,
    firstId,
    {
      ...initial,
      command: {
        ...initial.command,
        binding: { ...initial.command.binding, tenantId: randomUUID() },
      },
    },
    409,
  );
  await send(
    admin,
    firstId,
    {
      ...initial,
      command: { ...initial.command, confirmedResolvedIds: ['foundation', 'risk-management'] },
    },
    400,
  );
  await send(
    admin,
    firstId,
    { ...initial, command: { ...initial.command, requestedIndividualIds: ['unknown-module'] } },
    400,
  );
  await send(
    admin,
    firstId,
    { ...initial, command: { ...initial.command, requestedIndividualIds: ['foundation'] } },
    400,
  );
  await send(admin, firstId, { ...initial, observed: { profileDigest: 'a'.repeat(64) } }, 400);
  const unpublished = await call(admin, `/api/module-catalogues/${unreleasedId}`);
  await send(
    admin,
    firstId,
    { ...initial, command: { ...initial.command, catalogueDigest: unpublished.digest } },
    409,
  );
  await send(
    admin,
    firstId,
    {
      ...initial,
      command: {
        ...initial.command,
        activeBasis: {
          catalogueDigest: published.digest,
          profileDigest: 'a'.repeat(64),
          releaseId: 'c'.repeat(64),
          assignmentRevision: 1,
          policyRevision: 1,
        },
      },
    },
    409,
  );
  const originDenied = await admin.call(path(firstId), initial, {
    headers: { origin: 'https://evil.test' },
  });
  assert.equal(originDenied.status, 403);
  await send(admin, firstId, { ...initial, type: 'assignment.approve' }, 409);
  const adminId = (await call(admin, '/api/session')).id;
  const viewerId = (await call(viewer, '/api/session')).id;
  await database.query(
    "UPDATE control_plane.staff_session SET mfa_at=now()-interval '11 minutes' WHERE session_id IN (SELECT id FROM control_plane.session WHERE user_id=$1)",
    [adminId],
  );
  await send(admin, firstId, initial, 403);
  await reauthenticateAdmin();
  const other = await prepare(firstId, ['incident-management']);
  const races = await Promise.all([
    admin.call(path(firstId), initial),
    admin.call(path(firstId), other),
  ]);
  assert.deepEqual(races.map((r) => r.status).sort(), [200, 409]);
  let first = await read(firstId);
  assert.equal(first.productRevision, 2);
  assert.equal(first.desired, null, 'Draft cannot become desired authority');
  assert.equal(first.effective, null);
  const approval = await approve(firstId);
  const beforeCount = (
    await database.query('SELECT count(*)::int AS n FROM control_plane.module_assignment_entry')
  ).rows[0].n;
  await database.query(
    "CREATE FUNCTION control_plane.test_assignment_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.action LIKE 'assignment.%' THEN RAISE EXCEPTION 'fixture'; END IF; RETURN NEW; END $$",
  );
  await database.query(
    'CREATE TRIGGER test_assignment_audit_failure BEFORE INSERT ON control_plane.registry_audit FOR EACH ROW EXECUTE FUNCTION control_plane.test_assignment_audit_failure()',
  );
  try {
    await send(admin, firstId, approval, 503);
    assert.equal((await read(firstId)).productRevision, 2);
    assert.equal((await read(firstId)).desired, null);
    assert.equal(
      (await database.query('SELECT count(*)::int AS n FROM control_plane.module_assignment_entry'))
        .rows[0].n,
      beforeCount,
    );
  } finally {
    await database.query(
      'DROP TRIGGER test_assignment_audit_failure ON control_plane.registry_audit',
    );
    await database.query('DROP FUNCTION control_plane.test_assignment_audit_failure()');
  }
  await assert.rejects(
    admin.call(path(firstId), approval, { dropResponse: true }),
    /Fixture discarded/,
  );
  await database.query(
    "UPDATE control_plane.staff_session SET mfa_at=now()-interval '11 minutes' WHERE session_id IN (SELECT id FROM control_plane.session WHERE user_id=$1)",
    [adminId],
  );
  // Even a committed exact receipt requires current MFA after its response was lost.
  await send(admin, firstId, approval, 403);
  await reauthenticateAdmin();
  const saved = await send(admin, firstId, approval);
  first = await read(firstId);
  assert.equal(first.productRevision, 3);
  assert.equal(first.policyState, 'pending');
  assert.equal(first.draft, null);
  assert.equal(first.desired.id, approval.command.operationId);
  assert.deepEqual(first.statuses, ['awaiting-package']);
  assert.equal(first.observed, null);
  assert.equal(first.effective, null);
  assert.equal((await read(secondId)).desired, null);
  // Central verifies provisioned pipeline references only. Physical artifact checks run in the four-image gate.
  const buildPath = `${path(firstId)}/build-request`;
  const request = await call(viewer, buildPath);
  assert.equal(request.profileDigest, first.desired.document.profileDigest);
  assert.deepEqual(Object.keys(request).sort(), [
    'catalogue',
    'profile',
    'profileDigest',
    'version',
  ]);
  await call(anonymous, buildPath, undefined, 401);
  await call(viewer, `${path(dmsId)}/build-request`, undefined, 409);
  const inventory = {
    version: 1,
    catalogueDigest: request.profile.catalogueDigest,
    profileDigest: request.profileDigest,
    sourceDigest: request.profile.sourceDigest,
    platform: request.profile.platform,
    releaseId: '0'.repeat(64),
    images: [
      { role: 'turnstile-api', digest: '1'.repeat(64) },
      { role: 'turnstile-web', digest: '2'.repeat(64) },
    ],
    archiveDigest: '3'.repeat(64),
    noticesDigest: '4'.repeat(64),
    sourceInventoryDigest: '5'.repeat(64),
  };
  const evidence = {
    version: 1,
    kind: 'delivery',
    requestDigest: await deliveryRequestDigest(request),
    inventory,
    artifactInventoryDigest: '6'.repeat(64),
    documentationDigest: '7'.repeat(64),
  };
  inventory.releaseId = await deliveryReleaseId(evidence);
  const referencePath = join(referenceDirectory, `${request.profileDigest}.json`);
  const storeReference = async (attestation) =>
    writeFile(referencePath, JSON.stringify({ request, attestation }), { mode: 0o644 });
  await storeReference(await signDelivery(evidence));
  const availableDelivery = await read(firstId);
  assert.deepEqual(availableDelivery.statuses, ['ready-for-setup']);
  assert.equal(availableDelivery.delivery.inventory.releaseId, inventory.releaseId);
  assert.equal(availableDelivery.effective, null);
  assert.equal((await read(secondId)).delivery, null);
  const intentPath = `${path(firstId)}/installation-intent`;
  const intentCommand = {
    operationId: randomUUID(),
    expectedRevision: availableDelivery.productRevision,
    reason: 'isolated signed fresh intent',
  };
  await call(viewer, intentPath, intentCommand, 403);
  await call(anonymous, intentPath, intentCommand, 401);
  await assert.rejects(
    admin.call(intentPath, intentCommand, { dropResponse: true }),
    /Fixture discarded/,
  );
  const issued = await call(admin, intentPath, intentCommand);
  assert.deepEqual(await call(admin, intentPath, intentCommand), issued);
  await call(admin, intentPath, { ...intentCommand, reason: 'changed' }, 409);
  await call(
    admin,
    intentPath,
    { ...intentCommand, operationId: randomUUID(), expectedRevision: 1 },
    409,
  );
  const intent = JSON.parse(Buffer.from(issued.intent.split('.')[1], 'base64url').toString('utf8'));
  assert.equal(intent.binding.productId, firstId);
  assert.equal(intent.dmsProductId, dmsId);
  assert.equal(intent.binding.tenantId, availableDelivery.binding.tenantId);
  assert.equal(intent.releaseId, inventory.releaseId);
  assert.equal(intent.mode, 'fresh');
  await verifyIntent(issued.intent, {
    intentRevision: availableDelivery.productRevision,
    assignmentRevision: availableDelivery.desired.revision,
    binding: availableDelivery.binding,
    dmsProductId: dmsId,
    profileDigest: request.profileDigest,
    releaseId: inventory.releaseId,
  });
  assert.equal(intent.exp - intent.iat, 86400);
  assert.equal((await read(firstId)).effective, null);
  const html = await viewer.call(`/clients/${client.clientId}/products/${firstId}/modules`);
  assert.ok(html.text.includes('Download approved profile build request'));
  assert.ok(html.text.includes(inventory.releaseId));
  for (const bad of [
    await signEvidence(evidence),
    await signDelivery({ ...evidence, requestDigest: 'a'.repeat(64) }),
    await signDelivery(evidence, -1),
    'forged.token.value',
  ]) {
    await storeReference(bad);
    assert.deepEqual((await read(firstId)).statuses, ['awaiting-package']);
    assert.equal((await read(firstId)).delivery, null);
  }
  await rm(referencePath);
  await call(admin, intentPath, { ...intentCommand, operationId: randomUUID() }, 409);
  assert.deepEqual(
    await call(admin, intentPath, intentCommand),
    issued,
    'Historical receipt cannot recreate delivery availability',
  );
  assert.deepEqual((await read(firstId)).statuses, ['awaiting-package']);
  await database.query(
    "UPDATE control_plane.staff_session SET mfa_at=now()-interval '11 minutes' WHERE session_id IN (SELECT id FROM control_plane.session WHERE user_id=$1)",
    [adminId],
  );
  await call(admin, intentPath, intentCommand, 403);
  await reauthenticateAdmin();

  const activity = await call(viewer, `/api/registry/clients/${client.clientId}`);
  assert.ok(
    activity.activity.some((e) => e.action === 'assignment.approve' && e.resourceId === firstId),
  );
  await send(
    admin,
    firstId,
    { ...approval, command: { ...approval.command, reason: 'changed request body' } },
    409,
  );
  await send(
    admin,
    firstId,
    {
      ...approval,
      command: {
        ...approval.command,
        operationId: randomUUID(),
        expectedRevision: first.productRevision,
      },
    },
    409,
  );
  await send(admin, secondId, await prepare(secondId, ['incident-management']));
  const limited = new pg.Pool({ connectionString: runtimeUrl, max: 1 });
  try {
    await assert.rejects(
      limited.query('UPDATE control_plane.module_assignment_entry SET revision=revision+1'),
      /permission denied/,
    );
    await assert.rejects(
      limited.query('DELETE FROM control_plane.module_assignment_entry'),
      /permission denied/,
    );
    await assert.rejects(
      limited.query(
        'UPDATE control_plane.module_assignment_state SET product_id=gen_random_uuid()',
      ),
      /permission denied/,
    );
    await assert.rejects(
      limited.query(
        'UPDATE control_plane.module_assignment_state SET desired_id=$1 WHERE product_id=$2',
        [first.desired.id, secondId],
      ),
      /foreign key/,
    );
    // A draft cannot be smuggled into the approved desired pointer.
    const draftId = races.find((r) => r.status === 200).json().requestId;
    await assert.rejects(
      limited.query(
        'UPDATE control_plane.module_assignment_state SET desired_id=$1 WHERE product_id=$2',
        [draftId, firstId],
      ),
      /foreign key/,
    );
  } finally {
    await limited.end();
  }
  const narrowed = await prepare(firstId, []);
  await send(admin, firstId, narrowed);
  const removedApproval = await approve(firstId);
  await send(admin, firstId, removedApproval);
  assert.deepEqual(
    (await read(firstId)).desired.document.profile.modules.map((m) => m.id),
    ['foundation'],
  );
  assert.deepEqual(await send(admin, firstId, approval), saved);
  assert.equal((await read(firstId)).desired.id, removedApproval.command.operationId);
  assert.equal(
    (
      await database.query(
        'SELECT document FROM control_plane.module_assignment_entry WHERE id=$1',
        [approval.command.operationId],
      )
    ).rows[0].document.command.reason,
    approval.command.reason,
  );
  const staleDraft = await prepare(firstId, ['incident-management']);
  await send(admin, firstId, staleDraft);
  const staleApproval = await approve(firstId);
  await registry({
    type: 'product.policy',
    id: firstId,
    revision: (await read(firstId)).productRevision,
    decision: 'suspend',
  });
  await send(admin, firstId, staleApproval, 409);
  assert.deepEqual(await send(admin, firstId, approval), saved);
  assert.equal((await read(firstId)).policyState, 'suspended');
  assert.ok((await read(firstId)).statuses.includes('restricted'));

  // Current Operator rights allow assignment, while a later demotion fences even retries.
  await database.query("UPDATE control_plane.staff SET role='operator' WHERE user_id=$1", [
    viewerId,
  ]);
  const operatorDraft = await prepare(secondId, ['incident-management']);
  try {
    await assert.rejects(
      viewer.call(path(secondId), operatorDraft, { dropResponse: true }),
      /Fixture discarded/,
    );
    await send(viewer, secondId, operatorDraft);
    await send(viewer, secondId, await approve(secondId));
  } finally {
    await database.query("UPDATE control_plane.staff SET role='viewer' WHERE user_id=$1", [
      viewerId,
    ]);
  }
  await send(viewer, secondId, operatorDraft, 403);
  await send(viewer, firstId, approval, 403);
  const secondBefore = await read(secondId);
  await publish(
    code.modules.map(({ id, category }) => ({
      id,
      category: id === 'incident-management' ? 'core' : category,
    })),
  );
  assert.deepEqual(
    (await read(secondId)).desired,
    secondBefore.desired,
    'A catalogue publication never rewrites another installation',
  );

  // A real v1 pairing remains a separate product policy; it cannot claim module activation.
  const pairingId = randomUUID(),
    pairingCode = randomBytes(32).toString('base64url');
  await call(admin, '/api/pairing', {
    requestId: randomUUID(),
    productId: secondId,
    revision: secondBefore.productRevision,
    action: 'issue',
    pairingId,
    code: pairingCode,
    reason: 'legacy module upgrade verification',
  });
  await call(anonymous, '/api/machine/v1/activate', {
    version: 1,
    requestId: randomUUID(),
    binding: secondBefore.binding,
    pairingId,
    code: pairingCode,
    candidateSecret: randomBytes(32).toString('base64url'),
  });
  assert.ok((await read(secondId)).statuses.includes('upgrade-required'));
  assert.equal((await read(secondId)).effective, null);
  const viewerPage = `/clients/${client.clientId}/products/${secondId}/modules`;
  const readonly = await viewer.call(viewerPage);
  assert.equal(readonly.status, 200);
  assert.ok(!readonly.text.includes('Review and save draft'));
  assert.equal(
    (await admin.call(`/clients/${randomUUID()}/products/${secondId}/modules`)).status,
    404,
  );

  const browser = await chromium.launch({
    headless: true,
    args: ['--host-resolver-rules=MAP central.fixture.test 127.0.0.1'],
  });
  try {
    const context = await browser.newContext({ ignoreHTTPSErrors: true });
    await context.addCookies(
      [...admin.jar].map(([name, value]) => ({
        name,
        value,
        url: origin,
        secure: true,
        httpOnly: true,
      })),
    );
    const page = await context.newPage();
    page.setDefaultTimeout(15000);
    await page.goto(`${origin}${viewerPage}`);
    const foundation = page.getByRole('checkbox', {
      name: 'Foundation · Core (required)',
      exact: true,
    });
    assert.equal(await foundation.isDisabled(), true);
    await page
      .getByRole('checkbox', { name: 'Incident Management · Individual', exact: true })
      .uncheck();
    const risk = page.getByRole('checkbox', { name: 'Risk Management · Individual', exact: true });
    await risk.focus();
    await page.keyboard.press('Space');
    assert.equal(await risk.isChecked(), true, 'Keyboard selection updates the real resolver');
    await page.getByRole('img', { name: /Module dependencies/ }).waitFor();
    const saveForm = page
      .locator('form')
      .filter({ has: page.getByRole('button', { name: 'Review and save draft', exact: true }) });
    await saveForm.getByLabel('Reason', { exact: true }).fill('browser Risk dependency review');
    const beforeBrowser = await read(secondId);
    await page.getByRole('button', { name: 'Review and save draft', exact: true }).click();
    assert.equal((await read(secondId)).productRevision, beforeBrowser.productRevision);
    const review = page.getByRole('region', { name: 'Review module assignment', exact: true });
    assert.ok(
      (await review.textContent())?.includes('Additional required modules: incident-management'),
    );
    const confirmButton = review.getByRole('button', {
      name: 'Confirm / retry same assignment',
      exact: true,
    });
    assert.equal(await confirmButton.isDisabled(), true);
    await review.getByRole('checkbox', { name: /I confirm the complete resolved/ }).check();
    await confirmButton.click();
    await page
      .getByText(`Saved revision ${beforeBrowser.productRevision + 1}`, { exact: true })
      .waitFor();
    const approvalForm = page
      .locator('form')
      .filter({ has: page.getByRole('button', { name: 'Review desired approval', exact: true }) });
    await approvalForm
      .getByLabel('Reason', { exact: true })
      .fill('browser approve Risk and required Incident');
    await page.getByRole('button', { name: 'Review desired approval', exact: true }).click();
    await review.getByRole('checkbox', { name: /I confirm the complete resolved/ }).check();
    await review
      .getByRole('button', { name: 'Confirm / retry same assignment', exact: true })
      .click();
    await page.getByText('Draft', { exact: true }).waitFor();
    await page
      .getByText(
        'Saved. The current assignment is shown below. Customer activation remains separate.',
        { exact: true },
      )
      .waitFor();
    const final = await read(secondId);
    assert.deepEqual(final.desired.document.command.requestedIndividualIds, ['risk-management']);
    assert.deepEqual(final.desired.document.command.confirmedResolvedIds, [
      'foundation',
      'incident-management',
      'risk-management',
    ]);
    assert.equal(final.effective, null);
    await context.close();
  } finally {
    await browser.close();
  }
  console.log(
    'Central module assignments HTTPS/PostgreSQL/browser: exact bindings, published catalogues, dependency confirmation, live roles/MFA, revision races, atomic approval/audit, lost responses, removal/suspension replay, independent installations and keyboard selection passed.',
  );
}
