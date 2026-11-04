import { Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { PublicEndpoint } from '../../infrastructure/access-policy.js';
import { RecipientService } from './recipient.service.js';

// Each handler enforces its explicit credential/continuation/verified policy.
// This exception never authorizes ordinary product routes or People administration.
@Controller('invitations')
@PublicEndpoint()
export class RecipientController {
  constructor(private readonly recipient: RecipientService) {}
  @Post('exchange')
  @HttpCode(200)
  exchange(@Req() request: FastifyRequest) {
    return this.recipient.exchange(request);
  }
  @Get('context')
  context(@Req() request: FastifyRequest) {
    return this.recipient.context(request);
  }
  @Post('start')
  @HttpCode(200)
  start(@Req() request: FastifyRequest) {
    return this.recipient.start(request);
  }
  @Post('setup')
  @HttpCode(200)
  setup(@Req() request: FastifyRequest) {
    return this.recipient.setup(request);
  }
  @Post('accept')
  @HttpCode(200)
  accept(@Req() request: FastifyRequest) {
    return this.recipient.accept(request);
  }
  @Post('decline')
  @HttpCode(200)
  decline(@Req() request: FastifyRequest) {
    return this.recipient.decline(request);
  }
  @Post('cancel')
  @HttpCode(200)
  cancel(@Req() request: FastifyRequest) {
    return this.recipient.cancel(request);
  }
  @Post('switch-account')
  @HttpCode(200)
  switchAccount(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    return this.recipient.switchAccount(request, reply);
  }
  @Post('logout')
  @HttpCode(200)
  logout(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    return this.recipient.switchAccount(request, reply);
  }
}
