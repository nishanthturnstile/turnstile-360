import { Body, Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { CONFIGURATION_MANAGE_PERMISSION } from '@thaarei/turnstile-contracts';
import type { FastifyRequest } from 'fastify';
import { configurationActor } from '../../infrastructure/configuration-http.js';
import { WorkspaceReadinessExempt } from '../../infrastructure/workspace-access.js';
import { RequirePermissions } from '../auth/user-session/access-policy.js';
import { OnboardingService } from './onboarding.service.js';

@Controller()
@WorkspaceReadinessExempt()
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}
  @Get('workspace/status')
  @RequirePermissions('turnstile:access')
  status(@Req() request: FastifyRequest) {
    return this.onboarding.status(configurationActor(request));
  }
  @Get('setup')
  @RequirePermissions('turnstile:access', CONFIGURATION_MANAGE_PERMISSION)
  setup(@Req() request: FastifyRequest) {
    return this.onboarding.setup(configurationActor(request));
  }
  @Post('setup/complete')
  @HttpCode(200)
  @RequirePermissions('turnstile:access', CONFIGURATION_MANAGE_PERMISSION)
  complete(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.onboarding.complete(configurationActor(request), body);
  }
}
