import { HttpException } from '@nestjs/common';
import { PEOPLE_LIMITS, peopleErrorSchema } from '@thaarei/turnstile-contracts';
import type { FastifyInstance } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    recipientDeadlineAt?: number;
  }
  interface FastifyContextConfig {
    recipientEndpoint?: boolean;
  }
}
export function recipientFailure(response: unknown, status: number, requestId: string) {
  const safe = peopleErrorSchema.safeParse(
    response && typeof response === 'object' ? { ...response, requestId } : undefined,
  );
  if (safe.success) return safe.data;
  if (status === 401) return { code: 'INVITATION_IDENTITY_REQUIRED', requestId };
  if (status === 403) return { code: 'CSRF_REJECTED', requestId };
  if (status === 413) return { code: 'INVITATION_TOO_LARGE', requestId };
  if (status === 415) return { code: 'INVITATION_MEDIA_TYPE_UNSUPPORTED', requestId };
  if (status >= 500)
    return { code: 'INVITATION_UNAVAILABLE_RETRY', requestId, reason: 'dependency' };
  return {
    code: 'INVITATION_INVALID_REQUEST',
    requestId,
    fieldErrors: [{ field: 'body', reason: 'invalid' }],
  };
}
export function registerRecipientHttp(server: FastifyInstance) {
  server.addHook('onRoute', (route) => {
    if (
      !/^\/api\/invitations\/(?:exchange|context|start|setup|accept|decline|cancel|switch-account|logout)\/?$/.test(
        route.url,
      )
    )
      return;
    route.config ??= {};
    route.config.recipientEndpoint = true;
    route.bodyLimit = PEOPLE_LIMITS.bodyBytes;
  });
  server.addHook('onRequest', async (request, reply) => {
    if (!request.routeOptions.config.recipientEndpoint) return;
    request.recipientDeadlineAt = Date.now() + PEOPLE_LIMITS.requestTimeoutMs;
    reply.header('cache-control', 'private, no-store').header('referrer-policy', 'no-referrer');
    if (
      request.method === 'POST' &&
      !/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')
    )
      throw new HttpException({ code: 'INVITATION_MEDIA_TYPE_UNSUPPORTED' }, 415);
  });
  server.addHook('onSend', async (request, reply, payload) => {
    if (
      request.routeOptions.config.recipientEndpoint &&
      (typeof payload === 'string' || Buffer.isBuffer(payload)) &&
      Buffer.byteLength(payload) > PEOPLE_LIMITS.responseBytes
    ) {
      reply.code(503).removeHeader('content-length');
      return JSON.stringify(recipientFailure(undefined, 503, request.id));
    }
    return payload;
  });
}
