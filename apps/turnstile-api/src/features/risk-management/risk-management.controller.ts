import { Controller, Get, Header, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { RequirePermissions } from '../../infrastructure/access-policy.js';
import { moduleActor } from '../../modules/module-access/module-access.service.js';
import { RiskManagementService } from './risk-management.service.js';
@Controller('modules/risk-management')
@RequirePermissions('turnstile:risks:read')
export class RiskManagementController {
  constructor(private readonly service: RiskManagementService) {}
  @Get('entry')
  @Header('Cache-Control', 'private, no-store')
  @Header('Referrer-Policy', 'no-referrer')
  read(@Req() request: FastifyRequest) {
    return this.service.read(moduleActor(request));
  }
}
