import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { TurnstilePermission } from '@thaarei/turnstile-contracts';
import type { FastifyRequest } from 'fastify';
import { authError } from '../browser-auth/auth-errors.js';
import { BrowserAuthService } from '../browser-auth/browser-auth.service.js';
import { PUBLIC_ENDPOINT, REQUIRED_PERMISSIONS } from './access-policy.js';

@Injectable()
export class UserSessionGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: BrowserAuthService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_ENDPOINT, targets)) return true;
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const current = await this.auth.authenticate(request);
    if (!['GET', 'HEAD', 'OPTIONS'].includes(request.method)) this.auth.csrf(request, current.csrf);
    const required = this.reflector.getAllAndOverride<TurnstilePermission[]>(
      REQUIRED_PERMISSIONS,
      targets,
    );
    if (
      !required?.length ||
      required.some((permission) => !current.identity.permissions.includes(permission))
    )
      return authError(403, 'PERMISSION_DENIED');
    return true;
  }
}
