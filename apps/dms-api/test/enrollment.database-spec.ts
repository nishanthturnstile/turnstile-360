import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DMS_MACHINE_SCOPES, enrollmentResponseSchema } from '@thaarei/dms-contracts';
import { WORK_ROLE_SCOPE, type WorkRole } from '@thaarei/dms-contracts/private';
import { Pool } from 'pg';
import { createApplication } from '../src/bootstrap.js';
import {
  assertDatabaseRole,
  createPool,
  withTenant,
} from '../src/infrastructure/database/postgres.js';
import { DmsDatabaseService } from '../src/modules/access/dms-database/dms-database.service.js';
import { MachineVerifierService } from '../src/modules/access/machine-verifier/machine-verifier.service.js';
import { runOperatorCommand } from '../src/modules/access/manage-operator.js';
import {
  AUDIT_PAGE_SQL,
  appendApplicationAudit,
  readAuditPage,
} from '../src/modules/audit/audit.service.js';
import {
  issueEnrollmentKey,
  registerApplication,
  revokeEnrollmentKey,
  setApplicationScopes,
} from '../src/modules/enrollment/enrollment-operator.js';
import { runApplicationCommand } from '../src/modules/enrollment/manage-application.js';
import { restoreLifecycleVersions } from '../src/modules/lifecycle/lifecycle-restoration.js';
import { AuthorityService } from '../src/modules/platform-auth/authority/authority.service.js';
import type { AuthorityConfiguration } from '../src/modules/platform-auth/authority-configuration.js';
import { manageOAuthClient } from '../src/modules/platform-auth/manage-client.js';
import { provisionUser } from '../src/modules/platform-auth/provision-user.js';
import { invalidateCandidate } from '../src/modules/processing/assessment-acceptance.js';
import {
  selectRestores,
  settleFailedRestores,
} from '../src/modules/processing/restore-discovery.js';
import {
  selectCandidates,
  settleAbandonedUploads,
  settleCandidates,
} from '../src/modules/processing/security-publication.js';
import {
  discoverUploads,
  expireBatches,
  expireUploads,
} from '../src/modules/processing/upload-discovery.js';
import { WorkService } from '../src/modules/processing/work.service.js';
import { enqueueWork } from '../src/modules/processing/work-state.js';
import { StorageService } from '../src/modules/storage/storage.service.js';
import { AdmissionService, hash } from '../src/modules/uploads/admission.service.js';
import {
  observeCapacity,
  reconcileAdmission,
  releaseWorkReservation,
  withCoordinator,
} from '../src/modules/uploads/admission-maintenance.js';
import { AdmissionFeatures } from '../src/modules/uploads/admission-policy.js';
import { createWorkApplication } from '../src/work-bootstrap.js';
import { assessmentDaemonFixture } from './assessment-daemon-fixture.js';
import { smtpFixture } from './smtp-fixture.js';
import { uploadStorageFixture } from './upload-storage-fixture.js';
import { workBrokerFixture } from './work-broker-fixture.js';

