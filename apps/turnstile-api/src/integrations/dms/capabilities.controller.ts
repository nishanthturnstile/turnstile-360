import { Controller, Get, Header, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { authError } from '../../modules/auth/browser-auth/auth-errors.js';
import { RequirePermissions } from '../../modules/auth/user-session/access-policy.js';
import { CapabilitiesService } from './capabilities.service.js';

@Controller('dms/capabilities')
export class CapabilitiesController {
  constructor(private readonly capabilities: CapabilitiesService) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  @RequirePermissions('turnstile:access', 'turnstile:dms:capabilities:read')
  read(@Req() request: FastifyRequest) {
    const user = request.productUser?.identity.user;
    if (!user) return authError(401, 'IDENTITY_REQUIRED');
    // No browser authorization, actor, tenant, cookie or arbitrary headers are forwarded.
    return this.capabilities.read(user.id, request.id);
  }
}
