import { spawn } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DMS_MACHINE_SCOPES, enrollmentResponseSchema } from '@thaarei/dms-contracts';
import { Pool } from 'pg';
import { createApplication } from '../src/bootstrap.js';
import { withTenant } from '../src/infrastructure/database/postgres.js';
import { DmsDatabaseService } from '../src/modules/access/dms-database/dms-database.service.js';
import {
  issueEnrollmentKey,
  registerApplication,
  revokeEnrollmentKey,
  setApplicationScopes,
} from '../src/modules/enrollment/enrollment-operator.js';
import { runApplicationCommand } from '../src/modules/enrollment/manage-application.js';
import { AuthorityService } from '../src/modules/platform-auth/authority/authority.service.js';
import type { AuthorityConfiguration } from '../src/modules/platform-auth/authority-configuration.js';
import { manageOAuthClient } from '../src/modules/platform-auth/manage-client.js';
import { provisionUser } from '../src/modules/platform-auth/provision-user.js';
import { smtpFixture } from './smtp-fixture.js';

describe('machine registration and transactional enrollment', () => {
  let app: NestFastifyApplication;
  let config: AuthorityConfiguration;
  let authority: AuthorityService;
  let smtp: Awaited<ReturnType<typeof smtpFixture>>;
  let operator: Headers;
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
        'DELETE FROM dms.enrollment_receipt WHERE application_id = ANY($1::uuid[])',
        [applications],
      );
      await client.query('DELETE FROM dms.enrollment_key WHERE application_id = ANY($1::uuid[])', [
        applications,
      ]);
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
    expect((await enroll(second, idempotency, first.key.key)).statusCode).toBe(403);
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
    expect(parallel.some((response) => response.statusCode === 201)).toBe(true);
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
});
