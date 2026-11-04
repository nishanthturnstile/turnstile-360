import { Module } from '@nestjs/common';
import { ProductPersistenceModule } from '../../infrastructure/database/product-persistence.module.js';
import { DmsModule } from '../../integrations/dms/dms.module.js';
import { AccessModule } from '../access/access.module.js';
import { AuthConfigurationService } from './auth-configuration/auth-configuration.service.js';
import { AuthReadinessController } from './auth-readiness/auth-readiness.controller.js';
import { BrowserAuthController } from './browser-auth/browser-auth.controller.js';
import { BrowserAuthService } from './browser-auth/browser-auth.service.js';
import { OidcService } from './browser-auth/oidc.service.js';
import { ProductDatabaseService } from './product-database/product-database.service.js';

@Module({
  imports: [DmsModule, ProductPersistenceModule, AccessModule],
  providers: [AuthConfigurationService, ProductDatabaseService, BrowserAuthService, OidcService],
  controllers: [AuthReadinessController, BrowserAuthController],
  exports: [BrowserAuthService],
})
export class AuthModule {}
