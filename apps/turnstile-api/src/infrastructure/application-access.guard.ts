import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { authError } from '../modules/auth/browser-auth/auth-errors.js';
import { PUBLIC_ENDPOINT } from '../modules/auth/user-session/access-policy.js';
import { UserSessionGuard } from '../modules/auth/user-session/user-session.guard.js';
import { OnboardingService } from '../modules/onboarding/onboarding.service.js';
import { WORKSPACE_READINESS_EXEMPT } from './workspace-access.js';

@Injectable()
export class ApplicationAccessGuard implements CanActivate {
  constructor(
    private readonly session: UserSessionGuard,
    private readonly onboarding: OnboardingService,
    private readonly reflector: Reflector,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!(await this.session.canActivate(context))) return false;
    const targets = [context.getHandler(), context.getClass()];
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_ENDPOINT, targets) ||
      this.reflector.getAllAndOverride<boolean>(WORKSPACE_READINESS_EXEMPT, targets)
    )
      return true;
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (!request.productUser) return authError(401, 'IDENTITY_REQUIRED');
    await this.onboarding.requireReady({
      userId: request.productUser.identity.user.id,
      requestId: request.id,
    });
    return true;
  }
}
