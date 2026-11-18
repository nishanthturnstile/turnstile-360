import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { DOCUMENTS_LIMITS } from '../packages/turnstile-contracts/dist/documents.js';

const base = '/documents/batches';
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');

export async function testDocumentsBatches({
  page,
  origin,
  request,
  csrf,
  draft,
  execute,
  setFault,
  uploadCommand,
  clearRateLimits,
  owned,
  reviewBatch,
  checkPolicyRestrictions,
  documentId,
}) {
  const expected = { type: 'text/plain', profile: 'secure-only' };
  const count = async (resource) => (await uploadCommand(`documents-${resource}-count`)).count;
  const get = async (path) => {
    const result = await request(path);
    assert.equal(result.status, 200);
    return result.body;
  };
  async function save(command) {
    const result = await draft(command);
    assert.equal(result.status, 201, command.kind);
    return result.body.receipt;
  }
  const button = (name) => page.getByRole('button', { name, exact: true });
  const waitExecution = () =>
    page.waitForResponse((response) =>
      /^\/api\/documents\/operations\/[^/]+\/execute$/.test(new URL(response.url()).pathname),
    );
  const testFiles = ['new-one.txt', 'next-version.txt', 'new-three.txt'].map((name, i) => ({
    name,
    mimeType: expected.type,
    buffer: Buffer.from(`Synthetic batch file ${i}.\n`),
  }));

  console.log('Documents batches: mixed manifest, lost acknowledgement and durable reopen');
  await clearRateLimits();
  await page.goto(`${origin}${base}`);
  await page.getByLabel('Plain text files', { exact: true }).setInputFiles(testFiles);
  await page.getByLabel('next-version.txt · Document ID', { exact: true }).fill(documentId);
  await button('Review manifest').click();
  await page.getByText(/^next-version\.txt · Version of/).waitFor();
  const originalTotal = await count('batch');
  setFault('documents-lose-batch-create');
  const dropped = waitExecution();
  await button('Create batch').click();
  assert.equal((await dropped).status(), 503);
  await page.getByRole('heading', { name: 'Saved batch operation', exact: true }).waitFor();
  const operationUrl = page.url();
  await page.reload();
  assert.equal(page.url(), operationUrl);
  await button('Retry saved batch').click();
  await page.getByRole('heading', { name: 'Batch details', exact: true }).waitFor();
  const batchId = new URL(page.url()).searchParams.get('batch');
  assert.ok(batchId);
  assert.equal(await count('batch'), originalTotal + 1);
  const path = `/api${base}/${batchId}`;
  const local = await get(`${path}/manifest`);
  assert.equal(local.items.length, 3);
  assert.equal(local.items[1].operation, 'new-version');
  assert.equal(local.items[0].sha256, digest(testFiles[0].buffer));
  assert.equal((await get(path)).counts.items.UNSTARTED, 3);

  console.log('Documents batches: re-selection, lost item reply and capacity delay');
  const originalUploadCount = await count('upload');
  await page.getByLabel('Source for new-one.txt', { exact: true }).setInputFiles({
    ...testFiles[0],
    buffer: Buffer.alloc(testFiles[0].buffer.length, 65),
  });
  await button('Transfer selected files').click();
  await page.getByText('Select the original file with matching name, size and SHA-256.').waitFor();
  assert.equal(await count('upload'), originalUploadCount);
  await clearRateLimits();
  await uploadCommand('documents-capacity');
  const first = await save({ kind: 'batch.item', batchId, itemId: local.items[0].itemId });
  setFault('documents-lose-batch-item');
  assert.equal((await execute(first)).status, 503);
  assert.equal(await count('upload'), originalUploadCount + 1);
  await page.reload();
  for (const file of testFiles)
    await page.getByLabel(`Source for ${file.name}`, { exact: true }).setInputFiles(file);
  await uploadCommand('documents-capacity');
  await button('Transfer selected files').click();
  await page
    .getByText('capacity exceeded · Retry when capacity is available', { exact: true })
    .waitFor();
  const delayed = await get(path);
  assert.equal(delayed.counts.items.BOUND, 2);
  assert.equal(delayed.counts.items.UNSTARTED, 1);
  assert.equal(await count('upload'), originalUploadCount + 2);
  const version = delayed.items.find((item) => item.operation === 'new-version');
  assert.equal(version.session.documentId, documentId);
  assert.ok(version.session.completionRequested);
  const stage = delayed.items.find((item) => item.fileName === 'new-one.txt');
  assert.ok(stage.session.completionRequested);
  await uploadCommand('documents-assess', { uploadId: stage.session.id });
  await uploadCommand('documents-capacity');
  await button('Transfer selected files').click();
  await page
    .getByRole('row')
    .filter({ hasText: 'new-three.txt' })
    .getByText('Completion accepted. Assessment continues separately.', { exact: true })
    .waitFor();
  const admitted = await get(path);
  assert.equal(admitted.counts.items.BOUND, 3);
  assert.equal(await count('upload'), originalUploadCount + 3);
  const created = admitted.items.find((item) => item.fileName === 'new-three.txt');
  assert.ok(created.session.completionRequested);
  for (const item of [version, created])
    await uploadCommand('documents-assess', { uploadId: item.session.id });
  assert.equal((await get(path)).counts.availability.AVAILABLE, 3);

  console.log(
    'Documents batches: large real Nginx ingress, forwarded byte bounds and cursor pages',
  );
  await clearRateLimits();
  const makeManifest = (noteSize) => ({
    kind: 'batch.create',
    payload: {
      items: Array.from({ length: 100 }, (_, i) => ({
        itemId: `large-${i}`,
        operation: 'create',
        descriptor: {
          title: `Synthetic manifest item ${i}`,
          fileName: `large-${i}.txt`,
          contentType: expected.type,
          profile: expected.profile,
          size: 8,
          sha256: digest(`large-${i}`),
          metadata: { note: 'é'.repeat(noteSize) },
        },
      })),
    },
  });
  const serialize = (command) => JSON.stringify({ mode: 'ordinary', command });
  const wire = async (body, media = 'application/json') =>
    page.evaluate(
      async ({ body, token, media }) => {
        const response = await fetch('/api/documents/operations', {
          method: 'POST',
          headers: {
            'content-type': media,
            'x-csrf-token': token,
            'x-turnstile-access-contract': '3',
          },
          body,
        });
        return { status: response.status, body: await response.json() };
      },
      { body, token: await csrf(), media },
    );
  const payload = makeManifest(1050);
  const json = serialize(payload);
  assert.ok(Buffer.byteLength(json) > 200000);
  const exact = json + ' '.repeat(DOCUMENTS_LIMITS.batchEnvelopeBytes - Buffer.byteLength(json));
  const oversize = await wire(`${exact} `);
  assert.equal(oversize.status, 413);
  assert.equal(oversize.body.code, 'DOCUMENTS_TOO_LARGE');
  assert.equal((await wire(json, 'text/plain')).status, 415);
  const inner = makeManifest(1155);
  assert.ok(Buffer.byteLength(JSON.stringify(inner.payload)) < DOCUMENTS_LIMITS.manifestBytes);
  const forwarded = await wire(serialize(inner));
  assert.equal(forwarded.status, 413);
  assert.equal(forwarded.body.code, 'DOCUMENTS_TOO_LARGE');
  const localLarge = await wire(exact);
  assert.equal(localLarge.status, 201);
  const large = await execute(localLarge.body.receipt);
  assert.equal(large.status, 200);
  const largeId = large.body.batchId;
  const largePath = `/api${base}/${largeId}`;
  assert.equal(await count('upload'), originalUploadCount + 3);
  const firstPage = await get(`${largePath}?limit=50`);
  assert.equal(firstPage.items.length, 50);
  assert.equal(firstPage.counts.items.UNSTARTED, 100);
  const secondPage = await get(
    `${largePath}?limit=50&cursor=${encodeURIComponent(firstPage.nextCursor)}`,
  );
  assert.equal(secondPage.items.length, 50);
  assert.equal(secondPage.counts.items.UNSTARTED, 100);
  assert.notEqual(firstPage.items[0].itemId, secondPage.items[0].itemId);
  await page.goto(`${origin}${base}?batch=${largeId}`);
  await page.getByRole('link', { name: 'Next page', exact: true }).click();
  await page.getByRole('row').filter({ hasText: 'large-20.txt' }).waitFor();

  console.log('Documents batches: protected attachment of an expired item on a later page');
  await clearRateLimits();
  await uploadCommand('documents-capacity');
  const itemId = secondPage.items[1].itemId;
  const uncertainItem = await save({ kind: 'batch.item', batchId: largeId, itemId });
  setFault('documents-lose-batch-item');
  assert.equal((await execute(uncertainItem)).status, 503);
  await owned((db) =>
    db.query(
      "UPDATE turnstile.documents_intent SET reconciliation_until=clock_timestamp()-interval '1 second' WHERE id=$1",
      [uncertainItem.id],
    ),
  );
  assert.equal((await execute(uncertainItem)).status, 410);
  const knownItem = (
    await uploadCommand('documents-review-binding', { intentId: uncertainItem.id })
  ).uploadBinding;
  assert.ok(knownItem);
  assert.equal(
    (
      await reviewBatch({
        action: 'attach-batch-item',
        intentId: uncertainItem.id,
        digest: uncertainItem.digest,
        batchId: largeId,
        itemId,
        ...knownItem,
        reason: 'Verified batch item and original admission key',
      })
    ).attached,
    true,
  );
  const resolvedItem = await execute(uncertainItem);
  assert.equal(resolvedItem.status, 200);
  assert.equal(resolvedItem.body.uploadId, knownItem.uploadId);
  assert.equal(resolvedItem.body.transfer, null);

  console.log(
    'Documents batches: close and admission race, lost control replies and retained publications',
  );
  await clearRateLimits();
  await uploadCommand('documents-capacity');
  const item = { kind: 'batch.item', batchId: largeId, itemId: firstPage.items[0].itemId };
  const closeCommand = { kind: 'batch.close', batchId: largeId };
  const cancelCommand = { kind: 'batch.cancel', batchId: largeId };
  const pendingBatch = {
    kind: 'batch.create',
    payload: {
      items: [
        {
          ...payload.payload.items[0],
          descriptor: {
            ...payload.payload.items[0].descriptor,
            sha256: digest('synthetic-expired-batch'),
            metadata: {},
          },
        },
      ],
    },
  };
  const pendingItem = await save(item);
  const close = await save(closeCommand);
  const cancel = await save(cancelCommand);
  const lost = await save(pendingBatch);
  console.log('Documents batches: restricted product/DMS controls and same-intent renewal');
  const beforeRestriction = await get(largePath);
  const batchCount = await count('batch');
  await checkPolicyRestrictions(
    [
      [pendingBatch, lost],
      [item, pendingItem],
      [closeCommand, close],
      [cancelCommand, cancel],
    ],
    async (readable) => {
      const result = await request(largePath);
      assert.equal(result.status, readable ? 200 : 403);
      if (readable) {
        assert.equal(result.body.state, beforeRestriction.state);
        assert.deepEqual(result.body.counts, beforeRestriction.counts);
      }
      assert.equal(await count('batch'), batchCount);
    },
  );
  setFault('documents-lose-batch-close');
  const [closing, admission] = await Promise.all([execute(close), execute(pendingItem)]);
  assert.equal(closing.status, 503);
  assert.ok([200, 409].includes(admission.status));
  const closed = await get(largePath);
  assert.equal(closed.state, 'CLOSED');
  assert.equal(closed.counts.items.CLOSED + closed.counts.items.BOUND, 100);
  assert.equal(closed.counts.items.BOUND, admission.status === 200 ? 2 : 1);
  setFault('documents-lose-batch-cancel');
  assert.equal((await execute(cancel)).status, 503);
  assert.equal((await get(largePath)).state, 'CANCELLED');
  assert.equal((await execute(cancel)).status, 200);
  assert.equal((await execute(close)).status, 200);
  assert.equal((await get(largePath)).state, 'CANCELLED');
  await uploadCommand('documents-settle-cancelled-batch', { batchId: largeId });
  assert.equal((await get(path)).counts.availability.AVAILABLE, 3);
  assert.equal((await execute(await save({ kind: 'batch.cancel', batchId }))).status, 200);
  assert.equal((await get(path)).counts.availability.AVAILABLE, 3);

  console.log('Documents batches: expired lost creation identity blocks replacement');
  setFault('documents-lose-batch-create');
  assert.equal((await execute(lost)).status, 503);
  const after = await count('batch');
  await owned((db) =>
    db.query(
      "UPDATE turnstile.documents_intent SET reconciliation_until=clock_timestamp()-interval '1 second' WHERE id=$1",
      [lost.id],
    ),
  );
  assert.equal((await execute(lost)).status, 410);
  assert.equal(
    (await get(`/api/documents/operations/${lost.id}`)).receipt.state,
    'UNRESOLVED_REQUIRES_REVIEW',
  );
  assert.equal((await draft(pendingBatch)).status, 409);
  pendingBatch.payload.items[0].itemId = randomUUID();
  assert.equal((await draft(pendingBatch)).status, 409);
  assert.equal(await count('batch'), after);
  assert.equal((await execute({ ...lost, id: randomUUID() })).status, 410);
  const knownBatch = (await uploadCommand('documents-review-batch-binding', { intentId: lost.id }))
    .batchBinding;
  assert.ok(knownBatch);
  assert.equal(
    (
      await reviewBatch({
        action: 'attach-batch',
        intentId: lost.id,
        digest: lost.digest,
        ...knownBatch,
        reason: 'Verified batch binding against the original creation key',
      })
    ).attached,
    true,
  );
  assert.equal((await get(`/api/documents/operations/${lost.id}`)).batchId, knownBatch.batchId);
  assert.equal(await count('batch'), after);
}
