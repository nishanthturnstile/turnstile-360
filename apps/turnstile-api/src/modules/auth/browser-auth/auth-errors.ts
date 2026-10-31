import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from '@nestjs/common';
import type { AuthErrorCode } from '@thaarei/turnstile-contracts';
import type { FastifyReply } from 'fastify';

export function authError(status: number, code: AuthErrorCode): never {
  throw new HttpException({ code }, status);
}

@Catch()
export class AuthExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const known = error instanceof HttpException;
    const inputStatus =
      error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined;
    const status = known
      ? error.getStatus()
      : typeof inputStatus === 'number' && inputStatus >= 400 && inputStatus < 500
        ? inputStatus
        : 503;
    reply
      .code(status)
      .header('cache-control', 'no-store')
      .header('referrer-policy', 'no-referrer')
      .send(
        known
          ? error.getResponse()
          : { code: status === 503 ? 'AUTH_UNAVAILABLE' : 'INVALID_AUTH_REQUEST' },
      );
  }
}
