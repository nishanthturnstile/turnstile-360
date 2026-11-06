// Independent Node-stdlib consumer. No application, database or workspace imports.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { setTimeout } from 'node:timers/promises';

const configPath = process.argv[2],
  out = process.argv[3];
assert.ok(configPath && out, 'Protected configuration and result paths required');
assert.equal(statSync(configPath).mode & 0o077, 0, 'Private configuration required');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const origin = new URL(config.resource).origin;
assert.equal(new URL(config.resource).pathname, '/v1');
assert.equal(new URL(config.issuer).origin, origin);
assert.equal(new URL(config.resource).protocol, 'https:');
const latency = { metadata: [], workloadMetadata: [], control: [] },
  errors = {},
  cache = new Map();
let renewals = 0,
  phase = 'initialize',
  backpressure = 0;
const hash = (b) => createHash('sha256').update(b).digest('hex');
const quantiles = (values) => {
  const a = [...values].sort((x, y) => x - y);
  return {
    count: a.length,
    p50: a[Math.max(0, Math.ceil(a.length * 0.5) - 1)] ?? 0,
    p95: a[Math.max(0, Math.ceil(a.length * 0.95) - 1)] ?? 0,
    max: a.at(-1) ?? 0,
  };
};
async function request(url, options = {}) {
  const target = new URL(url);
  assert.equal(target.origin, origin, 'Unexpected control origin');
  const start = performance.now();
  const r = await fetch(url, {
    ...options,
    redirect: 'manual',
    signal: AbortSignal.timeout(30000),
  });
  const bytes = Buffer.from(await r.arrayBuffer());
  assert.ok(bytes.length <= 1048576, 'Response bound');
  const category =
    (!options.method || options.method === 'GET') &&
    /^\/v1\/documents(?:\/[a-f0-9-]+)?$/.test(target.pathname)
      ? 'metadata'
      : 'control';
  const elapsed = performance.now() - start;
  latency[category].push(elapsed);
  if (phase === 'workload' && category === 'metadata') latency.workloadMetadata.push(elapsed);
  if (!r.ok) errors[r.status] = (errors[r.status] ?? 0) + 1;
  return { status: r.status, headers: r.headers, body: bytes.length ? JSON.parse(bytes) : null };
}
async function token(who, force = false) {
  const old = cache.get(who);
  if (!force && old && old.until > Date.now() + 10000) return old.value;
  const c = config.consumers[who];
  const r = await request(`${config.issuer}/oauth2/token`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${c.clientId}:${c.clientSecret}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      resource: config.resource,
      scope: c.scopes.join(' '),
    }),
  });
  assert.equal(r.status, 200);
  assert.ok(r.body.expires_in <= 300);
  cache.set(who, { value: r.body.access_token, until: Date.now() + r.body.expires_in * 1000 });
  renewals++;
  return r.body.access_token;
}
async function api(
  who,
  path,
  { method = 'GET', body, etag, key = randomUUID(), statuses = [200], extra = {} } = {},
) {
  const headers = {
    authorization: `Bearer ${await token(who)}`,
    ...(body === undefined ? {} : { 'content-type': 'application/json', 'idempotency-key': key }),
    ...(etag ? { 'if-match': etag } : {}),
    ...extra,
  };
  const r = await request(config.resource + path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  assert.ok(statuses.includes(r.status), `Unexpected control status ${r.status} during ${phase}`);
  return r;
}
async function download(who, id, expected, version = '') {
  const r = await api(who, `/documents/${id}/download${version ? `?versionId=${version}` : ''}`);
  const target = new URL(r.body.url);
  assert.equal(target.origin, config.transferOrigin);
  const response = await fetch(target, {
    headers: r.body.headers,
    redirect: 'error',
    signal: AbortSignal.timeout(30000),
  });
  assert.equal(response.status, 200);
  assert.equal(hash(Buffer.from(await response.arrayBuffer())), expected);
}
async function upload(file, { document, restoreVersion } = {}) {
  const bytes = readFileSync(file.path),
    expected = hash(bytes),
    descriptor = {
      title: file.name,
      fileName: file.name,
      contentType: file.contentType,
      size: bytes.length,
      sha256: expected,
      profile: file.profile,
      metadata: { category: 'qualification' },
    };
  let path = '/uploads',
    etag;
  if (document) {
    const current = await api('A', `/documents/${document}`);
    etag = current.headers.get('etag');
    descriptor.title = current.body.title;
    descriptor.metadata = current.body.metadata;
    path = `/documents/${document}/versions/uploads`;
  }
  if (restoreVersion) path = `/documents/${document}/versions/${restoreVersion}/restore`;
  const key = randomUUID();
  let r;
  const until = Date.now() + 180000;
  do {
    r = await api('A', path, {
      method: 'POST',
      body: restoreVersion ? { profile: file.profile } : descriptor,
      etag,
      key,
      statuses: [201, 202, 409, 429, 503],
    });
    if ([201, 202].includes(r.status)) break;
    assert.ok(
      r.body.retryable ||
        ['CAPACITY_EXCEEDED', 'CAPACITY_UNAVAILABLE', 'ADMISSION_IN_PROGRESS'].includes(
          r.body.code,
        ),
      'Non-retryable admission',
    );
    backpressure++;
    await setTimeout(2000);
  } while (Date.now() < until);
  assert.ok([201, 202].includes(r.status), 'Admission deadline');
  const value = r.body;
  if (!restoreVersion) {
    assert.equal(new URL(value.transfer.url).origin, config.transferOrigin);
    const put = await fetch(value.transfer.url, {
      method: 'PUT',
      headers: value.transfer.headers,
      body: bytes,
      redirect: 'error',
      signal: AbortSignal.timeout(30000),
    });
    assert.equal(put.status, 200);
    await api('A', `/uploads/${value.session.id}/complete`, {
      method: 'POST',
      body: {},
      statuses: [200, 202],
    });
  }
  const started = performance.now(),
    result = {
      documentId: value.session.documentId,
      versionId: value.session.versionId,
      uploadId: value.session.id,
      sha256: expected,
      class: file.class,
      bytes: bytes.length,
      pages: file.pages,
      profile: file.profile,
    };
  const deadline = Date.now() + 900000;
  let available = false;
  while (Date.now() < deadline) {
    const session = (await api('A', `/uploads/${result.uploadId}`)).body;
    assert.ok(!['FAILED', 'CANCELLED', 'EXPIRED'].includes(session.upload), 'Upload failed');
    if (!available && session.upload === 'COMPLETED') {
      await download('A', result.documentId, expected);
      result.availabilityMs = performance.now() - started;
      available = true;
    }
    if (available) {
      // Measure ordinary authorized metadata reads while the declared workload is active.
      await api('A', `/documents/${result.documentId}`);
      const history = (
        await api('A', `/documents/${result.documentId}/processing?versionId=${result.versionId}`)
      ).body;
      const run = history.items.find((x) => x.active);
      if (run && ['SUCCEEDED', 'PARTIAL', 'FAILED', 'UNSUPPORTED'].includes(run.state)) {
        assert.ok(
          (file.allowedStatuses ?? ['SUCCEEDED']).includes(run.state),
          'Unexpected extraction outcome',
        );
        result.outcome = run.state;
        result.processingMs = performance.now() - started;
        result.processingRunMs = Date.parse(run.completedAt) - Date.parse(run.createdAt);
        if (['READY', 'PARTIAL'].includes(run.indexStatus)) {
          if (run.state === 'SUCCEEDED') assert.equal(run.indexStatus, 'READY');
          result.completionToIndexMs = performance.now() - started;
          result.indexLagMs = Math.max(0, Date.now() - Date.parse(run.completedAt));
          break;
        }
      }
    }
    await setTimeout(2000);
  }
  assert.ok(result.indexLagMs !== undefined, 'Processing/index deadline');
  return result;
}
try {
  for (const who of ['A', 'B']) {
    phase = 'enrollment';
    const c = config.consumers[who];
    await api(who, '/application-enrollments', {
      method: 'POST',
      body: { name: c.name },
      key: randomUUID(),
      statuses: [200, 201],
      extra: { 'x-thaarei-enrollment-key': c.enrollmentKey },
    });
  }
  phase = 'workload';
  const began = performance.now(),
    results = [];
  let index = 0;
  // Four-file initial burst, then bounded arrivals at the declared normal rate.
  const jobs = new Set();
  for (const file of config.files) {
    while (jobs.size >= 4) await Promise.race(jobs);
    if (index++ >= 4) await setTimeout(config.interarrivalMs);
    const job = upload(file)
      .then((r) => results.push(r))
      .finally(() => jobs.delete(job));
    jobs.add(job);
    job.catch(() => {});
  }
  await Promise.all(jobs);
  const wallSeconds = (performance.now() - began) / 1000;
  const file = config.files.find((f) => f.class === 'text-small');
  const first = results.find((r) => r.sha256 === hash(readFileSync(file.path)));
  assert.ok(first);
  phase = 'format-families';
  const formatOutcomes = [];
  for (const file of config.formatCases ?? []) {
    phase = `format-families:${file.name}`;
    console.log(JSON.stringify({ formatCase: file.name }));
    const r = await upload(file);
    const content = (await api('A', `/documents/${r.documentId}/content`)).body;
    assert.ok(content.untrusted && content.artifacts.length > 0);
    for (const artifact of content.artifacts) {
      assert.equal(new URL(artifact.url).origin, config.transferOrigin);
      const body = Buffer.from(
        await (
          await fetch(artifact.url, { redirect: 'error', signal: AbortSignal.timeout(30000) })
        ).arrayBuffer(),
      );
      assert.equal(hash(body), artifact.sha256);
    }
    formatOutcomes.push({
      file: file.name,
      contentType: file.contentType,
      outcome: r.outcome,
      originalHashVerified: true,
      artifactHashVerified: true,
      processor: content.run.manifest.processor,
    });
  }
  phase = 'access';
  await api('B', `/documents/${first.documentId}`, { statuses: [404] });
  const search = await api('B', '/search', { method: 'POST', body: { q: 'qualifytoken' } });
  assert.ok(!search.body.items.some((x) => x.documentId === first.documentId));
  const permissions = async (grants) => {
    const current = await api('A', `/documents/${first.documentId}`);
    return api('A', `/documents/${first.documentId}/permissions`, {
      method: 'PUT',
      body: { grants },
      etag: current.headers.get('etag'),
    });
  };
  await permissions([{ applicationId: config.consumers.B.applicationId, rights: ['READ'] }]);
  await api('B', `/documents/${first.documentId}`);
  await download('B', first.documentId, first.sha256);
  await api('B', `/documents/${first.documentId}/versions`);
  await api('B', `/documents/${first.documentId}/content`);
  const b = await api('B', `/documents/${first.documentId}`);
  await api('B', `/documents/${first.documentId}`, {
    method: 'PATCH',
    body: { title: 'forbidden' },
    etag: b.headers.get('etag'),
    statuses: [404],
  });
  await permissions([
    { applicationId: config.consumers.B.applicationId, rights: ['READ', 'EDIT_METADATA'] },
  ]);
  const before = await api('B', `/documents/${first.documentId}`);
  await api('B', `/documents/${first.documentId}`, {
    method: 'PATCH',
    body: {
      tags: ['qualified'],
      metadata: { category: 'qualification' },
      title: 'Independent HTTP verification',
    },
    etag: before.headers.get('etag'),
  });
  let current = await api('A', `/documents/${first.documentId}`);
  const linked = await api('A', `/documents/${first.documentId}/references`, {
    method: 'POST',
    body: { namespace: 'independent', type: 'record', externalId: 'record-1' },
    etag: current.headers.get('etag'),
  });
  const ref = linked.body.references.find((x) => x.externalId === 'record-1');
  assert.ok(ref);
  current = await api('A', `/documents/${first.documentId}`);
  await api('A', `/documents/${first.documentId}/references/${ref.id}`, {
    method: 'DELETE',
    etag: current.headers.get('etag'),
  });
  await permissions([]);
  await api('B', `/documents/${first.documentId}`, { statuses: [404] });
  phase = 'versions';
  await upload(file, { document: first.documentId });
  await upload(file, { document: first.documentId, restoreVersion: first.versionId });
  assert.equal((await api('A', `/documents/${first.documentId}/versions`)).body.items.length, 3);
  phase = 'lifecycle';
  current = await api('A', `/documents/${first.documentId}`);
  await api('A', `/documents/${first.documentId}`, {
    method: 'DELETE',
    etag: current.headers.get('etag'),
  });
  await api('A', `/documents/${first.documentId}/download`, { statuses: [404, 409] });
  const life = await api('A', `/documents/${first.documentId}/lifecycle`);
  await api('A', `/documents/${first.documentId}/restore`, {
    method: 'POST',
    body: {},
    etag: life.headers.get('etag'),
    statuses: [200, 202],
  });
  const deadline = Date.now() + 180000;
  while (Date.now() < deadline) {
    const l = (await api('A', `/documents/${first.documentId}/lifecycle`)).body;
    if (l.downloadable) break;
    await setTimeout(2000);
  }
  await download('A', first.documentId, first.sha256);
  phase = 'renewal';
  await token('A', true);
  await api('A', '/capabilities');
  assert.ok(renewals >= 3);
  const classes = {};
  for (const r of results) {
    classes[r.class] ??= {
      documents: 0,
      pages: 0,
      bytes: 0,
      availabilityMs: [],
      processingMs: [],
      indexLagMs: [],
      completionToIndexMs: [],
      processingRunMs: [],
    };
    const c = classes[r.class];
    c.documents++;
    c.pages += r.pages;
    c.bytes += r.bytes;
    for (const key of [
      'availabilityMs',
      'processingMs',
      'indexLagMs',
      'completionToIndexMs',
      'processingRunMs',
    ])
      c[key].push(r[key]);
  }
  for (const c of Object.values(classes))
    for (const key of [
      'availabilityMs',
      'processingMs',
      'indexLagMs',
      'completionToIndexMs',
      'processingRunMs',
    ])
      c[key] = quantiles(c[key]);
  const metadata = quantiles(latency.workloadMetadata);
  assert.ok(metadata.count >= 20, 'Insufficient metadata samples');
  writeFileSync(
    out,
    `${JSON.stringify({ schemaVersion: 1, passed: true, transport: 'independent Node stdlib over canonical HTTPS; no workspace/database/operator imports', mix: config.mix, documents: results.length, wallSeconds, observedDocumentsPerMinute: (results.length / wallSeconds) * 60, metadataMs: metadata, controlMs: quantiles(latency.control), metadataP95Under300Ms: metadata.p95 < 300, backpressure, observedHttpStatuses: errors, tokenRenewals: renewals, classes, formatOutcomes, unexpectedErrors: 0, journey: ['two independent enrollments', 'default isolation', 'read sharing', 'metadata rights and references', 'grant revocation', 'three-version history and shared binary restore', 'delete/logical restore', 'token renewal'], capacityClaim: 'Bounded synthetic sample only; does not prove sustained 200,000 documents/month or customer-target acceptance.' }, null, 2)}\n`,
    { mode: 0o600, flag: 'wx' },
  );
  console.log(
    JSON.stringify({
      independentConsumer: 'passed',
      documents: results.length,
      metadataSamples: metadata.count,
    }),
  );
} catch (error) {
  const locations = [...(error.stack ?? '').matchAll(/consumer\.mjs:(\d+):\d+/g)];
  console.error(
    JSON.stringify({
      independentConsumer: 'failed',
      phase,
      sourceLines: locations.slice(0, 5).map((m) => Number(m[1])),
      controlFailure: /^Unexpected control status \d+ during /.test(error.message ?? '')
        ? error.message
        : null,
    }),
  );
  process.exitCode = 1;
}
