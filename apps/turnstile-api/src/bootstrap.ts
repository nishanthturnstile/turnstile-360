import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { LogController } from 'fastify';
import { AppModule } from './app.module.js';
import { SecurityTelemetryService } from './infrastructure/security-telemetry.service.js';
import { AuthConfigurationService } from './modules/auth/auth-configuration/auth-configuration.service.js';
import { AuthExceptionFilter } from './modules/auth/browser-auth/auth-errors.js';
import { registerProductSession } from './modules/auth/browser-auth/session-plugin.js';
import { ProductDatabaseService } from './modules/auth/product-database/product-database.service.js';

export async function createApplication(logging = true): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({
      logger: logging,
      genReqId: () => randomUUID(),
      logController: new LogController({ disableRequestLogging: true }),
      bodyLimit: 16384,
    }),
    logging ? {} : { logger: false },
  );
  app.setGlobalPrefix('api', { exclude: ['health/live', 'health/ready/auth'] });
  const server = app.getHttpAdapter().getInstance();
  const telemetry = app.get(SecurityTelemetryService);
  telemetry.enable(logging);
  server.addHook('onResponse', async (request, reply) => {
    telemetry.observe(request, reply);
  });
  const config = app.get(AuthConfigurationService).config;
  const database = app.get(ProductDatabaseService);
  if (config && database.store) await registerProductSession(server, config, database.store);
  app.useGlobalFilters(new AuthExceptionFilter());
  app.enableShutdownHooks();
  return app;
}
