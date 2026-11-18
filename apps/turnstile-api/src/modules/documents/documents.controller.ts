import { Body, Controller, Get, HttpCode, Param, Post, Query, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { RequirePermissions } from '../../infrastructure/access-policy.js';
import { productActor } from '../../infrastructure/configuration-http.js';
import { DocumentsService } from './documents.service.js';
import { DocumentsIntentsService } from './documents-intents.service.js';
@Controller('documents')
@RequirePermissions('turnstile:access')
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly intents: DocumentsIntentsService,
  ) {}
  @Post('operations')
  draft(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.intents.draft(this.actor(request), body);
  }
  @Get('operations')
  history(@Req() request: FastifyRequest) {
    return this.intents.history(this.actor(request));
  }
  @Get('batches')
  batchHistory(@Req() request: FastifyRequest) {
    return this.intents.history(this.actor(request), undefined, { group: 'batches' });
  }
  @Get('batches/:batchId/manifest')
  batchManifest(@Req() request: FastifyRequest, @Param('batchId') id: string) {
    return this.intents.batchManifest(this.actor(request), id);
  }
  @Get('batches/:batchId/operations')
  batchOperations(@Req() request: FastifyRequest, @Param('batchId') id: string) {
    return this.intents.history(this.actor(request), undefined, { batchId: id });
  }
  @Get('batches/:batchId')
  batch(@Req() request: FastifyRequest, @Param('batchId') id: string, @Query() query: unknown) {
    return this.documents.batch(this.actor(request), id, query);
  }
  @Get('operations/:intentId')
  receipt(@Req() request: FastifyRequest, @Param('intentId') id: string) {
    return this.intents.history(this.actor(request), id);
  }
  @Get('contributions')
  contributions(@Req() request: FastifyRequest) {
    return this.intents.history(this.actor(request), undefined, { group: 'contributions' });
  }
  @Get('recovery')
  recovery(@Req() request: FastifyRequest) {
    return this.intents.history(this.actor(request), undefined, { group: 'lifecycle' });
  }
  @Get('audit')
  applicationAudit(@Req() request: FastifyRequest, @Query() query: unknown) {
    return this.documents.audit(this.actor(request), query);
  }
  @Get('validation')
  @RequirePermissions('turnstile:access', 'turnstile:documents:validate')
  validation(@Req() request: FastifyRequest) {
    return this.documents.validation(this.actor(request));
  }
  @Get(':documentId/audit')
  documentAudit(
    @Req() request: FastifyRequest,
    @Param('documentId') id: string,
    @Query() query: unknown,
  ) {
    return this.documents.audit(this.actor(request), query, id);
  }
  @Get(':documentId/lifecycle')
  lifecycle(@Req() request: FastifyRequest, @Param('documentId') id: string) {
    return this.documents.lifecycle(this.actor(request), id);
  }
  @Get(':documentId/permissions')
  permissions(@Req() request: FastifyRequest, @Param('documentId') id: string) {
    return this.documents.permissions(this.actor(request), id);
  }
  @Get('search')
  search(@Req() request: FastifyRequest, @Query() query: unknown) {
    return this.documents.search(this.actor(request), query);
  }
  @Get(':documentId/processing')
  processing(
    @Req() request: FastifyRequest,
    @Param('documentId') id: string,
    @Query() query: unknown,
  ) {
    return this.documents.processing(this.actor(request), id, query);
  }
  @Get(':documentId/versions/:versionId/processing-operations')
  processingOperations(
    @Req() request: FastifyRequest,
    @Param('documentId') documentId: string,
    @Param('versionId') versionId: string,
  ) {
    return this.intents.history(this.actor(request), undefined, {
      processing: { documentId, versionId },
    });
  }
  @Get(':documentId/content')
  content(
    @Req() request: FastifyRequest,
    @Param('documentId') id: string,
    @Query() query: unknown,
  ) {
    return this.documents.content(this.actor(request), id, query);
  }
  @Post('operations/:intentId/execute')
  @HttpCode(200)
  execute(@Req() request: FastifyRequest, @Param('intentId') id: string, @Body() body: unknown) {
    return this.intents.execute(this.actor(request), id, body);
  }
  @Get('uploads/:uploadId')
  uploadStatus(
    @Req() request: FastifyRequest,
    @Param('uploadId') id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.documents.uploadStatus(this.actor(request), id).then((status) => {
      if (status.retryAfterSeconds) reply.header('retry-after', String(status.retryAfterSeconds));
      return status;
    });
  }
  @Get(':documentId/download')
  download(
    @Req() request: FastifyRequest,
    @Param('documentId') id: string,
    @Query() query: unknown,
  ) {
    return this.documents.original(this.actor(request), id, query);
  }
  @Get(':documentId/versions')
  versions(
    @Req() request: FastifyRequest,
    @Param('documentId') id: string,
    @Query() query: unknown,
  ) {
    return this.documents.versions(this.actor(request), id, query);
  }
  @Get(':documentId/versions/:versionId')
  version(
    @Req() request: FastifyRequest,
    @Param('documentId') id: string,
    @Param('versionId') version: string,
    @Query() query: unknown,
  ) {
    return this.documents.version(this.actor(request), id, version, query);
  }
  private actor(request: FastifyRequest) {
    return {
      ...productActor(request),
      deadlineAt: request.documentsDeadlineAt ?? Date.now() + 10000,
    };
  }
  @Get('connection') connection(@Req() request: FastifyRequest) {
    return this.documents.connection(this.actor(request));
  }
  @Get('connection/policy') policy(@Req() request: FastifyRequest) {
    return this.documents.policy(this.actor(request));
  }
  @Get('connection/identity') identity(@Req() request: FastifyRequest) {
    return this.documents.identity(this.actor(request));
  }
  @Get() list(@Req() request: FastifyRequest, @Query() query: unknown) {
    return this.documents.list(this.actor(request), query);
  }
  @Get(':documentId') async detail(
    @Req() request: FastifyRequest,
    @Param('documentId') id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.documents.detail(this.actor(request), id);
    reply.header('etag', `"${result.revision}"`);
    return result;
  }
}
