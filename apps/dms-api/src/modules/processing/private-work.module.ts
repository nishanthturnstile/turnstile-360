import { Module } from '@nestjs/common';
import { SecurityTelemetryService } from '../../infrastructure/security-telemetry.service.js';
import { StorageModule } from '../storage/storage.module.js';
import { WorkController, WorkHealthController } from './work.controller.js';
import { WorkService } from './work.service.js';
import { WorkAuthService } from './work-auth.service.js';
import { WorkConfiguration } from './work-configuration.js';

@Module({
  imports: [StorageModule],
  providers: [SecurityTelemetryService, WorkConfiguration, WorkService, WorkAuthService],
  controllers: [WorkController, WorkHealthController],
})
export class PrivateWorkModule {}
