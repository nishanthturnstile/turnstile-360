import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createApplication } from '../src/bootstrap.js';
import { BrowserAuthService } from '../src/modules/auth/browser-auth/browser-auth.service.js';

interface Registration {
  method: string | string[];
  url: string;
  flagged: boolean;
  bodyLimit: number | undefined;
}

describe('configuration HTTP parser and authentication boundary', () => {
  let app: NestFastifyApplication;
  const registrations: Registration[] = [];
  beforeAll(async () => {
    vi.stubEnv('TURNSTILE_COOKIE_SECRET', '');
    app = await createApplication(false);
    // Installed before init so it observes every route the configuration hook classifies.
    app
      .getHttpAdapter()
      .getInstance()
      .addHook('onRoute', (route) => {
        registrations.push({
          method: route.method,
          url: route.url,
          flagged: route.config?.configurationEndpoint === true,
          bodyLimit: route.bodyLimit,
        });
      });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
  });
  it('classifies every registered configuration route for body, media type and caching', () => {
    const expected = [
      ['GET', '/api/workspace/status'],
      ['GET', '/api/setup'],
      ['POST', '/api/setup/complete'],
      ['GET', '/api/organization'],
      ['PATCH', '/api/organization'],
      ['GET', '/api/organization/units'],
      ['POST', '/api/organization/units'],
      ['PATCH', '/api/organization/units/:id'],
      ['DELETE', '/api/organization/units/:id'],
    ] as const;
    const methods = (value: string | string[]) => (Array.isArray(value) ? value : [value]);
    const byKey = new Map(
      registrations.flatMap((route) =>
        methods(route.method).map((method) => [`${method} ${route.url}`, route] as const),
      ),
    );
    for (const [method, url] of expected) {
      const route = byKey.get(`${method} ${url}`);
      expect(route, `${method} ${url} must be registered`).toBeDefined();
      expect(route?.flagged, `${method} ${url} must be classified`).toBe(true);
      if (['POST', 'PATCH', 'DELETE'].includes(method)) expect(route?.bodyLimit).toBe(4096);
    }
    // The flagged set is asserted independently of the classification regex so a
    // renamed/moved feature route fails here instead of silently losing protections.
    expect(
      registrations
        .filter((route) => route.flagged)
        .flatMap((route) => methods(route.method).map((method) => `${method} ${route.url}`))
        .filter((key) => !key.startsWith('HEAD '))
        .sort(),
    ).toEqual(expected.map(([method, url]) => `${method} ${url}`).sort());
    expect(byKey.get('GET /api/auth/session')?.flagged).toBe(false);
  });
  it('projects bounded parser failures without exposing Nest/Fastify string exceptions or raw input', async () => {
    for (const [url, method] of [
      ['/api/setup/complete', 'POST'],
      ['/api/organization', 'PATCH'],
      ['/api/organization/units', 'POST'],
      ['/api/organization/units/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'PATCH'],
      ['/api/organization/units/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', 'DELETE'],
    ] as const) {
      for (const [payload, contentType, status, code] of [
        [
          JSON.stringify({ name: 'x'.repeat(5000) }),
          'application/json',
          413,
          'CONFIGURATION_TOO_LARGE',
        ],
        ['{private-invalid-input', 'application/json', 400, 'CONFIGURATION_INVALID'],
        ['{}', 'text/plain', 415, 'CONFIGURATION_MEDIA_TYPE_UNSUPPORTED'],
      ] as const) {
        const response = await app.inject({
          method,
          url,
          headers: { 'content-type': contentType },
          payload,
        });
        expect(response.statusCode, `${method} ${url}`).toBe(status);
        expect(response.json().code).toBe(code);
        expect(response.headers['cache-control']).toBe('private, no-store');
        expect(response.body).not.toContain('private-invalid-input');
      }
    }
  });
  it('retains the existing fail-closed identity boundary on every new route', async () => {
    for (const url of [
      '/api/workspace/status',
      '/api/setup',
      '/api/organization',
      '/api/organization/units',
    ]) {
      const response = await app.inject({ url });
      expect(response.statusCode).toBe(503);
      expect(response.json()).toEqual({ code: 'AUTH_UNAVAILABLE' });
    }
  });
  it('preserves generic authentication/permission failures without misclassifying them as body validation', async () => {
    const authenticate = vi.spyOn(app.get(BrowserAuthService), 'authenticate');
    try {
      for (const [error, status, code] of [
        [new UnauthorizedException('private authentication detail'), 401, 'IDENTITY_REQUIRED'],
        [new ForbiddenException('private permission detail'), 403, 'PERMISSION_DENIED'],
      ] as const) {
        authenticate.mockRejectedValueOnce(error);
        const response = await app.inject({ url: '/api/setup' });
        expect(response.statusCode).toBe(status);
        expect(response.json()).toEqual({ code });
        expect(response.body).not.toContain('private');
      }
    } finally {
      authenticate.mockRestore();
    }
  });
});
