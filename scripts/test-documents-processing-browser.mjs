import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');

async function ocrFixture(...args) {
  const folder = await mkdtemp(join(tmpdir(), 'thaarei-documents-ocr-'));
  try {
    const path = join(folder, 'source');
    await run(
      'uv',
      ['run', '--locked', 'python', 'tests/make_ocr_fixture.py', '--output', path, ...args],
      {
        cwd: resolve('apps/dms-processing'),
      },
    );
    return await readFile(path);
  } finally {
    await rm(folder, { recursive: true, force: true });
  }
}

export async function testDocumentsProcessing({
  page,
  origin,
  request,
  draft,
  execute,
  setFault,
  uploadCommand,
  clearRateLimits,
  originalUpload,
}) {
  const button = (name) => page.getByRole('button', { name, exact: true });
  const url = (document) => `/api/documents/${document}`;
  const shown = (document, params) =>
    `${origin}/documents/${document}?${new URLSearchParams(params)}`;
  const load = async (path) => {
    const fetched = await request(path);
    assert.equal(fetched.status, 200, path);
    return fetched.body;
  };
  const newIntent = async (command) => {
    const result = await draft(command);
    assert.equal(result.status, 201, command.kind);
    return result.body.receipt;
  };
  const execution = () =>
    page.waitForResponse((response) =>
      /\/api\/documents\/operations\/[^/]+\/execute$/.test(new URL(response.url()).pathname),
    );
  const processSource = async (upload, fail = false) =>
    (await uploadCommand('documents-process', { uploadId: upload.id, failure: fail })).observation;
  function reprocess(upload) {
    return {
      kind: 'version.reprocess',
      documentId: upload.documentId,
      versionId: upload.versionId,
      payload: { profile: 'searchable' },
    };
  }
  async function upload(name, type, bytes) {
    await clearRateLimits();
    await uploadCommand('documents-capacity');
    await page.goto(`${origin}/documents/uploads`);
    await page
      .getByLabel('Source file', { exact: true })
      .setInputFiles({ name, mimeType: type, buffer: bytes });
    await page.getByLabel('Upload profile', { exact: true }).selectOption('searchable');
    await button('Start upload').click();
    await page
      .getByText('Request completion to verify the staged file', { exact: false })
      .waitFor();
    const done = execution();
    await button('Request completion').click();
    assert.equal((await done).status(), 200);
    const receipt = (await load('/api/documents/operations')).find(
      (row) => row.uploadId && row.file?.sha256 === hash(bytes),
    );
    assert.ok(receipt);
    await uploadCommand('documents-assess', { uploadId: receipt.uploadId });
    return load(`/api/documents/uploads/${receipt.uploadId}`);
  }

  console.log('Documents processing: owner reprocessing with lost DMS acknowledgement');
  await clearRateLimits();
  await uploadCommand('documents-processing-setup');
  await uploadCommand('documents-capacity');
  const original = originalUpload;
  const history = `${url(original.documentId)}/processing?versionId=${original.versionId}`;
  assert.deepEqual((await load(history)).items, []);
  const unavailable = await request(`${url(original.documentId)}/content`);
  assert.equal(unavailable.status, 409);
  assert.equal(unavailable.body.code, 'DOCUMENTS_RESULT_UNAVAILABLE');
  await page.goto(shown(original.documentId, { tab: 'processing', version: original.versionId }));
  await button('Request reprocessing').click();
  await button('Confirm reprocessing').waitFor();
  assert.equal(await page.getByRole('option', { name: 'Structured', exact: true }).count(), 0);
  setFault('documents-lose-reprocess');
  const lost = execution();
  await button('Confirm reprocessing').click();
  assert.equal((await lost).status(), 503);
  const queued = (await load(history)).items[0];
  assert.ok(queued);
  await page.reload();
  const retried = execution();
  await button('Retry saved reprocessing').click();
  assert.equal((await retried).status(), 200);
  assert.equal((await (await retried).json()).runId, queued.id);
  assert.equal((await load(history)).items.length, 1);
  assert.equal((await processSource(original)).state, 'SUCCEEDED');
  await button('Refresh processing').click();
  await page.getByText('Active result', { exact: true }).waitFor();
  await page.getByRole('link', { name: 'Open run 1 content', exact: true }).click();
  await page
    .getByText('Synthetic DV-I03 plain text through the real assessment path.', { exact: true })
    .waitFor();
  await clearRateLimits();
  await uploadCommand('documents-capacity');
  const replacement = await execute(await newIntent(reprocess(original)));
  assert.equal(replacement.status, 200);
  assert.notEqual(replacement.body.runId, queued.id);
  assert.equal((await processSource(original)).state, 'SUCCEEDED');
  const replaced = await load(history);
  assert.equal(replaced.activeRunId, replacement.body.runId);
  assert.equal(replaced.items.find((run) => run.id === queued.id)?.active, false);
  await page.goto(
    shown(original.documentId, { tab: 'content', version: original.versionId, run: queued.id }),
  );
  await page.getByText('Untrusted extracted data · Run 1', { exact: true }).waitFor();

  console.log(
    'Documents processing: actual CSV extraction, indexed English search and untrusted text',
  );
  const csvBytes = Buffer.from(
    'Item,Comment\nRegional orchards,"<script>plain text only</script>"\n',
  );
  const csv = await upload('dv-i07-register.csv', 'text/csv', csvBytes);
  assert.equal(csv.availability, 'AVAILABLE');
  const uploadStage = (label) =>
    page
      .getByText(label, { exact: true })
      .and(page.locator('dt'))
      .locator('xpath=following-sibling::dd');
  await uploadStage('Processing').getByText('queued', { exact: true }).waitFor();
  await uploadStage('Index').getByText('not indexed', { exact: true }).waitFor();
  assert.equal((await processSource(csv)).state, 'SUCCEEDED');
  await uploadStage('Processing').getByText('succeeded', { exact: true }).waitFor();
  await uploadStage('Index').getByText('ready', { exact: true }).waitFor();
  const csvBase = url(csv.documentId);
  const csvHistory = await load(`${csvBase}/processing`);
  assert.equal(csvHistory.indexStatus, 'READY');
  assert.equal(csvHistory.items[0].manifest.processor, 'csv');
  const {
    artifacts: [capability],
  } = await load(`${csvBase}/content`);
  const preflight = (source) =>
    page.request.fetch(capability.url, {
      method: 'OPTIONS',
      headers: {
        origin: source,
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'range',
      },
    });
  const acceptedOrigin = await preflight(origin);
  assert.equal(acceptedOrigin.status(), 204);
  assert.equal(acceptedOrigin.headers()['access-control-allow-origin'], origin);
  assert.equal(acceptedOrigin.headers()['access-control-allow-credentials'], undefined);
  assert.equal((await preflight('https://unregistered.fixture.test')).status(), 403);
  assert.equal((await request(`${csvBase}/content?versionId=${original.versionId}`)).status, 404);
  assert.equal(
    (await request(`${csvBase}/content?versionId=${csv.versionId}&runId=${queued.id}`)).status,
    404,
  );
  const query = new URLSearchParams({ q: 'regional orchard', fileName: 'dv-i07-register.csv' });
  const searched = await load(`/api/documents/search?${query}`);
  assert.equal(searched.items.length, 1, 'English text and exact filename match');
  assert.equal(searched.items[0].versionId, csv.versionId);
  assert.equal(searched.items[0].runId, csvHistory.activeRunId);
  assert.equal(searched.items[0].match.kind, 'cell');
  assert.equal(
    (await load('/api/documents/search?fileName=dv-i07-register.csv')).items[0].documentId,
    csv.documentId,
  );
  const csvDetail = await load(csvBase);
  assert.equal(
    (
      await execute(
        await newIntent({
          kind: 'document.edit',
          documentId: csv.documentId,
          expectedRevision: csvDetail.revision,
          payload: { metadata: { category: '' } },
        }),
      )
    ).status,
    200,
  );
  assert.deepEqual(
    (await load('/api/documents/search?metadataField=category&metadataValue=')).items.map(
      (item) => item.documentId,
    ),
    [csv.documentId],
  );
  await clearRateLimits();
  await page.goto(`${origin}/documents/search`);
  await page.getByLabel('Search extracted text', { exact: true }).fill('regional orchard');
  await button('Search').click();
  await page.getByRole('link', { name: /^Open matched cell/ }).click();
  await page.getByRole('cell', { name: '<script>plain text only</script>', exact: true }).waitFor();
  assert.equal(await page.locator('script').filter({ hasText: 'plain text only' }).count(), 0);

  console.log(
    'Documents processing: pinned OCR and failed replacement preserves accepted result and original',
  );
  const ocrBytes = await ocrFixture();
  const ocr = await upload('dv-i07-ocr.png', 'image/png', ocrBytes);
  const done = await processSource(ocr);
  assert.ok(['SUCCEEDED', 'PARTIAL'].includes(done.state));
  const ocrBase = url(ocr.documentId);
  const active = (await load(`${ocrBase}/processing`)).items[0];
  assert.equal(active.manifest.ocr.engineVersion, '5.5.4');
  await page.goto(shown(ocr.documentId, { tab: 'content' }));
  await page.getByRole('heading', { name: 'OCR detail', exact: true }).waitFor();
  await page.getByRole('cell', { name: 'Clear', exact: true }).first().waitFor();

  await clearRateLimits();
  await uploadCommand('documents-capacity');
  assert.equal((await execute(await newIntent(reprocess(ocr)))).status, 200);
  const conflict = await execute(await newIntent(reprocess(ocr)));
  assert.equal(conflict.status, 409);
  assert.equal(conflict.body.code, 'DOCUMENTS_PROCESSING_ACTIVE');
  assert.equal((await processSource(ocr, true)).state, 'FAILED');
  const first = await load(`${ocrBase}/processing?versionId=${ocr.versionId}&limit=1`);
  assert.equal(first.activeRunId, active.id);
  assert.equal(first.items[0].state, 'FAILED');
  assert.equal((await request(`${ocrBase}/content?runId=${first.items[0].id}`)).status, 409);
  assert.ok(first.nextCursor);
  const second = await load(
    `${ocrBase}/processing?versionId=${ocr.versionId}&limit=1&cursor=${encodeURIComponent(first.nextCursor)}`,
  );
  assert.equal(second.items[0].id, active.id);
  assert.equal(
    (await request(`${csvBase}/processing?cursor=${encodeURIComponent(first.nextCursor)}`)).status,
    400,
  );
  assert.equal((await load(`${ocrBase}/content`)).run.id, active.id);
  await page.goto(`${origin}/documents/${ocr.documentId}`);
  const downloaded = page.waitForEvent('download');
  await button('Download original').click();
  assert.deepEqual(await readFile(await (await downloaded).path()), ocrBytes);

  console.log('Documents processing: mixed PDF keeps partial coverage and searchable native text');
  const pdf = await upload(
    'dv-i07-mixed.pdf',
    'application/pdf',
    await ocrFixture('--partial-pdf'),
  );
  assert.equal((await processSource(pdf)).state, 'PARTIAL');
  const pdfBase = url(pdf.documentId);
  const partial = await load(`${pdfBase}/processing`);
  assert.equal(partial.indexStatus, 'PARTIAL');
  assert.deepEqual(partial.items[0].manifest.coverage, {
    attempted: 4,
    completed: 3,
    omitted: 0,
    ocrNeeded: 1,
  });
  await page.goto(shown(pdf.documentId, { tab: 'content' }));
  await page.getByText('Native text remains unchanged.', { exact: true }).waitFor();
  await page.getByText('Index partial', { exact: true }).waitFor();
  await page
    .getByText('3 completed · 4 attempted · 0 omitted · 1 need OCR', { exact: true })
    .waitFor();
  const searchPage = await load('/api/documents/search?limit=1');
  assert.ok(searchPage.nextCursor);
  const next = new URLSearchParams({ limit: '1', cursor: searchPage.nextCursor });
  assert.notEqual(
    (await load(`/api/documents/search?${next}`)).items[0].documentId,
    searchPage.items[0].documentId,
  );
  next.set('fileName', 'dv-i07-mixed.pdf');
  assert.equal((await request(`/api/documents/search?${next}`)).status, 400);

  console.log(
    'Documents processing: same-length artifact corruption and late transfer after deletion',
  );
  await clearRateLimits();
  const artifact = '**/dms-artifacts/**';
  const corrupt = async (route) => {
    const response = await route.fetch();
    const bytes = Buffer.from(await response.body());
    bytes[0] ^= 1;
    await route.fulfill({ response, body: bytes });
  };
  await page.route(artifact, corrupt, { times: 1 });
  await page.goto(shown(csv.documentId, { tab: 'content' }));
  await page
    .getByText('The extracted content could not be verified. Try loading it again.', {
      exact: true,
    })
    .waitFor();
  assert.equal(
    await page.getByRole('heading', { name: 'Extracted content', exact: true }).count(),
    0,
  );
  await button('Retry content').click();
  await page.getByRole('heading', { name: 'Extracted content', exact: true }).waitFor();

  let release;
  let requested;
  const waiting = new Promise((resolve) => {
    requested = resolve;
  });
  const held = new Promise((resolve) => {
    release = resolve;
  });
  await page.route(
    artifact,
    async (route) => {
      requested();
      await held;
      await route.continue();
    },
    { times: 1 },
  );
  try {
    await page.reload();
    await waiting;
    const current = await load(csvBase);
    assert.equal(
      (
        await execute(
          await newIntent({
            kind: 'document.delete',
            documentId: csv.documentId,
            expectedRevision: current.revision,
          }),
        )
      ).status,
      200,
    );
    assert.deepEqual((await load(`/api/documents/search?${query}`)).items, []);
  } finally {
    release();
  }
  await page
    .getByText('This document is unavailable with your current access.', { exact: true })
    .first()
    .waitFor();
  assert.equal(
    await page.getByRole('heading', { name: 'Extracted content', exact: true }).count(),
    0,
  );
  assert.equal((await request(`${csvBase}/content`)).status, 404);
  await clearRateLimits();
}
