import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout } from 'node:timers/promises';
import { chromium } from '@playwright/test';
import pg from 'pg';
import { catalogueDigest } from '../../packages/module-catalog/dist/index.js';

export async function verifyCentralCatalogues({
  admin,
  viewer,
  anonymous,
  database,
  runtimeUrl,
  signEvidence,
  reauthenticateAdmin,
  origin,
}) {
  const cmd = (type, extra) => ({
    type,
    requestId: randomUUID(),
    reason: 'isolated catalogue verification',
    ...extra,
  });
  const send = async (actor, input, status = 200) => {
    const r = await actor.call('/api/module-catalogues', input);
    assert.equal(r.status, status, r.text);
    return status === 200 ? r.json() : r;
  };
  const count = async (table) =>
    (await database.query(`SELECT count(*)::int AS n FROM control_plane.${table}`)).rows[0].n;
  const read = async (id) => {
    const r = await admin.call(`/api/module-catalogues/${id}`);
    assert.equal(r.status, 200, r.text);
    return r.json();
  };
  const module = (id, label, category, requires) => ({
    id,
    label,
    version: '1.0.0',
    category,
    requires,
    optionalIntegrations: [],
  });
  // Synthetic code support is signed only by this fixture's separate release key.
  const code = {
    version: 1,
    id: randomUUID(),
    sourceDigest: 'b'.repeat(64),
    platform: 'linux/amd64',
    contractVersion: 2,
    migrationVersion: 1,
    modules: [
      module('foundation', 'Foundation', 'core', []),
      module('incident-management', 'Incident Management', 'individual', ['foundation']),
      module('risk-management', 'Risk Management', 'individual', [
        'foundation',
        'incident-management',
      ]),
    ],
  };
  const evidence = await signEvidence({ version: 1, kind: 'code', catalogue: code });
  const imported = cmd('code.import', { attestation: evidence });
  await send(anonymous, imported, 401);
  await send(viewer, imported, 403);
  assert.equal((await anonymous.call('/api/module-catalogues')).status, 401);
  assert.equal((await anonymous.call('/modules')).status, 307);
  const adminId = (await admin.call('/api/session')).json().id;
  await database.query(
    "UPDATE control_plane.staff_session SET mfa_at=now()-interval '11 minutes' WHERE session_id IN (SELECT id FROM control_plane.session WHERE user_id=$1)",
    [adminId],
  );
  await send(admin, imported, 403);
  await reauthenticateAdmin();
  assert.equal(
    (
      await admin.call('/api/module-catalogues', imported, {
        headers: { origin: 'https://evil.test' },
      })
    ).status,
    403,
  );
  const initial = await count('module_audit');
  const [one, two] = await Promise.all([send(admin, imported), send(admin, imported)]);
  assert.deepEqual(one, two);
  assert.equal(await count('module_audit'), initial + 1);
  await send(admin, cmd('code.import', { attestation: evidence }), 409);
  await send(
    admin,
    cmd('code.import', { attestation: `${evidence.slice(0, -20)}${'x'.repeat(20)}` }),
    400,
  );
  await send(admin, { ...imported, reason: 'changed body' }, 409);
  const viewerId = (await viewer.call('/api/session')).json().id;
  await database.query("UPDATE control_plane.staff SET role='operator' WHERE user_id=$1", [
    viewerId,
  ]);
  await send(viewer, imported, 403);
  await database.query("UPDATE control_plane.staff SET role='viewer' WHERE user_id=$1", [viewerId]);
  const categories = code.modules.map(({ id, category }) => ({ id, category }));
  const draft = cmd('draft.create', { id: randomUUID(), sourceId: code.id, categories });
  await assert.rejects(
    admin.call('/api/module-catalogues', draft, { dropResponse: true }),
    /Fixture discarded/,
  );
  await send(admin, draft);
  let record = await read(draft.id);
  assert.equal(record.status, 'draft');
  assert.equal((await viewer.call(`/api/module-catalogues/${draft.id}`)).status, 200);
  const view = await viewer.call(`/modules/${draft.id}`);
  assert.equal(view.status, 200);
  assert.ok(!view.text.includes('Review publication'));
  const plan = (await admin.call(`/api/module-catalogues/${draft.id}?buildPlan=1`)).json();
  assert.equal(plan.catalogueDigest, record.digest);
  assert.equal(plan.codeCatalogueDigest, await catalogueDigest(code));
  const classify = (changes, revision = record.revision) =>
    cmd('draft.classify', { id: draft.id, revision, categories: changes });
  await send(admin, { ...classify(categories), shell: 'forbidden' }, 400);
  await send(
    admin,
    classify(categories.map((c) => (c.id === 'risk-management' ? { ...c, category: 'core' } : c))),
    400,
  );
  await send(
    admin,
    classify(categories.map((c) => (c.id === 'foundation' ? { ...c, category: 'individual' } : c))),
    400,
  );
  const promoted = categories.map((c) =>
    c.id === 'incident-management' ? { ...c, category: 'core' } : c,
  );
  const raceCommands = [classify(promoted), classify(categories)];
  const races = await Promise.all(raceCommands.map((c) => admin.call('/api/module-catalogues', c)));
  assert.deepEqual(races.map((r) => r.status).sort(), [200, 409]);
  record = await read(draft.id);
  const publicationProof = await signEvidence({
    version: 1,
    kind: 'classification',
    catalogueId: record.id,
    catalogueDigest: record.digest,
    codeCatalogueDigest: plan.codeCatalogueDigest,
    draftRevision: record.revision,
  });
  const publication = cmd('catalogue.publish', {
    id: record.id,
    revision: record.revision,
    attestation: publicationProof,
  });
  await send(admin, { ...publication, requestId: randomUUID(), revision: 1 }, 400);
  // Actual audit failure must roll the state and receipt back together.
  await database.query(
    "CREATE FUNCTION control_plane.test_module_audit_failure() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture'; END $$",
  );
  await database.query(
    'CREATE TRIGGER test_module_audit_failure BEFORE INSERT ON control_plane.module_audit FOR EACH ROW EXECUTE FUNCTION control_plane.test_module_audit_failure()',
  );
  try {
    await send(admin, publication, 503);
    assert.equal((await read(record.id)).status, 'draft');
  } finally {
    await database.query('DROP TRIGGER test_module_audit_failure ON control_plane.module_audit');
    await database.query('DROP FUNCTION control_plane.test_module_audit_failure()');
  }
  await assert.rejects(
    admin.call('/api/module-catalogues', publication, { dropResponse: true }),
    /Fixture discarded/,
  );
  await send(admin, publication);
  await send(
    admin,
    cmd('draft.classify', { id: record.id, revision: record.revision + 1, categories }),
    409,
  );
  // Replay of a historical edit returns only its receipt, not old mutable state.
  const winner = races.find((r) => r.status === 200).json();
  assert.equal(winner.revision, 2);
  assert.deepEqual(
    await send(admin, raceCommands[races.findIndex((r) => r.status === 200)]),
    winner,
  );
  assert.equal((await read(record.id)).status, 'released');
  const limited = new pg.Pool({ connectionString: runtimeUrl, max: 1 });
  try {
    await assert.rejects(
      limited.query('UPDATE control_plane.module_catalogue SET revision=revision+1 WHERE id=$1', [
        record.id,
      ]),
      /Immutable catalogue/,
    );
    for (const table of ['module_code', 'module_audit', 'module_receipt']) {
      await assert.rejects(
        limited.query(`DELETE FROM control_plane.${table}`),
        /permission denied/,
      );
      await assert.rejects(
        limited.query(
          `UPDATE control_plane.${table} SET ${table === 'module_code' ? 'digest=digest' : table === 'module_audit' ? 'reason=reason' : 'digest=digest'}`,
        ),
        /permission denied/,
      );
    }
  } finally {
    await limited.end();
  }
  // Expired evidence cannot start new work, but cannot destroy a committed exact receipt.
  const shortCode = { ...code, id: randomUUID() };
  const shortProof = await signEvidence({ version: 1, kind: 'code', catalogue: shortCode }, 4);
  const shortCommand = cmd('code.import', { attestation: shortProof });
  const shortReceipt = await send(admin, shortCommand);
  await setTimeout(4500);
  assert.deepEqual(await send(admin, shortCommand), shortReceipt);
  await send(admin, cmd('code.import', { attestation: shortProof }), 400);
  // Drive the real production client component through ordinary admitted staff cookies.
  const uiDraft = cmd('draft.create', { id: randomUUID(), sourceId: code.id, categories });
  await send(admin, uiDraft);
  await reauthenticateAdmin();
  const browser = await chromium.launch({
    headless: true,
    args: ['--host-resolver-rules=MAP central.fixture.test 127.0.0.1'],
  });
  try {
    // Only the disposable fixture's private test CA is bypassed in this isolated browser.
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
    await page.goto(`${origin}/modules/${uiDraft.id}`);
    await page.getByLabel('Classification for Incident Management').selectOption('core');
    const form = page.locator('form').filter({
      has: page.getByRole('button', { name: 'Review classification change', exact: true }),
    });
    await form.getByLabel('Reason', { exact: true }).fill('browser classification proof');
    await page.getByRole('button', { name: 'Review classification change', exact: true }).click();
    assert.equal((await read(uiDraft.id)).revision, 1, 'Review is not a mutation');
    await page.getByRole('button', { name: 'Confirm / retry same request', exact: true }).click();
    await page.getByText(`Version ${uiDraft.id} · draft · revision 2`, { exact: true }).waitFor();
    assert.equal(
      (await read(uiDraft.id)).catalogue.modules.find((m) => m.id === 'incident-management')
        .category,
      'core',
    );
    await context.close();
  } finally {
    await browser.close();
  }
  await reauthenticateAdmin();
  console.log(
    'Central module catalogue HTTPS/PostgreSQL/browser: separate signed intake, dependency review, MFA/live roles, revision races, lost acknowledgements, immutable publication, audit rollback and expiry-safe receipts passed.',
  );
  return { code, unreleasedId: uiDraft.id };
}
