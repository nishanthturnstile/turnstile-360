import { randomUUID } from 'node:crypto';
import { HttpException } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { LogController } from 'fastify';
import { SecurityTelemetryService } from './infrastructure/security-telemetry.service.js';
import { PrivateWorkModule } from './modules/processing/private-work.module.js';
import { WorkError } from './modules/processing/work-configuration.js';

export async function createWorkApplication(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    PrivateWorkModule,
    new FastifyAdapter({
      logger: false,
      bodyLimit: 16384,
      genReqId: () => randomUUID(),
      logController: new LogController({ disableRequestLogging: true }),
    }),
    { logger: false },
  );
  app.useGlobalFilters({
    catch(error: unknown, host) {
      const reply = host.switchToHttp().getResponse();
      const request = host.switchToHttp().getRequest();
      const status =
        error instanceof WorkError
          ? error.status
          : error instanceof HttpException
            ? error.getStatus()
            : error &&
                typeof error === 'object' &&
                'statusCode' in error &&
                typeof error.statusCode === 'number' &&
                error.statusCode < 500
              ? error.statusCode
              : 503;
      const code =
        error instanceof WorkError
          ? error.code
          : status === 401
            ? 'WORK_AUTH_REQUIRED'
            : status === 403
              ? 'WORK_DENIED'
              : status < 500
                ? 'WORK_INVALID'
                : 'WORK_UNAVAILABLE';
      reply
        .code(status)
        .header('cache-control', 'private, no-store')
        .header('x-request-id', request.id)
        .send({ code, requestId: request.id, retryable: status === 503 });
    },
  });
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onSend', async (request, reply, payload) => {
      reply.header('cache-control', 'private, no-store').header('x-request-id', request.id);
      return payload;
    });
  const telemetry = app.get(SecurityTelemetryService);
  telemetry.enable(process.env.DMS_OPERATIONS_ENABLED === 'true');
  app
    .getHttpAdapter()
    .getInstance()
    .addHook('onResponse', async (req, reply) => {
      telemetry.observe(req, reply);
    });
  app.enableShutdownHooks();
  return app;
}
