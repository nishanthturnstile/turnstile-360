import { Controller, Get, Header, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { RequirePermissions } from '../../infrastructure/access-policy.js';
import { ModuleAccessService, moduleActor } from './module-access.service.js';
@Controller('modules')
@RequirePermissions('turnstile:access')
export class ModuleAccessController {
  constructor(private readonly modules: ModuleAccessService) {}
  @Get()
  @Header('Cache-Control', 'private, no-store')
  @Header('Referrer-Policy', 'no-referrer')
  capabilities(@Req() request: FastifyRequest) {
    return this.modules.capabilities(moduleActor(request));
  }
}
