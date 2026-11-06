import 'reflect-metadata';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { mountTransferIngress } from './modules/storage/transfer-ingress.js';

@Module({})
class TransferModule {}
const app = await NestFactory.create<NestFastifyApplication>(
  TransferModule,
  new FastifyAdapter({
    logger: false,
    requestTimeout: 120000,
    connectionTimeout: 30000,
    bodyLimit: 1,
  }),
  { logger: false },
);
mountTransferIngress(app.getHttpAdapter().getInstance(), process.env);
app.enableShutdownHooks();
await app.listen(8333, '0.0.0.0');
