import { randomUUID } from 'node:crypto';
import { Transform } from 'node:stream';
import { HttpException } from '@nestjs/common';
import {
  DOCUMENTS_LIMITS,
  DOCUMENTS_REQUEST_ID_HEADER,
  documentsCommandBodyLimit,
  documentsDraftRequestSchema,
  documentsErrorSchema,
  documentsJsonBytes,
} from '@thaarei/turnstile-contracts/documents';
import type { FastifyInstance } from 'fastify';

declare module 'fastify' {
  interface FastifyContextConfig {
    documentsEndpoint?: boolean;
  }
  interface FastifyRequest {
    documentsDeadlineAt?: number;
  }
}
export function documentsHttpFailure(response: unknown, status: number, requestId: string) {
  const parsed = documentsErrorSchema.safeParse(
    response && typeof response === 'object' ? { ...response, requestId } : undefined,
  );
  if (parsed.success) return parsed.data;
  if (
    response &&
    typeof response === 'object' &&
    'code' in response &&
    response.code === 'DEPLOYMENT_RESTRICTED'
  )
    return documentsErrorSchema.parse({
      code: 'DEPLOYMENT_RESTRICTED',
      requestId,
      guidance: 'wait_for_access',
    });
  return documentsErrorSchema.parse({
    code:
      status === 401
        ? 'LOGIN_REQUIRED'
        : status === 403
          ? 'DOCUMENTS_DENIED'
          : status === 404
            ? 'DOCUMENTS_NOT_FOUND'
            : status === 410
              ? 'DOCUMENTS_INTENT_GONE'
              : status === 429
                ? 'DOCUMENTS_CAPACITY'
                : status === 409
                  ? 'DOCUMENTS_CONFLICT'
                  : status === 413
                    ? 'DOCUMENTS_TOO_LARGE'
                    : status === 415
                      ? 'DOCUMENTS_MEDIA_TYPE_UNSUPPORTED'
                      : status >= 500
                        ? 'DOCUMENTS_UNAVAILABLE'
                        : 'DOCUMENTS_INVALID',
    requestId,
    guidance:
      status === 401
        ? 'sign_in'
        : status === 403
          ? 'wait_for_access'
          : status === 409
            ? 'review_conflict'
            : 'correct_input',
  });
}
export function registerDocumentsHttp(server: FastifyInstance) {
  const draftBytes = new WeakMap<object, { receivedEncodedLength: number }>();
  const timers = new WeakMap<object, ReturnType<typeof setTimeout>>();
  server.addHook('onRoute', (route) => {
    if (!/^\/api\/documents(?:\/|$)/.test(route.url)) return;
    route.config ??= {};
    route.config.documentsEndpoint = true;
    route.bodyLimit =
      route.url === '/api/documents/operations' && route.method === 'POST'
        ? DOCUMENTS_LIMITS.batchEnvelopeBytes
        : DOCUMENTS_LIMITS.ordinaryRequestBytes;
  });
  server.addHook('onRequest', async (request, reply) => {
    if (!request.routeOptions.config.documentsEndpoint) return;
    request.id = randomUUID();
    request.documentsDeadlineAt = Date.now() + DOCUMENTS_LIMITS.handlerTimeoutMs;
    reply
      .header(DOCUMENTS_REQUEST_ID_HEADER, request.id)
      .header('cache-control', 'private, no-store')
      .header('referrer-policy', 'no-referrer');
    const timer = setTimeout(() => {
      if (!reply.sent) reply.code(503).send(documentsHttpFailure(undefined, 503, request.id));
    }, DOCUMENTS_LIMITS.handlerTimeoutMs);
    timer.unref();
    timers.set(request, timer);
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(request.method) &&
      !/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')
    )
      throw new HttpException({ code: 'DOCUMENTS_MEDIA_TYPE_UNSUPPORTED' }, 415);
  });
  server.addHook('preParsing', (request, _reply, stream, done) => {
    if (request.routeOptions.url !== '/api/documents/operations' || request.method !== 'POST')
      return done(null, stream);
    const counter = Object.assign(
      new Transform({
        transform(chunk: Buffer, _encoding, next) {
          counter.receivedEncodedLength += chunk.length;
          next(null, chunk);
        },
      }),
      { receivedEncodedLength: 0 },
    );
    draftBytes.set(request, counter);
    stream.once('error', (error) => counter.destroy(error));
    counter.once('close', () => stream.unpipe(counter));
    done(null, stream.pipe(counter));
  });
  server.addHook('preValidation', async (request) => {
    if (request.routeOptions.url !== '/api/documents/operations' || request.method !== 'POST')
      return;
    const body = request.body as { command?: { kind?: unknown; payload?: unknown } } | null;
    const command = body?.command;
    if (
      (draftBytes.get(request)?.receivedEncodedLength ?? 0) >
        documentsCommandBodyLimit(command?.kind) ||
      (command?.kind === 'batch.create' &&
        command.payload !== undefined &&
        documentsJsonBytes(command.payload) > DOCUMENTS_LIMITS.manifestBytes)
    )
      throw new HttpException({ code: 'DOCUMENTS_TOO_LARGE' }, 413);
    const parsed = documentsDraftRequestSchema.safeParse(request.body);
    if (!parsed.success) throw new HttpException({ code: 'DOCUMENTS_INVALID' }, 400);
  });
  server.addHook('onResponse', async (request) => {
    clearTimeout(timers.get(request));
    timers.delete(request);
  });
  server.addHook('onSend', async (request, reply, payload) => {
    if (
      request.routeOptions.config.documentsEndpoint &&
      (typeof payload === 'string' || Buffer.isBuffer(payload)) &&
      Buffer.byteLength(payload) > DOCUMENTS_LIMITS.responseBytes
    ) {
      reply.code(503).removeHeader('content-length');
      return JSON.stringify(documentsHttpFailure(undefined, 503, request.id));
    }
    return payload;
  });
}
