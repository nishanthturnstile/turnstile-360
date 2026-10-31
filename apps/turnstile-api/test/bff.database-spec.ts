import { type ChildProcess, fork, spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer, request as httpRequest, type IncomingMessage } from 'node:http';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { TURNSTILE_PERMISSIONS } from '@thaarei/turnstile-contracts';
import Fastify, { type FastifyRequest } from 'fastify';
import { Pool } from 'pg';
import { createApplication } from '../src/bootstrap.js';
import { parseProductEnvironment } from '../src/infrastructure/auth-environment.js';
import { withTenant } from '../src/infrastructure/database/postgres.js';
import type { BffState } from '../src/modules/auth/browser-auth/bff-state.js';
import { registerProductSession } from '../src/modules/auth/browser-auth/session-plugin.js';
import { ProductDatabaseService } from '../src/modules/auth/product-database/product-database.service.js';
import { setUserAccess } from '../src/modules/auth/set-user-access.js';

interface Fixture {
  ready: true;
  port: number;
  password: string;
  loginSecret: string;
  machineSecret: string;
  users: Record<'operator' | 'member' | 'reset' | 'suspended', { id: string; email: string }>;
}
type HttpResult = Awaited<ReturnType<NestFastifyApplication['inject']>>;

describe('Turnstile BFF with real authority HTTP and persisted sessions', () => {
  let app: NestFastifyApplication;
  let second: NestFastifyApplication | undefined;
  let child: ChildProcess;
  let fixture: Fixture;
  let origin: string;
  let target = 0;
  let fault:
    | 'none'
    | 'introspection'
    | 'introspection-mismatch'
    | 'logout'
    | 'refresh-drop'
    | 'refresh-block'
    | 'dms'
    | 'machine-token'
    | 'all' = 'none';
  let mismatch = 'sub';
  let releaseRefresh: (() => void) | undefined;
  let refreshEntered: (() => void) | undefined;
  let blockNextIntrospection = false;
  let introspectionEntered: (() => void) | undefined;
  let releaseIntrospection: (() => void) | undefined;
  let refreshCalls = 0;
  let machineCalls = 0;
  let dmsCalls = 0;
  let actor:
    | {
        id: string | undefined;
        requestId: string | undefined;
        cookie: boolean;
        tenant: boolean;
        bearer: boolean;
      }
    | undefined;
  const protocolStatus: Record<string, { status: number; error?: string }> = {};
  const owner = new Pool({ connectionString: process.env.TURNSTILE_MIGRATION_DATABASE_URL });
  const tenant = process.env.INSTALLATION_TENANT_ID as string;
  const proxy = createServer(async (request, response) => {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const body = Buffer.concat(chunks).toString();
      const machine =
        request.url?.endsWith('/token') && body.includes('grant_type=client_credentials');
      if (machine) machineCalls++;
      if (request.url === '/v1/capabilities') {
        dmsCalls++;
        actor = {
          id: request.headers['x-thaarei-actor-id'] as string | undefined,
          requestId: request.headers['x-thaarei-request-id'] as string | undefined,
          cookie: request.headers.cookie !== undefined,
          tenant: request.headers['x-tenant-id'] !== undefined,
          bearer:
            request.headers.authorization?.startsWith('Bearer ') === true &&
            request.headers.authorization !== 'Bearer browser-spoof',
        };
      }
      if (
        fault === 'all' ||
        (fault === 'dms' && request.url?.startsWith('/v1/')) ||
        (fault === 'machine-token' && machine) ||
        (fault === 'introspection' && request.url?.endsWith('/introspect')) ||
        (fault === 'logout' && /\/(revoke|end-session|sign-out)$/.test(request.url ?? ''))
      ) {
        response.writeHead(503, { 'content-type': 'application/json' }).end('{}');
        return;
      }
      const refresh = request.url?.endsWith('/token') && body.includes('grant_type=refresh_token');
      if (refresh) {
        refreshCalls++;
      }
      const upstream = await new Promise<IncomingMessage>((resolve, reject) => {
        const outgoing = httpRequest(
          `http://127.0.0.1:${target}${request.url}`,
          {
            method: request.method ?? 'GET',
            headers: {
              accept: request.headers.accept ?? '*/*',
              'sec-fetch-mode': (request.headers['sec-fetch-mode'] as string) ?? 'cors',
              ...(request.headers['content-type']
                ? { 'content-type': request.headers['content-type'] }
                : {}),
              ...(request.headers.authorization
                ? { authorization: request.headers.authorization }
                : {}),
              ...(request.headers.cookie ? { cookie: request.headers.cookie } : {}),
              ...(request.headers.origin ? { origin: request.headers.origin } : {}),
              ...(request.headers['x-thaarei-actor-id']
                ? { 'x-thaarei-actor-id': request.headers['x-thaarei-actor-id'] }
                : {}),
              ...(request.headers['x-thaarei-request-id']
                ? { 'x-thaarei-request-id': request.headers['x-thaarei-request-id'] }
                : {}),
            },
          },
          resolve,
        );
        outgoing.once('error', reject);
        outgoing.end(body || undefined);
      });
      const received: Buffer[] = [];
      for await (const chunk of upstream) received.push(Buffer.from(chunk));
      if (request.url?.endsWith('/introspect') && blockNextIntrospection) {
        blockNextIntrospection = false;
        introspectionEntered?.();
        await new Promise<void>((resolve) => {
          releaseIntrospection = resolve;
        });
      }
      if (refresh && fault === 'refresh-block') {
        refreshEntered?.();
        await new Promise<void>((resolve) => {
          releaseRefresh = resolve;
        });
      }
      if (fault === 'introspection-mismatch' && request.url?.endsWith('/introspect')) {
        const value = JSON.parse(Buffer.concat(received).toString());
        value[mismatch] = 'unrelated';
        response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(value));
        return;
      }
      if (/\/(revoke|end-session|sign-out)$/.test(request.url ?? '')) {
        const status: { status: number; error?: string } = { status: upstream.statusCode ?? 0 };
        try {
          const data = JSON.parse(Buffer.concat(received).toString());
          const code = data?.error ?? data?.code;
          if (typeof code === 'string' && /^[A-Za-z_]+$/.test(code)) status.error = code;
        } catch {
          /* No response credentials are retained in diagnostics. */
        }
        protocolStatus[request.url as string] = status;
      }
      if (refresh && fault === 'refresh-drop') {
        request.socket.destroy();
        return;
      }
      response.writeHead(upstream.statusCode ?? 503, upstream.headers);
      response.end(Buffer.concat(received));
    } catch {
      response.writeHead(503).end();
    }
  });

  function setCookies(response: HttpResult) {
    const header = response.headers['set-cookie'];
    return Array.isArray(header) ? header : typeof header === 'string' ? [header] : [];
  }
  function cookieOf(response: HttpResult, name = 'turnstile') {
    return (
      setCookies(response)
        .find((cookie) => cookie.startsWith(`${name}=`))
        ?.split(';')[0] ?? ''
    );
  }
  async function command(action: string) {
    const requestId = Math.random().toString();
    const result = new Promise<void>((resolve, reject) => {
      const listener = (message: { requestId?: string; ok?: boolean }) => {
        if (message.requestId !== requestId) return;
        child.off('message', listener);
        message.ok ? resolve() : reject(new Error('Private fixture operation failed'));
      };
      child.on('message', listener);
    });
    child.send({ action, requestId });
    await result;
  }
  async function start() {
    const instance = await createApplication(false);
    await instance.init();
    await instance.getHttpAdapter().getInstance().ready();
    return instance;
  }
  async function grant(
    label: keyof Fixture['users'],
    enabled = true,
    permissions: string[] = ['turnstile:access'],
  ) {
    return setUserAccess({ userId: fixture.users[label].id, enabled, permissions });
  }
  async function authorityLogin(label: keyof Fixture['users'] = 'member') {
    await command('clear-rate-limits');
    const response = await fetch(`${origin}/identity/sign-in/email`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ email: fixture.users[label].email, password: fixture.password }),
    });
    expect(response.status).toBe(200);
    return response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0])
      .join('; ');
  }
  async function begin(authorityCookie: string) {
    const login = await app.inject({ method: 'GET', url: '/api/auth/login?returnTo=/work' });
    expect(login.statusCode).toBe(302);
    const location = String(login.headers.location);
    const authorize = await new Promise<IncomingMessage>((resolve, reject) => {
      const navigation = httpRequest(
        location,
        { headers: { cookie: authorityCookie, accept: 'text/html', 'sec-fetch-mode': 'navigate' } },
        resolve,
      );
      navigation.once('error', reject);
      navigation.end();
    });
    authorize.resume();
    expect(authorize.statusCode).toBe(302);
    const callback = new URL(authorize.headers.location as string);
    expect(callback.pathname).toBe('/api/auth/callback');
    expect(callback.searchParams.has('code')).toBe(true);
    return { callback, cookie: cookieOf(login), location };
  }
  async function login(label: keyof Fixture['users'] = 'member') {
    const authority = await authorityLogin(label);
    const pending = await begin(authority);
    const response = await app.inject({
      method: 'GET',
      url: pending.callback.pathname + pending.callback.search,
      headers: { cookie: `${pending.cookie}; ${authority}` },
    });
    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('/work');
    const cookie = cookieOf(response);
    expect(cookie).not.toBe(pending.cookie);
    const session = await app.inject({
      method: 'GET',
      url: '/api/auth/session',
      headers: { cookie },
    });
    expect(session.statusCode).toBe(200);
    return { cookie, authority, csrf: session.json().csrfToken as string, session: session.json() };
  }
  function session(cookie: string, instance = app) {
    return instance.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie } });
  }
  function logout(cookie: string, csrf: string, authority = '') {
    return app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: {
        cookie: `${cookie}; ${authority}`,
        origin,
        'x-csrf-token': csrf,
        'sec-fetch-site': 'same-origin',
      },
      payload: {},
    });
  }
  async function edit<T>(cookie: string, change: (state: BffState) => T) {
    const request = { protocol: 'http' } as FastifyRequest;
    await new Promise<void>((resolve, reject) =>
      app
        .getHttpAdapter()
        .getInstance()
        .decryptSession(
          decodeURIComponent(cookie.slice(cookie.indexOf('=') + 1)),
          request,
          (error?: Error) => (error ? reject(error) : resolve()),
        ),
    );
    const store = app.get(ProductDatabaseService).store;
    if (!store) throw new Error('Session store unavailable');
    return store.atomic(request.session.sessionStoreId, request.session.sessionId, (record) => {
      if (!record.bff) throw new Error('Expected BFF state');
      return change(record.bff);
    });
  }

  beforeAll(async () => {
    await new Promise<void>((resolve) => proxy.listen(0, '127.0.0.1', resolve));
    const address = proxy.address();
    if (!address || typeof address === 'string') throw new Error('Proxy did not listen');
    origin = `http://127.0.0.1:${address.port}`;
    vi.stubEnv('AUTH_PUBLIC_ORIGIN', origin);
    vi.stubEnv('AUTH_ISSUER_URL', `${origin}/identity`);
    vi.stubEnv('AUTH_LOGIN_CALLBACK_URL', `${origin}/api/auth/callback`);
    vi.stubEnv('AUTH_LOGIN_CLIENT_ID', 'bff-fixture-login');
    vi.stubEnv('DMS_MACHINE_CLIENT_ID', 'bff-fixture-machine');
    vi.stubEnv('DMS_RESOURCE_URL', `${origin}/v1`);
    vi.stubEnv('DMS_API_URL', `${origin}/v1`);
    child = fork(
      fileURLToPath(new URL('../../dms-api/test/bff-authority-fixture.mjs', import.meta.url)),
      [],
      {
        env: process.env,
        stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
      },
    );
    const ready = new Promise<Fixture>((resolve, reject) => {
      child.on('message', (message: Fixture) => {
        if (message.ready) resolve(message);
      });
      child.once('exit', (code) => reject(new Error(`Authority fixture exited (${code})`)));
      child.stderr?.on('data', () => {});
    });
    fixture = await ready;
    target = fixture.port;
    vi.stubEnv('AUTH_LOGIN_CLIENT_SECRET', fixture.loginSecret);
    vi.stubEnv('DMS_MACHINE_CLIENT_SECRET', fixture.machineSecret);
    await command('enroll-machine');
    app = await start();
    await grant('member');
    await grant('reset');
    await grant('suspended');
  });
  beforeEach(async () => {
    fault = 'none';
    await command('clear-rate-limits');
  });
  afterEach(() => {
    fault = 'none';
    blockNextIntrospection = false;
    releaseIntrospection?.();
    releaseIntrospection = undefined;
    introspectionEntered = undefined;
    releaseRefresh?.();
    releaseRefresh = undefined;
    refreshEntered = undefined;
  });
  afterAll(async () => {
    await second?.close();
    await app?.close();
    if (child && child.exitCode === null) {
      child.kill('SIGTERM');
      await Promise.race([
        once(child, 'exit'),
        delay(5000, undefined, { ref: false }).then(() => {
          if (child.exitCode === null) child.kill('SIGKILL');
        }),
      ]);
    }
    proxy.closeAllConnections();
    await new Promise<void>((resolve) => proxy.close(() => resolve()));
    if (fixture)
      await withTenant(owner, tenant, (connection) =>
        connection.query('DELETE FROM turnstile.user_access WHERE user_id = ANY($1::text[])', [
          Object.values(fixture.users).map((user) => user.id),
        ]),
      );
    await owner.end();
    vi.unstubAllEnvs();
  });

  it('completes PKCE/OIDC login, regenerates its cookie and survives API restart without browser tokens', async () => {
    const signed = await login();
    expect(Object.keys(signed.session).sort()).toEqual([
      'csrfToken',
      'permissions',
      'session',
      'user',
    ]);
    expect(signed.session.user.id).toBe(fixture.users.member.id);
    expect(signed.session.permissions).toEqual(['turnstile:access']);
    expect(Date.parse(signed.session.session.idleExpiresAt) - Date.now()).toBeLessThanOrEqual(
      1800000,
    );
    expect(Date.parse(signed.session.session.expiresAt) - Date.now()).toBeLessThanOrEqual(28800000);
    await app.close();
    app = await start();
    const restored = await session(signed.cookie);
    expect(restored.statusCode).toBe(200);
    expect(restored.json().user).toEqual(signed.session.user);
    const sensitive = await edit(signed.cookie, (state) =>
      state.kind === 'user' ? state.identity : undefined,
    );
    if (!sensitive) throw new Error('Missing identity');
    for (const value of [
      sensitive.accessToken,
      sensitive.refreshToken,
      sensitive.idToken,
      fixture.loginSecret,
      fixture.password,
      process.env.DMS_MACHINE_CLIENT_SECRET as string,
    ]) {
      expect(restored.body.includes(value)).toBe(false);
    }
    const { rows } = await withTenant(owner, tenant, (connection) =>
      connection.query('SELECT ciphertext FROM turnstile.session'),
    );
    expect(rows.every((row) => !row.ciphertext.includes(sensitive.refreshToken))).toBe(true);
    expect((await app.inject({ method: 'GET', url: '/health/ready/auth' })).statusCode).toBe(200);
  });

  it('runs private access assignment through the compiled command and refuses runtime credentials or unknown permissions', async () => {
    async function invoke(input: unknown, environment = process.env) {
      const command = spawn(
        process.execPath,
        [fileURLToPath(new URL('../dist/modules/auth/set-user-access.js', import.meta.url))],
        { env: environment, stdio: ['pipe', 'pipe', 'pipe'], timeout: 6000 },
      );
      let output = '';
      let errors = '';
      command.stdout.on('data', (chunk) => {
        output += chunk.toString();
      });
      command.stderr.on('data', (chunk) => {
        errors += chunk.toString();
      });
      command.stdin.end(JSON.stringify(input));
      const [code] = await once(command, 'close');
      return { code, output, errors };
    }
    const input = {
      userId: fixture.users.member.id,
      enabled: true,
      permissions: ['turnstile:access'],
    };
    const assigned = await invoke(input);
    expect(assigned.code).toBe(0);
    expect(JSON.parse(assigned.output)).toMatchObject({ action: 'set-user-access', ...input });
    const rejected = await invoke({ ...input, permissions: ['business:admin'] });
    expect(rejected.code).toBe(1);
    const runtime = await invoke(input, {
      ...process.env,
      TURNSTILE_MIGRATION_DATABASE_URL: process.env.TURNSTILE_DATABASE_URL,
    });
    expect(runtime.code).toBe(1);
    expect(runtime.output).toBe('');
    expect(runtime.errors.includes(process.env.TURNSTILE_DATABASE_URL as string)).toBe(false);
  });

  it('binds callbacks to the original browser, state, issuer and one-time transaction', async () => {
    const authority = await authorityLogin();
    const pending = await begin(authority);
    const url = pending.callback.pathname + pending.callback.search;
    expect(
      (await app.inject({ method: 'GET', url, headers: { cookie: authority } })).statusCode,
    ).toBe(400);
    const wrongState = new URL(pending.callback);
    wrongState.searchParams.set('state', 'wrong');
    expect(
      (
        await app.inject({
          method: 'GET',
          url: wrongState.pathname + wrongState.search,
          headers: { cookie: `${pending.cookie}; ${authority}` },
        })
      ).statusCode,
    ).toBe(400);
    const attempts = await Promise.all(
      [0, 1].map(() =>
        app.inject({ method: 'GET', url, headers: { cookie: `${pending.cookie}; ${authority}` } }),
      ),
    );
    expect(attempts.map((value) => value.statusCode).sort()).toEqual([302, 400]);
    expect(
      (
        await app.inject({
          method: 'GET',
          url,
          headers: { cookie: `${pending.cookie}; ${authority}` },
        })
      ).statusCode,
    ).toBe(400);
    const issuer = await begin(authority);
    issuer.callback.searchParams.set('iss', 'https://attacker.test/identity');
    expect(
      (
        await app.inject({
          method: 'GET',
          url: issuer.callback.pathname + issuer.callback.search,
          headers: { cookie: `${issuer.cookie}; ${authority}` },
        })
      ).statusCode,
    ).toBe(400);
  });

  it('rejects open redirects, duplicate parameters, expired transactions and forged PKCE/nonce', async () => {
    for (const value of [
      'https://attacker.test',
      '//attacker.test',
      '/%2fevil',
      '/api/auth/logout',
      '/identity',
    ]) {
      const response = await app.inject({
        method: 'GET',
        url: `/api/auth/login?returnTo=${encodeURIComponent(value)}`,
      });
      expect(response.statusCode).toBe(400);
    }
    expect(
      (await app.inject({ method: 'GET', url: '/api/auth/login?returnTo=/&returnTo=/work' }))
        .statusCode,
    ).toBe(400);
    for (const mode of ['expired', 'nonce', 'pkce']) {
      const authority = await authorityLogin();
      const pending = await begin(authority);
      await edit(pending.cookie, (state) => {
        if (state.kind !== 'login') throw new Error('Expected transaction');
        if (mode === 'expired') state.expiresAt = 1;
        if (mode === 'nonce') state.nonce = 'wrong-nonce';
        if (mode === 'pkce') state.verifier = 'a'.repeat(43);
      });
      const response = await app.inject({
        method: 'GET',
        url: pending.callback.pathname + pending.callback.search,
        headers: { cookie: `${pending.cookie}; ${authority}` },
      });
      expect([400, 401]).toContain(response.statusCode);
    }
  });

  it('denies unprovisioned administrators, empty local permissions and disabled access', async () => {
    for (const [label, permissions] of [
      ['operator', undefined],
      ['member', []],
    ] as const) {
      if (permissions) await grant('member', true, []);
      const authority = await authorityLogin(label);
      const pending = await begin(authority);
      const response = await app.inject({
        method: 'GET',
        url: pending.callback.pathname + pending.callback.search,
        headers: { cookie: `${pending.cookie}; ${authority}` },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json().code).toBe('PRODUCT_ACCESS_DENIED');
    }
    await grant('member');
    const signed = await login();
    await grant('member', false);
    expect((await session(signed.cookie)).statusCode).toBe(403);
    await grant('member');
    expect((await session(signed.cookie)).statusCode).toBe(401);
    await expect(grant('member', true, ['business:admin'])).rejects.toThrow();
  });

  it('fails closed on introspection outage without destroying a retryable session; checks parent logout immediately', async () => {
    const signed = await login();
    fault = 'introspection';
    const outage = await session(signed.cookie);
    expect(outage.statusCode).toBe(503);
    expect(outage.json()).toEqual({ code: 'AUTH_UNAVAILABLE' });
    fault = 'none';
    expect((await session(signed.cookie)).statusCode).toBe(200);
    const ended = await fetch(`${origin}/identity/sign-out`, {
      method: 'POST',
      headers: { origin, cookie: signed.authority, 'content-type': 'application/json' },
      body: '{}',
    });
    expect(ended.status).toBe(200);
    expect((await session(signed.cookie)).statusCode).toBe(401);
  });

  it('observes authority password reset and account suspension on the next protected request', async () => {
    const reset = await login('reset');
    await command('reset');
    expect((await session(reset.cookie)).statusCode).toBe(401);
    const suspended = await login('suspended');
    await command('ban');
    expect((await session(suspended.cookie)).statusCode).toBe(401);
  });

  it('requires matching introspection issuer, subject, parent, client and audience, and rejects bearer/cookie substitution', async () => {
    for (const field of ['iss', 'sub', 'sid', 'client_id', 'aud']) {
      const signed = await login();
      fault = 'introspection-mismatch';
      mismatch = field;
      expect((await session(signed.cookie)).statusCode).toBe(401);
      fault = 'none';
      expect((await session(signed.cookie)).statusCode).toBe(401);
    }
    const signed = await login();
    const identity = await edit(signed.cookie, (state) =>
      state.kind === 'user' ? state.identity : undefined,
    );
    if (!identity) throw new Error('Expected user identity');
    for (const token of [
      identity.idToken,
      identity.accessToken,
      process.env.DMS_MACHINE_CLIENT_SECRET as string,
    ]) {
      expect(
        (
          await app.inject({
            method: 'GET',
            url: '/api/auth/session',
            headers: { authorization: `Bearer ${token}` },
          })
        ).statusCode,
      ).toBe(401);
    }
    expect((await session(signed.authority)).statusCode).toBe(401);
  });

  it('preserves the cookie and liveness when session loading fails before the Nest handler', async () => {
    const signed = await login();
    const store = app.get(ProductDatabaseService).store;
    if (!store) throw new Error('Missing store');
    const failing = vi
      .spyOn(store, 'get')
      .mockImplementation((_id, callback) => callback(new Error('Fixture storage outage')));
    try {
      const response = await session(signed.cookie);
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ code: 'AUTH_UNAVAILABLE' });
      expect(setCookies(response)).toHaveLength(0);
      expect(
        (await app.inject({ url: '/health/live', headers: { cookie: signed.cookie } })).statusCode,
      ).toBe(200);
    } finally {
      failing.mockRestore();
    }
    expect((await session(signed.cookie)).statusCode).toBe(200);
  });

  it('serializes refresh across API instances and retains the original absolute bound', async () => {
    const signed = await login();
    await edit(signed.cookie, (state) => {
      if (state.kind === 'user') state.identity.accessExpiresAt = 1;
    });
    second = await start();
    fault = 'refresh-block';
    const entered = new Promise<void>((resolve) => {
      refreshEntered = resolve;
    });
    const before = refreshCalls;
    const first = session(signed.cookie);
    await entered;
    const concurrent = await session(signed.cookie, second);
    expect(concurrent.statusCode).toBe(503);
    expect(concurrent.json().code).toBe('REFRESH_IN_PROGRESS');
    fault = 'none';
    releaseRefresh?.();
    const refreshed = await first;
    expect(refreshed.statusCode).toBe(200);
    expect(refreshCalls - before).toBe(1);
    expect(refreshed.json().session.expiresAt).toBe(signed.session.session.expiresAt);
    expect((await session(signed.cookie, second)).statusCode).toBe(200);
    await second.close();
    second = undefined;
  });

  it.each(['in progress', 'committed'])(
    'preserves a live session when an overlapping refresh is %s',
    async (phase) => {
      const signed = await login();
      const entered = new Promise<void>((resolve) => {
        introspectionEntered = resolve;
      });
      blockNextIntrospection = true;
      const overlapping = session(signed.cookie);
      await entered;
      // The first request has already checked its original token's refresh threshold.
      await edit(signed.cookie, (state) => {
        if (state.kind === 'user') state.identity.accessExpiresAt = 1;
      });
      fault = 'refresh-block';
      const refreshingEntered = new Promise<void>((resolve) => {
        refreshEntered = resolve;
      });
      const refreshing = session(signed.cookie);
      await refreshingEntered;
      if (phase === 'committed') {
        fault = 'none';
        releaseRefresh?.();
        expect((await refreshing).statusCode).toBe(200);
      }
      releaseIntrospection?.();
      const response = await overlapping;
      expect(response.statusCode).toBe(503);
      expect(response.json().code).toBe('REFRESH_IN_PROGRESS');
      expect(setCookies(response).some((cookie) => cookie.startsWith('turnstile=;'))).toBe(false);
      fault = 'none';
      releaseRefresh?.();
      expect((await refreshing).statusCode).toBe(200);
      expect((await session(signed.cookie)).statusCode).toBe(200);
    },
  );

  it('ends access after a lost refresh response, an abandoned claim or idle/absolute expiry', async () => {
    for (const mode of ['lost-response', 'reused', 'abandoned', 'idle', 'absolute']) {
      const signed = await login();
      if (mode === 'reused') {
        const token = await edit(signed.cookie, (state) =>
          state.kind === 'user' ? state.identity.refreshToken : undefined,
        );
        const rotated = await fetch(`${origin}/identity/oauth2/token`, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            authorization: `Basic ${Buffer.from(`bff-fixture-login:${fixture.loginSecret}`).toString('base64')}`,
          },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: token as string,
            resource: `${origin}/identity/oauth2/userinfo`,
          }),
        });
        expect(rotated.status).toBe(200);
        await rotated.arrayBuffer();
      }
      await edit(signed.cookie, (state) => {
        if (state.kind !== 'user') throw new Error('Missing identity');
        if (mode === 'idle') state.identity.idleExpiresAt = 1;
        else if (mode === 'absolute') state.identity.absoluteExpiresAt = 1;
        else if (mode === 'abandoned')
          state.refresh = { fence: 'abandoned', startedAt: Date.now() - 16000 };
        else state.identity.accessExpiresAt = 1;
      });
      if (mode === 'lost-response') fault = 'refresh-drop';
      expect((await session(signed.cookie)).statusCode).toBe(401);
      fault = 'none';
      expect((await session(signed.cookie)).statusCode).toBe(401);
    }
  });

  it('requires CSRF, origin and Fetch Metadata for logout, then clears local and authority access', async () => {
    const signed = await login();
    for (const headers of [
      {},
      { origin, 'x-csrf-token': 'wrong' },
      { origin: 'https://attacker.test', 'x-csrf-token': signed.csrf },
      { origin, 'x-csrf-token': signed.csrf, 'sec-fetch-site': 'cross-site' },
    ]) {
      const result = await app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        headers: { cookie: signed.cookie, ...headers },
        payload: {},
      });
      expect(result.statusCode).toBe(403);
    }
    expect((await session(signed.cookie)).statusCode).toBe(200);
    const ended = await logout(signed.cookie, signed.csrf, signed.authority);
    expect(ended.statusCode).toBe(200);
    expect(ended.json(), JSON.stringify(protocolStatus)).toEqual({
      local: 'complete',
      authority: 'complete',
    });
    expect(setCookies(ended).some((cookie) => cookie.startsWith('turnstile=;'))).toBe(true);
    expect(
      setCookies(ended).some((cookie) => cookie.includes('thaarei-identity.session_token=;')),
    ).toBe(true);
    expect((await session(signed.cookie)).statusCode).toBe(401);
    const parent = await fetch(`${origin}/identity/get-session`, {
      headers: { cookie: signed.authority },
    });
    expect(await parent.json()).toBe(null);
  });

  it('handles direct API logout and retry after authority failure or a lost logout response', async () => {
    const direct = await login();
    expect(
      (await logout(direct.cookie, direct.csrf)).json().authority,
      JSON.stringify(protocolStatus),
    ).toBe('complete');
    // Recover an already completed logout whose entire first response was lost.
    const lostResponse = await logout(direct.cookie, direct.csrf, direct.authority);
    expect(lostResponse.json().authority).toBe('complete');
    expect(
      setCookies(lostResponse).some((cookie) =>
        cookie.includes('thaarei-identity.session_token=;'),
      ),
    ).toBe(true);
    const signed = await login();
    fault = 'logout';
    const local = await logout(signed.cookie, signed.csrf, signed.authority);
    expect(local.json()).toMatchObject({ local: 'complete', authority: 'pending' });
    expect((await session(signed.cookie)).statusCode).toBe(401);
    const retryCookie = cookieOf(local, 'turnstile-logout');
    expect(retryCookie).not.toBe('');
    fault = 'none';
    // A caller that lost the first response still has its original cookie and CSRF token.
    const recovered = await logout(signed.cookie, signed.csrf, signed.authority);
    expect(recovered.json().authority).toBe('complete');
    const retry = await logout(retryCookie, signed.csrf, signed.authority);
    expect(retry.json()).toEqual({ local: 'complete', authority: 'complete' });
  });

  it('fences a refresh result arriving after logout and never restores local access', async () => {
    const signed = await login();
    await edit(signed.cookie, (state) => {
      if (state.kind === 'user') state.identity.accessExpiresAt = 1;
    });
    fault = 'refresh-block';
    const entered = new Promise<void>((resolve) => {
      refreshEntered = resolve;
    });
    const refreshing = session(signed.cookie);
    await entered;
    const ended = await logout(signed.cookie, signed.csrf, signed.authority);
    expect(ended.json().local).toBe('complete');
    fault = 'none';
    releaseRefresh?.();
    expect((await refreshing).statusCode).toBe(401);
    expect((await session(signed.cookie)).statusCode).toBe(401);
  });

  it('regenerates the session generation and CSRF token when its local permission snapshot changes', async () => {
    const signed = await login();
    await edit(signed.cookie, (state) => {
      if (state.kind === 'user') state.identity.permissions = [];
    });
    const changed = await session(signed.cookie);
    expect(changed.statusCode).toBe(200);
    const cookie = cookieOf(changed);
    expect(cookie).not.toBe('');
    expect(cookie).not.toBe(signed.cookie);
    expect(changed.json().csrfToken).not.toBe(signed.csrf);
    expect((await session(signed.cookie)).statusCode).toBe(401);
    expect((await session(cookie)).statusCode).toBe(200);
  });

  it('requires product permission before the real machine request, caches its token and strips spoofed browser context', async () => {
    const deniedUser = await login();
    const before = { tokens: machineCalls, requests: dmsCalls };
    const denied = await app.inject({
      url: '/api/dms/capabilities',
      headers: { cookie: deniedUser.cookie },
    });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().code).toBe('PERMISSION_DENIED');
    expect({ tokens: machineCalls, requests: dmsCalls }).toEqual(before);
    await grant('member', true, [...TURNSTILE_PERMISSIONS]);
    const signed = await login();
    const headers = {
      cookie: `${signed.cookie}; ${signed.authority}`,
      authorization: 'Bearer browser-spoof',
      'x-thaarei-actor-id': 'forged-user',
      'x-thaarei-request-id': 'forged-request',
      'x-tenant-id': 'forged-tenant',
      'x-request-id': 'browser-request-id',
    };
    const responses = await Promise.all(
      Array.from({ length: 3 }, () =>
        app.inject({
          url: '/api/dms/capabilities',
          headers,
        }),
      ),
    );
    expect(responses.every((response) => response.statusCode === 200)).toBe(true);
    expect(responses[0]?.json()).toEqual({ formats: [], profiles: [], languages: [] });
    expect(responses[0]?.headers['cache-control']).toBe('private, no-store');
    expect(machineCalls - before.tokens).toBe(1);
    expect(dmsCalls - before.requests).toBe(3);
    expect(actor).toMatchObject({
      id: fixture.users.member.id,
      cookie: false,
      tenant: false,
      bearer: true,
    });
    expect(actor?.requestId).toMatch(/^[a-f0-9-]{36}$/);
    for (const secret of [fixture.password, fixture.loginSecret, fixture.machineSecret])
      expect(responses.some((response) => response.body.includes(secret))).toBe(false);
    const ended = await logout(signed.cookie, signed.csrf, signed.authority);
    expect(ended.statusCode).toBe(200);
    const calls = dmsCalls;
    expect(
      (await app.inject({ url: '/api/dms/capabilities', headers: { cookie: signed.cookie } }))
        .statusCode,
    ).toBe(401);
    expect(dmsCalls).toBe(calls);
    await grant('member');
  });

  it('separates DMS/issuer outages and machine policy denial from browser logout, and observes live disablement', async () => {
    await grant('member', true, [...TURNSTILE_PERMISSIONS]);
    const signed = await login();
    const read = () =>
      app.inject({ url: '/api/dms/capabilities', headers: { cookie: signed.cookie } });
    expect((await read()).statusCode).toBe(200);
    await command('deny-machine-scope');
    const policyCalls = machineCalls;
    const denied = await read();
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({ code: 'DMS_ACCESS_DENIED' });
    expect(machineCalls).toBe(policyCalls);
    expect((await session(signed.cookie)).statusCode).toBe(200);
    await command('restore-machine-scope');
    expect((await read()).statusCode).toBe(200);
    fault = 'dms';
    const unavailable = await read();
    expect(unavailable.statusCode).toBe(503);
    expect(unavailable.json()).toEqual({ code: 'DMS_UNAVAILABLE' });
    expect((await session(signed.cookie)).statusCode).toBe(200);
    fault = 'all';
    expect((await read()).json()).toEqual({ code: 'AUTH_UNAVAILABLE' });
    fault = 'none';
    expect((await session(signed.cookie)).statusCode).toBe(200);
    // A fresh API instance must acquire a machine token; an issuer outage does not revoke its user.
    await app.close();
    app = await start();
    fault = 'machine-token';
    expect((await read()).json()).toEqual({ code: 'DMS_UNAVAILABLE' });
    expect((await session(signed.cookie)).statusCode).toBe(200);
    fault = 'none';
    expect((await read()).statusCode).toBe(200);
    await command('disable-machine');
    const issued = machineCalls;
    const disabled = await read();
    expect(disabled.statusCode).toBe(403);
    expect(disabled.json()).toEqual({ code: 'DMS_ACCESS_DENIED' });
    expect(machineCalls).toBe(issued);
    expect((await session(signed.cookie)).statusCode).toBe(200);
    await grant('member');
  });

  it('keeps Secure host-only cookies over the internal HTTP hop and permits logout after idle expiry', async () => {
    const server = Fastify();
    const config = parseProductEnvironment({
      ...process.env,
      AUTH_PROFILE: 'production',
      AUTH_PUBLIC_ORIGIN: 'https://platform.example.test',
      AUTH_ISSUER_URL: 'https://platform.example.test/identity',
      AUTH_LOGIN_CALLBACK_URL: 'https://platform.example.test/api/auth/callback',
    });
    const store = app.get(ProductDatabaseService).store;
    if (!store) throw new Error('Missing persistent store');
    await registerProductSession(server, config, store);
    server.get('/cookie-fixture', async (request) => {
      request.session.bff = { kind: 'consumed' };
      await request.session.save();
      return { ok: true };
    });
    const response = await server.inject({
      url: '/cookie-fixture',
      headers: { 'x-forwarded-proto': 'http', host: 'attacker.test' },
    });
    const header = response.headers['set-cookie'];
    expect(header).toEqual(expect.stringContaining('__Host-turnstile='));
    for (const attribute of ['Secure', 'HttpOnly', 'SameSite=Lax', 'Path=/'])
      expect(header).toEqual(expect.stringContaining(attribute));
    expect(String(header).includes('Domain=')).toBe(false);
    await server.close();
    const signed = await login();
    await edit(signed.cookie, (state) => {
      if (state.kind === 'user') state.identity.idleExpiresAt = 1;
    });
    expect((await session(signed.cookie)).statusCode).toBe(401);
    expect((await logout(signed.cookie, signed.csrf, signed.authority)).json().authority).toBe(
      'complete',
    );
  });
});
