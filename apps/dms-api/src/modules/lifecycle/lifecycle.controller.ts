import { Controller, Delete, Get, Param, Post, Req, Res } from '@nestjs/common';
import { emptyCommandSchema } from '@thaarei/dms-contracts/public';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { dmsError } from '../access/dms-errors.js';
import { DmsOperation } from '../access/dms-operation.js';
import { LifecycleService } from './lifecycle.service.js';
@Controller('documents')
export class LifecycleController {
  constructor(private readonly lifecycle: LifecycleService) {}
  private expected(req: FastifyRequest) {
    const match = /^"([1-9][0-9]{0,14})"$/.exec(String(req.headers['if-match'] ?? ''));
    if (!match) return dmsError(400, 'INVALID_REQUEST');
    return match[1] as string;
  }
  @Get(':documentId/lifecycle')
  @DmsOperation('getDmsDocumentLifecycle')
  async lifecycleState(
    @Req() req: FastifyRequest,
    @Param('documentId') id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (!z.uuid().safeParse(id).success || !req.machine || Object.keys(req.query as object).length)
      return dmsError(400, 'INVALID_REQUEST');
    const result = await this.lifecycle.read(req.machine, id.toLowerCase());
    reply.header('etag', `"${result.revision}"`);
    return result;
  }
  @Delete(':documentId')
  @DmsOperation('deleteDmsDocument')
  delete(
    @Req() req: FastifyRequest,
    @Param('documentId') id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.changeLife(req, id, reply, 'delete');
  }
  @Post(':documentId/restore')
  @DmsOperation('restoreDmsDocument')
  logicalRestore(
    @Req() req: FastifyRequest,
    @Param('documentId') id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.changeLife(req, id, reply, 'restore');
  }
  private async changeLife(
    req: FastifyRequest,
    id: string,
    reply: FastifyReply,
    operation: 'delete' | 'restore',
  ) {
    if (
      !z.uuid().safeParse(id).success ||
      !req.machine ||
      Object.keys(req.query as object).length ||
      !emptyCommandSchema.safeParse(req.body ?? {}).success
    )
      return dmsError(400, 'INVALID_REQUEST');
    const result = await this.lifecycle.change(
      req.machine,
      id.toLowerCase(),
      operation,
      this.expected(req),
      operation === 'restore' ? String(req.headers['idempotency-key'] ?? '') : undefined,
      req.id,
    );
    reply
      .code(operation === 'restore' && !result.replay ? 202 : 200)
      .header('etag', `"${result.lifecycle.revision}"`);
    if (operation === 'restore')
      reply
        .header('retry-after', '2')
        .header('location', `/v1/documents/${id.toLowerCase()}/lifecycle`);
    return result.lifecycle;
  }
}
