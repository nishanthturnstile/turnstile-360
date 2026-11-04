import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import {
  PEOPLE_ERROR_STATUS,
  PEOPLE_LIMITS,
  type PeopleErrorDto,
  peopleErrorSchema,
  peopleIdSchema,
} from '@thaarei/turnstile-contracts';
import type { FastifyInstance } from 'fastify';

declare module 'fastify' {
  interface FastifyContextConfig {
    structureEndpoint?: boolean;
  }
  interface FastifyRequest {
    structureDeadlineAt?: number;
  }
}

export class StructureException extends HttpException {
  constructor(error: PeopleErrorDto) {
    const safe = peopleErrorSchema.parse(error);
    super(safe, PEOPLE_ERROR_STATUS[safe.code]);
  }
}

export function structureFailure(
  response: unknown,
  status: number,
  requestId: string,
): PeopleErrorDto {
  if (response && typeof response === 'object') {
    const safe = peopleErrorSchema.safeParse({ ...response, requestId });
    if (safe.success) return safe.data;
  }
  if (status === 401) return { code: 'IDENTITY_REQUIRED', requestId };
  if (status === 403) return { code: 'PERMISSION_DENIED', requestId };
  if (status === 404) return { code: 'STRUCTURE_NOT_FOUND', requestId };
  if (status === 409) return { code: 'STRUCTURE_CONFLICT', requestId, reason: 'state' };
  if (status === 413) return { code: 'STRUCTURE_TOO_LARGE', requestId };
  if (status === 415) return { code: 'STRUCTURE_MEDIA_TYPE_UNSUPPORTED', requestId };
  if (status >= 500) return { code: 'STRUCTURE_UNAVAILABLE', requestId, reason: 'dependency' };
  return {
    code: 'STRUCTURE_INVALID',
    requestId,
    fieldErrors: [{ field: 'body', reason: 'invalid' }],
  };
}

export function registerStructureHttp(server: FastifyInstance) {
  const timers = new WeakMap<object, ReturnType<typeof setTimeout>>();
  server.addHook('onRoute', (route) => {
    if (
      !/^\/api\/structure\/(?:units(?:\/:id(?:\/parent)?)?|move-impact|commands\/:id)\/?$/.test(
        route.url,
      )
    )
      return;
    route.config ??= {};
    route.config.structureEndpoint = true;
    route.bodyLimit = PEOPLE_LIMITS.bodyBytes;
  });
  server.addHook('onRequest', async (request, reply) => {
    if (!request.routeOptions?.config?.structureEndpoint) return;
    const id = peopleIdSchema.safeParse(request.id);
    request.id = id.success ? id.data : randomUUID();
    request.structureDeadlineAt = Date.now() + PEOPLE_LIMITS.requestTimeoutMs;
    const timer = setTimeout(() => {
      if (!reply.sent) reply.code(503).send(structureFailure(undefined, 503, request.id));
    }, PEOPLE_LIMITS.requestTimeoutMs);
    timer.unref();
    timers.set(request, timer);
    reply.header('cache-control', 'private, no-store').header('referrer-policy', 'no-referrer');
    if (
      ['POST', 'PATCH', 'DELETE'].includes(request.method) &&
      !/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')
    )
      throw new StructureException({
        code: 'STRUCTURE_MEDIA_TYPE_UNSUPPORTED',
        requestId: request.id,
      });
  });
  server.addHook('onResponse', async (request) => {
    clearTimeout(timers.get(request));
    timers.delete(request);
  });
  server.addHook('onSend', async (request, reply, payload) => {
    if (
      request.routeOptions?.config?.structureEndpoint &&
      (typeof payload === 'string' || Buffer.isBuffer(payload)) &&
      Buffer.byteLength(payload) > PEOPLE_LIMITS.responseBytes
    ) {
      reply.code(503).removeHeader('content-length');
      return JSON.stringify(structureFailure(undefined, 503, request.id));
    }
    return payload;
  });
}
