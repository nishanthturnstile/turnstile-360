import { randomUUID } from 'node:crypto';
import {
  IDENTITY_SERVICE_ERROR_STATUS,
  IDENTITY_SERVICE_LIMITS,
  IDENTITY_SERVICE_SCOPES,
  identityPreparationPathSchema,
  identityPreparationRequestSchema,
  identityProjectionRequestSchema,
  identityServiceEmptySchema,
  identitySetupCompleteSchema,
  identitySetupExchangeSchema,
} from '@thaarei/dms-contracts/private';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { IdentityServiceError, type IdentityServiceService } from './identity-service.service.js';

export async function mountIdentityHandler(
  server: FastifyInstance,
  service: IdentityServiceService,
) {
  await server.register(async (scope) => {
    scope.addHook('onRequest', async (request, reply) => {
      reply
        .header('cache-control', 'private, no-store')
        .header('pragma', 'no-cache')
        .header('referrer-policy', 'no-referrer')
        .header('x-content-type-options', 'nosniff')
        .header('x-request-id', request.id);
      // GETs and request parsing also consume an installation/IP budget. No forwarded IP trust.
      await service.ensureReady();
      await service.rate('installation', 600);
      await service.rate(`ip:${request.ip}`, 120);
      if (Object.keys(request.query as object).length)
        throw new IdentityServiceError('IDENTITY_SERVICE_INVALID');
    });
    scope.setErrorHandler((error, request, reply) => {
      const code =
        error instanceof IdentityServiceError
          ? error.code
          : typeof error === 'object' &&
              error &&
              'statusCode' in error &&
              [400, 413, 415].includes(Number(error.statusCode))
            ? 'IDENTITY_SERVICE_INVALID'
            : 'IDENTITY_SERVICE_UNAVAILABLE';
      const rate = code === 'IDENTITY_SERVICE_RATE_LIMITED';
      if (rate) reply.header('retry-after', '60');
      reply.code(IDENTITY_SERVICE_ERROR_STATUS[code]).send({
        code,
        requestId: /^[0-9a-f-]{36}$/.test(request.id) ? request.id : randomUUID(),
        ...(rate ? { retryAfterSeconds: 60 } : {}),
      });
    });
    const parse = <T>(schema: z.ZodType<T>, input: unknown): T => {
      const result = schema.safeParse(input);
      if (!result.success) throw new IdentityServiceError('IDENTITY_SERVICE_INVALID');
      return result.data;
    };
    const browser = (request: FastifyRequest, csrf = false) => {
      if (
        request.headers['sec-fetch-site'] === 'cross-site' ||
        (request.headers.origin !== undefined && request.headers.origin !== service.origin) ||
        (request.method === 'POST' && request.headers.origin !== service.origin)
      )
        throw new IdentityServiceError('CSRF_REJECTED');
      const entries = (request.headers.cookie ?? '')
        .split(';')
        .map((v) => v.trim())
        .filter((v) => v.startsWith(`${service.cookie.name}=`));
      const cookie =
        entries.length === 1 ? (entries[0] ?? '').slice(service.cookie.name.length + 1) : '';
      if (!/^[A-Za-z0-9_-]{43}$/.test(cookie))
        throw new IdentityServiceError('IDENTITY_SETUP_UNAVAILABLE');
      if (csrf) service.checkCsrf(cookie, request.headers['x-csrf-token']);
      return cookie;
    };
    const options = { bodyLimit: IDENTITY_SERVICE_LIMITS.bodyBytes };
    scope.post('/internal/identity/v1/invitation-preparations', options, async (request) => {
      const p = await service.authenticate(
        request.headers.authorization,
        IDENTITY_SERVICE_SCOPES[0],
      );
      await service.rate(`prepare:${p.clientId}`, 20);
      return service.prepare(p, parse(identityPreparationRequestSchema, request.body));
    });
    scope.get('/internal/identity/v1/invitation-preparations/:id', async (request) => {
      const p = await service.authenticate(
        request.headers.authorization,
        IDENTITY_SERVICE_SCOPES[0],
      );
      return service.preparation(p, parse(identityPreparationPathSchema, request.params).id);
    });
    scope.post('/internal/identity/v1/subject-projections', options, async (request) => {
      const p = await service.authenticate(
        request.headers.authorization,
        IDENTITY_SERVICE_SCOPES[1],
      );
      return service.project(p, parse(identityProjectionRequestSchema, request.body));
    });
    scope.post('/identity/invitation-setup/exchange', options, async (request, reply) => {
      if (
        request.headers.origin !== service.origin ||
        request.headers['sec-fetch-site'] === 'cross-site'
      )
        throw new IdentityServiceError('CSRF_REJECTED');
      await service.rate(`exchange:${request.ip}`, 20);
      const { cookie, value } = await service.exchange(
        parse(identitySetupExchangeSchema, request.body).receipt,
      );
      reply.header(
        'set-cookie',
        `${service.cookie.name}=${cookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=1800${service.cookie.secure ? '; Secure' : ''}`,
      );
      return value;
    });
    scope.get('/identity/invitation-setup/context', async (request) =>
      service.context(browser(request)),
    );
    scope.post('/identity/invitation-setup/complete', options, async (request) => {
      const cookie = browser(request, true);
      await service.rate(`complete:${request.ip}`, 10);
      return service.complete(cookie, parse(identitySetupCompleteSchema, request.body));
    });
    scope.post('/identity/invitation-setup/cancel', options, async (request, reply) => {
      const cookie = browser(request, true);
      parse(identityServiceEmptySchema, request.body);
      const value = await service.cancel(cookie);
      reply.header(
        'set-cookie',
        `${service.cookie.name}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${service.cookie.secure ? '; Secure' : ''}`,
      );
      return value;
    });
  });
}
