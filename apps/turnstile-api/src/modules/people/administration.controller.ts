import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import { peopleEmptySchema } from '@thaarei/turnstile-contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { RequirePermissions } from '../../infrastructure/access-policy.js';
import { productActor } from '../../infrastructure/configuration-http.js';
import { AdministrationService, peopleParse } from './administration.service.js';
import { PeopleCommandsService } from './people-commands.service.js';
@Controller('people')
@RequirePermissions('turnstile:access')
export class AdministrationController {
  constructor(
    private readonly reader: AdministrationService,
    private readonly commands: PeopleCommandsService,
  ) {}
  private actor(request: FastifyRequest, empty = true) {
    if (empty) peopleParse(peopleEmptySchema, request.query);
    return { ...productActor(request), deadlineAt: request.peopleDeadlineAt ?? Date.now() + 10000 };
  }
  @Get('catalog') catalog(@Req() request: FastifyRequest) {
    return this.reader.catalog(this.actor(request));
  }
  @Get('members')
  @RequirePermissions('turnstile:people:manage')
  members(@Req() request: FastifyRequest, @Query() query: unknown) {
    return this.reader.members(this.actor(request, false), query);
  }
  @Get('members/:id')
  @RequirePermissions('turnstile:people:manage')
  member(@Req() request: FastifyRequest, @Param('id') id: string) {
    return this.reader.member(this.actor(request), id);
  }
  @Get('eligible-roles')
  @RequirePermissions('turnstile:people:manage')
  eligible(@Req() request: FastifyRequest, @Query() query: unknown) {
    return this.reader.roles(this.actor(request, false), query, true);
  }
  @Get('roles')
  @RequirePermissions('turnstile:roles:manage')
  roles(@Req() request: FastifyRequest, @Query() query: unknown) {
    return this.reader.roles(this.actor(request, false), query);
  }
  @Get('roles/:id')
  @RequirePermissions('turnstile:roles:manage')
  role(@Req() request: FastifyRequest, @Param('id') id: string) {
    return this.reader.role(this.actor(request), id);
  }
  @Get('invitations')
  @RequirePermissions('turnstile:people:manage')
  invitations(@Req() request: FastifyRequest, @Query() query: unknown) {
    return this.reader.invitationList(this.actor(request, false), query);
  }
  @Get('invitations/:id')
  @RequirePermissions('turnstile:people:manage')
  invitation(@Req() request: FastifyRequest, @Param('id') id: string) {
    return this.reader.invitation(this.actor(request), id);
  }
  @Post('impact')
  @HttpCode(200)
  impact(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.commands.preview(this.actor(request), body);
  }
  @Get('commands/:id')
  readback(@Req() request: FastifyRequest, @Param('id') id: string) {
    return this.commands.readback(this.actor(request), id);
  }
  private async execute(request: FastifyRequest, body: unknown, op: string, id?: string) {
    return this.commands.execute(
      this.actor(request),
      request.headers['idempotency-key'],
      body,
      op,
      id,
    );
  }
  @Post('roles')
  @RequirePermissions('turnstile:roles:manage')
  async create(
    @Req() request: FastifyRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.execute(request, body, 'role.create');
    reply.code(result.replayed ? 200 : 201);
    return result;
  }
  @Patch('roles/:id')
  @RequirePermissions('turnstile:roles:manage')
  patch(@Req() request: FastifyRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.execute(request, body, 'role.patch', id);
  }
  @Delete('roles/:id')
  @RequirePermissions('turnstile:roles:manage')
  remove(@Req() request: FastifyRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.execute(request, body, 'role.delete', id);
  }
  @Put('members/:id/assignments')
  @RequirePermissions('turnstile:people:manage')
  assignments(@Req() request: FastifyRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.execute(request, body, 'member.assignments', id);
  }
  @Post('members/:id/suspend')
  @HttpCode(200)
  @RequirePermissions('turnstile:people:manage')
  suspend(@Req() request: FastifyRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.execute(request, body, 'member.suspend', id);
  }
  @Post('members/:id/reactivate')
  @HttpCode(200)
  @RequirePermissions('turnstile:people:manage')
  reactivate(@Req() request: FastifyRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.execute(request, body, 'member.reactivate', id);
  }
  @Post('invitations')
  @RequirePermissions('turnstile:people:manage')
  async issue(
    @Req() request: FastifyRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.execute(request, body, 'invitation.issue');
    reply.code(result.replayed ? 200 : 201);
    return result;
  }
  @Post('invitations/:id/resend')
  @HttpCode(200)
  @RequirePermissions('turnstile:people:manage')
  resend(@Req() request: FastifyRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.execute(request, body, 'invitation.resend', id);
  }
  @Post('invitations/:id/reapprove')
  @HttpCode(200)
  @RequirePermissions('turnstile:people:manage')
  reapprove(@Req() request: FastifyRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.execute(request, body, 'invitation.reapprove', id);
  }
  @Post('invitations/:id/cancel')
  @HttpCode(200)
  @RequirePermissions('turnstile:people:manage')
  cancel(@Req() request: FastifyRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.execute(request, body, 'invitation.cancel', id);
  }
}
