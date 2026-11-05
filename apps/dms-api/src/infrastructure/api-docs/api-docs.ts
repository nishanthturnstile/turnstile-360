import { createHash, timingSafeEqual } from 'node:crypto';
import { createRequire } from 'node:module';
import swagger, { type StaticDocumentSpec } from '@fastify/swagger';
import swaggerUi, { type FastifySwaggerUiConfigOptions } from '@fastify/swagger-ui';
import { dmsPublicOpenApi } from '@thaarei/dms-contracts/openapi';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

export function docsConfiguration(environment = process.env) {
  const mode = z
    .enum(['off', 'loopback', 'controlled'])
    .default('off')
    .safeParse(environment.DMS_DOCS_MODE);
  if (!mode.success) throw new Error('Invalid DMS_DOCS_MODE');
  if (mode.data === 'off') return undefined;
  const key = environment.DMS_DOCS_ACCESS_KEY;
  if (!key || key.length < 32 || key.length > 256 || new Set(key).size < 16 || /[\r\n:]/.test(key))
    throw new Error('DMS docs require an independently generated DMS_DOCS_ACCESS_KEY');
  if (
    [
      environment.AUTH_SECRET,
      environment.AUTH_LOGIN_CLIENT_SECRET,
      environment.DMS_MACHINE_CLIENT_SECRET,
    ].includes(key)
  )
    throw new Error('DMS docs access must use a separate credential');
  if (
    mode.data === 'loopback' &&
    !['127.0.0.1', 'localhost', '::1'].includes(environment.HOST ?? '127.0.0.1')
  )
    throw new Error(
      'Loopback docs require a loopback listener; remote binding needs controlled mode',
    );
  if (environment.NODE_ENV === 'production' || environment.AUTH_PROFILE === 'production') {
    if (!environment.AUTH_PUBLIC_ORIGIN?.startsWith('https://'))
      throw new Error('Production docs require configured HTTPS ingress');
  }
  return { mode: mode.data, digest: createHash('sha256').update(`operator:${key}`).digest() };
}

// Serve only the hardened entry/configuration and the assets it needs. The upstream
// baseDir wildcard otherwise exposes a second stock index and petstore initializer.
const entryPaths = new Set([
  '/docs',
  '/docs/',
  '/docs/index.html',
  '/docs/static',
  '/docs/static/',
  '/docs/static/index.html',
]);
const schemaPaths = new Set(['/docs/openapi.json', '/docs/json', '/docs/yaml']);
const assetNames = new Set([
  'swagger-initializer.js',
  'swagger-ui-bundle.js',
  'swagger-ui-standalone-preset.js',
  'swagger-ui.css',
  'index.css',
  'favicon-16x16.png',
  'favicon-32x32.png',
  'LICENSE',
  'NOTICE',
  'swagger-ui-bundle.js.LICENSE.txt',
  'swagger-ui-standalone-preset.js.LICENSE.txt',
  'swagger-ui.js.LICENSE.txt',
]);

export async function mountApiDocs(server: FastifyInstance) {
  const config = docsConfiguration();
  if (!config) return;
  // Encapsulation protects UI, config, JSON/YAML and every bundled static asset,
  // including assets that upstream uiHooks do not cover.
  await server.register(async (scope) => {
    scope.addHook('onRequest', async (request, reply) => {
      reply
        .header('cache-control', 'private, no-store')
        .header('referrer-policy', 'no-referrer')
        .header('x-content-type-options', 'nosniff');
      const raw = request.headers.authorization;
      const basic =
        typeof raw === 'string' && /^Basic [A-Za-z0-9+/]+={0,2}$/.test(raw)
          ? Buffer.from(raw.slice(6), 'base64').toString('utf8')
          : '';
      const valid = timingSafeEqual(createHash('sha256').update(basic).digest(), config.digest);
      if (!valid)
        return reply
          .code(401)
          .header('www-authenticate', 'Basic realm="dms-docs", charset="UTF-8"')
          .send({ code: 'DOCS_ACCESS_REQUIRED' });
      const url = new URL(request.url, 'http://localhost');
      if (entryPaths.has(url.pathname)) {
        if (url.search || !['/docs', '/docs/'].includes(url.pathname))
          return reply.redirect('/docs/');
      } else if (
        !schemaPaths.has(url.pathname) &&
        !(
          url.pathname.startsWith('/docs/static/') &&
          assetNames.has(url.pathname.slice('/docs/static/'.length))
        )
      ) {
        return reply.code(404).send({ code: 'NOT_FOUND' });
      }
    });
    scope.addHook('onSend', async (_request, reply, payload) => {
      reply.header('cache-control', 'private, no-store');
      reply.header(
        'content-security-policy',
        "default-src 'none'; base-uri 'none'; frame-ancestors 'none'; object-src 'none'; script-src 'self'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; form-action 'none'",
      );
      return payload;
    });
    await scope.register(swagger, {
      mode: 'static',
      // Static mode passes the 3.1 document unchanged. Upstream typings still
      // describe 3.0 schemas; generator and packaged browser tests verify 3.1.
      specification: { document: dmsPublicOpenApi as unknown as StaticDocumentSpec['document'] },
    });
    scope.get('/docs/openapi.json', async () => dmsPublicOpenApi);
    type AuthDefinitions = {
      filter: (
        predicate: (definition: { has: (key: string) => boolean }) => boolean,
      ) => AuthDefinitions;
    };
    const uiConfig: FastifySwaggerUiConfigOptions & { queryConfigEnabled: boolean } = {
      layout: 'BaseLayout',
      plugins: [
        () => ({
          statePlugins: {
            auth: {
              wrapSelectors: {
                definitionsToAuthorize:
                  (original: (...args: unknown[]) => AuthDefinitions) =>
                  (...args: unknown[]) =>
                    original(...args).filter((definition) => definition.has('MachineBearer')),
              },
            },
          },
        }),
      ],
      persistAuthorization: false,
      queryConfigEnabled: false,
      supportedSubmitMethods: ['get'],
      withCredentials: false,
      defaultModelsExpandDepth: -1,
      requestInterceptor: (request) => {
        const origin = (globalThis as unknown as { location: { origin: string } }).location.origin;
        const target = new URL(request.url, origin);
        if (
          target.origin !== origin ||
          !['GET', 'HEAD'].includes(String(request.method ?? 'GET').toUpperCase()) ||
          !(
            target.pathname.startsWith('/docs/') ||
            target.pathname === '/v1' ||
            target.pathname === '/v1/capabilities' ||
            target.pathname === '/v1/audit'
          )
        )
          throw new Error(
            'Explorer execution is limited to implemented same-origin reads; use the private CLI recipe for enrollment.',
          );
        return request;
      },
    };
    await scope.register(swaggerUi, {
      baseDir: (
        createRequire(import.meta.url)('swagger-ui-dist') as { getAbsoluteFSPath: () => string }
      ).getAbsoluteFSPath(),
      routePrefix: '/docs',
      validatorUrl: false,
      theme: { title: 'Thaarei DMS — consumer API' },
      uiConfig,
    });
  });
}
