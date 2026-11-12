import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { ApplicationAccessGuard } from './infrastructure/application-access.guard.js';
import { ProductPersistenceModule } from './infrastructure/database/product-persistence.module.js';
import { HealthController } from './infrastructure/health.controller.js';
import { SecurityTelemetryService } from './infrastructure/security-telemetry.service.js';
import { DmsModule } from './integrations/dms/dms.module.js';
import { IdentityModule } from './integrations/identity/identity.module.js';
import { selectedModules } from './module-composition.js';
import { AccessModule } from './modules/access/access.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { UserSessionGuard } from './modules/auth/user-session/user-session.guard.js';
import { DeploymentController } from './modules/deployment/deployment.controller.js';
import { DeploymentService } from './modules/deployment/deployment.service.js';
import { ModuleAccessModule } from './modules/module-access/module-access.module.js';
import { OnboardingModule } from './modules/onboarding/onboarding.module.js';
import { OrganizationModule } from './modules/organization/organization.module.js';
import { PeopleModule } from './modules/people/people.module.js';

@Module({
  imports: [
    AuthModule,
    DmsModule,
    ProductPersistenceModule,
    OrganizationModule,
    OnboardingModule,
    AccessModule,
    IdentityModule,
    PeopleModule,
    ...selectedModules,
    ModuleAccessModule,
  ],
  controllers: [AppController, HealthController, DeploymentController],
  providers: [
    AppService,
    DeploymentService,
    SecurityTelemetryService,
    UserSessionGuard,
    { provide: APP_GUARD, useClass: ApplicationAccessGuard },
  ],
})
export class AppModule {}
