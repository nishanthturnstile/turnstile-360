import { Body, Controller, Get, HttpCode, Param, Post, Query, Req } from '@nestjs/common';
import { peopleEmptySchema } from '@thaarei/turnstile-contracts';
import type { FastifyRequest } from 'fastify';
import { RequirePermissions } from '../../infrastructure/access-policy.js';
import { productActor } from '../../infrastructure/configuration-http.js';
import { peopleParse } from './administration.service.js';
import { BulkImportService } from './bulk-import.service.js';
@Controller('people/imports')
@RequirePermissions('turnstile:access', 'turnstile:people:manage')
export class BulkImportController {
  constructor(private readonly service: BulkImportService) {}
  private actor(request: FastifyRequest, empty = true) {
    if (empty) peopleParse(peopleEmptySchema, request.query);
    return { ...productActor(request), deadlineAt: request.peopleDeadlineAt ?? Date.now() + 10000 };
  }
  @Post()
  @HttpCode(200)
  create(@Req() req: FastifyRequest, @Body() body: unknown) {
    return this.service.create(this.actor(req), body);
  }
  @Get()
  list(@Req() req: FastifyRequest) {
    return this.service.list(this.actor(req));
  }
  @Get(':id')
  detail(@Req() req: FastifyRequest, @Param('id') id: string, @Query() query: unknown) {
    return this.service.detail(this.actor(req, false), id, query);
  }
  @Get(':id/errors')
  errors(@Req() req: FastifyRequest, @Param('id') id: string) {
    return this.service.errors(this.actor(req), id);
  }
  @Post(':id/actions')
  @HttpCode(200)
  action(@Req() req: FastifyRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.service.action(this.actor(req), id, body);
  }
}
