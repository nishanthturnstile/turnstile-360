import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const hash = (value) => createHash('sha256').update(value).digest('hex');
const denied = (result) =>
  assert.ok([403, 404].includes(result.status), `Expected denial, got ${result.status}`);

export async function testDocumentsLifecycle({
  page,
  origin,
  request,
  draft,
  execute,
  setFault,
  uploadCommand,
  clearRateLimits,
  originalUpload,
  originalFile,
}) {
  const button = (name) => page.getByRole('button', { name, exact: true });
  const observe = async (action, fields = {}) =>
    (await uploadCommand(`documents-${action}`, fields)).observation;
  const { ownerId, contributorId, sharedDocumentId, expiredDocumentId } =
    await observe('owner-fixture');
  const shared = `/api/documents/${sharedDocumentId}`;
  const documentId = originalUpload.documentId;
  const own = `/api/documents/${documentId}`;
  const ownPage = `${origin}/documents/${documentId}`;
  const get = async (path) => {
    const result = await request(path);
    assert.equal(result.status, 200, path);
    return result.body;
  };
  const currentOwner = async () => {
    const result = await observe('owner-detail');
    assert.equal(result.status, 200);
    return result.body;
  };
  const grant = async (...rights) =>
    assert.equal((await observe('owner-grant', { rights })).status, 200);
  async function save(command, mode = 'ordinary') {
    const result = await draft(command, mode);
    assert.equal(result.status, 201, command.kind);
    return result.body.receipt;
  }
  const contribution = `${origin}/documents/validation?document=${sharedDocumentId}`;
  const revisions = (revision) =>
    page.getByLabel('Expected revision', { exact: true }).fill(revision);
  const selection = (name) => button(name).click();
  const waitExecution = (exclude) =>
    page.waitForResponse((response) => {
      const path = new URL(response.url()).pathname;
      return (
        /\/operations\/[^/]+\/execute$/.test(path) &&
        path !== `/api/documents/operations/${exclude}/execute`
      );
    });
  async function submit(expected = 200) {
    const result = waitExecution();
    await button('Submit contribution').click();
    assert.equal((await result).status(), expected);
  }
  const browserReads = [];
  const collect = (incoming) => {
    if (incoming.method() !== 'GET') return;
    const path = new URL(incoming.url()).pathname;
    if (path.startsWith(shared) || path.startsWith('/api/documents/uploads/'))
      browserReads.push(path);
  };

  console.log('Documents lifecycle: independent edit-only contribution and reference namespace');
  await clearRateLimits();
  await grant('EDIT_METADATA');
  denied(await request(shared));
  denied(await request(`${shared}/download`));
  denied(await observe('contributor-content'));
  for (const path of ['permissions', 'lifecycle', 'audit'])
    denied(await request(`${shared}/${path}`));
  page.on('request', collect);
  await page.goto(contribution);
  const snapshot = await currentOwner();
  const newTitle = 'Updated fixture through metadata-only grant';
  await revisions(snapshot.revision);
  await page.getByLabel('Title', { exact: true }).fill(newTitle);
  await page.getByLabel('Metadata as JSON').fill('{"source":"owner","reviewed":true}');
  await submit();
  const edited = await currentOwner();
  assert.equal(edited.title, newTitle);
  assert.deepEqual(edited.metadata, { source: 'owner', reviewed: true });

  await selection('Link reference');
  await revisions(edited.revision);
  await page.getByLabel('Namespace', { exact: true }).fill('records');
  await page.getByLabel('Reference type', { exact: true }).fill('case');
  await page.getByLabel('External ID', { exact: true }).fill('synthetic-42');
  await submit();
  const linked = await currentOwner();
  assert.equal(linked.references.length, 2);
  const ownerRef = linked.references.find((ref) => ref.applicationId === ownerId);
  const contributorRef = linked.references.find((ref) => ref.applicationId === contributorId);
  assert.ok(ownerRef && contributorRef);
  await selection('Unlink reference');
  await revisions(linked.revision);
  const reference = page.getByLabel('Reference ID', { exact: true });
  await reference.fill(ownerRef.id);
  await submit(403);
  await reference.fill(contributorRef.id);
  await submit();
  assert.deepEqual(
    (await currentOwner()).references.map((ref) => ref.id),
    [ownerRef.id],
  );
  assert.deepEqual(browserReads, []);
  page.off('request', collect);

  console.log('Documents lifecycle: READ-only denial and add-version-only upload');
  await clearRateLimits();
  await grant('READ');
  await page.goto(`${origin}/documents/${sharedDocumentId}`);
  await page.getByRole('link', { name: 'Contribute', exact: true }).waitFor();
  assert.equal(await button('Edit document details').count(), 0);
  const readOnly = await currentOwner();
  denied(
    await execute(
      await save(
        {
          kind: 'document.edit',
          documentId: sharedDocumentId,
          expectedRevision: readOnly.revision,
          payload: { title: 'Denied fixture update' },
        },
        'contribute',
      ),
    ),
  );
  const binary = Buffer.from('Independent add-version fixture.\n');
  const descriptor = (doc) => ({
    title: doc.title,
    metadata: doc.metadata,
    fileName: 'contributed.txt',
    size: binary.length,
    sha256: hash(binary),
    contentType: 'text/plain',
    profile: 'secure-only',
  });
  denied(
    await execute(
      await save(
        {
          kind: 'version.begin',
          documentId: sharedDocumentId,
          expectedRevision: readOnly.revision,
          payload: { ...descriptor(readOnly), sha256: hash('different denied source') },
        },
        'contribute',
      ),
    ),
  );
  await grant('ADD_VERSION');
  const addVersion = await currentOwner();
  await uploadCommand('documents-capacity');
  page.on('request', collect);
  await page.goto(contribution);
  await selection('Add text version');
  await revisions(addVersion.revision);
  await page.getByLabel('Owner-supplied title').fill(addVersion.title);
  await page.getByLabel('Metadata as JSON').fill(JSON.stringify(addVersion.metadata));
  await page
    .getByLabel('Plain text file')
    .setInputFiles({ name: 'contributed.txt', mimeType: 'text/plain', buffer: binary });
  await submit();
  await page.getByText('Source staged. Request completion to start assessment.').waitFor();
  const admitted = (await get('/api/documents/contributions')).find(
    (item) => item.uploadId && item.file?.sha256 === hash(binary),
  );
  assert.ok(admitted);
  assert.equal(admitted.mode, 'contribute');
  assert.equal(admitted.documentId, undefined);
  assert.equal((await draft({ kind: 'upload.complete', uploadId: admitted.uploadId })).status, 404);
  await button('Complete contribution').click();
  await page
    .getByText(
      'Completion accepted. Publication is not observable from this contribution receipt.',
      { exact: true },
    )
    .first()
    .waitFor();
  await page.reload();
  await page.getByRole('button', { name: /^upload complete .* resolved$/ }).click();
  await page.getByText(/Local receipt only/).waitFor();
  assert.deepEqual(browserReads, []);
  page.off('request', collect);
  denied(await request(shared));
  denied(await request(`${shared}/versions`));
  denied(await request(`${shared}/download`));
  denied(await request(`/api/documents/uploads/${admitted.uploadId}`));
  denied(await observe('contributor-content'));
  await uploadCommand('documents-assess', { uploadId: admitted.uploadId });
  const published = await currentOwner();
  assert.ok(published.currentVersionId && published.downloadable);
  assert.equal((await observe('owner-original')).sha256, hash(binary));
  await grant();
  const revoked = await currentOwner();
  denied(
    await execute(
      await save(
        {
          kind: 'version.begin',
          documentId: sharedDocumentId,
          expectedRevision: revoked.revision,
          payload: { ...descriptor(revoked), sha256: hash('revoked fixture source') },
        },
        'contribute',
      ),
    ),
  );
  denied(await request(shared));

  console.log('Documents lifecycle: lost shared edit reply requires review without a read');
  await clearRateLimits();
  await grant('EDIT_METADATA');
  const beforeLost = await currentOwner();
  page.on('request', collect);
  await page.goto(contribution);
  await revisions(beforeLost.revision);
  await page
    .getByLabel('Title', { exact: true })
    .fill('Verified by the fixture owner after reply loss');
  setFault('documents-lose-edit');
  await submit(503);
  const retry = waitExecution();
  await button('Retry saved contribution').click();
  assert.equal((await retry).status(), 410);
  assert.equal((await currentOwner()).title, 'Verified by the fixture owner after reply loss');
  assert.deepEqual(browserReads, []);
  page.off('request', collect);
  await grant();

  console.log('Documents lifecycle: owner grants, deletion race, and logical restore');
  await clearRateLimits();
  await page.goto(`${ownPage}?tab=access`);
  await button('Edit application access').click();
  await button('Add application').click();
  await page.getByLabel('Provisioned application ID').fill(ownerId);
  await page.getByRole('checkbox', { name: 'Read', exact: true }).check();
  setFault('documents-lose-grants');
  const grantReply = waitExecution();
  await button('Replace grants').click();
  assert.equal((await grantReply).status(), 503);
  await button('Retry saved operation').click();
  await page.getByText('Application access updated.').waitFor();
  assert.deepEqual((await get(`${own}/permissions`)).grants, [
    { applicationId: ownerId, rights: ['READ'] },
  ]);

  await uploadCommand('documents-capacity');
  const ownDoc = await get(own);
  const pending = await execute(
    await save({
      kind: 'version.begin',
      documentId,
      expectedRevision: ownDoc.revision,
      payload: descriptor(ownDoc),
    }),
  );
  assert.equal(pending.status, 200);
  const completion = await save({ kind: 'upload.complete', uploadId: pending.body.uploadId });
  await page.goto(`${ownPage}?tab=lifecycle`);
  await button('Delete document').click();
  setFault('documents-lose-delete');
  const deleteReply = waitExecution(completion.id);
  await Promise.all([button('Confirm deletion').click(), execute(completion)]);
  assert.equal((await deleteReply).status(), 503);
  const history = await get('/api/documents/recovery');
  const deletion = history.find((item) => item.documentId === documentId);
  assert.ok(deletion);
  assert.equal((await get(`${own}/lifecycle`)).lifecycle, 'SOFT_DELETED');
  denied(await request(own));
  denied(await request(`/api/documents/uploads/${pending.body.uploadId}`));
  await page.getByRole('link', { name: 'Open Recovery', exact: true }).click();
  await page.waitForURL(`**/documents/recovery?document=${documentId}`);
  await page.getByText('Recorded lifecycle operations', { exact: true }).click();
  const recordedRetry = waitExecution();
  await button('Retry recorded operation').click();
  assert.equal((await recordedRetry).status(), 200);
  assert.equal(
    (await get('/api/documents/recovery')).find((item) => item.receipt.id === deletion.receipt.id)
      .receipt.state,
    'RESOLVED',
  );
  await uploadCommand('documents-settle-lifecycle-cancellation', {
    uploadId: pending.body.uploadId,
  });
  await button('Restore document').click();
  setFault('documents-lose-logical-restore');
  const restoreReply = waitExecution();
  await button('Confirm restore').click();
  assert.equal((await restoreReply).status(), 503);
  const restoring = await get(`${own}/lifecycle`);
  assert.equal(restoring.lifecycle, 'ACTIVE');
  assert.equal(restoring.restoration.state, 'PENDING');
  assert.equal(restoring.downloadable, false);
  await button('Retry saved operation').click();
  await page.getByText('Restore accepted. Check reassessment progress below.').waitFor();
  await uploadCommand('documents-capacity');
  await uploadCommand('documents-assess', { uploadId: originalUpload.id, logicalRestore: true });
  const restored = await get(`${own}/lifecycle`);
  assert.equal(restored.restoration.state, 'COMPLETE');
  assert.equal(restored.currentVersionId, originalUpload.versionId);
  assert.equal((await get(`/api/documents/uploads/${pending.body.uploadId}`)).upload, 'CANCELLED');
  const download = page.waitForEvent('download');
  await page.goto(ownPage);
  await button('Download original').click();
  assert.deepEqual(await readFile(await (await download).path()), originalFile);

  console.log('Documents lifecycle: restore deadline and owner Activity pagination');
  await clearRateLimits();
  const expired = `/api/documents/${expiredDocumentId}/lifecycle`;
  const candidate = await get(expired);
  assert.equal(
    (
      await execute(
        await save({
          kind: 'document.delete',
          documentId: expiredDocumentId,
          expectedRevision: candidate.revision,
        }),
      )
    ).status,
    200,
  );
  await uploadCommand('documents-expire-logical-restore');
  const aged = await get(expired);
  const lost = await execute(
    await save({
      kind: 'document.restore',
      documentId: expiredDocumentId,
      expectedRevision: aged.revision,
    }),
  );
  assert.equal(lost.status, 410);
  assert.equal(lost.body.code, 'DOCUMENTS_RESTORE_EXPIRED');
  await page.goto(`${ownPage}?tab=activity`);
  await page.getByRole('row').filter({ hasText: 'Download authorized' }).first().waitFor();
  const audit = await get(`${own}/audit`);
  for (const action of [
    'document.permissions-changed',
    'document.soft-deleted',
    'document.logical-restored',
  ])
    assert.equal(audit.items.filter((item) => item.action === action).length, 1, action);
  const first = await get(`${own}/audit?limit=1`);
  assert.ok(first.nextCursor);
  const next = await get(`${own}/audit?limit=1&cursor=${encodeURIComponent(first.nextCursor)}`);
  assert.notEqual(first.items[0].id, next.items[0].id);
  assert.equal(
    (await request(`/api/documents/audit?limit=1&cursor=${encodeURIComponent(first.nextCursor)}`))
      .status,
    400,
  );
  const appAudit = await get('/api/documents/audit?limit=5');
  assert.ok(
    appAudit.items.length && appAudit.items.every((item) => item.applicationId === contributorId),
  );
}
