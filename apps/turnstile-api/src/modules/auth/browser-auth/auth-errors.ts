import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from '@nestjs/common';
import type { AuthErrorCode } from '@thaarei/turnstile-contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ConfigurationException } from '../../../infrastructure/configuration-exception.js';
import { configurationParserError } from '../../../infrastructure/configuration-http.js';

export function authError(status: number, code: AuthErrorCode): never {
  throw new HttpException({ code }, status);
}

@Catch()
export class AuthExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const known = error instanceof HttpException;
    const feature = host.switchToHttp().getRequest<FastifyRequest>().routeOptions
      ?.config?.configurationEndpoint;
    const inputStatus =
      error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined;
    let status = known
      ? error.getStatus()
      : typeof inputStatus === 'number' && inputStatus >= 400 && inputStatus < 500
        ? inputStatus
        : 503;
    const response = known ? error.getResponse() : undefined;
    // The pinned Nest Fastify adapter wraps parser errors in string HttpExceptions.
    // Only typed auth/domain envelopes are safe to preserve on configuration routes.
    const mapFeature = feature && !(response && typeof response === 'object' && 'code' in response);
    if (mapFeature && status >= 500) status = 503;
    reply
      .code(status)
      .header(
        'cache-control',
        error instanceof ConfigurationException || mapFeature ? 'private, no-store' : 'no-store',
      )
      .header('referrer-policy', 'no-referrer')
      .send(
        mapFeature
          ? status === 401
            ? { code: 'IDENTITY_REQUIRED' }
            : status === 403
              ? { code: 'PERMISSION_DENIED' }
              : configurationParserError(status)
          : known
            ? response
            : { code: status === 503 ? 'AUTH_UNAVAILABLE' : 'INVALID_AUTH_REQUEST' },
      );
  }
}
