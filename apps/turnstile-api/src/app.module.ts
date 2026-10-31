import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { HealthController } from './infrastructure/health.controller.js';
import { SecurityTelemetryService } from './infrastructure/security-telemetry.service.js';
import { DmsModule } from './integrations/dms/dms.module.js';
import { AuthModule } from './modules/auth/auth.module.js';

@Module({
  imports: [AuthModule, DmsModule],
  controllers: [AppController, HealthController],
  providers: [AppService, SecurityTelemetryService],
})
export class AppModule {}
