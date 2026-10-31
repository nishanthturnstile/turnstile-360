import cookie from '@fastify/cookie';
import session from '@fastify/session';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { FastifyAdapter } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import { calculatePKCECodeChallenge, randomPKCECodeVerifier } from 'openid-client';
import { createApplication } from '../src/bootstrap.js';
import { productEnvironment } from './auth-environment.js';

describe('configured product foundations and Fastify compatibility', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    const env = productEnvironment();
    for (const [key, value] of Object.entries(env)) vi.stubEnv(key, value);
    vi.stubEnv('NODE_ENV', 'test');
    app = await createApplication(false);
    const fastify = app.getHttpAdapter().getInstance();
    await app.init();
    await fastify.ready();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });

  it('keeps valid foundations unready until persistence exists', async () => {
    const response = await app.inject({ method: 'GET', url: '/health/ready/auth' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'unavailable', reason: 'database_unavailable' });
    expect((await app.inject({ method: 'GET', url: '/api/auth/login' })).statusCode).toBe(503);
  });

  it('registers cookie/session plugins on the installed Nest Fastify adapter', async () => {
    const module = await Test.createTestingModule({}).compile();
    const compat = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter());
    // Isolated compatibility probe only; the production application always uses PostgreSQL.
    await compat.register(cookie);
    await compat.register(session, {
      secret: productEnvironment().TURNSTILE_COOKIE_SECRET as string,
      cookie: { secure: false },
    });
    compat
      .getHttpAdapter()
      .getInstance()
      .get('/plugin-probe', (request) => ({ id: request.session.sessionId }));
    await compat.init();
    const first = await compat.inject({ method: 'GET', url: '/plugin-probe' });
    expect(first.statusCode).toBe(200);
    expect(first.json().id).toEqual(expect.any(String));
    const setCookie = first.headers['set-cookie'];
    expect(typeof setCookie).toBe('string');
    const second = await compat.inject({
      method: 'GET',
      url: '/plugin-probe',
      headers: { cookie: String(setCookie).split(';')[0] as string },
    });
    expect(second.json()).toEqual(first.json());
    await compat.close();
  });

  it('loads the pinned ESM OIDC client and uses Node Web Crypto', async () => {
    const verifier = randomPKCECodeVerifier();
    const challenge = await calculatePKCECodeChallenge(verifier);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(challenge).not.toBe(verifier);
  });
});
