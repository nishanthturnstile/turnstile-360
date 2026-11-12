import { Controller, Get, Header, Req } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { RequirePermissions } from '../../infrastructure/access-policy.js';
import { moduleActor } from '../../modules/module-access/module-access.service.js';
import { IncidentManagementService } from './incident-management.service.js';
@Controller('modules/incident-management')
@RequirePermissions('turnstile:incidents:read')
export class IncidentManagementController {
  constructor(private readonly service: IncidentManagementService) {}
  @Get('entry')
  @Header('Cache-Control', 'private, no-store')
  @Header('Referrer-Policy', 'no-referrer')
  read(@Req() request: FastifyRequest) {
    return this.service.read(moduleActor(request));
  }
}
