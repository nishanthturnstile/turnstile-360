import { randomBytes } from 'node:crypto';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { ModulesContainer, Reflector } from '@nestjs/core';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { dmsPublicOpenApi } from '@thaarei/dms-contracts/openapi';
import { DMS_PUBLIC_ROUTES, dmsErrorSchema } from '@thaarei/dms-contracts/public';
import { createApplication } from '../src/bootstrap.js';
import { docsConfiguration } from '../src/infrastructure/api-docs/api-docs.js';
import { DMS_POLICY, DMS_PUBLIC } from '../src/modules/access/access-policy.js';
import { DMS_OPERATION } from '../src/modules/access/dms-operation.js';

describe('protected consumer explorer and route contract', () => {
  let app: NestFastifyApplication;
  const physicalRoutes: { method: string; path: string }[] = [];
  const key = randomBytes(32).toString('base64url');
  const authorization = `Basic ${Buffer.from(`operator:${key}`).toString('base64')}`;
  beforeAll(async () => {
    vi.stubEnv('DMS_DOCS_MODE', 'loopback');
    vi.stubEnv('DMS_DOCS_ACCESS_KEY', key);
    vi.stubEnv('HOST', '127.0.0.1');
    vi.stubEnv('AUTH_SECRET', '');
    app = await createApplication(false, (route) => {
      const path = route.url.replace(/\/$/, '').replace(/:([^/]+)/g, '{$1}');
      if (path === '/v1' || path.startsWith('/v1/'))
        for (const method of Array.isArray(route.method) ? route.method : [route.method])
          physicalRoutes.push({ method, path });
    });
    await app.init();
    await app.getHttpAdapter().getInstance().ready();
  });
  afterAll(async () => {
    await app?.close();
    vi.unstubAllEnvs();
  });

  it('protects UI, schema, configuration, aliases and static assets with one boundary', async () => {
    for (const url of [
      '/docs',
      '/docs/',
      '/docs/openapi.json',
      '/docs/json',
      '/docs/yaml',
      '/docs/static/swagger-initializer.js',
      '/docs/static/swagger-ui-bundle.js',
      '/docs/static/swagger-ui.css',
    ]) {
      const missing = await app.inject({ method: 'GET', url });
      expect(missing.statusCode).toBe(401);
      expect(missing.headers['cache-control']).toBe('private, no-store');
      expect(
        (await app.inject({ method: 'GET', url, headers: { authorization: 'Bearer wrong' } }))
          .statusCode,
      ).toBe(401);
      const allowed = await app.inject({ method: 'GET', url, headers: { authorization } });
      expect(allowed.statusCode).toBeLessThan(400);
    }
    const spec = await app.inject({
      method: 'GET',
      url: '/docs/openapi.json',
      headers: { authorization },
    });
    expect(spec.json()).toEqual(dmsPublicOpenApi);
    expect(
      (await app.inject({ method: 'GET', url: '/docs/json', headers: { authorization } })).json(),
    ).toEqual(dmsPublicOpenApi);
    expect(Object.keys(spec.json().paths).sort()).toEqual(
      [
        '/v1',
        '/v1/search',
        '/v1/application-enrollments',
        '/v1/admission-policy',
        '/v1/audit',
        '/v1/documents',
        '/v1/documents/{documentId}',
        '/v1/documents/{documentId}/audit',
        '/v1/documents/{documentId}/permissions',
        '/v1/documents/{documentId}/lifecycle',
        '/v1/documents/{documentId}/restore',
        '/v1/documents/{documentId}/references',
        '/v1/documents/{documentId}/references/{referenceId}',
        '/v1/documents/{documentId}/download',
        '/v1/documents/{documentId}/processing',
        '/v1/documents/{documentId}/content',
        '/v1/documents/{documentId}/versions',
        '/v1/documents/{documentId}/versions/uploads',
        '/v1/documents/{documentId}/versions/{versionId}',
        '/v1/documents/{documentId}/versions/{versionId}/restore',
        '/v1/documents/{documentId}/versions/{versionId}/reprocess',
        '/v1/capabilities',
        '/v1/uploads',
        '/v1/uploads/{uploadId}',
        '/v1/uploads/{uploadId}/complete',
        '/v1/uploads/{uploadId}/refresh',
        '/v1/upload-batches',
        '/v1/upload-batches/{batchId}',
        '/v1/upload-batches/{batchId}/close',
      ].sort(),
    );
  });
  it('normalizes stock UI entries and rejects alternate configuration or wildcard assets', async () => {
    for (const url of [
      '/docs/index.html',
      '/docs/index.html?url=https://untrusted.invalid/spec',
      '/docs/static',
      '/docs/static/',
      '/docs/static/index.html',
    ]) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
      const response = await app.inject({ method: 'GET', url, headers: { authorization } });
      expect(response.statusCode).toBe(302);
      expect(response.headers.location).toBe('/docs/');
    }
    for (const url of [
      '/docs/swagger-initializer.js',
      '/docs/swagger-ui.js',
      '/docs/package.json',
      '/docs/static/swagger-ui.js',
      '/docs/static/oauth2-redirect.html',
    ]) {
      expect((await app.inject({ method: 'GET', url })).statusCode).toBe(401);
      const response = await app.inject({ method: 'GET', url, headers: { authorization } });
      expect(response.statusCode).toBe(404);
      expect(response.body).not.toContain('petstore');
    }
    const initializer = await app.inject({
      method: 'GET',
      url: '/docs/static/swagger-initializer.js',
      headers: { authorization },
    });
    expect(initializer.statusCode).toBe(200);
    expect(initializer.body).not.toContain('petstore');
    expect(initializer.body).toContain('"supportedSubmitMethods":["get"]');
  });

  it('does not let explorer credentials, cookies or malformed tokens replace machine authority', async () => {
    expect((await app.inject({ method: 'HEAD', url: '/v1/capabilities' })).statusCode).toBe(401);
    for (const headers of [
      {},
      { authorization },
      { cookie: 'session=untrusted' },
      { authorization: 'Bearer wrong' },
      // Central deployment credentials are opaque 256-bit secrets, never DMS access JWTs.
      { authorization: `Bearer ${randomBytes(32).toString('base64url')}` },
    ]) {
      const response = await app.inject({ method: 'GET', url: '/v1/capabilities', headers });
      expect(response.statusCode).toBe(401);
      expect(dmsErrorSchema.safeParse(response.json()).success).toBe(true);
      expect(response.json().requestId).toBe(response.headers['x-request-id']);
      expect(response.headers['www-authenticate']).toBe('Bearer realm="dms"');
    }
  });
  it('keeps parser failures in the shared envelope and never reflects caller request IDs', async () => {
    const oversized = await app.inject({
      method: 'POST',
      url: '/v1/application-enrollments',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ name: 'x'.repeat(18000) }),
    });
    expect(oversized.statusCode).toBe(413);
    expect(dmsErrorSchema.safeParse(oversized.json()).success).toBe(true);
    const response = await app.inject({
      method: 'GET',
      url: '/v1/capabilities',
      headers: { 'x-request-id': 'caller-chosen' },
    });
    expect(response.json().requestId).not.toBe('caller-chosen');
    expect(response.json().requestId).toBe(response.headers['x-request-id']);
  });

  it('keeps browser execution read-only, auth ephemeral and resources local', async () => {
    const init = await app.inject({
      method: 'GET',
      url: '/docs/static/swagger-initializer.js',
      headers: { authorization },
    });
    expect(init.body).toContain('"persistAuthorization":false');
    expect(init.body).toContain('"supportedSubmitMethods":["get"]');
    expect(init.body).toContain('validatorUrl: null');
    expect(init.body).not.toContain(key);
    const html = await app.inject({ method: 'GET', url: '/docs/', headers: { authorization } });
    expect(html.headers['content-security-policy']).toContain("connect-src 'self'");
    expect(html.headers['content-security-policy']).not.toMatch(/https:|validator\.swagger/);
    expect(html.body).not.toMatch(/(?:src|href)="https?:/);
  });
  it('matches every real versioned handler to a public operation and its effective guard metadata', () => {
    for (const actual of physicalRoutes) {
      const method = actual.method === 'HEAD' ? 'GET' : actual.method;
      expect(
        DMS_PUBLIC_ROUTES.find((route) => route.path === actual.path && route.method === method),
        `Undocumented Fastify route ${actual.method} ${actual.path}`,
      ).toBeDefined();
    }
    expect(new Set(physicalRoutes.map((route) => `${route.method} ${route.path}`))).toEqual(
      new Set(
        DMS_PUBLIC_ROUTES.flatMap((route) => [
          `${route.method} ${route.path}`,
          ...(route.method === 'GET' ? [`HEAD ${route.path}`] : []),
        ]),
      ),
    );
    const reflector = app.get(Reflector);
    const seen: string[] = [];
    for (const module of app.get(ModulesContainer).values())
      for (const controller of module.controllers.values()) {
        const type = controller.metatype;
        if (!type) continue;
        const root = Reflect.getMetadata(PATH_METADATA, type) as string | undefined;
        if (root?.startsWith('health')) continue;
        for (const name of Object.getOwnPropertyNames(type.prototype)) {
          const handler = type.prototype[name];
          const method = Reflect.getMetadata(METHOD_METADATA, handler);
          if (method === undefined) continue;
          const suffix = Reflect.getMetadata(PATH_METADATA, handler) as string;
          const path = `/v1/${root ?? ''}/${suffix ?? ''}`
            .replace(/\/+/g, '/')
            .replace(/\/$/, '')
            .replace(/:([^/]+)/g, '{$1}');
          const id = reflector.getAllAndOverride<string>(DMS_OPERATION, [handler, type]);
          const contract = DMS_PUBLIC_ROUTES.find((route) => route.operationId === id);
          expect(contract, `Undocumented handler ${path}`).toBeDefined();
          expect(contract?.path).toBe(path);
          expect(contract?.method).toBe(
            method === 0
              ? 'GET'
              : method === 1
                ? 'POST'
                : method === 2
                  ? 'PUT'
                  : method === 3
                    ? 'DELETE'
                    : method === 4
                      ? 'PATCH'
                      : 'UNSUPPORTED',
          );
          const isPublic =
            reflector.getAllAndOverride<boolean>(DMS_PUBLIC, [handler, type]) ?? false;
          expect(isPublic).toBe(contract?.policy === 'public');
          if (!isPublic)
            expect(reflector.getAllAndOverride(DMS_POLICY, [handler, type])).toEqual(
              contract?.policy === 'enrollment'
                ? { kind: 'enrollment' }
                : { kind: 'normal', scopes: contract?.scopes },
            );
          seen.push(id ?? '');
        }
      }
    expect(seen.sort()).toEqual(DMS_PUBLIC_ROUTES.map((route) => route.operationId).sort());
  });
  it('fails closed on unsafe docs configuration and leaves documentation off by default', async () => {
    expect(docsConfiguration({})).toBeUndefined();
    vi.stubEnv('DMS_DOCS_MODE', 'off');
    const disabled = await createApplication(false);
    try {
      await disabled.init();
      await disabled.getHttpAdapter().getInstance().ready();
      for (const url of ['/docs', '/docs/openapi.json', '/docs/static/swagger-ui-bundle.js'])
        expect((await disabled.inject({ method: 'GET', url })).statusCode).toBe(404);
    } finally {
      await disabled.close();
      vi.stubEnv('DMS_DOCS_MODE', 'loopback');
    }
    expect(() =>
      docsConfiguration({
        DMS_DOCS_MODE: 'controlled',
        DMS_DOCS_ACCESS_KEY: key,
        AUTH_SECRET: key,
      }),
    ).toThrow();
    expect(() =>
      docsConfiguration({ DMS_DOCS_MODE: 'loopback', DMS_DOCS_ACCESS_KEY: key, HOST: '0.0.0.0' }),
    ).toThrow();
    expect(() =>
      docsConfiguration({
        DMS_DOCS_MODE: 'controlled',
        DMS_DOCS_ACCESS_KEY: key,
        NODE_ENV: 'production',
        AUTH_PUBLIC_ORIGIN: 'http://localhost',
      }),
    ).toThrow();
    expect(() =>
      docsConfiguration({ DMS_DOCS_MODE: 'controlled', DMS_DOCS_ACCESS_KEY: 'short' }),
    ).toThrow();
  });
});
