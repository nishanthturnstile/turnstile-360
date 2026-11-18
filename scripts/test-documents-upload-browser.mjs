import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { fixturePolicy } from './fixtures/deployment-policy.mjs';
import { testDocumentsBatches } from './test-documents-batches-browser.mjs';
import { testDocumentsLifecycle } from './test-documents-lifecycle-browser.mjs';
import { testDocumentsProcessing } from './test-documents-processing-browser.mjs';
import { testDocumentsVersions } from './test-documents-versions-browser.mjs';

export async function testDocumentsUpload({
  page,
  origin,
  request,
  session,
  owned,
  setFault,
  restartProduct,
  uploadCommand,
  clearRateLimits,
  operatorProof,
  environment,
  documentsVersions,
  documentsBatches,
  documentsLifecycle,
  documentsProcessing,
}) {
  const file = Buffer.from('Synthetic DV-I03 plain text through the real assessment path.\n');
  const sha256 = createHash('sha256').update(file).digest('hex');
  const csrf = async () => (await session()).body.csrfToken;
  const post = async (path, body) => request(path, { method: 'POST', body, csrf: await csrf() });
  const draft = (command, mode = 'ordinary') =>
    post('/api/documents/operations', { mode, command });
  const execute = (receipt) =>
    post(`/api/documents/operations/${receipt.id}/execute`, { digest: receipt.digest });
  const history = () => request('/api/documents/operations');
  const checkPolicyRestrictions = async (commands, verifyRead, afterRenewal) => {
    await clearRateLimits();
    const turnstile = await fixturePolicy('turnstile', environment);
    const dms = await fixturePolicy('dms', environment);
    async function blocked(readable) {
      await clearRateLimits();
      for (const [command, receipt] of commands) {
        assert.equal((await execute(receipt)).status, 403, `execute ${command.kind}`);
        assert.equal((await draft(command)).status, 403, `draft ${command.kind}`);
      }
      await verifyRead(readable);
    }
    try {
      for (const policy of [turnstile, dms]) {
        await policy.set('suspended');
        await blocked(true);
        await policy.set('approved', { fresh: true, expired: true });
        await blocked(true);
        await policy.set('approved', { fresh: true, licenceExpired: true });
        await blocked(false);
        await policy.set('pending', { fresh: true });
        await blocked(false);
        await policy.set('approved');
      }
      await turnstile.set('suspended');
      await dms.set('suspended');
      await blocked(true);
      await turnstile.set('approved');
      await dms.set('approved');
      await clearRateLimits();
      await afterRenewal?.(dms);
    } finally {
      await turnstile.restore();
      await dms.restore();
    }
  };
  const begin = {
    kind: 'upload.begin',
    payload: {
      title: 'Validation upload',
      fileName: 'validation-upload.txt',
      size: file.length,
      sha256,
      contentType: 'text/plain',
      profile: 'secure-only',
      metadata: {},
    },
  };
  let operator;
  async function review(action) {
    // The child verifies against the live HTTPS fixture handled by this process.
    // Keep the event loop free while the private command waits for identity proof.
    const result = await new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        ['apps/turnstile-api/dist/modules/documents/documents-review.js'],
        {
          env: environment,
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      );
      let output = '',
        diagnostic = '';
      child.stdout.on('data', (chunk) => {
        output += chunk;
      });
      child.stderr.on('data', (chunk) => {
        diagnostic += chunk;
      });
      const timer = setTimeout(() => child.kill('SIGKILL'), 15000);
      child.once('error', reject);
      child.once('close', (status) => {
        clearTimeout(timer);
        resolve({ status, output, diagnostic });
      });
      child.stdin.end(JSON.stringify({ ...operator, ...action }));
    });
    if (result.status !== 0)
      console.log('Protected review diagnostic', result.diagnostic.slice(0, 200));
    assert.equal(result.status, 0, 'Protected Documents review command failed');
    return JSON.parse(result.output);
  }
  const count = async () => (await uploadCommand('documents-upload-count')).count;
  await clearRateLimits();
  await uploadCommand('documents-capacity');
  console.log('Documents upload: lost draft and rejected missing ID');
  const previousCount = await count();
  setFault('documents-lose-draft');
  const lost = await draft(begin).catch(() => null);
  assert.ok(!lost || lost.status >= 500);
  assert.equal(await count(), previousCount);
  const intent = (await history()).body.find((row) => row.file?.sha256 === sha256).receipt;
  assert.equal(intent.state, 'DRAFT');
  const duplicate = await draft(begin);
  assert.equal(duplicate.status, 201);
  assert.equal(duplicate.body.receipt.id, intent.id);
  assert.equal((await execute({ id: randomUUID(), digest: intent.digest })).status, 410);

  console.log(
    'Documents upload: committed DMS begin response lost, product restart and exact replay',
  );
  setFault('documents-lose-begin');
  assert.equal((await execute(intent)).status, 503);
  assert.equal(await count(), previousCount + 1);
  assert.equal(
    (await request(`/api/documents/operations/${intent.id}`)).body.receipt.state,
    'UNCERTAIN',
  );
  await restartProduct();
  const replay = await execute({ ...intent, id: intent.id.toUpperCase() });
  assert.equal(replay.status, 200);
  assert.equal(replay.body.receipt.state, 'RESOLVED');
  assert.equal(await count(), previousCount + 1);
  assert.equal((await execute(intent)).body.transfer, null);
  const id = replay.body.uploadId;
  const completion = { kind: 'upload.complete', uploadId: id };
  const complete = await draft(completion);
  assert.equal(complete.status, 201);

  console.log(
    'Documents upload: browser file re-selection, credential-free PUT and lost storage reply',
  );
  await page.goto(`${origin}/documents/uploads`);
  await page.getByRole('button', { name: /^validation-upload\.txt/ }).click();
  await page.getByLabel('Plain text file', { exact: true }).setInputFiles({
    name: 'validation-upload.txt',
    mimeType: 'text/plain',
    buffer: file,
  });
  await uploadCommand('documents-lose-put');
  const transferred = page.waitForRequest(
    (incoming) =>
      incoming.method() === 'PUT' &&
      new URL(incoming.url()).origin === environment.DMS_DOCUMENTS_TRANSFER_ORIGIN,
  );
  await page.getByRole('button', { name: 'Refresh transfer', exact: true }).click();
  const put = await transferred;
  for (const name of ['cookie', 'authorization', 'referer', 'x-csrf-token', 'x-thaarei-actor-id'])
    assert.equal(await put.headerValue(name), null);
  assert.equal(await put.headerValue('if-none-match'), '*');
  assert.equal(await put.headerValue('content-length'), String(file.length));
  await page.getByText('The transfer reply was lost.', { exact: false }).waitFor();
  const refresh = page.waitForResponse(
    (response) =>
      response.request().method() === 'PUT' &&
      new URL(response.url()).origin === environment.DMS_DOCUMENTS_TRANSFER_ORIGIN,
  );
  await page.getByRole('button', { name: 'Refresh transfer', exact: true }).click();
  assert.equal((await refresh).status(), 412);
  await page.getByText('Request completion to verify the staged file', { exact: false }).waitFor();

  console.log(
    'Documents upload: independent product and DMS restrictions, renewal and lost completion reply',
  );
  const uploadControls = [[completion, complete.body.receipt]];
  for (const kind of ['upload.refresh', 'upload.cancel']) {
    const command = { kind, uploadId: id };
    const result = await draft(command);
    assert.equal(result.status, 201);
    uploadControls.push([command, result.body.receipt]);
  }
  await checkPolicyRestrictions(
    uploadControls,
    async (readable) => {
      const read = await request(`/api/documents/uploads/${id}`);
      assert.equal(read.status, readable ? 200 : 403);
      if (readable) {
        assert.equal(read.body.completionRequested, false);
        assert.equal(read.body.upload, 'INITIATED');
      }
    },
    async (dms) => {
      assert.ok((await execute(uploadControls[1][1])).body.transfer);
      setFault('documents-lose-complete');
      assert.equal((await execute(complete.body.receipt)).status, 503);
      assert.equal((await request(`/api/documents/uploads/${id}`)).body.completionRequested, true);
      await dms.set('suspended');
      assert.equal((await execute(complete.body.receipt)).status, 403);
      await dms.set('approved');
      assert.equal((await execute(complete.body.receipt)).body.receipt.acknowledgement, 'accepted');
    },
  );
  console.log(
    'Documents upload: real native ClamAV and isolated parser, owning publication, original digest',
  );
  await clearRateLimits();
  const privateCompletion = await fixturePolicy('dms', environment);
  try {
    await uploadCommand('documents-assess', { uploadId: id, holdResult: true }, async () => {
      await privateCompletion.set('suspended');
      assert.equal((await execute(complete.body.receipt)).status, 403);
      await uploadCommand('documents-release-assessment');
    });
    const publishedWhileRestricted = await request(`/api/documents/uploads/${id}`);
    assert.equal(publishedWhileRestricted.status, 200);
    assert.equal(publishedWhileRestricted.body.availability, 'AVAILABLE');
  } finally {
    await privateCompletion.restore();
  }
  const status = await request(`/api/documents/uploads/${id.toUpperCase()}`);
  assert.equal(status.status, 200);
  assert.equal(status.body.security, 'PASSED');
  assert.equal(status.body.availability, 'AVAILABLE');
  assert.equal(status.body.processing, 'NOT_SCHEDULED');
  await page.goto(`${origin}/documents/${status.body.documentId}`);
  assert.equal(
    (await request(`/api/documents/${status.body.documentId.toUpperCase()}/download`)).status,
    200,
  );
  const saved = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download original', exact: true }).click();
  const original = await saved;
  assert.equal(original.suggestedFilename(), begin.payload.fileName);
  assert.deepEqual(await readFile(await original.path()), file);

  if (documentsVersions)
    await testDocumentsVersions({
      page,
      origin,
      request,
      csrf,
      draft,
      execute,
      setFault,
      uploadCommand,
      clearRateLimits,
      documentId: status.body.documentId,
      originalVersionId: status.body.versionId,
      originalFile: file,
    });

  if (documentsBatches)
    await testDocumentsBatches({
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
      checkPolicyRestrictions,
      async reviewBatch(action) {
        operator ??= await operatorProof();
        return review(action);
      },
      documentId: status.body.documentId,
    });

  if (documentsLifecycle)
    await testDocumentsLifecycle({
      page,
      origin,
      request,
      draft,
      execute,
      setFault,
      uploadCommand,
      clearRateLimits,
      originalUpload: status.body,
      originalFile: file,
    });

  console.log('Documents upload: replay expiry, restore marker and tombstone pruning');
  await clearRateLimits();
  const uncertainBody = {
    ...begin,
    payload: { ...begin.payload, sha256: 'a'.repeat(64), fileName: 'uncertain.txt' },
  };
  await uploadCommand('documents-capacity');
  const uncertain = (await draft(uncertainBody)).body.receipt;
  setFault('documents-crash-begin');
  const crashed = await execute(uncertain).catch(() => null);
  assert.ok(!crashed || crashed.status >= 500);
  await restartProduct();
  assert.equal(
    (await request(`/api/documents/operations/${uncertain.id}`)).body.receipt.state,
    'DISPATCHING',
  );
  const afterUncertain = await count();
  await owned((db) =>
    db.query(
      "UPDATE turnstile.documents_intent SET reconciliation_until=clock_timestamp()-interval '1 second', lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",
      [uncertain.id],
    ),
  );
  assert.equal((await execute(uncertain)).status, 410);
  assert.equal(
    (await request(`/api/documents/operations/${uncertain.id}`)).body.receipt.state,
    'UNRESOLVED_REQUIRES_REVIEW',
  );
  assert.equal((await draft(uncertainBody)).status, 409);
  assert.equal(
    (
      await draft({
        ...uncertainBody,
        payload: { ...uncertainBody.payload, title: 'Changed title' },
      })
    ).status,
    409,
  );
  assert.equal(await count(), afterUncertain);
  const verified = (await uploadCommand('documents-review-binding', { intentId: uncertain.id }))
    .uploadBinding;
  assert.ok(verified);
  operator = await operatorProof();
  assert.equal(
    (
      await review({
        action: 'attach',
        intentId: uncertain.id,
        digest: uncertain.digest,
        ...verified,
        reason:
          'Checked the committed DMS admission for the original key in the disposable fixture.',
      })
    ).attached,
    true,
  );
  assert.equal(
    (await request(`/api/documents/operations/${uncertain.id}`)).body.uploadId,
    verified.uploadId,
  );
  assert.equal((await execute(uncertain)).body.transfer, null);
  const restored = (
    await draft({ ...begin, payload: { ...begin.payload, sha256: 'b'.repeat(64) } })
  ).body.receipt;
  await owned((db) =>
    db.query("UPDATE turnstile.documents_intent SET recovery_marker=repeat('c',64) WHERE id=$1", [
      restored.id,
    ]),
  );
  assert.equal((await execute(restored)).status, 410);
  assert.equal(await count(), afterUncertain);
  const disposition = {
    action: 'dispose',
    intentId: restored.id,
    digest: restored.digest,
    verifiedOutcome: 'no_effect',
    reason:
      'Checked the owning DMS fixture and found no dispatched operation for this restored draft.',
  };
  assert.equal((await review(disposition)).disposed, true);
  assert.equal((await review(disposition)).disposed, true);
  assert.equal((await execute(restored)).status, 410);
  await owned((db) =>
    db.query(
      "UPDATE turnstile.documents_intent SET resolved_at=clock_timestamp()-interval '91 days' WHERE id=$1",
      [intent.id],
    ),
  );
  assert.equal((await execute(intent)).status, 410);
  assert.equal(await count(), afterUncertain);
  console.log('Documents upload: initiate and cancel using the ordinary Uploads view');
  await clearRateLimits();
  await uploadCommand('documents-capacity');
  await page.goto(`${origin}/documents/uploads`);
  await page.getByLabel('Plain text file', { exact: true }).setInputFiles({
    name: 'cancel-validation.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('Synthetic cancellation fixture.\n'.repeat(8000)),
  });
  const network = await page.context().newCDPSession(page);
  try {
    await network.send('Network.enable');
    await network.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: 64 * 1024,
    });
    await page.getByRole('button', { name: 'Start upload', exact: true }).click();
    const progress = page.getByRole('progressbar', { name: 'File transfer' });
    await progress
      .and(page.locator('[aria-valuenow]:not([aria-valuenow="0"],[aria-valuenow="100"])'))
      .waitFor();
    await page
      .getByText('Request completion to verify the staged file', { exact: false })
      .waitFor();
    await progress.waitFor({ state: 'hidden' });
  } finally {
    await network.send('Network.emulateNetworkConditions', {
      offline: false,
      latency: 0,
      downloadThroughput: -1,
      uploadThroughput: -1,
    });
    await network.detach();
  }
  await page.getByRole('button', { name: 'Cancel upload', exact: true }).click();
  await page.getByText('cancelled', { exact: true }).waitFor();
  await clearRateLimits();
  console.log(
    'DV-I03 ordinary browser, exact original digest, durable retry and scope fencing passed.',
  );
  if (documentsProcessing)
    await testDocumentsProcessing({
      page,
      origin,
      request,
      draft,
      execute,
      setFault,
      uploadCommand,
      clearRateLimits,
      originalUpload: status.body,
      originalFile: file,
    });
}
