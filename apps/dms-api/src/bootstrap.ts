import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { LogController } from 'fastify';
import { AppModule } from './app.module.js';
import { SecurityTelemetryService } from './infrastructure/security-telemetry.service.js';
import { DmsExceptionFilter } from './modules/access/dms-errors.js';
import { AuthorityService } from './modules/platform-auth/authority/authority.service.js';
import { mountAuthorityHandler } from './modules/platform-auth/authority-handler.js';

export async function createApplication(logging = true): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: logging,
      genReqId: () => randomUUID(),
      bodyLimit: 16384,
      logController: new LogController({ disableRequestLogging: true }),
    }),
    logging ? {} : { logger: false },
  );
  app.setGlobalPrefix('v1', { exclude: ['health/live', 'health/ready/auth'] });
  const telemetry = app.get(SecurityTelemetryService);
  telemetry.enable(logging);
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onResponse', async (request, reply) => {
      telemetry.observe(request, reply);
    });
  await mountAuthorityHandler(app.getHttpAdapter().getInstance(), app.get(AuthorityService));
  app.useGlobalFilters(new DmsExceptionFilter());
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onSend', async (request, reply, payload) => {
      if (request.url.startsWith('/v1'))
        reply.header('cache-control', 'private, no-store').header('x-request-id', request.id);
      return payload;
    });
  app.enableShutdownHooks();
  return app;
}
