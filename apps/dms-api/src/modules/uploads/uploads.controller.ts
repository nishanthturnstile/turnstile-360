import { Controller, Delete, Get, HttpCode, Param, Post, Req, Res } from '@nestjs/common';
import { emptyCommandSchema, uploadBeginSchema } from '@thaarei/dms-contracts/public';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { dmsError } from '../access/dms-errors.js';
import { DmsOperation } from '../access/dms-operation.js';
import { UploadLifecycleService } from './upload-lifecycle.service.js';
export function machine(request: FastifyRequest) {
  if (!request.machine) return dmsError(401, 'MACHINE_TOKEN_REQUIRED');
  return request.machine;
}
export function uuid(id: string) {
  if (!z.uuid().safeParse(id).success) return dmsError(400, 'INVALID_REQUEST');
  return id;
}
export function empty(request: FastifyRequest) {
  if (!emptyCommandSchema.safeParse(request.body ?? {}).success)
    return dmsError(400, 'INVALID_REQUEST');
}
export function idempotency(request: FastifyRequest) {
  const value = request.headers['idempotency-key'];
  return typeof value === 'string' ? value : '';
}
@Controller('uploads')
export class UploadsController {
  constructor(private readonly uploads: UploadLifecycleService) {}
  @Post()
  @DmsOperation('beginDmsUpload')
  async begin(@Req() req: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const body = uploadBeginSchema.safeParse(req.body);
    if (!body.success) return dmsError(400, 'INVALID_REQUEST');
    const { replay, ...response } = await this.uploads.begin(
      machine(req),
      body.data,
      idempotency(req),
      req.id,
    );
    reply.code(replay ? 200 : 201).header('location', `/v1/uploads/${response.session.id}`);
    return response;
  }
  @Get(':uploadId')
  @DmsOperation('getDmsUpload')
  async read(
    @Req() req: FastifyRequest,
    @Param('uploadId') id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const response = await this.uploads.status(machine(req), uuid(id), req.id);
    if (response.retryAfterSeconds) reply.header('retry-after', '2');
    return response;
  }
  @Post(':uploadId/complete')
  @DmsOperation('completeDmsUpload')
  async complete(
    @Req() req: FastifyRequest,
    @Param('uploadId') id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    empty(req);
    const response = await this.uploads.complete(machine(req), uuid(id), idempotency(req), req.id);
    reply.code(202).header('location', `/v1/uploads/${id}`).header('retry-after', '2');
    return response;
  }
  @Post(':uploadId/refresh')
  @HttpCode(200)
  @DmsOperation('refreshDmsUpload')
  refresh(@Req() req: FastifyRequest, @Param('uploadId') id: string) {
    empty(req);
    return this.uploads.refresh(machine(req), uuid(id), req.id);
  }
  @Delete(':uploadId')
  @DmsOperation('cancelDmsUpload')
  cancel(@Req() req: FastifyRequest, @Param('uploadId') id: string) {
    empty(req);
    return this.uploads.cancel(machine(req), uuid(id), req.id);
  }
}
