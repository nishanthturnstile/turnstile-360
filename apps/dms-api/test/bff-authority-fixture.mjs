// Separate-process fixture: consumers use HTTP and private fixture IPC, never DMS imports.
import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { Pool } from 'pg';
import { createApplication } from '../dist/bootstrap.js';
import { withTenant } from '../dist/infrastructure/database/postgres.js';
import { SecurityTelemetryService } from '../dist/infrastructure/security-telemetry.service.js';
import { withOperatorRead } from '../dist/modules/access/operator-context.js';
import {
  disableApplication,
  issueEnrollmentKey,
  registerApplication,
  setApplicationScopes,
} from '../dist/modules/enrollment/enrollment-operator.js';
import { restoreLifecycleVersions } from '../dist/modules/lifecycle/lifecycle-restoration.js';
import { AuthorityService } from '../dist/modules/platform-auth/authority/authority.service.js';
import { manageOAuthClient } from '../dist/modules/platform-auth/manage-client.js';
import { provisionUser } from '../dist/modules/platform-auth/provision-user.js';
import { createRecoveryDelivery } from '../dist/modules/platform-auth/recovery-delivery.js';
import { selectRestores } from '../dist/modules/processing/restore-discovery.js';
import {
  selectCandidates,
  settleAbandonedUploads,
  settleCandidates,
} from '../dist/modules/processing/security-publication.js';
import { discoverUploads } from '../dist/modules/processing/upload-discovery.js';
import { WorkService } from '../dist/modules/processing/work.service.js';
import { StorageService } from '../dist/modules/storage/storage.service.js';
import { observeCapacity } from '../dist/modules/uploads/admission-maintenance.js';
import { operatorAdmissionPolicy } from '../dist/modules/uploads/admission-operator.js';
import { createWorkApplication } from '../dist/work-bootstrap.js';
import { assessmentDaemonFixture } from './assessment-daemon-fixture.ts';
import { smtpFixture } from './smtp-fixture.ts';
import { uploadStorageFixture } from './upload-storage-fixture.ts';
import { workBrokerFixture } from './work-broker-fixture.ts';

const smtp = process.env.AUTH_BROWSER_MAILPIT_URL
  ? {
      port: process.env.AUTH_SMTP_PORT,
      async link(purpose, email) {
        const base = process.env.AUTH_BROWSER_MAILPIT_URL;
        let message;
        for (let attempt = 0; attempt < 50 && !message; attempt++) {
          const list = await (await fetch(`${base}/api/v1/messages`)).json();
          message = list.messages.find(
            (value) =>
              value.Subject.includes(
                purpose === 'verify' ? 'Verify your account' : 'Reset your account',
              ) && value.To.some((recipient) => recipient.Address === email),
          );
          if (!message) await new Promise((done) => setTimeout(done, 100));
        }
        if (!message) throw new Error('Missing fixture mail');
        const detail = await (await fetch(`${base}/api/v1/message/${message.ID}`)).json();
        const link = detail.Text.match(/https?:\/\/[^\s]+/)?.[0];
        if (!link) throw new Error('Missing fixture link');
        return new URL(link);
      },
      async close() {},
    }
  : await smtpFixture();
if (process.env.AUTH_BROWSER_MAILPIT_URL)
  process.on('uncaughtException', (error) => {
    const candidate = error.body?.code ?? error.code;
    const code =
      typeof candidate === 'string' && /^[A-Z0-9_]{1,64}$/.test(candidate) ? candidate : 'UNKNOWN';
    if (process.env.AUTH_BROWSER_DIAGNOSTIC_FILE)
      writeFileSync(
        process.env.AUTH_BROWSER_DIAGNOSTIC_FILE,
        JSON.stringify({
          name: error.name,
          message: error.message,
          cause: String(error.cause),
          stack: error.stack,
        }),
        { mode: 0o600 },
      );
    process.send?.({ diagnostic: `${error.name} ${code}` });
    process.exit(1);
  });
