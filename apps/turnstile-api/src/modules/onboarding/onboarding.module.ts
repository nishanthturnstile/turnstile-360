import { Module } from '@nestjs/common';
import { OrganizationModule } from '../organization/organization.module.js';
import { OnboardingController } from './onboarding.controller.js';
import { OnboardingService } from './onboarding.service.js';

@Module({
  providers: [OnboardingService],
  imports: [OrganizationModule],
  exports: [OnboardingService],
  controllers: [OnboardingController],
})
export class OnboardingModule {}
