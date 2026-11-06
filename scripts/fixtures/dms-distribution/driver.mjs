import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { setTimeout } from 'node:timers/promises';

const statePath = '/configuration/.qualification.json';
const state = JSON.parse(readFileSync(statePath, 'utf8'));
const origin = 'https://identity.dms.test',
  resource = `${origin}/v1`;
const check = (condition, label) => {
  if (!condition) throw new Error(label);
};
async function call(path, options = {}) {
  return fetch(path.startsWith('http') ? path : origin + path, {
    redirect: 'manual',
    signal: AbortSignal.timeout(30000),
    ...options,
  });
}
async function json(path, options, statuses = [200]) {
  const response = await call(path, options);
  check(
    statuses.includes(response.status),
    `Unexpected status ${response.status} for fixed fixture step`,
  );
  return response.json();
}
async function mail(purpose) {
  for (let count = 0; count < 30; count++) {
    const list = await json('http://mailpit:8025/api/v1/messages');
    const entry = list.messages.find(
      (item) =>
        item.Subject.includes(
          purpose === 'verify' ? 'Verify your account' : 'Reset your account',
        ) && item.To.some((to) => to.Address === state.operatorEmail),
    );
    if (entry) {
      const detail = await json(`http://mailpit:8025/api/v1/message/${entry.ID}`);
      const link = detail.Text.match(/https?:\/\/[^\s]+/)?.[0];
      check(link && new URL(link).origin === origin, 'Mail destination must remain canonical');
      return link;
    }
    await setTimeout(1000);
  }
  throw new Error('Expected captured Mailpit message');
}
async function token(credentials = state.consumer) {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    resource,
    scope: state.scopes.join(' '),
  });
  return json('/identity/oauth2/token', {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${credentials.clientId}:${credentials.clientSecret}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  });
}
async function authorized(path, body, extra = {}) {
  if (
    state.accessToken &&
    JSON.parse(Buffer.from(state.accessToken.split('.')[1], 'base64url')).exp * 1000 <
      Date.now() + 30000
  )
    state.accessToken = (await token()).access_token;
  return json(
    path,
    {
      method: body ? 'POST' : 'GET',
      headers: {
        authorization: `Bearer ${state.accessToken}`,
        ...(body ? { 'content-type': 'application/json', 'idempotency-key': randomUUID() } : {}),
        ...extra,
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    },
    [200, 201, 202],
  );
}
async function privateWork(role, path, body, statuses = [200]) {
  const e = Object.fromEntries(
    readFileSync(`/configuration/.env.work-${role}`, 'utf8')
      .split('\n')
      .flatMap((line) => {
        const i = line.indexOf('=');
        return i < 1 ? [] : [[line.slice(0, i), line.slice(i + 1)]];
      }),
  );
  const scope = role === 'publisher' ? 'dms:work:publish' : 'dms:work:scan';
  const grant = await json('/identity/oauth2/token', {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${e.DMS_WORK_CLIENT_ID}:${e.DMS_WORK_CLIENT_SECRET}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      resource: `${origin}/identity/services/work`,
      scope,
    }),
  });
  return json(
    `http://coordinator:3003/internal/work/${path}`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${grant.access_token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(body),
    },
    statuses,
  );
}
const mode = process.argv[2];
if (mode === 'verify') {
  const response = await call(await mail('verify'));
  check([200, 302].includes(response.status), 'Verification failed');
} else if (mode === 'discovery') {
  const discovery = await json('/identity/.well-known/openid-configuration');
  check(
    discovery.issuer === `${origin}/identity` &&
      discovery.token_endpoint === `${origin}/identity/oauth2/token`,
    'Canonical issuer mismatch',
  );
  for (const path of [
    '/internal/work/dispatches/claim',
    '/internal/work/presence',
    '/operator',
    '/identity/admin/list-users',
  ]) {
    const response = await call(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{}',
    });
    check([401, 403, 404].includes(response.status), 'Private route exposed');
  }
} else if (mode === 'golden' || mode === 'enroll') {
  const result = await token();
  state.accessToken = result.access_token;
  check(typeof state.accessToken === 'string', 'Missing access token');
  const header = JSON.parse(Buffer.from(state.accessToken.split('.')[0], 'base64url'));
  state.kid = header.kid;
  if (!state.enrolled)
    await authorized(
      '/v1/application-enrollments',
      { name: 'Distribution fixture' },
      { 'x-thaarei-enrollment-key': state.enrollment.enrollmentKey },
    );
  state.enrolled = true;
  if (mode === 'enroll') {
    writeFileSync(statePath, JSON.stringify(state), { mode: 0o600 });
    console.log(JSON.stringify({ fixture: mode, passed: true }));
    process.exit(0);
  }
  const capabilities = await authorized('/v1/capabilities');
  check(!capabilities.profiles.includes('structured'), 'Disabled optional profile advertised');
  const bytes = Buffer.from('DMS distribution canonical container verification alpha bravo.\n');
  state.sha256 = createHash('sha256').update(bytes).digest('hex');
  const begin = await authorized('/v1/uploads', {
    title: 'Distribution fixture',
    fileName: 'distribution.txt',
    contentType: 'text/plain',
    size: bytes.length,
    sha256: state.sha256,
    profile: 'searchable',
    metadata: {},
  });
  check(
    new URL(begin.transfer.url).origin === 'https://files.dms.test',
    'Unexpected transfer origin',
  );
  const put = await call(begin.transfer.url, {
    method: 'PUT',
    headers: { ...begin.transfer.headers, 'content-length': String(bytes.length) },
    body: bytes,
  });
  check(put.status === 200, 'Upload failed');
  await authorized(`/v1/uploads/${begin.session.id}/complete`, {});
  state.uploadId = begin.session.id;
  state.documentId = begin.session.documentId;
} else if (mode === 'structured') {
  const capabilities = await authorized('/v1/capabilities');
  check(capabilities.profiles.includes('structured'), 'Enabled optional profile missing');
  const content = 'BT /F1 20 Tf 50 700 Td (Distribution structure fixture) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(pdf));
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(pdf);
  pdf += `xref\n0 6\n0000000000 65535 f \n${offsets
    .slice(1)
    .map((offset) => `${String(offset).padStart(10, '0')} 00000 n `)
    .join('\n')}\ntrailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  const bytes = Buffer.from(pdf);
  const begin = await authorized('/v1/uploads', {
    title: 'Structured fixture',
    fileName: 'structure.pdf',
    contentType: 'application/pdf',
    size: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    profile: 'structured',
    metadata: {},
  });
  check(
    (
      await call(begin.transfer.url, {
        method: 'PUT',
        headers: { ...begin.transfer.headers, 'content-length': String(bytes.length) },
        body: bytes,
      })
    ).status === 200,
    'Structured upload failed',
  );
  await authorized(`/v1/uploads/${begin.session.id}/complete`, {});
  state.structuredDocumentId = begin.session.documentId;
} else if (mode === 'structured-result' || mode === 'profile-off') {
  if (mode === 'profile-off') {
    check(
      !(await authorized('/v1/capabilities')).profiles.includes('structured'),
      'Disabled optional profile advertised',
    );
  }
  const result = await authorized(`/v1/documents/${state.structuredDocumentId}/content`);
  check(
    result.run.profile === 'structured' &&
      result.run.manifest?.processor === 'docling' &&
      result.artifacts.length === 1,
    'Waiting for accepted structured content',
  );
  const artifact = await call(result.artifacts[0].url);
  check(
    artifact.status === 200 &&
      createHash('sha256')
        .update(Buffer.from(await artifact.arrayBuffer()))
        .digest('hex') === result.artifacts[0].sha256,
    'Accepted structure artifact mismatch',
  );
} else if (mode === 'available') {
  const session = await authorized(`/v1/uploads/${state.uploadId}`);
  check(session.upload === 'COMPLETED', 'Waiting for native assessment');
  state.documentId = session.documentId;
  const capability = await authorized(`/v1/documents/${state.documentId}/download`);
  if (!state.preRecoveryDownload) state.preRecoveryDownload = capability.url;
  const response = await call(capability.url, { headers: capability.headers });
  check(response.status === 200, 'Authorized download failed');
  check(
    createHash('sha256')
      .update(Buffer.from(await response.arrayBuffer()))
      .digest('hex') === state.sha256,
    'Immutable original mismatch',
  );
} else if (mode === 'recovery-history') {
  const response = await call(`/v1/documents/${state.documentId}`, {
      headers: { authorization: `Bearer ${state.accessToken}` },
    }),
    doc = await response.json();
  state.historyVersionId = doc.currentVersionId;
  state.historySha256 = state.sha256;
  const bytes = Buffer.from(
    'A second immutable historical DMS version for recovery verification.\n',
  );
  state.sha256 = createHash('sha256').update(bytes).digest('hex');
  const begin = await authorized(
    `/v1/documents/${state.documentId}/versions/uploads`,
    {
      title: doc.title,
      fileName: 'history.txt',
      contentType: 'text/plain',
      size: bytes.length,
      sha256: state.sha256,
      profile: 'searchable',
      metadata: doc.metadata,
    },
    { 'if-match': response.headers.get('etag') },
  );
  check(
    (
      await call(begin.transfer.url, {
        method: 'PUT',
        headers: begin.transfer.headers,
        body: bytes,
      })
    ).status === 200,
    'Historical upload failed',
  );
  await authorized(`/v1/uploads/${begin.session.id}/complete`, {});
  state.uploadId = begin.session.id;
} else if (mode === 'recovery-reference') {
  const response = await call(`/v1/documents/${state.documentId}`, {
    headers: { authorization: `Bearer ${state.accessToken}` },
  });
  const begin = await authorized(
    `/v1/documents/${state.documentId}/versions/${state.historyVersionId}/restore`,
    { profile: 'searchable' },
    { 'if-match': response.headers.get('etag') },
  );
  check(begin.transfer === null, 'Historical restore allocated new binary bytes');
  state.uploadId = begin.session.id;
  state.sha256 = state.historySha256;
} else if (mode === 'recovery-pending') {
  const bytes = Buffer.from('Pending upload recovered under a fresh PostgreSQL generation.\n');
  state.pendingHash = createHash('sha256').update(bytes).digest('hex');
  const begin = await authorized('/v1/uploads', {
    title: 'Pending recovery fixture',
    fileName: 'pending.txt',
    contentType: 'text/plain',
    size: bytes.length,
    sha256: state.pendingHash,
    profile: 'secure-only',
    metadata: {},
  });
  check(
    (
      await call(begin.transfer.url, {
        method: 'PUT',
        headers: begin.transfer.headers,
        body: bytes,
      })
    ).status === 200,
    'Pending upload failed',
  );
  await authorized(`/v1/uploads/${begin.session.id}/complete`, {});
  state.pendingUploadId = begin.session.id;
  state.pendingDocumentId = begin.session.documentId;
} else if (mode === 'recovery-envelope') {
  const deliveries = await privateWork('publisher', 'dispatches/claim', {});
  const item = deliveries.items.find((x) => x.dispatch.task === 'document.scan');
  check(item, 'Expected recoverable pending scan dispatch');
  state.staleRecoveryEnvelope = item.dispatch;
  state.recoveryKid = state.kid;
} else if (mode === 'recovery-pending-result') {
  const result = await privateWork(
    'scanner',
    'attempts/claim',
    state.staleRecoveryEnvelope,
    [200, 409],
  );
  check(
    ['stale', 'terminal'].includes(result.state) ||
      result.error?.code === 'WORK_STALE' ||
      result.code === 'WORK_STALE',
    'Old broker generation became executable',
  );
  const cap = await authorized(`/v1/documents/${state.pendingDocumentId}/download`);
  const response = await call(cap.url);
  check(
    response.status === 200 &&
      createHash('sha256')
        .update(Buffer.from(await response.arrayBuffer()))
        .digest('hex') === state.pendingHash,
    'Recovered pending original mismatch',
  );
} else if (mode === 'recovery-content') {
  const result = await authorized(`/v1/documents/${state.documentId}/content`);
  check(
    result.state === 'ready' ||
      result.state === 'COMPLETE' ||
      result.content !== undefined ||
      result.artifacts !== undefined,
    'Extraction content absent',
  );
  check(result.artifacts.length === 1, 'Accepted artifact absent');
  for (const artifact of result.artifacts) {
    const response = await call(artifact.url);
    check(
      response.status === 200 &&
        createHash('sha256')
          .update(Buffer.from(await response.arrayBuffer()))
          .digest('hex') === artifact.sha256,
      'Extraction artifact hash mismatch',
    );
  }
  state.recoveryContent = result;
  const versions = await authorized(`/v1/documents/${state.documentId}/versions`);
  check(versions.items.length >= 1, 'Version history absent');
  state.recoveryTitle = (await authorized(`/v1/documents/${state.documentId}`)).title;
} else if (mode === 'recovery-mutate') {
  const current = await call(`/v1/documents/${state.documentId}`, {
    headers: { authorization: `Bearer ${state.accessToken}` },
  });
  const body = await current.json();
  await json(`/v1/documents/${state.documentId}`, {
    method: 'PATCH',
    headers: {
      authorization: `Bearer ${state.accessToken}`,
      'content-type': 'application/json',
      'if-match': current.headers.get('etag'),
    },
    body: JSON.stringify({
      title: 'Changed after recovery point',
      metadata: body.metadata,
      tags: body.tags,
    }),
  });
} else if (mode === 'recovery-old-token') {
  const response = await call('/v1/capabilities', {
    headers: { authorization: `Bearer ${state.accessToken}` },
  });
  check(response.status === 401, 'Pre-recovery bearer token survived key epoch reset');
  check(
    (await call(state.preRecoveryDownload)).status === 403,
    'Pre-recovery storage capability survived recovery',
  );
} else if (mode === 'recovery-cohort') {
  const d = await authorized(`/v1/documents/${state.documentId}`);
  check(
    d.title !== 'Changed after recovery point',
    'A later source mutation crossed recovery point',
  );
  const versions = await authorized(`/v1/documents/${state.documentId}/versions`);
  check(versions.items.length === 3, 'Historical/restored identities were not recovered');
  const historical = await authorized(
    `/v1/documents/${state.documentId}/download?versionId=${state.historyVersionId}`,
  );
  const historicalResponse = await call(historical.url);
  check(
    historicalResponse.status === 200 &&
      createHash('sha256')
        .update(Buffer.from(await historicalResponse.arrayBuffer()))
        .digest('hex') === state.historySha256,
    'Shared historical original mismatch',
  );
  check(state.kid !== state.recoveryKid, 'Recovery retained the old JWT signing epoch');
  const content = await authorized(`/v1/documents/${state.documentId}/content`);
  assert.deepEqual(
    content.run.manifest,
    state.recoveryContent.run.manifest,
    'Restored extraction provenance changed',
  );
} else if (mode === 'recovery') {
  const signedIn = await call('/identity/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ email: state.operatorEmail, password: state.operatorPassword }),
  });
  check(signedIn.status === 200, 'Pre-recovery sign-in failed');
  const cookie = signedIn.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; ');
  await json('/identity/request-password-reset', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ email: state.operatorEmail, redirectTo: `${origin}/identity/ok` }),
  });
  const response = await call(await mail('reset'));
  check(response.status === 302, 'Recovery link failed');
  const target = new URL(response.headers.get('location'), origin);
  const resetToken = target.searchParams.get('token');
  check(resetToken, 'Missing recovery continuation');
  await json('/identity/reset-password', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ token: resetToken, newPassword: state.nextPassword }),
  });
  const old = await call('/identity/sign-in/email', {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ email: state.operatorEmail, password: state.operatorPassword }),
  });
  check(old.status === 401, 'Old password remained valid');
  const session = await json('/identity/get-session', { headers: { cookie } });
  check(session === null || session.session === null, 'Password reset did not revoke old session');
  state.operatorPassword = state.nextPassword;
} else if (mode === 'staged-key') {
  check(
    (await json('/identity/jwks')).keys.some((key) => key.kid === state.stagedKeyId),
    'Staged public key was not prepublished',
  );
  check(
    JSON.parse(Buffer.from((await token()).access_token.split('.')[0], 'base64url')).kid ===
      state.kid,
    'Staged key used before activation',
  );
} else if (mode === 'new-key') {
  const result = await token();
  check(
    JSON.parse(Buffer.from(result.access_token.split('.')[0], 'base64url')).kid ===
      state.stagedKeyId,
    'Activated key not selected',
  );
  // Previously issued token must remain verifiable within its bounded lifetime.
  await authorized('/v1/capabilities');
  state.accessToken = result.access_token;
} else if (mode === 'refresh') {
  state.accessToken = (await token()).access_token;
  state.kid = JSON.parse(Buffer.from(state.accessToken.split('.')[0], 'base64url')).kid;
} else if (mode === 'rotated') {
  const body = new URLSearchParams({
    grant_type: 'client_credentials',
    resource,
    scope: state.scopes.join(' '),
  });
  const response = await call('/identity/oauth2/token', {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${state.consumer.clientId}:${state.previousSecret}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
    body,
  });
  check(response.status >= 400, 'Rotated credential still accepted');
  state.accessToken = (await token()).access_token;
} else if (mode === 'revoked') {
  const response = await call('/v1/capabilities', {
    headers: { authorization: `Bearer ${state.accessToken}` },
  });
  check([401, 403].includes(response.status), 'Suspended consumer retained access');
} else if (mode === 'foundation') {
  check((await call('/health/ready/auth')).status === 200, 'Previous authority unavailable');
} else if (mode === 'ready' || mode === 'unready') {
  check((await call('/health/ready/api')).status === 200, 'API availability was lost');
  check(
    (await call('/health/ready/processing')).status === (mode === 'ready' ? 200 : 503),
    'Unexpected processing readiness',
  );
} else {
  assert.fail('Unsupported fixture mode');
}
writeFileSync(statePath, JSON.stringify(state), { mode: 0o600 });
console.log(JSON.stringify({ fixture: mode, passed: true }));
