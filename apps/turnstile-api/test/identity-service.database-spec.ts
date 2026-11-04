import { type ChildProcess, fork } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { readFileSync } from 'node:fs';
import { request as httpRequest } from 'node:http';
import { fileURLToPath } from 'node:url';
import { Pool } from 'pg';
import { withTenant } from '../src/infrastructure/database/postgres.js';
import { ProductPersistenceService } from '../src/infrastructure/database/product-persistence.service.js';
import { IdentityClientService } from '../src/integrations/identity/identity-client.service.js';
import { parseIdentityEnvironment } from '../src/integrations/identity/identity-environment.js';
import { resetAccessFixture } from './access-fixture.js';

interface Fixture {
  ready: true;
  port: number;
  secret: string;
  machineSecret: string;
  password: string;
  operatorCookie: string;
  users: Record<string, { id: string; email: string }>;
}
describe('narrow identity integration over separate-process authority HTTP', () => {
  let child: ChildProcess;
  let fixture: Fixture;
  let base: string;
  let client: IdentityClientService;
  let persistence: ProductPersistenceService;
  const owner = new Pool({ connectionString: process.env.TURNSTILE_MIGRATION_DATABASE_URL });
  const tenantId = process.env.INSTALLATION_TENANT_ID as string;
  const applicationId = process.env.TURNSTILE_APPLICATION_ID as string;
  const origin = process.env.AUTH_PUBLIC_ORIGIN as string;
  const resource = `${origin}/identity/services/accounts`;
  let token: string;
  const prefix = '/internal/identity/v1';
  const setup = '/identity/invitation-setup';
  const recipientPassword = randomBytes(24).toString('base64url');
  async function rpc(action: string, fields: Record<string, unknown> = {}) {
    const requestId = randomUUID();
    const result = new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        child.off('message', onMessage);
        reject(new Error('Fixture RPC timeout'));
      }, 10000);
      function onMessage(message: unknown) {
        const m = message as { requestId?: string; ok?: boolean; value?: unknown };
        if (m.requestId !== requestId) return;
        clearTimeout(timer);
        child.off('message', onMessage);
        if (m.ok) resolve(m.value);
        else reject(new Error('Fixture operation failed'));
      }
      child.on('message', onMessage);
    });
    child.send?.({ requestId, action, ...fields });
    return result;
  }
  async function request(
    path: string,
    body?: unknown,
    headers: Record<string, string> = {},
    method = body === undefined ? 'GET' : 'POST',
  ) {
    const response = await fetch(`${base}${path}`, {
      method,
      redirect: 'manual',
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.status === 401 && headers.authorization?.startsWith('Bearer ')) {
      console.log(
        'Identity token classification:',
        await rpc('check-token', {
          token: headers.authorization.slice(7),
        }),
      );
    }
    return { status: response.status, headers: response.headers, body: await response.json() };
  }
  function input(email = `new-${randomUUID()}@example.test`) {
    return {
      operationId: randomUUID(),
      invitationId: randomUUID(),
      generation: 1,
      email,
      expiresAt: new Date(Date.now() + 3600000).toISOString(),
    };
  }
  const body = (value: ReturnType<typeof input>) => ({
    ...value,
    tenantId,
    applicationId,
    purpose: 'application_invitation',
  });
  async function prepare(value = input()) {
    return request(`${prefix}/invitation-preparations`, body(value), {
      authorization: `Bearer ${token}`,
    });
  }
  async function exchange(receipt: string) {
    const result = await request(`${setup}/exchange`, { receipt }, { origin });
    expect(result.status).toBe(200);
    const api = JSON.parse(
      readFileSync(
        new URL('../../../docs/api/identity-invitations.openapi.json', import.meta.url),
        'utf8',
      ),
    );
    expect(result.headers.getSetCookie()[0]?.split('=')[0]).toBe(
      api.components.securitySchemes.LocalIdentitySetupContinuation.name,
    );
    return {
      cookie: (result.headers.getSetCookie()[0] ?? '').split(';')[0] ?? '',
      csrf: result.body.csrfToken,
      response: result,
    };
  }
  async function complete(
    session: Awaited<ReturnType<typeof exchange>>,
    name = ' New   Recipient ',
  ) {
    return request(
      `${setup}/complete`,
      { name, password: recipientPassword },
      { origin, cookie: session.cookie, 'x-csrf-token': session.csrf },
    );
  }
  async function accessToken(
    clientId = 'identity-fixture-service',
    secret = fixture.secret,
    audience = resource,
    scope = 'identity:invitation:prepare identity:subjects:read',
  ) {
    const response = await fetch(`${base}/identity/oauth2/token`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,
      },
      body: new URLSearchParams({ grant_type: 'client_credentials', resource: audience, scope }),
    });
    return { status: response.status, body: await response.json() };
  }
  beforeAll(async () => {
    child = fork(
      fileURLToPath(new URL('../../dms-api/test/identity-authority-fixture.mjs', import.meta.url)),
      [],
      { env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] },
    );
    fixture = await new Promise<Fixture>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Authority startup timeout')), 25000);
      child.on('message', (m) => {
        if ((m as Fixture).ready) {
          clearTimeout(timer);
          resolve(m as Fixture);
        }
      });
      child.once('exit', () => {
        clearTimeout(timer);
        reject(new Error('Authority fixture exited'));
      });
    });
    base = `http://127.0.0.1:${fixture.port}`;
    vi.stubEnv('IDENTITY_SERVICE_CLIENT_ID', 'identity-fixture-service');
    vi.stubEnv('IDENTITY_SERVICE_CLIENT_SECRET', fixture.secret);
    vi.stubEnv('IDENTITY_SERVICE_RESOURCE_URL', resource);
    vi.stubEnv('IDENTITY_SERVICE_API_URL', base);
    persistence = new ProductPersistenceService();
    client = new IdentityClientService(persistence);
    const issued = await accessToken();
    expect(issued.status).toBe(200);
    token = issued.body.access_token;
  });
  beforeEach(async () => {
    await rpc('clear-limits');
  });
  afterAll(async () => {
    await persistence?.onApplicationShutdown();
    await owner.end();
    if (child?.connected) {
      const done = once(child, 'exit');
      child.kill('SIGTERM');
      await done;
    }
    vi.unstubAllEnvs();
  });
  it('rejects reused clients, secrets and noncanonical identity audiences/transports', () => {
    expect(() =>
      parseIdentityEnvironment({
        ...process.env,
        IDENTITY_SERVICE_CLIENT_ID: process.env.AUTH_LOGIN_CLIENT_ID,
      }),
    ).toThrow();
    expect(() =>
      parseIdentityEnvironment({
        ...process.env,
        IDENTITY_SERVICE_CLIENT_SECRET: process.env.AUTH_LOGIN_CLIENT_SECRET,
      }),
    ).toThrow();
    expect(() =>
      parseIdentityEnvironment({
        ...process.env,
        IDENTITY_SERVICE_RESOURCE_URL: process.env.DMS_RESOURCE_URL,
      }),
    ).toThrow();
    expect(() =>
      parseIdentityEnvironment({
        ...process.env,
        IDENTITY_SERVICE_API_URL: `${base}/internal?token=bad`,
      }),
    ).toThrow();
  });
  it('prepares without placeholders, deduplicates lost preparation responses and binds exact operations', async () => {
    const value = input();
    const first = await client.prepare(value);
    expect(first.state).toBe('authorized');
    expect(((await rpc('account', { email: value.email })) as { user: unknown }).user).toBeNull();
    expect(await client.prepare(value)).toEqual(first);
    expect(await client.preparation(value.operationId)).toEqual(first);
    expect((await prepare({ ...value, email: 'different@example.test' })).status).toBe(409);
    expect(
      (
        await request(
          `${prefix}/invitation-preparations`,
          { ...body(input()), password: recipientPassword },
          { authorization: `Bearer ${token}` },
        )
      ).status,
    ).toBe(400);
    expect(
      (
        await request(
          `${prefix}/invitation-preparations`,
          { ...body(input()), applicationId: randomUUID() },
          { authorization: `Bearer ${token}` },
        )
      ).status,
    ).toBe(403);
    expect(await rpc('rls')).toBe(0);
  });
  it('creates one ordinary unverified credential from the normalized recipient input and fixed verification callback', async () => {
    const value = input();
    const p = await prepare(value);
    const session = await exchange(p.body.setupReceipt);
    expect(
      (await request(`${setup}/exchange`, { receipt: p.body.setupReceipt }, { origin })).status,
    ).toBe(410);
    expect(session.response.headers.getSetCookie()[0] ?? '').toContain('HttpOnly');
    expect(session.response.headers.get('cache-control')).toBe('private, no-store');
    expect(
      (await request(`${setup}/context`, undefined, { cookie: session.cookie })).body.phase,
    ).toBe('ready');
    expect((await complete(session)).status).toBe(200);
    const account = (await rpc('account', {
      email: value.email,
      plaintext: recipientPassword,
    })) as {
      user: { id: string; name: string; email_verified: boolean; role: string };
      credentials: { count: number; hashed: boolean };
    };
    expect(account.user).toMatchObject({
      name: 'New Recipient',
      email_verified: false,
      role: 'user',
    });
    expect(account.credentials).toEqual({ count: 1, hashed: true });
    expect(await client.preparation(value.operationId)).toMatchObject({
      state: 'completed',
      userId: account.user.id,
      emailVerified: false,
    });
    const verification = (await rpc('verification')) as { path: string; callback: string };
    expect(verification.callback).toBe(`${origin}/sign-in`);
    const verificationToken = new URL(`${origin}${verification.path}`).searchParams.get('token');
    const claims = JSON.parse(
      Buffer.from(verificationToken?.split('.')[1] ?? '', 'base64url').toString(),
    ) as { iat: number; exp: number };
    expect(claims.exp - claims.iat).toBe(1800);
    const response = await fetch(`${base}${verification.path}`, { redirect: 'manual' });
    expect(response.status).toBe(302);
    expect(response.headers.get('location')).toBe(`${origin}/sign-in`);
    expect(await client.preparation(value.operationId)).toMatchObject({
      state: 'completed',
      emailVerified: true,
    });
    const replay = await complete(session, 'Replacement Name');
    expect(replay.status).toBe(200);
    expect(
      ((await rpc('account', { email: value.email })) as { user: { name: string } }).user.name,
    ).toBe('New Recipient');
  });
  it.each(['verified', 'unverified', 'passwordless', 'banned'])(
    'preserves existing %s accounts without identity or credential writes',
    async (label) => {
      const existing = fixture.users[label];
      if (!existing) throw new Error('Missing fixture identity');
      const before = await rpc('account', { email: existing.email });
      const p = await prepare(input(existing.email));
      expect(p.status).toBe(200);
      expect(p.body).toMatchObject(
        label === 'banned'
          ? { state: 'unavailable' }
          : { state: 'completed', userId: existing.id, emailVerified: label === 'verified' },
      );
      expect(p.body.setupReceipt).toBeUndefined();
      expect(await rpc('account', { email: existing.email })).toEqual(before);
    },
  );
  it('rejects cookie/admin/DMS tokens, wrong audience, client and scope without DMS enrollment', async () => {
    expect(
      (
        await request(`${prefix}/invitation-preparations`, body(input()), {
          cookie: fixture.operatorCookie,
        })
      ).status,
    ).toBe(401);
    const wrong = await accessToken(
      'identity-fixture-machine',
      fixture.machineSecret,
      process.env.DMS_RESOURCE_URL as string,
      'dms:capabilities:read',
    );
    expect(wrong.status).toBe(200);
    expect(
      (
        await request(`${prefix}/invitation-preparations`, body(input()), {
          authorization: `Bearer ${wrong.body.access_token}`,
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await accessToken(
          'identity-fixture-service',
          fixture.secret,
          process.env.DMS_RESOURCE_URL as string,
        )
      ).status,
    ).toBe(400);
    const projection = await accessToken(
      'identity-fixture-service',
      fixture.secret,
      resource,
      'identity:subjects:read',
    );
    expect(projection.status).toBe(200);
    expect(
      (
        await request(`${prefix}/invitation-preparations`, body(input()), {
          authorization: `Bearer ${projection.body.access_token}`,
        })
      ).status,
    ).toBe(403);
  });
  it('immediately fences issued tokens and setup sessions on suspension and scope removal', async () => {
    const p = await prepare();
    const session = await exchange(p.body.setupReceipt);
    await rpc('suspend');
    try {
      expect((await prepare()).status).toBe(403);
      expect((await complete(session)).status).toBe(403);
    } finally {
      await rpc('resume');
    }
    await rpc('set-scopes', { scopes: ['identity:subjects:read'] });
    try {
      expect((await prepare()).status).toBe(403);
      expect((await complete(session)).status).toBe(403);
    } finally {
      await rpc('set-scopes', {
        scopes: ['identity:invitation:prepare', 'identity:subjects:read'],
      });
    }
  });
  it('fences CSRF, invalid names/passwords, expiry, superseded generations and cancelled sessions', async () => {
    const value = input();
    const p = await prepare(value);
    const session = await exchange(p.body.setupReceipt);
    expect(
      (
        await request(
          `${setup}/complete`,
          { name: 'Recipient', password: recipientPassword },
          { origin: 'http://localhost:9999', cookie: session.cookie, 'x-csrf-token': session.csrf },
        )
      ).status,
    ).toBe(403);
    expect(
      (
        await request(
          `${setup}/complete`,
          { name: 'Recipient', password: recipientPassword },
          { origin, cookie: session.cookie },
        )
      ).status,
    ).toBe(403);
    expect((await complete(session, '\u200b')).status).toBe(400);
    expect(
      (
        await request(
          `${setup}/complete`,
          { name: 'Recipient', password: 'short' },
          { origin, cookie: session.cookie, 'x-csrf-token': session.csrf },
        )
      ).status,
    ).toBe(400);
    expect(((await rpc('account', { email: value.email })) as { user: unknown }).user).toBeNull();
    await prepare({ ...value, operationId: randomUUID(), generation: 2 });
    expect((await complete(session)).status).toBe(410);
    const p2 = await prepare();
    const session2 = await exchange(p2.body.setupReceipt);
    await rpc('expire', { id: p2.body.id });
    expect((await complete(session2)).status).toBe(410);
    const p3 = await prepare();
    const session3 = await exchange(p3.body.setupReceipt);
    expect(
      (
        await request(
          `${setup}/cancel`,
          {},
          { origin, cookie: session3.cookie, 'x-csrf-token': session3.csrf },
        )
      ).status,
    ).toBe(200);
    expect((await complete(session3)).status).toBe(410);
  });
  it('serializes duplicate recipient creation and preserves an independent authority creator', async () => {
    const value = input();
    const first = await prepare(value);
    const second = await prepare({
      ...value,
      operationId: randomUUID(),
      invitationId: randomUUID(),
    });
    const a = await exchange(first.body.setupReceipt);
    const b = await exchange(second.body.setupReceipt);
    const results = await Promise.all([complete(a), complete(b, 'Different Name')]);
    expect(results.map((r) => r.status)).toEqual([200, 200]);
    const account = (await rpc('account', {
      email: value.email,
      plaintext: recipientPassword,
    })) as {
      user: { id: string };
      credentials: { count: number };
    };
    expect(account.credentials.count).toBe(1);
    expect(await client.preparation(value.operationId)).toMatchObject({
      state: 'completed',
      userId: account.user.id,
    });
    const collision = input();
    const p = await prepare(collision);
    const session = await exchange(p.body.setupReceipt);
    await rpc('create-race', { email: collision.email });
    const before = await rpc('account', { email: collision.email });
    expect((await complete(session)).status).toBe(200);
    expect(await rpc('account', { email: collision.email })).toEqual(before);
  });
  it('rolls back the provider user, credential and receipt together when completion audit fails', async () => {
    const value = input();
    const p = await prepare(value);
    const session = await exchange(p.body.setupReceipt);
    await rpc('fail-complete-audit');
    try {
      expect((await complete(session)).status).toBe(503);
      expect(((await rpc('account', { email: value.email })) as { user: unknown }).user).toBeNull();
      expect(await client.preparation(value.operationId)).toMatchObject({ state: 'unavailable' });
    } finally {
      await rpc('allow-complete-audit');
    }
    expect((await complete(session)).status).toBe(200);
  });
  it('reconciles a dropped completion response through the same authority receipt', async () => {
    const value = input();
    const p = await prepare(value);
    const session = await exchange(p.body.setupReceipt);
    await new Promise<void>((resolve, reject) => {
      const outgoing = httpRequest(
        `${base}${setup}/complete`,
        {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            origin,
            cookie: session.cookie,
            'x-csrf-token': session.csrf,
          },
        },
        (response) => {
          response.destroy();
          resolve();
        },
      );
      outgoing.once('error', reject);
      outgoing.end(JSON.stringify({ name: 'Delivered Once', password: recipientPassword }));
    });
    const before = await rpc('account', { email: value.email });
    expect(await client.preparation(value.operationId)).toMatchObject({ state: 'completed' });
    expect((await complete(session)).status).toBe(200);
    expect(await rpc('account', { email: value.email })).toEqual(before);
  });
  it('reconciles mail failure and uncertain completion without a second create or mail send', async () => {
    const value = input();
    const p = await prepare(value);
    const session = await exchange(p.body.setupReceipt);
    await rpc('reject-mail');
    expect((await complete(session)).status).toBe(503);
    const before = await rpc('account', { email: value.email });
    expect(await client.preparation(value.operationId)).toMatchObject({
      state: 'completed',
      emailVerified: false,
    });
    // The caller may discard a successful response; receipt readback and explicit replay remain safe.
    expect((await complete(session)).status).toBe(200);
    expect(await rpc('account', { email: value.email })).toEqual(before);
  });
  it('projects only canonical product memberships after live people authority, keeps immutable links and deleted subjects', async () => {
    const actor = fixture.users.operator;
    if (!actor) throw new Error('Missing fixture identity');
    const target = fixture.users.verified;
    if (!target) throw new Error('Missing fixture identity');
    await resetAccessFixture(owner, [
      { userId: actor.id, permissions: ['turnstile:access'] },
      { userId: target.id, permissions: ['turnstile:access'] },
    ]);
    await withTenant(owner, tenantId, (db) =>
      db.query(
        `INSERT INTO turnstile.access_assignment (tenant_id,id,member_id,role_id,scope_kind,include_children,scope_key) SELECT m.tenant_id,$2,m.id,r.id,'company',false,'company' FROM turnstile.access_member m JOIN turnstile.access_role r ON r.tenant_id=m.tenant_id AND r.system_key='workspace_administrator' WHERE m.tenant_id=$1 AND m.user_id=$3`,
        [tenantId, randomUUID(), actor.id],
      ),
    );
    const rows = await withTenant(owner, tenantId, (db) =>
      db.query('SELECT id FROM turnstile.access_member WHERE user_id=$1', [target.id]),
    );
    const memberId = rows.rows[0].id as string;
    const projected = await client.projectMembers({ userId: actor.id, requestId: randomUUID() }, [
      memberId,
    ]);
    expect(projected.subjects).toEqual([
      expect.objectContaining({ userId: target.id, state: 'present', email: target.email }),
    ]);
    await expect(
      client.projectMembers({ userId: target.id, requestId: randomUUID() }, [memberId]),
    ).rejects.toThrow();
    await expect(
      client.projectMembers({ userId: actor.id, requestId: randomUUID() }, [randomUUID()]),
    ).rejects.toThrow();
    const rebound = await request(
      `${prefix}/subject-projections`,
      {
        tenantId,
        applicationId,
        purpose: 'member_display',
        subjects: [{ memberId, userId: fixture.users.passwordless?.id, memberVersion: 2 }],
      },
      { authorization: `Bearer ${token}` },
    );
    expect(rebound.status).toBe(409);
    await rpc('delete-user', { id: target.id });
    expect(
      (await client.projectMembers({ userId: actor.id, requestId: randomUUID() }, [memberId]))
        .subjects[0],
    ).toMatchObject({ userId: target.id, state: 'deleted' });
    await withTenant(owner, tenantId, (db) =>
      db.query(
        'DELETE FROM turnstile.access_assignment WHERE tenant_id=$1 AND member_id IN (SELECT id FROM turnstile.access_member WHERE tenant_id=$1 AND user_id=$2)',
        [tenantId, actor.id],
      ),
    );
    await expect(
      client.projectMembers({ userId: actor.id, requestId: randomUUID() }, [memberId]),
    ).rejects.toThrow();
  });
  it('fails closed on unsafe feature grants, authority outage and bounded setup abuse', async () => {
    await rpc('break-audit');
    try {
      expect((await prepare()).status).toBe(503);
    } finally {
      await rpc('restore-audit');
    }
    for (const grant of ['allow-audit-update', 'allow-audit-column-update']) {
      await rpc(grant);
      try {
        expect((await prepare()).status).toBe(503);
      } finally {
        await rpc('deny-audit-update');
      }
    }
    for (let i = 0; i < 20; i++)
      expect(
        (
          await request(
            `${setup}/exchange`,
            { receipt: randomBytes(32).toString('base64url') },
            { origin },
          )
        ).status,
      ).toBe(410);
    const denied = await request(
      `${setup}/exchange`,
      { receipt: randomBytes(32).toString('base64url') },
      { origin },
    );
    expect(denied.status).toBe(429);
    expect(denied.headers.get('retry-after')).toBe('60');
    await rpc('clear-limits');
    const expired = input();
    const retained = input();
    await client.prepare(expired);
    const keep = await client.prepare(retained);
    await rpc('expire-retention', { id: expired.operationId });
    const pruned = (await rpc('prune')) as Record<string, number>;
    expect(pruned.identity_preparation).toBe(1);
    expect(pruned.identity_audit).toBe(0);
    await expect(client.preparation(expired.operationId)).rejects.toThrow(
      'IDENTITY_SERVICE_NOT_FOUND',
    );
    expect(await client.preparation(retained.operationId)).toEqual(keep);
    const bad = new IdentityClientService(persistence);
    Object.defineProperty(bad, 'config', {
      value: { ...client.config, IDENTITY_SERVICE_API_URL: 'http://127.0.0.1:1' },
    });
    await expect(bad.prepare(input())).rejects.toThrow('IDENTITY_SERVICE_UNAVAILABLE');
  });
});