process.env.AUTH_SMTP_PORT = String(smtp.port);
process.env.AUTH_LOGIN_CLIENT_ID = 'bff-fixture-login';
process.env.DMS_MACHINE_CLIENT_ID = 'bff-fixture-machine';
const owner = new Pool({ connectionString: process.env.AUTH_MIGRATION_DATABASE_URL });
const dmsOwner = new Pool({ connectionString: process.env.DMS_MIGRATION_DATABASE_URL });
let storage, privateApp, scanner, scannerClient;
if (process.env.AUTH_BROWSER_DOCUMENTS_UPLOAD === 'true') {
  storage = await uploadStorageFixture({
    root: process.cwd(),
    browserOrigin: process.env.AUTH_PUBLIC_ORIGIN,
    tls: {
      cert: readFileSync(process.env.NODE_EXTRA_CA_CERTS),
      key: readFileSync(process.env.AUTH_BROWSER_TRANSFER_KEY_FILE),
    },
  });
  Object.assign(process.env, storage.environment);
  process.env.DMS_WORK_ISSUER_URL = process.env.AUTH_ISSUER_URL;
}
const app = await createApplication(false);
process.send?.({ phase: 'initialize authority' });
await app.init();
if (process.env.AUTH_BROWSER_MAILPIT_URL) app.get(SecurityTelemetryService).enable(true);
const authority = app.get(AuthorityService);
const config = authority.config;
const auth = authority.auth;
if (!config || !auth) throw new Error('Authority fixture configuration missing');
// Mailpit HTTP readiness can precede its STARTTLS listener. Verify the real production
// transport before creating any account; never retry partially committed provisioning.
if (process.env.AUTH_BROWSER_MAILPIT_URL) {
  process.send?.({ phase: 'verify SMTP readiness' });
  const delivery = createRecoveryDelivery(config);
  for (let attempt = 0; ; attempt++) {
    try {
      await delivery.verify();
      break;
    } catch (error) {
      if (attempt === 29) throw error;
      await new Promise((done) => setTimeout(done, 100));
    }
  }
}
const password = randomBytes(24).toString('base64url');
const users = {};
process.send?.({ phase: 'provision verified users' });
for (const [label, role] of [
  ['operator', 'admin'],
  ['member', 'user'],
  ['reset', 'user'],
  ['suspended', 'user'],
]) {
  const email = `bff-${label}@example.test`;
  const user = await provisionUser(
    auth,
    { email, name: label, role, password },
    config.AUTH_PUBLIC_ORIGIN,
  );
  process.send?.({ phase: 'read verification email' });
  const link = await smtp.link('verify', email);
  process.send?.({ phase: 'verify captured email' });
  const response = await app.inject({ method: 'GET', url: link.pathname + link.search });
  process.send?.({ phase: `verification status ${response.statusCode}` });
  if (response.statusCode !== 302) throw new Error('Fixture verification failed');
  users[label] = { id: user.id, email };
}
if (process.env.AUTH_BROWSER_MAILPIT_URL) {
  process.send?.({ phase: 'provision unverified account' });
  const email = 'bff-unverified@example.test';
  const user = await provisionUser(
    auth,
    { email, name: 'unverified', role: 'user', password },
    config.AUTH_PUBLIC_ORIGIN,
  );
  users.unverified = { id: user.id, email };
}
process.send?.({ phase: 'private administrator login' });
const signedIn = await auth.api.signInEmail({
  body: { email: users.operator.email, password },
  returnHeaders: true,
});
const operator = new Headers({
  origin: config.AUTH_PUBLIC_ORIGIN,
  cookie: signedIn.headers
    .getSetCookie()
    .map((value) => value.split(';')[0])
    .join('; '),
});
process.send?.({ phase: 'issue managed clients' });
const login = await manageOAuthClient(auth, config, operator, {
  kind: 'login',
  action: 'issue',
  applicationId: process.env.TURNSTILE_APPLICATION_ID,
});
const applicationId = process.env.TURNSTILE_APPLICATION_ID;
const documentsMode = process.env.AUTH_BROWSER_DOCUMENTS === 'true';
const documentsFixtureId = documentsMode ? randomUUID() : undefined;
const machineScopes = documentsMode
  ? ['dms:capabilities:read', 'dms:documents:read', 'dms:documents:write', 'dms:audit:read']
  : ['dms:capabilities:read'];
