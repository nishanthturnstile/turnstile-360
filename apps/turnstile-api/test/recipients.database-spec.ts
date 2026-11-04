import { type ChildProcess, fork, spawnSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer, request as httpRequest, type IncomingMessage } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  type InvitationDto,
  PEOPLE_PERMISSIONS,
  type RestrictedInvitationContextDto,
  recipientAccountSetupContextSchema,
  recipientAccountSetupResultSchema,
} from '@thaarei/turnstile-contracts';
import Fastify, { type FastifyRequest } from 'fastify';
import { Pool, type PoolClient } from 'pg';
import { createApplication } from '../src/bootstrap.js';
import { parseProductEnvironment } from '../src/infrastructure/auth-environment.js';
import { INVITATION_TABLES } from '../src/infrastructure/database/invitation-safety.js';
import { withTenant } from '../src/infrastructure/database/postgres.js';
import { IdentityClientService } from '../src/integrations/identity/identity-client.service.js';
import { readAccess } from '../src/modules/access/access-evaluator.js';
import { canonicalAccessReady } from '../src/modules/access/access-safety.js';
import { releaseOperator } from '../src/modules/access/release-operator.js';
import { BrowserAuthService } from '../src/modules/auth/browser-auth/browser-auth.service.js';
import { registerProductSession } from '../src/modules/auth/browser-auth/session-plugin.js';
import { ProductDatabaseService } from '../src/modules/auth/product-database/product-database.service.js';
import { OrganizationService } from '../src/modules/organization/organization.service.js';
import { InvitationService } from '../src/modules/people/invitation.service.js';
import { openPayload } from '../src/modules/people/invitation-crypto.js';
import { InvitationDeliveryService } from '../src/modules/people/invitation-delivery.service.js';
import { digests, hash, resolveAssignments } from '../src/modules/people/invitation-policy.js';
import { InvitationStoreService } from '../src/modules/people/invitation-store.service.js';
import { RecipientService } from '../src/modules/people/recipient.service.js';
import { closeFixturePool, openAccessFixture, resetAccessFixture } from './access-fixture.js';

