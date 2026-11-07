import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { authError } from '../modules/auth/browser-auth/auth-errors.js';
import { UserSessionGuard } from '../modules/auth/user-session/user-session.guard.js';
import { DeploymentService } from '../modules/deployment/deployment.service.js';
import { OnboardingService } from '../modules/onboarding/onboarding.service.js';
import { PUBLIC_ENDPOINT } from './access-policy.js';

import { DEPLOYMENT_EXEMPT, WORKSPACE_READINESS_EXEMPT } from './workspace-access.js';

@Injectable()
export class ApplicationAccessGuard implements CanActivate {
  constructor(
    private readonly session: UserSessionGuard,
    private readonly deployment: DeploymentService,
    private readonly onboarding: OnboardingService,
    private readonly reflector: Reflector,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (!(await this.session.canActivate(context))) return false;
    const targets = [context.getHandler(), context.getClass()];
    if (
      this.reflector.getAllAndOverride<boolean>(PUBLIC_ENDPOINT, targets) ||
      this.reflector.getAllAndOverride<boolean>(DEPLOYMENT_EXEMPT, targets)
    )
      return true;
    const incoming = context.switchToHttp().getRequest<FastifyRequest>();
    await this.deployment.require(['GET', 'HEAD'].includes(incoming.method) ? 'read' : 'full');
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    if (!request.productUser) return authError(401, 'IDENTITY_REQUIRED');
    if (this.reflector.getAllAndOverride<boolean>(WORKSPACE_READINESS_EXEMPT, targets)) return true;
    await this.onboarding.requireReady({
      userId: request.productUser.identity.user.id,
      requestId: request.id,
    });
    return true;
  }
}
