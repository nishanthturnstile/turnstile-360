import { Controller, Get, Post, Req, SetMetadata } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { FastifyRequest } from 'fastify';
import { ApplicationAccessGuard } from '../src/infrastructure/application-access.guard.js';
import { ConfigurationException } from '../src/infrastructure/configuration-exception.js';
import { WorkspaceReadinessExempt } from '../src/infrastructure/workspace-access.js';
import { AuthExceptionFilter } from '../src/modules/auth/browser-auth/auth-errors.js';
import { BrowserAuthService } from '../src/modules/auth/browser-auth/browser-auth.service.js';
import { verifyProductCsrf } from '../src/modules/auth/browser-auth/csrf.js';
import {
  PublicEndpoint,
  REQUIRED_PERMISSIONS,
  RequirePermissions,
} from '../src/modules/auth/user-session/access-policy.js';
import { UserSessionGuard } from '../src/modules/auth/user-session/user-session.guard.js';
import { OnboardingService } from '../src/modules/onboarding/onboarding.service.js';

@Controller('policy')
class PolicyFixture {
  @Post('configuration-conflict')
  @RequirePermissions('turnstile:access')
  configurationConflict() {
    throw new ConfigurationException({
      code: 'CONFIGURATION_CONFLICT',
      reason: 'revision',
      revision: 2,
    });
  }

  @Get('public')
  @PublicEndpoint()
  public() {
    return { public: true };
  }

  @Get('unannotated')
  @WorkspaceReadinessExempt()
  unannotated() {
    return { secret: true };
  }

  @Get('admin')
  @SetMetadata(REQUIRED_PERMISSIONS, ['business:admin'])
  admin() {
    return { secret: true };
  }

  @Post('allowed')
  @RequirePermissions('turnstile:access')
  allowed(@Req() request: FastifyRequest) {
    return { id: request.productUser?.identity.user.id };
  }
  @Post('setup')
  @WorkspaceReadinessExempt()
  @RequirePermissions('turnstile:access')
  setup() {
    return { setup: true };
  }
}

describe('default product permission boundary', () => {
  let app: NestFastifyApplication;
  const origin = 'http://localhost:5173';
  const csrf = 'fixture-csrf-token';
  let readiness: 'complete' | 'incomplete' | 'unavailable' = 'complete';
  const requireReady = vi.fn(async () => {
    if (readiness !== 'complete')
      throw new ConfigurationException({
        code: readiness === 'incomplete' ? 'SETUP_REQUIRED' : 'CONFIGURATION_UNAVAILABLE',
      });
  });
  const authenticate = vi.fn(async (request: FastifyRequest) => {
    const current = {
      identity: { user: { id: 'fixture-user', role: 'admin' }, permissions: ['turnstile:access'] },
      csrf,
    };
    // Identity verification is exercised against the real authority in the database suite.
    request.productUser = current as unknown as NonNullable<FastifyRequest['productUser']>;
    return current;
  });
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [PolicyFixture],
      providers: [
        {
          provide: BrowserAuthService,
          useValue: {
            authenticate,
            csrf: (request: FastifyRequest, token: string) =>
              verifyProductCsrf(request, token, origin),
          },
        },
        { provide: OnboardingService, useValue: { requireReady } },
        UserSessionGuard,
        { provide: APP_GUARD, useClass: ApplicationAccessGuard },
      ],
    }).compile();
    app = module.createNestApplication<NestFastifyApplication>(new FastifyAdapter(), {
      logger: false,
    });
    app.useGlobalFilters(new AuthExceptionFilter());
    await app.init();
  });
  afterAll(async () => {
    await app.close();
  });
  afterEach(() => {
    readiness = 'complete';
    requireReady.mockClear();
  });

  it('bypasses identity verification only on an explicitly public handler', async () => {
    authenticate.mockClear();
    expect((await app.inject({ url: '/policy/public' })).statusCode).toBe(200);
    expect(authenticate).not.toHaveBeenCalled();
  });
  it('denies unannotated handlers and business privileges even for an authority administrator', async () => {
    for (const url of ['/policy/unannotated', '/policy/admin']) {
      const response = await app.inject({ url });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toEqual({ code: 'PERMISSION_DENIED' });
    }
  });
  it('applies the real CSRF/origin boundary before a permitted mutation reaches its handler', async () => {
    expect((await app.inject({ method: 'POST', url: '/policy/allowed' })).statusCode).toBe(403);
    const accepted = await app.inject({
      method: 'POST',
      url: '/policy/allowed',
      headers: { origin, 'x-csrf-token': csrf, 'sec-fetch-site': 'same-origin' },
    });
    expect(accepted.statusCode).toBe(201);
    expect(accepted.json()).toEqual({ id: 'fixture-user' });
  });
  it('preserves typed configuration failures after auth/CSRF rather than masking them as auth outages', async () => {
    const denied = await app.inject({ method: 'POST', url: '/policy/configuration-conflict' });
    expect(denied.statusCode).toBe(403);
    expect(denied.json()).toEqual({ code: 'CSRF_REJECTED' });
    const conflict = await app.inject({
      method: 'POST',
      url: '/policy/configuration-conflict',
      headers: { origin, 'x-csrf-token': csrf },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json()).toEqual({
      code: 'CONFIGURATION_CONFLICT',
      reason: 'revision',
      revision: 2,
    });
    expect(conflict.headers['cache-control']).toBe('private, no-store');
    expect(conflict.headers['referrer-policy']).toBe('no-referrer');
  });
  it('applies identity, CSRF and permissions before readiness; explicit exemptions skip only readiness', async () => {
    readiness = 'incomplete';
    requireReady.mockClear();
    expect((await app.inject({ url: '/policy/public' })).statusCode).toBe(200);
    expect((await app.inject({ url: '/policy/unannotated' })).json()).toEqual({
      code: 'PERMISSION_DENIED',
    });
    expect((await app.inject({ url: '/policy/admin' })).json()).toEqual({
      code: 'PERMISSION_DENIED',
    });
    expect((await app.inject({ method: 'POST', url: '/policy/allowed' })).json()).toEqual({
      code: 'CSRF_REJECTED',
    });
    expect((await app.inject({ method: 'POST', url: '/policy/setup' })).json()).toEqual({
      code: 'CSRF_REJECTED',
    });
    expect(requireReady).not.toHaveBeenCalled();
    const headers = { origin, 'x-csrf-token': csrf };
    expect((await app.inject({ method: 'POST', url: '/policy/setup', headers })).statusCode).toBe(
      201,
    );
    expect(requireReady).not.toHaveBeenCalled();
    const blocked = await app.inject({ method: 'POST', url: '/policy/allowed', headers });
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json()).toEqual({ code: 'SETUP_REQUIRED' });
    readiness = 'unavailable';
    const outage = await app.inject({ method: 'POST', url: '/policy/allowed', headers });
    expect(outage.statusCode).toBe(503);
    expect(outage.json()).toEqual({ code: 'CONFIGURATION_UNAVAILABLE' });
    readiness = 'complete';
    expect((await app.inject({ method: 'POST', url: '/policy/allowed', headers })).statusCode).toBe(
      201,
    );
  });
});