describe('restricted invitation recipient HTTP and atomic PostgreSQL acceptance', () => {
  const tenant = process.env.INSTALLATION_TENANT_ID as string;
  const owner = new Pool({ connectionString: process.env.TURNSTILE_MIGRATION_DATABASE_URL });
  const owned = <T>(work: (db: PoolClient) => Promise<T>) => withTenant(owner, tenant, work);
  let app: Awaited<ReturnType<typeof createApplication>>;
  let child: ChildProcess;
  let fixture: {
    port: number;
    secret: string;
    loginSecret: string;
    password: string;
    users: Record<string, { id: string; email: string }>;
  };
  let origin: string;
  let target = 0;
  let role: string;
  let unit: string;
  let failAuthority = false;
  const proxy = createServer((request, response) => {
    if (failAuthority) {
      response.writeHead(503).end();
      return;
    }
    const outgoing = httpRequest(
      `http://127.0.0.1:${target}${request.url}`,
      {
        method: request.method,
        headers: request.headers,
      },
      (upstream) => {
        response.writeHead(upstream.statusCode ?? 503, upstream.headers);
        upstream.pipe(response);
      },
    );
    outgoing.on('error', () => response.writeHead(503).end());
    request.pipe(outgoing);
  });
  const actor = () => ({ userId: fixture.users.operator?.id ?? '', requestId: randomUUID() });
  type Reply = Awaited<ReturnType<typeof app.inject>>;
  function cookieOf(response: Reply) {
    const cookies = response.headers['set-cookie'];
    return (
      (Array.isArray(cookies) ? cookies : typeof cookies === 'string' ? [cookies] : [])
        .find((v) => v.startsWith('turnstile='))
        ?.split(';')[0] ?? ''
    );
  }
  async function rpc(action: string, extra: object = {}) {
    const requestId = randomUUID();
    const result = new Promise<unknown>((resolve, reject) => {
      const listener = (m: { requestId?: string; ok?: boolean; value?: unknown }) => {
        if (m.requestId !== requestId) return;
        child.off('message', listener);
        m.ok ? resolve(m.value) : reject(new Error('Private authority fixture failed'));
      };
      child.on('message', listener);
    });
    child.send({ action, requestId, ...extra });
    return result;
  }
  async function versions() {
    return owned(async (db) => {
      const row = (
        await db.query(
          'SELECT a.revision,o.revision AS org FROM turnstile.access_context a JOIN turnstile.organization_configuration o USING(tenant_id) WHERE a.tenant_id=$1',
          [tenant],
        )
      ).rows[0];
      return { expectedAccessRevision: row.revision, expectedOrganizationRevision: row.org };
    });
  }
  async function issue(email = fixture.users.verified?.email ?? '', scoped = false) {
    const result = await app.get(InvitationService).execute(actor(), randomUUID(), {
      operation: 'invitation.issue',
      ...(await versions()),
      email,
      assignments: [
        {
          roleId: role,
          expectedRoleVersion: 1,
          scope: scoped
            ? { kind: 'units', unitIds: [unit], includeChildren: true }
            : { kind: 'company' },
        },
      ],
    });
    const config = app.get(InvitationStoreService).config;
    if (!config) throw new Error('Fixture invitation config missing');
    const payload = await owned(
      async (db) =>
        (
          await db.query(
            'SELECT payload FROM turnstile.invitation_delivery WHERE tenant_id=$1 AND invitation_id=$2',
            [tenant, result.id],
          )
        ).rows[0].payload,
    );
    const mail = openPayload(config, result.id, result.generation, payload);
    return { result, credential: new URL(mail.link).hash.slice(1) };
  }
  function post(path: string, cookie: string, csrf: string, payload: object) {
    return app.inject({
      method: 'POST',
      url: `/api/invitations/${path}`,
      headers: { cookie, origin, 'sec-fetch-site': 'same-origin', 'x-csrf-token': csrf },
      payload,
    });
  }
  const action = (row: InvitationDto) => ({
    invitationId: row.id,
    expectedVersion: row.version,
    expectedGeneration: row.generation,
  });
  async function exchange(credential: string) {
    const response = await post('exchange', '', '', { credential });
    expect(response.statusCode).toBe(200);
    return {
      cookie: cookieOf(response),
      context: response.json() as RestrictedInvitationContextDto,
    };
  }
  const context = (cookie: string) =>
    app.inject({ method: 'GET', url: '/api/invitations/context', headers: { cookie } });
  async function authorityLogin(
    email = fixture.users.verified?.email ?? '',
    password = fixture.password,
  ) {
    const response = await fetch(`${origin}/identity/sign-in/email`, {
      method: 'POST',
      redirect: 'manual',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    expect(response.status).toBe(200);
    return response.headers
      .getSetCookie()
      .map((v) => v.split(';')[0])
      .join('; ');
  }
  async function purposeLogin(
    cookie: string,
    authority: string,
    destination = '/invitations/join',
  ) {
    const login = await app.inject({ method: 'GET', url: '/api/auth/login', headers: { cookie } });
    expect(login.statusCode).toBe(302);
    const authorize = await new Promise<IncomingMessage>((resolve, reject) => {
      const request = httpRequest(
        String(login.headers.location),
        { headers: { cookie: authority, accept: 'text/html', 'sec-fetch-mode': 'navigate' } },
        resolve,
      );
      request.once('error', reject);
      request.end();
    });
    authorize.resume();
    expect(authorize.statusCode).toBe(302);
    const callback = new URL(authorize.headers.location ?? '');
    expect(callback.pathname).toBe('/api/auth/callback');
    const response = await app.inject({
      method: 'GET',
      url: callback.pathname + callback.search,
      headers: { cookie: `${cookieOf(login)}; ${authority}` },
    });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(destination);
    return {
      cookie: `${cookieOf(response)}; ${authority}`,
      callback: callback.pathname + callback.search,
    };
  }
  async function verified(credential: string, email?: string) {
    const flow = await exchange(credential);
    const identity = await purposeLogin(flow.cookie, await authorityLogin(email));
    const response = await context(identity.cookie);
    expect(response.statusCode).toBe(200);
    const ctx = response.json();
    return { ...identity, context: ctx, csrf: ctx.csrfToken as string };
  }
  const acceptance = (ctx: { review: Record<string, unknown> }) => ({
    invitationId: ctx.review.invitationId,
    expectedVersion: ctx.review.version,
    expectedGeneration: ctx.review.generation,
    permissionDigest: ctx.review.permissionDigest,
    scopeDigest: ctx.review.scopeDigest,
  });
  async function command(row: InvitationDto, operation: 'invitation.cancel' | 'invitation.resend') {
    return app.get(InvitationService).execute(actor(), randomUUID(), {
      operation,
      ...(await versions()),
      id: row.id,
      expectedVersion: row.version,
      expectedGeneration: row.generation,
    });
  }
  beforeAll(async () => {
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    const address = proxy.address();
    if (!address || typeof address === 'string') throw new Error('Fixture proxy unavailable');
    origin = `http://127.0.0.1:${address.port}`;
    vi.stubEnv('AUTH_PUBLIC_ORIGIN', origin);
    vi.stubEnv('AUTH_ISSUER_URL', `${origin}/identity`);
    vi.stubEnv('AUTH_LOGIN_CALLBACK_URL', `${origin}/api/auth/callback`);
    vi.stubEnv('AUTH_LOGIN_CLIENT_ID', 'recipients-fixture-login');
    vi.stubEnv('DMS_RESOURCE_URL', `${origin}/v1`);
    child = fork(
      fileURLToPath(new URL('../../dms-api/test/identity-authority-fixture.mjs', import.meta.url)),
      [],
      {
        env: {
          ...process.env,
          IDENTITY_FIXTURE_NAMESPACE: 'recipients',
          IDENTITY_FIXTURE_LOGIN: 'true',
        },
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      },
    );
    fixture = await new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('Recipient authority fixture timeout')),
        25000,
      );
      child.on('message', (m) => {
        if ((m as { ready?: boolean }).ready) {
          clearTimeout(timer);
          resolve(m as typeof fixture);
        }
      });
      child.once('exit', () => {
        clearTimeout(timer);
        reject(new Error('Recipient authority fixture exited'));
      });
    });
    target = fixture.port;
    vi.stubEnv('AUTH_LOGIN_CLIENT_SECRET', fixture.loginSecret);
    vi.stubEnv('IDENTITY_SERVICE_CLIENT_ID', 'recipients-fixture-service');
    vi.stubEnv('IDENTITY_SERVICE_CLIENT_SECRET', fixture.secret);
    vi.stubEnv('IDENTITY_SERVICE_RESOURCE_URL', `${origin}/identity/services/accounts`);
    vi.stubEnv('IDENTITY_SERVICE_API_URL', `http://127.0.0.1:${target}`);
    vi.stubEnv('TURNSTILE_INVITATION_ENCRYPTION_KEY', randomBytes(32).toString('hex'));
    vi.stubEnv('TURNSTILE_INVITATION_RECOVERY_EPOCH', randomBytes(32).toString('base64url'));
    vi.stubEnv('TURNSTILE_SMTP_HOST', '127.0.0.1');
    vi.stubEnv('TURNSTILE_SMTP_PORT', '1');
    vi.stubEnv('TURNSTILE_MAIL_FROM', 'turnstile@example.test');
    app = await createApplication(false);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    await app.get(InvitationDeliveryService).beforeApplicationShutdown();
  }, 35000);
  async function initializeWorkspace(complete = true) {
    failAuthority = false;
    await rpc('clear-limits');
    await owned(async (db) => {
      await db.query(
        `TRUNCATE ${INVITATION_TABLES.map((t) => `turnstile.${t}`).join(',')} CASCADE`,
      );
      await db.query('DELETE FROM turnstile.session WHERE tenant_id=$1', [tenant]);
    });
    await resetAccessFixture(owner, [
      {
        userId: actor().userId,
        permissions: [
          'turnstile:access',
          'turnstile:configuration:manage',
          ...(!complete ? ['turnstile:dms:capabilities:read'] : []),
        ],
      },
    ]);
    const organization = app.get(OrganizationService);
    let snapshot = await organization.save(actor(), {
      expectedRevision: 0,
      name: 'Recipient fixture',
      timeZone: 'UTC',
    });
    const created = await organization.createUnit(
      actor(),
      {
        expectedRevision: snapshot.revision,
        parentId: snapshot.organization.rootId,
        type: 'site',
        name: 'Approved site',
      },
      randomUUID(),
    );
    unit = created.unitId;
    snapshot = created.configuration;
    if (complete) await organization.complete(actor(), { expectedRevision: snapshot.revision });
    await owned(async (db) => {
      await db.query(
        `INSERT INTO turnstile.access_assignment(tenant_id,id,member_id,role_id,scope_kind,include_children,scope_key) SELECT m.tenant_id,$2,m.id,r.id,'company',false,'company' FROM turnstile.access_member m JOIN turnstile.access_role r ON r.tenant_id=m.tenant_id AND r.system_key='workspace_administrator' WHERE m.tenant_id=$1 AND m.user_id=$3`,
        [tenant, randomUUID(), actor().userId],
      );
      role = (
        await db.query(
          "SELECT id FROM turnstile.access_role WHERE tenant_id=$1 AND system_key='unit_manager'",
          [tenant],
        )
      ).rows[0].id;
    });
    await openAccessFixture(owner);
  }
  beforeEach(() => initializeWorkspace());
  afterAll(async () => {
    await app?.close();
    if (child?.connected) {
      const done = once(child, 'exit');
      child.kill('SIGTERM');
      await done;
    }
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
    await owner.end();
    vi.unstubAllEnvs();
  });

  it.each([false, true])(
    'accepts a current owner-seeded approval into incomplete setup without bypassing readiness (configuration manager %s)',
    async (canManageConfiguration) => {
      // Reinitialize disposable test data; never clear completion metadata on a completed record.
      // Ordinary issuance cannot create this latent compatibility state and remains gated.
      await initializeWorkspace(false);
      const before = await owned(
        async (db) =>
          (
            await db.query(
              'SELECT * FROM turnstile.organization_configuration WHERE tenant_id=$1',
              [tenant],
            )
          ).rows[0],
      );
      expect(before.completed_at).toBeNull();
      const config = app.get(InvitationStoreService).config;
      if (!config) throw new Error('Missing fixture configuration');
      const credential = randomBytes(32).toString('base64url');
      const invitation = await owned(async (db) => {
        await db.query('SELECT turnstile.lock_access_context($1)', [tenant]);
        const selectedRole = randomUUID();
        await db.query(
          'INSERT INTO turnstile.access_role(tenant_id,id,name,name_key) VALUES($1,$2,$3,$3)',
          [tenant, selectedRole, 'incomplete recipient'],
        );
        await db.query(
          'INSERT INTO turnstile.access_role_permission(tenant_id,role_id,permission) SELECT $1,$2,unnest($3::text[])',
          [
            tenant,
            selectedRole,
            PEOPLE_PERMISSIONS.filter(
              (p) => canManageConfiguration || p !== 'turnstile:configuration:manage',
            ),
          ],
        );
        const access = await readAccess(db, tenant, actor().userId);
        const assignments = await resolveAssignments(
          db,
          tenant,
          [{ roleId: selectedRole, expectedRoleVersion: 1, scope: { kind: 'company' } }],
          access,
        );
        const id = randomUUID(),
          approvalId = randomUUID();
        const dates = (
          await db.query(
            "SELECT statement_timestamp() AS now, statement_timestamp()+interval '7 days' AS expires",
          )
        ).rows[0];
        const approval = {
          approverId: actor().userId,
          approvedAt: dates.now.toISOString(),
          accessRevision: access.context.accessRevision,
          organizationRevision: before.revision,
          ...digests(assignments, access.context.fingerprint, config.recoveryEpoch),
        };
        await db.query(
          "INSERT INTO turnstile.invitation(tenant_id,id,email,state,approver_id,approval_id,assignments,recovery_epoch,created_at,expires_at) VALUES($1,$2,$3,'pending',$4,$5,$6,$7,$8,$9)",
          [
            tenant,
            id,
            fixture.users.verified?.email,
            actor().userId,
            approvalId,
            JSON.stringify(assignments),
            config.recoveryEpoch,
            dates.now,
            dates.expires,
          ],
        );
        await db.query(
          'INSERT INTO turnstile.invitation_generation(tenant_id,invitation_id,generation,id,email,approver_id,approval,assignments,credential_hash,recovery_epoch,created_at,expires_at) VALUES($1,$2,1,$3,$4,$5,$6,$7,$8,$9,$10,$11)',
          [
            tenant,
            id,
            approvalId,
            fixture.users.verified?.email,
            actor().userId,
            approval,
            JSON.stringify(assignments),
            hash(credential),
            config.recoveryEpoch,
            dates.now,
            dates.expires,
          ],
        );
        await db.query(
          'INSERT INTO turnstile.invitation_reference(tenant_id,id,invitation_id,role_id) VALUES($1,$2,$3,$4)',
          [tenant, randomUUID(), id, selectedRole],
        );
        expect(
          (
            await db.query('SELECT turnstile.invitation_approval_valid($1,$2) AS valid', [
              tenant,
              id,
            ])
          ).rows[0].valid,
        ).toBe(true);
        return app.get(InvitationService).readInTransaction(db, tenant, id);
      });
      await expect(issue()).rejects.toMatchObject({
        status: 409,
        response: { code: 'SETUP_REQUIRED' },
      });
      const flow = await verified(credential);
      expect(flow.context.phase).toBe('verified');
      const body = acceptance(flow.context);
      const accepted = await post('accept', flow.cookie, flow.csrf, body);
      expect(accepted.statusCode).toBe(200);
      expect(accepted.json().session).toBe('established');
      let cookie = `${cookieOf(accepted)}; ${flow.cookie.slice(flow.cookie.indexOf(';') + 1).trim()}`;
      const status = await app.inject({
        method: 'GET',
        url: '/api/workspace/status',
        headers: { cookie },
      });
      expect(status.statusCode).toBe(200);
      expect(status.json()).toEqual({ status: 'incomplete', canManageConfiguration });
      for (const path of [
        '/api/people/members',
        '/api/people/roles',
        '/api/structure/units',
        '/api/dms/capabilities',
      ]) {
        const response = await app.inject({ method: 'GET', url: path, headers: { cookie } });
        expect(response.statusCode).toBe(409);
        expect(response.json().code).toBe('SETUP_REQUIRED');
      }
      const setup = await app.inject({ method: 'GET', url: '/api/setup', headers: { cookie } });
      expect(setup.statusCode).toBe(canManageConfiguration ? 200 : 403);
      expect(
        await owned(
          async (db) =>
            (
              await db.query(
                'SELECT * FROM turnstile.organization_configuration WHERE tenant_id=$1',
                [tenant],
              )
            ).rows[0],
        ),
      ).toEqual(before);
      const replay = await post('accept', cookie, flow.csrf, body);
      expect(replay.statusCode).toBe(200);
      expect(replay.json().memberId).toBe(accepted.json().memberId);
      if (cookieOf(replay))
        cookie = `${cookieOf(replay)}; ${flow.cookie.slice(flow.cookie.indexOf(';') + 1).trim()}`;
      expect(
        await owned(
          async (db) =>
            (
              await db.query(
                'SELECT count(*)::int AS n FROM turnstile.access_assignment WHERE tenant_id=$1 AND member_id=$2',
                [tenant, accepted.json().memberId],
              )
            ).rows[0].n,
        ),
      ).toBe(1);
      if (canManageConfiguration) {
        const session = await app.inject({
          method: 'GET',
          url: '/api/auth/session',
          headers: { cookie },
        });
        expect(session.statusCode).toBe(200);
        const completed = await app.inject({
          method: 'POST',
          url: '/api/setup/complete',
          headers: { cookie, origin, 'x-csrf-token': session.json().csrfToken },
          payload: { expectedRevision: before.revision },
        });
        expect(completed.statusCode).toBe(200);
        expect(completed.json().organization.rootId).toBe(before.root_id);
        expect(
          (
            await app.inject({ method: 'GET', url: '/api/workspace/status', headers: { cookie } })
          ).json().status,
        ).toBe('complete');
      }
      expect(invitation.state).toBe('pending');
    },
  );

  it('makes scanner GETs inert, protects exchange, and gives restricted state no ordinary route access', async () => {
    const invite = await issue();
    expect((await app.inject({ method: 'GET', url: '/api/invitations/exchange' })).statusCode).toBe(
      404,
    );
    expect((await context('')).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/invitations/exchange',
          headers: { origin: 'https://other.test' },
          payload: { credential: invite.credential },
        })
      ).statusCode,
    ).toBe(403);
    const flow = await exchange(invite.credential);
    expect(flow.context.phase).toBe('identity_required');
    for (const path of [
      '/api/auth/session',
      '/api/workspace/status',
      '/api/organization',
      '/api/dms/capabilities',
      '/api/structure/units',
    ])
      expect(
        (await app.inject({ method: 'GET', url: path, headers: { cookie: flow.cookie } }))
          .statusCode,
      ).toBe(401);
    const data = await owned(async (db) => ({
      sessions: (
        await db.query('SELECT ciphertext FROM turnstile.session WHERE tenant_id=$1', [tenant])
      ).rows,
      members: (
        await db.query('SELECT user_id FROM turnstile.access_member WHERE tenant_id=$1', [tenant])
      ).rows,
    }));
    expect(JSON.stringify(data).includes(invite.credential)).toBe(false);
    expect(data.members.some((r) => r.user_id === fixture.users.verified?.id)).toBe(false);
  });
  it('persists independent IP and digest budgets across invalid attempts and validates HTTP bounds', async () => {
    const invite = await issue();
    for (let i = 0; i < 10; i++)
      expect(
        (await post('exchange', '', '', { credential: randomBytes(32).toString('base64url') }))
          .statusCode,
      ).toBe(410);
    expect((await post('exchange', '', '', { credential: invite.credential })).statusCode).toBe(
      429,
    );
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/invitations/exchange',
          headers: { origin, 'content-type': 'text/plain' },
          payload: 'secret',
        })
      ).statusCode,
    ).toBe(415);
    const large = await app.inject({
      method: 'POST',
      url: '/api/invitations/exchange',
      headers: { origin },
      payload: { credential: 'x'.repeat(17000) },
    });
    expect(large.statusCode).toBe(413);
    expect(large.body.includes('xxxxx')).toBe(false);
    await owned((db) =>
      db.query('DELETE FROM turnstile.invitation_rate WHERE tenant_id=$1', [tenant]),
    );
    for (let i = 0; i < 10; i++)
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/api/invitations/exchange',
            remoteAddress: `127.0.0.${i + 2}`,
            headers: { origin },
            payload: { credential: invite.credential },
          })
        ).statusCode,
      ).toBe(200);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/invitations/exchange',
          remoteAddress: '127.0.0.99',
          headers: { origin },
          payload: { credential: invite.credential },
        })
      ).statusCode,
    ).toBe(429);
  });
  it('bounds public rate metadata without weakening attempt limits', async () => {
    const invite = await issue();
    await owned((db) =>
      db.query(
        `INSERT INTO turnstile.invitation_rate(tenant_id,actor,"window",count)
      SELECT $1,'public:fixture:'||n,date_trunc('minute',statement_timestamp())+interval '1 hour',1 FROM generate_series(1,10000) n`,
        [tenant],
      ),
    );
    const limited = await post('exchange', '', '', { credential: invite.credential });
    expect(limited.statusCode).toBe(503);
    expect(limited.json().reason).toBe('capacity');
    await owned((db) =>
      db.query(
        `UPDATE turnstile.invitation_rate SET "window"=date_trunc('minute',statement_timestamp())-interval '1 minute' WHERE tenant_id=$1`,
        [tenant],
      ),
    );
    const recovered = await post('exchange', '', '', { credential: invite.credential });
    expect(recovered.statusCode).toBe(200);
  });
  it('uses purpose OIDC for a nonmember, requires explicit reviewed CSRF acceptance, and commits once', async () => {
    const invite = await issue(undefined, true);
    const flow = await verified(invite.credential);
    expect(flow.context.phase).toBe('verified');
    expect(flow.context.review.scopeContext).toHaveLength(1);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/auth/session',
          headers: { cookie: flow.cookie },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (await app.inject({ method: 'GET', url: flow.callback, headers: { cookie: flow.cookie } }))
        .statusCode,
    ).toBe(400);
    const body = acceptance(flow.context);
    expect((await post('accept', flow.cookie, 'wrong', body)).statusCode).toBe(403);
    expect(
      (await post('accept', flow.cookie, flow.csrf, { ...body, scopeDigest: 'f'.repeat(64) }))
        .statusCode,
    ).toBe(409);
    const response = await post('accept', flow.cookie, flow.csrf, body);
    expect(response.statusCode).toBe(200);
    expect(response.json().session).toBe('established');
    const cookie = `${cookieOf(response)}; ${flow.cookie.slice(flow.cookie.indexOf(';') + 1).trim()}`;
    expect(
      (await app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie } }))
        .statusCode,
    ).toBe(200);
    const retry = await post('accept', cookie, flow.csrf, body);
    expect(retry.statusCode).toBe(200);
    const rows = await owned(async (db) => ({
      receipts: (
        await db.query(
          'SELECT count(*)::int AS n FROM turnstile.invitation_acceptance WHERE tenant_id=$1',
          [tenant],
        )
      ).rows[0].n,
      audits: (
        await db.query(
          "SELECT count(*)::int AS n FROM turnstile.invitation_audit WHERE tenant_id=$1 AND action='accepted'",
          [tenant],
        )
      ).rows[0].n,
      deliveries: (
        await db.query('SELECT payload FROM turnstile.invitation_delivery WHERE tenant_id=$1', [
          tenant,
        ])
      ).rows,
    }));
    expect(rows.receipts).toBe(1);
    expect(rows.audits).toBe(1);
    expect(rows.deliveries.every((r) => r.payload === null)).toBe(true);
  });
  it('never restores assignments or suspension on acceptance replay', async () => {
    const invite = await issue();
    const flow = await verified(invite.credential);
    const body = acceptance(flow.context);
    const accepted = await post('accept', flow.cookie, flow.csrf, body);
    expect(accepted.statusCode).toBe(200);
    const cookie = `${cookieOf(accepted)}; ${flow.cookie.slice(flow.cookie.indexOf(';') + 1).trim()}`;
    await owned(async (db) => {
      await db.query(
        'DELETE FROM turnstile.access_assignment WHERE tenant_id=$1 AND member_id=$2',
        [tenant, accepted.json().memberId],
      );
      await db.query(
        "UPDATE turnstile.access_member SET status='suspended',version=version+1 WHERE tenant_id=$1 AND id=$2",
        [tenant, accepted.json().memberId],
      );
    });
    const retry = await post('accept', cookie, flow.csrf, body);
    expect(retry.statusCode).toBe(200);
    expect(retry.json().session).toBe('denied');
    expect(
      (
        await owned((db) =>
          db.query(
            'SELECT * FROM turnstile.access_assignment WHERE tenant_id=$1 AND member_id=$2',
            [tenant, accepted.json().memberId],
          ),
        )
      ).rowCount,
    ).toBe(0);
  });
  it('reads accepted access by immutable subject after a verified email change', async () => {
    const email = `before-${randomUUID()}@example.test`;
    await rpc('create-race', { email });
    await fetch(`${origin}/identity/send-verification-email`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ email, callbackURL: `${origin}/sign-in` }),
    });
    const verification = (await rpc('verification')) as { path: string };
    await fetch(`${origin}${verification.path}`, { redirect: 'manual' });
    const invite = await issue(email);
    const flow = await verified(invite.credential, email);
    const body = acceptance(flow.context);
    const accepted = await post('accept', flow.cookie, flow.csrf, body);
    expect(accepted.statusCode).toBe(200);
    const cookie = `${cookieOf(accepted)}; ${flow.cookie.slice(flow.cookie.indexOf(';') + 1).trim()}`;
    await rpc('change-email', {
      id: accepted.json().userId,
      email: `after-${randomUUID()}@example.test`,
    });
    const current = await context(cookie);
    expect(current.statusCode).toBe(200);
    expect(current.json().phase).toBe('accepted');
    const replay = await post('accept', cookie, flow.csrf, body);
    expect(replay.statusCode).toBe(200);
    expect(replay.json().memberId).toBe(accepted.json().memberId);
  });
  it('rejects a wrong verified account and switches only the explicitly bound authority parent', async () => {
    const invite = await issue();
    const flow = await verified(invite.credential, fixture.users.operator?.email);
    expect(flow.context.phase).toBe('unavailable');
    expect(flow.context.state).toBe('identity_mismatch');
    const row = invite.result;
    const body = { ...action(row), permissionDigest: 'f'.repeat(64), scopeDigest: 'f'.repeat(64) };
    expect((await post('accept', flow.cookie, flow.csrf, body)).statusCode).toBe(403);
    const other = await authorityLogin();
    const changedCookie = `${flow.cookie.split(';')[0]}; ${other}`;
    expect((await context(changedCookie)).statusCode).toBe(401);
    expect((await post('switch-account', changedCookie, flow.csrf, action(row))).statusCode).toBe(
      400,
    );
    const switched = await post('switch-account', changedCookie, flow.csrf, {
      ...action(row),
      endCurrentAuthoritySession: true,
    });
    expect(switched.statusCode).toBe(200);
    expect(switched.json().authority).toBe('complete');
    const live = await fetch(`${origin}/identity/get-session`, { headers: { cookie: other } });
    expect((await live.json()).user.id).toBe(fixture.users.verified?.id);
    expect(
      (await context(`${cookieOf(switched) || flow.cookie.split(';')[0]}; ${other}`)).json().phase,
    ).toBe('identity_required');
  });
  it.each(['invitation.cancel', 'invitation.resend'] as const)(
    'serializes acceptance against %s with exactly one winner',
    async (operation) => {
      const invite = await issue();
      const flow = await verified(invite.credential);
      const [accepted, changed] = await Promise.allSettled([
        post('accept', flow.cookie, flow.csrf, acceptance(flow.context)),
        command(invite.result, operation),
      ]);
      expect(accepted.status).toBe('fulfilled');
      const response = accepted.status === 'fulfilled' ? accepted.value : undefined;
      const row = (
        await owned((db) =>
          db.query('SELECT state FROM turnstile.invitation WHERE tenant_id=$1 AND id=$2', [
            tenant,
            invite.result.id,
          ]),
        )
      ).rows[0];
      if (response?.statusCode === 200) {
        expect(changed.status).toBe('rejected');
        expect(row.state).toBe('accepted');
      } else {
        expect(response?.statusCode).toBe(409);
        expect(changed.status).toBe('fulfilled');
        expect(row.state).not.toBe('accepted');
      }
    },
  );
  it('fences expiry, invalidated unit approval and a changed recovery epoch', async () => {
    const invite = await issue(undefined, true);
    const flow = await verified(invite.credential);
    await owned((db) =>
      db.query('SELECT turnstile.invalidate_invitations($1,ARRAY[$2::uuid])', [
        tenant,
        invite.result.id,
      ]),
    );
    expect(
      (await post('accept', flow.cookie, flow.csrf, acceptance(flow.context))).statusCode,
    ).toBe(409);
    expect((await context(flow.cookie)).json().state).toBe('needs_reapproval');
    const invalidated = await app.get(InvitationService).read(actor(), invite.result.id);
    const [stale, reapproved] = await Promise.all([
      post('accept', flow.cookie, flow.csrf, acceptance(flow.context)),
      app.get(InvitationService).execute(actor(), randomUUID(), {
        operation: 'invitation.reapprove',
        ...(await versions()),
        id: invite.result.id,
        expectedVersion: invalidated.version,
        expectedGeneration: invalidated.generation,
        email: invite.result.email,
        assignments: [
          {
            roleId: role,
            expectedRoleVersion: 1,
            scope: { kind: 'units', unitIds: [unit], includeChildren: true },
          },
        ],
      }),
    ]);
    expect(stale.statusCode).toBe(409);
    expect(reapproved.state).toBe('pending');

    await owned((db) =>
      db.query('UPDATE turnstile.invitation SET recovery_epoch=$3 WHERE tenant_id=$1 AND id=$2', [
        tenant,
        invite.result.id,
        '0'.repeat(64),
      ]),
    );
    expect((await context(flow.cookie)).statusCode).toBe(410);
  });
  it('serializes an HTTP shared-role edit against real verified recipient acceptance', async () => {
    role = randomUUID();
    await owned(async (db) => {
      await db.query(
        "INSERT INTO turnstile.access_role(tenant_id,id,name,name_key) VALUES($1,$2,'Shared acceptance','shared acceptance')",
        [tenant, role],
      );
      await db.query(
        "INSERT INTO turnstile.access_role_permission(tenant_id,role_id,permission) SELECT $1,$2,unnest(ARRAY['turnstile:access','turnstile:units:manage','turnstile:units:read'])",
        [tenant, role],
      );
    });
    const invite = await issue(undefined, true);
    const flow = await verified(invite.credential);
    const admin = await purposeLogin('', await authorityLogin(fixture.users.operator?.email), '/');
    const session = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { cookie: admin.cookie },
    });
    expect(session.statusCode).toBe(200);
    const csrf = session.json().csrfToken;
    const patch = {
      operation: 'role.patch',
      change: 'permissions',
      ...(await versions()),
      id: role,
      expectedVersion: 1,
      permissions: ['turnstile:access', 'turnstile:units:read'],
    };
    const headers = {
      cookie: admin.cookie,
      origin,
      'sec-fetch-site': 'same-origin',
      'x-csrf-token': csrf,
    };
    const impact = await app.inject({
      method: 'POST',
      url: '/api/people/impact',
      headers,
      payload: { command: patch },
    });
    expect(impact.statusCode).toBe(200);
    const [edit, accepted] = await Promise.all([
      app.inject({
        method: 'PATCH',
        url: `/api/people/roles/${role}`,
        headers: { ...headers, 'idempotency-key': randomUUID() },
        payload: { command: patch, confirmation: impact.json().confirmation },
      }),
      post('accept', flow.cookie, flow.csrf, acceptance(flow.context)),
    ]);
    expect([edit.statusCode, accepted.statusCode].filter((status) => status === 200)).toHaveLength(
      1,
    );
    expect([edit.statusCode, accepted.statusCode].filter((status) => status === 409)).toHaveLength(
      1,
    );
    const current = await app.get(InvitationService).read(actor(), invite.result.id);
    expect(current.state).toBe(edit.statusCode === 200 ? 'needs_reapproval' : 'accepted');
    const member = await owned((db) =>
      db.query('SELECT id FROM turnstile.access_member WHERE tenant_id=$1 AND user_id=$2', [
        tenant,
        fixture.users.verified?.id,
      ]),
    );
    expect(member.rowCount).toBe(accepted.statusCode === 200 ? 1 : 0);
  });
  it('leaves committed membership recoverable when ordinary session establishment fails', async () => {
    const invite = await issue();
    const flow = await verified(invite.credential);
    const auth = app.get(BrowserAuthService);
    const spy = vi
      .spyOn(auth, 'establishInvitation')
      .mockRejectedValueOnce(new Error('Fixture session failure'));
    const response = await post('accept', flow.cookie, flow.csrf, acceptance(flow.context));
    expect(response.statusCode).toBe(200);
    expect(response.json().session).toBe('login_required');
    spy.mockRestore();
    expect((await context(flow.cookie)).json().phase).toBe('accepted');
    const recovered = await post('accept', flow.cookie, flow.csrf, acceptance(flow.context));
    expect(recovered.statusCode).toBe(200);
    expect(recovered.json().session).toBe('established');
    const authority = flow.cookie.slice(flow.cookie.indexOf(';') + 1).trim();
    const ordinary = await purposeLogin(cookieOf(recovered), authority, '/');
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/api/auth/session',
          headers: { cookie: ordinary.cookie },
        })
      ).statusCode,
    ).toBe(200);
  });
  it('rolls membership, assignments, receipt and invitation back on a late audit failure', async () => {
    const invite = await issue();
    const flow = await verified(invite.credential);
    await owned((db) =>
      db.query(
        "ALTER TABLE turnstile.invitation_audit ADD CONSTRAINT fixture_no_accept CHECK(action<>'accepted')",
      ),
    );
    try {
      expect(
        (await post('accept', flow.cookie, flow.csrf, acceptance(flow.context))).statusCode,
      ).toBe(503);
    } finally {
      await owned((db) =>
        db.query('ALTER TABLE turnstile.invitation_audit DROP CONSTRAINT fixture_no_accept'),
      );
    }
    expect((await context(flow.cookie)).json().phase).toBe('verified');
    expect(
      (
        await owned((db) =>
          db.query('SELECT * FROM turnstile.access_member WHERE tenant_id=$1 AND user_id=$2', [
            tenant,
            fixture.users.verified?.id,
          ]),
        )
      ).rowCount,
    ).toBe(0);
    expect(
      (await post('accept', flow.cookie, flow.csrf, acceptance(flow.context))).statusCode,
    ).toBe(200);
  });
  it('creates only recipient-owned credentials at the authority, verifies, and resumes after reopening', async () => {
    const email = `new-${randomUUID()}@example.test`;
    const password = randomBytes(24).toString('base64url');
    const invite = await issue(email);
    const flow = await exchange(invite.credential);
    const handoff = await post('setup', flow.cookie, flow.context.csrfToken, action(invite.result));
    expect(handoff.statusCode).toBe(200);
    const exchanged = await fetch(`${origin}${handoff.json().destination}`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ receipt: handoff.json().receipt }),
    });
    expect(exchanged.status).toBe(200);
    const cookie = exchanged.headers
      .getSetCookie()
      .map((v) => v.split(';')[0])
      .join('; ');
    const setup = await fetch(`${origin}/identity/invitation-setup/context`, {
      headers: { cookie },
    });
    const ctx = recipientAccountSetupContextSchema.parse(await setup.json());
    expect(ctx.phase).toBe('ready');
    const completed = await fetch(`${origin}/identity/invitation-setup/complete`, {
      method: 'POST',
      headers: {
        origin,
        cookie,
        'content-type': 'application/json',
        'x-csrf-token': ctx.csrfToken,
      },
      body: JSON.stringify({ name: ' New Recipient ', password }),
    });
    expect(completed.status).toBe(200);
    recipientAccountSetupResultSchema.parse(await completed.json());
    const account = (await rpc('account', { email })) as {
      user: { id: string; email_verified: boolean };
    };
    expect(account.user.email_verified).toBe(false);
    expect(
      (
        await owned((db) =>
          db.query('SELECT * FROM turnstile.access_member WHERE tenant_id=$1 AND user_id=$2', [
            tenant,
            account.user.id,
          ]),
        )
      ).rowCount,
    ).toBe(0);
    const link = (await rpc('verification')) as { path: string };
    expect((await fetch(`${origin}${link.path}`, { redirect: 'manual' })).status).toBe(302);
    const reopened = await exchange(invite.credential);
    const identity = await purposeLogin(reopened.cookie, await authorityLogin(email, password));
    const review = (await context(identity.cookie)).json();
    expect(review.phase).toBe('verified');
    expect(
      (await post('accept', identity.cookie, review.csrfToken, acceptance(review))).statusCode,
    ).toBe(200);
  });
  it('keeps unverified/passwordless accounts unchanged and treats authority outage as retryable', async () => {
    for (const label of ['unverified', 'passwordless']) {
      const user = fixture.users[label];
      if (!user) throw new Error('Missing account fixture');
      const before = await rpc('account', { email: user.email });
      const invite = await issue(user.email);
      const flow = await exchange(invite.credential);
      expect(
        (await post('setup', flow.cookie, flow.context.csrfToken, action(invite.result)))
          .statusCode,
      ).toBe(410);
      expect(await rpc('account', { email: user.email })).toEqual(before);
    }
    await owned((db) =>
      db.query('DELETE FROM turnstile.invitation_rate WHERE tenant_id=$1', [tenant]),
    );
    const invite = await issue();
    const flow = await verified(invite.credential);
    failAuthority = true;
    expect(
      (await post('accept', flow.cookie, flow.csrf, acceptance(flow.context))).statusCode,
    ).toBe(503);
    failAuthority = false;
    expect((await context(flow.cookie)).json().phase).toBe('verified');
  });
  it('uses database expiry and purpose lifetimes and refuses an already existing membership', async () => {
    const invite = await issue();
    const flow = await verified(invite.credential);
    await owned((db) =>
      db.query(
        "UPDATE turnstile.invitation SET expires_at=clock_timestamp()-interval '1 second' WHERE tenant_id=$1 AND id=$2",
        [tenant, invite.result.id],
      ),
    );
    expect(
      (await post('accept', flow.cookie, flow.csrf, acceptance(flow.context))).statusCode,
    ).toBe(409);
    await owned((db) =>
      db.query(
        "UPDATE turnstile.invitation SET expires_at=clock_timestamp()+interval '1 hour' WHERE tenant_id=$1 AND id=$2",
        [tenant, invite.result.id],
      ),
    );
    const member = randomUUID();
    await owned((db) =>
      db.query(
        "INSERT INTO turnstile.access_member(tenant_id,id,user_id,status) VALUES($1,$2,$3,'suspended')",
        [tenant, member, fixture.users.verified?.id],
      ),
    );
    expect((await context(flow.cookie)).json().state).toBe('membership_suspended');
    expect(
      (await post('accept', flow.cookie, flow.csrf, acceptance(flow.context))).statusCode,
    ).toBe(409);
    const server = app.getHttpAdapter().getInstance();
    const request = { protocol: 'http' } as FastifyRequest;
    await new Promise<void>((resolve, reject) =>
      server.decryptSession(
        decodeURIComponent(flow.cookie.split(';')[0]?.split('=').slice(1).join('=') ?? ''),
        request,
        (error?: Error) => (error ? reject(error) : resolve()),
      ),
    );
    const store = app.get(ProductDatabaseService).store;
    if (!store) throw new Error('Missing session store');
    await store.atomic(request.session.sessionStoreId, request.session.sessionId, (session) => {
      if (session.invitation?.identity) session.invitation.identity.expiresAt = 1;
      return true;
    });
    expect((await context(flow.cookie)).statusCode).toBe(401);
  });
  it('serializes two simultaneous acceptances without duplicate membership or assignments', async () => {
    const invite = await issue();
    const flow = await verified(invite.credential);
    const body = acceptance(flow.context);
    const responses = await Promise.all([
      post('accept', flow.cookie, flow.csrf, body),
      post('accept', flow.cookie, flow.csrf, body),
    ]);
    expect(responses.some((response) => response.statusCode === 200)).toBe(true);
    expect(responses.every((response) => [200, 401].includes(response.statusCode))).toBe(true);
    const counts = await owned(async (db) => ({
      members: (
        await db.query(
          'SELECT count(*)::int AS n FROM turnstile.access_member WHERE tenant_id=$1 AND user_id=$2',
          [tenant, fixture.users.verified?.id],
        )
      ).rows[0].n,
      receipts: (
        await db.query(
          'SELECT count(*)::int AS n FROM turnstile.invitation_acceptance WHERE tenant_id=$1',
          [tenant],
        )
      ).rows[0].n,
    }));
    expect(counts).toEqual({ members: 1, receipts: 1 });
  });
  it('rejects a live ban and keeps exact-parent logout retryable through an outage', async () => {
    const email = `ban-${randomUUID()}@example.test`;
    await rpc('create-race', { email });
    // Verify the fixture-created account through the owning authority's public email flow.
    await fetch(`${origin}/identity/send-verification-email`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ email, callbackURL: `${origin}/sign-in` }),
    });
    const verification = (await rpc('verification')) as { path: string };
    expect((await fetch(`${origin}${verification.path}`, { redirect: 'manual' })).status).toBe(302);
    const invite = await issue(email);
    const flow = await verified(invite.credential, email);
    failAuthority = true;
    const pending = await post('logout', flow.cookie, flow.csrf, {
      ...action(invite.result),
      endCurrentAuthoritySession: true,
    });
    expect(pending.statusCode).toBe(200);
    expect(pending.json().authority).toBe('pending');
    failAuthority = false;
    expect((await context(flow.cookie)).json().phase).toBe('identity_required');
    const done = await post('logout', flow.cookie, flow.csrf, {
      ...action(invite.result),
      endCurrentAuthoritySession: true,
    });
    expect(done.statusCode).toBe(200);
    expect(done.json().authority).toBe('complete');
    const reopened = await exchange(invite.credential);
    const identity = await purposeLogin(reopened.cookie, await authorityLogin(email));
    const review = (await context(identity.cookie)).json();
    expect(review.phase).toBe('verified');
    const account = (await rpc('account', { email })) as { user: { id: string } };
    await rpc('ban-user', { id: account.user.id });
    expect(
      (await post('accept', identity.cookie, review.csrfToken, acceptance(review))).statusCode,
    ).toBe(401);
    expect(
      (
        await owned((db) =>
          db.query('SELECT * FROM turnstile.access_member WHERE tenant_id=$1 AND user_id=$2', [
            tenant,
            account.user.id,
          ]),
        )
      ).rowCount,
    ).toBe(0);
  });

  it('fences an acceptance whose verified session is cancelled in another tab', async () => {
    const invite = await issue();
    const flow = await verified(invite.credential);
    const auth = app.get(BrowserAuthService);
    let entered: () => void = () => {},
      release: () => void = () => {};
    const reached = new Promise<void>((resolve) => {
      entered = resolve;
    });
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const original = auth.invitationIdentity.bind(auth);
    const spy = vi
      .spyOn(auth, 'invitationIdentity')
      .mockImplementationOnce(async (request, current) => {
        const identity = await original(request, current);
        entered();
        await blocked;
        return identity;
      });
    try {
      const accepting = post('accept', flow.cookie, flow.csrf, acceptance(flow.context));
      await reached;
      expect((await post('cancel', flow.cookie, flow.csrf, action(invite.result))).statusCode).toBe(
        200,
      );
      release();
      expect((await accepting).statusCode).toBe(401);
      expect(
        (
          await owned((db) =>
            db.query('SELECT * FROM turnstile.access_member WHERE tenant_id=$1 AND user_id=$2', [
              tenant,
              fixture.users.verified?.id,
            ]),
          )
        ).rowCount,
      ).toBe(0);
    } finally {
      release();
      spy.mockRestore();
    }
  });
  it('resumes a passwordless identity after authority verification and recovery without another account', async () => {
    const user = fixture.users.passwordless;
    if (!user) throw new Error('Missing passwordless fixture');
    const invite = await issue(user.email);
    const flow = await exchange(invite.credential);
    await fetch(`${origin}/identity/send-verification-email`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ email: user.email, callbackURL: `${origin}/sign-in` }),
    });
    const verify = (await rpc('verification')) as { path: string };
    expect((await fetch(`${origin}${verify.path}`, { redirect: 'manual' })).status).toBe(302);
    const requested = await fetch(`${origin}/identity/request-password-reset`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ email: user.email }),
    });
    expect(requested.status).toBe(200);
    const reset = (await rpc('recovery')) as { path: string };
    const redirect = await fetch(`${origin}${reset.path}`, { redirect: 'manual' });
    expect(redirect.status).toBe(302);
    const url = new URL(redirect.headers.get('location') ?? '');
    expect(url.pathname).toBe('/reset-password');
    const password = randomBytes(24).toString('base64url');
    const changed = await fetch(`${origin}/identity/reset-password`, {
      method: 'POST',
      headers: { origin, 'content-type': 'application/json' },
      body: JSON.stringify({ newPassword: password, token: url.searchParams.get('token') }),
    });
    expect(changed.status).toBe(200);
    // The original HttpOnly product continuation survives the fixed recovery destination.
    const identity = await purposeLogin(flow.cookie, await authorityLogin(user.email, password));
    const current = (await context(identity.cookie)).json();
    expect(current.phase).toBe('verified');
    expect(current.user.id).toBe(user.id);
    expect(
      (await post('accept', identity.cookie, current.csrfToken, acceptance(current))).statusCode,
    ).toBe(200);
  });

  it('carries a host-only Secure restricted continuation over real HTTPS', async () => {
    const invite = await issue();
    const directory = mkdtempSync(join(tmpdir(), 'turnstile-recipient-tls-'));
    const key = join(directory, 'key.pem'),
      cert = join(directory, 'cert.pem');
    const generated = spawnSync(
      'openssl',
      [
        'req',
        '-x509',
        '-newkey',
        'rsa:2048',
        '-nodes',
        '-keyout',
        key,
        '-out',
        cert,
        '-subj',
        '/CN=platform.example.test',
        '-days',
        '1',
      ],
      { stdio: 'ignore' },
    );
    expect(generated.status).toBe(0);
    const secureOrigin = 'https://platform.example.test';
    const config = parseProductEnvironment({
      ...process.env,
      AUTH_PROFILE: 'production',
      AUTH_PUBLIC_ORIGIN: secureOrigin,
      AUTH_ISSUER_URL: `${secureOrigin}/identity`,
      AUTH_LOGIN_CALLBACK_URL: `${secureOrigin}/api/auth/callback`,
    });
    const server = Fastify({ https: { key: readFileSync(key), cert: readFileSync(cert) } });
    const store = app.get(ProductDatabaseService).store;
    if (!store) throw new Error('Missing store');
    const invitationStore = app.get(InvitationStoreService);
    // Only the recipient origin changes for this isolated HTTPS adapter; all data,
    // crypto, credential lookup and session persistence remain the real owners.
    const secureStore = Object.create(invitationStore) as InvitationStoreService;
    Object.defineProperty(secureStore, 'config', {
      value: { ...invitationStore.config, AUTH_PUBLIC_ORIGIN: secureOrigin },
    });
    const recipient = new RecipientService(
      secureStore,
      app.get(InvitationService),
      app.get(BrowserAuthService),
      app.get(IdentityClientService),
    );
    try {
      await registerProductSession(server, config, store);
      server.post('/api/invitations/exchange', (request) => recipient.exchange(request));
      server.get('/api/invitations/context', (request) => recipient.context(request));
      await server.listen({ port: 0, host: '127.0.0.1' });
      const address = server.server.address();
      if (!address || typeof address === 'string') throw new Error('Missing TLS address');
      const call = (path: string, cookie = '', body?: object) =>
        new Promise<{ status: number; cookies: string[]; body: string }>((resolve, reject) => {
          const request = httpsRequest(
            {
              hostname: '127.0.0.1',
              port: address.port,
              path,
              method: body ? 'POST' : 'GET',
              rejectUnauthorized: false,
              headers: {
                origin: secureOrigin,
                host: 'platform.example.test',
                ...(cookie ? { cookie } : {}),
                ...(body ? { 'content-type': 'application/json' } : {}),
              },
            },
            (response) => {
              const chunks: Buffer[] = [];
              response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
              response.on('end', () =>
                resolve({
                  status: response.statusCode ?? 0,
                  cookies: response.headers['set-cookie'] ?? [],
                  body: Buffer.concat(chunks).toString(),
                }),
              );
            },
          );
          request.on('error', reject);
          request.end(body ? JSON.stringify(body) : undefined);
        });
      const response = await call('/api/invitations/exchange', '', {
        credential: invite.credential,
      });
      expect(response.status).toBe(200);
      const cookie = response.cookies.find((value) => value.startsWith('__Host-turnstile='));
      expect(!!cookie).toBe(true);
      for (const attribute of ['Secure', 'HttpOnly', 'SameSite=Lax', 'Path=/'])
        expect(cookie?.includes(attribute)).toBe(true);
      expect(cookie?.includes('Domain=')).toBe(false);
      const loaded = await call('/api/invitations/context', cookie?.split(';')[0]);
      expect(loaded.status).toBe(200);
      expect(JSON.parse(loaded.body).phase).toBe('identity_required');
    } finally {
      await server.close();
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('declines only the current generation and cancellation clears only this flow', async () => {
    const invite = await issue();
    const flow = await exchange(invite.credential);
    expect(
      (await post('cancel', flow.cookie, flow.context.csrfToken, action(invite.result))).statusCode,
    ).toBe(200);
    expect((await context(flow.cookie)).statusCode).toBe(401);
    const reopened = await exchange(invite.credential);
    const declined = await post(
      'decline',
      reopened.cookie,
      reopened.context.csrfToken,
      action(invite.result),
    );
    expect(declined.statusCode).toBe(200);
    expect(declined.json().state).toBe('cancelled');
    expect((await post('exchange', '', '', { credential: invite.credential })).statusCode).toBe(
      410,
    );
  });

  it('uses the real signed administrator session to close, verify and reopen the release', async () => {
    const invitation = await issue();
    const flow = await exchange(invitation.credential);
    const login = await purposeLogin('', await authorityLogin(fixture.users.operator?.email), '/');
    const administratorCookie = login.cookie.split(';')[0] as string;
    const revision = (await versions()).expectedAccessRevision;
    const closing = {
      operatorId: 'release-fixture',
      key: randomUUID(),
      expectedRevision: revision,
    };
    expect(await releaseOperator('close', closing)).toMatchObject({
      publicWritesEnabled: false,
      changed: true,
    });
    expect(await releaseOperator('close', closing)).toMatchObject({
      publicWritesEnabled: false,
      changed: false,
      replayed: true,
    });
    expect((await context(flow.cookie)).statusCode).toBe(503);
    expect(await app.get(InvitationDeliveryService).claim()).toEqual([]);
    const opening = {
      operatorId: 'release-fixture',
      key: randomUUID(),
      expectedRevision: (await versions()).expectedAccessRevision,
      administratorUserId: actor().userId,
      administratorCookie,
      releaseId: 'b'.repeat(64),
      incompatibleProcessesStopped: true,
    };
    await expect(
      releaseOperator('open', { ...opening, administratorCookie: 'turnstile=invalid' }),
    ).rejects.toThrow();
    expect(await releaseOperator('open', opening)).toMatchObject({
      publicWritesEnabled: true,
      ready: true,
      changed: true,
    });
    expect(await releaseOperator('open', opening)).toMatchObject({
      publicWritesEnabled: true,
      replayed: true,
      changed: false,
    });
    expect((await context(flow.cookie)).statusCode).toBe(200);
    const counts = await owned(
      async (db) =>
        (
          await db.query(
            "SELECT count(*)::int AS n FROM turnstile.access_audit WHERE action IN ('release_opened','release_closed')",
          )
        ).rows[0].n,
    );
    expect(counts).toBe(2);
  }, 45000);

  it('restores an actual archive, rejects the old epoch and quarantines mail without changing accepted grants', async () => {
    const accepted = await issue();
    const identity = await verified(accepted.credential);
    const response = await post(
      'accept',
      identity.cookie,
      identity.csrf,
      acceptance(identity.context),
    );
    expect(response.statusCode).toBe(200);
    const pending = await issue(fixture.users.unverified?.email);
    const sourceEnv = { ...process.env };
    const database = `um_restore_${randomUUID().replaceAll('-', '')}`;
    const container = process.env.ONBOARDING_ARCHIVE_CONTAINER as string;
    expect(container).toMatch(/^thaarei-auth-test-[a-f0-9]{12}$/);
    const sourceUrl = new URL(sourceEnv.PROVISION_DATABASE_URL as string);
    expect(sourceUrl.pathname).toBe('/auth_fixture');
    const port = spawnSync(
      'docker',
      [
        'inspect',
        '--format',
        '{{(index (index .NetworkSettings.Ports "5432/tcp") 0).HostPort}}',
        container,
      ],
      { encoding: 'utf8', timeout: 15000 },
    );
    expect(port.status).toBe(0);
    expect(port.stdout.trim()).toBe(sourceUrl.port);
    const dump = spawnSync(
      'docker',
      ['exec', container, 'pg_dump', '-U', 'postgres', '-d', 'auth_fixture', '--format=custom'],
      { timeout: 30000, maxBuffer: 16 * 1024 * 1024 },
    );
    expect(dump.status).toBe(0);
    const admin = new Pool({ connectionString: sourceEnv.PROVISION_DATABASE_URL, max: 1 });
    const cloneEnv = { ...sourceEnv };
    for (const key of ['TURNSTILE_DATABASE_URL', 'TURNSTILE_MIGRATION_DATABASE_URL'] as const) {
      const url = new URL(sourceEnv[key] as string);
      url.pathname = `/${database}`;
      cloneEnv[key] = url.toString();
    }
    let clone: Pool | undefined;
    let runtime: Pool | undefined;
    let created = false;
    try {
      await admin.query(`CREATE DATABASE "${database}"`);
      created = true;
      await admin.query(`REVOKE ALL ON DATABASE "${database}" FROM PUBLIC`);
      for (const boundary of ['auth', 'dms', 'turnstile']) {
        await admin.query(
          `GRANT CONNECT,CREATE ON DATABASE "${database}" TO thaarei_${boundary}_migrator`,
        );
        await admin.query(`GRANT CONNECT ON DATABASE "${database}" TO thaarei_${boundary}_runtime`);
      }
      const restored = spawnSync(
        'docker',
        [
          'exec',
          '-i',
          container,
          'pg_restore',
          '--exit-on-error',
          '-U',
          'postgres',
          '-d',
          database,
        ],
        { input: dump.stdout, timeout: 30000 },
      );
      expect(restored.status).toBe(0);
      clone = new Pool({ connectionString: cloneEnv.TURNSTILE_MIGRATION_DATABASE_URL, max: 1 });
      runtime = new Pool({ connectionString: cloneEnv.TURNSTILE_DATABASE_URL, max: 1 });
      const snapshot = () =>
        withTenant(clone as Pool, tenant, async (db) => ({
          members: (await db.query('SELECT * FROM turnstile.access_member ORDER BY id')).rows,
          grants: (await db.query('SELECT * FROM turnstile.access_assignment ORDER BY id')).rows,
          legacy: (await db.query('SELECT * FROM turnstile.access_legacy_source ORDER BY id')).rows,
          configuration: (await db.query('SELECT * FROM turnstile.organization_configuration'))
            .rows,
        }));
      const before = await snapshot();
      const input = {
        operatorId: 'restore-fixture',
        key: randomUUID(),
        expectedRevision: (await versions()).expectedAccessRevision,
        incompatibleProcessesStopped: true,
      };
      await expect(releaseOperator('recover', input, cloneEnv)).rejects.toThrow();
      const oldCloneEnv = { ...cloneEnv };
      cloneEnv.TURNSTILE_INVITATION_RECOVERY_EPOCH = randomBytes(32).toString('base64url');
      expect(await releaseOperator('recover', input, cloneEnv)).toMatchObject({
        publicWritesEnabled: false,
        changed: true,
        ready: true,
      });
      expect(await releaseOperator('recover', input, cloneEnv)).toMatchObject({
        publicWritesEnabled: false,
        changed: false,
        replayed: true,
      });
      expect(await snapshot()).toEqual(before);
      expect(
        await withTenant(runtime, tenant, (db) => canonicalAccessReady(db, tenant, sourceEnv)),
      ).toBe(false);
      expect(
        await withTenant(runtime, tenant, (db) => canonicalAccessReady(db, tenant, cloneEnv)),
      ).toBe(true);
      await withTenant(clone, tenant, async (db) => {
        expect(
          (
            await db.query('SELECT state,approval_id FROM turnstile.invitation WHERE id=$1', [
              pending.result.id,
            ])
          ).rows[0],
        ).toEqual({ state: 'needs_reapproval', approval_id: null });
        expect(
          (
            await db.query('SELECT state FROM turnstile.invitation WHERE id=$1', [
              accepted.result.id,
            ])
          ).rows[0].state,
        ).toBe('accepted');
        expect(
          (
            await db.query(
              "SELECT count(*)::int AS n FROM turnstile.invitation_delivery WHERE payload IS NOT NULL OR state IN ('queued','sending')",
            )
          ).rows[0].n,
        ).toBe(0);
        expect(
          (
            await db.query(
              "SELECT count(*)::int AS n FROM turnstile.invitation i JOIN turnstile.invitation_generation g ON g.tenant_id=i.tenant_id AND g.invitation_id=i.id AND g.id=i.approval_id AND g.generation=i.generation WHERE g.credential_hash=$1 AND i.state='pending'",
              [hash(pending.credential)],
            )
          ).rows[0].n,
        ).toBe(0);
        expect(
          (
            await db.query(
              "SELECT count(*)::int AS n FROM turnstile.access_audit WHERE action='release_recovered'",
            )
          ).rows[0].n,
        ).toBe(1);
      });
      await expect(
        releaseOperator(
          'recover',
          { ...input, key: randomUUID(), expectedRevision: input.expectedRevision + 1 },
          oldCloneEnv,
        ),
      ).rejects.toThrow();
    } finally {
      await closeFixturePool(runtime);
      await closeFixturePool(clone);
      if (created) await admin.query(`DROP DATABASE "${database}" WITH (FORCE)`);
      await admin.end();
    }
  }, 90000);
});
