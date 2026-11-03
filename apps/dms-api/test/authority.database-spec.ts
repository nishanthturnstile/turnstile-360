import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { oauthProviderClient } from '@better-auth/oauth-provider/client';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createAuthClient } from 'better-auth/client';
import { Pool } from 'pg';
import { createApplication } from '../src/bootstrap.js';
import { bootstrapInstallation } from '../src/infrastructure/database/migrate.js';
import { withTenant } from '../src/infrastructure/database/postgres.js';
import { AuthorityService } from '../src/modules/platform-auth/authority/authority.service.js';
import { manageOAuthClient } from '../src/modules/platform-auth/manage-client.js';
import { userInfoResource } from '../src/modules/platform-auth/oauth-policy.js';
import { provisionUser } from '../src/modules/platform-auth/provision-user.js';
import { smtpFixture } from './smtp-fixture.js';

describe('persisted authority and native HTTP boundary', () => {
  let app: NestFastifyApplication;
  let smtp: Awaited<ReturnType<typeof smtpFixture>>;
  let authority: AuthorityService;
  const owner = new Pool({ connectionString: process.env.AUTH_MIGRATION_DATABASE_URL });
  const dms = new Pool({ connectionString: process.env.DMS_DATABASE_URL, max: 1 });
  const password = randomBytes(24).toString('base64url');
  const email = 'user@example.test';
  const adminEmail = 'operator@example.test';
  const origin = process.env.AUTH_PUBLIC_ORIGIN as string;
  const tenantId = process.env.INSTALLATION_TENANT_ID as string;

  function currentAuth() {
    const auth = authority.auth;
    if (!auth) throw new Error('Authority fixture is unavailable');
    return auth;
  }
  async function start() {
    app = await createApplication(false);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    authority = app.get(AuthorityService);
  }
  function cookie(response: { headers: Record<string, unknown> }) {
    const value = response.headers['set-cookie'];
    return (Array.isArray(value) ? value : [value])
      .filter((item): item is string => typeof item === 'string')
      .map((item) => item.split(';')[0])
      .join('; ');
  }
  async function signIn(userEmail = email, userPassword = password) {
    return app.inject({
      method: 'POST',
      url: '/identity/sign-in/email',
      headers: { origin },
      payload: { email: userEmail, password: userPassword },
    });
  }
  async function createUser(userEmail: string, role: 'admin' | 'user') {
    if (!authority.auth) throw new Error('Authority fixture is unavailable');
    await provisionUser(authority.auth, { email: userEmail, name: role, role, password }, origin);
    const verification = smtp.link('verify');
    const response = await app.inject({
      method: 'GET',
      url: verification.pathname + verification.search,
    });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe(`${origin}/sign-in`);
  }

  beforeAll(async () => {
    smtp = await smtpFixture();
    vi.stubEnv('AUTH_SMTP_PORT', String(smtp.port));
    await start();
    expect((await app.inject({ method: 'GET', url: '/health/ready/auth' })).statusCode).toBe(200);
    await createUser(email, 'user');
    await createUser(adminEmail, 'admin');
  });
  beforeEach(async () => {
    await owner.query('DELETE FROM auth.rate_limit');
  });
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    await app?.close();
    await smtp?.close();
    await owner.end();
    await dms.end();
    vi.unstubAllEnvs();
  });

  it('serves exact discovery paths and persists encrypted signing keys across restart', async () => {
    for (const path of [
      '/identity/.well-known/openid-configuration',
      '/identity/.well-known/oauth-authorization-server',
      '/.well-known/oauth-authorization-server/identity',
    ]) {
      const result = await app.inject({ method: 'GET', url: path });
      expect(result.statusCode).toBe(200);
      expect(result.json().issuer).toBe(`${origin}/identity`);
      expect(result.headers['cache-control']).toBe('no-store');
    }
    const first = await app.inject({ method: 'GET', url: '/identity/jwks' });
    expect(first.statusCode).toBe(200);
    const { rows } = await owner.query('SELECT private_key FROM auth.jwks');
    expect(rows.length).toBeGreaterThan(0);
    expect(
      rows.every(
        (row) => !row.private_key.includes('PRIVATE KEY') && !row.private_key.startsWith('{'),
      ),
    ).toBe(true);
    await app.close();
    await start();
    const second = await app.inject({ method: 'GET', url: '/identity/jwks' });
    expect(second.json()).toEqual(first.json());
  });

  it('requires verified addresses and denies invalid credentials, public signup and account administration', async () => {
    const unverified = 'unverified@example.test';
    await provisionUser(
      currentAuth(),
      { email: unverified, name: 'unverified', role: 'user', password },
      origin,
    );
    expect((await signIn(unverified)).statusCode).toBe(403);
    expect((await signIn(email, 'incorrect-password-for-test')).statusCode).toBe(401);
    const login = await signIn();
    expect(login.statusCode).toBe(200);
    expect(Object.hasOwn(login.json(), 'token')).toBe(false);
    const header = cookie(login);
    for (const path of [
      '/identity/sign-up/email',
      '/identity/admin/create-user',
      '/identity/admin/set-role',
      '/identity/admin/impersonate-user',
      '/identity/oauth2/create-client',
      '/identity/admin/oauth2/create-client',
      '/identity/token',
    ]) {
      const result = await app.inject({
        method: 'POST',
        url: path,
        headers: { origin, cookie: header },
        payload: {},
      });
      expect(result.statusCode).toBe(404);
    }
  });

  it('retrieves a safe persistent session after restart and revokes it with separate cookie-clear headers', async () => {
    const login = await signIn();
    const header = cookie(login);
    const {
      rows: [before],
    } = await owner.query('SELECT count(*)::int AS count FROM auth.session');
    expect(before.count).toBeGreaterThan(0);
    await app.close();
    await start();
    const session = await app.inject({
      method: 'GET',
      url: '/identity/get-session',
      headers: { cookie: header },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json().user.email).toBe(email);
    expect(Object.hasOwn(session.json().session, 'token')).toBe(false);
    expect(session.headers['set-auth-jwt']).toBeUndefined();
    const sessions = await app.inject({
      method: 'GET',
      url: '/identity/list-sessions',
      headers: { cookie: header },
    });
    expect(sessions.json().every((item: object) => !Object.hasOwn(item, 'token'))).toBe(true);
    const logout = await app.inject({
      method: 'POST',
      url: '/identity/sign-out',
      headers: { origin, cookie: header },
      payload: {},
    });
    expect(logout.statusCode).toBe(200);
    expect(Array.isArray(logout.headers['set-cookie'])).toBe(true);
    expect((logout.headers['set-cookie'] as string[]).length).toBeGreaterThan(1);
    const ended = await app.inject({
      method: 'GET',
      url: '/identity/get-session',
      headers: { cookie: header },
    });
    expect(ended.json()).toBe(null);
  });

  it('rejects bad origins and bounds recovery callbacks to their configured paths', async () => {
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/identity/sign-in/email',
          headers: { origin: 'https://attacker.example' },
          payload: { email, password },
        })
      ).statusCode,
    ).toBe(403);
    for (const redirectTo of ['https://attacker.example/reset-password', `${origin}/arbitrary`]) {
      expect(
        (
          await app.inject({
            method: 'POST',
            url: '/identity/request-password-reset',
            headers: { origin },
            payload: { email, redirectTo },
          })
        ).statusCode,
      ).toBe(400);
    }
    const malformed = await app.inject({
      method: 'POST',
      url: '/identity/sign-in/email',
      headers: { origin, 'content-type': 'application/json' },
      payload: '{invalid',
    });
    expect(malformed.statusCode).toBe(400);
    expect(malformed.json()).toEqual({ code: 'INVALID_AUTH_REQUEST' });
  });

  it('uses database rate limits across a process restart and ignores forged forwarding headers', async () => {
    for (let attempt = 0; attempt < 3; attempt++)
      expect((await signIn(email, 'incorrect-password-for-test')).statusCode).toBe(401);
    await app.close();
    await start();
    const blocked = await app.inject({
      method: 'POST',
      url: '/identity/sign-in/email',
      headers: { origin, 'x-forwarded-for': '203.0.113.4' },
      payload: { email, password },
    });
    expect(blocked.statusCode).toBe(429);
    expect(
      (await owner.query('SELECT count(*)::int AS count FROM auth.rate_limit')).rows[0].count,
    ).toBeGreaterThan(0);
  });

  it('renews the database rate-limit budget even when requests continue inside the window', async () => {
    const start = Date.now();
    const clock = vi.spyOn(Date, 'now');
    try {
      for (const elapsed of [0, 4000, 8000]) {
        clock.mockReturnValue(start + elapsed);
        expect((await signIn(email, 'incorrect-password-for-test')).statusCode).toBe(401);
      }
      clock.mockReturnValue(start + 9000);
      expect((await signIn(email, 'incorrect-password-for-test')).statusCode).toBe(429);
      clock.mockReturnValue(start + 11000);
      expect((await signIn(email, 'incorrect-password-for-test')).statusCode).toBe(401);
    } finally {
      clock.mockRestore();
    }
  });

  it('bounds reset expiry and reports SMTP failure without issuing a successful recovery response', async () => {
    await app.inject({
      method: 'POST',
      url: '/identity/request-password-reset',
      headers: { origin },
      payload: { email },
    });
    const token = smtp.link('reset').pathname.split('/').at(-1);
    const {
      rows: [reset],
    } = await owner.query('SELECT expires_at FROM auth.verification WHERE identifier = $1', [
      `reset-password:${token}`,
    ]);
    expect(new Date(reset.expires_at).getTime() <= Date.now() + 1800000).toBe(true);
    await owner.query(
      "UPDATE auth.verification SET expires_at = now() - interval '1 second' WHERE identifier = $1",
      [`reset-password:${token}`],
    );
    const expired = await app.inject({
      method: 'POST',
      url: '/identity/reset-password',
      headers: { origin },
      payload: { token, newPassword: password },
    });
    expect(expired.statusCode).toBe(400);
    await app.close();
    vi.stubEnv('AUTH_SMTP_PORT', '1');
    try {
      await start();
      const failure = await app.inject({
        method: 'POST',
        url: '/identity/request-password-reset',
        headers: { origin },
        payload: { email },
      });
      expect(failure.statusCode).toBe(503);
      expect(failure.json()).toEqual({ code: 'AUTH_UNAVAILABLE' });
      const unknown = await app.inject({
        method: 'POST',
        url: '/identity/request-password-reset',
        headers: { origin },
        payload: { email: 'unknown@example.test' },
      });
      expect(unknown.statusCode).toBe(503);
    } finally {
      await app.close();
      vi.stubEnv('AUTH_SMTP_PORT', String(smtp.port));
      await start();
    }
  });

  it('detects send failures even when the pinned library catches the callback error', async () => {
    smtp.rejectNextDelivery();
    const failure = await app.inject({
      method: 'POST',
      url: '/identity/request-password-reset',
      headers: { origin },
      payload: { email },
    });
    expect(failure.statusCode).toBe(503);
    expect(failure.json()).toEqual({ code: 'AUTH_UNAVAILABLE' });
    const retry = await app.inject({
      method: 'POST',
      url: '/identity/request-password-reset',
      headers: { origin },
      payload: { email },
    });
    expect(retry.statusCode).toBe(200);
  });

  it('rolls back reset-token consumption, password update and revocation together, then permits one retry', async () => {
    const login = await signIn();
    const header = cookie(login);
    const recovery = await app.inject({
      method: 'POST',
      url: '/identity/request-password-reset',
      headers: { origin },
      payload: { email },
    });
    expect(recovery.statusCode).toBe(200);
    const reset = smtp.link('reset');
    const redirect = await app.inject({ method: 'GET', url: reset.pathname + reset.search });
    expect(redirect.statusCode).toBe(302);
    const target = new URL(String(redirect.headers.location));
    expect(target.origin + target.pathname).toBe(`${origin}/reset-password`);
    const token = target.searchParams.get('token');
    expect(!!token).toBe(true);
    const newPassword = randomBytes(24).toString('base64url');
    const {
      rows: [before],
    } = await owner.query(
      'SELECT password FROM auth.account WHERE user_id = (SELECT id FROM auth."user" WHERE email = $1)',
      [email],
    );
    const {
      rows: [beforeSessions],
    } = await owner.query('SELECT count(*)::int AS count FROM auth.session');
    await owner.query(
      "CREATE FUNCTION auth.fixture_fail_password() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'injected persistence failure'; END $$",
    );
    await owner.query(
      'CREATE TRIGGER fixture_fail_password BEFORE UPDATE OF password ON auth.account FOR EACH ROW EXECUTE FUNCTION auth.fixture_fail_password()',
    );
    try {
      const failure = await app.inject({
        method: 'POST',
        url: '/identity/reset-password',
        headers: { origin },
        payload: { token, newPassword },
      });
      expect(failure.statusCode).toBe(503);
      const {
        rows: [after],
      } = await owner.query(
        'SELECT password FROM auth.account WHERE user_id = (SELECT id FROM auth."user" WHERE email = $1)',
        [email],
      );
      expect(after.password === before.password).toBe(true);
      expect(
        (await owner.query('SELECT count(*)::int AS count FROM auth.session')).rows[0].count,
      ).toBe(beforeSessions.count);
      expect(
        (
          await owner.query(
            'SELECT count(*)::int AS count FROM auth.verification WHERE identifier = $1',
            [`reset-password:${token}`],
          )
        ).rows[0].count,
      ).toBe(1);
    } finally {
      await owner.query('DROP TRIGGER fixture_fail_password ON auth.account');
      await owner.query('DROP FUNCTION auth.fixture_fail_password()');
    }
    const success = await app.inject({
      method: 'POST',
      url: '/identity/reset-password',
      headers: { origin },
      payload: { token, newPassword },
    });
    expect(success.statusCode).toBe(200);
    expect(
      (
        await app.inject({
          method: 'GET',
          url: '/identity/get-session',
          headers: { cookie: header },
        })
      ).json(),
    ).toBe(null);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/identity/reset-password',
          headers: { origin },
          payload: { token, newPassword },
        })
      ).statusCode,
    ).toBe(400);
    expect((await signIn()).statusCode).toBe(401);
    expect((await signIn(email, newPassword)).statusCode).toBe(200);
    // Restore fixture password using another real one-time recovery flow for subsequent SDK checks.
    await owner.query('DELETE FROM auth.rate_limit');
    await app.inject({
      method: 'POST',
      url: '/identity/request-password-reset',
      headers: { origin },
      payload: { email },
    });
    const restore = smtp.link('reset').pathname.split('/').at(-1);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/identity/reset-password',
          headers: { origin },
          payload: { token: restore, newPassword: password },
        })
      ).statusCode,
    ).toBe(200);
  });

  it('keeps the official SDK and signed OAuth continuation working after projection; form token responses retain credentials', async () => {
    const adminLogin = await signIn(adminEmail);
    const config = authority.config;
    if (!config) throw new Error('Missing authority fixture configuration');
    const issued = await manageOAuthClient(
      currentAuth(),
      config,
      new Headers({ cookie: cookie(adminLogin), origin }),
      {
        action: 'issue',
        kind: 'login',
        clientId: 'fixture-sdk-login',
        applicationId: randomUUID(),
      },
    );
    const client = { client_id: issued.record.clientId, client_secret: issued.secret };
    const verifier = randomBytes(32).toString('base64url');
    const params = new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: `${origin}/api/auth/callback`,
      response_type: 'code',
      scope: 'openid profile email',
      resource: userInfoResource(config),
      state: 'sdk-fixture-state',
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    });
    const authorization = await app.inject({
      method: 'GET',
      url: `/identity/oauth2/authorize?${params}`,
    });
    expect(authorization.statusCode).toBe(302);
    const loginPage = new URL(String(authorization.headers.location), origin);
    expect(loginPage.pathname).toBe('/sign-in');
    expect(loginPage.searchParams.has('sig')).toBe(true);
    const tampered = new URLSearchParams(loginPage.search);
    tampered.set('state', 'tampered-state');
    const rejected = await app.inject({
      method: 'POST',
      url: '/identity/sign-in/email',
      headers: { origin },
      payload: { email, password, oauth_query: tampered.toString() },
    });
    expect(rejected.statusCode).toBe(400);
    const jar = new Map<string, string>();
    const sdkFetch: typeof fetch = async (input, init) => {
      const url = new URL(
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url,
      );
      const headers = new Headers(init?.headers);
      headers.set('origin', origin);
      headers.set('cookie', [...jar].map(([key, value]) => `${key}=${value}`).join('; '));
      const result = await app.inject({
        method: (init?.method ?? 'GET') as 'GET' | 'POST',
        url: url.pathname + url.search,
        headers: Object.fromEntries(headers),
        ...(typeof init?.body === 'string' ? { payload: init.body } : {}),
      });
      const responseHeaders = new Headers();
      for (const [key, value] of Object.entries(result.headers))
        for (const item of Array.isArray(value) ? value : [value])
          if (item !== undefined) responseHeaders.append(key, String(item));
      for (const item of responseHeaders.getSetCookie()) {
        const pair = item.split(';')[0] ?? '';
        const separator = pair.indexOf('=');
        jar.set(pair.slice(0, separator), pair.slice(separator + 1));
      }
      return new Response(result.body || null, {
        status: result.statusCode,
        headers: responseHeaders,
      });
    };
    vi.stubGlobal('window', { location: { search: loginPage.search, href: '' } });
    const sdk = createAuthClient({
      baseURL: origin,
      basePath: '/identity',
      plugins: [oauthProviderClient()],
      fetchOptions: { customFetchImpl: sdkFetch },
    });
    const signedIn = await sdk.signIn.email({ email, password });
    expect(signedIn.error).toBe(null);
    if (!signedIn.data?.url) throw new Error('SDK did not return an authorization redirect');
    expect(Object.hasOwn(signedIn.data, 'token')).toBe(false);
    const callback = new URL(signedIn.data.url);
    expect(callback.searchParams.get('state')).toBe('sdk-fixture-state');
    expect(callback.searchParams.has('code')).toBe(true);
    vi.unstubAllGlobals();
    const session = await sdk.getSession();
    expect(session.data?.user.email).toBe(email);
    if (!session.data) throw new Error('SDK did not return the persisted session');
    expect(Object.hasOwn(session.data.session, 'token')).toBe(false);
    const authorizationCode = callback.searchParams.get('code');
    if (!authorizationCode) throw new Error('Authorization code was not returned');
    const form = new URLSearchParams({
      grant_type: 'authorization_code',
      code: authorizationCode,
      redirect_uri: `${origin}/api/auth/callback`,
      code_verifier: verifier,
      resource: userInfoResource(config),
    });
    const token = await app.inject({
      method: 'POST',
      url: '/identity/oauth2/token',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: `Basic ${Buffer.from(`${client.client_id}:${client.client_secret}`).toString('base64')}`,
      },
      payload: form.toString(),
    });
    expect(token.statusCode).toBe(200);
    expect(typeof token.json().access_token).toBe('string');
    expect(typeof token.json().id_token).toBe('string');
    expect(token.headers['cache-control']).toBe('no-store');
    const duplicate = await app.inject({
      method: 'POST',
      url: '/identity/oauth2/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: 'grant_type=client_credentials&grant_type=authorization_code',
    });
    expect(duplicate.statusCode).toBe(400);
    expect(duplicate.json().error).toBe('invalid_request');
  });

  it('preserves one installation and forces transaction-local tenant checks on registrations', async () => {
    await bootstrapInstallation();
    await expect(
      bootstrapInstallation({ ...process.env, INSTALLATION_TENANT_ID: randomUUID() }),
    ).rejects.toThrow('Installation identity cannot be replaced');
    const id = randomUUID();
    const registrationOwner = new Pool({
      connectionString: process.env.DMS_MIGRATION_DATABASE_URL,
    });
    try {
      await withTenant(registrationOwner, tenantId, (connection) =>
        connection.query(
          'INSERT INTO dms.application_registration (id, tenant_id, issuer, client_id, name) VALUES ($1, $2, $3, $4, $5)',
          [id, tenantId, `${origin}/identity`, 'registration-fixture', 'registration fixture'],
        ),
      );
    } finally {
      await registrationOwner.end();
    }
    await withTenant(dms, tenantId, async (connection) => {
      expect(
        (await connection.query('SELECT id FROM dms.application_registration')).rows.length,
      ).toBe(1);
    });
    expect((await dms.query('SELECT id FROM dms.application_registration')).rows).toHaveLength(0);
    await withTenant(dms, randomUUID(), async (connection) => {
      expect(
        (await connection.query('SELECT id FROM dms.application_registration')).rows,
      ).toHaveLength(0);
    });
    await expect(
      withTenant(dms, randomUUID(), (connection) =>
        connection.query(
          'INSERT INTO dms.application_registration (id, tenant_id, issuer, client_id, name) VALUES ($1, $2, $3, $4, $5)',
          [randomUUID(), tenantId, `${origin}/identity`, 'forbidden', 'forbidden'],
        ),
      ),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      dms.query('ALTER TABLE dms.application_registration DISABLE ROW LEVEL SECURITY'),
    ).rejects.toMatchObject({ code: '42501' });
    const authRls = await owner.query(
      "SELECT relrowsecurity FROM pg_class JOIN pg_namespace ON pg_namespace.oid = relnamespace WHERE nspname = 'auth' AND relkind = 'r'",
    );
    expect(authRls.rows.every((row) => !row.relrowsecurity)).toBe(true);
  });
});
