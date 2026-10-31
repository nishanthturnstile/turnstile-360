import { Controller, Get, Req } from '@nestjs/common';
import { capabilitiesResponseSchema } from '@thaarei/dms-contracts';
import type { FastifyRequest } from 'fastify';
import { RequireMachineScopes } from '../access-policy.js';

@Controller('capabilities')
export class CapabilitiesController {
  @Get()
  @RequireMachineScopes('dms:capabilities:read')
  capabilities(@Req() request: FastifyRequest) {
    return capabilitiesResponseSchema.parse({
      contractVersion: 1,
      applicationId: request.registration?.id,
      tenantId: request.registration?.tenant_id,
      operations: ['application-enrollment', 'capabilities:read'],
      formats: [],
      profiles: [],
      languages: [],
      limits: { accessTokenSeconds: 300, idempotencyWindowSeconds: 86400 },
    });
  }
}
