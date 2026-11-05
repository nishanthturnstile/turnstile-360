import { Controller, Get, Req } from '@nestjs/common';
import { capabilitiesResponseSchema } from '@thaarei/dms-contracts/public';
import type { FastifyRequest } from 'fastify';
import { DmsDatabaseService } from '../dms-database/dms-database.service.js';
import { dmsError } from '../dms-errors.js';
import { DmsOperation } from '../dms-operation.js';

@Controller('capabilities')
export class CapabilitiesController {
  constructor(private readonly database: DmsDatabaseService) {}
  @Get()
  @DmsOperation('getDmsCapabilities')
  capabilities(@Req() request: FastifyRequest) {
    if (!request.machine) return dmsError(401, 'MACHINE_TOKEN_REQUIRED');
    return this.database.withMachine(
      request.machine,
      ['dms:capabilities:read'],
      async ({ context }) =>
        capabilitiesResponseSchema.parse({
          contractVersion: 1,
          applicationId: context.application.id,
          tenantId: context.tenantId,
          operations: [
            'application-enrollment',
            'capabilities:read',
            ...(context.principal.scopes.includes('dms:audit:read') ? ['audit:read'] : []),
          ],
          formats: [],
          profiles: [],
          languages: [],
          limits: { accessTokenSeconds: 300, idempotencyWindowSeconds: 86400 },
        }),
    );
  }
}
