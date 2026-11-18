import { Controller, Delete, Get, Param, Patch, Post, Put, Req, Res } from '@nestjs/common';
import {
  auditQuerySchema,
  documentListQuerySchema,
  documentQuerySchema,
  downloadQuerySchema,
  uploadBeginSchema,
} from '@thaarei/dms-contracts/public';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { dmsError } from '../access/dms-errors.js';
import { DmsOperation } from '../access/dms-operation.js';
import { AuditService } from '../audit/audit.service.js';
import { UploadLifecycleService } from '../uploads/upload-lifecycle.service.js';
import { DocumentsService } from './documents.service.js';
import { DownloadService } from './download.service.js';
import { SharingService } from './sharing.service.js';
import { VersionsService } from './versions.service.js';
@Controller('documents')
export class DocumentsController {
  constructor(
    private readonly documents: DocumentsService,
    private readonly sharing: SharingService,
    private readonly audit: AuditService,
    private readonly downloads: DownloadService,
    private readonly versions: VersionsService,
    private readonly uploads: UploadLifecycleService,
  ) {}
  @Get()
  @DmsOperation('listDmsDocuments')
  list(@Req() request: FastifyRequest) {
    const input = documentListQuerySchema.safeParse(request.query);
    if (!input.success || !request.machine) return dmsError(400, 'INVALID_REQUEST');
    return this.documents.list(request.machine, {
      ...input.data,
      limit: input.data.limit ? Number(input.data.limit) : undefined,
      cursor: input.data.cursor,
    });
  }
  @Get(':documentId')
  @DmsOperation('getDmsDocument')
  async read(
    @Req() request: FastifyRequest,
    @Param('documentId') id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (!z.uuid().safeParse(id).success || !request.machine)
      return dmsError(400, 'INVALID_REQUEST');
    const document = await this.documents.read(request.machine, id);
    reply.header('etag', `"${document.revision}"`);
    return document;
  }
  @Patch(':documentId')
  @DmsOperation('editDmsDocument')
  edit(
    @Req() req: FastifyRequest,
    @Param('documentId') id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    return this.change(req, id, reply, 'edit', req.body);
  }
  @Post(':documentId/references')
  @DmsOperation('linkDmsDocumentReference')
  link(
    @Req() req: FastifyRequest,
    @Param('documentId') id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    reply.code(200);
    return this.change(req, id, reply, 'link', req.body);
  }
  @Delete(':documentId/references/:referenceId')
  @DmsOperation('unlinkDmsDocumentReference')
  unlink(
    @Req() req: FastifyRequest,
    @Param('documentId') id: string,
    @Param('referenceId') referenceId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (!z.uuid().safeParse(referenceId).success || req.body !== undefined)
      return dmsError(400, 'INVALID_REQUEST');
    return this.change(req, id, reply, 'unlink', referenceId.toLowerCase());
  }
  private async change(
    req: FastifyRequest,
    id: string,
    reply: FastifyReply,
    action: 'edit' | 'link' | 'unlink',
    input: unknown,
  ) {
    if (!z.uuid().safeParse(id).success || !req.machine || Object.keys(req.query as object).length)
      return dmsError(400, 'INVALID_REQUEST');
    const result = await this.documents.mutate(
      req.machine,
      id.toLowerCase(),
      this.expected(req),
      req.id,
      action,
      input,
    );
    reply.header('etag', `"${result.revision}"`);
    return result;
  }
  @Get(':documentId/permissions')
  @DmsOperation('getDmsDocumentPermissions')
  async permissions(
    @Req() req: FastifyRequest,
    @Param('documentId') id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (!z.uuid().safeParse(id).success || !req.machine || Object.keys(req.query as object).length)
      return dmsError(400, 'INVALID_REQUEST');
    const result = await this.sharing.read(req.machine, id.toLowerCase());
    reply.header('etag', `"${result.revision}"`);
    return result;
  }
  @Put(':documentId/permissions')
  @DmsOperation('setDmsDocumentPermissions')
  async setPermissions(
    @Req() req: FastifyRequest,
    @Param('documentId') id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (
      !z.uuid().safeParse(id).success ||
      !req.machine ||
      Object.keys(req.query as object).length ||
      req.body === undefined
    )
      return dmsError(400, 'INVALID_REQUEST');
    const result = await this.sharing.set(
      req.machine,
      id.toLowerCase(),
      req.body,
      this.expected(req),
      req.id,
    );
    reply.header('etag', `"${result.revision}"`);
    return result;
  }
  @Get(':documentId/download')
  @DmsOperation('getDmsDocumentDownload')
  download(@Req() request: FastifyRequest, @Param('documentId') id: string) {
    if (
      !z.uuid().safeParse(id).success ||
      !downloadQuerySchema.safeParse(request.query).success ||
      !request.machine
    )
      return dmsError(400, 'INVALID_REQUEST');
    return this.downloads.issue(
      request.machine,
      id,
      request.id,
      downloadQuerySchema.parse(request.query).versionId,
    );
  }
  private expected(req: FastifyRequest) {
    const match = /^"([1-9][0-9]{0,14})"$/.exec(String(req.headers['if-match'] ?? ''));
    if (!match) return dmsError(400, 'INVALID_REQUEST');
    return match[1] as string;
  }
  @Post(':documentId/versions/uploads')
  @DmsOperation('beginDmsVersionUpload')
  async uploadVersion(
    @Req() req: FastifyRequest,
    @Param('documentId') id: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const input = uploadBeginSchema.safeParse(req.body);
    if (!z.uuid().safeParse(id).success || !input.success || !req.machine)
      return dmsError(400, 'INVALID_REQUEST');
    const key = String(req.headers['idempotency-key'] ?? '');
    const { replay, ...response } = await this.uploads.begin(
      req.machine,
      { ...input.data, documentId: id.toLowerCase(), expectedRevision: this.expected(req) },
      key,
      req.id,
      true,
    );
    reply.code(replay ? 200 : 201).header('location', `/v1/uploads/${response.session.id}`);
    return response;
  }
  @Get(':documentId/versions')
  @DmsOperation('listDmsVersions')
  history(@Req() req: FastifyRequest, @Param('documentId') id: string) {
    const query = documentQuerySchema.safeParse(req.query);
    if (!z.uuid().safeParse(id).success || !query.success || !req.machine)
      return dmsError(400, 'INVALID_REQUEST');
    return this.versions.read(req.machine, id, undefined, {
      ...(query.data.limit ? { limit: Number(query.data.limit) } : {}),
      ...(query.data.cursor ? { cursor: query.data.cursor } : {}),
    });
  }
  @Get(':documentId/versions/:versionId')
  @DmsOperation('getDmsVersion')
  version(
    @Req() req: FastifyRequest,
    @Param('documentId') id: string,
    @Param('versionId') versionId: string,
  ) {
    if (
      !z.uuid().safeParse(id).success ||
      !z.uuid().safeParse(versionId).success ||
      Object.keys(req.query as object).length ||
      !req.machine
    )
      return dmsError(400, 'INVALID_REQUEST');
    return this.versions.read(req.machine, id, versionId);
  }
  @Post(':documentId/versions/:versionId/restore')
  @DmsOperation('restoreDmsVersion')
  async restore(
    @Req() req: FastifyRequest,
    @Param('documentId') id: string,
    @Param('versionId') versionId: string,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (!z.uuid().safeParse(id).success || !z.uuid().safeParse(versionId).success || !req.machine)
      return dmsError(400, 'INVALID_REQUEST');
    const { replay, ...response } = await this.versions.restore(
      req.machine,
      id,
      versionId,
      req.body,
      this.expected(req),
      String(req.headers['idempotency-key'] ?? ''),
      req.id,
    );
    reply
      .code(replay ? 200 : 202)
      .header('location', `/v1/uploads/${response.session?.id}`)
      .header('retry-after', '2');
    return response;
  }
  @Get(':documentId/audit')
  @DmsOperation('getDmsDocumentAudit')
  events(@Req() request: FastifyRequest, @Param('documentId') id: string) {
    const query = auditQuerySchema.safeParse(request.query);
    if (!z.uuid().safeParse(id).success || !query.success || !request.machine)
      return dmsError(400, 'INVALID_REQUEST');
    return this.audit.read(request.machine, {
      documentId: id,
      limit: query.data.limit ? Number(query.data.limit) : undefined,
      cursor: query.data.cursor,
    });
  }
}
@Controller('admission-policy')
export class AdmissionPolicyController {
  constructor(private readonly documents: DocumentsService) {}
  @Get()
  @DmsOperation('getDmsAdmissionPolicy')
  read(@Req() request: FastifyRequest) {
    if (!request.machine) return dmsError(401, 'MACHINE_TOKEN_REQUIRED');
    return this.documents.policy(request.machine);
  }
}
