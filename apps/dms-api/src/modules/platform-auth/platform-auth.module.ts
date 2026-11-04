import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { AuthReadinessController } from './auth-readiness/auth-readiness.controller.js';
import { AuthorityService } from './authority/authority.service.js';
import { IdentityServiceService } from './identity-service.service.js';

@Module({
  imports: [AccessModule],
  exports: [AuthorityService],
  providers: [AuthorityService, IdentityServiceService],
  controllers: [AuthReadinessController],
})
export class PlatformAuthModule {}
