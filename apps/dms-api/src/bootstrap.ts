import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';

export async function createApplication(logging = true): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ logger: logging }),
    logging ? {} : { logger: false },
  );
  app.setGlobalPrefix('v1', { exclude: ['health/live'] });
  app.enableShutdownHooks();
  return app;
}
