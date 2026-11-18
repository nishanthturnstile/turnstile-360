import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';

export async function testDocumentsVersions({
  page,
  origin,
  request,
  csrf,
  draft,
  execute,
  setFault,
  uploadCommand,
  clearRateLimits,
  documentId,
  originalVersionId,
  originalFile,
}) {
  const detail = `/api/documents/${documentId}`;
  const url = `${origin}/documents/${documentId}`;
  const read = async (suffix = '') => {
    const response = await request(detail + suffix);
    assert.equal(response.status, 200, suffix || 'document detail');
    return response.body;
  };
  async function save(kind, fields) {
    const result = await draft({
      kind,
      ...fields,
      documentId,
      expectedRevision: (await read()).revision,
    });
    assert.equal(result.status, 201, kind);
    return result.body.receipt;
  }
  const dialog = (tab) => tab.getByRole('dialog');
  const button = (tab, name) => dialog(tab).getByRole('button', { name, exact: true });
  async function confirmSaved(tab) {
    await dialog(tab)
      .getByText('The saved document state confirms the requested change.')
      .waitFor();
    await button(tab, 'Done').click();
  }

  console.log('Documents versions: two browser tabs and explicit revision review');
  await clearRateLimits();
  await page.goto(url);
  await page.getByRole('button', { name: 'Edit document details' }).click();
  const title = 'Validation title from the first tab';
  const titleField = dialog(page).getByLabel('Title', { exact: true });
  await titleField.fill(title);
  await button(page, 'Cancel').click();
  const discard = page.getByRole('alertdialog', { name: 'Discard unsaved changes?' });
  await discard.getByRole('button', { name: 'Keep editing' }).click();
  assert.equal(await titleField.inputValue(), title);
  const peer = await page.context().newPage();
  try {
    await peer.goto(url);
    await peer.getByRole('button', { name: 'Edit document details' }).click();
    await dialog(peer).getByLabel('Tags, one per line').fill('reviewed\nsite-a');
    await button(peer, 'Save details').click();
    await confirmSaved(peer);
    await button(page, 'Save details').click();
    await button(page, 'Review latest revision').waitFor();
    assert.equal(await titleField.inputValue(), title);
    await button(page, 'Review latest revision').click();
    await dialog(page)
      .getByRole('button', { name: /^Use revision / })
      .click();
    assert.equal(await titleField.inputValue(), title);
    await button(page, 'Save details').click();
    await confirmSaved(page);
    const updated = await read();
    assert.equal(updated.title, title);
    assert.deepEqual(updated.tags, ['reviewed', 'site-a']);
  } finally {
    await peer.close();
  }

  console.log('Documents versions: namespaced references and uncertain UTF-8 edit readback');
  await page.getByRole('button', { name: 'Manage references' }).click();
  await dialog(page).getByLabel('Namespace', { exact: true }).fill('turnstile');
  await dialog(page).getByLabel('Type', { exact: true }).fill('site');
  await dialog(page).getByLabel('External ID', { exact: true }).fill('north-yard');
  await button(page, 'Link reference').click();
  await confirmSaved(page);
  const linked = await read();
  assert.ok(linked.references.some((ref) => ref.externalId === 'north-yard'));
  await page.getByRole('button', { name: 'Manage references' }).click();
  await button(page, 'Unlink turnstile / site / north-yard').click();
  await button(page, 'Confirm unlink').click();
  await confirmSaved(page);
  assert.equal((await read()).references.length, linked.references.length - 1);

  const metadata = Object.fromEntries(
    Array.from({ length: 8 }, (_, i) => [`key${i}`, 'é'.repeat(1018)]),
  );
  metadata.key0 += 'a'.repeat(16384 - Buffer.byteLength(JSON.stringify(metadata)));
  assert.equal(Buffer.byteLength(JSON.stringify(metadata)), 16384);
  const edit = {
    mode: 'ordinary',
    command: {
      kind: 'document.edit',
      documentId,
      expectedRevision: (await read()).revision,
      payload: { metadata },
    },
  };
  async function wire(value) {
    return page.evaluate(
      async ({ value, token }) => {
        const response = await fetch('/api/documents/operations', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-turnstile-access-contract': '3',
            'x-csrf-token': token,
          },
          body: value,
        });
        return { status: response.status, body: await response.json() };
      },
      { value, token: await csrf() },
    );
  }
  const json = JSON.stringify(edit);
  const exact = json + ' '.repeat(36864 - Buffer.byteLength(json));
  assert.equal((await wire(`${exact} `)).status, 413);
  const oversized = structuredClone(edit);
  oversized.command.payload.metadata.key0 += 'a';
  assert.equal((await wire(JSON.stringify(oversized))).status, 400);
  const accepted = await wire(exact);
  assert.equal(accepted.status, 201);
  setFault('documents-lose-edit');
  assert.equal((await execute(accepted.body.receipt)).status, 503);
  const committed = await read();
  assert.deepEqual(committed.metadata, metadata);
  const recovered = await execute(accepted.body.receipt);
  assert.equal(recovered.status, 200);
  assert.equal(recovered.body.receipt.state, 'RESOLVED');
  assert.equal(recovered.body.uploadId, null);
  assert.equal((await read()).revision, committed.revision);

  console.log('Documents versions: pending states, out-of-order publication and historical bytes');
  await clearRateLimits();
  await uploadCommand('documents-capacity');
  await page.goto(url);
  await page.getByRole('link', { name: 'Versions', exact: true }).click();
  await page.getByRole('link', { name: 'Add text version', exact: true }).click();
  const text = 'Synthetic earlier version body.\n';
  await page.getByLabel('Plain text file', { exact: true }).setInputFiles({
    name: 'earlier-version.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(text),
  });
  await page.getByRole('button', { name: 'Start upload', exact: true }).click();
  await page.getByText('Request completion to verify the staged file', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Request completion', exact: true }).click();
  await page
    .getByText('Completion accepted. Assessment and availability update separately.')
    .waitFor();
  const earlier = (await read('/versions')).items.find(
    (value) => value.fileName === 'earlier-version.txt',
  );
  assert.ok(earlier?.uploadId);
  const content = 'Synthetic later version body.\n';
  await uploadCommand('documents-capacity');
  const document = await read();
  const later = await execute(
    await save('version.begin', {
      payload: {
        title: document.title,
        fileName: 'later-version.txt',
        size: Buffer.byteLength(content),
        sha256: createHash('sha256').update(content).digest('hex'),
        contentType: 'text/plain',
        profile: 'secure-only',
        metadata: document.metadata,
      },
    }),
  );
  assert.equal(later.status, 200);
  assert.ok(later.body.transfer && later.body.uploadId);
  const put = await page.evaluate(
    async ({ transfer, content }) =>
      (
        await fetch(transfer.url, {
          method: 'PUT',
          credentials: 'omit',
          headers: transfer.headers,
          body: content,
        })
      ).status,
    { transfer: later.body.transfer, content },
  );
  assert.ok(put >= 200 && put < 300);
  const complete = await draft({ kind: 'upload.complete', uploadId: later.body.uploadId });
  assert.equal(complete.status, 201);
  assert.equal((await execute(complete.body.receipt)).status, 200);
  const laterVersion = (await read('/versions')).items.find(
    (value) => value.uploadId === later.body.uploadId,
  );
  assert.ok(laterVersion);
  assert.equal((await read()).currentVersionId, originalVersionId);
  assert.equal(laterVersion.downloadable, false);
  assert.equal((await request(`${detail}/versions/${randomUUID()}`)).status, 404);
  assert.equal((await request(`${detail}/download?versionId=${laterVersion.id}`)).status, 409);
  await uploadCommand('documents-assess', { uploadId: later.body.uploadId });
  assert.equal((await read()).currentVersionId, laterVersion.id);
  await uploadCommand('documents-assess', { uploadId: earlier.uploadId });
  assert.equal((await read()).currentVersionId, laterVersion.id);
  const historic = await read(`/versions/${originalVersionId}`);
  assert.equal(historic.isCurrent, false);
  assert.equal(historic.security, 'PASSED');
  const firstPage = await read('/versions?limit=1');
  assert.equal(firstPage.items.length, 1);
  assert.ok(firstPage.nextCursor);
  const secondPage = await read(
    `/versions?limit=1&cursor=${encodeURIComponent(firstPage.nextCursor)}`,
  );
  assert.notEqual(firstPage.items[0].id, secondPage.items[0].id);

  console.log(
    'Documents versions: historical download and same-key assessed restore after another edit',
  );
  await clearRateLimits();
  await page.goto(`${url}?tab=versions&version=${originalVersionId}`);
  const historyDetail = page.getByRole('heading', { name: 'Version 1 details', exact: true });
  await historyDetail.waitFor();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download original', exact: true }).click();
  assert.deepEqual(await readFile(await (await download).path()), originalFile);
  await uploadCommand('documents-capacity');
  const count = async () => (await uploadCommand('documents-upload-count')).count;
  const beforeRestore = await count();
  await page.getByRole('button', { name: 'Restore this version', exact: true }).click();
  setFault('documents-lose-restore');
  const unavailableRestore = page.waitForResponse((response) =>
    /^\/api\/documents\/operations\/[^/]+\/execute$/.test(new URL(response.url()).pathname),
  );
  await button(page, 'Confirm restore').click();
  assert.equal((await unavailableRestore).status(), 503);
  assert.equal(await count(), beforeRestore + 1);
  assert.equal((await read()).currentVersionId, laterVersion.id);
  const editAfterRestore = await save('document.edit', {
    payload: { title: 'Updated while restore assessed' },
  });
  assert.equal((await execute(editAfterRestore)).status, 200);
  await button(page, 'Check saved operation').click();
  await dialog(page).getByText('Restore accepted.', { exact: false }).waitFor();
  assert.equal(await count(), beforeRestore + 1);
  const restored = (await read('/versions')).items.find(
    (value) => value.restoredFromVersionId === originalVersionId,
  );
  assert.ok(restored?.uploadId);
  assert.equal(restored.downloadable, false);
  assert.equal((await read()).currentVersionId, laterVersion.id);
  await uploadCommand('documents-assess', { uploadId: restored.uploadId });
  assert.equal((await read()).currentVersionId, restored.id);
  const published = await read(`/versions/${restored.id}`);
  assert.equal(published.security, 'PASSED');
  assert.equal(published.availability, 'AVAILABLE');
  assert.equal(published.sha256, historic.sha256);
  assert.equal((await read()).title, 'Updated while restore assessed');

  console.log('Documents versions: unconfirmed edit stays under manual review');
  const before = await read();
  const unconfirmed = { payload: { title: 'Unconfirmed validation draft' } };
  const unresolved = await save('document.edit', unconfirmed);
  setFault('documents-lose-edit-before-write');
  assert.equal((await execute(unresolved)).status, 503);
  assert.equal((await execute(unresolved)).status, 410);
  const receipt = await request(`/api/documents/operations/${unresolved.id}`);
  assert.equal(receipt.body.receipt.state, 'UNRESOLVED_REQUIRES_REVIEW');
  assert.equal((await read()).revision, before.revision);
  assert.equal(
    (
      await draft({
        kind: 'document.edit',
        documentId,
        expectedRevision: before.revision,
        ...unconfirmed,
      })
    ).status,
    409,
  );
}
