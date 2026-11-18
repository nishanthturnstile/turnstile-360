import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { LogController, type onRouteHookHandler } from 'fastify';
import { AppModule } from './app.module.js';
import { mountApiDocs } from './infrastructure/api-docs/api-docs.js';
import { SecurityTelemetryService } from './infrastructure/security-telemetry.service.js';
import { DmsExceptionFilter } from './modules/access/dms-errors.js';
import { AuthorityService } from './modules/platform-auth/authority/authority.service.js';
import { mountAuthorityHandler } from './modules/platform-auth/authority-handler.js';
import { mountIdentityHandler } from './modules/platform-auth/identity-handler.js';
import { IdentityServiceService } from './modules/platform-auth/identity-service.service.js';

export async function createApplication(
  logging = true,
  observeRoute?: onRouteHookHandler,
): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: logging
        ? {
            serializers: {
              err: () => ({ type: 'RequestError', message: 'Request rejected', stack: '' }),
              req: () => ({
                method: 'REDACTED',
                url: 'REDACTED',
                hostname: '',
                remoteAddress: '',
                remotePort: 0,
              }),
              res: (reply: { statusCode: number }) => ({ statusCode: reply.statusCode }),
            },
          }
        : false,
      genReqId: () => randomUUID(),
      bodyLimit: 16384,
      requestTimeout: 30000,
      connectionTimeout: 10000,
      keepAliveTimeout: 5000,
      forceCloseConnections: 'idle',
      logController: new LogController({ disableRequestLogging: true }),
    }),
    logging ? {} : { logger: false },
  );
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onRoute', (options) => {
      if (
        (options.method === 'POST' || options.method === 'PATCH') &&
        (options.url === '/v1/documents/:documentId' ||
          options.url === '/v1/uploads' ||
          options.url === '/v1/documents/:documentId/versions/uploads')
      )
        options.bodyLimit = 32768;
      if (options.method === 'POST' && options.url === '/v1/upload-batches')
        options.bodyLimit = 266240;
    });
  if (observeRoute) app.getHttpAdapter().getInstance().addHook('onRoute', observeRoute);
  app.setGlobalPrefix('v1', {
    exclude: [
      'health/deployment',
      'health/live',
      'health/ready/auth',
      'health/ready/api',
      'health/ready/processing',
    ],
  });
  await mountApiDocs(app.getHttpAdapter().getInstance());
  const telemetry = app.get(SecurityTelemetryService);
  telemetry.enable(logging);
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onResponse', async (request, reply) => {
      telemetry.observe(request, reply);
    });
  await mountIdentityHandler(app.getHttpAdapter().getInstance(), app.get(IdentityServiceService));
  await mountAuthorityHandler(app.getHttpAdapter().getInstance(), app.get(AuthorityService));
  app.useGlobalFilters(new DmsExceptionFilter());
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onSend', async (request, reply, payload) => {
      if (request.url.startsWith('/v1'))
        reply
          .header('cache-control', 'private, no-store')
          .header('referrer-policy', 'no-referrer')
          .header('x-request-id', request.id);
      return payload;
    });
  app.enableShutdownHooks();
  return app;
}
