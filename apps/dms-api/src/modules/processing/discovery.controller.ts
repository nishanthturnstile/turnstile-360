import { Controller, HttpCode, Post, Req } from '@nestjs/common';
import { discoveryRequestSchema } from '@thaarei/dms-contracts/public';
import type { FastifyRequest } from 'fastify';
import { dmsError } from '../access/dms-errors.js';
import { DmsOperation } from '../access/dms-operation.js';
import { DiscoveryService } from './discovery.service.js';
@Controller('search')
export class DiscoveryController {
  constructor(private readonly discovery: DiscoveryService) {}
  @Post()
  @HttpCode(200)
  @DmsOperation('searchDmsDocuments')
  search(@Req() req: FastifyRequest) {
    const input = discoveryRequestSchema.safeParse(req.body);
    if (!input.success || !req.machine || Object.keys(req.query as object).length)
      return dmsError(400, 'INVALID_REQUEST');
    return this.discovery.search(req.machine, input.data);
  }
}
