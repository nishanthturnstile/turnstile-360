import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { type PeoplePermission, peopleIdSchema } from '@thaarei/turnstile-contracts';
import type { FastifyRequest } from 'fastify';
import {
  PUBLIC_ENDPOINT,
  REQUIRED_PERMISSIONS,
  REQUIRED_RESOURCE_ACCESS,
  type ResourceAccessPolicy,
} from '../../../infrastructure/access-policy.js';
import { covers } from '../../access/access-evaluator.js';
import { authError } from '../browser-auth/auth-errors.js';
import { BrowserAuthService } from '../browser-auth/browser-auth.service.js';

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
    const required = this.reflector.getAllAndOverride<PeoplePermission[]>(
      REQUIRED_PERMISSIONS,
      targets,
    );
    const resource = this.reflector.getAllAndOverride<ResourceAccessPolicy>(
      REQUIRED_RESOURCE_ACCESS,
      targets,
    );
    if (!required?.length && !resource) return authError(403, 'PERMISSION_DENIED');
    if (
      !current.access ||
      required?.some((permission) => !covers(current.access, permission, { kind: 'company' }))
    )
      return authError(403, 'PERMISSION_DENIED');
    if (resource) {
      const params = request.params as Record<string, unknown> | undefined;
      const id = peopleIdSchema.safeParse(params?.[resource.unitParam]);
      if (
        !id.success ||
        !covers(current.access, resource.action, {
          kind: 'units',
          unitIds: [id.data],
          includeChildren: resource.includeChildren,
        })
      )
        return authError(403, 'PERMISSION_DENIED');
    }
    return true;
  }
}
