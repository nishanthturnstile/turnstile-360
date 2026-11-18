import { Controller, Get, HttpCode, Post, Req } from '@nestjs/common';
import { workSchemas } from '@thaarei/dms-contracts/private';
import type { FastifyRequest } from 'fastify';
import type { z } from 'zod';
import { deploymentPreflight } from '../deployment/access.js';
import { StorageService } from '../storage/storage.service.js';
import { WorkService } from './work.service.js';
import { WorkAuthService } from './work-auth.service.js';
import { WorkError } from './work-configuration.js';
@Controller('internal/work')
export class WorkController {
  constructor(
    private readonly work: WorkService,
    private readonly auth: WorkAuthService,
    private readonly storage: StorageService,
  ) {}
  private async request<T>(req: FastifyRequest, schema: z.ZodType<T>) {
    const duplicates = req.raw.rawHeaders.filter(
      (v, i) => i % 2 === 0 && v.toLowerCase() === 'authorization',
    ).length;
    if (duplicates > 1 || req.headers.dpop || Object.keys(req.query as object).length)
      throw new WorkError('WORK_INVALID', 400);
    const principal = await this.auth.verify(req.headers.authorization);
    const mode = req.url.endsWith('/presence')
      ? 'recovery'
      : req.url.endsWith('/dispatches/claim') || req.url.endsWith('/attempts/claim')
        ? 'full'
        : 'completion';
    await deploymentPreflight(this.work.pool, process.env.INSTALLATION_TENANT_ID as string, mode);
    const parsed = schema.safeParse(req.body ?? {});
    if (!parsed.success) throw new WorkError('WORK_INVALID', 400);
    return { principal, input: parsed.data };
  }
  @Post('presence')
  @HttpCode(200)
  async presence(@Req() req: FastifyRequest) {
    const { principal, input } = await this.request(req, workSchemas.Presence);
    return this.work.presence(principal, input);
  }
  @Post('dispatches/claim')
  @HttpCode(200)
  async dispatches(@Req() req: FastifyRequest) {
    const { principal } = await this.request(req, workSchemas.Empty);
    return workSchemas.Deliveries.parse(await this.work.claimDispatches(principal));
  }
  @Post('dispatches/delivered')
  @HttpCode(200)
  async delivered(@Req() req: FastifyRequest) {
    const { principal, input } = await this.request(req, workSchemas.DeliveryReceipt);
    return this.work.delivery(principal, input);
  }
  @Post('dispatches/failed')
  @HttpCode(200)
  async failed(@Req() req: FastifyRequest) {
    const { principal, input } = await this.request(req, workSchemas.DeliveryFailure);
    return this.work.delivery(principal, input);
  }
  @Post('attempts/claim')
  @HttpCode(200)
  async claim(@Req() req: FastifyRequest) {
    const { principal, input } = await this.request(req, workSchemas.Envelope);
    return workSchemas.Claim.parse(await this.work.claim(principal, input));
  }
  @Post('attempts/heartbeat')
  @HttpCode(200)
  async heartbeat(@Req() req: FastifyRequest) {
    const { principal, input } = await this.request(req, workSchemas.Lease);
    return workSchemas.Heartbeat.parse(await this.work.heartbeat(principal, input));
  }
  @Post('attempts/candidate')
  @HttpCode(200)
  async candidate(@Req() req: FastifyRequest) {
    const { principal, input } = await this.request(req, workSchemas.Lease);
    return workSchemas.Candidate.parse(await this.work.candidate(principal, input, this.storage));
  }
  @Post('attempts/extraction-input')
  @HttpCode(200)
  async extractionInput(@Req() req: FastifyRequest) {
    const { principal, input } = await this.request(req, workSchemas.Lease);
    return workSchemas.ExtractionInput.parse(
      await this.work.extractionInput(principal, input, this.storage),
    );
  }
  @Post('attempts/extraction-output')
  @HttpCode(200)
  async extractionOutput(@Req() req: FastifyRequest) {
    const { principal, input } = await this.request(req, workSchemas.ExtractionOutputRequest);
    return workSchemas.ExtractionOutput.parse(
      await this.work.extractionOutput(principal, input, this.storage),
    );
  }
  @Post('attempts/result')
  @HttpCode(200)
  async result(@Req() req: FastifyRequest) {
    const { principal, input } = await this.request(req, workSchemas.Result);
    return workSchemas.ResultReceipt.parse(await this.work.result(principal, input, this.storage));
  }
}
@Controller('health')
export class WorkHealthController {
  constructor(private readonly work: WorkService) {}
  @Get('live') live() {
    return { name: 'Thaarei DMS coordinator' };
  }
  @Get('ready/processing') async processing() {
    if (!(await this.work.processingReady())) throw new WorkError('WORK_UNAVAILABLE', 503);
    return { ready: true };
  }
  @Get('ready/work') async ready() {
    await this.work.internal((tx) => tx.client.query('SELECT id FROM dms.work_job LIMIT 0'));
    return { ready: true };
  }
}
