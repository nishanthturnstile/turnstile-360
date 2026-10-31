import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DMS_MACHINE_SCOPES } from '@thaarei/dms-contracts';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { Pool } from 'pg';
import { createApplication } from '../src/bootstrap.js';
import { AuthorityService } from '../src/modules/platform-auth/authority/authority.service.js';
import type { AuthorityConfiguration } from '../src/modules/platform-auth/authority-configuration.js';
import { createAuthority } from '../src/modules/platform-auth/authority-instance.js';
import { manageOAuthClient } from '../src/modules/platform-auth/manage-client.js';
import { LOGIN_SCOPES, userInfoResource } from '../src/modules/platform-auth/oauth-policy.js';
import { provisionUser } from '../src/modules/platform-auth/provision-user.js';
import { createRecoveryDelivery } from '../src/modules/platform-auth/recovery-delivery.js';
import { smtpFixture } from './smtp-fixture.js';

describe('managed OAuth provider and distinct clients', () => {
  let app: NestFastifyApplication;
  let authority: AuthorityService;
  let config: AuthorityConfiguration;
  let smtp: Awaited<ReturnType<typeof smtpFixture>>;
  let operator: Headers;
  let loginSecret: string;
  let machineSecret: string;
  const owner = new Pool({ connectionString: process.env.AUTH_MIGRATION_DATABASE_URL });
  const password = randomBytes(24).toString('base64url');
  const adminEmail = 'oauth-operator@example.test';
  const userEmail = 'oauth-user@example.test';
  const applicationId = randomUUID();

  function auth() {
    if (!authority.auth) throw new Error('Authority fixture unavailable');
    return authority.auth;
  }
  function cookies(headers: Record<string, unknown>) {
    const values = headers['set-cookie'];
    return (Array.isArray(values) ? values : [values])
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.split(';')[0])
      .join('; ');
  }
  async function signIn(email = userEmail) {
    const response = await app.inject({
      method: 'POST',
      url: '/identity/sign-in/email',
      headers: { origin: config.AUTH_PUBLIC_ORIGIN },
      payload: { email, password },
    });
    expect(response.statusCode).toBe(200);
    return cookies(response.headers);
  }
  function basic(
    kind: 'login' | 'machine',
    secret = kind === 'login' ? loginSecret : machineSecret,
  ) {
    const id = kind === 'login' ? config.AUTH_LOGIN_CLIENT_ID : config.DMS_MACHINE_CLIENT_ID;
    return `Basic ${Buffer.from(`${id}:${secret}`).toString('base64')}`;
  }
  function protocol(
    path: string,
    kind: 'login' | 'machine',
    payload: Record<string, string>,
    secret?: string,
  ) {
    return app.inject({
      method: 'POST',
      url: `/identity/oauth2/${path}`,
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        authorization: basic(kind, secret),
      },
      payload: new URLSearchParams(payload).toString(),
    });
  }
  async function authorize(header: string, changes: Record<string, string> = {}) {
    const verifier = randomBytes(32).toString('base64url');
    const query = new URLSearchParams({
      client_id: config.AUTH_LOGIN_CLIENT_ID,
      response_type: 'code',
      redirect_uri: config.AUTH_LOGIN_CALLBACK_URL,
      scope: LOGIN_SCOPES.join(' '),
      resource: userInfoResource(config),
      state: randomBytes(20).toString('base64url'),
      nonce: randomBytes(20).toString('base64url'),
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
      ...changes,
    });
    const response = await app.inject({
      method: 'GET',
      url: `/identity/oauth2/authorize?${query}`,
      headers: { cookie: header },
    });
    return { response, verifier, query };
  }
  async function userTokens(header: string) {
    const { response, verifier, query } = await authorize(header);
    expect(response.statusCode).toBe(302);
    const redirect = new URL(String(response.headers.location));
    expect(redirect.origin + redirect.pathname).toBe(config.AUTH_LOGIN_CALLBACK_URL);
    expect(redirect.searchParams.get('state')).toBe(query.get('state'));
    const code = redirect.searchParams.get('code');
    if (!code) throw new Error('Code missing from approved callback');
    const payload = {
      grant_type: 'authorization_code',
      code,
      code_verifier: verifier,
      redirect_uri: config.AUTH_LOGIN_CALLBACK_URL,
      resource: userInfoResource(config),
    };
    const exchanged = await protocol('token', 'login', payload);
    expect(exchanged.statusCode).toBe(200);
    return { tokens: exchanged.json(), nonce: query.get('nonce'), payload };
  }
  async function machineToken(payload: Record<string, string> = {}, secret?: string) {
    return protocol(
      'token',
      'machine',
      {
        grant_type: 'client_credentials',
        resource: config.DMS_RESOURCE_URL,
        scope: DMS_MACHINE_SCOPES.join(' '),
        ...payload,
      },
      secret,
    );
  }
  async function manage(
    kind: 'login' | 'machine',
    action: string,
    extra: Record<string, unknown> = {},
  ) {
    return manageOAuthClient(auth(), config, operator, { kind, action, ...extra });
  }
  async function keys() {
    const response = await app.inject({ method: 'GET', url: '/identity/jwks' });
    expect(response.statusCode).toBe(200);
    return createLocalJWKSet(response.json());
  }

  beforeAll(async () => {
    smtp = await smtpFixture();
    vi.stubEnv('AUTH_SMTP_PORT', String(smtp.port));
    app = await createApplication(false);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    authority = app.get(AuthorityService);
    if (!authority.config) throw new Error('Missing fixture configuration');
    config = authority.config;
    for (const [email, role] of [
      [adminEmail, 'admin'],
      [userEmail, 'user'],
    ] as const) {
      await provisionUser(auth(), { email, name: role, role, password }, config.AUTH_PUBLIC_ORIGIN);
      const link = smtp.link('verify');
      expect(
        (await app.inject({ method: 'GET', url: link.pathname + link.search })).statusCode,
      ).toBe(302);
    }
    operator = new Headers({ cookie: await signIn(adminEmail), origin: config.AUTH_PUBLIC_ORIGIN });
    const login = await manage('login', 'issue', { applicationId });
    const machine = await manage('machine', 'issue', {
      applicationId,
      scopes: [...DMS_MACHINE_SCOPES],
    });
    if (!login.secret || !machine.secret)
      throw new Error('Managed fixture credentials unavailable');
    loginSecret = login.secret;
    machineSecret = machine.secret;
  });
  beforeEach(async () => {
    await owner.query('DELETE FROM auth.rate_limit');
  });
  afterEach(() => vi.unstubAllGlobals());
  afterAll(async () => {
    await app?.close();
    await smtp?.close();
    await owner.end();
    vi.unstubAllEnvs();
  });

  it('publishes canonical discovery and creates hashed, installation-owned clients', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/identity/.well-known/openid-configuration',
      headers: { host: 'attacker.example', 'x-forwarded-host': 'attacker.example' },
    });
    const metadata = response.json();
    expect(metadata.issuer).toBe(config.AUTH_ISSUER_URL);
    expect(metadata.token_endpoint).toBe(`${config.AUTH_ISSUER_URL}/oauth2/token`);
    expect(metadata.jwks_uri).toBe(`${config.AUTH_ISSUER_URL}/jwks`);
    expect(metadata.code_challenge_methods_supported).toEqual(['S256']);
    const { rows } = await owner.query(
      'SELECT client_id, client_secret, reference_id, metadata, grant_types, client_credentials_scopes FROM auth.oauth_client WHERE client_id = ANY($1::text[])',
      [[config.AUTH_LOGIN_CLIENT_ID, config.DMS_MACHINE_CLIENT_ID]],
    );
    expect(rows.length).toBe(2);
    expect(
      rows.every(
        (row) =>
          row.reference_id === config.INSTALLATION_TENANT_ID &&
          row.client_secret !== loginSecret &&
          row.client_secret !== machineSecret,
      ),
    ).toBe(true);
    const record = await manage('machine', 'inspect');
    expect(record.secret).toBeUndefined();
    expect(JSON.stringify(record.record).includes(machineSecret)).toBe(false);
    expect(record.record.applicationId).toBe(applicationId);
  });

  it('issues distinct RS256 access tokens and binds login identity to the authority session', async () => {
    const header = await signIn();
    const { tokens, nonce } = await userTokens(header);
    const machine = await machineToken();
    expect(machine.statusCode).toBe(200);
    const jwks = await keys();
    const userJwt = await jwtVerify(tokens.access_token, jwks, {
      issuer: config.AUTH_ISSUER_URL,
      audience: userInfoResource(config),
      algorithms: ['RS256'],
      typ: 'at+jwt',
    });
    const machineJwt = await jwtVerify(machine.json().access_token, jwks, {
      issuer: config.AUTH_ISSUER_URL,
      audience: config.DMS_RESOURCE_URL,
      algorithms: ['RS256'],
      typ: 'at+jwt',
    });
    const idJwt = await jwtVerify(tokens.id_token, jwks, {
      issuer: config.AUTH_ISSUER_URL,
      audience: config.AUTH_LOGIN_CLIENT_ID,
      algorithms: ['RS256'],
    });
    expect(userJwt.payload.client_id).toBe(config.AUTH_LOGIN_CLIENT_ID);
    expect(typeof userJwt.payload.sid).toBe('string');
    expect(idJwt.payload.sid).toBe(userJwt.payload.sid);
    expect(idJwt.payload.nonce).toBe(nonce);
    expect(idJwt.payload.sub).toBe(userJwt.payload.sub);
    expect(machineJwt.payload.sub).toBe(config.DMS_MACHINE_CLIENT_ID);
    expect(machineJwt.payload.client_id).toBe(config.DMS_MACHINE_CLIENT_ID);
    expect(machineJwt.payload.sid).toBeUndefined();
    expect(machineJwt.payload.scope).toBe(DMS_MACHINE_SCOPES.join(' '));
    for (const payload of [userJwt.payload, machineJwt.payload])
      expect(Number(payload.exp) - Number(payload.iat)).toBeLessThanOrEqual(300);
    expect(machine.json().refresh_token).toBeUndefined();
    expect(machine.json().id_token).toBeUndefined();
    expect(typeof tokens.refresh_token).toBe('string');
    await expect(
      jwtVerify(tokens.access_token, jwks, { audience: config.DMS_RESOURCE_URL }),
    ).rejects.toThrow();
    await expect(
      jwtVerify(tokens.id_token, jwks, { audience: config.DMS_RESOURCE_URL }),
    ).rejects.toThrow();
  });

  it('rejects crossed grants, scopes, resources and authentication methods', async () => {
    for (const [kind, values] of [
      [
        'login',
        {
          grant_type: 'client_credentials',
          resource: config.DMS_RESOURCE_URL,
          scope: DMS_MACHINE_SCOPES[0],
        },
      ],
      [
        'machine',
        { grant_type: 'authorization_code', resource: config.DMS_RESOURCE_URL, code: 'invalid' },
      ],
      [
        'machine',
        {
          grant_type: 'refresh_token',
          resource: config.DMS_RESOURCE_URL,
          refresh_token: 'invalid',
        },
      ],
      [
        'machine',
        {
          grant_type: 'client_credentials',
          resource: userInfoResource(config),
          scope: DMS_MACHINE_SCOPES[0],
        },
      ],
      [
        'machine',
        { grant_type: 'client_credentials', resource: config.DMS_RESOURCE_URL, scope: 'openid' },
      ],
      [
        'machine',
        {
          grant_type: 'client_credentials',
          resource: config.DMS_RESOURCE_URL,
          scope: 'dms:documents:delete',
        },
      ],
      ['machine', { grant_type: 'client_credentials', scope: DMS_MACHINE_SCOPES[0] }],
    ] as const)
      expect((await protocol('token', kind, values)).statusCode).toBeGreaterThanOrEqual(400);
    const wrongMethod = await app.inject({
      method: 'POST',
      url: '/identity/oauth2/token',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      payload: new URLSearchParams({
        grant_type: 'client_credentials',
        client_id: config.DMS_MACHINE_CLIENT_ID,
        client_secret: machineSecret,
        resource: config.DMS_RESOURCE_URL,
      }).toString(),
    });
    expect(wrongMethod.statusCode).toBeGreaterThanOrEqual(400);
    expect(
      (await machineToken({}, randomBytes(32).toString('base64url'))).statusCode,
    ).toBeGreaterThanOrEqual(400);
  });

  it('requires S256 and exact callback, approved client, user scope and resource', async () => {
    const header = await signIn();
    for (const changes of [
      { code_challenge_method: 'plain' },
      { code_challenge: '' },
      { client_id: 'unapproved-client' },
      { client_id: config.DMS_MACHINE_CLIENT_ID },
      { redirect_uri: `${config.AUTH_LOGIN_CALLBACK_URL}?extra=1` },
      { redirect_uri: config.AUTH_LOGIN_CALLBACK_URL.replace(':5173', ':5174') },
      { resource: config.DMS_RESOURCE_URL },
      { resource: '' },
      { scope: `openid ${DMS_MACHINE_SCOPES[0]}` },
      { prompt: 'consent' },
    ]) {
      const { response } = await authorize(header, changes);
      expect(
        response.statusCode >= 400 ||
          !new URL(String(response.headers.location), config.AUTH_PUBLIC_ORIGIN).searchParams.has(
            'code',
          ),
      ).toBe(true);
    }
    const duplicate = await app.inject({
      method: 'GET',
      url: '/identity/oauth2/authorize?client_id=a&client_id=b',
    });
    expect(duplicate.statusCode).toBe(400);
    const {
      rows: [stored],
    } = await owner.query('SELECT metadata FROM auth.oauth_client WHERE client_id = $1', [
      config.AUTH_LOGIN_CLIENT_ID,
    ]);
    try {
      await owner.query(
        "UPDATE auth.oauth_client SET metadata = '{}'::jsonb WHERE client_id = $1",
        [config.AUTH_LOGIN_CLIENT_ID],
      );
      expect((await authorize(header)).response.statusCode).toBe(400);
    } finally {
      await owner.query('UPDATE auth.oauth_client SET metadata = $2::jsonb WHERE client_id = $1', [
        config.AUTH_LOGIN_CLIENT_ID,
        JSON.stringify(stored.metadata),
      ]);
    }
  });

  it('rejects wrong PKCE verifier and code replay, rotates refresh tokens and denies widening', async () => {
    const header = await signIn();
    const { response } = await authorize(header);
    const code = new URL(String(response.headers.location)).searchParams.get('code');
    if (!code) throw new Error('Code missing');
    const wrong = await protocol('token', 'login', {
      grant_type: 'authorization_code',
      code,
      code_verifier: randomBytes(32).toString('base64url'),
      redirect_uri: config.AUTH_LOGIN_CALLBACK_URL,
      resource: userInfoResource(config),
    });
    expect(wrong.statusCode).toBeGreaterThanOrEqual(400);
    const { payload } = await userTokens(header);
    expect((await protocol('token', 'login', payload)).statusCode).toBeGreaterThanOrEqual(400);
    // Code replay revokes that code's refresh family. Exercise renewal on a fresh grant.
    const { tokens } = await userTokens(header);
    expect(
      (
        await protocol('token', 'login', {
          grant_type: 'refresh_token',
          refresh_token: tokens.refresh_token,
          resource: config.DMS_RESOURCE_URL,
        })
      ).statusCode,
    ).toBeGreaterThanOrEqual(400);
    expect(
      (
        await protocol('token', 'login', {
          grant_type: 'refresh_token',
          refresh_token: tokens.refresh_token,
          resource: userInfoResource(config),
          scope: `openid ${DMS_MACHINE_SCOPES[0]}`,
        })
      ).statusCode,
    ).toBeGreaterThanOrEqual(400);
    const refreshed = await protocol('token', 'login', {
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      resource: userInfoResource(config),
    });
    expect(
      refreshed.statusCode,
      refreshed.statusCode >= 400 ? refreshed.json().error_description : '',
    ).toBe(200);
    expect(refreshed.json().refresh_token !== tokens.refresh_token).toBe(true);
    expect(
      (
        await protocol('token', 'login', {
          grant_type: 'refresh_token',
          refresh_token: tokens.refresh_token,
          resource: userInfoResource(config),
        })
      ).statusCode,
    ).toBeGreaterThanOrEqual(400);
  });

  it('makes user tokens inactive after logout and prevents refresh from recreating a live session', async () => {
    const header = await signIn();
    const { tokens } = await userTokens(header);
    expect(
      (await protocol('introspect', 'login', { token: tokens.access_token })).json().active,
    ).toBe(true);
    await app.inject({
      method: 'POST',
      url: '/identity/sign-out',
      headers: { origin: config.AUTH_PUBLIC_ORIGIN, cookie: header },
      payload: {},
    });
    expect(
      (await protocol('introspect', 'login', { token: tokens.access_token })).json().active,
    ).toBe(false);
    expect(
      (
        await protocol('token', 'login', {
          grant_type: 'refresh_token',
          refresh_token: tokens.refresh_token,
          resource: userInfoResource(config),
        })
      ).statusCode,
    ).toBeGreaterThanOrEqual(400);
    expect((await machineToken()).statusCode).toBe(200);
  });

  it('denies user and public client/resource administration, including secret rotation and scope escalation', async () => {
    const header = await signIn();
    const headers = new Headers({ cookie: header, origin: config.AUTH_PUBLIC_ORIGIN });
    for (const action of ['issue', 'rotate', 'suspend', 'resume', 'set-scopes'])
      await expect(
        manageOAuthClient(auth(), config, headers, {
          action,
          kind: 'machine',
          ...(action === 'issue'
            ? { applicationId, scopes: [...DMS_MACHINE_SCOPES] }
            : action === 'set-scopes'
              ? { scopes: [...DMS_MACHINE_SCOPES] }
              : {}),
        }),
      ).rejects.toThrow();
    await expect(
      auth().api.createOAuthClient({
        headers,
        body: {
          client_name: 'unapproved',
          grant_types: ['client_credentials'],
          scope: DMS_MACHINE_SCOPES[0],
        },
      }),
    ).rejects.toThrow();
    await expect(
      auth().api.adminUpdateOAuthClient({
        headers,
        body: {
          client_id: config.DMS_MACHINE_CLIENT_ID,
          update: { client_credentials_scopes: [...DMS_MACHINE_SCOPES] },
        },
      }),
    ).rejects.toThrow();
    await expect(
      auth().api.rotateClientSecret({ headers, body: { client_id: config.DMS_MACHINE_CLIENT_ID } }),
    ).rejects.toThrow();
    await expect(
      auth().api.adminCreateOAuthResource({
        headers,
        body: { identifier: 'https://attacker.example/api' },
      }),
    ).rejects.toThrow();
    await expect(
      auth().api.rotateClientSecret({
        headers: operator,
        body: { client_id: config.DMS_MACHINE_CLIENT_ID },
      }),
    ).rejects.toThrow();
    for (const cookie of [header, operator.get('cookie') as string])
      for (const path of [
        '/oauth2/register',
        '/oauth2/create-client',
        '/oauth2/update-client',
        '/oauth2/client/rotate-secret',
        '/admin/oauth2/create-client',
        '/admin/oauth2/update-client',
        '/admin/oauth2/resources',
        '/oauth2/consent',
        '/token',
      ])
        expect(
          (
            await app.inject({
              method: 'POST',
              url: `/identity${path}`,
              headers: { cookie, origin: config.AUTH_PUBLIC_ORIGIN },
              payload: {},
            })
          ).statusCode,
        ).toBe(404);
  });

  it('rotates machine credentials immediately, preserves application identity, and suspends/resumes issuance', async () => {
    const before = await machineToken();
    const oldSecret = machineSecret;
    const rotated = await manage('machine', 'rotate');
    if (!rotated.secret) throw new Error('Rotation credential missing');
    machineSecret = rotated.secret;
    expect(rotated.record.clientId).toBe(config.DMS_MACHINE_CLIENT_ID);
    expect(rotated.record.applicationId).toBe(applicationId);
    expect((await machineToken({}, oldSecret)).statusCode).toBeGreaterThanOrEqual(400);
    expect((await machineToken()).statusCode).toBe(200);
    // Rotation does not retract an already signed JWT.
    await jwtVerify(before.json().access_token, await keys(), {
      issuer: config.AUTH_ISSUER_URL,
      audience: config.DMS_RESOURCE_URL,
      algorithms: ['RS256'],
      typ: 'at+jwt',
    });
    await manage('machine', 'suspend');
    expect((await machineToken()).statusCode).toBeGreaterThanOrEqual(400);
    await manage('machine', 'resume');
    expect((await machineToken()).statusCode).toBe(200);
    expect(
      (await manage('machine', 'set-scopes', { scopes: [...DMS_MACHINE_SCOPES] })).record.scopes,
    ).toEqual([...DMS_MACHINE_SCOPES]);
    await expect(manage('machine', 'set-scopes', { scopes: ['openid'] })).rejects.toThrow();
    await expect(
      manage('machine', 'rotate', { kind: 'login', clientId: config.DMS_MACHINE_CLIENT_ID }),
    ).rejects.toThrow();
    const header = await signIn();
    const { tokens } = await userTokens(header);
    const oldLoginSecret = loginSecret;
    const loginRotation = await manage('login', 'rotate');
    if (!loginRotation.secret) throw new Error('Login rotation credential missing');
    loginSecret = loginRotation.secret;
    const renewal = {
      grant_type: 'refresh_token',
      refresh_token: tokens.refresh_token,
      resource: userInfoResource(config),
    };
    expect(
      (await protocol('token', 'login', renewal, oldLoginSecret)).statusCode,
    ).toBeGreaterThanOrEqual(400);
    expect((await protocol('token', 'login', renewal)).statusCode).toBe(200);
    expect(loginRotation.record.applicationId).toBe(applicationId);
    expect((await machineToken()).statusCode).toBe(200);
  });

  it('accepts exact POST logout destinations and never redirects to modified or unregistered destinations', async () => {
    // The provider fetches its canonical public JWKS for an ID-token hint. Route that
    // network boundary to the actual native handler; never contact an existing dev server.
    vi.stubGlobal('fetch', async (input: string | URL | Request) => {
      const url = input instanceof Request ? input.url : String(input);
      if (url !== `${config.AUTH_ISSUER_URL}/jwks`) throw new Error('Unexpected fixture fetch');
      const response = await app.inject({ method: 'GET', url: '/identity/jwks' });
      return new Response(response.body, {
        status: response.statusCode,
        headers: { 'content-type': 'application/json' },
      });
    });
    for (const destination of [
      'https://attacker.example/sign-in',
      `${config.AUTH_PUBLIC_ORIGIN}/sign-in?extra=1`,
      `${config.AUTH_PUBLIC_ORIGIN}/sign-in`,
    ]) {
      const header = await signIn();
      const { tokens } = await userTokens(header);
      const response = await app.inject({
        method: 'POST',
        url: '/identity/oauth2/end-session',
        headers: {
          origin: config.AUTH_PUBLIC_ORIGIN,
          cookie: header,
          'content-type': 'application/x-www-form-urlencoded',
        },
        payload: new URLSearchParams({
          id_token_hint: tokens.id_token,
          client_id: config.AUTH_LOGIN_CLIENT_ID,
          post_logout_redirect_uri: destination,
          state: 'fixture-logout',
        }).toString(),
      });
      const location = response.headers.location;
      const body =
        response.body && response.headers['content-type']?.includes('application/json')
          ? (response.json() ?? {})
          : {};
      if (destination === `${config.AUTH_PUBLIC_ORIGIN}/sign-in`) {
        expect(
          response.statusCode < 400,
          body.error_description ?? body.message ?? `logout status ${response.statusCode}`,
        ).toBe(true);
        const returned = String(location ?? body.url ?? body.redirect_uri ?? '');
        expect(returned.startsWith(destination)).toBe(true);
        expect(
          (await protocol('introspect', 'login', { token: tokens.access_token })).json().active,
        ).toBe(false);
      } else {
        expect(
          String(location ?? body.url ?? body.redirect_uri ?? '').startsWith(destination),
        ).toBe(false);
      }
    }
    expect(
      (await app.inject({ method: 'GET', url: '/identity/oauth2/end-session' })).statusCode,
    ).toBe(404);
  });

  it('retains client credentials, sessions and token verification through authority restart', async () => {
    const header = await signIn();
    const { tokens } = await userTokens(header);
    const issued = await machineToken();
    const first = await app.inject({ method: 'GET', url: '/identity/jwks' });
    await app.close();
    app = await createApplication(false);
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    authority = app.get(AuthorityService);
    expect((await app.inject({ method: 'GET', url: '/identity/jwks' })).json()).toEqual(
      first.json(),
    );
    await jwtVerify(issued.json().access_token, await keys(), {
      issuer: config.AUTH_ISSUER_URL,
      audience: config.DMS_RESOURCE_URL,
      algorithms: ['RS256'],
      typ: 'at+jwt',
    });
    expect(
      (await protocol('introspect', 'login', { token: tokens.access_token })).json().active,
    ).toBe(true);
    expect((await machineToken()).statusCode).toBe(200);
    expect((await manage('machine', 'inspect')).record.applicationId).toBe(applicationId);
  });

  it('creates production HTTPS web metadata through the same supported operator API', async () => {
    const production: AuthorityConfiguration = {
      ...config,
      AUTH_PROFILE: 'production',
      AUTH_SMTP_MODE: 'starttls',
      AUTH_PUBLIC_ORIGIN: 'https://platform.customer.example',
      AUTH_ISSUER_URL: 'https://platform.customer.example/identity',
      AUTH_LOGIN_CALLBACK_URL: 'https://platform.customer.example/api/auth/callback',
      DMS_RESOURCE_URL: 'https://dms.customer.example/v1',
    };
    const pool = new Pool({ connectionString: config.AUTH_DATABASE_URL });
    try {
      const productionAuth = createAuthority(production, pool, createRecoveryDelivery(production));
      const login = await productionAuth.api.signInEmail({
        body: { email: adminEmail, password },
        returnHeaders: true,
      });
      const headers = new Headers({
        origin: production.AUTH_PUBLIC_ORIGIN,
        cookie: login.headers
          .getSetCookie()
          .map((value) => value.split(';')[0])
          .join('; '),
      });
      const issued = await manageOAuthClient(productionAuth, production, headers, {
        action: 'issue',
        kind: 'login',
        clientId: 'fixture-production-login',
        applicationId,
      });
      const client = await (await productionAuth.$context).adapter.findOne<{
        applicationType: string;
        redirectUris: string[];
      }>({ model: 'oauthClient', where: [{ field: 'clientId', value: issued.record.clientId }] });
      expect(client?.applicationType).toBe('web');
      expect(client?.redirectUris).toEqual([production.AUTH_LOGIN_CALLBACK_URL]);
      await productionAuth.api.signOut({ headers });
    } finally {
      await pool.end();
    }
  });

  it('runs the compiled private command without printing credentials and refuses an existing output file before rotation', async () => {
    const folder = await mkdtemp(join(tmpdir(), 'thaarei-oauth-'));
    const output = join(folder, 'credential.json');
    function command(credentialFile: string) {
      return new Promise<{ code: number | null; stdout: string; stderr: string }>(
        (resolve, reject) => {
          const child = spawn(process.execPath, ['dist/modules/platform-auth/manage-client.js'], {
            env: { ...process.env, AUTH_SMTP_PORT: String(smtp.port) },
            stdio: ['pipe', 'pipe', 'pipe'],
          });
          let stdout = '';
          let stderr = '';
          child.stdout.on('data', (chunk) => {
            stdout += chunk;
          });
          child.stderr.on('data', (chunk) => {
            stderr += chunk;
          });
          child.once('error', reject);
          child.once('exit', (code) => resolve({ code, stdout, stderr }));
          child.stdin.end(
            JSON.stringify({
              action: 'rotate',
              kind: 'machine',
              operatorEmail: adminEmail,
              operatorPassword: password,
              credentialFile,
            }),
          );
        },
      );
    }
    try {
      const first = await command(output);
      expect(first.code).toBe(0);
      const credential = JSON.parse(await readFile(output, 'utf8'));
      machineSecret = credential.clientSecret;
      expect((await stat(output)).mode & 0o777).toBe(0o600);
      expect(JSON.parse(first.stdout).applicationId).toBe(applicationId);
      expect((first.stdout + first.stderr).includes(credential.clientSecret)).toBe(false);
      expect((first.stdout + first.stderr).includes(password)).toBe(false);
      expect((await command(output)).code).not.toBe(0);
      expect((await machineToken()).statusCode).toBe(200);
    } finally {
      await rm(folder, { recursive: true, force: true });
    }
  });
});
