import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { RequirePermissions } from '../../infrastructure/access-policy.js';
import { productActor } from '../../infrastructure/configuration-http.js';
import { ScopedStructureService } from './scoped-structure.service.js';
import { StructureCommandsService } from './structure-commands.service.js';

// Resource existence and coverage are checked together in the transaction. A
// resource guard's 403 would distinguish a hidden unit from a missing one.
@Controller('structure')
@RequirePermissions('turnstile:access')
export class ScopedStructureController {
  constructor(
    private readonly structure: ScopedStructureService,
    private readonly commands: StructureCommandsService,
  ) {}
  private actor(request: FastifyRequest) {
    const actor = productActor(request);
    this.structure.emptyQuery(actor, request.query);
    return actor;
  }

  @Get('units')
  list(@Req() request: FastifyRequest, @Query() query: unknown) {
    return this.structure.list(productActor(request), query);
  }

  @Get('units/:id')
  detail(@Req() request: FastifyRequest, @Param('id') id: string, @Query() query: unknown) {
    return this.structure.detail(productActor(request), id, query);
  }

  @Post('units')
  async create(
    @Req() request: FastifyRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.commands.create(
      this.actor(request),
      body,
      request.headers['idempotency-key'],
    );
    reply.code(result.replayed ? 200 : 201);
    return result;
  }
  @Patch('units/:id')
  rename(@Req() request: FastifyRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.commands.rename(this.actor(request), id, body, request.headers['idempotency-key']);
  }
  @Delete('units/:id')
  remove(@Req() request: FastifyRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.commands.remove(this.actor(request), id, body, request.headers['idempotency-key']);
  }
  @Post('move-impact')
  @HttpCode(200)
  preview(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.commands.preview(this.actor(request), body);
  }
  @Patch('units/:id/parent')
  move(@Req() request: FastifyRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.commands.move(this.actor(request), id, body, request.headers['idempotency-key']);
  }
  @Get('commands/:id')
  command(@Req() request: FastifyRequest, @Param('id') id: string, @Query() query: unknown) {
    this.structure.emptyQuery(productActor(request), query);
    return this.commands.command(productActor(request), id);
  }
}
