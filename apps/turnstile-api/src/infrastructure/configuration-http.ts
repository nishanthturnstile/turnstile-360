import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import {
  CONFIGURATION_LIMITS,
  type ConfigurationErrorDto,
  configurationActorSchema,
  configurationIdSchema,
  configurationQuerySchema,
} from '@thaarei/turnstile-contracts';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { ConfigurationActor } from './configuration-context.js';
import { ConfigurationException } from './configuration-exception.js';
import { parseConfiguration } from './configuration-validation.js';

declare module 'fastify' {
  interface FastifyContextConfig {
    configurationEndpoint?: boolean;
  }
}

export function configurationActor(request: FastifyRequest): ConfigurationActor {
  parseConfiguration(configurationQuerySchema, request.query);
  return productActor(request);
}

export function productActor(request: FastifyRequest): ConfigurationActor {
  if (!request.productUser) throw new HttpException({ code: 'IDENTITY_REQUIRED' }, 401);
  // bootstrap.ts sets a UUID request id. Keep an insertable audit identity valid
  // for any other factory/adapter by generating one server-side, never from input.
  const parsedId = configurationIdSchema.safeParse(request.id);
  request.id = parsedId.success ? parsedId.data : randomUUID();
  return {
    userId: configurationActorSchema.parse(request.productUser.identity.user.id),
    requestId: request.id,
    ...(request.structureDeadlineAt ? { deadlineAt: request.structureDeadlineAt } : {}),
    ...(request.productUser.identity.access
      ? { accessFingerprint: request.productUser.identity.access.fingerprint }
      : {}),
  };
}

export function registerConfigurationHttp(server: FastifyInstance) {
  server.addHook('onRoute', (route) => {
    if (
      !/^\/api\/(?:workspace\/status|setup(?:\/complete)?|organization(?:\/units(?:\/:id(?:\/parent)?)?)?)\/?$/.test(
        route.url,
      )
    )
      return;
    route.config ??= {};
    route.config.configurationEndpoint = true;
    if (
      ['POST', 'PATCH', 'DELETE'].some((method) =>
        (Array.isArray(route.method) ? route.method : [route.method]).includes(method),
      )
    )
      route.bodyLimit = CONFIGURATION_LIMITS.bodyBytes;
  });
  server.addHook('onRequest', async (request, reply) => {
    if (request.routeOptions?.config?.configurationEndpoint) {
      reply.header('cache-control', 'private, no-store').header('referrer-policy', 'no-referrer');
      if (
        ['POST', 'PATCH', 'DELETE'].includes(request.method) &&
        !/^application\/json(?:\s*;|$)/i.test(request.headers['content-type'] ?? '')
      )
        throw new ConfigurationException({ code: 'CONFIGURATION_MEDIA_TYPE_UNSUPPORTED' });
    }
  });
  server.addHook('onSend', async (request, reply, payload) => {
    if (
      request.routeOptions?.config?.configurationEndpoint &&
      (typeof payload === 'string' || Buffer.isBuffer(payload)) &&
      Buffer.byteLength(payload) > CONFIGURATION_LIMITS.responseBytes
    ) {
      reply.code(503).header('cache-control', 'private, no-store').removeHeader('content-length');
      return JSON.stringify({ code: 'CONFIGURATION_UNAVAILABLE' });
    }
    return payload;
  });
}

export function configurationParserError(status: number): ConfigurationErrorDto {
  if (status === 413) return { code: 'CONFIGURATION_TOO_LARGE' };
  if (status === 415) return { code: 'CONFIGURATION_MEDIA_TYPE_UNSUPPORTED' };
  if (status >= 500) return { code: 'CONFIGURATION_UNAVAILABLE' };
  return { code: 'CONFIGURATION_INVALID', fieldErrors: [{ field: 'body', reason: 'invalid' }] };
}
