import { Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import { processingQuerySchema, resultQuerySchema } from '@thaarei/dms-contracts/public';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { dmsError } from '../access/dms-errors.js';
import { DmsOperation } from '../access/dms-operation.js';
import { ResultsService } from './results.service.js';
@Controller('documents')
export class ResultsController {
  constructor(private readonly results: ResultsService) {}
  @Get(':documentId/processing')
  @DmsOperation('getDmsProcessing')
  history(@Req() req: FastifyRequest, @Param('documentId') id: string) {
    const query = processingQuerySchema.safeParse(req.query);
    if (!z.uuid().safeParse(id).success || !query.success || !req.machine)
      return dmsError(400, 'INVALID_REQUEST');
    return this.results.history(req.machine, id.toLowerCase(), query.data);
  }
  @Get(':documentId/content')
  @DmsOperation('getDmsContent')
  content(@Req() req: FastifyRequest, @Param('documentId') id: string) {
    const query = resultQuerySchema.safeParse(req.query);
    if (!z.uuid().safeParse(id).success || !query.success || !req.machine)
      return dmsError(400, 'INVALID_REQUEST');
    return this.results.content(req.machine, id.toLowerCase(), query.data, req.id);
  }
  @Post(':documentId/versions/:versionId/reprocess')
  @DmsOperation('reprocessDmsVersion')
  async reprocess(
    @Req() req: FastifyRequest,
    @Param('documentId') id: string,
    @Param('versionId') versionId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (
      !z.uuid().safeParse(id).success ||
      !z.uuid().safeParse(versionId).success ||
      !req.machine ||
      Object.keys(req.query as object).length
    )
      return dmsError(400, 'INVALID_REQUEST');
    const { replay, ...response } = await this.results.reprocess(
      req.machine,
      id.toLowerCase(),
      versionId.toLowerCase(),
      req.body,
      String(req.headers['idempotency-key'] ?? ''),
      req.id,
    );
    reply
      .code(replay ? 200 : 202)
      .header(
        'location',
        `/v1/documents/${id.toLowerCase()}/processing?versionId=${versionId.toLowerCase()}`,
      )
      .header('retry-after', '2');
    return response;
  }
}
