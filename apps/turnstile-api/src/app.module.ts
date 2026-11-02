import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ApplicationAccessGuard } from './infrastructure/application-access.guard.js';
import { ProductPersistenceModule } from './infrastructure/database/product-persistence.module.js';
import { HealthController } from './infrastructure/health.controller.js';
import { SecurityTelemetryService } from './infrastructure/security-telemetry.service.js';
import { DmsModule } from './integrations/dms/dms.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { UserSessionGuard } from './modules/auth/user-session/user-session.guard.js';
import { OnboardingModule } from './modules/onboarding/onboarding.module.js';
import { OrganizationModule } from './modules/organization/organization.module.js';

@Module({
  imports: [AuthModule, DmsModule, ProductPersistenceModule, OrganizationModule, OnboardingModule],
  controllers: [AppController, HealthController],
  providers: [
    AppService,
    SecurityTelemetryService,
    UserSessionGuard,
    { provide: APP_GUARD, useClass: ApplicationAccessGuard },
  ],
})
export class AppModule {}
