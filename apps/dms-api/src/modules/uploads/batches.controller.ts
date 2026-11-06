import { Controller, Delete, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import { documentQuerySchema } from '@thaarei/dms-contracts/public';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { dmsError } from '../access/dms-errors.js';
import { DmsOperation } from '../access/dms-operation.js';
import { BatchesService } from './batches.service.js';
import { empty, idempotency, machine, uuid } from './uploads.controller.js';
@Controller('upload-batches')
export class BatchesController {
  constructor(private readonly batches: BatchesService) {}
  @Post()
  @DmsOperation('createDmsUploadBatch')
  async create(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const { replay, ...response } = await this.batches.create(
      machine(req),
      req.body,
      idempotency(req),
      req.id,
    );
    // The same operation identity is returned on replay; status is always current.
    reply.code(replay ? 200 : 201).header('location', `/v1/upload-batches/${response.batch.id}`);
    return response;
  }
  @Get(':batchId')
  @DmsOperation('getDmsUploadBatch')
  read(@Req() req: FastifyRequest, @Param('batchId') id: string) {
    const query = documentQuerySchema.safeParse(req.query);
    if (!query.success) return dmsError(400, 'INVALID_REQUEST');
    return this.batches.read(
      machine(req),
      uuid(id),
      query.data.limit ? Number(query.data.limit) : 20,
      query.data.cursor,
    );
  }
  @Post(':batchId/close')
  @HttpCode(200)
  @DmsOperation('closeDmsUploadBatch')
  close(@Req() req: FastifyRequest, @Param('batchId') id: string) {
    empty(req);
    return this.batches.control(machine(req), uuid(id), 'close', idempotency(req), req.id);
  }
  @Delete(':batchId')
  @DmsOperation('cancelDmsUploadBatch')
  cancel(@Req() req: FastifyRequest, @Param('batchId') id: string) {
    empty(req);
    return this.batches.control(machine(req), uuid(id), 'cancel', undefined, req.id);
  }
}
