import { Controller, Get, Post, Req, SetMetadata } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Test } from '@nestjs/testing';
import type { FastifyRequest } from 'fastify';
import { AuthExceptionFilter } from '../src/modules/auth/browser-auth/auth-errors.js';
import { BrowserAuthService } from '../src/modules/auth/browser-auth/browser-auth.service.js';
import { verifyProductCsrf } from '../src/modules/auth/browser-auth/csrf.js';
import {
  PublicEndpoint,
  REQUIRED_PERMISSIONS,
  RequirePermissions,
} from '../src/modules/auth/user-session/access-policy.js';
import { UserSessionGuard } from '../src/modules/auth/user-session/user-session.guard.js';

@Controller('policy')
class PolicyFixture {
  @Get('public')
  @PublicEndpoint()
  public() {
    return { public: true };
  }

  @Get('unannotated')
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
}

describe('default product permission boundary', () => {
  let app: NestFastifyApplication;
  const origin = 'http://localhost:5173';
  const csrf = 'fixture-csrf-token';
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
        { provide: APP_GUARD, useClass: UserSessionGuard },
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
});
