import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { chromium } from '@playwright/test';
import { createLocalJWKSet, jwtVerify } from 'jose';
import { Pool } from 'pg';
import { createApplication } from '../src/bootstrap.js';
import { bootstrapInstallation } from '../src/infrastructure/database/migrate.js';
import { withTenant } from '../src/infrastructure/database/postgres.js';
import { runOperatorCommand } from '../src/modules/access/manage-operator.js';
import {
  issueEnrollmentKey,
  registerApplication,
} from '../src/modules/enrollment/enrollment-operator.js';
import { runApplicationCommand } from '../src/modules/enrollment/manage-application.js';
import { AuthorityService } from '../src/modules/platform-auth/authority/authority.service.js';
import type { AuthorityConfiguration } from '../src/modules/platform-auth/authority-configuration.js';
import { pruneContinuations } from '../src/modules/platform-auth/authorization-continuation.js';
import { manageOAuthClient } from '../src/modules/platform-auth/manage-client.js';
import { provisionUser } from '../src/modules/platform-auth/provision-user.js';
import { verifyExplorer } from './api-explorer-fixture.js';
import { smtpFixture } from './smtp-fixture.js';

// Dedicated lane provisions only auth/DMS. Also run in the ordinary regression lane
// with standalone configuration, preserving combined tests in separate processes.
describe('independent DMS foundation', () => {
  let app: NestFastifyApplication;
  let authority: AuthorityService;
  let config: AuthorityConfiguration;
  let smtp: Awaited<ReturnType<typeof smtpFixture>>;
  let operator: Headers;
  const docsKey = randomBytes(32).toString('base64url');
  const password = randomBytes(24).toString('base64url');
  const email = 'standalone-operator@example.test';
  const http = createServer((request, response) =>
    app.getHttpAdapter().getInstance().routing(request, response),
  );
  const owner = new Pool({ connectionString: process.env.AUTH_MIGRATION_DATABASE_URL });
  const dmsOwner = new Pool({ connectionString: process.env.DMS_MIGRATION_DATABASE_URL });
  const auth = () => {
    if (!authority.auth) throw new Error('Missing authority');
    return authority.auth;
  };
  const cookies = (headers: Record<string, unknown>) => {
    const values = headers['set-cookie'];
    return (Array.isArray(values) ? values : [values])
      .filter((value): value is string => typeof value === 'string')
      .map((value) => value.split(';')[0])
      .join('; ');
  };
  const screen = (path: string) => `${config.AUTH_PUBLIC_ORIGIN}/external/${path}`;
  const request = (path: string, body: Record<string, unknown>, cookie = '') =>
    app.inject({
      method: 'POST',
      url: `/identity/${path}`,
      headers: { origin: config.AUTH_PUBLIC_ORIGIN, cookie },
      payload: body,
    });
  const manage = (kind: 'login' | 'machine', action: string, clientId: string, extra = {}) =>
    manageOAuthClient(auth(), config, operator, { kind, action, clientId, ...extra });
  beforeAll(async () => {
    smtp = await smtpFixture();
    vi.stubEnv('AUTH_MODE', 'standalone');
    vi.stubEnv('DMS_DOCS_MODE', 'controlled');
    vi.stubEnv('DMS_DOCS_ACCESS_KEY', docsKey);
    vi.stubEnv('AUTH_SMTP_PORT', String(smtp.port));
    await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve));
    const address = http.address();
    if (!address || typeof address === 'string') throw new Error('Missing independent listener');
    const origin = `http://127.0.0.1:${address.port}`;
    vi.stubEnv('AUTH_PUBLIC_ORIGIN', origin);
    vi.stubEnv('AUTH_ISSUER_URL', `${origin}/identity`);
    vi.stubEnv('DMS_RESOURCE_URL', `${origin}/v1`);
    vi.stubEnv(
      'AUTH_LOGIN_CLIENTS',
      JSON.stringify(
        ['external-one', 'external-two'].map((clientId) => ({
          clientId,
          loginUrl: `${origin}/external/login`,
          consentUrl: `${origin}/external/consent`,
          callbackUrl:
            clientId === 'external-two'
              ? 'http://localhost:23602/external/callback'
              : `${origin}/external/${clientId}/callback`,
          logoutUrl:
            clientId === 'external-two'
              ? 'http://localhost:23602/external/logout'
              : `${origin}/external/logout`,
          verificationUrl: `${origin}/external/verified`,
          resetUrl: `${origin}/external/reset`,
        })),
      ),
    );
    app = await createApplication(false);
    app
      .getHttpAdapter()
      .getInstance()
      .get('/external/*', async (_request, reply) =>
        reply
          .type('text/html')
          .send(readFileSync(new URL('./independent-consumer.html', import.meta.url), 'utf8')),
      );
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
    authority = app.get(AuthorityService);
    if (!authority.config) throw new Error(authority.configurationError);
    config = authority.config;
    await provisionUser(
      auth(),
      { email, name: 'Independent operator', role: 'admin', password },
      config.AUTH_PUBLIC_ORIGIN,
      screen('verified'),
    );
    const link = smtp.link('verify');
    expect((await app.inject({ method: 'GET', url: link.pathname + link.search })).statusCode).toBe(
      302,
    );
    const login = await request('sign-in/email', { email, password });
    expect(login.statusCode).toBe(200);
    operator = new Headers({ origin: config.AUTH_PUBLIC_ORIGIN, cookie: cookies(login.headers) });
  });
  beforeEach(async () => {
    await owner.query('DELETE FROM auth.rate_limit');
  });
  afterAll(async () => {
    http.closeAllConnections();
    await new Promise<void>((resolve) => http.close(() => resolve()));
    await app?.close();
    await smtp?.close();
    await owner.end();
    await dmsOwner.end();
    vi.unstubAllEnvs();
  });

  it('boots only selected schemas, pins installation identity and authenticates private first operator', async () => {
    if (process.env.DATABASE_PROFILE === 'dms') {
      expect(
        (
          await owner.query(
            "SELECT count(*)::int AS count FROM pg_namespace WHERE nspname LIKE 'turnstile%'",
          )
        ).rows[0].count,
      ).toBe(0);
      expect(Object.keys(process.env).some((key) => key.startsWith('TURNSTILE_'))).toBe(false);
    }
    const bootstrapEvents = () =>
      withTenant(
        dmsOwner,
        config.INSTALLATION_TENANT_ID,
        async (db) =>
          (
            await db.query(
              "SELECT count(*)::int AS count FROM dms.security_event WHERE action='installation.bootstrap'",
            )
          ).rows[0].count as number,
      );
    const beforeBootstrap = await bootstrapEvents();
    expect(beforeBootstrap).toBe(1);
    await bootstrapInstallation();
    expect(await bootstrapEvents()).toBe(beforeBootstrap);
    await expect(
      bootstrapInstallation({ ...process.env, INSTALLATION_TENANT_ID: randomUUID() }),
    ).rejects.toThrow();
    const operation = { action: 'bootstrap', operatorEmail: email, operatorPassword: password };
    await expect(
      runOperatorCommand(operation, { ...process.env, DMS_MIGRATION_DATABASE_URL: undefined }),
    ).rejects.toThrow();
    await expect(
      runOperatorCommand({ ...operation, operatorPassword: 'incorrect-password-value' }),
    ).rejects.toThrow();
    const first = await runOperatorCommand(operation);
    expect(await runOperatorCommand(operation)).toEqual(first);
    expect(await bootstrapEvents()).toBe(beforeBootstrap);
    await expect(
      runOperatorCommand({
        action: 'revoke',
        operatorEmail: email,
        operatorPassword: password,
        subjectId: 'subjectId' in first ? first.subjectId : undefined,
      }),
    ).rejects.toThrow(/last operator/);
    // Runtime has no operator-table rights, even with a chosen tenant setting.
    const runtime = new Pool({ connectionString: config.DMS_DATABASE_URL });
    try {
      await expect(runtime.query('SELECT * FROM dms.operator_authorization')).rejects.toMatchObject(
        { code: '42501' },
      );
    } finally {
      await runtime.end();
    }
  });

  it('requires explicit operator grants for ordinary commands and separately held administrator recovery', async () => {
    const otherEmail = 'standalone-other-admin@example.test';
    const user = await provisionUser(
      auth(),
      { email: otherEmail, name: 'Other administrator', role: 'admin', password },
      config.AUTH_PUBLIC_ORIGIN,
      screen('verified'),
    );
    const link = smtp.link('verify');
    expect((await app.inject({ method: 'GET', url: link.pathname + link.search })).statusCode).toBe(
      302,
    );
    const input = { operatorEmail: otherEmail, operatorPassword: password };
    const actor = await auth().api.getSession({ headers: operator });
    if (!actor) throw new Error('Missing first operator');
    const eventCount = () =>
      withTenant(
        dmsOwner,
        config.INSTALLATION_TENANT_ID,
        async (db) =>
          (await db.query('SELECT count(*)::int AS count FROM dms.security_event')).rows[0]
            .count as number,
      );
    const beforeDenied = await eventCount();
    await expect(
      runOperatorCommand({ ...input, action: 'assign', subjectId: actor.user.id }),
    ).rejects.toThrow(/authorization/);
    await expect(runOperatorCommand({ ...input, action: 'bootstrap' })).rejects.toThrow(
      /already bootstrapped/,
    );
    expect(await eventCount()).toBe(beforeDenied);
    await owner.query('DELETE FROM auth.rate_limit');
    await expect(
      runOperatorCommand(
        { ...input, action: 'recover' },
        { ...process.env, DMS_MIGRATION_DATABASE_URL: config.DMS_DATABASE_URL },
      ),
    ).rejects.toThrow();
    expect(await runOperatorCommand({ ...input, action: 'recover' })).toMatchObject({
      subjectId: user.id,
      operatorId: user.id,
    });
    await owner.query('DELETE FROM auth.rate_limit');
    expect(
      await runOperatorCommand({ ...input, action: 'revoke', subjectId: actor.user.id }),
    ).toMatchObject({ subjectId: actor.user.id });
    await expect(
      runOperatorCommand({
        action: 'assign',
        operatorEmail: email,
        operatorPassword: password,
        subjectId: user.id,
      }),
    ).rejects.toThrow(/authorization/);
    await owner.query('DELETE FROM auth.rate_limit');
    expect(
      await runOperatorCommand({ ...input, action: 'assign', subjectId: actor.user.id }),
    ).toMatchObject({ subjectId: actor.user.id });
  });

  it('discovers identity and independently provisions/enrolls two arbitrary machine identities', async () => {
    for (const path of [
      '/identity/.well-known/openid-configuration',
      '/.well-known/oauth-authorization-server/identity',
      '/identity/jwks',
    ])
      expect((await app.inject({ method: 'GET', url: path })).statusCode).toBe(200);
    for (const clientId of ['outside-python-backend', 'outside-other-service']) {
      const applicationId = randomUUID();
      const issued = await manage('machine', 'issue', clientId, {
        applicationId,
        scopes: ['dms:capabilities:read'],
      });
      const context = {
        tenantId: config.INSTALLATION_TENANT_ID,
        issuer: config.AUTH_ISSUER_URL,
        deploymentId: config.DMS_RESOURCE_URL,
      };
      await registerApplication(
        dmsOwner,
        context,
        { applicationId, clientId, name: clientId, scopes: ['dms:capabilities:read'] },
        issued.record,
      );
      const key = await issueEnrollmentKey(dmsOwner, context, applicationId);
      // Tokens and enrollment use the public owning HTTP handler, no Turnstile adapter.
      const token = async (secret: string, resource = config.DMS_RESOURCE_URL) =>
        app.inject({
          method: 'POST',
          url: '/identity/oauth2/token',
          headers: {
            authorization: `Basic ${Buffer.from(`${clientId}:${secret}`).toString('base64')}`,
            'content-type': 'application/x-www-form-urlencoded',
          },
          payload: new URLSearchParams({
            grant_type: 'client_credentials',
            resource,
            scope: 'dms:capabilities:read',
          }).toString(),
        });
      const minted = await token(issued.secret ?? '');
      expect(minted.statusCode).toBe(200);
      const bearer = { authorization: `Bearer ${minted.json().access_token}` };
      const enrolled = await app.inject({
        method: 'POST',
        url: '/v1/application-enrollments',
        headers: {
          ...bearer,
          'x-thaarei-enrollment-key': key.key,
          'idempotency-key': randomUUID(),
        },
        payload: { name: clientId },
      });
      expect(enrolled.statusCode, enrolled.body).toBe(201);
      expect(
        (await app.inject({ method: 'GET', url: '/v1/capabilities', headers: bearer })).statusCode,
      ).toBe(200);
      expect(
        (await token(issued.secret ?? '', `${config.DMS_RESOURCE_URL}/wrong`)).statusCode,
      ).toBe(400);
      expect(key.applicationId).toBe(applicationId);
      expect(bearer.authorization).toMatch(/^Bearer /);
      const rotated = await manage('machine', 'rotate', clientId);
      expect((await token(issued.secret ?? '')).statusCode).toBeGreaterThanOrEqual(400);
      expect((await token(rotated.secret ?? '')).statusCode).toBe(200);
      const disabled = await runApplicationCommand({
        action: 'disable',
        applicationId,
        operatorEmail: email,
        operatorPassword: password,
      });
      expect(disabled).toMatchObject({ local: 'disabled', issuer: 'disabled' });
      expect((await token(rotated.secret ?? '')).statusCode).toBeGreaterThanOrEqual(400);
    }
  });

  it.runIf(process.env.DATABASE_PROFILE === 'dms')(
    'uses only HTTP from independent Python/curl backends and exercises ephemeral Swagger authorization',
    async () => {
      const directory = await mkdtemp(join(tmpdir(), 'dms-manual-'));
      const tokenFile = join(directory, 'token.json');
      const clientId = 'manual-explorer-backend';
      const applicationId = randomUUID();
      const issued = await manage('machine', 'issue', clientId, {
        applicationId,
        scopes: ['dms:capabilities:read'],
      });
      const context = {
        tenantId: config.INSTALLATION_TENANT_ID,
        issuer: config.AUTH_ISSUER_URL,
        deploymentId: config.DMS_RESOURCE_URL,
      };
      await registerApplication(
        dmsOwner,
        context,
        { applicationId, clientId, name: clientId, scopes: ['dms:capabilities:read'] },
        issued.record,
      );
      const enrollment = await issueEnrollmentKey(dmsOwner, context, applicationId);
      const run = (command: string, args: string[], input: unknown = '') =>
        new Promise<string>((resolve, reject) => {
          const child = spawn(command, args, { stdio: ['pipe', 'pipe', 'pipe'] });
          let output = '';
          child.stdout.on('data', (chunk) => {
            output += chunk;
          });
          child.stderr.resume();
          const timer = setTimeout(() => {
            child.kill();
            reject(new Error('Independent consumer timeout'));
          }, 15000);
          child.once('error', (error) => {
            clearTimeout(timer);
            reject(error);
          });
          child.once('exit', (code) => {
            clearTimeout(timer);
            if (code !== 0) reject(new Error('Independent consumer command failed'));
            else resolve(output);
          });
          child.stdin.end(typeof input === 'string' ? input : JSON.stringify(input));
        });
      const python = (action: string, input: unknown) =>
        run(
          'uv',
          [
            'run',
            '--project',
            fileURLToPath(new URL('../../dms-processing', import.meta.url)),
            '--locked',
            'python',
            fileURLToPath(new URL('../../../examples/dms/backend.py', import.meta.url)),
            action,
            '--token-file',
            tokenFile,
          ],
          input,
        );
      try {
        await python('token', {
          issuer: config.AUTH_ISSUER_URL,
          resource: config.DMS_RESOURCE_URL,
          clientId,
          clientSecret: issued.secret,
        });
        await python('enroll', {
          resource: config.DMS_RESOURCE_URL,
          enrollmentKey: enrollment.key,
          name: clientId,
          idempotencyKey: randomUUID(),
        });
        expect(
          JSON.parse(await python('capabilities', { resource: config.DMS_RESOURCE_URL })),
        ).toMatchObject({ applicationId, contractVersion: 1 });
        const token = JSON.parse(await readFile(tokenFile, 'utf8')).accessToken as string;
        const curlFile = join(directory, 'capabilities.curl');
        await writeFile(
          curlFile,
          `url = "${config.DMS_RESOURCE_URL}/capabilities"\nheader = "Authorization: Bearer ${token}"\n`,
          { mode: 0o600 },
        );
        expect(
          JSON.parse(
            await run('curl', [
              '--disable',
              '--noproxy',
              '*',
              '--config',
              curlFile,
              '--silent',
              '--show-error',
              '--fail',
              '--max-time',
              '10',
            ]),
          ),
        ).toMatchObject({ applicationId });
        await verifyExplorer(config.AUTH_PUBLIC_ORIGIN, docsKey, token);
      } finally {
        await rm(directory, { recursive: true, force: true });
      }
    },
    60000,
  );

  it.runIf(process.env.DMS_TEST_IMAGE_CONTAINER !== undefined)(
    'serves the protected explorer and real machine reads from the isolated image',
    async () => {
      const container = process.env.DMS_TEST_IMAGE_CONTAINER;
      const key = process.env.DMS_TEST_IMAGE_DOCS_KEY;
      if (!container || !key) throw new Error('Missing packaged fixture');
      const run = (args: string[], input: unknown = '', env = process.env) =>
        new Promise<string>((resolve, reject) => {
          const child = spawn('docker', args, { env, stdio: ['pipe', 'pipe', 'pipe'] });
          let output = '';
          child.stdout.on('data', (chunk) => {
            output += chunk;
          });
          let failure = 'unclassified';
          child.stderr.on('data', (chunk) => {
            for (const line of String(chunk).split('\n')) {
              try {
                const value = JSON.parse(line);
                if (
                  value.type === 'packaged-explorer-failure' &&
                  /^[a-z-]{1,40}$/.test(value.phase) &&
                  /^[A-Za-z]{1,40}$/.test(value.kind)
                )
                  failure = `${value.phase}/${value.kind}`;
              } catch {
                /* Ignore unstructured output, which may contain credentials. */
              }
            }
          });
          child.once('error', reject);
          child.once('exit', (code) =>
            code === 0
              ? resolve(output)
              : reject(new Error(`Packaged explorer fixture failed (${failure})`)),
          );
          child.stdin.end(typeof input === 'string' ? input : JSON.stringify(input));
        });
      const maintenance = new URL(process.env.DMS_MIGRATION_DATABASE_URL ?? '');
      maintenance.hostname = process.env.DMS_TEST_IMAGE_DATABASE_HOST ?? '';
      maintenance.port = '5432';
      const result = JSON.parse(
        await run(
          [
            'exec',
            '--interactive',
            '-e',
            'DMS_MIGRATION_DATABASE_URL',
            container,
            'node',
            '/run/packaged-explorer.mjs',
          ],
          { email, password },
          { ...process.env, DMS_MIGRATION_DATABASE_URL: maintenance.href },
        ),
      );
      for (const authorization of [undefined, 'Bearer wrong', `Bearer ${result.expiredToken}`]) {
        const response = JSON.parse(
          await run(['exec', '--interactive', container, 'node', '/run/packaged-explorer.mjs'], {
            action: 'http',
            path: '/v1/capabilities',
            headers: authorization ? { authorization } : {},
          }),
        );
        expect(response.status).toBe(401);
        if (authorization?.includes(result.expiredToken))
          expect(JSON.parse(Buffer.from(response.body, 'base64').toString()).code).toBe(
            'MACHINE_TOKEN_EXPIRED',
          );
      }
      // Docker Desktop's private network is not reachable from the host browser.
      // Forward browser requests over fixture IPC to real HTTP inside the container;
      // no response/auth policy is mocked and no host service port is published.
      await verifyExplorer(
        'http://dms-image.invalid',
        key,
        result.accessToken,
        async (path, headers) =>
          JSON.parse(
            await run(['exec', '--interactive', container, 'node', '/run/packaged-explorer.mjs'], {
              action: 'http',
              path,
              headers,
            }),
          ),
      );
    },
    90000,
  );

  it('binds safe independent PKCE login continuation to its browser and registered client', async () => {
    for (const clientId of ['external-one', 'external-two']) {
      const issued = await manage('login', 'issue', clientId, { applicationId: randomUUID() });
      const policy = config.AUTH_LOGIN_CLIENTS.find((client) => client.clientId === clientId);
      if (!policy) throw new Error('Missing consumer policy');
      const verifier = randomBytes(32).toString('base64url');
      const query = new URLSearchParams({
        client_id: clientId,
        redirect_uri: policy.callbackUrl,
        response_type: 'code',
        scope: 'openid profile email offline_access',
        resource: `${config.AUTH_ISSUER_URL}/oauth2/userinfo`,
        state: randomUUID(),
        nonce: randomUUID(),
        code_challenge_method: 'S256',
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      });
      const start = await app.inject({ method: 'GET', url: `/identity/oauth2/authorize?${query}` });
      expect(start.statusCode).toBe(302);
      const entry = new URL(String(start.headers.location));
      expect(entry.origin + entry.pathname).toBe(policy.loginUrl);
      expect([...entry.searchParams.keys()]).toEqual(['transaction']);
      const transaction = entry.searchParams.get('transaction');
      const resume = `/identity/continue?transaction=${transaction}`;
      expect((await app.inject({ method: 'GET', url: resume })).statusCode).toBe(400);
      const login = await request('sign-in/email', { email, password });
      expect(login.statusCode).toBe(200);
      const cookie = `${cookies(start.headers)}; ${cookies(login.headers)}`;
      const continuation = await app.inject({ method: 'GET', url: resume, headers: { cookie } });
      expect(continuation.statusCode).toBe(302);
      expect(
        (await app.inject({ method: 'GET', url: resume, headers: { cookie } })).statusCode,
      ).toBe(400);
      const callback = new URL(String(continuation.headers.location));
      expect(callback.origin + callback.pathname).toBe(policy.callbackUrl);
      expect(callback.searchParams.get('state')).toBe(query.get('state'));
      const token = await app.inject({
        method: 'POST',
        url: '/identity/oauth2/token',
        headers: {
          authorization: `Basic ${Buffer.from(`${clientId}:${issued.secret}`).toString('base64')}`,
          'content-type': 'application/x-www-form-urlencoded',
        },
        payload: new URLSearchParams({
          grant_type: 'authorization_code',
          code: callback.searchParams.get('code') ?? '',
          code_verifier: verifier,
          redirect_uri: policy.callbackUrl,
          resource: `${config.AUTH_ISSUER_URL}/oauth2/userinfo`,
        }).toString(),
      });
      expect(token.statusCode).toBe(200);
      const keys = createLocalJWKSet(
        (await app.inject({ method: 'GET', url: '/identity/jwks' })).json(),
      );
      await expect(
        jwtVerify(token.json().id_token, keys, {
          issuer: config.AUTH_ISSUER_URL,
          audience: clientId,
          currentDate: new Date(Date.now() + 301000),
        }),
      ).rejects.toMatchObject({ code: 'ERR_JWT_EXPIRED' });
      const invalidLogout = await request(
        'oauth2/end-session',
        { id_token_hint: token.json().id_token, post_logout_redirect_uri: screen('unregistered') },
        cookie,
      );
      expect(invalidLogout.statusCode).toBeGreaterThanOrEqual(400);
      const logout = await request(
        'oauth2/end-session',
        { id_token_hint: token.json().id_token, post_logout_redirect_uri: policy.logoutUrl },
        cookie,
      );
      expect(logout.statusCode).toBeLessThan(400);
      query.set('redirect_uri', screen('unregistered'));
      const denied = await app.inject({
        method: 'GET',
        url: `/identity/oauth2/authorize?${query}`,
      });
      expect(denied.statusCode).toBeGreaterThanOrEqual(400);
    }
  });

  it('reclaims expired continuation rows in bounded batches without touching provider records', async () => {
    // Remove only previous fixture continuations before making batch counts exact.
    await owner.query("DELETE FROM auth.verification WHERE identifier LIKE 'dms-continuation:%'");
    const providerId = randomUUID();
    const liveId = randomUUID();
    await owner.query(
      "INSERT INTO auth.verification(id,identifier,value,expires_at) VALUES ($1,'provider-token-fixture','not-json',now()-interval '1 day'),($2,'dms-continuation:live','{}',now()+interval '5 minutes')",
      [providerId, liveId],
    );
    await owner.query(
      "INSERT INTO auth.verification(id,identifier,value,expires_at) SELECT 'cleanup-' || i::text,'dms-continuation:expired-' || i::text,'{}',now()-interval '1 day' FROM generate_series(1,105) AS i",
    );
    try {
      expect(await pruneContinuations(owner)).toBe(100);
      expect(await pruneContinuations(owner)).toBe(5);
      expect(await pruneContinuations(owner)).toBe(0);
      expect(
        (
          await owner.query(
            'SELECT count(*)::int AS count FROM auth.verification WHERE id=ANY($1::text[])',
            [[providerId, liveId]],
          )
        ).rows[0].count,
      ).toBe(2);
    } finally {
      await owner.query('DELETE FROM auth.verification WHERE id=ANY($1::text[])', [
        [providerId, liveId],
      ]);
    }
  });

  it('rejects substituted, expired and tampered authorization transactions', async () => {
    const policy = config.AUTH_LOGIN_CLIENTS[0];
    if (!policy) throw new Error('Missing policy');
    const query = new URLSearchParams({
      client_id: policy.clientId,
      redirect_uri: policy.callbackUrl,
      response_type: 'code',
      scope: 'openid',
      resource: `${config.AUTH_ISSUER_URL}/oauth2/userinfo`,
      state: randomUUID(),
      code_challenge_method: 'S256',
      code_challenge: createHash('sha256').update(randomBytes(32)).digest('base64url'),
    });
    const start = await app.inject({ method: 'GET', url: `/identity/oauth2/authorize?${query}` });
    const transaction = new URL(String(start.headers.location)).searchParams.get('transaction');
    const resume = `/identity/continue?transaction=${transaction}`;
    expect(
      (
        await app.inject({
          method: 'GET',
          url: resume,
          headers: { cookie: `thaarei-authorization=${randomBytes(32).toString('base64url')}` },
        })
      ).statusCode,
    ).toBe(400);
    await owner.query(
      "UPDATE auth.verification SET expires_at=now()-interval '1 second' WHERE identifier LIKE 'dms-continuation:%'",
    );
    expect(
      (
        await app.inject({
          method: 'GET',
          url: resume,
          headers: { cookie: cookies(start.headers) },
        })
      ).statusCode,
    ).toBe(400);
    const second = await app.inject({ method: 'GET', url: `/identity/oauth2/authorize?${query}` });
    const reference = new URL(String(second.headers.location)).searchParams.get('transaction');
    await owner.query(
      `UPDATE auth.verification SET value=jsonb_set(value::jsonb,'{query}',to_jsonb((value::jsonb->>'query') || '&state=substituted'))::text WHERE identifier LIKE 'dms-continuation:%'`,
    );
    const login = await request('sign-in/email', { email, password });
    expect(
      (
        await app.inject({
          method: 'GET',
          url: `/identity/continue?transaction=${reference}`,
          headers: { cookie: `${cookies(second.headers)}; ${cookies(login.headers)}` },
        })
      ).statusCode,
    ).toBeGreaterThanOrEqual(400);
  });

  it.runIf(process.env.DATABASE_PROFILE === 'dms')(
    'runs consumer-owned screens in a real browser with no product service',
    async () => {
      const clientId = 'external-one';
      const rotated = await manage('login', 'rotate', clientId);
      const policy = config.AUTH_LOGIN_CLIENTS[0];
      if (!policy) throw new Error('Missing policy');
      const verifier = randomBytes(32).toString('base64url');
      const state = randomUUID();
      const nonce = randomUUID();
      const query = new URLSearchParams({
        client_id: clientId,
        redirect_uri: policy.callbackUrl,
        response_type: 'code',
        scope: 'openid profile email offline_access',
        resource: `${config.AUTH_ISSUER_URL}/oauth2/userinfo`,
        state,
        nonce,
        code_challenge_method: 'S256',
        code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      });
      const browser = await chromium.launch({ headless: true });
      try {
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto(`${config.AUTH_ISSUER_URL}/oauth2/authorize?${query}`);
        expect(new URL(page.url()).pathname).toBe('/external/login');
        await page.getByLabel('Email').fill(email);
        await page.getByLabel('Password').fill(password);
        await page.getByRole('button', { name: 'Sign in', exact: true }).click();
        await page.waitForURL(`${policy.callbackUrl}?**`);
        const callback = new URL(page.url());
        expect(callback.searchParams.get('state')).toBe(state);
        const exchanged = await fetch(`${config.AUTH_ISSUER_URL}/oauth2/token`, {
          method: 'POST',
          headers: {
            authorization: `Basic ${Buffer.from(`${clientId}:${rotated.secret}`).toString('base64')}`,
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            grant_type: 'authorization_code',
            code: callback.searchParams.get('code') ?? '',
            code_verifier: verifier,
            redirect_uri: policy.callbackUrl,
            resource: `${config.AUTH_ISSUER_URL}/oauth2/userinfo`,
          }),
        });
        expect(exchanged.status).toBe(200);
        const tokens = (await exchanged.json()) as { id_token: string; refresh_token: string };
        const jwks = await (await fetch(`${config.AUTH_ISSUER_URL}/jwks`)).json();
        const verified = await jwtVerify(tokens.id_token, createLocalJWKSet(jwks), {
          issuer: config.AUTH_ISSUER_URL,
          audience: clientId,
        });
        expect(verified.payload.nonce).toBe(nonce);
        const logout = await context.request.post(`${config.AUTH_ISSUER_URL}/oauth2/end-session`, {
          headers: { origin: config.AUTH_PUBLIC_ORIGIN },
          data: { id_token_hint: tokens.id_token, post_logout_redirect_uri: policy.logoutUrl },
          maxRedirects: 0,
        });
        expect(logout.status()).toBeLessThan(400);
        const refresh = await fetch(`${config.AUTH_ISSUER_URL}/oauth2/token`, {
          method: 'POST',
          headers: {
            authorization: `Basic ${Buffer.from(`${clientId}:${rotated.secret}`).toString('base64')}`,
            'content-type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            grant_type: 'refresh_token',
            refresh_token: tokens.refresh_token,
            resource: `${config.AUTH_ISSUER_URL}/oauth2/userinfo`,
          }),
        });
        expect(refresh.status).toBeGreaterThanOrEqual(400);
      } finally {
        await browser.close();
      }
    },
  );

  it('rejects arbitrary verification and reset returns and recovers independently', async () => {
    expect(
      (await request('request-password-reset', { email, redirectTo: screen('unregistered') }))
        .statusCode,
    ).toBe(400);
    expect(
      (await request('send-verification-email', { email, callbackURL: screen('unregistered') }))
        .statusCode,
    ).toBe(400);
    const sent = await request('request-password-reset', { email, redirectTo: screen('reset') });
    expect(sent.statusCode).toBe(200);
    const link = smtp.link('reset');
    const redirected = await app.inject({ method: 'GET', url: link.pathname + link.search });
    expect(redirected.statusCode).toBe(302);
    const reset = new URL(String(redirected.headers.location));
    expect(reset.origin + reset.pathname).toBe(screen('reset'));
    const nextPassword = randomBytes(24).toString('base64url');
    expect(
      (
        await request('reset-password', {
          token: reset.searchParams.get('token'),
          newPassword: nextPassword,
        })
      ).statusCode,
    ).toBe(200);
    expect((await request('sign-in/email', { email, password })).statusCode).toBeGreaterThanOrEqual(
      400,
    );
    await owner.query('DELETE FROM auth.rate_limit');
    expect((await request('sign-in/email', { email, password: nextPassword })).statusCode).toBe(
      200,
    );
  });
});
