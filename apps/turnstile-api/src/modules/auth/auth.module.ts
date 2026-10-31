import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { DmsModule } from '../../integrations/dms/dms.module.js';
import { AuthConfigurationService } from './auth-configuration/auth-configuration.service.js';
import { AuthReadinessController } from './auth-readiness/auth-readiness.controller.js';
import { BrowserAuthController } from './browser-auth/browser-auth.controller.js';
import { BrowserAuthService } from './browser-auth/browser-auth.service.js';
import { OidcService } from './browser-auth/oidc.service.js';
import { ProductDatabaseService } from './product-database/product-database.service.js';
import { UserSessionGuard } from './user-session/user-session.guard.js';

@Module({
  imports: [DmsModule],
  providers: [
    AuthConfigurationService,
    ProductDatabaseService,
    BrowserAuthService,
    OidcService,
    { provide: APP_GUARD, useClass: UserSessionGuard },
  ],
  controllers: [AuthReadinessController, BrowserAuthController],
  exports: [BrowserAuthService],
})
export class AuthModule {}
