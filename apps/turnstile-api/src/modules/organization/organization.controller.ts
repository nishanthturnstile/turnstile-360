import { Body, Controller, Delete, Get, Param, Patch, Post, Req, Res } from '@nestjs/common';
import { CONFIGURATION_MANAGE_PERMISSION } from '@thaarei/turnstile-contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { configurationActor } from '../../infrastructure/configuration-http.js';
import { WorkspaceReadinessExempt } from '../../infrastructure/workspace-access.js';
import { RequirePermissions } from '../auth/user-session/access-policy.js';
import { OrganizationService } from './organization.service.js';

@Controller('organization')
@WorkspaceReadinessExempt()
@RequirePermissions('turnstile:access', CONFIGURATION_MANAGE_PERMISSION)
export class OrganizationController {
  constructor(private readonly organization: OrganizationService) {}
  @Get()
  async profile(@Req() request: FastifyRequest) {
    const { revision, organization } = await this.organization.read(configurationActor(request));
    return { revision, organization };
  }
  @Patch()
  save(@Req() request: FastifyRequest, @Body() body: unknown) {
    return this.organization.save(configurationActor(request), body);
  }
  @Get('units')
  async units(@Req() request: FastifyRequest) {
    const { revision, units } = await this.organization.read(configurationActor(request));
    return { revision, units };
  }
  @Post('units')
  async create(
    @Req() request: FastifyRequest,
    @Body() body: unknown,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.organization.createUnit(
      configurationActor(request),
      body,
      request.headers['idempotency-key'],
    );
    reply.code(result.replayed ? 200 : 201);
    return result;
  }
  @Patch('units/:id')
  rename(@Req() request: FastifyRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.organization.renameUnit(configurationActor(request), id, body);
  }
  @Patch('units/:id/parent')
  move(@Req() request: FastifyRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.organization.moveUnit(configurationActor(request), id, body);
  }
  @Delete('units/:id')
  remove(@Req() request: FastifyRequest, @Param('id') id: string, @Body() body: unknown) {
    return this.organization.deleteUnit(configurationActor(request), id, body);
  }
}