process.send?.({ phase: 'login client issued' });
const machine = await manageOAuthClient(auth, config, operator, {
  kind: 'machine',
  action: 'issue',
  applicationId,
  scopes: machineScopes,
});
const identityClient = config.IDENTITY_SERVICE_CLIENT_ID
  ? await manageOAuthClient(auth, config, operator, {
      kind: 'identity_service',
      action: 'issue',
      applicationId,
      scopes: ['identity:invitation:prepare', 'identity:subjects:read'],
    })
  : undefined;
const context = {
  tenantId: config.INSTALLATION_TENANT_ID,
  deploymentId: config.DMS_RESOURCE_URL,
  issuer: config.AUTH_ISSUER_URL,
};
process.send?.({ phase: 'machine client issued' });
await registerApplication(
  dmsOwner,
  context,
  {
    applicationId,
    clientId: machine.record.clientId,
    name: 'BFF fixture',
    scopes: machineScopes,
  },
  machine.record,
);
if (storage) {
  await withTenant(dmsOwner, context.tenantId, async (db) => {
    await db.query('INSERT INTO dms.operator_authorization(tenant_id,subject_id) VALUES($1,$2)', [
      context.tenantId,
      users.operator.id,
    ]);
  });
  await withOperatorRead(
    process.env,
    context.tenantId,
    config.INSTALLATION_CUSTOMER_KEY,
    users.operator.id,
    (tx) =>
      operatorAdmissionPolicy(tx, {
        action: 'admission-policy-set',
        expectedRevision: '0',
        policy: {
          enabled: true,
          storageBudgetBytes: 1073741824,
          applicationBudgetBytes: 536870912,
          scratchBudgetBytes: 536870912,
          maxFileBytes: 1048576,
          activePerApplication: 4,
          activePerTenant: 8,
          queuedWork: 20,
          profiles: ['secure-only'],
          contentTypes: ['text/plain'],
        },
      }),
    'full',
  );
  privateApp = await createWorkApplication();
  await privateApp.init();
  scannerClient = await manageOAuthClient(auth, config, operator, {
    action: 'issue',
    kind: 'work_scanner',
    clientId: 'documents-fixture-scanner',
    applicationId: randomUUID(),
    scopes: ['dms:work:scan'],
  });
  await withTenant(dmsOwner, context.tenantId, async (db) => {
    await db.query(
      "INSERT INTO dms.work_identity (id,tenant_id,issuer,client_id,role,enabled) VALUES ($1,$2,$3,$4,'scanner',true)",
      [randomUUID(), context.tenantId, context.issuer, scannerClient.record.clientId],
    );
  });
}
const enrollment = await issueEnrollmentKey(dmsOwner, context, applicationId);
process.send?.({ phase: 'enrollment key issued' });
await app.listen(0, '127.0.0.1');
const address = app.getHttpAdapter().getInstance().server.address();
const lifecycleMode = process.env.AUTH_BROWSER_DOCUMENTS_LIFECYCLE === 'true';
const processingMode = process.env.AUTH_BROWSER_DOCUMENTS_PROCESSING === 'true';
const fixtureOwnerId = lifecycleMode ? randomUUID() : undefined;
const sharedDocumentId = lifecycleMode ? randomUUID() : undefined;
const expiredDocumentId = lifecycleMode ? randomUUID() : undefined;
const authorityOrigin = `http://127.0.0.1:${address.port}`;
let processingBroker, processingWorkerEnvironment;
async function setupProcessing() {
  await withOperatorRead(
    process.env,
    context.tenantId,
    config.INSTALLATION_CUSTOMER_KEY,
    users.operator.id,
    (tx) =>
      operatorAdmissionPolicy(tx, {
        action: 'admission-policy-set',
        expectedRevision: '1',
        policy: {
          enabled: true,
          storageBudgetBytes: 1073741824,
          applicationBudgetBytes: 536870912,
          scratchBudgetBytes: 2147483648,
          maxFileBytes: 1048576,
          activePerApplication: 4,
          activePerTenant: 8,
          queuedWork: 20,
          profiles: ['secure-only', 'searchable'],
          contentTypes: ['text/plain', 'text/csv', 'image/png', 'application/pdf'],
        },
      }),
    'full',
  );
  await privateApp.listen(0, '127.0.0.1');
  const privateOrigin = await privateApp.getUrl();
  processingBroker = await workBrokerFixture(process.cwd());
  const environments = {};
  for (const [role, scope] of [
    ['publisher', 'dms:work:publish'],
    ['extractor', 'dms:work:extract'],
    ['heavy', 'dms:work:heavy'],
  ]) {
    const client = await manageOAuthClient(auth, config, operator, {
      action: 'issue',
      kind: `work_${role}`,
      clientId: `documents-fixture-${role}`,
      applicationId: randomUUID(),
      scopes: [scope],
    });
    await withTenant(dmsOwner, context.tenantId, (db) =>
      db.query(
        'INSERT INTO dms.work_identity (id,tenant_id,issuer,client_id,role,enabled) VALUES ($1,$2,$3,$4,$5,true)',
        [randomUUID(), context.tenantId, context.issuer, client.record.clientId, role],
      ),
    );
    environments[role] = {
      DMS_WORK_ROLE: role,
      DMS_WORK_API_URL: `${privateOrigin}/internal/work`,
      DMS_WORK_TOKEN_URL: `${authorityOrigin}/identity/oauth2/token`,
      DMS_WORK_CLIENT_ID: client.record.clientId,
      DMS_WORK_CLIENT_SECRET: client.secret,
      DMS_WORK_ISSUER_URL: config.AUTH_ISSUER_URL,
      SSL_CERT_FILE: process.env.NODE_EXTRA_CA_CERTS,
    };
  }
  processingWorkerEnvironment = environments;
}

