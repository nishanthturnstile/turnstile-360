import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from '@nestjs/common';
import type { DmsErrorCode } from '@thaarei/dms-contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';

export function dmsError(status: number, code: DmsErrorCode): never {
  throw new HttpException({ code }, status);
}

@Catch()
export class DmsExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const context = host.switchToHttp();
    const reply = context.getResponse<FastifyReply>();
    const request = context.getRequest<FastifyRequest>();
    // Preserve the existing readiness contract; all domain errors use the shared envelope.
    if (error instanceof HttpException && request.url.startsWith('/health/'))
      return reply.code(error.getStatus()).send(error.getResponse());
    const known = error instanceof HttpException;
    const details = known ? error.getResponse() : undefined;
    const inputStatus =
      error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined;
    const status = known
      ? error.getStatus()
      : typeof inputStatus === 'number' && inputStatus >= 400 && inputStatus < 500
        ? inputStatus
        : 503;
    const code =
      details && typeof details === 'object' && 'code' in details
        ? details.code
        : status === 503
          ? 'DMS_UNAVAILABLE'
          : 'INVALID_REQUEST';
    if (status === 401) reply.header('www-authenticate', 'Bearer realm="dms"');
    if (code === 'ENROLLMENT_IN_PROGRESS') reply.header('retry-after', '1');
    return reply
      .code(status)
      .header('cache-control', 'no-store')
      .header('x-request-id', request.id)
      .send({
        code,
        requestId: request.id,
        retryable: status === 503 || code === 'ENROLLMENT_IN_PROGRESS',
      });
  }
}
