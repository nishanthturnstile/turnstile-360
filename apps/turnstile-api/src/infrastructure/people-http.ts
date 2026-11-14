import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import {
  PEOPLE_IMPORT_LIMITS,
  PEOPLE_LIMITS,
  type PeopleErrorDto,
  peopleErrorSchema,
  peopleIdSchema,
} from '@thaarei/turnstile-contracts';
import type { FastifyInstance } from 'fastify';

declare module 'fastify' {
  interface FastifyContextConfig {
    peopleEndpoint?: boolean;
  }
  interface FastifyRequest {
    peopleDeadlineAt?: number;
  }
}
export function peopleHttpFailure(
  response: unknown,
  status: number,
  requestId: string,
): PeopleErrorDto {
  const parsed = peopleErrorSchema.safeParse(
    response && typeof response === 'object' ? { ...response, requestId } : undefined,
  );
  if (parsed.success) return parsed.data;
  if (status === 401) return { code: 'IDENTITY_REQUIRED', requestId };
  if (status === 403) return { code: 'PERMISSION_DENIED', requestId };
  if (status === 404) return { code: 'PEOPLE_NOT_FOUND', requestId };
  if (status === 409) return { code: 'PEOPLE_CONFLICT', reason: 'state', requestId };
  if (status === 413) return { code: 'PEOPLE_TOO_LARGE', requestId };
  if (status === 415) return { code: 'PEOPLE_MEDIA_TYPE_UNSUPPORTED', requestId };
  if (status >= 500) return { code: 'PEOPLE_UNAVAILABLE', reason: 'dependency', requestId };
  return { code: 'PEOPLE_INVALID', requestId, fieldErrors: [{ field: 'body', reason: 'invalid' }] };
}
export function registerPeopleHttp(server: FastifyInstance) {
  const timers = new WeakMap<object, ReturnType<typeof setTimeout>>();
  server.addHook('onRoute', (route) => {
    if (
      !/^\/api\/people\/(?:imports(?:\/:id(?:\/(?:actions|errors))?)?|catalog|audit|members(?:\/:id(?:\/(?:access|assignments|suspend|reactivate))?)?|eligible-roles|roles(?:\/:id)?|invitations(?:\/:id(?:\/(?:resend|reapprove|cancel))?)?|impact|commands\/:id)\/?$/.test(
        route.url,
      )
    )
      return;
    route.config ??= {};
    route.config.peopleEndpoint = true;
    route.bodyLimit =
      route.url === '/api/people/imports' && route.method === 'POST'
        ? PEOPLE_IMPORT_LIMITS.bodyBytes
        : PEOPLE_LIMITS.bodyBytes;
  });
  server.addHook('onRequest', async (request, reply) => {
    if (!request.routeOptions.config.peopleEndpoint) return;
    const id = peopleIdSchema.safeParse(request.id);
    request.id = id.success ? id.data : randomUUID();
    request.peopleDeadlineAt = Date.now() + PEOPLE_LIMITS.requestTimeoutMs;
    const timer = setTimeout(() => {
      if (!reply.sent) reply.code(503).send(peopleHttpFailure(undefined, 503, request.id));
    }, PEOPLE_LIMITS.requestTimeoutMs);
    timer.unref();
    timers.set(request, timer);
    reply.header('cache-control', 'private, no-store').header('referrer-policy', 'no-referrer');
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      !/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')
    )
      throw new HttpException({ code: 'PEOPLE_MEDIA_TYPE_UNSUPPORTED' }, 415);
  });
  server.addHook('onResponse', async (request) => {
    clearTimeout(timers.get(request));
    timers.delete(request);
  });
  server.addHook('onSend', async (request, reply, payload) => {
    if (
      request.routeOptions.config.peopleEndpoint &&
      (typeof payload === 'string' || Buffer.isBuffer(payload)) &&
      Buffer.byteLength(payload) > PEOPLE_LIMITS.responseBytes
    ) {
      reply.code(503).removeHeader('content-length');
      return JSON.stringify(peopleHttpFailure(undefined, 503, request.id));
    }
    return payload;
  });
}