async function processFixtureUpload(uploadId, failure) {
  const work = privateApp.get(WorkService);
  const native = processingBroker.worker(processingWorkerEnvironment.extractor, 'production');
  const heavy = processingBroker.worker(
    {
      ...processingWorkerEnvironment.heavy,
      ...(failure
        ? { DMS_OCR_HOME: resolve('apps/dms-processing/tests/nonexistent-runtime') }
        : {}),
    },
    'production',
  );
  try {
    let published = false;
    for (let step = 0; step < 80; step++) {
      const run = await work.internal(
        async (tx) =>
          (
            await tx.client.query(
              'SELECT id, state, active FROM dms.processing_run WHERE upload_id=$1 ORDER BY number DESC LIMIT 1',
              [uploadId],
            )
          ).rows[0],
      );
      if (
        run &&
        ['SUCCEEDED', 'PARTIAL', 'FAILED', 'UNSUPPORTED', 'CANCELLED'].includes(run.state)
      ) {
        await settleCandidates(work);
        return run;
      }
      if (!published || step % 4 === 0) {
        await work.internal((tx) => observeCapacity(tx, tmpdir(), tmpdir()));
        await processingBroker.python(
          ['turnstile-processing', 'publisher-once'],
          processingWorkerEnvironment.publisher,
        );
        published = true;
      }
      await new Promise((done) => setTimeout(done, 500));
    }
    throw new Error('Processing fixture did not reach a terminal state');
  } finally {
    await Promise.all([native.stop(), heavy.stop()]);
  }
}
let ownerClient;
async function machineAccess(client, scopes) {
  const response = await fetch(`${authorityOrigin}/identity/oauth2/token`, {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${client.record.clientId}:${client.secret}`).toString('base64')}`,
    },
    body: new URLSearchParams({
      grant_type: 'client_credentials',
      resource: config.DMS_RESOURCE_URL,
      scope: scopes.join(' '),
    }),
  });
  if (!response.ok)
    throw Object.assign(new Error('Fixture machine proof unavailable'), {
      code: `FIXTURE_MACHINE_${response.status}`,
    });
  return (await response.json()).access_token;
}
async function ownerCall(path, method = 'GET', payload, revision) {
  const response = await fetch(`${authorityOrigin}/v1${path}`, {
    method,
    headers: {
      authorization: `Bearer ${await machineAccess(ownerClient, machineScopes)}`,
      ...(payload ? { 'content-type': 'application/json' } : {}),
      ...(revision ? { 'if-match': `"${revision}"` } : {}),
    },
    ...(payload ? { body: JSON.stringify(payload) } : {}),
  });
  return { status: response.status, body: await response.json() };
}
async function prepareFixtureOwner() {
  process.send?.({ phase: 'issue independent owner client' });
  ownerClient = await manageOAuthClient(auth, config, operator, {
    kind: 'machine',
    action: 'issue',
    clientId: 'documents-owner-fixture',
    applicationId: fixtureOwnerId,
    scopes: machineScopes,
  });
  await registerApplication(
    dmsOwner,
    context,
    {
      applicationId: fixtureOwnerId,
      clientId: ownerClient.record.clientId,
      name: 'Independent fixture owner',
      scopes: machineScopes,
    },
    ownerClient.record,
  );
  const key = await issueEnrollmentKey(dmsOwner, context, fixtureOwnerId);
  process.send?.({ phase: 'enroll independent owner client' });
  const enrolled = await fetch(`${authorityOrigin}/v1/application-enrollments`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${await machineAccess(ownerClient, ['dms:capabilities:read'])}`,
      'x-thaarei-enrollment-key': key.key,
      'idempotency-key': key.keyId,
      'content-type': 'application/json',
    },
    body: JSON.stringify({ name: 'Independent fixture owner' }),
  });
  if (enrolled.status !== 201)
    throw Object.assign(new Error('Fixture owner enrollment failed'), {
      code: `FIXTURE_ENROLL_${enrolled.status}`,
    });
  process.send?.({ phase: 'seed independent owner document' });
  await withTenant(dmsOwner, context.tenantId, async (db) => {
    await db.query(
      `INSERT INTO dms.document(id,tenant_id,application_id,title,file_name,metadata)
       VALUES($1,$2,$3,'Fixture owner document','owner.txt','{"source":"owner"}'),
             ($4,$2,$5,'Restore deadline fixture','expiry.txt','{}')`,
      [sharedDocumentId, context.tenantId, fixtureOwnerId, expiredDocumentId, applicationId],
    );
  });
  process.send?.({ phase: 'link independent owner reference' });
  const link = await ownerCall(
    `/documents/${sharedDocumentId}/references`,
    'POST',
    {
      namespace: 'records',
      type: 'case',
      externalId: 'synthetic-42',
    },
    '1',
  );
  if (link.status !== 200)
    throw Object.assign(new Error('Fixture owner reference unavailable'), {
      code: `FIXTURE_REFERENCE_${link.status}`,
    });
}
process.send?.({
  ready: true,
  port: address.port,
  password,
  users,
  loginSecret: login.secret,
  machineSecret: machine.secret,
  identitySecret: identityClient?.secret,
  documentsFixtureId,
  transferOrigin: storage?.environment.DMS_STORAGE_PUBLIC_ORIGIN,
});
let releaseAssessment;
process.on('message', async (message) => {
  try {
    let count, uploadBinding, batchBinding, observation;
    if (message.action === 'documents-processing-setup' && processingMode) {
      await setupProcessing();
    } else if (message.action === 'documents-process' && processingWorkerEnvironment) {
      observation = await processFixtureUpload(message.uploadId, message.failure);
    } else if (message.action === 'documents-owner-fixture' && fixtureOwnerId) {
      if (!ownerClient) await prepareFixtureOwner();
      observation = {
        ownerId: fixtureOwnerId,
        contributorId: applicationId,
        sharedDocumentId,
        expiredDocumentId,
      };
    } else if (message.action === 'documents-owner-detail' && fixtureOwnerId) {
      observation = await ownerCall(`/documents/${sharedDocumentId}`);
    } else if (message.action === 'documents-owner-grant' && fixtureOwnerId) {
      const path = `/documents/${sharedDocumentId}/permissions`;
      const current = await ownerCall(path);
      if (current.status !== 200) throw new Error('Fixture owner grants unavailable');
      observation = await ownerCall(
        path,
        'PUT',
        {
          grants: message.rights.length ? [{ applicationId, rights: message.rights }] : [],
        },
        current.body.revision,
      );
    } else if (message.action === 'documents-owner-original' && fixtureOwnerId) {
      const result = await ownerCall(`/documents/${sharedDocumentId}/download`);
      if (result.status !== 200) throw new Error('Fixture owner original unavailable');
      const original = await fetch(result.body.url);
      if (!original.ok) throw new Error('Fixture owner original transfer denied');
      observation = {
        sha256: createHash('sha256')
          .update(Buffer.from(await original.arrayBuffer()))
          .digest('hex'),
      };
    } else if (message.action === 'documents-contributor-content' && fixtureOwnerId) {
      const response = await fetch(`${authorityOrigin}/v1/documents/${sharedDocumentId}/content`, {
        headers: { authorization: `Bearer ${await machineAccess(machine, machineScopes)}` },
      });
      observation = { status: response.status };
    } else if (message.action === 'documents-expire-logical-restore' && fixtureOwnerId) {
      await withTenant(dmsOwner, context.tenantId, (db) =>
        db.query(
          `UPDATE dms.document SET deleted_at=statement_timestamp()-interval '31 days', restore_deadline=statement_timestamp()-interval '1 day'
         WHERE id=$1 AND lifecycle='SOFT_DELETED'`,
          [expiredDocumentId],
        ),
      );
    } else if (
      message.action === 'documents-settle-lifecycle-cancellation' &&
      lifecycleMode &&
      privateApp
    ) {
      await withTenant(dmsOwner, context.tenantId, (db) =>
        db.query(
          `UPDATE dms.upload_admission a SET capability_expires_at=clock_timestamp()-interval '61 seconds'
         FROM dms.upload_session s WHERE a.id=s.id AND a.id=$1 AND s.upload_state='CANCELLED'`,
          [message.uploadId],
        ),
      );
      await settleAbandonedUploads(privateApp.get(WorkService), privateApp.get(StorageService));
    } else if (message.action === 'documents-upload-count' && storage) {
      count = await withTenant(dmsOwner, context.tenantId, async (db) =>
        Number((await db.query('SELECT count(*) FROM dms.upload_session')).rows[0].count),
      );
    } else if (message.action === 'documents-batch-count' && storage) {
      count = await withTenant(dmsOwner, context.tenantId, async (db) =>
        Number((await db.query('SELECT count(*) FROM dms.upload_batch')).rows[0].count),
      );
    } else if (message.action === 'documents-review-batch-binding' && storage) {
      batchBinding = await withTenant(
        dmsOwner,
        context.tenantId,
        async (db) =>
          (
            await db.query(
              `SELECT batch_id AS "batchId" FROM dms.upload_receipt
           WHERE application_id=$1 AND namespace='batch.create' AND key_hash=$2`,
              [applicationId, createHash('sha256').update(message.intentId).digest('hex')],
            )
          ).rows[0],
      );
    } else if (message.action === 'documents-review-binding' && storage) {
      uploadBinding = await withTenant(
        dmsOwner,
        context.tenantId,
        async (db) =>
          (
            await db.query(
              `SELECT id AS "uploadId",document_id AS "documentId",version_id AS "versionId"
         FROM dms.upload_admission WHERE contributor_application_id=$1 AND idempotency_hash=$2`,
              [applicationId, createHash('sha256').update(message.intentId).digest('hex')],
            )
          ).rows[0],
      );
    } else if (message.action === 'documents-capacity' && privateApp) {
      await privateApp.get(WorkService).internal((tx) => observeCapacity(tx, tmpdir(), tmpdir()));
    } else if (message.action === 'documents-settle-cancelled-batch' && privateApp && storage) {
      // The browser never used these test capabilities. Advance their expiry so the
      // normal coordinator settlement can release capacity for the next scenario.
      await withTenant(dmsOwner, context.tenantId, (db) =>
        db.query(
          `UPDATE dms.upload_admission a SET capability_expires_at=clock_timestamp()-interval '61 seconds'
         FROM dms.upload_session s WHERE a.id=s.id AND s.batch_id=$1 AND s.upload_state='CANCELLED'`,
          [message.batchId],
        ),
      );
      await settleAbandonedUploads(privateApp.get(WorkService), privateApp.get(StorageService));
    } else if (message.action === 'documents-lose-put' && storage) {
      storage.loseNextPutReply();
    } else if (message.action === 'documents-release-assessment' && releaseAssessment) {
      releaseAssessment();
    } else if (message.action === 'documents-assess' && privateApp && scannerClient) {
      scanner ??= await assessmentDaemonFixture(resolve('apps/dms-processing'));
      const work = privateApp.get(WorkService);
      const objects = privateApp.get(StorageService);
      await discoverUploads(work, objects);
      await selectCandidates(work, objects);
      await selectRestores(work, objects);
      if (message.logicalRestore) await restoreLifecycleVersions(work, objects);
      const envelope = await work.internal(
        async (tx) =>
          (
            await tx.client.query(
              `SELECT j.id AS "jobId", d.id AS "dispatchId", j.generation, j.task
         FROM dms.work_job j JOIN dms.work_dispatch d ON d.job_id=j.id AND d.generation=j.generation
         WHERE j.upload_id=$1 AND j.task='document.scan' AND j.state='QUEUED'`,
              [message.uploadId],
            )
          ).rows[0],
      );
      const token = await app.inject({
        method: 'POST',
        url: '/identity/oauth2/token',
        headers: {
          authorization: `Basic ${Buffer.from(`${scannerClient.record.clientId}:${scannerClient.secret}`).toString('base64')}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        payload: new URLSearchParams({
          grant_type: 'client_credentials',
          scope: 'dms:work:scan',
          resource: `${config.AUTH_ISSUER_URL}/services/work`,
        }).toString(),
      });
      if (token.statusCode !== 200 || !envelope)
        throw new Error('Scanner fixture authority or job unavailable');
      async function call(path, payload) {
        const result = await privateApp.inject({
          method: 'POST',
          url: `/internal/work${path}`,
          headers: { authorization: `Bearer ${token.json().access_token}` },
          payload,
        });
        if (result.statusCode !== 200) throw new Error('Private scanner handler failed');
        return result.json();
      }
      const { lease } = await call('/attempts/claim', { version: 1, ...envelope });
      const candidate = await call('/attempts/candidate', lease);
      const pulse = setInterval(
        () => void call('/attempts/heartbeat', lease).catch(() => {}),
        15000,
      );
      let assessment;
      try {
        assessment = await new Promise((accept, reject) => {
          const child = spawn(
            'uv',
            [
              'run',
              '--locked',
              'python',
              '-c',
              'import json,sys; from turnstile_processing.assessment import assess; print(json.dumps(assess(json.load(sys.stdin))))',
            ],
            {
              cwd: resolve('apps/dms-processing'),
              env: {
                ...process.env,
                DMS_CLAM_SOCKET: scanner.socket,
                SSL_CERT_FILE: process.env.NODE_EXTRA_CA_CERTS,
              },
              stdio: ['pipe', 'pipe', 'ignore'],
            },
          );
          let output = '';
          child.stdout.on('data', (chunk) => {
            output += chunk;
            if (output.length > 8192) child.kill('SIGKILL');
          });
          child.once('error', reject);
          child.once('close', (code) => {
            if (code !== 0) return reject(new Error('Native assessor failed'));
            try {
              accept(JSON.parse(output));
            } catch (error) {
              reject(error);
            }
          });
          child.stdin.end(JSON.stringify(candidate));
        });
      } finally {
        clearInterval(pulse);
      }
      if (assessment.outcome !== 'PASSED') throw new Error('Native assessment did not pass');
      if (message.holdResult) {
        await new Promise((resolve) => {
          const timer = setTimeout(resolve, 10000);
          releaseAssessment = () => {
            clearTimeout(timer);
            resolve();
          };
          process.send?.({ requestId: message.requestId, assessmentReady: true });
        });
        releaseAssessment = undefined;
      }
      await call('/attempts/result', { ...lease, outcome: 'SUCCEEDED', code: 'OK', assessment });
      await settleCandidates(work);
    } else if (message.action === 'clear-rate-limits')
      await owner.query('DELETE FROM auth.rate_limit');
    else if (message.action === 'enroll-machine') {
      const response = await app.inject({
        method: 'POST',
        url: '/identity/oauth2/token',
        headers: {
          'content-type': 'application/x-www-form-urlencoded',
          authorization: `Basic ${Buffer.from(`${machine.record.clientId}:${machine.secret}`).toString('base64')}`,
        },
        payload: new URLSearchParams({
          grant_type: 'client_credentials',
          resource: config.DMS_RESOURCE_URL,
          scope: 'dms:capabilities:read',
        }).toString(),
      });
      if (response.statusCode !== 200) throw new Error('Fixture machine issuance failed');
      const activated = await app.inject({
        method: 'POST',
        url: '/v1/application-enrollments',
        headers: {
          authorization: `Bearer ${response.json().access_token}`,
          'x-thaarei-enrollment-key': enrollment.key,
          'idempotency-key': enrollment.keyId,
        },
        payload: { name: 'BFF fixture' },
      });
      if (activated.statusCode !== 201) throw new Error('Fixture enrollment failed');
      if (documentsMode) {
        // Synthetic registry state only; no bytes/publication claim before DV-I03.
        await withTenant(dmsOwner, context.tenantId, async (db) => {
          await db.query(
            `INSERT INTO dms.document(id,tenant_id,application_id,title,file_name,metadata,tags) VALUES($1,$2,$3,'Validation reference','validation-reference.txt','{"purpose":"read-only fixture"}'::jsonb,'["validation"]'::jsonb)`,
            [documentsFixtureId, context.tenantId, applicationId],
          );
        });
      }
    } else if (
      message.action === 'deny-machine-scope' ||
      message.action === 'restore-machine-scope'
    )
      await setApplicationScopes(
        dmsOwner,
        context,
        applicationId,
        message.action === 'deny-machine-scope' ? [] : machineScopes,
      );
    else if (message.action === 'disable-machine')
      await disableApplication(dmsOwner, context, applicationId, async () => {
        await manageOAuthClient(auth, config, operator, {
          action: 'suspend',
          kind: 'machine',
          clientId: machine.record.clientId,
        });
      });
    else if (message.action === 'ban')
      await auth.api.banUser({ headers: operator, body: { userId: users.suspended.id } });
    else if (message.action === 'reset') {
      await auth.api.requestPasswordReset({
        body: {
          email: users.reset.email,
          redirectTo: `${config.AUTH_PUBLIC_ORIGIN}/reset-password`,
        },
      });
      const link = await smtp.link('reset', users.reset.email);
      await auth.api.resetPassword({
        body: {
          newPassword: randomBytes(24).toString('base64url'),
          token: link.searchParams.get('token') ?? link.pathname.split('/').at(-1),
        },
      });
    } else if (message.action !== 'security-metrics') throw new Error('Unknown fixture operation');
    process.send?.({
      requestId: message.requestId,
      ok: true,
      ...(count === undefined ? {} : { count }),
      ...(uploadBinding ? { uploadBinding } : {}),
      ...(batchBinding ? { batchBinding } : {}),
      ...(observation ? { observation } : {}),
      ...(message.action === 'security-metrics'
        ? { metrics: app.get(SecurityTelemetryService).snapshot() }
        : {}),
    });
  } catch {
    process.send?.({ requestId: message.requestId, ok: false });
  }
});
let closing = false;
async function close() {
  if (closing) return;
  closing = true;
  await processingBroker?.close();
  await scanner?.close();
  await privateApp?.close();
  await app.close();
  await storage?.close();
  await withTenant(dmsOwner, context.tenantId, async (client) => {
    await client.query('DELETE FROM dms.enrollment_receipt WHERE application_id=$1', [
      applicationId,
    ]);
    await client.query('DELETE FROM dms.enrollment_key WHERE application_id=$1', [applicationId]);
    await client.query('DELETE FROM dms.outbox_intent WHERE application_id=$1', [applicationId]);
    await client.query('DELETE FROM dms.audit_event WHERE application_id=$1', [applicationId]);
    await client.query('DELETE FROM dms.application_registration WHERE id=$1', [applicationId]);
  });
  await dmsOwner.end();
  await owner.end();
  await smtp.close();
  process.disconnect?.();
}
process.on('disconnect', () => void close());
process.on('SIGTERM', () => void close());
