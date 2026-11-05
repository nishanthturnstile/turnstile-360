import { Controller, Get, Req } from '@nestjs/common';
import { auditQuerySchema } from '@thaarei/dms-contracts/public';
import type { FastifyRequest } from 'fastify';
import { dmsError } from '../access/dms-errors.js';
import { DmsOperation } from '../access/dms-operation.js';
import { AuditService } from './audit.service.js';

@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}
  @Get()
  @DmsOperation('getDmsAudit')
  read(@Req() request: FastifyRequest) {
    const input = auditQuerySchema.safeParse(request.query);
    if (!input.success) return dmsError(400, 'INVALID_REQUEST');
    if (!request.machine) return dmsError(401, 'MACHINE_TOKEN_REQUIRED');
    return this.audit.read(request.machine, {
      limit: input.data.limit ? Number(input.data.limit) : undefined,
      cursor: input.data.cursor,
    });
  }
}