describe('machine registration and transactional enrollment', () => {
  let app: NestFastifyApplication;
  let config: AuthorityConfiguration;
  let authority: AuthorityService;
  let smtp: Awaited<ReturnType<typeof smtpFixture>>;
  let operator: Headers;
  let operatorId: string;
  const operatorSubjects: string[] = [];
  const email = 'enrollment-operator@example.test';
  const password = randomBytes(24).toString('base64url');
  const owner = new Pool({ connectionString: process.env.DMS_MIGRATION_DATABASE_URL });
  const authOwner = new Pool({ connectionString: process.env.AUTH_MIGRATION_DATABASE_URL });
  const tenantId = process.env.INSTALLATION_TENANT_ID as string;
  const applications: string[] = [];
  // Serve the real initialized Fastify handler at the canonical issuer URL, including JWKS.
  const http = createServer((request, response) =>
    app.getHttpAdapter().getInstance().routing(request, response),
  );
  const context = () => ({
    tenantId,
    issuer: config.AUTH_ISSUER_URL,
    deploymentId: config.DMS_RESOURCE_URL,
  });
  function auth() {
    if (!authority.auth) throw new Error('Authority unavailable');
    return authority.auth;
  }
  function mintToken(clientId: string, secret: string) {
    return app.inject({
      method: 'POST',
      url: '/identity/oauth2/token',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,
      },
      payload: new URLSearchParams({
        grant_type: 'client_credentials',
        scope: DMS_MACHINE_SCOPES.join(' '),
        resource: config.DMS_RESOURCE_URL,
      }).toString(),
    });
  }
  async function createConsumer() {
    const applicationId = randomUUID();
    const clientId = `enroll-${randomBytes(8).toString('hex')}`;
    const issued = await manageOAuthClient(auth(), config, operator, {
      action: 'issue',
      kind: 'machine',
      applicationId,
      clientId,
      scopes: [...DMS_MACHINE_SCOPES],
    });
    if (!issued.secret) throw new Error('Missing fixture credential');
    applications.push(applicationId);
    await registerApplication(
      owner,
      context(),
      { applicationId, clientId, name: 'Fixture application', scopes: [...DMS_MACHINE_SCOPES] },
      issued.record,
    );
    const key = await issueEnrollmentKey(owner, context(), applicationId);
    const token = () => mintToken(clientId, issued.secret as string);
    const minted = await token();
    expect(minted.statusCode).toBe(200);
    return {
      applicationId,
      clientId,
      key,
      accessToken: minted.json().access_token as string,
      token,
    };
  }
  type Consumer = Awaited<ReturnType<typeof createConsumer>>;
  function capability(consumer: Consumer, extra: Record<string, string> = {}, query = '') {
    return app.inject({
      method: 'GET',
      url: `/v1/capabilities${query}`,
      headers: { authorization: `Bearer ${consumer.accessToken}`, ...extra },
    });
  }
  function enroll(
    consumer: Consumer,
    idempotency = randomUUID(),
    key = consumer.key.key,
    name = 'Fixture application',
  ) {
    return app.inject({
      method: 'POST',
      url: '/v1/application-enrollments',
      headers: {
        authorization: `Bearer ${consumer.accessToken}`,
        'x-thaarei-enrollment-key': key,
        'idempotency-key': idempotency,
      },
      payload: { name },
    });
  }
  beforeAll(async () => {
    smtp = await smtpFixture();
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    const address = http.address();
    if (!address || typeof address === 'string') throw new Error('HTTP fixture unavailable');
    const origin = `http://127.0.0.1:${address.port}`;
    for (const [key, value] of Object.entries({
      AUTH_PUBLIC_ORIGIN: origin,
      AUTH_ISSUER_URL: `${origin}/identity`,
      DMS_RESOURCE_URL: `${origin}/v1`,
      AUTH_LOGIN_CALLBACK_URL: `${origin}/api/auth/callback`,
      AUTH_SMTP_PORT: String(smtp.port),
    }))
      vi.stubEnv(key, value);
    app = await createApplication(false);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    authority = app.get(AuthorityService);
    if (!authority.config) throw new Error('Missing config');
    config = authority.config;
    await provisionUser(
      auth(),
      { email, name: 'Enrollment operator', role: 'admin', password },
      origin,
    );
    const link = smtp.link('verify');
    expect((await app.inject({ method: 'GET', url: link.pathname + link.search })).statusCode).toBe(
      302,
    );
    const login = await auth().api.signInEmail({ body: { email, password }, returnHeaders: true });
    operator = new Headers({
      origin,
      cookie: login.headers
        .getSetCookie()
        .map((cookie) => cookie.split(';')[0])
        .join('; '),
    });
    const session = await auth().api.getSession({ headers: operator });
    if (!session) throw new Error('Missing fixture session');
    operatorId = session.user.id;
    operatorSubjects.push(operatorId);
  });
  beforeEach(async () => {
    await authOwner.query('DELETE FROM auth.rate_limit');
  });
  afterAll(async () => {
    http.closeAllConnections();
    await new Promise<void>((resolve) => http.close(() => resolve()));
    await app?.close();
    await smtp?.close();
    await withTenant(owner, tenantId, async (client) => {
      await client.query(
        'DELETE FROM dms.operator_authorization WHERE subject_id=ANY($1::text[])',
        [operatorSubjects],
      );
      await client.query('DELETE FROM dms.outbox_intent WHERE application_id = ANY($1::uuid[])', [
        applications,
      ]);
      await client.query('DELETE FROM dms.audit_event WHERE application_id = ANY($1::uuid[])', [
        applications,
      ]);
      await client.query(
        'DELETE FROM dms.enrollment_receipt WHERE application_id = ANY($1::uuid[])',
        [applications],
      );
      await client.query('DELETE FROM dms.enrollment_key WHERE application_id = ANY($1::uuid[])', [
        applications,
      ]);
      await client.query('UPDATE dms.processing_run SET active=false,accepted_stage_id=NULL');
      for (const table of [
        'recovery_state',
        'backup_catalog',
        'disposal_intent',
        'lifecycle_receipt',
        'lifecycle_restore',
        'security_assessment_history',
        'document_grant',
        'binary_restore',
        'service_observation',
        'search_generation',
        'security_candidate',
        'extraction_stage',
        'work_attempt',
        'work_dispatch',
        'work_job',
        'processing_run',
        'work_identity',
      ])
        await client.query(`DELETE FROM dms.${table}`);
      for (const table of [
        'upload_receipt',
        'upload_session',
        'upload_batch_item',
        'upload_batch_slot',
        'upload_batch',
      ])
        await client.query(`DELETE FROM dms.${table} WHERE application_id=ANY($1::uuid[])`, [
          applications,
        ]);
      await client.query('DELETE FROM dms.upload_admission WHERE application_id=ANY($1::uuid[])', [
        applications,
      ]);
      await client.query('DELETE FROM dms.document_version WHERE application_id=ANY($1::uuid[])', [
        applications,
      ]);
      await client.query('DELETE FROM dms.document WHERE application_id=ANY($1::uuid[])', [
        applications,
      ]);
      await client.query(
        'DELETE FROM dms.admission_application_usage WHERE application_id=ANY($1::uuid[])',
        [applications],
      );
      await client.query('DELETE FROM dms.application_registration WHERE id = ANY($1::uuid[])', [
        applications,
      ]);
    });
    await owner.end();
    await authOwner.end();
    vi.unstubAllEnvs();
  });

  it('requires machine authority plus enrollment, derives the local context and rechecks current status/scopes', async () => {
    const consumer = await createConsumer();
    const unmappedId = `unmapped-${randomBytes(8).toString('hex')}`;
    const unmapped = await manageOAuthClient(auth(), config, operator, {
      action: 'issue',
      kind: 'machine',
      applicationId: randomUUID(),
      clientId: unmappedId,
      scopes: [...DMS_MACHINE_SCOPES],
    });
    if (!unmapped.secret) throw new Error('Missing fixture credential');
    const unmappedToken = await mintToken(unmappedId, unmapped.secret);
    expect(unmappedToken.statusCode).toBe(200);
    expect(
      (await capability({ ...consumer, accessToken: unmappedToken.json().access_token }))
        .statusCode,
    ).toBe(403);
    expect((await capability(consumer)).statusCode).toBe(403);
    expect(
      (
        await app.inject({
          url: '/v1/capabilities',
          headers: { cookie: operator.get('cookie') as string },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          url: '/v1/capabilities',
          headers: { authorization: 'DPoP opaque-token' },
        })
      ).statusCode,
    ).toBe(401);
    expect((await capability(consumer, { 'x-tenant-id': randomUUID() })).statusCode).toBe(400);
    expect((await capability(consumer, {}, `?tenantId=${randomUUID()}`)).statusCode).toBe(400);
    expect((await enroll(consumer)).statusCode).toBe(201);
    const allowed = await capability(consumer);
    expect(allowed.statusCode).toBe(200);
    expect(allowed.json()).toMatchObject({
      applicationId: consumer.applicationId,
      tenantId,
      formats: [],
      profiles: [],
    });
    await setApplicationScopes(owner, context(), consumer.applicationId, []);
    expect((await capability(consumer)).statusCode).toBe(403);
    await setApplicationScopes(owner, context(), consumer.applicationId, [...DMS_MACHINE_SCOPES]);
    await withTenant(owner, tenantId, (client) =>
      client.query(
        "UPDATE dms.application_registration SET principal_kind = 'scanner' WHERE id = $1",
        [consumer.applicationId],
      ),
    );
    expect((await capability(consumer)).statusCode).toBe(403);
  });

  it('binds keys and replay receipts to the client, body, deployment and current registration', async () => {
    const first = await createConsumer();
    const second = await createConsumer();
    const idempotency = randomUUID();
    const mismatch = await enroll(second, idempotency, first.key.key);
    expect(mismatch.statusCode, mismatch.json().code).toBe(403);
    await withTenant(owner, tenantId, (client) =>
      client.query('UPDATE dms.enrollment_key SET deployment_id=$1 WHERE id=$2', [
        'https://other-deployment.example.test',
        first.key.keyId,
      ]),
    );
    expect((await enroll(first, idempotency)).json().code).toBe('ENROLLMENT_KEY_INVALID');
    await withTenant(owner, tenantId, (client) =>
      client.query('UPDATE dms.enrollment_key SET deployment_id=$1 WHERE id=$2', [
        config.DMS_RESOURCE_URL,
        first.key.keyId,
      ]),
    );
    const created = await enroll(first, idempotency);
    expect(created.statusCode).toBe(201);
    expect(enrollmentResponseSchema.safeParse(created.json()).success).toBe(true);
    const retry = await enroll(first, idempotency);
    expect(retry.statusCode).toBe(200);
    expect(retry.json()).toEqual(created.json());
    expect((await enroll(first, idempotency, first.key.key, 'Different name')).statusCode).toBe(
      409,
    );
    expect((await enroll(first, randomUUID())).statusCode).toBe(403);
    // Expiration of the original unused-key window does not remove a valid consumed-key receipt.
    await withTenant(owner, tenantId, (client) =>
      client.query(
        "UPDATE dms.enrollment_key SET created_at=now()-interval '2 days', expires_at=now()-interval '1 day' WHERE id=$1",
        [first.key.keyId],
      ),
    );
    expect((await enroll(first, idempotency)).statusCode).toBe(200);
    await withTenant(owner, tenantId, (client) =>
      client.query(
        "UPDATE dms.enrollment_receipt SET created_at=now()-interval '2 days', expires_at=now()-interval '1 day' WHERE application_id=$1",
        [first.applicationId],
      ),
    );
    expect((await enroll(first, idempotency)).json().code).toBe('REPLAY_WINDOW_EXPIRED');
    await revokeEnrollmentKey(owner, context(), first.applicationId, first.key.keyId);
    const revoked = await enroll(first, idempotency);
    expect(revoked.json().code).toBe('ENROLLMENT_KEY_REVOKED');
    await withTenant(owner, tenantId, (client) =>
      client.query(
        "UPDATE dms.enrollment_key SET created_at=now()-interval '2 days', expires_at=now()-interval '1 day' WHERE id=$1",
        [second.key.keyId],
      ),
    );
    expect((await enroll(second)).json().code).toBe('ENROLLMENT_KEY_EXPIRED');
  });

  it('returns a retryable conflict under contention and commits one activation/receipt for concurrent retries', async () => {
    const consumer = await createConsumer();
    const idempotency = randomUUID();
    const lock = await owner.connect();
    await lock.query('BEGIN');
    await lock.query("SELECT set_config('app.tenant_id',$1,true)", [tenantId]);
    await lock.query('SELECT id FROM dms.application_registration WHERE id=$1 FOR UPDATE', [
      consumer.applicationId,
    ]);
    try {
      const pending = await enroll(consumer, idempotency);
      expect(pending.statusCode).toBe(409);
      expect(pending.json().retryable).toBe(true);
      expect(pending.headers['retry-after']).toBe('1');
    } finally {
      await lock.query('ROLLBACK');
      lock.release();
    }
    const parallel = await Promise.all([
      enroll(consumer, idempotency),
      enroll(consumer, idempotency),
    ]);
    expect(
      parallel.some((response) => response.statusCode === 201),
      JSON.stringify(
        parallel.map((response) => ({ status: response.statusCode, code: response.json().code })),
      ),
    ).toBe(true);
    expect(parallel.every((response) => [200, 201, 409].includes(response.statusCode))).toBe(true);
    expect((await enroll(consumer, idempotency)).statusCode).toBe(200);
    const count = await withTenant(owner, tenantId, (client) =>
      client.query(
        'SELECT count(*)::int AS count FROM dms.enrollment_receipt WHERE application_id=$1',
        [consumer.applicationId],
      ),
    );
    expect(count.rows[0].count).toBe(1);
  });

  it('rolls back activation, consumption and receipt when audit persistence fails', async () => {
    const consumer = await createConsumer();
    const idempotency = randomUUID();
    await owner.query(
      "CREATE FUNCTION dms.fixture_fail_enrollment_audit() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture audit failure'; END $$",
    );
    await owner.query(
      "CREATE TRIGGER fixture_enrollment_audit BEFORE INSERT ON dms.security_event FOR EACH ROW WHEN (NEW.action = 'application.enroll') EXECUTE FUNCTION dms.fixture_fail_enrollment_audit()",
    );
    try {
      expect((await enroll(consumer, idempotency)).statusCode).toBe(503);
      await withTenant(owner, tenantId, async (client) => {
        expect(
          (
            await client.query('SELECT consumed_at FROM dms.enrollment_key WHERE id=$1', [
              consumer.key.keyId,
            ])
          ).rows[0].consumed_at,
        ).toBe(null);
        expect(
          (
            await client.query('SELECT status FROM dms.application_registration WHERE id=$1', [
              consumer.applicationId,
            ])
          ).rows[0].status,
        ).toBe('pending');
        expect(
          (
            await client.query('SELECT id FROM dms.enrollment_receipt WHERE application_id=$1', [
              consumer.applicationId,
            ])
          ).rows,
        ).toHaveLength(0);
      });
    } finally {
      await owner.query('DROP TRIGGER fixture_enrollment_audit ON dms.security_event');
      await owner.query('DROP FUNCTION dms.fixture_fail_enrollment_audit()');
    }
    expect((await enroll(consumer, idempotency)).statusCode).toBe(201);
  });

  it('returns owner-only audit over HTTP and reauthorizes every page and scope change', async () => {
    const first = await createConsumer();
    const other = await createConsumer();
    const key = randomUUID();
    expect((await enroll(first, key)).statusCode).toBe(201);
    expect((await enroll(first, key)).statusCode).toBe(200);
    expect((await enroll(other)).statusCode).toBe(201);
    const read = (token: string, query = '') =>
      app.inject({ url: `/v1/audit${query}`, headers: { authorization: `Bearer ${token}` } });
    const page = await read(first.accessToken);
    expect(page.statusCode).toBe(200);
    expect(page.json().items).toHaveLength(1); // replay never invents a second state change
    expect(page.json().items[0]).toMatchObject({
      applicationId: first.applicationId,
      action: 'application.enrolled',
      assertedHuman: null,
    });
    expect(JSON.stringify(page.json())).not.toContain(other.applicationId);
    expect(
      (await read(other.accessToken))
        .json()
        .items.every(
          (item: { applicationId: string }) => item.applicationId === other.applicationId,
        ),
    ).toBe(true);
    expect((await read(first.accessToken, '?limit=101')).statusCode).toBe(400);
    expect((await read(first.accessToken, '?cursor=invalid')).statusCode).toBe(400);
    expect(
      (await read(first.accessToken, `?applicationId=${other.applicationId}`)).statusCode,
    ).toBe(400);
    expect(
      (
        await app.inject({
          url: '/v1/audit',
          headers: { cookie: operator.get('cookie') as string },
        })
      ).statusCode,
    ).toBe(401);
    for (const kind of ['publisher', 'scanner', 'extractor']) {
      await withTenant(owner, tenantId, (client) =>
        client.query('UPDATE dms.application_registration SET principal_kind=$1 WHERE id=$2', [
          kind,
          first.applicationId,
        ]),
      );
      expect((await read(first.accessToken)).statusCode).toBe(403);
    }
    await withTenant(owner, tenantId, (client) =>
      client.query(
        "UPDATE dms.application_registration SET principal_kind='consumer' WHERE id=$1",
        [first.applicationId],
      ),
    );
    await setApplicationScopes(owner, context(), first.applicationId, ['dms:capabilities:read']);
    expect((await read(first.accessToken)).statusCode).toBe(403);
    await setApplicationScopes(owner, context(), first.applicationId, [...DMS_MACHINE_SCOPES]);
    expect((await read(first.accessToken)).statusCode).toBe(200);
  });

  it('binds keyset cursors to tenant and principal and rolls back audit/outbox with state', async () => {
    const consumer = await createConsumer();
    const other = await createConsumer();
    expect((await enroll(consumer)).statusCode).toBe(201);
    expect((await enroll(other)).statusCode).toBe(201);
    const database = app.get(DmsDatabaseService);
    const principal = {
      issuer: config.AUTH_ISSUER_URL,
      clientId: consumer.clientId,
      scopes: [...DMS_MACHINE_SCOPES],
    };
    await expect(
      database.withMachine(principal, ['dms:audit:read'], async (tx) => {
        await tx.client.query(
          "UPDATE dms.application_registration SET status='disabled' WHERE id=$1",
          [consumer.applicationId],
        );
        await appendApplicationAudit(tx, randomUUID(), {
          source: 'application-asserted',
          subject: 'human-123',
        });
        throw new Error('fixture rollback');
      }),
    ).rejects.toThrow('fixture rollback');
    await withTenant(owner, tenantId, async (client) => {
      expect(
        (
          await client.query('SELECT status FROM dms.application_registration WHERE id=$1', [
            consumer.applicationId,
          ])
        ).rows[0].status,
      ).toBe('active');
      for (const table of ['audit_event', 'outbox_intent'])
        expect(
          (
            await client.query(`SELECT id FROM dms.${table} WHERE application_id=$1`, [
              consumer.applicationId,
            ])
          ).rowCount,
        ).toBe(1);
    });
    // Two committed fixture events exercise timestamp/UUID pagination.
    await database.withMachine(principal, ['dms:audit:read'], (tx) =>
      appendApplicationAudit(tx, randomUUID(), {
        source: 'application-asserted',
        subject: 'human-123',
      }),
    );
    await withTenant(owner, tenantId, (client) =>
      client.query(
        "UPDATE dms.audit_event SET created_at='2026-11-05T00:00:00Z' WHERE application_id=$1",
        [consumer.applicationId],
      ),
    );
    await database.withMachine(principal, ['dms:audit:read'], async (tx) => {
      // The actual page SQL must use index ordering rather than sorting the formatted timestamp.
      await tx.client.query('SET LOCAL enable_seqscan=off');
      const plan = await tx.client.query(`EXPLAIN (FORMAT JSON) ${AUDIT_PAGE_SQL}`, [
        consumer.applicationId,
        null,
        null,
        2,
        null,
      ]);
      expect(JSON.stringify(plan.rows)).not.toContain('"Node Type":"Sort"');
      expect(JSON.stringify(plan.rows)).toMatch(/audit_(?:application|operator|document)_page_idx/);
      expect(JSON.stringify(plan.rows)).toContain('"Scan Direction":"Backward"');
    });
    const read = (p = principal, cursor?: string) =>
      database.withMachine(p, ['dms:audit:read'], (tx) =>
        readAuditPage(tx, config.AUTH_SECRET, { limit: 1, cursor }),
      );
    const page = await read();
    expect(page.nextCursor).toBeTypeOf('string');
    const cursor = page.nextCursor;
    if (!cursor) throw new Error('Expected cursor');
    const next = await read(principal, cursor);
    expect(next.items).toHaveLength(1);
    expect([...page.items, ...next.items].map((item) => item.assertedHuman)).toContainEqual({
      source: 'application-asserted',
      subject: 'human-123',
    });
    expect(next.items[0]?.id).not.toBe(page.items[0]?.id);
    expect(next.nextCursor).toBe(null);
    await expect(read({ ...principal, clientId: other.clientId }, cursor)).rejects.toThrow();
    await expect(read(principal, `${cursor.slice(0, -4)}AAAA`)).rejects.toThrow();
  });

  it('enforces role, RLS, reference and pooled-context boundaries in PostgreSQL', async () => {
    const consumer = await createConsumer();
    expect((await enroll(consumer)).statusCode).toBe(201);
    const runtime = createPool(config.DMS_DATABASE_URL, 1);
    const coordinator = createPool(process.env.DMS_COORDINATOR_DATABASE_URL ?? '', 1);
    const privatePool = createPool(process.env.DMS_OPERATOR_DATABASE_URL ?? '', 1);
    try {
      await assertDatabaseRole(coordinator, 'thaarei_dms_coordinator', 'dms');
      await assertDatabaseRole(privatePool, 'thaarei_dms_operator', 'dms');
      await withTenant(runtime, tenantId, async (client) => {
        await client.query(
          "SELECT set_config('app.principal_kind','operator',true), set_config('app.actor_id','arbitrary',true)",
        );
        expect((await client.query('SELECT id FROM dms.audit_event')).rows).toHaveLength(0);
      });
      for (const sql of [
        'SET ROLE thaarei_dms_operator',
        'SELECT * FROM dms.operator_authorization',
        'UPDATE dms.audit_event SET action=action',
        'DELETE FROM dms.audit_event',
        'SELECT * FROM auth.session',
      ])
        await expect(
          withTenant(runtime, tenantId, (client) => client.query(sql)),
        ).rejects.toMatchObject({ code: '42501' });
      // Context is local on success and failure, including when a single physical connection is reused.
      for (const rollback of [false, true]) {
        try {
          await withTenant(runtime, tenantId, async (client) => {
            await client.query(
              "SELECT set_config('app.application_id',$1,true),set_config('app.principal_kind','machine',true)",
              [consumer.applicationId],
            );
            expect((await client.query('SELECT id FROM dms.audit_event')).rowCount).toBe(1);
            if (rollback) throw new Error('rollback');
          });
        } catch {
          expect(rollback).toBe(true);
        }
        const clean = await runtime.query(
          "SELECT nullif(current_setting('app.tenant_id',true),'') AS tenant, nullif(current_setting('app.application_id',true),'') AS application, nullif(current_setting('app.principal_kind',true),'') AS principal",
        );
        expect(clean.rows[0]).toEqual({ tenant: null, application: null, principal: null });
        expect((await runtime.query('SELECT id FROM dms.audit_event')).rowCount).toBe(0);
      }
      await withTenant(coordinator, tenantId, async (client) =>
        expect((await client.query('SELECT id FROM dms.outbox_intent')).rowCount).toBeGreaterThan(
          0,
        ),
      );
      for (const sql of [
        'SELECT * FROM dms.audit_event',
        "UPDATE dms.application_registration SET status='active'",
        'DELETE FROM dms.outbox_intent',
      ])
        await expect(
          withTenant(coordinator, tenantId, (client) => client.query(sql)),
        ).rejects.toMatchObject({ code: '42501' });
      await withTenant(coordinator, randomUUID(), async (client) =>
        expect((await client.query('SELECT id FROM dms.outbox_intent')).rowCount).toBe(0),
      );
      const otherTenant = randomUUID();
      await expect(
        withTenant(owner, otherTenant, (client) =>
          client.query(
            `INSERT INTO dms.audit_event (id,tenant_id,application_id,resource_id,resource_type,action,actor_id) VALUES ($1,$2,$3,$3,'application','application.enrolled','fixture')`,
            [randomUUID(), otherTenant, consumer.applicationId],
          ),
        ),
      ).rejects.toMatchObject({ code: '23503' });
      const other = await createConsumer();
      const auditId = randomUUID();
      await withTenant(owner, tenantId, (client) =>
        client.query(
          `INSERT INTO dms.audit_event (id,tenant_id,application_id,resource_id,resource_type,action,actor_id) VALUES ($1,$2,$3,$3,'application','application.enrolled','fixture')`,
          [auditId, tenantId, consumer.applicationId],
        ),
      );
      await expect(
        withTenant(owner, tenantId, (client) =>
          client.query(
            `INSERT INTO dms.outbox_intent (id,tenant_id,application_id,audit_id,kind) VALUES ($1,$2,$3,$4,'application.enrolled')`,
            [randomUUID(), tenantId, other.applicationId, auditId],
          ),
        ),
      ).rejects.toMatchObject({ code: '23503' });
    } finally {
      await Promise.all([runtime.end(), coordinator.end(), privatePool.end()]);
    }
  });

  it('requires fresh explicit operator authorization on every private audit read and attributes reads', async () => {
    const invoke: typeof runOperatorCommand = async (input, environment = process.env) => {
      await authOwner.query('DELETE FROM auth.rate_limit');
      return runOperatorCommand(input, environment);
    };
    const consumer = await createConsumer();
    expect((await enroll(consumer)).statusCode).toBe(201);
    const command = {
      action: 'audit-read',
      operatorEmail: email,
      operatorPassword: password,
      applicationId: consumer.applicationId,
      limit: 1,
    };
    const privateEnv = { ...process.env, DMS_MIGRATION_DATABASE_URL: undefined };
    // Even an authority admin is not implicitly a DMS operator.
    await expect(invoke(command, privateEnv)).rejects.toThrow(/operator authorization/);
    await invoke({
      action: 'recover',
      operatorEmail: email,
      operatorPassword: password,
    });
    const granted = await invoke(command, privateEnv);
    expect(
      'items' in granted &&
        granted.items[0] &&
        'applicationId' in granted.items[0] &&
        granted.items[0].applicationId,
    ).toBe(consumer.applicationId);
    await expect(
      invoke({ ...command, operatorPassword: 'wrong-password-value' }, privateEnv),
    ).rejects.toThrow();
    await expect(
      invoke(command, { ...privateEnv, INSTALLATION_TENANT_ID: randomUUID() }),
    ).rejects.toThrow(/Installation mismatch/);
    await expect(
      invoke(command, {
        ...privateEnv,
        DMS_OPERATOR_DATABASE_URL: config.DMS_DATABASE_URL,
      }),
    ).rejects.toThrow(/Unsafe/);
    const readerEmail = 'dms-audit-reader@example.test';
    const reader = await provisionUser(
      auth(),
      { email: readerEmail, name: 'Audit reader', role: 'user', password },
      config.AUTH_PUBLIC_ORIGIN,
    );
    operatorSubjects.push(reader.id);
    const verify = smtp.link('verify');
    expect((await app.inject({ url: verify.pathname + verify.search })).statusCode).toBe(302);
    const readerCommand = { ...command, operatorEmail: readerEmail };
    await expect(invoke(readerCommand, privateEnv)).rejects.toThrow(/operator authorization/);
    await invoke({
      action: 'assign',
      operatorEmail: email,
      operatorPassword: password,
      subjectId: reader.id,
    });
    expect('items' in (await invoke(readerCommand, privateEnv))).toBe(true);
    await invoke({
      action: 'revoke',
      operatorEmail: email,
      operatorPassword: password,
      subjectId: reader.id,
    });
    await expect(invoke(readerCommand, privateEnv)).rejects.toThrow(/operator authorization/);
    const who = await auth().api.getSession({ headers: operator });
    if (!who) throw new Error('Missing fixture operator');
    await withTenant(owner, tenantId, async (client) => {
      const records = await client.query(
        "SELECT actor_id FROM dms.security_event WHERE action='operator.audit.read' AND subject_id=$1",
        [consumer.applicationId],
      );
      expect(records.rows.map((row) => row.actor_id)).toContain(who.user.id);
      await client.query(
        'UPDATE dms.operator_authorization SET revoked_at=now() WHERE subject_id=$1',
        [who.user.id],
      );
    });
    await expect(invoke(command, privateEnv)).rejects.toThrow(/operator authorization/);
    // Explicit recovery restores the grant, and cannot accept a machine token/cookie as proof.
    await expect(invoke({ action: 'audit-read', token: consumer.accessToken })).rejects.toThrow();
    await invoke({
      action: 'recover',
      operatorEmail: email,
      operatorPassword: password,
    });
    expect('items' in (await invoke(command, privateEnv))).toBe(true);
  });

  it('rolls back enrollment and its audit when durable outbox intent cannot be saved', async () => {
    const consumer = await createConsumer();
    const idempotency = randomUUID();
    await owner.query(
      "CREATE FUNCTION dms.fixture_fail_outbox() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'fixture outbox failure'; END $$",
    );
    await owner.query(
      'CREATE TRIGGER fixture_outbox BEFORE INSERT ON dms.outbox_intent FOR EACH ROW EXECUTE FUNCTION dms.fixture_fail_outbox()',
    );
    try {
      expect((await enroll(consumer, idempotency)).statusCode).toBe(503);
      await withTenant(owner, tenantId, async (client) => {
        expect(
          (
            await client.query('SELECT status FROM dms.application_registration WHERE id=$1', [
              consumer.applicationId,
            ])
          ).rows[0].status,
        ).toBe('pending');
        for (const table of ['audit_event', 'outbox_intent', 'enrollment_receipt'])
          expect(
            (
              await client.query(`SELECT id FROM dms.${table} WHERE application_id=$1`, [
                consumer.applicationId,
              ])
            ).rowCount,
          ).toBe(0);
        expect(
          (
            await client.query('SELECT consumed_at FROM dms.enrollment_key WHERE id=$1', [
              consumer.key.keyId,
            ])
          ).rows[0].consumed_at,
        ).toBe(null);
      });
    } finally {
      await owner.query('DROP TRIGGER fixture_outbox ON dms.outbox_intent');
      await owner.query('DROP FUNCTION dms.fixture_fail_outbox()');
    }
    expect((await enroll(consumer, idempotency)).statusCode).toBe(201);
  });

  it('commits local disablement despite an unavailable issuer, then safely retries issuer suspension', async () => {
    const consumer = await createConsumer();
    const idempotency = randomUUID();
    expect((await enroll(consumer, idempotency)).statusCode).toBe(201);
    const partial = await runApplicationCommand(
      { action: 'disable', applicationId: consumer.applicationId },
      { ...process.env, AUTH_ISSUER_URL: undefined },
    );
    expect(partial).toMatchObject({ local: 'disabled', issuer: 'pending' });
    expect((await capability(consumer)).statusCode).toBe(403);
    expect((await enroll(consumer, idempotency)).statusCode).toBe(403);
    expect((await consumer.token()).statusCode).toBe(200);
    const complete = await runApplicationCommand({
      action: 'disable',
      applicationId: consumer.applicationId,
      operatorEmail: email,
      operatorPassword: password,
    });
    expect(complete).toMatchObject({ local: 'disabled', issuer: 'disabled' });
    expect((await consumer.token()).statusCode).toBeGreaterThanOrEqual(400);
  });

  it('issues secrets only to a private file, stores digests/nonsecret evidence, and enforces runtime tenant/privilege limits', async () => {
    const consumer = await createConsumer();
    const folder = await mkdtemp(join(tmpdir(), 'thaarei-enrollment-'));
    try {
      const path = join(folder, 'key.json');
      const command = spawn(
        process.execPath,
        [
          fileURLToPath(
            new URL('../dist/modules/enrollment/manage-application.js', import.meta.url),
          ),
        ],
        { env: process.env, stdio: ['pipe', 'pipe', 'pipe'], timeout: 6000 },
      );
      let output = '';
      command.stdout.on('data', (chunk) => {
        output += chunk;
      });
      command.stderr.on('data', () => {});
      command.stdin.end(
        JSON.stringify({
          action: 'issue-key',
          applicationId: consumer.applicationId,
          credentialFile: path,
        }),
      );
      const [code] = await once(command, 'close');
      expect(code).toBe(0);
      const stored = JSON.parse(await readFile(path, 'utf8'));
      expect((await stat(path)).mode & 0o777).toBe(0o600);
      expect(output.includes(stored.enrollmentKey)).toBe(false);
      const data = await withTenant(owner, tenantId, async (client) =>
        JSON.stringify({
          keys: (
            await client.query('SELECT * FROM dms.enrollment_key WHERE application_id=$1', [
              consumer.applicationId,
            ])
          ).rows,
          events: (await client.query('SELECT * FROM dms.security_event')).rows,
        }),
      );
      for (const secret of [consumer.key.key, consumer.accessToken, stored.enrollmentKey, password])
        expect(data.includes(secret)).toBe(false);
      const runtime = app.get(DmsDatabaseService).pool;
      if (!runtime) throw new Error('Missing pool');
      await expect(
        withTenant(runtime, tenantId, (client) =>
          client.query('UPDATE dms.enrollment_key SET revoked_at=now()'),
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        withTenant(runtime, tenantId, (client) =>
          client.query('DELETE FROM dms.enrollment_receipt'),
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await expect(
        withTenant(runtime, tenantId, (client) =>
          client.query("UPDATE dms.application_registration SET scope_ceiling='{}'"),
        ),
      ).rejects.toMatchObject({ code: '42501' });
      await withTenant(runtime, randomUUID(), async (client) =>
        expect((await client.query('SELECT * FROM dms.enrollment_key')).rows).toHaveLength(0),
      );
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
  describe('I05 document registry and bounded admission', () => {
    const coordinator = new Pool({ connectionString: process.env.DMS_COORDINATOR_DATABASE_URL });
    const policy = {
      enabled: true,
      storageBudgetBytes: 1024 * 1024 * 1024,
      applicationBudgetBytes: 512 * 1024 * 1024,
      scratchBudgetBytes: 4 * 1024 * 1024 * 1024,
      maxFileBytes: 50 * 1024 * 1024,
      activePerApplication: 4,
      activePerTenant: 16,
      queuedWork: 100,
      profiles: ['secure-only'],
      contentTypes: ['application/pdf'],
    };
    const descriptor = {
      title: 'Private candidate',
      fileName: 'report.pdf',
      size: 10,
      contentType: 'application/pdf',
      profile: 'secure-only',
      metadata: { category: 'report' },
    };
    const fresh = (action: string, fields: Record<string, unknown> = {}) =>
      runOperatorCommand({ action, operatorEmail: email, operatorPassword: password, ...fields });
    const coordinated = <T>(work: Parameters<typeof withCoordinator<T>>[2]) =>
      withCoordinator(
        coordinator,
        { tenantId, customerKey: process.env.INSTALLATION_CUSTOMER_KEY as string },
        work,
      );
    const principal = (consumer: Consumer) =>
      app.get(MachineVerifierService).verify(consumer.accessToken);
    const begin = async (consumer: Consumer, body: unknown = descriptor, key = randomUUID()) =>
      app.get(AdmissionService).beginUpload(await principal(consumer), body, key, randomUUID());
    const api = (consumer: Consumer, path: string) =>
      app.inject({ url: path, headers: { authorization: `Bearer ${consumer.accessToken}` } });
    async function consumer() {
      const c = await createConsumer();
      expect((await enroll(c)).statusCode).toBe(201);
      return c;
    }
    async function reset() {
      await withTenant(owner, tenantId, async (db) => {
        await db.query(
          "DELETE FROM dms.outbox_intent WHERE audit_id IN (SELECT id FROM dms.audit_event WHERE resource_type IN ('document','upload-batch'))",
        );
        await db.query(
          "DELETE FROM dms.audit_event WHERE resource_type IN ('document','upload-batch')",
        );
        await db.query('UPDATE dms.processing_run SET active=false,accepted_stage_id=NULL');
        for (const table of [
          'recovery_state',
          'backup_catalog',
          'disposal_intent',
          'lifecycle_receipt',
          'lifecycle_restore',
          'security_assessment_history',
          'document_grant',
          'binary_restore',
          'service_observation',
          'search_generation',
          'security_candidate',
          'extraction_stage',
          'work_attempt',
          'work_dispatch',
          'work_job',
          'processing_run',
          'work_identity',
          'upload_receipt',
          'upload_session',
          'upload_batch_item',
          'upload_batch_slot',
          'upload_batch',
          'upload_admission',
          'document_version',
          'document',
          'admission_application_usage',
          'admission_tenant_usage',
          'admission_capacity',
          'admission_policy',
        ])
          await db.query(`DELETE FROM dms.${table}`);
      });
    }
    beforeAll(async () => {
      await fresh('recover');
    });
    beforeEach(async () => {
      await reset();
      await fresh('admission-policy-set', { expectedRevision: '0', policy });
      await coordinated((tx) => observeCapacity(tx, tmpdir(), tmpdir()));
      await withTenant(owner, tenantId, (db) =>
        db.query(
          'UPDATE dms.admission_capacity SET storage_free_bytes=$1,scratch_free_bytes=$1,shared_device=false',
          [8 * 1024 * 1024 * 1024],
        ),
      );
      vi.spyOn(app.get(AdmissionFeatures), 'uploadLifecycleInstalled').mockReturnValue(false);
      vi.spyOn(app.get(AdmissionFeatures), 'formats').mockReturnValue(['application/pdf']);
      vi.spyOn(app.get(AdmissionFeatures), 'profiles').mockReturnValue(['secure-only']);
    });
    afterEach(() => vi.restoreAllMocks());
    afterAll(async () => {
      await reset();
      await coordinator.end();
    });

    it('projects only verified installed/enabled formats and policy', async () => {
      const c = await consumer();
      const projection = await api(c, '/v1/admission-policy');
      expect(projection.statusCode).toBe(200);
      expect(projection.json()).toMatchObject({
        version: 1,
        revision: '1',
        state: 'not-installed',
        formats: [],
        profiles: [],
        limits: {
          metadataBytes: 16384,
          uploadControlBytes: 32768,
          batchManifestBytes: 262144,
          batchControlBytes: 266240,
        },
      });
      vi.spyOn(app.get(AdmissionFeatures), 'uploadLifecycleInstalled').mockReturnValue(true);
      expect((await api(c, '/v1/admission-policy')).json()).toMatchObject({
        state: 'enabled',
        formats: ['application/pdf'],
        profiles: ['secure-only'],
      });
      await expect(
        begin(c, { ...descriptor, contentType: 'application/x-unverified' }),
      ).rejects.toMatchObject({ status: 403 });
      const inspector = await fresh('admission-policy-read');
      expect(inspector).toMatchObject({ revision: '1' });
      const changed = await fresh('admission-policy-set', {
        expectedRevision: '1',
        policy: { ...policy, enabled: false },
      });
      expect(changed).toMatchObject({ revision: '2', changed: true });
      expect(
        await fresh('admission-policy-set', {
          expectedRevision: '1',
          policy: { ...policy, enabled: false },
        }),
      ).toMatchObject({ revision: '2', changed: false });
      await expect(begin(c)).rejects.toMatchObject({ status: 403 });
    });

    it('serializes capacity across applications without duplicate resources or reservations', async () => {
      const a = await consumer(),
        b = await consumer();
      await fresh('admission-policy-set', {
        expectedRevision: '1',
        policy: {
          ...policy,
          storageBudgetBytes: 20,
          applicationBudgetBytes: 20,
          activePerApplication: 1,
          activePerTenant: 1,
        },
      });
      const results = await Promise.allSettled([begin(a), begin(b)]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
      await withTenant(owner, tenantId, async (db) => {
        expect(
          (await db.query('SELECT reserved_storage,active,queued FROM dms.admission_tenant_usage'))
            .rows[0],
        ).toMatchObject({ reserved_storage: '20', active: 1, queued: 1 });
        for (const table of ['document', 'document_version', 'upload_admission'])
          expect((await db.query(`SELECT id FROM dms.${table}`)).rowCount).toBe(1);
        expect(
          (await db.query("SELECT id FROM dms.audit_event WHERE action='document.admitted'"))
            .rowCount,
        ).toBe(1);
      });
    });

    it('preserves retry identity, rolls back failed admission and allocates revisions under locks', async () => {
      const c = await consumer(),
        key = randomUUID();
      const first = await begin(c, descriptor, key);
      const replay = await begin(c, { ...descriptor, metadata: { category: 'report' } }, key);
      expect(replay.replay).toBe(true);
      expect(replay.receipt.id).toBe(first.receipt.id);
      await expect(begin(c, { ...descriptor, title: 'different' }, key)).rejects.toMatchObject({
        status: 409,
      });
      await expect(
        app
          .get(AdmissionService)
          .beginUpload(await principal(c), descriptor, randomUUID(), randomUUID(), async () => {
            throw new Error('signing unavailable');
          }),
      ).rejects.toThrow('signing unavailable');
      await withTenant(owner, tenantId, async (db) =>
        expect((await db.query('SELECT id FROM dms.upload_admission')).rowCount).toBe(1),
      );
      const second = await begin(c, {
        ...descriptor,
        documentId: first.receipt.document_id,
        expectedRevision: '1',
      });
      expect(second.receipt.document_id).toBe(first.receipt.document_id);
      expect(second.receipt.version_id).not.toBe(first.receipt.version_id);
      await expect(
        begin(c, { ...descriptor, documentId: first.receipt.document_id, expectedRevision: '1' }),
      ).rejects.toMatchObject({ status: 412 });
      await withTenant(owner, tenantId, async (db) =>
        expect(
          (await db.query('SELECT number FROM dms.document_version ORDER BY number')).rows.map(
            (row) => row.number,
          ),
        ).toEqual([1, 2]),
      );
    });

    it('enforces owner policy, bounded reads and unavailable-version isolation over real HTTP', async () => {
      const a = await consumer(),
        b = await consumer();
      const first = await begin(a, {
        ...descriptor,
        assertedHuman: { source: 'application-asserted', subject: 'business-user-42' },
      });
      await begin(a);
      const id = first.receipt.document_id;
      expect((await api(a, `/v1/documents/${id}`)).json()).toMatchObject({
        id,
        currentVersionId: null,
        lifecycle: 'ACTIVE',
        revision: '1',
        downloadable: false,
        searchable: false,
      });
      expect((await api(a, `/v1/documents/${id}`)).headers.etag).toBe('"1"');
      expect((await api(b, `/v1/documents/${id}`)).statusCode).toBe(404);
      expect((await api(b, `/v1/documents/${id}/audit`)).statusCode).toBe(404);
      expect((await api(b, '/v1/documents')).json().items).toEqual([]);
      const page = (await api(a, '/v1/documents?limit=1')).json();
      expect(page.items).toHaveLength(1);
      expect(page.nextCursor).toBeTypeOf('string');
      const next = (await api(a, `/v1/documents?limit=1&cursor=${page.nextCursor}`)).json();
      expect(next.items[0].id).not.toBe(page.items[0].id);
      expect((await api(b, `/v1/documents?cursor=${page.nextCursor}`)).statusCode).toBe(400);
      expect((await api(a, '/v1/documents?limit=51')).statusCode).toBe(400);
      const audit = (await api(a, `/v1/documents/${id}/audit`)).json();
      expect(audit.items[0]).toMatchObject({
        action: 'document.admitted',
        resourceType: 'document',
        assertedHuman: { source: 'application-asserted', subject: 'business-user-42' },
      });
      expect(await fresh('document-inspect', { documentId: id })).toMatchObject({
        id,
        downloadable: false,
      });
      const machine = await principal(b);
      await expect(
        app
          .get(AdmissionService)
          .beginUpload(
            machine,
            { ...descriptor, documentId: id, expectedRevision: '1' },
            randomUUID(),
            randomUUID(),
          ),
      ).rejects.toMatchObject({ status: 404 });
      await expect(
        app
          .get(DmsDatabaseService)
          .withMachine(await principal(a), ['dms:documents:write'], (tx) =>
            tx.client.query('UPDATE dms.document SET current_version_id=$1 WHERE id=$2', [
              first.receipt.version_id,
              id,
            ]),
          ),
      ).rejects.toMatchObject({ code: '42501' });
    });

    it('blocks stale/failed/shared-device capacity observations and oversized control metadata', async () => {
      const c = await consumer();
      await withTenant(owner, tenantId, (db) =>
        db.query("UPDATE dms.admission_capacity SET observed_at=now()-interval '31 seconds'"),
      );
      await expect(begin(c)).rejects.toMatchObject({ status: 503 });
      await expect(
        coordinated((tx) => observeCapacity(tx, '/nonexistent-dms-capacity-fixture', tmpdir())),
      ).rejects.toThrow();
      await expect(begin(c)).rejects.toMatchObject({ status: 503 });
      let release = () => {};
      let ready = () => {};
      const locked = new Promise<void>((resolve) => {
        ready = resolve;
      });
      const blocker = coordinated(async (tx) => {
        await tx.client.query('SELECT tenant_id FROM dms.admission_tenant_usage FOR UPDATE');
        ready();
        await new Promise<void>((resolve) => {
          release = resolve;
        });
      });
      await locked;
      await withTenant(owner, tenantId, (db) =>
        db.query(
          "UPDATE dms.admission_capacity SET observed_at=clock_timestamp()-interval '29.5 seconds'",
        ),
      );
      const waiting = begin(c).then(
        () => null,
        (error) => error,
      );
      await new Promise((resolve) => setTimeout(resolve, 1500));
      release();
      await blocker;
      expect(await waiting).toMatchObject({ status: 503 }); // lock waits cannot extend the observation lease
      await coordinated((tx) => observeCapacity(tx, tmpdir(), tmpdir()));
      await withTenant(owner, tenantId, (db) =>
        db.query(
          'UPDATE dms.admission_capacity SET shared_device=true,storage_free_bytes=$1,scratch_free_bytes=$1',
          [256 * 1024 * 1024 + 10],
        ),
      );
      await expect(begin(c)).rejects.toMatchObject({ status: 429 });
      await expect(
        begin(c, { ...descriptor, metadata: { large: Array(20).fill('x'.repeat(2048)) } }),
      ).rejects.toMatchObject({ status: 400 });
      await withTenant(owner, tenantId, async (db) =>
        expect((await db.query('SELECT id FROM dms.document')).rowCount).toBe(0),
      );
      await coordinated((tx) => observeCapacity(tx, tmpdir(), tmpdir()));
      await withTenant(owner, tenantId, (db) =>
        db.query(
          'UPDATE dms.admission_capacity SET shared_device=false,storage_free_bytes=$1,scratch_free_bytes=$1',
          [8 * 1024 * 1024 * 1024],
        ),
      );
      const envelope = {
        ...descriptor,
        title: 'T'.repeat(240),
        fileName: `${'F'.repeat(251)}.pdf`,
        metadata: { items: Array(8).fill('x'.repeat(2000)) },
      };
      expect(Buffer.byteLength(JSON.stringify(envelope))).toBeGreaterThan(16384);
      expect((await begin(c, envelope)).receipt.state).toBe('RESERVED');
    });

    it('reconciles measured usage once, retains scan budgets and prevents live-capability release', async () => {
      const c = await consumer(),
        other = await consumer();
      await fresh('admission-policy-set', {
        expectedRevision: '1',
        policy: { ...policy, queuedWork: 1 },
      });
      const key = randomUUID();
      const admission = await begin(c, descriptor, key);
      const id = admission.receipt.id;
      await app
        .get(DmsDatabaseService)
        .withMachine(await principal(c), ['dms:documents:write'], (tx) =>
          tx.client.query(
            "UPDATE dms.upload_admission SET capability_expires_at=now()+interval '5 minutes' WHERE id=$1",
            [id],
          ),
        );
      await expect(
        coordinated((tx) =>
          reconcileAdmission(tx, id, { stagingBytes: 0, originalBytes: 0 }, 'RELEASED'),
        ),
      ).rejects.toThrow(/still live/);
      expect(
        await coordinated((tx) =>
          reconcileAdmission(tx, id, { stagingBytes: 10, originalBytes: 10 }, 'SETTLED'),
        ),
      ).toEqual({ changed: true });
      expect(
        await coordinated((tx) =>
          reconcileAdmission(tx, id, { stagingBytes: 10, originalBytes: 10 }, 'SETTLED'),
        ),
      ).toEqual({ changed: false });
      await withTenant(owner, tenantId, async (db) =>
        expect(
          (
            await db.query(
              'SELECT reserved_storage,staging_bytes,original_bytes,active,queued,reserved_scratch FROM dms.admission_tenant_usage',
            )
          ).rows[0],
        ).toMatchObject({
          reserved_storage: '0',
          staging_bytes: '10',
          original_bytes: '10',
          active: 0,
          queued: 1,
          reserved_scratch: String(256 * 1024 * 1024),
        }),
      );
      await expect(begin(other)).rejects.toMatchObject({ status: 429 });
      expect(await coordinated((tx) => releaseWorkReservation(tx, id))).toEqual({ changed: true });
      expect(await coordinated((tx) => releaseWorkReservation(tx, id))).toEqual({ changed: false });
      await withTenant(owner, tenantId, async (db) =>
        expect(
          (await db.query('SELECT queued,reserved_scratch FROM dms.admission_tenant_usage'))
            .rows[0],
        ).toEqual({ queued: 0, reserved_scratch: '0' }),
      );
      expect((await api(c, `/v1/documents/${admission.receipt.document_id}`)).json()).toMatchObject(
        { downloadable: false, searchable: false, currentVersionId: null },
      );
      await begin(other);
      const replay = await begin(c, descriptor, key);
      expect(replay.replay).toBe(true);
      expect(replay.receipt.id).toBe(id);
      expect(replay.receipt.state).toBe('SETTLED');
    });

    it('keeps admission policy/settlement privileged and rejects cross-tenant references', async () => {
      const c = await consumer();
      const result = await begin(c);
      const database = app.get(DmsDatabaseService);
      for (const sql of [
        'UPDATE dms.admission_policy SET revision=revision+1',
        'UPDATE dms.admission_capacity SET observed_at=now()',
        "UPDATE dms.upload_admission SET state='SETTLED'",
        "UPDATE dms.document_version SET availability='AVAILABLE'",
      ])
        await expect(
          database.withMachine(await principal(c), ['dms:documents:write'], (tx) =>
            tx.client.query(sql),
          ),
        ).rejects.toMatchObject({ code: '42501' });
      const ungrantedEmail = 'admission-ungranted-admin@example.test';
      await provisionUser(
        auth(),
        {
          email: ungrantedEmail,
          name: 'Ungrantable by authority role alone',
          role: 'admin',
          password,
        },
        config.AUTH_PUBLIC_ORIGIN,
      );
      const verification = smtp.link('verify');
      expect(
        (await app.inject({ url: verification.pathname + verification.search })).statusCode,
      ).toBe(302);
      const proof = { operatorEmail: ungrantedEmail, operatorPassword: password };
      await expect(
        runOperatorCommand({
          ...proof,
          action: 'admission-policy-set',
          expectedRevision: '1',
          policy,
        }),
      ).rejects.toThrow(/operator authorization/);
      await expect(
        runOperatorCommand({
          ...proof,
          action: 'document-inspect',
          documentId: result.receipt.document_id,
        }),
      ).rejects.toThrow(/operator authorization/);
      const alien = randomUUID();
      await expect(
        withTenant(owner, alien, (db) =>
          db.query(
            'INSERT INTO dms.document_version (id,tenant_id,application_id,document_id,number,size,content_type,file_name) VALUES ($1,$2,$3,$4,1,10,$5,$6)',
            [
              randomUUID(),
              alien,
              c.applicationId,
              result.receipt.document_id,
              'application/pdf',
              'report.pdf',
            ],
          ),
        ),
      ).rejects.toMatchObject({ code: '23503' });
      await expect(
        withCoordinator(
          database.pool as Pool,
          { tenantId, customerKey: process.env.INSTALLATION_CUSTOMER_KEY as string },
          async () => undefined,
        ),
      ).rejects.toThrow(/Unsafe/);
      await expect(
        withCoordinator(
          coordinator,
          { tenantId: randomUUID(), customerKey: process.env.INSTALLATION_CUSTOMER_KEY as string },
          async () => undefined,
        ),
      ).rejects.toThrow(/mismatch/);
    });

    describe('I06 upload and batch lifecycle over real storage', () => {
      let fixture: Awaited<ReturnType<typeof uploadStorageFixture>>;
      const req = (
        c: Consumer,
        method: 'GET' | 'POST' | 'DELETE',
        url: string,
        payload?: object,
        key = randomUUID(),
      ) =>
        app.inject({
          method,
          url,
          headers: { authorization: `Bearer ${c.accessToken}`, 'idempotency-key': key },
          ...(payload ? { payload } : {}),
        });
      const createBatch = (c: Consumer, n = 2, key = randomUUID()) =>
        req(
          c,
          'POST',
          '/v1/upload-batches',
          {
            items: Array.from({ length: n }, (_, i) => ({
              itemId: `file-${i}`,
              operation: 'create',
              descriptor,
            })),
          },
          key,
        );
      const start = (c: Consumer, body: object = descriptor, key = randomUUID()) =>
        req(c, 'POST', '/v1/uploads', body, key);
      beforeAll(async () => {
        fixture = await uploadStorageFixture();
        for (const [key, value] of Object.entries(fixture.environment))
          if (key.startsWith('DMS_STORAGE_') && value !== undefined) vi.stubEnv(key, value);
      }, 30000);
      afterAll(async () => {
        await fixture?.close();
      });
      beforeEach(() => {
        vi.spyOn(app.get(AdmissionFeatures), 'uploadLifecycleInstalled').mockReturnValue(true);
      });

      it('issues a bounded real create-only PUT and acknowledges repeat completion without publication', async () => {
        const c = await consumer(),
          key = randomUUID();
        const begun = await start(c, { ...descriptor, sha256: 'a'.repeat(64) }, key);
        expect(begun.statusCode).toBe(201);
        const result = begun.json(),
          cap = result.transfer,
          id = result.session.id;
        expect(begun.headers['cache-control']).toBe('private, no-store');
        expect(begun.headers.location).toBe(`/v1/uploads/${id}`);
        expect(new URL(cap.url).searchParams.get('X-Amz-SignedHeaders')).toBe(
          'content-length;content-type;host;if-none-match',
        );
        expect(new Date(cap.expiresAt).getTime()).toBeLessThanOrEqual(
          new Date(result.session.expiresAt).getTime(),
        );
        const bytes = Buffer.from('0123456789');
        expect(
          (await fetch(cap.url, { method: 'PUT', headers: cap.headers, body: bytes })).status,
        ).toBe(200);
        expect(
          (await fetch(cap.url, { method: 'PUT', headers: cap.headers, body: bytes })).status,
        ).toBe(412);
        expect((await req(c, 'GET', `/v1/uploads/${id}`)).json()).toMatchObject({
          id,
          upload: 'INITIATED',
          security: 'PENDING',
          availability: 'CANDIDATE',
          completionRequested: false,
        });
        const completeKey = randomUUID();
        const completed = await req(c, 'POST', `/v1/uploads/${id}/complete`, {}, completeKey);
        expect(completed.statusCode).toBe(202);
        expect(completed.headers).toMatchObject({
          location: `/v1/uploads/${id}`,
          'retry-after': '2',
        });
        const completeReplay = await req(c, 'POST', `/v1/uploads/${id}/complete`, {}, completeKey);
        expect(completeReplay.json().operationId).toBe(completed.json().operationId);
        expect(completed.json()).toMatchObject({
          transfer: null,
          session: {
            upload: 'INITIATED',
            security: 'PENDING',
            availability: 'CANDIDATE',
            completionRequested: true,
          },
        });
        expect((await req(c, 'POST', `/v1/uploads/${id}/refresh`, {})).json().transfer).toBeNull();
        const replay = await start(c, { ...descriptor, sha256: 'a'.repeat(64) }, key);
        expect(replay.statusCode).toBe(200);
        expect(replay.json()).toMatchObject({
          operationId: result.operationId,
          transfer: null,
          session: { id },
        });
        const stored = await withTenant(owner, tenantId, async (db) =>
          JSON.stringify({
            sessions: (await db.query('SELECT * FROM dms.upload_session')).rows,
            receipts: (await db.query('SELECT * FROM dms.upload_receipt')).rows,
            audit: (await db.query('SELECT * FROM dms.audit_event')).rows,
            outbox: (await db.query('SELECT * FROM dms.outbox_intent')).rows,
          }),
        );
        expect(stored).not.toContain(cap.url);
        expect(stored).not.toContain('X-Amz-Signature');
        expect(stored).toContain('a'.repeat(64));
        expect(await fresh('upload-inspect', { uploadId: id })).toMatchObject({
          id,
          security: 'PENDING',
          completionRequested: true,
        });
        expect((await api(c, `/v1/documents/${result.session.documentId}`)).json()).toMatchObject({
          currentVersionId: null,
          downloadable: false,
          searchable: false,
        });
      });

      it('serializes concurrent identical begins and rejects changed request hashes', async () => {
        const c = await consumer(),
          key = randomUUID();
        const [a, b] = await Promise.all([start(c, descriptor, key), start(c, descriptor, key)]);
        expect([a.statusCode, b.statusCode].sort()).toEqual([200, 201]);
        expect(a.json().session.id).toBe(b.json().session.id);
        expect((await start(c, { ...descriptor, sha256: 'b'.repeat(64) }, key)).json().code).toBe(
          'IDEMPOTENCY_CONFLICT',
        );
        await withTenant(owner, tenantId, async (db) => {
          expect((await db.query('SELECT id FROM dms.document')).rowCount).toBe(1);
          expect((await db.query('SELECT id FROM dms.upload_session')).rowCount).toBe(1);
          expect(
            (await db.query('SELECT active,reserved_storage FROM dms.admission_tenant_usage'))
              .rows[0],
          ).toMatchObject({ active: 1, reserved_storage: '20' });
        });
      });

      it('rolls back IDs and reservations when capability issuance fails', async () => {
        const c = await consumer();
        vi.spyOn(app.get(StorageService).forRole('upload'), 'upload').mockRejectedValueOnce(
          new Error('Unavailable fixture signing'),
        );
        expect((await start(c)).statusCode).toBe(503);
        await withTenant(owner, tenantId, async (db) => {
          expect((await db.query('SELECT id FROM dms.document')).rowCount).toBe(0);
          expect((await db.query('SELECT id FROM dms.upload_session')).rowCount).toBe(0);
          expect(
            (await db.query('SELECT active FROM dms.admission_tenant_usage')).rows[0].active,
          ).toBe(0);
        });
      });

      it('orders cancellation against completion and never revives a terminal session or frees live bytes', async () => {
        const c = await consumer(),
          key = randomUUID();
        const begun = (await start(c, descriptor, key)).json(),
          id = begun.session.id;
        const outcomes = await Promise.all([
          req(c, 'POST', `/v1/uploads/${id}/complete`, {}),
          req(c, 'DELETE', `/v1/uploads/${id}`),
        ]);
        expect(outcomes.map((r) => r.statusCode).sort()).toEqual([200, 202]);
        expect((await req(c, 'GET', `/v1/uploads/${id}`)).json().upload).toBe('CANCELLED');
        expect((await req(c, 'POST', `/v1/uploads/${id}/refresh`, {})).json().transfer).toBeNull();
        expect((await start(c, descriptor, key)).json()).toMatchObject({
          transfer: null,
          session: { id, upload: 'CANCELLED' },
        });
        expect((await req(c, 'POST', `/v1/uploads/${id}/complete`, {})).json().session.upload).toBe(
          'CANCELLED',
        );
        await withTenant(owner, tenantId, async (db) =>
          expect(
            (await db.query('SELECT active,reserved_storage FROM dms.admission_tenant_usage'))
              .rows[0],
          ).toMatchObject({ active: 1, reserved_storage: '20' }),
        );
      });

      it('expires sessions by current time and limits refresh to live registration and policy', async () => {
        const c = await consumer(),
          other = await consumer();
        const { session } = (await start(c)).json();
        expect((await req(other, 'GET', `/v1/uploads/${session.id}`)).statusCode).toBe(404);
        await fresh('admission-policy-set', {
          expectedRevision: '1',
          policy: { ...policy, enabled: false },
        });
        expect((await req(c, 'POST', `/v1/uploads/${session.id}/refresh`, {})).json().code).toBe(
          'POLICY_DENIED',
        );
        await fresh('admission-policy-set', { expectedRevision: '2', policy });
        await withTenant(owner, tenantId, (db) =>
          db.query(
            "UPDATE dms.upload_admission SET capability_expires_at=NULL,expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
            [session.id],
          ),
        );
        expect(
          (await req(c, 'POST', `/v1/uploads/${session.id}/refresh`, {})).json(),
        ).toMatchObject({ transfer: null, session: { upload: 'EXPIRED' } });
        expect(
          (await req(c, 'POST', `/v1/uploads/${session.id}/complete`, {})).json().session.upload,
        ).toBe('EXPIRED');
        await withTenant(owner, tenantId, (db) =>
          db.query("UPDATE dms.application_registration SET status='disabled' WHERE id=$1", [
            c.applicationId,
          ]),
        );
        expect((await req(c, 'GET', `/v1/uploads/${session.id}`)).statusCode).toBe(403);
      });

      it('keeps manifests allocation-free, binds each item once and reports isolated admission delay', async () => {
        const c = await consumer(),
          key = randomUUID();
        const created = await createBatch(c, 2, key);
        expect(created.statusCode).toBe(201);
        const batch = created.json().batch;
        await withTenant(owner, tenantId, async (db) => {
          expect((await db.query('SELECT id FROM dms.document')).rowCount).toBe(0);
          expect(
            (await db.query('SELECT active FROM dms.admission_tenant_usage')).rows[0].active,
          ).toBe(0);
        });
        const firstBody = { ...descriptor, batchId: batch.id, itemId: 'file-0' },
          firstKey = randomUUID();
        const [a, b] = await Promise.all([
          start(c, firstBody, firstKey),
          start(c, firstBody, firstKey),
        ]);
        expect([a.statusCode, b.statusCode].sort()).toEqual([200, 201]);
        expect(a.json().session.id).toBe(b.json().session.id);
        expect((await start(c, firstBody)).json().code).toBe('BATCH_ITEM_BOUND');
        expect((await start(c, { ...firstBody, title: 'Different item' })).json().code).toBe(
          'IDEMPOTENCY_CONFLICT',
        );
        await withTenant(owner, tenantId, (db) =>
          db.query('UPDATE dms.admission_capacity SET storage_free_bytes=1'),
        );
        expect(
          (await start(c, { ...descriptor, batchId: batch.id, itemId: 'file-1' })).statusCode,
        ).toBe(429);
        const status = (await req(c, 'GET', `/v1/upload-batches/${batch.id}?limit=1`)).json();
        expect(status.counts.items).toMatchObject({ BOUND: 1, UNSTARTED: 1 });
        expect(status.counts.upload.INITIATED).toBe(1);
        expect(await fresh('batch-inspect', { batchId: batch.id, limit: 1 })).toMatchObject({
          id: batch.id,
          counts: { items: { BOUND: 1, UNSTARTED: 1 } },
          nextAfter: 0,
        });
        const next = (
          await req(c, 'GET', `/v1/upload-batches/${batch.id}?limit=1&cursor=${status.nextCursor}`)
        ).json();
        expect(next.items[0]).toMatchObject({
          itemId: 'file-1',
          admissionError: 'CAPACITY_EXCEEDED',
          retryAfterSeconds: 2,
        });
        const replay = await createBatch(c, 2, key);
        expect(replay.statusCode).toBe(200);
        expect(replay.json().operationId).toBe(created.json().operationId);
        expect((await createBatch(c, 1, key)).json().code).toBe('IDEMPOTENCY_CONFLICT');
        const otherBatch = (await createBatch(c, 1)).json().batch;
        expect(
          (await req(c, 'GET', `/v1/upload-batches/${otherBatch.id}?cursor=${status.nextCursor}`))
            .statusCode,
        ).toBe(400);
        const foreign = await consumer();
        expect((await req(foreign, 'GET', `/v1/upload-batches/${batch.id}`)).statusCode).toBe(404);
      });

      it('orders batch close against session creation and preserves bound retries', async () => {
        const c = await consumer(),
          batch = (await createBatch(c)).json().batch,
          key = randomUUID(),
          closeKey = randomUUID();
        const body = { ...descriptor, batchId: batch.id, itemId: 'file-0' };
        const [started, closed] = await Promise.all([
          start(c, body, key),
          req(c, 'POST', `/v1/upload-batches/${batch.id}/close`, {}, closeKey),
        ]);
        expect(closed.statusCode).toBe(200);
        expect([201, 409]).toContain(started.statusCode);
        const status = (await req(c, 'GET', `/v1/upload-batches/${batch.id}`)).json();
        expect(status.state).toBe('CLOSED');
        expect(status.items[1].state).toBe('CLOSED');
        expect(
          (await start(c, { ...descriptor, batchId: batch.id, itemId: 'file-1' })).json().code,
        ).toBe('BATCH_CLOSED');
        if (started.statusCode === 201) {
          expect(status.items[0].session.id).toBe(started.json().session.id);
          expect((await start(c, body, key)).json().session.id).toBe(started.json().session.id);
        } else expect(status.items[0].session).toBeNull();
        const replay = await req(c, 'POST', `/v1/upload-batches/${batch.id}/close`, {}, closeKey);
        expect(replay.json().operationId).toBe(closed.json().operationId);
      });

      it('cancels only eligible batch sessions and closes unstarted items without deleting registry records', async () => {
        const c = await consumer(),
          batch = (await createBatch(c)).json().batch;
        const started = (
          await start(c, { ...descriptor, batchId: batch.id, itemId: 'file-0' })
        ).json();
        await req(c, 'POST', `/v1/uploads/${started.session.id}/complete`, {});
        const cancelled = await req(c, 'DELETE', `/v1/upload-batches/${batch.id}`);
        expect(cancelled.statusCode).toBe(200);
        expect(cancelled.json().batch).toMatchObject({
          state: 'CANCELLED',
          counts: { items: { BOUND: 1, CANCELLED: 1 }, upload: { CANCELLED: 1 } },
        });
        expect((await api(c, `/v1/documents/${started.session.documentId}`)).statusCode).toBe(200);
        expect(
          (await req(c, 'POST', `/v1/uploads/${started.session.id}/refresh`, {})).json().transfer,
        ).toBeNull();
      });

      it('bounds manifest size, item identity and concurrent open batches without charging bytes', async () => {
        const c = await consumer();
        expect((await createBatch(c, 101)).statusCode).toBe(400);
        expect(
          (
            await req(c, 'POST', '/v1/upload-batches', {
              items: [
                { itemId: 'same', operation: 'create', descriptor },
                { itemId: 'same', operation: 'create', descriptor },
              ],
            })
          ).statusCode,
        ).toBe(400);
        const results = await Promise.all(Array.from({ length: 5 }, () => createBatch(c, 1)));
        expect(results.filter((r) => r.statusCode === 201)).toHaveLength(4);
        expect(results.filter((r) => r.statusCode === 429)).toHaveLength(1);
        const id = results.find((r) => r.statusCode === 201)?.json().batch.id;
        await withTenant(owner, tenantId, async (db) => {
          await db.query(
            "UPDATE dms.upload_batch SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
            [id],
          );
          await db.query(
            "UPDATE dms.upload_batch_slot SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
            [id],
          );
        });
        expect((await req(c, 'GET', `/v1/upload-batches/${id}`)).json()).toMatchObject({
          state: 'EXPIRED',
          counts: { items: { EXPIRED: 1 } },
        });
        expect((await createBatch(c, 1)).statusCode).toBe(201);
        for (let group = 0; group < 3; group++) {
          const other = await consumer();
          const opened = await Promise.all(Array.from({ length: 4 }, () => createBatch(other, 1)));
          expect(opened.every((r) => r.statusCode === 201)).toBe(true);
        }
        expect((await createBatch(await consumer(), 1)).statusCode).toBe(429);

        expect(
          (
            await req(c, 'POST', '/v1/upload-batches', {
              items: [
                {
                  itemId: 'oversize',
                  operation: 'create',
                  descriptor: { ...descriptor, title: 'X'.repeat(270000) },
                },
              ],
            })
          ).statusCode,
        ).toBe(413);
        expect((await start(c, { ...descriptor, title: 'X'.repeat(33000) })).statusCode).toBe(413);
      });

      it('accepts metadata envelope overhead while bounding the manifest independently', async () => {
        const c = await consumer();
        const envelope = {
          ...descriptor,
          title: 'T'.repeat(240),
          fileName: `${'F'.repeat(251)}.pdf`,
          metadata: { items: Array(8).fill('x'.repeat(2000)) },
        };
        expect(Buffer.byteLength(JSON.stringify(envelope))).toBeGreaterThan(16384);
        expect((await start(c, envelope)).statusCode).toBe(201);
        const items = Array.from({ length: 2 }, (_, i) => ({
          itemId: `large-${i}`,
          operation: 'create',
          descriptor: envelope,
        }));
        expect((await req(c, 'POST', '/v1/upload-batches', { items })).statusCode).toBe(201);
        const tooLarge = Array.from({ length: 16 }, (_, i) => ({
          itemId: `bound-${i}`,
          operation: 'create',
          descriptor: { ...descriptor, metadata: { items: Array(8).fill('x'.repeat(2040)) } },
        }));
        expect(Buffer.byteLength(JSON.stringify(tooLarge))).toBeGreaterThan(262144);
        expect(Buffer.byteLength(JSON.stringify({ items: tooLarge }))).toBeLessThan(266240);
        expect((await req(c, 'POST', '/v1/upload-batches', { items: tooLarge })).statusCode).toBe(
          400,
        );
      });

      it('keeps unsupported formats closed and rechecks current scopes on replay and refresh', async () => {
        const c = await consumer(),
          key = randomUUID();
        vi.spyOn(app.get(AdmissionFeatures), 'formats').mockReturnValue([]);
        expect((await start(c, descriptor, key)).statusCode).toBe(503);
        vi.spyOn(app.get(AdmissionFeatures), 'formats').mockReturnValue(['application/pdf']);
        const started = (await start(c, descriptor, key)).json();
        await withTenant(owner, tenantId, (db) =>
          db.query(
            "UPDATE dms.application_registration SET scope_ceiling=ARRAY['dms:capabilities:read','dms:audit:read','dms:documents:read'] WHERE id=$1",
            [c.applicationId],
          ),
        );
        expect((await start(c, descriptor, key)).statusCode).toBe(403);
        expect(
          (await req(c, 'POST', `/v1/uploads/${started.session.id}/refresh`, {})).statusCode,
        ).toBe(403);
      });

      it('does not mint capabilities after trusted reservation settlement even before a completion callback', async () => {
        const c = await consumer(),
          key = randomUUID();
        const started = (await start(c, descriptor, key)).json(),
          id = started.session.id;
        await coordinated((tx) =>
          reconcileAdmission(tx, id, { stagingBytes: 10, originalBytes: 10 }, 'SETTLED'),
        );
        const signer = vi.spyOn(app.get(StorageService).forRole('upload'), 'upload');
        expect((await req(c, 'POST', `/v1/uploads/${id}/refresh`, {})).json().transfer).toBeNull();
        expect((await start(c, descriptor, key)).json()).toMatchObject({
          transfer: null,
          session: { id, completionRequested: false },
        });
        expect(signer).not.toHaveBeenCalled();
      });

      it('returns retryable conflict for in-flight receipts and preserves their disclosed expiry', async () => {
        const c = await consumer(),
          key = randomUUID();
        let release = () => {},
          ready = () => {};
        const locked = new Promise<void>((r) => {
          ready = r;
        });
        const blocker = withTenant(owner, tenantId, async (db) => {
          await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [
            `dms-upload-receipt:${tenantId}:${c.applicationId}:batch.create:${hash(key)}`,
          ]);
          ready();
          await new Promise<void>((r) => {
            release = r;
          });
        });
        await locked;
        try {
          const response = await createBatch(c, 1, key);
          expect(response.statusCode).toBe(409);
          expect(response.headers['retry-after']).toBe('1');
          expect(response.json()).toMatchObject({ code: 'ADMISSION_IN_PROGRESS', retryable: true });
        } finally {
          release();
          await blocker;
        }
        expect((await createBatch(c, 1, key)).statusCode).toBe(201);
        await withTenant(owner, tenantId, (db) =>
          db.query(
            "UPDATE dms.upload_receipt SET expires_at=clock_timestamp()-interval '1 second' WHERE key_hash=$1",
            [hash(key)],
          ),
        );
        expect((await createBatch(c, 1, key)).json().code).toBe('REPLAY_WINDOW_EXPIRED');
      });

      it('enforces owner RLS and prevents rewriting immutable session keys/descriptors or receipts', async () => {
        const a = await consumer(),
          b = await consumer(),
          started = (await start(a)).json();
        const database = app.get(DmsDatabaseService);
        await database.withMachine(await principal(b), ['dms:documents:read'], async (tx) =>
          expect((await tx.client.query('SELECT id FROM dms.upload_session')).rowCount).toBe(0),
        );
        for (const sql of [
          'UPDATE dms.upload_session SET staging_id=gen_random_uuid()',
          "UPDATE dms.upload_session SET descriptor='{}'::jsonb",
          'DELETE FROM dms.upload_session',
          'DELETE FROM dms.upload_receipt',
        ])
          await expect(
            database.withMachine(await principal(a), ['dms:documents:write'], (tx) =>
              tx.client.query(sql),
            ),
          ).rejects.toMatchObject({ code: '42501' });
        expect(
          (await req(b, 'POST', `/v1/uploads/${started.session.id}/complete`, {})).statusCode,
        ).toBe(404);
      });

      describe('I07 authoritative work over real private HTTP and RabbitMQ', () => {
        let privateApp: NestFastifyApplication,
          mq: Awaited<ReturnType<typeof workBrokerFixture>>,
          origin: string;
        const workers: Array<ReturnType<Awaited<ReturnType<typeof workBrokerFixture>>['worker']>> =
          [];
        const identities = new Map<WorkRole, { clientId: string; secret: string; token: string }>();
        const work = () => privateApp.get(WorkService);
        const tokenRefreshes = new Map<WorkRole, Promise<void>>();
        async function workToken(role: WorkRole) {
          const identity = identities.get(role);
          if (!identity) throw new Error('Missing private fixture identity');
          const expiry = identity.token
            ? Number(
                JSON.parse(Buffer.from(identity.token.split('.')[1] ?? '', 'base64url').toString())
                  .exp,
              ) * 1000
            : 0;
          if (!Number.isFinite(expiry) || expiry <= Date.now() + 30000) {
            let pending = tokenRefreshes.get(role);
            if (!pending) {
              pending = (async () => {
                const response = await app.inject({
                  method: 'POST',
                  url: '/identity/oauth2/token',
                  headers: {
                    authorization: `Basic ${Buffer.from(`${identity.clientId}:${identity.secret}`).toString('base64')}`,
                    'content-type': 'application/x-www-form-urlencoded',
                  },
                  payload: new URLSearchParams({
                    grant_type: 'client_credentials',
                    scope: WORK_ROLE_SCOPE[role],
                    resource: `${config.AUTH_ISSUER_URL}/services/work`,
                  }).toString(),
                });
                expect(response.statusCode).toBe(200);
                identity.token = response.json().access_token;
              })().finally(() => {
                tokenRefreshes.delete(role);
              });
              tokenRefreshes.set(role, pending);
            }
            await pending;
          }
          return identity.token;
        }
        const call = async (role: WorkRole, path: string, body: unknown = {}) =>
          privateApp.inject({
            method: 'POST',
            url: `/internal/work${path}`,
            headers: { authorization: `Bearer ${await workToken(role)}` },
            payload: body as object,
          });
        const environment = (role: WorkRole) => ({
          DMS_WORK_API_URL: `${origin}/internal/work`,
          DMS_WORK_ISSUER_URL: config.AUTH_ISSUER_URL,
          DMS_WORK_CLIENT_ID: identities.get(role)?.clientId,
          DMS_WORK_CLIENT_SECRET: identities.get(role)?.secret,
          DMS_WORK_ROLE: role,
          DMS_WORK_ALLOW_HTTP: 'true',
        });
        const brokerWorker = (mode = 'unsupported') => {
          const worker = mq.worker(environment('scanner'), mode);
          workers.push(worker);
          return worker;
        };
        const publish = () =>
          mq.python(['turnstile-processing', 'publisher-once'], environment('publisher'));
        const state = (id: string) =>
          withTenant(
            owner,
            tenantId,
            async (db) => (await db.query('SELECT * FROM dms.work_job WHERE id=$1', [id])).rows[0],
          );
        async function waitFor<T>(
          read: () => Promise<T>,
          predicate: (value: T) => boolean,
          timeout = 15000,
        ) {
          const until = Date.now() + timeout;
          let latest = await read();
          while (!predicate(latest) && Date.now() < until) {
            await new Promise((r) => setTimeout(r, 100));
            latest = await read();
          }
          expect(predicate(latest), 'Expected bounded work transition').toBe(true);
          return latest;
        }
        async function queued(
          task: 'document.scan' | 'document.extract' | 'document.heavy' = 'document.scan',
        ) {
          const c = await consumer(),
            begun = (await start(c)).json(),
            job = await work().internal((tx) => enqueueWork(tx, begun.session.id, task));
          return { c, begun, job };
        }
        async function envelope() {
          const item = (await call('publisher', '/dispatches/claim')).json().items[0];
          expect(item).toBeDefined();
          return item.dispatch;
        }
        beforeAll(async () => {
          vi.stubEnv('DMS_WORK_ISSUER_URL', config.AUTH_ISSUER_URL);
          vi.stubEnv('DMS_WORK_ALLOW_HTTP', 'true');
          privateApp = await createWorkApplication();
          await privateApp.listen(0, '127.0.0.1');
          origin = await privateApp.getUrl();
          mq = await workBrokerFixture();
          for (const role of ['publisher', 'scanner', 'extractor', 'heavy'] as const) {
            const clientId = `work-${role}-${randomBytes(6).toString('hex')}`;
            const result = await manageOAuthClient(auth(), config, operator, {
              action: 'issue',
              kind: `work_${role}`,
              clientId,
              applicationId: randomUUID(),
              scopes: [WORK_ROLE_SCOPE[role]],
            });
            if (!result.secret) throw new Error('Missing private client secret');
            identities.set(role, { clientId, secret: result.secret, token: '' });
            await workToken(role);
          }
        }, 60000);
        beforeEach(async () => {
          await mq.reset();
          await withTenant(owner, tenantId, async (db) => {
            for (const [role, identity] of identities)
              await db.query(
                'INSERT INTO dms.work_identity (id,tenant_id,issuer,client_id,role,enabled) VALUES ($1,$2,$3,$4,$5,true)',
                [randomUUID(), tenantId, config.AUTH_ISSUER_URL, identity.clientId, role],
              );
          });
        });
        afterEach(() => {
          for (const worker of workers.splice(0)) worker.stop();
        });
        afterAll(async () => {
          await privateApp?.close();
          await mq?.close();
        });

        it.skipIf(process.env.DMS_TEST_NATIVE_OCR !== 'true').each([
          { contentType: 'image/png', profile: 'searchable' },
          { contentType: 'application/pdf', profile: 'searchable' },
          ...(process.env.DMS_TEST_NATIVE_STRUCTURE === 'true'
            ? [
                { contentType: 'image/png', profile: 'structured' },
                { contentType: 'application/pdf', profile: 'structured' },
              ]
            : []),
        ] as const)(
          'I15/I16 routes $contentType $profile through bounded production heavy processing',
          async ({ contentType, profile }) => {
            const previousStructureFlag = process.env.DMS_STRUCTURE_ENABLED;
            if (profile === 'structured') vi.stubEnv('DMS_STRUCTURE_ENABLED', 'true');
            let observing: Promise<unknown> | undefined;
            let observationError: unknown;
            const capacityPulse = setInterval(() => {
              if (observing) return;
              observing = coordinated((tx) => observeCapacity(tx, tmpdir(), tmpdir()))
                .catch((error) => {
                  observationError = error;
                })
                .finally(() => {
                  observing = undefined;
                });
            }, 5000);
            const folder = await mkdtemp(join(tmpdir(), 'dms-ocr-owning-'));
            try {
              const path = join(folder, 'source');
              await mq.python(
                [
                  'python',
                  'tests/make_ocr_fixture.py',
                  '--output',
                  path,
                  ...(contentType === 'application/pdf' ? ['--pdf'] : []),
                ],
                {},
              );
              const bytes = await readFile(path),
                digest = createHash('sha256').update(bytes).digest('hex'),
                c = await consumer();
              await fresh('admission-policy-set', {
                expectedRevision: '1',
                policy: {
                  ...policy,
                  contentTypes: [contentType],
                  profiles: [
                    'secure-only',
                    'searchable',
                    ...(profile === 'structured' ? ['structured'] : []),
                  ],
                },
              });
              vi.spyOn(app.get(AdmissionFeatures), 'formats').mockReturnValue([contentType]);
              vi.spyOn(app.get(AdmissionFeatures), 'profiles').mockReturnValue([
                'secure-only',
                'searchable',
                ...(profile === 'structured' ? ['structured'] : []),
              ]);
              const begun = await start(c, {
                ...descriptor,
                size: bytes.length,
                contentType,
                sha256: digest,
                profile,
              });
              expect(begun.statusCode).toBe(201);
              const session = begun.json().session;
              expect(
                (
                  await fetch(begun.json().transfer.url, {
                    method: 'PUT',
                    headers: begun.json().transfer.headers,
                    body: new Uint8Array(bytes),
                  })
                ).status,
              ).toBe(200);
              await discoverUploads(work(), privateApp.get(StorageService));
              await selectCandidates(work(), privateApp.get(StorageService));
              const message = await envelope();
              const lease = (await call('scanner', '/attempts/claim', message)).json().lease;
              const candidate = (await call('scanner', '/attempts/candidate', lease)).json();
              const now = new Date().toISOString();
              expect(
                (
                  await call('scanner', '/attempts/result', {
                    ...lease,
                    outcome: 'SUCCEEDED',
                    code: 'OK',
                    assessment: {
                      candidateId: candidate.candidateId,
                      outcome: 'PASSED',
                      code: 'OK',
                      sha256: digest,
                      size: bytes.length,
                      contentType,
                      policy: 'format-security-v1',
                      engine: 'ClamAV fixture',
                      signatures: '1',
                      signatureTime: now,
                      startedAt: now,
                      finishedAt: now,
                      complete: true,
                      isolated: true,
                    },
                  })
                ).statusCode,
              ).toBe(200);
              await settleCandidates(work());
              if (contentType === 'application/pdf' && profile === 'searchable') {
                const native = mq.worker(environment('extractor'), 'production');
                workers.push(native);
                await publish();
                await waitFor(
                  () =>
                    work().internal(
                      async (tx) =>
                        (
                          await tx.client.query(
                            "SELECT state FROM dms.work_job WHERE upload_id=$1 AND task='document.extract'",
                            [session.id],
                          )
                        ).rows[0],
                    ),
                  (row) => row?.state === 'SUCCEEDED',
                  60000,
                );
                await settleCandidates(work());
              }
              const heavy = await work().internal(
                async (tx) =>
                  (
                    await tx.client.query(
                      "SELECT * FROM dms.work_job WHERE upload_id=$1 AND task='document.heavy'",
                      [session.id],
                    )
                  ).rows[0],
              );
              expect(heavy.state).toBe('QUEUED');
              const dispatch = (await call('publisher', '/dispatches/claim'))
                .json()
                .items.find(
                  (item: { dispatch: { task: string } }) => item.dispatch.task === 'document.heavy',
                ).dispatch;
              expect((await call('extractor', '/attempts/claim', dispatch)).statusCode).toBe(403);
              await withTenant(owner, tenantId, async (db) =>
                expect(
                  (
                    await db.query('SELECT work_released FROM dms.upload_admission WHERE id=$1', [
                      session.id,
                    ])
                  ).rows[0].work_released,
                ).toBe(false),
              );
              const worker = mq.worker(environment('heavy'), 'production');
              workers.push(worker);
              // Directly exercised dispatch stays leased only for publication; return it to READY for the real publisher.
              await withTenant(owner, tenantId, (db) =>
                db.query(
                  "UPDATE dms.work_dispatch SET state='READY',delivery_hash=NULL,delivery_until=NULL,delivery_client=NULL WHERE job_id=$1 AND generation=$2",
                  [heavy.id, heavy.generation],
                ),
              );
              await publish();
              await waitFor(
                () => state(heavy.id),
                (row) => row.state === 'SUCCEEDED',
                profile === 'structured' ? 480000 : 120000,
              );
              const stage = await work().internal(
                async (tx) =>
                  (
                    await tx.client.query(
                      "SELECT * FROM dms.extraction_stage WHERE job_id=$1 AND state='ACCEPTED'",
                      [heavy.id],
                    )
                  ).rows[0],
              );
              expect(stage.manifest).toMatchObject({
                stage: profile === 'structured' ? 'structure' : 'ocr',
                languages: ['en'],
                ocr: { engine: 'tesseract', engineVersion: '5.5.4' },
              });
              const cap = await privateApp.get(StorageService).forRole('artifactRead').download({
                area: 'artifacts',
                tenantId,
                applicationId: c.applicationId,
                id: stage.object_id,
              });
              const artifact = await (await fetch(cap.url)).json();
              if (profile === 'structured') {
                expect(
                  artifact.structure.pages.some((p: { elements: unknown[] }) => p.elements.length),
                ).toBe(true);
                const result = (
                  await req(c, 'GET', `/v1/documents/${session.documentId}/content`)
                ).json();
                expect(result.run.manifest.structure.processorVersion).toBe('2.146.0');
              } else
                expect(
                  artifact.units.some(
                    (unit: { ocr?: { words: unknown[] } }) => unit.ocr?.words.length,
                  ),
                ).toBe(true);
              if (contentType === 'application/pdf') {
                expect(artifact.units[0].recognition).toBe('NATIVE');
                expect(artifact.units[2].text.match(/Native Header Remains/g)).toHaveLength(1);
              }
              await settleCandidates(work());
              expect((await req(c, 'GET', `/v1/uploads/${session.id}`)).json()).toMatchObject({
                security: 'PASSED',
                availability: 'AVAILABLE',
                processing: stage.manifest.status,
              });
              if (profile === 'structured') {
                const path = `/v1/documents/${session.documentId}/versions/${session.versionId}/reprocess`,
                  key = randomUUID();
                const accepted = await req(c, 'POST', path, { profile: 'structured' }, key);
                expect(accepted.statusCode).toBe(202);
                vi.stubEnv('DMS_STRUCTURE_ENABLED', 'false');
                const replay = await req(c, 'POST', path, { profile: 'structured' }, key);
                expect(replay.statusCode).toBe(200);
                expect(replay.json().operationId).toBe(accepted.json().operationId);
                expect((await req(c, 'POST', path, { profile: 'structured' })).json().code).toBe(
                  'PROFILE_UNAVAILABLE',
                );
                vi.stubEnv('DMS_STRUCTURE_ENABLED', 'true');
              }
              const download = (
                await api(c, `/v1/documents/${session.documentId}/download`)
              ).json();
              expect(
                createHash('sha256')
                  .update(Buffer.from(await (await fetch(download.url)).arrayBuffer()))
                  .digest('hex'),
              ).toBe(digest);
            } finally {
              clearInterval(capacityPulse);
              await observing;
              if (profile === 'structured')
                vi.stubEnv('DMS_STRUCTURE_ENABLED', previousStructureFlag ?? 'false');
              await rm(folder, { recursive: true, force: true });
            }
            expect(observationError).toBeUndefined();
          },
          540000,
        );

        it('I18 separates API/processing readiness and bounds grant-checked operations, presence and retention', async () => {
          const initial = (await fresh('operations-inspect')) as { alerts: string[] };
          expect(initial.alerts).toContain('COMPONENT_UNAVAILABLE');
          expect(initial.alerts).toContain('BACKUP_UNREPORTED');
          expect((await app.inject('/health/live')).statusCode).toBe(200);
          expect((await app.inject('/health/ready/api')).statusCode).toBe(200);
          expect((await privateApp.inject('/health/ready/processing')).statusCode).toBe(503);
          expect(
            (
              await call('publisher', '/presence', {
                state: 'ready',
                signatureTime: new Date().toISOString(),
              })
            ).statusCode,
          ).toBe(400);
          for (const role of ['publisher', 'scanner', 'extractor', 'heavy'] as const)
            expect(
              (
                await call(role, '/presence', {
                  state: 'ready',
                  ...(role === 'scanner' ? { signatureTime: new Date().toISOString() } : {}),
                })
              ).statusCode,
            ).toBe(200);
          const { observeService } = await import('../src/modules/processing/operations.js');
          await coordinated(async (tx) => {
            await observeCapacity(tx, tmpdir(), tmpdir());
            await observeService(tx, 'coordinator', 'ready');
          });
          expect(await fresh('operations-inspect')).toMatchObject({ processingReady: true });
          expect((await privateApp.inject('/health/ready/processing')).statusCode).toBe(200);
          const c = await consumer();
          await expect(
            app
              .get(DmsDatabaseService)
              .withMachine(await principal(c), ['dms:documents:read'], (tx) =>
                tx.client.query('SELECT dms.operations_snapshot()'),
              ),
          ).rejects.toMatchObject({ code: '42501' });
          await fresh('work-disable', { clientId: identities.get('scanner')?.clientId });
          expect(
            (
              await call('scanner', '/presence', {
                state: 'ready',
                signatureTime: new Date().toISOString(),
              })
            ).statusCode,
          ).toBe(403);
          expect((await privateApp.inject('/health/ready/processing')).statusCode).toBe(503);
          expect((await app.inject('/health/ready/api')).statusCode).toBe(200);
          await fresh('work-authorize', {
            clientId: identities.get('scanner')?.clientId,
            role: 'scanner',
          });
          await withTenant(owner, tenantId, (db) =>
            db.query(
              "UPDATE dms.service_observation SET evidence_at=now()-interval '49 hours' WHERE component='scanner'",
            ),
          );
          expect(((await fresh('operations-inspect')) as { alerts: string[] }).alerts).toContain(
            'SIGNATURE_STALE',
          );
          const backup = (await fresh('operations-backup-report', {
            completedAt: new Date().toISOString(),
            manifestSha256: 'a'.repeat(64),
          })) as { alerts: string[] };
          expect(backup.alerts).not.toContain('BACKUP_UNREPORTED');
          await expect(
            fresh('operations-backup-report', {
              completedAt: new Date(Date.now() + 120000).toISOString(),
              manifestSha256: 'a'.repeat(64),
            }),
          ).rejects.toThrow();
          await withTenant(owner, tenantId, (db) =>
            db.query(
              "INSERT INTO dms.security_event(id,tenant_id,action,outcome,actor_kind,actor_id,subject_id,created_at) VALUES($1,$2,'fixture.old','success','operator',$3,$4,now()-interval '91 days')",
              [randomUUID(), tenantId, operatorId, tenantId],
            ),
          );
          expect(await fresh('operations-prune')).toMatchObject({ securityEvents: 1, jobs: 0 });
        });
        it('I18 shares a dispatch batch across applications despite a larger older backlog', async () => {
          const a = await consumer(),
            b = await consumer();
          await fresh('admission-policy-set', {
            expectedRevision: '1',
            policy: {
              ...policy,
              profiles: ['secure-only', 'searchable'],
              contentTypes: ['text/plain'],
            },
          });
          vi.spyOn(app.get(AdmissionFeatures), 'formats').mockReturnValue(['text/plain']);
          vi.spyOn(app.get(AdmissionFeatures), 'profiles').mockReturnValue([
            'secure-only',
            'searchable',
          ]);
          const sources = [];
          for (let index = 0; index < 13; index++) {
            const source = await versionUpload(index === 12 ? b : a);
            await finishVersion(source.id);
            sources.push(source);
          }
          let runId = '';
          for (const [index, source] of sources.entries()) {
            await coordinated((tx) => observeCapacity(tx, tmpdir(), tmpdir()));
            const result = await req(
              index === 12 ? b : a,
              'POST',
              `/v1/documents/${source.documentId}/versions/${source.versionId}/reprocess`,
              { profile: 'searchable' },
            );
            expect(result.statusCode).toBe(202);
            runId = result.json().operationId;
          }
          const job = await work().internal(
            async (tx) =>
              (
                await tx.client.query('SELECT id FROM dms.work_job WHERE processing_run_id=$1', [
                  runId,
                ])
              ).rows[0],
          );
          const batch = await call('publisher', '/dispatches/claim');
          expect(batch.json().items).toHaveLength(10);
          expect(
            batch.json().items.map((item: { dispatch: { jobId: string } }) => item.dispatch.jobId),
          ).toContain(job.id);
        }, 120000);

        it('I17 filters before pagination and hides retained data immediately on access/security/lifecycle changes', async () => {
          const c = await consumer(),
            outsider = await consumer();
          await fresh('admission-policy-set', {
            expectedRevision: '1',
            policy: { ...policy, contentTypes: ['text/plain'], profiles: ['secure-only'] },
          });
          vi.spyOn(app.get(AdmissionFeatures), 'formats').mockReturnValue(['text/plain']);
          vi.spyOn(app.get(AdmissionFeatures), 'profiles').mockReturnValue(['secure-only']);
          const a = await versionUpload(c, undefined, 'First secure-only original');
          await finishVersion(a.id);
          const b = await versionUpload(c, undefined, 'Second secure-only original');
          await finishVersion(b.id);
          await withTenant(owner, tenantId, async (db) => {
            await db.query(
              `UPDATE dms.document SET title='Quarterly Financial Report',tags='["finance"]',metadata='{"category":"invoice","status":"approved","secret":"hidden"}',"references"=$2 WHERE id=ANY($1::uuid[])`,
              [
                [a.documentId, b.documentId],
                JSON.stringify([
                  {
                    id: randomUUID(),
                    applicationId: c.applicationId,
                    namespace: 'erp',
                    type: 'invoice',
                    externalId: '42',
                  },
                ]),
              ],
            );
          });
          const body = {
            q: 'Quarterly Financia Report',
            tag: 'finance',
            metadataField: 'category',
            metadataValue: 'invoice',
            referenceNamespace: 'erp',
            referenceType: 'invoice',
            referenceId: '42',
            limit: 1,
          };
          const find = async (who = c, input: object = body) => {
            const response = await req(who, 'POST', '/v1/search', input);
            expect(response.statusCode).toBe(200);
            return response.json();
          };
          const page = await find();
          expect(page.items).toHaveLength(1);
          expect(page.items[0]).toMatchObject({
            runId: null,
            indexStatus: 'NOT_INDEXED',
            match: null,
          });
          expect(page.nextCursor).toBeTruthy();
          const next = await find(c, { ...body, cursor: page.nextCursor });
          expect(next.items).toHaveLength(1);
          expect(next.items[0].documentId).not.toBe(page.items[0].documentId);
          expect(next.nextCursor).toBeNull();
          expect((await find(outsider)).items).toEqual([]);
          expect(
            (await req(outsider, 'POST', '/v1/search', { ...body, cursor: page.nextCursor }))
              .statusCode,
          ).toBe(400);
          expect(
            (await req(c, 'POST', '/v1/search', { ...body, tag: 'other', cursor: page.nextCursor }))
              .statusCode,
          ).toBe(400);
          for (const invalid of [
            { versionId: a.versionId },
            { metadataField: 'secret', metadataValue: 'hidden' },
            { referenceNamespace: 'erp' },
            { q: 'a' },
            { limit: 51 },
          ])
            expect((await req(c, 'POST', '/v1/search', invalid)).statusCode).toBe(400);
          expect(
            (await find(c, { metadataField: 'status', metadataValue: 'approved' })).items,
          ).toHaveLength(2);
          const hidden = next.items[0].documentId;
          await withTenant(owner, tenantId, (db) =>
            db.query(
              "UPDATE dms.security_candidate SET state='INVALIDATED' WHERE upload_id IN(SELECT id FROM dms.upload_admission WHERE document_id=$1)",
              [hidden],
            ),
          );
          expect((await find(c, { ...body, cursor: page.nextCursor })).items).toEqual([]);
          await withTenant(owner, tenantId, (db) =>
            db.query(
              "UPDATE dms.document SET lifecycle='SOFT_DELETED',deleted_at=now(),restore_deadline=now()+interval '30 days' WHERE id=$1",
              [page.items[0].documentId],
            ),
          );
          expect((await find(c, {})).items).toEqual([]);
        });

        it('I16 binds history/artifacts to versions and preserves active results across bounded owner/operator replacements', async () => {
          const c = await consumer(),
            shared = await consumer();
          await fresh('admission-policy-set', {
            expectedRevision: '1',
            policy: {
              ...policy,
              contentTypes: ['text/plain'],
              profiles: ['secure-only', 'searchable'],
            },
          });
          vi.spyOn(app.get(AdmissionFeatures), 'formats').mockReturnValue(['text/plain']);
          vi.spyOn(app.get(AdmissionFeatures), 'profiles').mockReturnValue([
            'secure-only',
            'searchable',
          ]);
          const session = await versionUpload(
            c,
            undefined,
            'Retained <script>untrusted</script> text',
            randomUUID(),
            { profile: 'searchable' },
          );
          await finishVersion(session.id);
          const runPath = `/v1/documents/${session.documentId}/processing`,
            contentPath = `/v1/documents/${session.documentId}/content`,
            commandPath = `/v1/documents/${session.documentId}/versions/${session.versionId}/reprocess`;
          const first = (await req(c, 'GET', runPath)).json();
          expect(first).toMatchObject({
            activeRunId: null,
            indexStatus: 'NOT_INDEXED',
            items: [{ profile: 'searchable', state: 'QUEUED' }],
          });
          expect((await req(c, 'GET', contentPath)).json().code).toBe('RESULT_UNAVAILABLE');
          const worker = mq.worker(environment('extractor'), 'production');
          workers.push(worker);
          const initialJob = await work().internal(
            async (tx) =>
              (
                await tx.client.query('SELECT id FROM dms.work_job WHERE processing_run_id=$1', [
                  first.items[0].id,
                ])
              ).rows[0],
          );
          await publish();
          await waitFor(
            () => state(initialJob.id),
            (r) => r.state === 'SUCCEEDED',
            60000,
          );
          await settleCandidates(work());
          const initial = (await req(c, 'GET', contentPath)).json();
          expect(initial).toMatchObject({
            untrusted: true,
            run: {
              id: first.items[0].id,
              active: true,
              state: 'SUCCEEDED',
              manifest: {
                runId: first.items[0].id,
                sourceSha256: hash('Retained <script>untrusted</script> text'),
              },
            },
          });
          const search = async (who = c, body: object = { q: 'Retained' }) => {
            const response = await req(who, 'POST', '/v1/search', body);
            expect(response.statusCode).toBe(200);
            return response.json();
          };
          expect(await search()).toMatchObject({
            language: 'en',
            untrusted: true,
            items: [
              {
                documentId: session.documentId,
                runId: initial.run.id,
                indexStatus: 'READY',
                match: { unitId: expect.any(String) },
              },
            ],
          });
          expect((await req(shared, 'POST', '/v1/search', { q: 'Retained' })).json().items).toEqual(
            [],
          );
          expect(
            (await req(c, 'GET', `/v1/documents/${session.documentId}`)).json().searchable,
          ).toBe(true);
          const artifact = await (await fetch(initial.artifacts[0].url)).text();
          expect(hash(artifact)).toBe(initial.artifacts[0].sha256);
          expect(JSON.parse(artifact).units[0].text).toContain('<script>untrusted</script>');
          expect((await search()).items[0].match.unitId).toBe(JSON.parse(artifact).units[0].id);
          expect(new Date(initial.artifacts[0].expiresAt).getTime()).toBeLessThanOrEqual(
            Date.now() + 120000,
          );
          await withTenant(owner, tenantId, (db) =>
            db.query(
              "INSERT INTO dms.document_grant(tenant_id,owner_application_id,document_id,application_id,rights) VALUES($1,$2,$3,$4,ARRAY['READ','ADD_VERSION'])",
              [tenantId, c.applicationId, session.documentId, shared.applicationId],
            ),
          );
          expect((await req(shared, 'GET', contentPath)).statusCode).toBe(200);
          expect((await search(shared)).items[0].runId).toBe(initial.run.id);
          await withTenant(owner, tenantId, (db) =>
            db.query('DELETE FROM dms.document_grant WHERE document_id=$1', [session.documentId]),
          );
          expect((await search(shared)).items).toEqual([]);
          expect(
            await app
              .get(DmsDatabaseService)
              .withMachine(
                await principal(shared),
                ['dms:documents:read'],
                async (tx) => (await tx.client.query('SELECT stage_id FROM dms.search_chunk')).rows,
              ),
          ).toEqual([]);
          await withTenant(owner, tenantId, (db) =>
            db.query(
              "INSERT INTO dms.document_grant(tenant_id,owner_application_id,document_id,application_id,rights) VALUES($1,$2,$3,$4,ARRAY['READ','ADD_VERSION'])",
              [tenantId, c.applicationId, session.documentId, shared.applicationId],
            ),
          );
          await withTenant(owner, tenantId, (db) =>
            db.query("UPDATE dms.security_candidate SET state='INVALIDATED' WHERE upload_id=$1", [
              session.id,
            ]),
          );
          expect((await search()).items).toEqual([]);
          expect(
            (await req(c, 'GET', `/v1/documents/${session.documentId}`)).json().searchable,
          ).toBe(false);
          await withTenant(owner, tenantId, (db) =>
            db.query("UPDATE dms.security_candidate SET state='PASSED' WHERE upload_id=$1", [
              session.id,
            ]),
          );
          expect((await search()).items[0].runId).toBe(initial.run.id);

          expect(
            (await req(shared, 'POST', commandPath, { profile: 'searchable' })).statusCode,
          ).toBe(403);
          await coordinated((tx) => observeCapacity(tx, tmpdir(), tmpdir()));
          const key = randomUUID();
          const attempts = await Promise.all([
            req(c, 'POST', commandPath, { profile: 'searchable' }, key),
            req(c, 'POST', commandPath, { profile: 'searchable' }, key),
          ]);
          expect(attempts.map((r) => r.statusCode).sort()).toEqual([200, 202]);
          const replacement = attempts[0].json();
          expect(attempts[1].json().operationId).toBe(replacement.operationId);
          expect(
            (await req(c, 'POST', commandPath, { profile: 'structured' }, key)).json().code,
          ).toBe('IDEMPOTENCY_CONFLICT');
          expect((await req(c, 'POST', commandPath, { profile: 'searchable' })).json().code).toBe(
            'PROCESSING_IN_PROGRESS',
          );
          expect((await req(c, 'GET', contentPath)).json().run.id).toBe(initial.run.id);
          expect((await search()).items[0].runId).toBe(initial.run.id);
          const dispatch = await envelope(),
            claim = await call('extractor', '/attempts/claim', dispatch);
          expect(claim.statusCode).toBe(200);
          const lease = claim.json().lease;
          expect(
            (
              await call('extractor', '/attempts/result', {
                ...lease,
                outcome: 'FAILED',
                code: 'EXECUTION_FAILED',
              })
            ).statusCode,
          ).toBe(200);
          expect(
            (
              await call('extractor', '/attempts/result', {
                ...lease,
                outcome: 'FAILED',
                code: 'EXECUTION_FAILED',
              })
            ).json().duplicate,
          ).toBe(true);
          expect((await req(c, 'GET', contentPath)).json().run.id).toBe(initial.run.id);
          expect((await search()).items[0].runId).toBe(initial.run.id);
          const failed = (await req(c, 'GET', runPath)).json();
          expect(failed.items[0]).toMatchObject({
            id: replacement.operationId,
            state: 'FAILED',
            active: false,
          });
          expect(
            (await req(c, 'GET', `${contentPath}?runId=${replacement.operationId}`)).json().code,
          ).toBe('RESULT_UNAVAILABLE');
          await settleCandidates(work());
          await coordinated((tx) => observeCapacity(tx, tmpdir(), tmpdir()));
          await withTenant(owner, tenantId, (db) =>
            db.query('UPDATE dms.admission_tenant_usage SET queued=100'),
          );
          expect((await req(c, 'POST', commandPath, { profile: 'searchable' })).json().code).toBe(
            'CAPACITY_EXCEEDED',
          );
          await withTenant(owner, tenantId, (db) =>
            db.query('UPDATE dms.admission_tenant_usage SET queued=0'),
          );
          const direct = await app
            .get(DmsDatabaseService)
            .withMachine(
              await principal(shared),
              ['dms:documents:read', 'dms:documents:write'],
              async (tx) =>
                (
                  await tx.client.query(
                    'SELECT dms.request_processing($1,$2,$3,$4,$5,$6) AS result',
                    [
                      session.documentId,
                      session.versionId,
                      'searchable',
                      randomUUID(),
                      randomUUID(),
                      randomUUID(),
                    ],
                  )
                ).rows[0].result,
            );
          expect(direct.error).toBe('DOCUMENT_NOT_FOUND');
          const operatorRun = await fresh('work-redrive', {
            jobId: dispatch.jobId,
            idempotencyKey: randomUUID(),
          });
          const nextId = (operatorRun as { operationId: string }).operationId;
          const nextJob = await work().internal(
            async (tx) =>
              (
                await tx.client.query('SELECT id FROM dms.work_job WHERE processing_run_id=$1', [
                  nextId,
                ])
              ).rows[0],
          );
          await publish();
          await waitFor(
            () => state(nextJob.id),
            (r) => r.state === 'SUCCEEDED',
            60000,
          );
          await settleCandidates(work());
          expect((await req(c, 'GET', contentPath)).json().run.id).toBe(nextId);
          expect((await search()).items[0].runId).toBe(nextId);
          expect(
            await app
              .get(DmsDatabaseService)
              .withMachine(
                await principal(shared),
                ['dms:documents:read'],
                async (tx) =>
                  (await tx.client.query('SELECT DISTINCT stage_id FROM dms.search_chunk')).rows,
              ),
          ).toHaveLength(1);
          expect(
            (await req(c, 'GET', `${contentPath}?runId=${initial.run.id}`)).json().run.id,
          ).toBe(initial.run.id);
          await expect(
            work().internal((tx) =>
              tx.client.query("UPDATE dms.processing_run SET state='FAILED' WHERE id=$1", [
                initial.run.id,
              ]),
            ),
          ).rejects.toMatchObject({ code: '23514' });
          expect((await req(c, 'GET', `${runPath}?limit=1`)).json().nextCursor).toBeTruthy();
          const cursor = (await req(c, 'GET', `${runPath}?limit=1`)).json().nextCursor;
          expect((await req(shared, 'GET', `${runPath}?cursor=${cursor}`)).statusCode).toBe(400);
          expect((await req(c, 'GET', `${runPath}?cursor=${cursor}`)).json().items[0].id).toBe(
            replacement.operationId,
          );
          const current = await versionUpload(c, session.documentId, 'New original');
          await finishVersion(current.id);
          expect((await search()).items).toEqual([]);
          expect((await req(c, 'GET', `${contentPath}?runId=${initial.run.id}`)).json().code).toBe(
            'PROCESSING_RUN_NOT_FOUND',
          );
          expect(
            (
              await req(
                c,
                'GET',
                `${contentPath}?versionId=${session.versionId}&runId=${initial.run.id}`,
              )
            ).statusCode,
          ).toBe(200);
          expect(
            (
              await req(
                c,
                'GET',
                `${contentPath}?versionId=${randomUUID()}&runId=${initial.run.id}`,
              )
            ).json().code,
          ).toBe('VERSION_NOT_FOUND');
          await withTenant(owner, tenantId, (db) =>
            db.query('DELETE FROM dms.document_grant WHERE document_id=$1', [session.documentId]),
          );
          expect(
            (await req(shared, 'GET', `${contentPath}?versionId=${session.versionId}`)).statusCode,
          ).toBe(404);
          await withTenant(owner, tenantId, async (db) => {
            expect(
              (
                await db.query(
                  'SELECT count(*)::integer AS n FROM dms.document_version WHERE document_id=$1',
                  [session.documentId],
                )
              ).rows[0].n,
            ).toBe(2);
            expect(
              (
                await db.query(
                  "SELECT count(*)::integer AS n FROM dms.audit_event WHERE document_id=$1 AND action='processing.requested'",
                  [session.documentId],
                )
              ).rows[0].n,
            ).toBe(2);
          });
          const currentLifecycle = await lifecycle(c, session.documentId);
          await deleteLogical(c, session.documentId, currentLifecycle.headers.etag as string);
          expect(
            (await req(c, 'GET', `${contentPath}?versionId=${session.versionId}`)).statusCode,
          ).toBe(404);
        }, 120000);

        it('I16 reprocesses expired contributor uploads without changing lifecycle recovery or contributor control', async () => {
          const ownerApp = await consumer(),
            contributor = await consumer();
          await fresh('admission-policy-set', {
            expectedRevision: '1',
            policy: {
              ...policy,
              contentTypes: ['text/plain'],
              profiles: ['secure-only', 'searchable'],
            },
          });
          vi.spyOn(app.get(AdmissionFeatures), 'formats').mockReturnValue(['text/plain']);
          vi.spyOn(app.get(AdmissionFeatures), 'profiles').mockReturnValue([
            'secure-only',
            'searchable',
          ]);
          const first = await versionUpload(ownerApp);
          await finishVersion(first.id);
          await withTenant(owner, tenantId, (db) =>
            db.query(
              "INSERT INTO dms.document_grant(tenant_id,owner_application_id,document_id,application_id,rights) VALUES($1,$2,$3,$4,ARRAY['READ','ADD_VERSION'])",
              [tenantId, ownerApp.applicationId, first.documentId, contributor.applicationId],
            ),
          );
          const version = await versionUpload(
            contributor,
            first.documentId,
            `Contributor retained text ${'😀'.repeat(4097)}`,
          );
          await finishVersion(version.id);
          await withTenant(owner, tenantId, (db) =>
            db.query(
              "UPDATE dms.upload_admission SET expires_at=clock_timestamp()-interval '1 second',capability_expires_at=clock_timestamp()-interval '2 seconds' WHERE id=$1",
              [version.id],
            ),
          );
          expect((await req(contributor, 'GET', `/v1/uploads/${version.id}`)).statusCode).toBe(200);
          await coordinated((tx) => observeCapacity(tx, tmpdir(), tmpdir()));
          const response = await req(
            ownerApp,
            'POST',
            `/v1/documents/${first.documentId}/versions/${version.versionId}/reprocess`,
            { profile: 'searchable' },
          );
          expect(response.statusCode).toBe(202);
          expect((await req(contributor, 'GET', `/v1/uploads/${version.id}`)).statusCode).toBe(200);
          expect((await work().recover()).recovered).toBe(0);
          const job = await work().internal(
            async (tx) =>
              (
                await tx.client.query('SELECT * FROM dms.work_job WHERE processing_run_id=$1', [
                  response.json().operationId,
                ])
              ).rows[0],
          );
          expect(job.state).toBe('QUEUED');
          const worker = mq.worker(environment('extractor'), 'production');
          workers.push(worker);
          await publish();
          await waitFor(
            () => state(job.id),
            (row) => row.state === 'SUCCEEDED',
            60000,
          );
          await settleCandidates(work());
          const found = await req(ownerApp, 'POST', '/v1/search', { q: 'Contributor' });
          expect(found.statusCode).toBe(200);
          expect(found.json().items[0].match.snippet.length).toBeLessThanOrEqual(480);
          await work().internal(async (tx) => {
            const chunks = (
              await tx.client.query(
                'SELECT char_length(text) AS n FROM dms.search_chunk WHERE stage_id IN(SELECT accepted_stage_id FROM dms.processing_run WHERE id=$1) ORDER BY ordinal',
                [response.json().operationId],
              )
            ).rows;
            expect(chunks).toHaveLength(2);
            expect(chunks[0].n).toBe(4096);
          });
          expect((await req(contributor, 'GET', `/v1/uploads/${version.id}`)).statusCode).toBe(200);
          expect(
            (await req(ownerApp, 'GET', `/v1/documents/${first.documentId}/content`)).json().run.id,
          ).toBe(response.json().operationId);
          await withTenant(owner, tenantId, async (db) => {
            expect(
              (
                await db.query('SELECT reassessment_until FROM dms.upload_admission WHERE id=$1', [
                  version.id,
                ])
              ).rows[0].reassessment_until,
            ).toBeNull();
            expect(
              (
                await db.query(
                  'SELECT count(*)::integer AS n FROM dms.document_version WHERE document_id=$1',
                  [first.documentId],
                )
              ).rows[0].n,
            ).toBe(2);
          });
        }, 90000);

        it('I14 extracts passed originals through the production private Celery handler and retains independent availability', async () => {
          const c = await consumer();
          await fresh('admission-policy-set', {
            expectedRevision: '1',
            policy: {
              ...policy,
              contentTypes: ['text/plain'],
              profiles: ['secure-only', 'searchable'],
            },
          });
          vi.spyOn(app.get(AdmissionFeatures), 'formats').mockReturnValue(['text/plain']);
          vi.spyOn(app.get(AdmissionFeatures), 'profiles').mockReturnValue([
            'secure-only',
            'searchable',
          ]);
          const session = await versionUpload(
            c,
            undefined,
            'Native text\nSecond line\n',
            randomUUID(),
            { profile: 'searchable' },
          );
          await finishVersion(session.id);
          const job = await work().internal(
            async (tx) =>
              (
                await tx.client.query(
                  "SELECT * FROM dms.work_job WHERE upload_id=$1 AND task='document.extract'",
                  [session.id],
                )
              ).rows[0],
          );
          expect(job.state).toBe('QUEUED');
          const queuedStatus = (await req(c, 'GET', `/v1/uploads/${session.id}`)).json();
          expect(queuedStatus).toMatchObject({
            security: 'PASSED',
            availability: 'AVAILABLE',
            processing: 'QUEUED',
          });
          const worker = mq.worker(environment('extractor'), 'production');
          workers.push(worker);
          await publish();
          await waitFor(
            () => state(job.id),
            (row) => row.state === 'SUCCEEDED',
            60000,
          );
          const stage = await work().internal(
            async (tx) =>
              (
                await tx.client.query('SELECT * FROM dms.extraction_stage WHERE job_id=$1', [
                  job.id,
                ])
              ).rows[0],
          );
          expect(stage).toMatchObject({
            state: 'ACCEPTED',
            manifest: {
              documentId: session.documentId,
              versionId: session.versionId,
              sourceSha256: hash('Native text\nSecond line\n'),
              status: 'SUCCEEDED',
              coverage: { attempted: 2, completed: 2 },
            },
          });
          const cap = await privateApp.get(StorageService).forRole('artifactRead').download({
            area: 'artifacts',
            tenantId,
            applicationId: c.applicationId,
            id: stage.object_id,
          });
          const artifact = await (await fetch(cap.url)).json();
          expect(artifact.units.map((unit: { text: string }) => unit.text)).toEqual([
            'Native text',
            'Second line',
          ]);
          expect(JSON.stringify(stage)).not.toContain('http:');
          await settleCandidates(work());
          const status = (await req(c, 'GET', `/v1/uploads/${session.id}`)).json();
          expect(status).toMatchObject({
            security: 'PASSED',
            availability: 'AVAILABLE',
            processing: 'SUCCEEDED',
          });
          await withTenant(owner, tenantId, async (db) => {
            const usage = (
              await db.query(
                'SELECT artifact_bytes,reserved_storage FROM dms.admission_tenant_usage',
              )
            ).rows[0];
            expect(Number(usage.artifact_bytes)).toBe(Number(stage.size));
            expect(Number(usage.reserved_storage)).toBe(0);
            expect(
              (
                await db.query('SELECT work_released FROM dms.upload_admission WHERE id=$1', [
                  session.id,
                ])
              ).rows[0].work_released,
            ).toBe(true);
          });
        }, 90000);

        it('I14 preserves a passed downloadable original when the real extractor exceeds its output-unit bound', async () => {
          const c = await consumer();
          await fresh('admission-policy-set', {
            expectedRevision: '1',
            policy: {
              ...policy,
              contentTypes: ['text/plain'],
              profiles: ['secure-only', 'searchable'],
            },
          });
          vi.spyOn(app.get(AdmissionFeatures), 'formats').mockReturnValue(['text/plain']);
          vi.spyOn(app.get(AdmissionFeatures), 'profiles').mockReturnValue([
            'secure-only',
            'searchable',
          ]);
          const body = 'A'.repeat(32769);
          const session = await versionUpload(c, undefined, body, randomUUID(), {
            profile: 'searchable',
          });
          await finishVersion(session.id);
          const job = await work().internal(
            async (tx) =>
              (
                await tx.client.query(
                  "SELECT * FROM dms.work_job WHERE upload_id=$1 AND task='document.extract'",
                  [session.id],
                )
              ).rows[0],
          );
          const worker = mq.worker(environment('extractor'), 'production');
          workers.push(worker);
          await publish();
          await waitFor(
            () => state(job.id),
            (row) => row.state === 'SUCCEEDED',
            60000,
          );
          expect((await req(c, 'GET', `/v1/uploads/${session.id}`)).json()).toMatchObject({
            security: 'PASSED',
            availability: 'AVAILABLE',
            processing: 'FAILED',
          });
          const cap = (await api(c, `/v1/documents/${session.documentId}/download`)).json();
          expect(hash(await (await fetch(cap.url)).text())).toBe(hash(body));
        }, 90000);

        it('I14 rejects extraction-role security approval and fences retained inputs/outputs after deletion', async () => {
          const c = await consumer();
          await fresh('admission-policy-set', {
            expectedRevision: '1',
            policy: {
              ...policy,
              contentTypes: ['text/plain'],
              profiles: ['secure-only', 'searchable'],
            },
          });
          vi.spyOn(app.get(AdmissionFeatures), 'formats').mockReturnValue(['text/plain']);
          vi.spyOn(app.get(AdmissionFeatures), 'profiles').mockReturnValue([
            'secure-only',
            'searchable',
          ]);
          const session = await versionUpload(c, undefined, 'Safe text', randomUUID(), {
            profile: 'searchable',
          });
          const scanned = await finishVersion(session.id);
          const message = await envelope();
          const claimed = await call('extractor', '/attempts/claim', message);
          expect(claimed.statusCode).toBe(200);
          const lease = claimed.json().lease;
          expect((await call('scanner', '/attempts/extraction-input', lease)).statusCode).toBe(403);
          expect(
            (
              await call('extractor', '/attempts/result', {
                ...lease,
                outcome: 'SUCCEEDED',
                code: 'OK',
                assessment: scanned.evidence,
              })
            ).statusCode,
          ).toBe(403);
          const input = await call('extractor', '/attempts/extraction-input', lease);
          expect(input.statusCode).toBe(200);
          expect(input.json().request).toMatchObject({
            documentId: session.documentId,
            versionId: session.versionId,
            lifecycleGeneration: 1,
          });
          const manifest = {
            ...input.json().request,
            versionId: randomUUID(),
            processor: 'utf8',
            processorVersion: 'python-fixture',
            configurationVersion: 'native-extraction-v1',
            status: 'SUCCEEDED',
            code: 'OK',
            languages: [],
            coverage: { attempted: 0, completed: 0, omitted: 0, ocrNeeded: 0 },
            warnings: [],
            completedAt: new Date().toISOString(),
          };
          const bytes = JSON.stringify({ manifest, units: [], metadata: {} });
          await coordinated((tx) => observeCapacity(tx, tmpdir(), tmpdir()));
          const target = await call('extractor', '/attempts/extraction-output', {
            ...lease,
            size: Buffer.byteLength(bytes),
            sha256: hash(bytes),
          });
          expect(target.statusCode).toBe(200);
          expect(
            (
              await fetch(target.json().url, {
                method: 'PUT',
                headers: target.json().headers,
                body: bytes,
              })
            ).status,
          ).toBe(200);
          for (const value of [manifest, { ...manifest, versionId: session.versionId }])
            expect(
              (
                await call('extractor', '/attempts/result', {
                  ...lease,
                  outcome: 'SUCCEEDED',
                  code: 'OK',
                  extraction: { artifactId: target.json().artifactId, manifest: value },
                })
              ).statusCode,
            ).toBe(400);
          expect(
            (
              await work().internal((tx) =>
                tx.client.query("SELECT id FROM dms.extraction_stage WHERE state='ACCEPTED'"),
              )
            ).rowCount,
          ).toBe(0);
          const runtime = app.get(DmsDatabaseService);
          await expect(
            runtime.withMachine(await principal(c), ['dms:documents:read'], (tx) =>
              tx.client.query('SELECT * FROM dms.extraction_stage'),
            ),
          ).rejects.toMatchObject({ code: '42501' });
          const current = await lifecycle(c, session.documentId);
          expect(
            (await deleteLogical(c, session.documentId, current.headers.etag as string)).statusCode,
          ).toBe(200);
          expect((await call('extractor', '/attempts/extraction-input', lease)).statusCode).toBe(
            409,
          );
          expect(
            (
              await call('extractor', '/attempts/extraction-output', {
                ...lease,
                size: 10,
                sha256: hash('0123456789'),
              })
            ).statusCode,
          ).toBe(409);
        });

        it('I08 selects immutable bytes, gates scanner evidence and publishes only the current fenced candidate', async () => {
          const c = await consumer();
          await fresh('admission-policy-set', {
            expectedRevision: '1',
            policy: { ...policy, contentTypes: ['text/plain'] },
          });
          vi.spyOn(app.get(AdmissionFeatures), 'formats').mockReturnValue(['text/plain']);
          const begun = (
            await start(c, { ...descriptor, contentType: 'text/plain', sha256: hash('0123456789') })
          ).json();
          expect(
            (
              await fetch(begun.transfer.url, {
                method: 'PUT',
                headers: begun.transfer.headers,
                body: '0123456789',
              })
            ).status,
          ).toBe(200);
          await discoverUploads(work(), privateApp.get(StorageService));
          await Promise.all([
            selectCandidates(work(), privateApp.get(StorageService)),
            selectCandidates(work(), privateApp.get(StorageService)),
          ]);
          const message = await envelope();
          const lease = (await call('scanner', '/attempts/claim', message)).json().lease;
          expect(lease).toBeDefined();
          const candidate = (await call('scanner', '/attempts/candidate', lease)).json();
          expect(await (await fetch(candidate.url)).text()).toBe('0123456789');
          expect((await call('extractor', '/attempts/candidate', lease)).statusCode).toBe(403);
          expect(
            (
              await call('scanner', '/attempts/result', {
                ...lease,
                outcome: 'SUCCEEDED',
                code: 'OK',
              })
            ).statusCode,
          ).toBe(400);
          const stamp = new Date().toISOString();
          let evidence = {
            candidateId: candidate.candidateId,
            outcome: 'PASSED',
            code: 'OK',
            sha256: hash('0123456789'),
            size: 10,
            contentType: 'text/plain',
            policy: 'utf8-text-v1',
            engine: 'ClamAV fixture',
            signatures: '1',
            signatureTime: stamp,
            startedAt: stamp,
            finishedAt: stamp,
            complete: true,
            isolated: true,
          };
          for (const changed of [
            { complete: false },
            { isolated: false },
            { candidateId: randomUUID() },
            { sha256: 'b'.repeat(64) },
            { signatureTime: new Date(Date.now() - 49 * 3600000).toISOString() },
          ])
            expect(
              (
                await call('scanner', '/attempts/result', {
                  ...lease,
                  outcome: 'SUCCEEDED',
                  code: 'OK',
                  assessment: { ...evidence, ...changed },
                })
              ).statusCode,
            ).toBe(400);
          if (process.env.DMS_TEST_NATIVE_ASSESSMENT === 'true') {
            const pulse = setInterval(
              () => void call('scanner', '/attempts/heartbeat', lease),
              20000,
            );
            try {
              evidence = JSON.parse(
                await mq.python(
                  ['python', 'tests/assessment_native.py', '--candidate'],
                  {},
                  candidate,
                  150000,
                ),
              );
            } finally {
              clearInterval(pulse);
            }
          }
          const result = { ...lease, outcome: 'SUCCEEDED', code: 'OK', assessment: evidence };
          expect((await call('scanner', '/attempts/result', result)).json()).toMatchObject({
            accepted: true,
            duplicate: false,
          });
          expect((await call('scanner', '/attempts/result', result)).json()).toMatchObject({
            accepted: true,
            duplicate: true,
          });
          await settleCandidates(work());
          expect((await req(c, 'GET', `/v1/uploads/${begun.session.id}`)).json()).toMatchObject({
            security: 'PASSED',
            upload: 'COMPLETED',
            availability: 'AVAILABLE',
          });
          expect((await api(c, `/v1/documents/${begun.session.documentId}`)).json()).toMatchObject({
            currentVersionId: begun.session.versionId,
            downloadable: true,
          });
          const path = `/v1/documents/${begun.session.documentId}/download`;
          const issued = await req(c, 'GET', path);
          expect(issued.statusCode).toBe(200);
          expect(issued.headers['cache-control']).toBe('private, no-store');
          expect(issued.headers['referrer-policy']).toBe('no-referrer');
          const capability = issued.json();
          const bytes = await fetch(capability.url);
          expect(bytes.headers.get('content-type')).toBe('application/octet-stream');
          expect(bytes.headers.get('content-disposition')).toContain('attachment; filename=');
          expect(bytes.headers.get('referrer-policy')).toBe('no-referrer');
          expect(hash(await bytes.text())).toBe(capability.sha256);
          await withTenant(owner, tenantId, async (db) =>
            expect(
              (
                await db.query(
                  "SELECT count(*) AS n FROM dms.audit_event WHERE action='document.download-authorized'",
                )
              ).rows[0].n,
            ).toBe('1'),
          );
          expect(
            (await req(c, 'GET', `${path}?versionId=${begun.session.versionId}`)).statusCode,
          ).toBe(200);
          const unrelated = await consumer();
          expect((await req(unrelated, 'GET', path)).statusCode).toBe(404);
          expect(
            (await app.inject({ url: path, headers: { authorization: 'Bearer invalid' } }))
              .statusCode,
          ).toBe(401);
          await coordinated((tx) => observeCapacity(tx, tmpdir(), tmpdir()));
          const unreadyResponse = await start(c, { ...descriptor, contentType: 'text/plain' });
          expect(unreadyResponse.statusCode).toBe(201);
          const unready = unreadyResponse.json();
          expect(
            (await req(c, 'GET', `/v1/documents/${unready.session.documentId}/download`))
              .statusCode,
          ).toBe(409);
          const signer = app.get(StorageService).forRole('originalRead');
          const sign = signer.downloadOriginal.bind(signer);
          vi.spyOn(signer, 'downloadOriginal').mockRejectedValueOnce(
            new Error('Fixture signing unavailable'),
          );
          expect((await req(c, 'GET', path)).statusCode).toBe(503);
          await withTenant(owner, tenantId, async (db) =>
            expect(
              (
                await db.query(
                  "SELECT count(*) AS n FROM dms.audit_event WHERE action='document.download-authorized'",
                )
              ).rows[0].n,
            ).toBe('2'),
          );
          vi.restoreAllMocks();
          await setApplicationScopes(owner, context(), c.applicationId, ['dms:capabilities:read']);
          expect((await req(c, 'GET', path)).statusCode).toBe(403);
          await setApplicationScopes(owner, context(), c.applicationId, [...DMS_MACHINE_SCOPES]);
          const short = vi
            .spyOn(signer, 'downloadOriginal')
            .mockImplementationOnce((ref, name) => sign(ref, name, 3));
          const limited = (await req(c, 'GET', path)).json();
          short.mockRestore();
          await withTenant(owner, tenantId, (db) =>
            db.query("UPDATE dms.application_registration SET status='disabled' WHERE id=$1", [
              c.applicationId,
            ]),
          );
          expect((await req(c, 'GET', path)).statusCode).toBe(403);
          expect((await fetch(limited.url)).status).toBe(200);
          await new Promise((resolve) => setTimeout(resolve, 4100));
          expect((await fetch(limited.url)).status).toBe(403);
          await withTenant(owner, tenantId, (db) =>
            db.query("UPDATE dms.application_registration SET status='active' WHERE id=$1", [
              c.applicationId,
            ]),
          );
          await withTenant(owner, tenantId, async (db) => {
            expect(
              (
                await db.query(
                  "SELECT count(*) AS n FROM dms.audit_event WHERE action='document.published'",
                )
              ).rows[0].n,
            ).toBe('1');
          });
          await work().internal(async (tx) => {
            expect(
              (
                await tx.client.query(
                  'SELECT state,work_released,original_bytes FROM dms.upload_admission WHERE id=$1',
                  [begun.session.id],
                )
              ).rows[0],
            ).toMatchObject({ state: 'SETTLED', work_released: true, original_bytes: '10' });
          });
          let release = () => {},
            ready = () => {};
          const signing = new Promise<void>((resolve) => {
            ready = resolve;
          });
          const waiting = new Promise<void>((resolve) => {
            release = resolve;
          });
          vi.spyOn(signer, 'downloadOriginal').mockImplementationOnce(async (ref, name) => {
            ready();
            await waiting;
            return sign(ref, name);
          });
          const issuing = req(
            c,
            'GET',
            path.replace(begun.session.documentId, begun.session.documentId.toUpperCase()),
          );
          await signing;
          let invalidated = false;
          const revoke = work().internal(async (tx) => {
            await invalidateCandidate(tx, candidate.candidateId);
            invalidated = true;
          });
          try {
            await new Promise((resolve) => setTimeout(resolve, 50));
            expect(invalidated).toBe(false);
          } finally {
            release();
          }
          expect((await issuing).statusCode).toBe(200);
          await revoke;
          expect((await req(c, 'GET', `/v1/uploads/${begun.session.id}`)).json()).toMatchObject({
            security: 'INVALIDATED',
            availability: 'UNAVAILABLE',
          });
          expect((await req(c, 'GET', path)).statusCode).toBe(409);
          expect(
            (await api(c, `/v1/documents/${begun.session.documentId}`)).json().downloadable,
          ).toBe(false);
          expect((await fetch(capability.url)).status).toBe(200);
          await expect(
            app
              .get(DmsDatabaseService)
              .withMachine(await principal(c), ['dms:documents:write'], (tx) =>
                tx.client.query("UPDATE dms.security_candidate SET state='PASSED'"),
              ),
          ).rejects.toMatchObject({ code: '42501' });
        }, 180000);

        it.skipIf(process.env.DMS_TEST_NATIVE_ASSESSMENT !== 'true')(
          'I09 independent backend verifies the real secure transfer chain',
          async () => {
            const daemon = await assessmentDaemonFixture();
            const folder = await mkdtemp(join(tmpdir(), 'dms-i09-consumer-'));
            let stopped = false;
            const c = await consumer();
            await fresh('admission-policy-set', {
              expectedRevision: '1',
              policy: { ...policy, contentTypes: ['text/plain'] },
            });
            vi.spyOn(app.get(AdmissionFeatures), 'formats').mockReturnValue(['text/plain']);
            await coordinated((tx) => observeCapacity(tx, tmpdir(), tmpdir()));
            const worker = mq.worker(
              { ...environment('scanner'), DMS_CLAM_SOCKET: daemon.socket },
              'production',
            );
            workers.push(worker);
            let pumpFailure: unknown;
            const pump = (async () => {
              while (!stopped) {
                await coordinated((tx) => observeCapacity(tx, tmpdir(), tmpdir()));
                await discoverUploads(work(), privateApp.get(StorageService));
                await selectCandidates(work(), privateApp.get(StorageService));
                await selectRestores(work(), privateApp.get(StorageService));
                await restoreLifecycleVersions(work(), privateApp.get(StorageService));
                const pending = await work().internal(
                  async (tx) =>
                    (
                      await tx.client.query(
                        "SELECT EXISTS(SELECT 1 FROM dms.work_dispatch d JOIN dms.work_job j ON j.id=d.job_id AND j.generation=d.generation WHERE j.state NOT IN ('SUCCEEDED','FAILED','UNSUPPORTED','CANCELLED') AND ((d.state='READY' AND d.next_publish_at<=clock_timestamp()) OR (d.state='LEASED' AND d.delivery_until<=clock_timestamp()))) AS pending",
                      )
                    ).rows[0].pending,
                );
                if (pending) {
                  // Match the production publisher loop: deletion can obsolete a sent
                  // receipt. The end-to-end poll still requires real worker completion.
                  await publish().catch(() => {});
                }
                await settleCandidates(work());
                await new Promise((resolve) => setTimeout(resolve, 200));
              }
            })().catch((error) => {
              pumpFailure = error;
            });
            try {
              const source = join(folder, 'independent.txt');
              const body = 'Independent secure document transfer.\n';
              await writeFile(source, body, { mode: 0o600 });
              const result = JSON.parse(
                await mq.python(
                  ['python', '../../examples/dms/secure_transfer.py', source],
                  {},
                  {
                    resource: config.DMS_RESOURCE_URL,
                    transferOrigin: fixture.environment.DMS_STORAGE_PUBLIC_ORIGIN,
                    accessToken: c.accessToken,
                    idempotencyKey: randomUUID(),
                  },
                  180000,
                ),
              );
              expect(result).toMatchObject({
                verified: true,
                sha256: hash(body),
                size: Buffer.byteLength(body),
              });
              const replacement = await versionUpload(
                c,
                result.documentId,
                'Native replacement content.\n',
              );
              await waitFor(
                async () => (await req(c, 'GET', `/v1/uploads/${replacement.id}`)).json(),
                (v) => v.upload === 'COMPLETED',
                30000,
              );
              const restore = await restoreVersion(c, result.documentId, result.versionId);
              expect(restore.statusCode).toBe(202);
              const restored = restore.json().session;
              await waitFor(
                async () => (await req(c, 'GET', `/v1/uploads/${restored.id}`)).json(),
                (v) => v.upload === 'COMPLETED',
                30000,
              );
              const originalAgain = (
                await api(c, `/v1/documents/${result.documentId}/download`)
              ).json();
              expect(originalAgain.versionId).toBe(restored.versionId);
              expect(hash(await (await fetch(originalAgain.url)).text())).toBe(result.sha256);
              expect(
                (
                  await api(
                    c,
                    `/v1/documents/${result.documentId}/download?versionId=${replacement.versionId}`,
                  )
                ).statusCode,
              ).toBe(200);
              await settleCandidates(work());
              expect(
                await work().internal(
                  async (tx) =>
                    (await tx.client.query('SELECT original_bytes FROM dms.admission_tenant_usage'))
                      .rows[0].original_bytes,
                ),
              ).toBe(
                String(
                  Buffer.byteLength(body) + Buffer.byteLength('Native replacement content.\n'),
                ),
              );
              const logicalDelete = await deleteLogical(c, result.documentId);
              expect(logicalDelete.statusCode).toBe(200);
              expect((await restoreLogical(c, result.documentId)).statusCode).toBe(202);
              await waitFor(
                async () => (await lifecycle(c, result.documentId)).json(),
                (v) => v.restoration.state === 'COMPLETE',
                60000,
              );
              const logicalBytes = (
                await api(c, `/v1/documents/${result.documentId}/download`)
              ).json();
              expect(logicalBytes.versionId).toBe(restored.versionId);
              expect(hash(await (await fetch(logicalBytes.url)).text())).toBe(result.sha256);
              expect(
                (await api(c, `/v1/documents/${result.documentId}/versions`)).json().items,
              ).toHaveLength(3);
              const auditResponse = await api(c, `/v1/documents/${result.documentId}/audit`);
              expect(auditResponse.statusCode).toBe(200);
              const events = auditResponse.json();
              expect(
                events.items.some(
                  (event: { action: string }) => event.action === 'document.download-authorized',
                ),
              ).toBe(true);
            } finally {
              stopped = true;
              await pump;
              worker.stop();
              await daemon.close();
              await rm(folder, { recursive: true, force: true });
            }
            if (pumpFailure) throw pumpFailure;
          },
          300000,
        );

        async function versionConsumer() {
          const c = await consumer();
          await fresh('admission-policy-set', {
            expectedRevision: '1',
            policy: { ...policy, contentTypes: ['text/plain'] },
          });
          vi.spyOn(app.get(AdmissionFeatures), 'formats').mockReturnValue(['text/plain']);
          return c;
        }
        async function versionHttp(
          c: Consumer,
          path: string,
          payload: unknown,
          extra: Record<string, string>,
        ) {
          const response = await fetch(config.AUTH_PUBLIC_ORIGIN + path, {
            method: 'POST',
            headers: {
              authorization: `Bearer ${c.accessToken}`,
              'content-type': 'application/json',
              ...extra,
            },
            body: JSON.stringify(payload),
            redirect: 'error',
          });
          const raw = await response.text();
          return {
            statusCode: response.status,
            headers: Object.fromEntries(response.headers),
            json: () => JSON.parse(raw),
          };
        }
        async function versionUpload(
          c: Consumer,
          docId?: string,
          body = '0123456789',
          key = randomUUID(),
          fields: Record<string, unknown> = {},
        ) {
          await coordinated((tx) => observeCapacity(tx, tmpdir(), tmpdir()));
          const current = docId ? await api(c, `/v1/documents/${docId}`) : null;
          const input = {
            ...descriptor,
            ...(current ? { title: current.json().title, metadata: current.json().metadata } : {}),
            contentType: 'text/plain',
            size: Buffer.byteLength(body),
            sha256: hash(body),
            ...fields,
          };
          const response = docId
            ? await versionHttp(c, `/v1/documents/${docId}/versions/uploads`, input, {
                'idempotency-key': key,
                'if-match': current?.headers.etag as string,
              })
            : await start(c, input, key);
          expect(response.statusCode).toBe(201);
          const value = response.json();
          expect(
            (
              await fetch(value.transfer.url, {
                method: 'PUT',
                headers: value.transfer.headers,
                body,
              })
            ).status,
          ).toBe(200);
          return value.session;
        }
        async function finishVersion(id: string, outcome = 'PASSED', defer = false) {
          await discoverUploads(work(), privateApp.get(StorageService));
          await selectCandidates(work(), privateApp.get(StorageService));
          await selectRestores(work(), privateApp.get(StorageService));
          const message = await work().internal(
            async (tx) =>
              (
                await tx.client.query(
                  `SELECT j.id AS "jobId",d.id AS "dispatchId",j.generation,j.task FROM dms.work_job j JOIN dms.work_dispatch d ON d.job_id=j.id AND d.generation=j.generation WHERE j.upload_id=$1`,
                  [id],
                )
              ).rows[0],
          );
          const claimed = await call('scanner', '/attempts/claim', { version: 1, ...message });
          expect(claimed.statusCode).toBe(200);
          const lease = claimed.json().lease;
          const cap = (await call('scanner', '/attempts/candidate', lease)).json();
          const body = await (await fetch(cap.url)).text();
          const now = new Date().toISOString();
          const evidence = {
            candidateId: cap.candidateId,
            outcome,
            code: outcome === 'PASSED' ? 'OK' : 'MALWARE',
            sha256: hash(body),
            size: Buffer.byteLength(body),
            contentType: 'text/plain',
            policy: 'utf8-text-v1',
            engine: 'ClamAV fixture',
            signatures: '1',
            signatureTime: now,
            startedAt: now,
            finishedAt: now,
            complete: outcome === 'PASSED',
            isolated: outcome === 'PASSED',
          };
          if (defer) return { lease, evidence, body, cap };
          const result = await call('scanner', '/attempts/result', {
            ...lease,
            outcome: 'SUCCEEDED',
            code: 'OK',
            assessment: evidence,
          });
          expect(result.statusCode).toBe(200);
          await settleCandidates(work());
          return { lease, evidence, body, cap };
        }
        async function restoreVersion(
          c: Consumer,
          doc: string,
          version: string,
          key = randomUUID(),
          etag?: string,
        ) {
          await coordinated((tx) => observeCapacity(tx, tmpdir(), tmpdir()));
          return versionHttp(
            c,
            `/v1/documents/${doc}/versions/${version}/restore`,
            { profile: 'secure-only' },
            {
              'idempotency-key': key,
              'if-match': etag ?? ((await api(c, `/v1/documents/${doc}`)).headers.etag as string),
            },
          );
        }
        async function sharedHttp(
          c: Consumer,
          method: string,
          id: string,
          suffix = '',
          body?: unknown,
          etag?: string,
        ) {
          const r = await fetch(`${config.AUTH_PUBLIC_ORIGIN}/v1/documents/${id}${suffix}`, {
            method,
            headers: {
              authorization: `Bearer ${c.accessToken}`,
              ...(body === undefined ? {} : { 'content-type': 'application/json' }),
              ...(etag ? { 'if-match': etag } : {}),
            },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            redirect: 'error',
          });
          return {
            statusCode: r.status,
            headers: Object.fromEntries(r.headers),
            json: async () => r.json(),
          };
        }
        async function share(
          c: Consumer,
          id: string,
          grants: { applicationId: string; rights: string[] }[],
        ) {
          const current = await api(c, `/v1/documents/${id}`);
          const r = await sharedHttp(
            c,
            'PUT',
            id,
            '/permissions',
            { grants },
            current.headers.etag as string,
          );
          expect(r.statusCode).toBe(200);
          return r;
        }
        async function lifecycle(c: Consumer, id: string) {
          return api(c, `/v1/documents/${id}/lifecycle`);
        }
        async function deleteLogical(c: Consumer, id: string, etag?: string) {
          const d = etag ? null : await api(c, `/v1/documents/${id}`);
          return sharedHttp(c, 'DELETE', id, '', undefined, etag ?? (d?.headers.etag as string));
        }
        async function restoreLogical(c: Consumer, id: string, key = randomUUID(), etag?: string) {
          const d = etag ? null : await lifecycle(c, id);
          return versionHttp(
            c,
            `/v1/documents/${id}/restore`,
            {},
            { 'if-match': etag ?? (d?.headers.etag as string), 'idempotency-key': key },
          );
        }
        async function verifyLifecycle() {
          await coordinated((tx) => observeCapacity(tx, tmpdir(), tmpdir()));
          await restoreLifecycleVersions(work(), privateApp.get(StorageService));
        }
        it('releases abandoned reservations after capability expiry and retains observed bytes', async () => {
          const c = await versionConsumer();
          const empty = (await start(c, { ...descriptor, contentType: 'text/plain' })).json()
            .session;
          const copied = await versionUpload(c);
          await req(c, 'DELETE', `/v1/uploads/${empty.id}`);
          await req(c, 'DELETE', `/v1/uploads/${copied.id}`);
          await settleAbandonedUploads(work(), privateApp.get(StorageService));
          await withTenant(owner, tenantId, async (db) => {
            expect(
              (await db.query('SELECT state FROM dms.upload_admission WHERE id=$1', [empty.id]))
                .rows[0].state,
            ).toBe('RESERVED');
            await db.query(
              "UPDATE dms.upload_admission SET capability_expires_at=now()-interval '61 seconds' WHERE id=ANY($1::uuid[])",
              [[empty.id, copied.id]],
            );
          });
          await settleAbandonedUploads(work(), privateApp.get(StorageService));
          await settleAbandonedUploads(work(), privateApp.get(StorageService));
          await withTenant(owner, tenantId, async (db) => {
            const rows = (
              await db.query(
                'SELECT state,staging_bytes,original_bytes,work_released FROM dms.upload_admission ORDER BY staging_bytes',
              )
            ).rows;
            expect(rows).toEqual([
              { state: 'RELEASED', staging_bytes: '0', original_bytes: '0', work_released: true },
              { state: 'RELEASED', staging_bytes: '10', original_bytes: '0', work_released: true },
            ]);
            expect(
              (
                await db.query(
                  'SELECT active,queued,reserved_storage,reserved_scratch FROM dms.admission_tenant_usage',
                )
              ).rows[0],
            ).toMatchObject({ active: 0, queued: 0, reserved_storage: '0', reserved_scratch: '0' });
          });
        });
        it('keeps a binary restore retryable after an original HEAD outage', async () => {
          const c = await versionConsumer(),
            v = await versionUpload(c);
          await finishVersion(v.id);
          const restored = await restoreVersion(c, v.documentId, v.versionId);
          expect(restored.statusCode).toBe(202);
          fixture.faults.failHead = 1;
          await expect(selectRestores(work(), privateApp.get(StorageService))).rejects.toThrow();
          expect(
            (await req(c, 'GET', `/v1/uploads/${restored.json().session.id}`)).json().upload,
          ).toBe('OBJECT_VERIFIED');
          await finishVersion(restored.json().session.id);
          expect(
            (await req(c, 'GET', `/v1/uploads/${restored.json().session.id}`)).json().upload,
          ).toBe('COMPLETED');
        });
        it('does not require an unconfirmed failed copy destination in recovery inventory', async () => {
          const c = await versionConsumer(),
            v = await versionUpload(c);
          await discoverUploads(work(), privateApp.get(StorageService));
          const snapshot = privateApp.get(StorageService).forRole('snapshot');
          const failed = vi
            .spyOn(snapshot, 'snapshot')
            .mockRejectedValueOnce(new Error('copy transport unavailable'));
          await selectCandidates(work(), privateApp.get(StorageService));
          failed.mockRestore();
          const { requiredRecoveryObjectsSql } = await import(
            '../src/infrastructure/recovery/object-inventory.js'
          );
          await withTenant(owner, tenantId, async (db) => {
            expect(
              (
                await db.query('SELECT state,etag FROM dms.security_candidate WHERE upload_id=$1', [
                  v.id,
                ])
              ).rows[0],
            ).toMatchObject({ state: 'INCONCLUSIVE', etag: 'pending' });
            const required = (
              await db.query(requiredRecoveryObjectsSql, [
                tenantId,
                'staging',
                'originals',
                'artifacts',
                null,
                null,
              ])
            ).rows;
            expect(required.map((r) => r.bucket)).toEqual([]);
          });
          await withTenant(owner, tenantId, (db) =>
            db.query(
              "UPDATE dms.upload_admission SET capability_expires_at=now()-interval '61 seconds' WHERE id=$1",
              [v.id],
            ),
          );
          await settleAbandonedUploads(work(), privateApp.get(StorageService));
          await withTenant(owner, tenantId, async (db) =>
            expect(
              (
                await db.query(
                  'SELECT state,staging_bytes,original_bytes FROM dms.upload_admission WHERE id=$1',
                  [v.id],
                )
              ).rows[0],
            ).toMatchObject({ state: 'RELEASED', staging_bytes: '10', original_bytes: '0' }),
          );
        });
        it('I19 gates physical disposal on current backup horizons and confirms removal before releasing usage', async () => {
          const { manageRecovery } = await import('../src/modules/lifecycle/manage-recovery.js');
          const { disposeObjects } = await import('../src/modules/lifecycle/disposal.js');
          const recovery = (action: string, extra: Record<string, unknown> = {}) =>
            manageRecovery({ action, operatorEmail: email, operatorPassword: password, ...extra });
          const c = await versionConsumer(),
            v = await versionUpload(c);
          await finishVersion(v.id);
          const restored = await restoreVersion(c, v.documentId, v.versionId);
          expect(restored.statusCode).toBe(202);
          await finishVersion(restored.json().session.id);
          expect((await deleteLogical(c, v.documentId)).statusCode).toBe(200);
          await expect(
            recovery('disposal-request', { documentId: v.documentId }),
          ).rejects.toThrow();
          await withTenant(owner, tenantId, async (db) => {
            await db.query(
              "UPDATE dms.document SET deleted_at=now()-interval '40 days',restore_deadline=now()-interval '10 days' WHERE id=$1",
              [v.documentId],
            );
            await db.query(
              "UPDATE dms.upload_admission SET expires_at=now()-interval '40 days',capability_expires_at=NULL WHERE document_id=$1",
              [v.documentId],
            );
            await db.query(
              "INSERT INTO dms.backup_catalog(id,tenant_id,recovery_point,expires_at,manifest_sha256,repository_id,confirmed_off_host,bytes) VALUES($1,$2,now(),now()+interval '7 days',$3,'fixture',true,100)",
              [randomUUID(), tenantId, 'a'.repeat(64)],
            );
          });
          const old = randomUUID();
          await withTenant(owner, tenantId, (db) =>
            db.query(
              "INSERT INTO dms.backup_catalog(id,tenant_id,recovery_point,expires_at,manifest_sha256,repository_id,confirmed_off_host,bytes) VALUES($1,$2,now()-interval '20 days',now()+interval '1 day',$3,'fixture',true,100)",
              [old, tenantId, 'b'.repeat(64)],
            ),
          );
          await expect(
            recovery('disposal-request', { documentId: v.documentId }),
          ).rejects.toThrow();
          await withTenant(owner, tenantId, (db) =>
            db.query('DELETE FROM dms.backup_catalog WHERE id=$1', [old]),
          );
          const pending = randomUUID();
          await withTenant(owner, tenantId, (db) =>
            db.query(
              "INSERT INTO dms.backup_catalog(id,tenant_id,recovery_point,expires_at,repository_id,verified_at) VALUES($1,$2,now()-interval '20 days',now()+interval '1 day','fixture',NULL)",
              [pending, tenantId],
            ),
          );
          await expect(
            recovery('disposal-request', { documentId: v.documentId }),
          ).rejects.toThrow();
          await withTenant(owner, tenantId, (db) =>
            db.query('DELETE FROM dms.backup_catalog WHERE id=$1', [pending]),
          );
          expect(await recovery('disposal-request', { documentId: v.documentId })).toMatchObject({
            planned: 2,
          });
          // Older ineligible intents must not occupy the bounded cleanup batch.
          await withTenant(owner, tenantId, async (db) => {
            for (let i = 0; i < 5; i++)
              await db.query(
                "INSERT INTO dms.disposal_intent(id,tenant_id,application_id,area,object_id,requested_by,next_attempt_at) VALUES($1,$2,$3,'originals',$4,'fixture',now()-interval '1 hour')",
                [
                  randomUUID(),
                  tenantId,
                  (
                    await db.query('SELECT application_id FROM dms.document WHERE id=$1', [
                      v.documentId,
                    ])
                  ).rows[0].application_id,
                  randomUUID(),
                ],
              );
          });
          const before = await work().internal(
            async (tx) =>
              (
                await tx.client.query(
                  'SELECT original_bytes,staging_bytes FROM dms.admission_tenant_usage',
                )
              ).rows[0],
          );
          expect(Number(before.original_bytes)).toBe(10);
          fixture.faults.loseDeleteAck = 1;
          fixture.faults.failHead = 1;
          await disposeObjects(work(), privateApp.get(StorageService));
          expect(fixture.faults).toEqual({ loseDeleteAck: 0, failHead: 0 });
          expect(
            await work().internal(
              async (tx) =>
                (await tx.client.query('SELECT original_bytes FROM dms.admission_tenant_usage'))
                  .rows[0],
            ),
          ).toMatchObject({ original_bytes: '10' });
          await withTenant(owner, tenantId, (db) =>
            db.query(
              "UPDATE dms.disposal_intent SET next_attempt_at=now()-interval '1 second',lease_until=NULL WHERE state<>'COMPLETE'",
            ),
          );
          await disposeObjects(work(), privateApp.get(StorageService));
          await disposeObjects(work(), privateApp.get(StorageService));
          await withTenant(owner, tenantId, async (db) => {
            expect(
              (await db.query('SELECT lifecycle FROM dms.document WHERE id=$1', [v.documentId]))
                .rows[0].lifecycle,
            ).toBe('PURGED');
            expect(
              (
                await db.query(
                  'SELECT original_bytes,staging_bytes FROM dms.admission_tenant_usage',
                )
              ).rows[0],
            ).toMatchObject({ original_bytes: '0', staging_bytes: '0' });
            expect(
              (
                await db.query(
                  "SELECT count(*)::int AS n FROM dms.audit_event WHERE document_id=$1 AND action='disposal.completed'",
                  [v.documentId],
                )
              ).rows[0].n,
            ).toBe(2);
            expect(
              (await db.query('SELECT count(*)::int AS n FROM dms.security_candidate')).rows[0].n,
            ).toBe(2);
          });
        });
        it('I19 keeps restored authority and consumer access closed until verified administrator approval', async () => {
          const { manageRecovery } = await import('../src/modules/lifecycle/manage-recovery.js');
          const c = await consumer(),
            id = randomUUID(),
            digest = 'c'.repeat(64);
          await withTenant(owner, tenantId, (db) =>
            db.query(
              "INSERT INTO dms.recovery_state(tenant_id,state,backup_id,manifest_sha256) VALUES($1,'CLOSED',$2,$3)",
              [tenantId, id, digest],
            ),
          );
          expect((await app.inject('/health/ready/api')).statusCode).toBe(503);
          expect((await api(c, '/v1/capabilities')).statusCode).toBe(503);
          const open = () =>
            manageRecovery({
              action: 'recovery-open',
              operatorEmail: email,
              operatorPassword: password,
              backupId: id,
              manifestSha256: digest,
              accessReviewed: true,
            });
          await expect(open()).rejects.toThrow();
          await withTenant(owner, tenantId, (db) =>
            db.query('UPDATE dms.recovery_state SET verified_at=now()'),
          );
          expect(await open()).toMatchObject({ opened: true });
          expect((await app.inject('/health/ready/api')).statusCode).toBe(200);
        });
        it('I13 withdraws shared reads immediately and restores the same identity only after retained-byte verification and fresh assessment', async () => {
          const a = await versionConsumer(),
            b = await consumer(),
            v = await versionUpload(a);
          await finishVersion(v.id);
          await share(a, v.documentId, [{ applicationId: b.applicationId, rights: ['READ'] }]);
          const cap = (await api(b, `/v1/documents/${v.documentId}/download`)).json();
          const before = await withTenant(
            owner,
            tenantId,
            async (db) =>
              (
                await db.query(
                  'SELECT original_bytes,staging_bytes FROM dms.admission_application_usage WHERE application_id=$1',
                  [a.applicationId],
                )
              ).rows[0],
          );
          const oldExpiry = new Date(Date.now() - 86400000);
          await withTenant(owner, tenantId, (db) =>
            db.query(
              'UPDATE dms.upload_admission SET expires_at=$2,capability_expires_at=$2 WHERE id=$1',
              [v.id, oldExpiry],
            ),
          );
          const removed = await deleteLogical(a, v.documentId);
          expect(removed.statusCode).toBe(200);
          const state = await removed.json();
          expect(state).toMatchObject({
            lifecycle: 'SOFT_DELETED',
            generation: 2,
            currentVersionId: v.versionId,
            downloadable: false,
          });
          expect(
            new Date(state.restoreDeadline).getTime() - new Date(state.deletedAt).getTime(),
          ).toBe(30 * 86400000);
          for (const c of [a, b])
            for (const path of [
              `/v1/documents/${v.documentId}`,
              `/v1/documents/${v.documentId}/versions`,
              `/v1/documents/${v.documentId}/download`,
              `/v1/uploads/${v.id}`,
            ])
              expect((await api(c, path)).statusCode).toBe(404);
          expect((await api(b, '/v1/documents')).json().items).toHaveLength(0);
          expect(await (await fetch(cap.url)).text()).toBe('0123456789');
          const key = randomUUID(),
            restoreEtag = `"${state.revision}"`,
            restored = await restoreLogical(a, v.documentId, key, restoreEtag);
          expect(restored.statusCode).toBe(202);
          expect(restored.json()).toMatchObject({
            lifecycle: 'ACTIVE',
            generation: 3,
            downloadable: false,
            restoration: { state: 'PENDING' },
          });
          expect((await api(a, `/v1/documents/${v.documentId}/download`)).statusCode).toBe(409);
          await verifyLifecycle();
          await withTenant(owner, tenantId, async (db) => {
            expect(
              (
                await db.query(
                  'SELECT sha256,evidence,state FROM dms.security_candidate WHERE upload_id=$1',
                  [v.id],
                )
              ).rows[0],
            ).toMatchObject({ sha256: null, evidence: null, state: 'PENDING' });
            expect((await db.query('SELECT * FROM dms.security_assessment_history')).rowCount).toBe(
              1,
            );
          });
          await finishVersion(v.id);
          expect((await lifecycle(a, v.documentId)).json()).toMatchObject({
            downloadable: true,
            restoration: { state: 'COMPLETE', completed: 1 },
          });
          const history = (await api(a, `/v1/documents/${v.documentId}/versions`)).json();
          expect(history.items).toHaveLength(1);
          expect(history.items[0].id).toBe(v.versionId);
          const shared = (await api(b, `/v1/documents/${v.documentId}/download`)).json();
          expect(await (await fetch(shared.url)).text()).toBe('0123456789');
          const replay = await restoreLogical(a, v.documentId, key, restoreEtag);
          expect(replay.statusCode).toBe(200);
          expect(replay.json().generation).toBe(3);
          await withTenant(owner, tenantId, async (db) =>
            expect(
              (
                await db.query(
                  'SELECT original_bytes,staging_bytes FROM dms.admission_application_usage WHERE application_id=$1',
                  [a.applicationId],
                )
              ).rows[0],
            ).toEqual(before),
          );
        });
        it('I13 cancels running generations and rejects old leases and late uploads even after logical restore', async () => {
          const a = await versionConsumer(),
            v = await versionUpload(a);
          await finishVersion(v.id);
          const pending = await versionUpload(a, v.documentId, 'replacement'),
            old = await finishVersion(pending.id, 'PASSED', true);
          const deleted = await deleteLogical(a, v.documentId);
          expect(deleted.statusCode).toBe(200);
          expect((await call('scanner', '/attempts/heartbeat', old.lease)).statusCode).toBe(409);
          expect(
            (
              await call('scanner', '/attempts/result', {
                ...old.lease,
                outcome: 'SUCCEEDED',
                code: 'OK',
                assessment: old.evidence,
              })
            ).statusCode,
          ).toBe(409);
          expect((await restoreLogical(a, v.documentId)).statusCode).toBe(202);
          expect(
            (
              await call('scanner', '/attempts/result', {
                ...old.lease,
                outcome: 'SUCCEEDED',
                code: 'OK',
                assessment: old.evidence,
              })
            ).statusCode,
          ).toBe(409);
          await verifyLifecycle();
          await finishVersion(v.id);
          const newer = await versionUpload(a, v.documentId, 'after restore');
          await finishVersion(newer.id);
          expect((await api(a, `/v1/documents/${v.documentId}`)).json().currentVersionId).toBe(
            newer.versionId,
          );
          await withTenant(owner, tenantId, async (db) => {
            expect(
              (await db.query('SELECT state FROM dms.work_job WHERE upload_id=$1', [pending.id]))
                .rows[0].state,
            ).toBe('CANCELLED');
            expect(
              (
                await db.query(
                  'SELECT lifecycle_generation FROM dms.upload_admission WHERE id=$1',
                  [newer.id],
                )
              ).rows[0].lifecycle_generation,
            ).toBe(3);
          });
        });
        it('I13 enforces current policy and invalidated-original reassessment without selecting an older current version', async () => {
          const a = await versionConsumer(),
            first = await versionUpload(a);
          await finishVersion(first.id);
          const second = await versionUpload(a, first.documentId, 'new content');
          await finishVersion(second.id);
          const candidate = await withTenant(
            owner,
            tenantId,
            async (db) =>
              (
                await db.query('SELECT id FROM dms.security_candidate WHERE upload_id=$1', [
                  second.id,
                ])
              ).rows[0].id,
          );
          await work().internal((tx) => invalidateCandidate(tx, candidate));
          expect((await deleteLogical(a, first.documentId)).statusCode).toBe(200);
          expect((await restoreLogical(a, first.documentId)).statusCode).toBe(202);
          await fresh('admission-policy-set', {
            expectedRevision: '2',
            policy: { ...policy, contentTypes: ['text/plain'], enabled: false },
          });
          await verifyLifecycle();
          expect((await lifecycle(a, first.documentId)).json()).toMatchObject({
            downloadable: false,
            restoration: { pending: 2, scanning: 0 },
          });
          await fresh('admission-policy-set', {
            expectedRevision: '3',
            policy: { ...policy, contentTypes: ['text/plain'] },
          });
          await withTenant(owner, tenantId, (db) =>
            db.query('UPDATE dms.lifecycle_restore SET next_attempt_at=clock_timestamp()'),
          );
          await verifyLifecycle();
          await finishVersion(first.id);
          await finishVersion(second.id, 'REJECTED');
          expect((await lifecycle(a, first.documentId)).json()).toMatchObject({
            currentVersionId: second.versionId,
            downloadable: false,
            restoration: { state: 'PARTIAL', completed: 1, failed: 1 },
          });
          expect(
            (
              await api(
                a,
                `/v1/documents/${first.documentId}/download?versionId=${first.versionId}`,
              )
            ).statusCode,
          ).toBe(200);
          expect((await api(a, `/v1/documents/${first.documentId}/download`)).statusCode).toBe(409);
        });
        it('I13 guards owner/operator lifecycle authority, stale revisions, deadlines and PURGING without removing retained records', async () => {
          const a = await versionConsumer(),
            b = await consumer(),
            v = await versionUpload(a);
          await finishVersion(v.id);
          await share(a, v.documentId, [
            { applicationId: b.applicationId, rights: ['READ', 'ADD_VERSION', 'EDIT_METADATA'] },
          ]);
          const d = await api(a, `/v1/documents/${v.documentId}`);
          expect((await deleteLogical(b, v.documentId, d.headers.etag as string)).statusCode).toBe(
            404,
          );
          expect((await lifecycle(b, v.documentId)).statusCode).toBe(403);
          expect((await deleteLogical(a, v.documentId, '"1"')).statusCode).toBe(412);
          await withTenant(owner, tenantId, (db) =>
            db.query(
              'UPDATE dms.operator_authorization SET revoked_at=clock_timestamp() WHERE subject_id=$1',
              [operatorId],
            ),
          );
          await expect(
            fresh('document-delete', {
              documentId: v.documentId,
              expectedRevision: d.json().revision,
            }),
          ).rejects.toThrow();
          await fresh('recover');
          expect(
            await fresh('document-delete', {
              documentId: v.documentId,
              expectedRevision: d.json().revision,
            }),
          ).toMatchObject({ lifecycle: 'SOFT_DELETED' });
          const deleted = await fresh('document-lifecycle-read', { documentId: v.documentId });
          if (!('revision' in deleted)) throw new Error('Lifecycle result required');
          const restore = await fresh('document-restore', {
            documentId: v.documentId,
            expectedRevision: deleted.revision,
            idempotencyKey: randomUUID(),
          });
          expect(restore).toMatchObject({ lifecycle: 'ACTIVE', generation: 3 });
          const active = await lifecycle(a, v.documentId);
          expect(
            (await deleteLogical(a, v.documentId, active.headers.etag as string)).statusCode,
          ).toBe(200);
          const past = new Date(Date.now() - 31 * 86400000),
            deadline = new Date(past.getTime() + 30 * 86400000);
          await withTenant(owner, tenantId, (db) =>
            db.query('UPDATE dms.document SET deleted_at=$2,restore_deadline=$3 WHERE id=$1', [
              v.documentId,
              past,
              deadline,
            ]),
          );
          expect((await restoreLogical(a, v.documentId)).statusCode).toBe(410);
          await withTenant(owner, tenantId, (db) =>
            db.query("UPDATE dms.document SET lifecycle='PURGING' WHERE id=$1", [v.documentId]),
          );
          expect((await restoreLogical(a, v.documentId)).statusCode).toBe(409);
          await withTenant(owner, tenantId, async (db) =>
            expect(
              (
                await db.query('SELECT * FROM dms.document_version WHERE document_id=$1', [
                  v.documentId,
                ])
              ).rowCount,
            ).toBe(1),
          );
          const runtime = app.get(DmsDatabaseService).pool;
          if (!runtime) throw new Error('Runtime pool');
          await expect(
            withTenant(runtime, tenantId, (db) =>
              db.query("UPDATE dms.document SET lifecycle='PURGED' WHERE id=$1", [v.documentId]),
            ),
          ).rejects.toMatchObject({ code: '42501' });
        });
        for (const corruption of ['missing', 'changed'] as const)
          it(`I13 keeps ${corruption} retained originals unavailable and charged`, async () => {
            const a = await versionConsumer(),
              v = await versionUpload(a);
            await finishVersion(v.id);
            const c = await withTenant(
              owner,
              tenantId,
              async (db) =>
                (await db.query('SELECT * FROM dms.security_candidate WHERE upload_id=$1', [v.id]))
                  .rows[0],
            );
            const before = await withTenant(
              owner,
              tenantId,
              async (db) =>
                (
                  await db.query(
                    'SELECT original_bytes,staging_bytes FROM dms.admission_application_usage WHERE application_id=$1',
                    [a.applicationId],
                  )
                ).rows[0],
            );
            expect((await deleteLogical(a, v.documentId)).statusCode).toBe(200);
            const reference = {
              area: 'originals' as const,
              tenantId,
              applicationId: a.applicationId,
              id: c.object_id,
            };
            await privateApp.get(StorageService).forRole('cleanup').deleteExact(reference);
            if (corruption === 'changed') {
              const other = await versionUpload(a, undefined, 'abcdefghij');
              const staging = await withTenant(
                owner,
                tenantId,
                async (db) =>
                  (
                    await db.query('SELECT staging_id FROM dms.upload_session WHERE id=$1', [
                      other.id,
                    ])
                  ).rows[0].staging_id,
              );
              const source = {
                area: 'staging' as const,
                tenantId,
                applicationId: a.applicationId,
                id: staging,
              };
              const snapshot = privateApp.get(StorageService).forRole('snapshot');
              await snapshot.snapshot(source, (await snapshot.head(source)).etag, c.object_id);
            }
            expect((await restoreLogical(a, v.documentId)).statusCode).toBe(202);
            await verifyLifecycle();
            expect((await lifecycle(a, v.documentId)).json()).toMatchObject({
              downloadable: false,
              restoration: { state: 'FAILED', failed: 1 },
            });
            expect((await api(a, `/v1/documents/${v.documentId}/download`)).statusCode).toBe(409);
            await withTenant(owner, tenantId, async (db) => {
              expect(
                (
                  await db.query(
                    'SELECT original_bytes,staging_bytes FROM dms.admission_application_usage WHERE application_id=$1',
                    [a.applicationId],
                  )
                ).rows[0],
              ).toEqual(before);
              expect(
                (
                  await db.query(
                    'SELECT failure_code FROM dms.lifecycle_restore WHERE document_id=$1',
                    [v.documentId],
                  )
                ).rows[0].failure_code,
              ).toBe(corruption === 'missing' ? 'OBJECT_UNAVAILABLE' : 'INTEGRITY_MISMATCH');
            });
          });
        it('I12 READ covers live metadata/history/status/download but grants no mutation, audit, restoration or administration', async () => {
          const a = await versionConsumer(),
            b = await consumer(),
            v = await versionUpload(a);
          await finishVersion(v.id);
          expect((await api(b, `/v1/documents/${v.documentId}`)).statusCode).toBe(404);
          expect((await api(b, '/v1/documents')).json().items).toHaveLength(0);
          await app
            .get(DmsDatabaseService)
            .withMachine(await principal(b), ['dms:documents:read'], async (tx) => {
              expect(
                (await tx.client.query('SELECT dms.upload_document($1) AS document_id', [v.id]))
                  .rows[0].document_id,
              ).toBeNull();
            });

          await share(a, v.documentId, [{ applicationId: b.applicationId, rights: ['READ'] }]);
          expect((await api(b, `/v1/documents/${v.documentId}`)).json()).toMatchObject({
            applicationId: a.applicationId,
            downloadable: true,
          });
          expect(
            (await api(b, `/v1/documents/${v.documentId}/versions`)).json().items,
          ).toHaveLength(1);
          expect((await api(b, `/v1/uploads/${v.id}`)).statusCode).toBe(200);
          expect(
            (await api(b, `/v1/documents/${v.documentId}/download?versionId=${v.versionId}`))
              .statusCode,
          ).toBe(200);
          const current = await api(a, `/v1/documents/${v.documentId}`),
            etag = current.headers.etag as string;
          expect(
            (await sharedHttp(b, 'PATCH', v.documentId, '', { title: 'forbidden' }, etag))
              .statusCode,
          ).toBe(404);
          expect(
            (await sharedHttp(b, 'PUT', v.documentId, '/permissions', { grants: [] }, etag))
              .statusCode,
          ).toBe(404);
          expect((await api(b, `/v1/documents/${v.documentId}/permissions`)).statusCode).toBe(403);
          expect((await api(b, `/v1/documents/${v.documentId}/audit`)).statusCode).toBe(404);
          expect(
            (
              await versionHttp(
                b,
                `/v1/documents/${v.documentId}/versions/${v.versionId}/restore`,
                { profile: 'secure-only' },
                { 'if-match': etag, 'idempotency-key': randomUUID() },
              )
            ).statusCode,
          ).toBe(403);
          const signer = app.get(StorageService).forRole('originalRead'),
            originalSign = signer.downloadOriginal.bind(signer);
          let releaseSigning = () => {},
            enteredSigning = () => {};
          const signingEntered = new Promise<void>((resolve) => {
              enteredSigning = resolve;
            }),
            signingRelease = new Promise<void>((resolve) => {
              releaseSigning = resolve;
            });
          const signing = vi
            .spyOn(signer, 'downloadOriginal')
            .mockImplementationOnce(async (...args) => {
              enteredSigning();
              await signingRelease;
              return originalSign(...args);
            });
          try {
            const issuance = Promise.resolve(api(b, `/v1/documents/${v.documentId}/download`));
            await signingEntered;
            let revoked = false;
            const revocation = share(a, v.documentId, []).then((result) => {
              revoked = true;
              return result;
            });
            await new Promise((resolve) => setTimeout(resolve, 25));
            expect(revoked).toBe(false);
            releaseSigning();
            const issued = await issuance;
            expect(issued.statusCode).toBe(200);
            await revocation;
            expect(await (await fetch(issued.json().url)).text()).toBe('0123456789');
          } finally {
            releaseSigning();
            signing.mockRestore();
          }
          for (const path of [
            `/v1/documents/${v.documentId}`,
            `/v1/documents/${v.documentId}/versions`,
            `/v1/documents/${v.documentId}/download`,
            `/v1/uploads/${v.id}`,
          ])
            expect((await api(b, path)).statusCode).toBe(404);
          expect((await api(b, '/v1/documents')).json().items).toHaveLength(0);
        });
        it('I12 EDIT_METADATA and ADD_VERSION remain independent and preserve owner storage/accounting through contributor uploads', async () => {
          const a = await versionConsumer(),
            b = await consumer(),
            v = await versionUpload(a);
          await finishVersion(v.id);
          await share(a, v.documentId, [
            { applicationId: b.applicationId, rights: ['EDIT_METADATA'] },
          ]);
          let current = await api(a, `/v1/documents/${v.documentId}`);
          expect(
            (
              await sharedHttp(
                b,
                'PATCH',
                v.documentId,
                '',
                { title: 'Shared edit', tags: ['review'] },
                current.headers.etag as string,
              )
            ).statusCode,
          ).toBe(200);
          expect((await api(b, `/v1/documents/${v.documentId}`)).statusCode).toBe(404);
          current = await api(a, `/v1/documents/${v.documentId}`);
          const input = {
            ...descriptor,
            title: current.json().title,
            metadata: current.json().metadata,
            contentType: 'text/plain',
            size: 10,
            profile: 'secure-only',
          };
          expect(
            (
              await versionHttp(b, `/v1/documents/${v.documentId}/versions/uploads`, input, {
                'if-match': current.headers.etag as string,
                'idempotency-key': randomUUID(),
              })
            ).statusCode,
          ).toBe(404);
          await share(a, v.documentId, [
            { applicationId: b.applicationId, rights: ['ADD_VERSION'] },
          ]);
          current = await api(a, `/v1/documents/${v.documentId}`);
          const key = randomUUID(),
            headers = { 'if-match': current.headers.etag as string, 'idempotency-key': key };
          await coordinated((tx) => observeCapacity(tx, tmpdir(), tmpdir()));
          const begun = await versionHttp(
            b,
            `/v1/documents/${v.documentId}/versions/uploads`,
            input,
            headers,
          );
          expect(begun.statusCode).toBe(201);
          const result = begun.json();
          expect(new URL(result.transfer.url).pathname).toContain(a.applicationId);
          expect(
            (
              await fetch(result.transfer.url, {
                method: 'PUT',
                headers: result.transfer.headers,
                body: '0123456789',
              })
            ).status,
          ).toBe(200);
          expect(
            (
              await versionHttp(b, `/v1/documents/${v.documentId}/versions/uploads`, input, headers)
            ).json().session.id,
          ).toBe(result.session.id);
          expect((await api(b, `/v1/documents/${v.documentId}/download`)).statusCode).toBe(404);
          expect(
            (await req(a, 'POST', `/v1/uploads/${result.session.id}/complete`, {}, randomUUID()))
              .statusCode,
          ).toBe(202);
          expect(
            (await req(b, 'POST', `/v1/uploads/${result.session.id}/complete`, {}, randomUUID()))
              .statusCode,
          ).toBe(202);
          await finishVersion(result.session.id);
          expect((await api(a, `/v1/documents/${v.documentId}`)).json()).toMatchObject({
            applicationId: a.applicationId,
            currentVersionId: result.session.versionId,
            title: 'Shared edit',
          });
          await withTenant(owner, tenantId, async (db) => {
            expect(
              (
                await db.query(
                  'SELECT application_id,contributor_application_id FROM dms.upload_admission WHERE id=$1',
                  [result.session.id],
                )
              ).rows[0],
            ).toEqual({
              application_id: a.applicationId,
              contributor_application_id: b.applicationId,
            });
            expect(
              (
                await db.query(
                  'SELECT original_bytes FROM dms.admission_application_usage WHERE application_id=$1',
                  [a.applicationId],
                )
              ).rows[0].original_bytes,
            ).toBe('20');
          });
          await share(a, v.documentId, []);
          expect(
            (await versionHttp(b, `/v1/documents/${v.documentId}/versions/uploads`, input, headers))
              .statusCode,
          ).toBe(404);
          const control = await fetch(
            `${config.AUTH_PUBLIC_ORIGIN}/v1/uploads/${result.session.id}/refresh`,
            {
              method: 'POST',
              headers: {
                authorization: `Bearer ${b.accessToken}`,
                'content-type': 'application/json',
              },
              body: '{}',
            },
          );
          expect(control.status).toBe(404);
        });
        it('I12 supports contributor new-version batch binding and revokes current scopes and shared projections', async () => {
          const a = await versionConsumer(),
            b = await consumer(),
            v = await versionUpload(a);
          await finishVersion(v.id);
          await share(a, v.documentId, [
            { applicationId: b.applicationId, rights: ['READ', 'ADD_VERSION'] },
          ]);
          const d = await api(a, `/v1/documents/${v.documentId}`),
            input = {
              ...descriptor,
              title: d.json().title,
              metadata: d.json().metadata,
              contentType: 'text/plain',
              expectedRevision: d.json().revision,
              documentId: v.documentId,
            };
          const batch = (
            await req(
              b,
              'POST',
              '/v1/upload-batches',
              { items: [{ itemId: 'shared', operation: 'new-version', descriptor: input }] },
              randomUUID(),
            )
          ).json().batch;
          await coordinated((tx) => observeCapacity(tx, tmpdir(), tmpdir()));
          const { documentId: _doc, expectedRevision: _rev, ...body } = input;
          const begun = await versionHttp(
            b,
            `/v1/documents/${v.documentId}/versions/uploads`,
            { ...body, batchId: batch.id, itemId: 'shared' },
            { 'if-match': d.headers.etag as string, 'idempotency-key': randomUUID() },
          );
          expect(begun.statusCode).toBe(201);
          expect(
            (await req(b, 'GET', `/v1/upload-batches/${batch.id}`)).json().items[0].session.id,
          ).toBe(begun.json().session.id);
          await share(a, v.documentId, [
            { applicationId: b.applicationId, rights: ['ADD_VERSION'] },
          ]);
          expect(
            (await req(b, 'GET', `/v1/upload-batches/${batch.id}`)).json().items[0].session,
          ).toBeNull();
          await share(a, v.documentId, [{ applicationId: b.applicationId, rights: ['READ'] }]);
          expect(
            (await req(b, 'GET', `/v1/upload-batches/${batch.id}`)).json().items[0].session.id,
          ).toBe(begun.json().session.id);
          expect(
            (
              await req(
                b,
                'POST',
                `/v1/uploads/${begun.json().session.id}/complete`,
                {},
                randomUUID(),
              )
            ).statusCode,
          ).toBe(404);
          expect((await req(b, 'DELETE', `/v1/upload-batches/${batch.id}`)).statusCode).toBe(200);
          await withTenant(owner, tenantId, (db) =>
            db.query("UPDATE dms.application_registration SET status='disabled' WHERE id=$1", [
              b.applicationId,
            ]),
          );
          expect((await api(b, `/v1/documents/${v.documentId}`)).statusCode).toBe(403);
          const ownerDoc = await api(a, `/v1/documents/${v.documentId}`);
          expect(
            (
              await sharedHttp(
                a,
                'PUT',
                v.documentId,
                '/permissions',
                { grants: [{ applicationId: b.applicationId, rights: ['READ'] }] },
                ownerDoc.headers.etag as string,
              )
            ).statusCode,
          ).toBe(400);
          await withTenant(owner, tenantId, (db) =>
            db.query(
              "UPDATE dms.application_registration SET status=CASE WHEN id=$1 THEN 'active' ELSE 'disabled' END WHERE id=ANY($2::uuid[])",
              [b.applicationId, [a.applicationId, b.applicationId]],
            ),
          );
          expect((await api(b, `/v1/documents/${v.documentId}`)).statusCode).toBe(404);
          expect((await api(b, '/v1/documents')).json().items).toHaveLength(0);
          await withTenant(owner, tenantId, (db) =>
            db.query("UPDATE dms.application_registration SET status='active' WHERE id=$1", [
              a.applicationId,
            ]),
          );
          await withTenant(owner, tenantId, (db) =>
            db.query(
              "UPDATE dms.application_registration SET scope_ceiling=ARRAY['dms:capabilities:read']::text[] WHERE id=$1",
              [b.applicationId],
            ),
          );
          expect((await api(b, `/v1/documents/${v.documentId}`)).statusCode).toBe(403);
        });
        it('I12 owner and fresh operator grant writes reject stale, foreign and ungranted authority and audit the actual actor', async () => {
          const a = await versionConsumer(),
            b = await consumer(),
            v = await versionUpload(a);
          const d = await api(a, `/v1/documents/${v.documentId}`);
          expect(
            (
              await sharedHttp(
                a,
                'PUT',
                v.documentId,
                '/permissions',
                { grants: [{ applicationId: randomUUID(), rights: ['READ'] }] },
                d.headers.etag as string,
              )
            ).statusCode,
          ).toBe(400);
          expect(
            (
              await sharedHttp(
                a,
                'PUT',
                v.documentId,
                '/permissions',
                { grants: [{ applicationId: a.applicationId, rights: ['READ'] }] },
                d.headers.etag as string,
              )
            ).statusCode,
          ).toBe(400);
          await share(a, v.documentId, [{ applicationId: b.applicationId, rights: ['READ'] }]);
          expect(
            (
              await sharedHttp(
                a,
                'PUT',
                v.documentId,
                '/permissions',
                { grants: [] },
                d.headers.etag as string,
              )
            ).statusCode,
          ).toBe(412);
          const current = (await api(a, `/v1/documents/${v.documentId}`)).json();
          const result = await fresh('document-permissions-set', {
            documentId: v.documentId,
            expectedRevision: current.revision,
            permissions: {
              grants: [{ applicationId: b.applicationId, rights: ['READ', 'EDIT_METADATA'] }],
            },
          });
          expect(result).toMatchObject({ grants: [{ applicationId: b.applicationId }] });
          expect(
            await fresh('document-permissions-read', { documentId: v.documentId }),
          ).toMatchObject({ grants: [{ applicationId: b.applicationId }] });
          const updated = (await api(a, `/v1/documents/${v.documentId}`)).json();
          await fresh('document-permissions-set', {
            documentId: v.documentId,
            expectedRevision: updated.revision,
            permissions: { grants: [] },
          });
          expect((await api(b, `/v1/documents/${v.documentId}`)).statusCode).toBe(404);
          const events = (await api(a, `/v1/documents/${v.documentId}/audit`)).json().items;
          expect(
            events.some(
              (e: { action: string; actor: { kind: string } }) =>
                e.action === 'document.permissions-changed' && e.actor.kind === 'operator',
            ),
          ).toBe(true);
          const operatorSubject = (
            await authOwner.query('SELECT id FROM auth."user" WHERE email=$1', [email])
          ).rows[0].id;
          await withTenant(owner, tenantId, async (db) => {
            await db.query(
              'UPDATE dms.operator_authorization SET revoked_at=now() WHERE subject_id=$1',
              [operatorSubject],
            );
          });
          await expect(
            fresh('document-permissions-read', { documentId: v.documentId }),
          ).rejects.toThrow();
          await fresh('recover');
          const runtime = app.get(DmsDatabaseService).pool;
          if (!runtime) throw new Error('Runtime pool required');
          await withTenant(runtime, randomUUID(), async (db) => {
            await db.query(
              "SELECT set_config('app.principal_kind','machine',true),set_config('app.application_id',$1,true)",
              [a.applicationId],
            );
            expect((await db.query('SELECT * FROM dms.document_grant')).rows).toHaveLength(0);
            expect(
              (
                await db.query("SELECT dms.has_document_right($1,'READ') AS allowed", [
                  v.documentId,
                ])
              ).rows[0].allowed,
            ).toBe(false);
          });
        });
        it('I11 edits logical metadata and links/unlinks multiple references through an independent HTTP backend', async () => {
          const c = await versionConsumer(),
            v = await versionUpload(c);
          await finishVersion(v.id);
          const before = (await api(c, `/v1/documents/${v.documentId}`)).json();
          const result = JSON.parse(
            await mq.python(
              ['python', '../../examples/dms/metadata.py'],
              {},
              {
                resource: config.DMS_RESOURCE_URL,
                accessToken: c.accessToken,
                documentId: v.documentId,
                edit: {
                  title: 'Invoice',
                  tags: ['finance'],
                  metadata: { approved: true, amount: 42, labels: ['one', 2, null] },
                },
                references: [
                  { namespace: 'erp', type: 'invoice', externalId: '42' },
                  { namespace: 'crm', type: 'account', externalId: '42' },
                ],
              },
            ),
          );
          expect(result.verified).toBe(true);
          const after = (await api(c, `/v1/documents/${v.documentId}`)).json();
          expect(after).toMatchObject({
            id: before.id,
            currentVersionId: before.currentVersionId,
            title: 'Invoice',
            tags: ['finance'],
            references: [],
            downloadable: true,
          });
          expect(
            (await api(c, '/v1/documents?title=Invoice&tag=finance'))
              .json()
              .items.map((d: { id: string }) => d.id),
          ).toEqual([v.documentId]);
          expect((await api(c, '/v1/documents?title=invoice')).json().items).toHaveLength(0);
          expect(
            (await api(c, `/v1/documents/${v.documentId}/versions`)).json().items,
          ).toHaveLength(1);
          const events = (await api(c, `/v1/documents/${v.documentId}/audit`)).json().items;
          expect(
            events.filter((e: { action: string }) => e.action === 'document.reference-linked'),
          ).toHaveLength(2);
          expect(
            events.filter((e: { action: string }) => e.action === 'document.reference-unlinked'),
          ).toHaveLength(2);
        });
        it('I11 rejects stale or unsafe edits and serializes concurrent mutations without binary allocation', async () => {
          const c = await versionConsumer(),
            v = await versionUpload(c);
          const current = await api(c, `/v1/documents/${v.documentId}`);
          const change = async (body: unknown, etag = current.headers.etag as string) =>
            fetch(`${config.AUTH_PUBLIC_ORIGIN}/v1/documents/${v.documentId}`, {
              method: 'PATCH',
              headers: {
                authorization: `Bearer ${c.accessToken}`,
                'content-type': 'application/json',
                'if-match': etag,
              },
              body: JSON.stringify(body),
            });
          for (const body of [
            {},
            { metadata: { nested: { secret: true } } },
            { metadata: { invalid: '\u0000' } },
            { metadata: { invalid: '\ud800' } },
            { metadata: { array: [{}] } },
            {
              metadata: Object.fromEntries(
                Array.from({ length: 9 }, (_, i) => [`key${i}`, 'x'.repeat(2048)]),
              ),
            },
            { tags: ['a', 'a'] },
            { unexpected: true },
          ])
            expect((await change(body)).status).toBe(400);
          const results = await Promise.all([change({ title: 'A' }), change({ title: 'B' })]);
          expect(results.map((r) => r.status).sort()).toEqual([200, 412]);
          expect((await change({ title: 'stale' })).status).toBe(412);
          expect(
            (await api(c, `/v1/documents/${v.documentId}/versions`)).json().items,
          ).toHaveLength(1);
          const other = await consumer();
          expect(
            (
              await fetch(`${config.AUTH_PUBLIC_ORIGIN}/v1/documents/${v.documentId}`, {
                method: 'PATCH',
                headers: {
                  authorization: `Bearer ${other.accessToken}`,
                  'content-type': 'application/json',
                  'if-match': '"1"',
                },
                body: JSON.stringify({ title: 'hidden' }),
              })
            ).status,
          ).toBe(404);
        });
        it('I11 namespaces references and binds exact filters into signed cursors', async () => {
          const c = await versionConsumer(),
            a = await versionUpload(c),
            b = await versionUpload(c);
          const ref = { namespace: 'erp', type: 'invoice', externalId: 'same-id' };
          for (const v of [a, b]) {
            const d = await api(c, `/v1/documents/${v.documentId}`);
            expect(
              (
                await versionHttp(c, `/v1/documents/${v.documentId}/references`, ref, {
                  'if-match': d.headers.etag as string,
                })
              ).statusCode,
            ).toBe(200);
          }
          const page = await api(
            c,
            '/v1/documents?limit=1&referenceNamespace=erp&referenceType=invoice&referenceId=same-id',
          );
          expect(page.json().items).toHaveLength(1);
          expect(page.json().nextCursor).toBeTruthy();
          const cursor = page.json().nextCursor;
          const next = await api(
            c,
            `/v1/documents?limit=1&referenceNamespace=erp&referenceType=invoice&referenceId=same-id&cursor=${cursor}`,
          );
          expect(next.json().items).toHaveLength(1);
          expect(next.json().items[0].id).not.toBe(page.json().items[0].id);
          expect((await api(c, `/v1/documents?tag=other&cursor=${cursor}`)).statusCode).toBe(400);
          expect((await api(c, '/v1/documents?referenceId=same-id')).statusCode).toBe(400);
          const other = await consumer(),
            foreign = await versionUpload(other);
          const d = await api(other, `/v1/documents/${foreign.documentId}`);
          expect(
            (
              await versionHttp(other, `/v1/documents/${foreign.documentId}/references`, ref, {
                'if-match': d.headers.etag as string,
              })
            ).statusCode,
          ).toBe(200);
          expect(
            (
              await api(
                c,
                '/v1/documents?referenceNamespace=erp&referenceType=invoice&referenceId=same-id',
              )
            ).json().items,
          ).toHaveLength(2);
          expect(
            (
              await api(
                other,
                '/v1/documents?referenceNamespace=erp&referenceType=invoice&referenceId=same-id',
              )
            ).json().items,
          ).toHaveLength(1);
        });
        it('I10 preserves current bytes under out-of-order publication and restores references through a new assessed revision', async () => {
          const c = await versionConsumer(),
            first = await versionUpload(c);
          await finishVersion(first.id);
          const second = await versionUpload(c, first.documentId, '1111111111'),
            third = await versionUpload(c, first.documentId, '2222222222');
          expect((await api(c, `/v1/documents/${first.documentId}`)).json().currentVersionId).toBe(
            first.versionId,
          );
          await finishVersion(third.id);
          await finishVersion(second.id);
          expect((await api(c, `/v1/documents/${first.documentId}`)).json().currentVersionId).toBe(
            third.versionId,
          );
          const old = (
            await api(c, `/v1/documents/${first.documentId}/download?versionId=${first.versionId}`)
          ).json();
          expect(await (await fetch(old.url)).text()).toBe('0123456789');
          const before = await work().internal(
            async (tx) =>
              (
                await tx.client.query(
                  'SELECT original_bytes,staging_bytes FROM dms.admission_tenant_usage',
                )
              ).rows[0],
          );
          const key = randomUUID(),
            etag = (await api(c, `/v1/documents/${first.documentId}`)).headers.etag as string;
          const restored = await restoreVersion(c, first.documentId, first.versionId, key, etag);
          expect(restored.statusCode).toBe(202);
          const session = restored.json().session;
          expect(restored.json().transfer).toBeNull();
          expect(
            (await restoreVersion(c, first.documentId, first.versionId, key, etag)).json().session
              .id,
          ).toBe(session.id);
          expect((await api(c, `/v1/documents/${first.documentId}`)).json().currentVersionId).toBe(
            third.versionId,
          );
          await selectRestores(work(), privateApp.get(StorageService));
          expect(
            await work().internal(
              async (tx) =>
                (
                  await tx.client.query(
                    'SELECT state,sha256,evidence FROM dms.security_candidate WHERE upload_id=$1',
                    [session.id],
                  )
                ).rows[0],
            ),
          ).toMatchObject({ state: 'PENDING', sha256: null, evidence: null });
          expect(
            (
              await api(
                c,
                `/v1/documents/${first.documentId}/download?versionId=${session.versionId}`,
              )
            ).statusCode,
          ).toBe(409);
          await finishVersion(session.id);
          const doc = (await api(c, `/v1/documents/${first.documentId}`)).json();
          expect(doc).toMatchObject({
            currentVersionId: session.versionId,
            title: descriptor.title,
            metadata: descriptor.metadata,
          });
          const cap = (await api(c, `/v1/documents/${first.documentId}/download`)).json();
          expect(new URL(cap.url).pathname).toBe(new URL(old.url).pathname);
          expect(await (await fetch(cap.url)).text()).toBe('0123456789');
          expect(
            await work().internal(
              async (tx) =>
                (
                  await tx.client.query(
                    'SELECT original_bytes,staging_bytes FROM dms.admission_tenant_usage',
                  )
                ).rows[0],
            ),
          ).toEqual(before);
          const history = await api(c, `/v1/documents/${first.documentId}/versions?limit=1`);
          expect(history.statusCode).toBe(200);
          const page = history.json();
          expect(page.items[0]).toMatchObject({
            number: 4,
            isCurrent: true,
            restoredFromVersionId: first.versionId,
          });
          const next = (
            await api(
              c,
              `/v1/documents/${first.documentId}/versions?limit=1&cursor=${page.nextCursor}`,
            )
          ).json();
          expect(next.items[0].number).toBe(3);
          await expect(
            withTenant(owner, tenantId, (db) =>
              db.query(
                'DELETE FROM dms.security_candidate WHERE id=(SELECT source_candidate_id FROM dms.binary_restore WHERE id=$1)',
                [session.id],
              ),
            ),
          ).rejects.toMatchObject({ code: '23503' });
          const stranger = await consumer();
          expect(
            (await api(stranger, `/v1/documents/${first.documentId}/versions`)).statusCode,
          ).toBe(404);
          expect(
            (await api(c, `/v1/documents/${first.documentId}/versions/${second.versionId}`)).json(),
          ).toMatchObject({ number: 2, downloadable: true, isCurrent: false });
        });
        it('I10 replays restoration after metadata changes while binding source, revision and profile', async () => {
          const c = await versionConsumer(),
            first = await versionUpload(c);
          await finishVersion(first.id);
          const second = await versionUpload(c, first.documentId, '1111111111');
          await finishVersion(second.id);
          const key = randomUUID(),
            before = await api(c, `/v1/documents/${first.documentId}`),
            etag = before.headers.etag as string;
          const restored = await restoreVersion(c, first.documentId, first.versionId, key, etag);
          expect(restored.statusCode).toBe(202);
          const original = restored.json();
          const current = await api(c, `/v1/documents/${first.documentId}`);
          expect(
            (
              await sharedHttp(
                c,
                'PATCH',
                first.documentId,
                '',
                {
                  title: 'Changed after restore',
                  metadata: { changed: true },
                },
                current.headers.etag as string,
              )
            ).statusCode,
          ).toBe(200);
          const replay = await restoreVersion(c, first.documentId, first.versionId, key, etag);
          expect(replay.statusCode).toBe(200);
          expect(replay.json()).toMatchObject({
            operationId: original.operationId,
            session: { id: original.session.id, versionId: original.session.versionId },
          });
          await withTenant(owner, tenantId, async (db) => {
            const saved = (
              await db.query('SELECT descriptor FROM dms.upload_session WHERE id=$1', [
                original.session.id,
              ])
            ).rows[0].descriptor;
            expect(saved).toMatchObject({
              title: before.json().title,
              metadata: before.json().metadata,
            });
          });
          const changed = await api(c, `/v1/documents/${first.documentId}`);
          expect(changed.json()).toMatchObject({
            title: 'Changed after restore',
            metadata: { changed: true },
          });
          for (const [version, revision] of [
            [second.versionId, etag],
            [first.versionId, changed.headers.etag as string],
          ]) {
            expect(
              (await restoreVersion(c, first.documentId, version, key, revision)).json().code,
            ).toBe('IDEMPOTENCY_CONFLICT');
          }
          await fresh('admission-policy-set', {
            expectedRevision: '2',
            policy: {
              ...policy,
              contentTypes: ['text/plain'],
              profiles: ['secure-only', 'searchable'],
            },
          });
          expect(
            (
              await versionHttp(
                c,
                `/v1/documents/${first.documentId}/versions/${first.versionId}/restore`,
                { profile: 'searchable' },
                {
                  'idempotency-key': key,
                  'if-match': etag,
                },
              )
            ).json().code,
          ).toBe('IDEMPOTENCY_CONFLICT');
          expect(
            (await api(c, `/v1/documents/${first.documentId}/versions`)).json().items,
          ).toHaveLength(3);
          const other = await consumer();
          expect(
            (await restoreVersion(other, first.documentId, first.versionId, key, etag)).statusCode,
          ).toBe(404);
        });
        it('I10 rejects stale revisions and fences queued/shared restoration across invalidation', async () => {
          const c = await versionConsumer(),
            first = await versionUpload(c);
          await finishVersion(first.id);
          const old = (await api(c, `/v1/documents/${first.documentId}`)).headers.etag as string;
          const second = await versionUpload(c, first.documentId, '1111111111');
          await finishVersion(second.id);
          expect(
            (await restoreVersion(c, first.documentId, first.versionId, randomUUID(), old))
              .statusCode,
          ).toBe(412);
          const r = await restoreVersion(c, first.documentId, first.versionId);
          expect(r.statusCode).toBe(202);
          const restored = r.json().session;
          const source = await work().internal(
            async (tx) =>
              (
                await tx.client.query('SELECT id FROM dms.security_candidate WHERE upload_id=$1', [
                  first.id,
                ])
              ).rows[0],
          );
          await work().internal((tx) => invalidateCandidate(tx, source.id));
          await selectRestores(work(), privateApp.get(StorageService));
          await settleFailedRestores(work());
          expect((await req(c, 'GET', `/v1/uploads/${restored.id}`)).json().upload).toBe('FAILED');
          expect(
            (
              await api(
                c,
                `/v1/documents/${first.documentId}/download?versionId=${first.versionId}`,
              )
            ).statusCode,
          ).toBe(409);
          expect((await api(c, `/v1/documents/${first.documentId}`)).json().currentVersionId).toBe(
            second.versionId,
          );
          const retry = await restoreVersion(c, first.documentId, first.versionId);
          expect(retry.statusCode).toBe(202);
          await finishVersion(retry.json().session.id);
          await work().internal((tx) => invalidateCandidate(tx, source.id));
          expect(
            (
              await api(
                c,
                `/v1/documents/${first.documentId}/download?versionId=${retry.json().session.versionId}`,
              )
            ).statusCode,
          ).toBe(409);
          expect(
            (
              await api(
                c,
                `/v1/documents/${first.documentId}/download?versionId=${second.versionId}`,
              )
            ).statusCode,
          ).toBe(200);
          expect(
            (await api(c, `/v1/documents/${first.documentId}/download?versionId=${randomUUID()}`))
              .statusCode,
          ).toBe(404);
        });

        it('I10 serializes competing restores with publication and retains one monotonic current pointer', async () => {
          const c = await versionConsumer(),
            first = await versionUpload(c);
          await finishVersion(first.id);
          const second = await versionUpload(c, first.documentId, '1111111111');
          const ready = await finishVersion(second.id, 'PASSED', true);
          const etag = (await api(c, `/v1/documents/${first.documentId}`)).headers.etag as string;
          const [published, a, b] = await Promise.all([
            call('scanner', '/attempts/result', {
              ...ready.lease,
              outcome: 'SUCCEEDED',
              code: 'OK',
              assessment: ready.evidence,
            }),
            restoreVersion(c, first.documentId, first.versionId, randomUUID(), etag),
            restoreVersion(c, first.documentId, first.versionId, randomUUID(), etag),
          ]);
          expect(published.statusCode).toBe(200);
          expect([202, 412]).toContain(a.statusCode);
          expect([202, 412]).toContain(b.statusCode);
          expect([a, b].filter((r) => r.statusCode === 202).length).toBeLessThanOrEqual(1);
          expect((await api(c, `/v1/documents/${first.documentId}`)).json().currentVersionId).toBe(
            second.versionId,
          );
          const chosen =
            [a, b].find((r) => r.statusCode === 202) ??
            (await restoreVersion(c, first.documentId, first.versionId));
          await finishVersion(chosen.json().session.id);
          expect(
            (await api(c, `/v1/documents/${first.documentId}/versions`))
              .json()
              .items.map((v: { number: number }) => v.number),
          ).toEqual([3, 2, 1]);
          expect((await api(c, `/v1/documents/${first.documentId}`)).json().currentVersionId).toBe(
            chosen.json().session.versionId,
          );
        });
        it('I10 binds a new-version batch item once and leaves unrelated manifest items allocation-free', async () => {
          const c = await versionConsumer(),
            first = await versionUpload(c);
          await finishVersion(first.id);
          const doc = (await api(c, `/v1/documents/${first.documentId}`)).json();
          const d = {
            ...descriptor,
            contentType: 'text/plain',
            sha256: hash('1111111111'),
            documentId: first.documentId,
            expectedRevision: doc.revision,
          };
          const batch = await req(
            c,
            'POST',
            '/v1/upload-batches',
            {
              items: [
                { itemId: 'replacement', operation: 'new-version', descriptor: d },
                {
                  itemId: 'later',
                  operation: 'create',
                  descriptor: { ...descriptor, contentType: 'text/plain' },
                },
              ],
            },
            randomUUID(),
          );
          expect(batch.statusCode).toBe(201);
          const batchId = batch.json().batch.id,
            key = randomUUID(),
            payload = {
              ...descriptor,
              contentType: 'text/plain',
              sha256: hash('1111111111'),
              batchId,
              itemId: 'replacement',
            };
          const invoke = () =>
            app.inject({
              method: 'POST',
              url: `/v1/documents/${first.documentId}/versions/uploads`,
              headers: {
                authorization: `Bearer ${c.accessToken}`,
                'idempotency-key': key,
                'if-match': `"${doc.revision}"`,
              },
              payload,
            });
          const begun = await invoke();
          expect(begun.statusCode).toBe(201);
          expect((await invoke()).json().session.id).toBe(begun.json().session.id);
          const transfer = begun.json().transfer;
          expect(
            (
              await fetch(transfer.url, {
                method: 'PUT',
                headers: transfer.headers,
                body: '1111111111',
              })
            ).status,
          ).toBe(200);
          await finishVersion(begun.json().session.id);
          const status = (await req(c, 'GET', `/v1/upload-batches/${batchId}`)).json();
          expect(status.counts.items).toMatchObject({ BOUND: 1, UNSTARTED: 1 });
          expect(status.counts.availability.AVAILABLE).toBe(1);
          expect(
            await work().internal(
              async (tx) =>
                (await tx.client.query('SELECT count(*) AS n FROM dms.document')).rows[0].n,
            ),
          ).toBe('1');
          expect((await invoke()).json().transfer).toBeNull();
        });
        it('I10 rejects missing historical bytes without allocating a revision or releasing a live original', async () => {
          const c = await versionConsumer(),
            first = await versionUpload(c);
          await finishVersion(first.id);
          const second = await versionUpload(c, first.documentId, '1111111111');
          await finishVersion(second.id);
          const before = (await api(c, `/v1/documents/${first.documentId}`)).json();
          const source = await work().internal(
            async (tx) =>
              (
                await tx.client.query('SELECT * FROM dms.security_candidate WHERE upload_id=$1', [
                  first.id,
                ])
              ).rows[0],
          );
          await privateApp.get(StorageService).forRole('cleanup').deleteExact({
            area: 'originals',
            tenantId,
            applicationId: c.applicationId,
            id: source.object_id,
          });
          expect((await restoreVersion(c, first.documentId, first.versionId)).statusCode).toBe(409);
          expect((await api(c, `/v1/documents/${first.documentId}`)).json()).toEqual(before);
          expect(
            (await api(c, `/v1/documents/${first.documentId}/versions`))
              .json()
              .items.map((v: { number: number }) => v.number),
          ).toEqual([2, 1]);
          const cap = (await api(c, `/v1/documents/${first.documentId}/download`)).json();
          expect(await (await fetch(cap.url)).text()).toBe('1111111111');
        });

        it('separates private audience, role and current DMS authority from consumer access', async () => {
          const { c, job } = await queued();
          expect(
            (
              await app.inject({
                method: 'POST',
                url: '/internal/work/attempts/claim',
                payload: {},
              })
            ).statusCode,
          ).toBe(404);
          expect(
            (
              await privateApp.inject({
                method: 'POST',
                url: '/internal/work/dispatches/claim',
                payload: {},
                headers: { authorization: `Bearer ${c.accessToken}` },
              })
            ).statusCode,
          ).toBe(401);
          expect((await call('scanner', '/dispatches/claim')).statusCode).toBe(403);
          const message = await envelope();
          expect((await call('extractor', '/attempts/claim', message)).statusCode).toBe(403);
          const claimed = await call('scanner', '/attempts/claim', message);
          expect(claimed.statusCode).toBe(200);
          expect(claimed.json().state).toBe('claimed');
          await fresh('work-disable', { clientId: identities.get('scanner')?.clientId });
          expect(
            (await call('scanner', '/attempts/heartbeat', claimed.json().lease)).statusCode,
          ).toBe(403);
          expect((await state(job.id)).executions).toBe(1);
          expect(await fresh('work-inspect', { jobId: job.id })).toMatchObject({
            job: { version: 1, id: job.id, executions: 1 },
            attempts: [{ state: 'RUNNING' }],
          });
          expect(
            await fresh('work-authorize', {
              clientId: identities.get('scanner')?.clientId,
              role: 'scanner',
            }),
          ).toMatchObject({ role: 'scanner', enabled: true });
          await expect(
            fresh('work-authorize', {
              clientId: identities.get('publisher')?.clientId,
              role: 'scanner',
            }),
          ).rejects.toThrow();
          const database = app.get(DmsDatabaseService);
          await expect(
            database.withMachine(await principal(c), ['dms:documents:read'], (tx) =>
              tx.client.query('SELECT * FROM dms.work_job'),
            ),
          ).rejects.toMatchObject({ code: '42501' });
        });

        it('deduplicates concurrent claims and result retries without exposing security publication', async () => {
          const { job, begun, c } = await queued(),
            message = await envelope();
          const results = await Promise.all([
            call('scanner', '/attempts/claim', message),
            call('scanner', '/attempts/claim', message),
          ]);
          expect(results.map((r) => r.json().state).sort()).toEqual(['busy', 'claimed']);
          const lease = results.find((r) => r.json().state === 'claimed')?.json().lease;
          expect((await call('scanner', '/attempts/heartbeat', lease)).statusCode).toBe(200);
          const body = { ...lease, outcome: 'SUCCEEDED', code: 'OK' };
          expect((await call('scanner', '/attempts/result', body)).json()).toMatchObject({
            accepted: true,
            duplicate: false,
          });
          expect((await call('scanner', '/attempts/result', body)).json()).toMatchObject({
            accepted: true,
            duplicate: true,
          });
          expect(
            (
              await call('scanner', '/attempts/result', {
                ...body,
                outcome: 'FAILED',
                code: 'EXECUTION_FAILED',
              })
            ).statusCode,
          ).toBe(409);
          expect(await state(job.id)).toMatchObject({ executions: 1, state: 'SUCCEEDED' });
          expect((await api(c, `/v1/documents/${begun.session.documentId}`)).json()).toMatchObject({
            downloadable: false,
            currentVersionId: null,
          });
        });

        it('persists Celery retry eligibility and only recovers a missing retry after grace', async () => {
          const { job } = await queued(),
            message = await envelope(),
            lease = (await call('scanner', '/attempts/claim', message)).json().lease;
          const retried = await call('scanner', '/attempts/result', {
            ...lease,
            outcome: 'RETRY',
            code: 'TRANSIENT_IO',
          });
          expect(retried.json().retryAfterSeconds).toBeGreaterThan(0);
          expect((await call('scanner', '/attempts/claim', message)).json().state).toBe('wait');
          await withTenant(owner, tenantId, (db) =>
            db.query("UPDATE dms.work_job SET recover_at=now()-interval '1 second' WHERE id=$1", [
              job.id,
            ]),
          );
          expect((await work().recover()).recovered).toBe(0);
          await withTenant(owner, tenantId, (db) =>
            db.query(
              "UPDATE dms.work_job SET next_eligible_at=now()-interval '100 seconds',recover_at=now()-interval '1 second' WHERE id=$1",
              [job.id],
            ),
          );
          const recovered = await Promise.all([work().recover(), work().recover()]);
          expect(recovered.reduce((n, r) => n + r.recovered, 0)).toBe(1);
          expect(await state(job.id)).toMatchObject({
            executions: 1,
            generation: 2,
            recoveries: 1,
          });
          expect(
            (
              await call('scanner', '/attempts/result', {
                ...lease,
                outcome: 'SUCCEEDED',
                code: 'OK',
              })
            ).statusCode,
          ).toBe(409);
        });

        it('fences expired leases and preserves one three-execution budget across recovery', async () => {
          const { job } = await queued();
          let firstStart: unknown;
          for (let execution = 1; execution <= 3; execution++) {
            const message = await envelope(),
              lease = (await call('scanner', '/attempts/claim', message)).json().lease;
            expect(lease).toBeDefined();
            const current = await state(job.id);
            firstStart ??= current.budget_started_at;
            expect(current.budget_started_at).toEqual(firstStart);
            await withTenant(owner, tenantId, async (db) => {
              await db.query(
                "UPDATE dms.work_attempt SET lease_expires_at=now()-interval '40 seconds' WHERE id=$1",
                [lease.attemptId],
              );
              await db.query(
                "UPDATE dms.work_job SET recover_at=now()-interval '1 second' WHERE id=$1",
                [job.id],
              );
            });
            expect((await call('scanner', '/attempts/heartbeat', lease)).statusCode).toBe(409);
            expect(
              (
                await call('scanner', '/attempts/result', {
                  ...lease,
                  outcome: 'SUCCEEDED',
                  code: 'OK',
                })
              ).statusCode,
            ).toBe(409);
            await work().recover();
          }
          expect(await state(job.id)).toMatchObject({
            state: 'FAILED',
            executions: 3,
            generation: 3,
            result_code: 'EXECUTION_BUDGET_EXHAUSTED',
          });
          expect((await call('publisher', '/dispatches/claim')).json().items).toHaveLength(0);
        });

        it('recovers a missed upload callback from exact persisted storage identity without approving content', async () => {
          const c = await consumer(),
            begun = (await start(c)).json(),
            cap = begun.transfer;
          expect(
            (
              await fetch(cap.url, {
                method: 'PUT',
                headers: cap.headers,
                body: Buffer.from('0123456789'),
              })
            ).status,
          ).toBe(200);
          expect((await discoverUploads(work(), privateApp.get(StorageService))).verified).toBe(1);
          const status = (await req(c, 'GET', `/v1/uploads/${begun.session.id}`)).json();
          expect(status).toMatchObject({
            upload: 'OBJECT_VERIFIED',
            completionRequested: false,
            security: 'PENDING',
            availability: 'CANDIDATE',
          });
          expect(
            (await req(c, 'POST', `/v1/uploads/${begun.session.id}/refresh`, {})).json().transfer,
          ).toBeNull();
          expect(
            (await req(c, 'DELETE', `/v1/uploads/${begun.session.id}`)).json().session.upload,
          ).toBe('CANCELLED');
          await discoverUploads(work(), privateApp.get(StorageService));
          expect((await req(c, 'GET', `/v1/uploads/${begun.session.id}`)).json().upload).toBe(
            'CANCELLED',
          );
        });

        it('does not resurrect cancelled or expired source work', async () => {
          const { job, c, begun } = await queued(),
            message = await envelope(),
            lease = (await call('scanner', '/attempts/claim', message)).json().lease;
          await req(c, 'DELETE', `/v1/uploads/${begun.session.id}`);
          expect(
            (
              await call('scanner', '/attempts/result', {
                ...lease,
                outcome: 'SUCCEEDED',
                code: 'OK',
              })
            ).statusCode,
          ).toBe(409);
          await work().recover();
          expect((await state(job.id)).state).toBe('CANCELLED');
          const next = await queued();
          await withTenant(owner, tenantId, (db) =>
            db.query(
              "UPDATE dms.upload_admission SET capability_expires_at=NULL,expires_at=now()-interval '1 second' WHERE id=$1",
              [next.begun.session.id],
            ),
          );
          const batch = (await createBatch(next.c)).json().batch;
          await withTenant(owner, tenantId, (db) =>
            db.query(
              "UPDATE dms.upload_batch SET expires_at=now()-interval '1 second' WHERE id=$1",
              [batch.id],
            ),
          );
          await expireBatches(work());
          await withTenant(owner, tenantId, async (db) =>
            expect(
              (
                await db.query('SELECT state FROM dms.upload_batch_item WHERE batch_id=$1', [
                  batch.id,
                ])
              ).rows.every((row) => row.state === 'EXPIRED'),
            ).toBe(true),
          );
          await expireUploads(work());
          expect(
            (await req(next.c, 'GET', `/v1/uploads/${next.begun.session.id}`)).json().upload,
          ).toBe('EXPIRED');
        });

        it('denies new work after its mandatory accounting reservation has been released', async () => {
          const { job, begun } = await queued(),
            message = await envelope();
          await coordinated(async (tx) => {
            await reconcileAdmission(
              tx,
              begun.session.id,
              { stagingBytes: 10, originalBytes: 10 },
              'SETTLED',
            );
            await releaseWorkReservation(tx, begun.session.id);
          });
          expect((await call('scanner', '/attempts/claim', message)).statusCode).toBe(409);
          await work().recover();
          expect(await state(job.id)).toMatchObject({ state: 'CANCELLED', executions: 0 });
        });

        it('requires routing as well as confirms and retains an unroutable dispatch for retry', async () => {
          const { job } = await queued();
          await mq.binding('document.scan', false);
          await publish();
          await withTenant(owner, tenantId, async (db) =>
            expect(
              (
                await db.query(
                  'SELECT state,last_error,published_at FROM dms.work_dispatch WHERE job_id=$1',
                  [job.id],
                )
              ).rows[0],
            ).toMatchObject({ state: 'READY', last_error: 'UNROUTABLE', published_at: null }),
          );
          expect((await state(job.id)).executions).toBe(0);
        }, 30000);

        it('keeps dispatching after a full batch finishes before lost delivery receipts recover', async () => {
          const c = await consumer();
          // Complete through the real private claim/result path without acknowledging
          // publisher delivery. Expire only fixture clocks; no storage PUT occurred.
          for (let index = 0; index < 40; index++) {
            const begun = await start(c);
            expect(begun.statusCode).toBe(201);
            const uploadId = begun.json().session.id;
            await work().internal((tx) => enqueueWork(tx, uploadId, 'document.scan'));
            const message = await envelope();
            const claimed = await call('scanner', '/attempts/claim', message);
            expect(claimed.json().state).toBe('claimed');
            expect(
              (
                await call('scanner', '/attempts/result', {
                  ...claimed.json().lease,
                  outcome: 'UNSUPPORTED',
                  code: 'HANDLER_NOT_INSTALLED',
                })
              ).statusCode,
            ).toBe(200);
            await withTenant(owner, tenantId, async (db) => {
              await db.query(
                "UPDATE dms.work_dispatch SET delivery_until=clock_timestamp()-interval '1 second' WHERE job_id=$1",
                [message.jobId],
              );
              await db.query(
                "UPDATE dms.upload_admission SET capability_expires_at=clock_timestamp()-interval '61 seconds' WHERE id=$1",
                [uploadId],
              );
            });
            await work().internal((tx) =>
              reconcileAdmission(tx, uploadId, { stagingBytes: 0, originalBytes: 0 }, 'RELEASED'),
            );
          }
          const next = await start(c);
          expect(next.statusCode).toBe(201);
          const job = await work().internal((tx) =>
            enqueueWork(tx, next.json().session.id, 'document.scan'),
          );
          const response = await call('publisher', '/dispatches/claim');
          expect(response.statusCode).toBe(200);
          expect(
            response
              .json()
              .items.map((item: { dispatch: { jobId: string } }) => item.dispatch.jobId),
          ).toEqual([job.id]);
        }, 60000);

        it('permits duplicate transport after a lost delivery receipt but accepts one effect', async () => {
          const { job } = await queued(),
            message = await envelope();
          const messageEnvelope = message;
          await mq.python(['python', 'tests/work_publish.py'], environment('publisher'), message);
          await withTenant(owner, tenantId, (db) =>
            db.query(
              "UPDATE dms.work_dispatch SET delivery_until=now()-interval '1 second' WHERE job_id=$1",
              [job.id],
            ),
          );
          await publish();
          const messages = await mq.api('/queues/dms/document.scan/get', 'POST', {
            count: 10,
            ackmode: 'ack_requeue_true',
            encoding: 'auto',
            truncate: 10000,
          });
          expect(messages).toHaveLength(2);
          for (const message of messages) {
            expect(message.properties.delivery_mode).toBe(2);
            expect(message.properties.content_type).toBe('application/json');
            expect(message.properties.headers.task).toBe('document.scan');
            expect(JSON.parse(message.payload)[0]).toEqual([messageEnvelope]);
          }
          expect((await mq.api('/queues/dms/document.scan')).durable).toBe(true);
          brokerWorker();
          const result = await waitFor(
            () => state(job.id),
            (v) => v.state === 'UNSUPPORTED',
          );
          expect(result.executions).toBe(1);
          await withTenant(owner, tenantId, async (db) =>
            expect(
              (await db.query('SELECT id FROM dms.work_attempt WHERE job_id=$1', [job.id]))
                .rowCount,
            ).toBe(1),
          );
        }, 30000);

        it('uses the same mandatory confirmed Celery path for ordinary retries', async () => {
          const { job } = await queued();
          await publish();
          brokerWorker('retry_once');
          const result = await waitFor(
            () => state(job.id),
            (v) => v.state === 'SUCCEEDED',
            22000,
          );
          expect(result).toMatchObject({ executions: 2, generation: 1, recoveries: 0 });
        }, 30000);

        it('recovers a lost confirmed-retry publication under the persisted execution budget', async () => {
          const { job } = await queued();
          await publish();
          brokerWorker('retry_once');
          await waitFor(
            () => state(job.id),
            (v) => v.state === 'RUNNING',
          );
          await mq.binding('document.scan', false);
          await waitFor(
            () => state(job.id),
            (v) => v.state === 'RETRY_WAIT',
          );
          await new Promise((r) => setTimeout(r, 1000)); // let the confirmed mandatory retry observe the missing binding
          expect((await mq.api('/queues/dms/document.scan')).messages_ready).toBe(0);
          await withTenant(owner, tenantId, (db) =>
            db.query(
              "UPDATE dms.work_job SET next_eligible_at=now()-interval '100 seconds',recover_at=now()-interval '1 second' WHERE id=$1",
              [job.id],
            ),
          );
          await work().recover();
          await mq.binding('document.scan', true);
          await publish();
          expect(
            await waitFor(
              () => state(job.id),
              (v) => v.state === 'SUCCEEDED',
            ),
          ).toMatchObject({ executions: 2, generation: 2, recoveries: 1 });
        }, 30000);

        it('enforces native broker queue/topic permissions with distinct generated principals', async () => {
          const folder = await mkdtemp(join(tmpdir(), 'thaarei-broker-acl-'));
          try {
            const settings: NodeJS.ProcessEnv = {};
            const urls = new Map<WorkRole, string>();
            for (const role of ['publisher', 'scanner', 'extractor', 'heavy'] as const) {
              const username = `dms_${role}_${randomBytes(4).toString('hex')}`,
                password = randomBytes(36).toString('base64url');
              settings[`DMS_BROKER_${role.toUpperCase()}_USER`] = username;
              settings[`DMS_BROKER_${role.toUpperCase()}_PASSWORD`] = password;
              const url = new URL(mq.broker);
              url.username = username;
              url.password = password;
              urls.set(role, url.toString());
            }
            const path = join(folder, 'definitions.json');
            await mq.python(['turnstile-processing', 'broker-config', '--output', path], settings);
            expect((await stat(path)).mode & 0o777).toBe(0o600);
            await mq.api('/definitions', 'POST', JSON.parse(await readFile(path, 'utf8')));
            const { job } = await queued();
            await mq.python(['turnstile-processing', 'publisher-once'], {
              ...environment('publisher'),
              DMS_BROKER_URL: urls.get('publisher'),
            });
            const worker = mq.worker({
              ...environment('scanner'),
              DMS_BROKER_URL: urls.get('scanner'),
            });
            workers.push(worker);
            await waitFor(
              () => state(job.id),
              (v) => v.state === 'UNSUPPORTED',
            );
            const message = await work().internal(
              async (tx) =>
                (
                  await tx.client.query(
                    'SELECT id,generation,task FROM dms.work_dispatch WHERE job_id=$1',
                    [job.id],
                  )
                ).rows[0],
            );
            const payload = {
              version: 1,
              jobId: job.id,
              dispatchId: message.id,
              generation: message.generation,
              task: message.task,
            };
            await mq.python(
              ['python', 'tests/work_acl.py'],
              { ...environment('scanner'), DMS_BROKER_URL: urls.get('scanner') },
              payload,
            );
            await mq.python(
              ['python', 'tests/work_acl.py'],
              { ...environment('publisher'), DMS_BROKER_URL: urls.get('publisher') },
              payload,
            );
          } finally {
            await rm(folder, { recursive: true, force: true });
          }
        }, 30000);

        it('dead-letters forbidden non-JSON task content before any execution claim', async () => {
          const { job } = await queued(),
            message = await envelope();
          brokerWorker();
          await new Promise((r) => setTimeout(r, 1500));
          await mq.python(['python', 'tests/work_invalid.py'], environment('publisher'), message);
          await waitFor(
            () =>
              mq.api('/queues/dms/document.scan.dead/get', 'POST', {
                count: 1,
                ackmode: 'ack_requeue_true',
                encoding: 'base64',
              }),
            (rows) => rows.length === 1,
          );
          expect(await state(job.id)).toMatchObject({ state: 'QUEUED', executions: 0 });
        }, 30000);

        it('recovers a killed prefork worker only after lease expiry and grace', async () => {
          const { job } = await queued();
          await publish();
          const worker = brokerWorker('block');
          await waitFor(
            () => state(job.id),
            (v) => v.state === 'RUNNING',
          );
          worker.stop();
          expect((await work().recover()).recovered).toBe(0);
          await withTenant(owner, tenantId, async (db) => {
            await db.query(
              "UPDATE dms.work_attempt SET lease_expires_at=now()-interval '40 seconds' WHERE job_id=$1 AND state='RUNNING'",
              [job.id],
            );
            await db.query(
              "UPDATE dms.work_job SET recover_at=now()-interval '1 second' WHERE id=$1",
              [job.id],
            );
          });
          await work().recover();
          await publish();
          brokerWorker('succeed');
          expect(
            await waitFor(
              () => state(job.id),
              (v) => v.state === 'SUCCEEDED',
            ),
          ).toMatchObject({ executions: 2, generation: 2 });
        }, 30000);
      });
    });
  });
});
