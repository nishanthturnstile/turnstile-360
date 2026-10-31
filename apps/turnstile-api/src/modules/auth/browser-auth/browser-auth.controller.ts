import {
  Controller,
  Get,
  HttpCode,
  HttpException,
  Post,
  Req,
  Res,
  UseFilters,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { PublicEndpoint, RequirePermissions } from '../user-session/access-policy.js';
import { AuthExceptionFilter } from './auth-errors.js';
import { BrowserAuthService } from './browser-auth.service.js';

@Controller('auth')
@UseFilters(AuthExceptionFilter)
export class BrowserAuthController {
  constructor(private readonly auth: BrowserAuthService) {}

  @Get('login')
  @PublicEndpoint()
  async login(@Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    try {
      return await this.auth.login(request, reply);
    } catch (error) {
      return this.navigationFailure(error, request, reply);
    }
  }

  @Get('callback')
  @PublicEndpoint()
  async callback(@Req() request: FastifyRequest, @Res() reply: FastifyReply) {
    try {
      return await this.auth.callback(request, reply);
    } catch (error) {
      return this.navigationFailure(error, request, reply);
    }
  }

  private navigationFailure(error: unknown, request: FastifyRequest, reply: FastifyReply) {
    if (!request.headers.accept?.includes('text/html')) throw error;
    const status = error instanceof HttpException ? error.getStatus() : 503;
    request.securityFailureStatus = status;
    const destination =
      status === 403 ? '/unauthorized' : status >= 500 ? '/auth-unavailable' : '/session-expired';
    return reply
      .code(302)
      .header('cache-control', 'no-store')
      .header('referrer-policy', 'no-referrer')
      .redirect(destination);
  }

  @Get('session')
  @RequirePermissions('turnstile:access')
  session(@Req() request: FastifyRequest) {
    return this.auth.session(request);
  }

  // Logout validates its own stored CSRF token and remains available after identity expiry.
  @Post('logout')
  @HttpCode(200)
  @PublicEndpoint()
  async logout(@Req() request: FastifyRequest, @Res({ passthrough: true }) reply: FastifyReply) {
    const result = await this.auth.logout(request, reply);
    if (result.authority === 'pending') request.securityOutcome = 'pending';
    return result;
  }
}
