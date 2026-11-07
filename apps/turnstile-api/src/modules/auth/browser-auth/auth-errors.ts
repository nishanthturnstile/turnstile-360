import { type ArgumentsHost, Catch, type ExceptionFilter, HttpException } from '@nestjs/common';
import { PEOPLE_ERROR_STATUS } from '@thaarei/turnstile-contracts';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { ConfigurationException } from '../../../infrastructure/configuration-exception.js';
import { configurationParserError } from '../../../infrastructure/configuration-http.js';
import { peopleHttpFailure } from '../../../infrastructure/people-http.js';
import { recipientFailure } from '../../../infrastructure/recipient-http.js';
import { structureFailure } from '../../../infrastructure/structure-http.js';

export { authError } from '../../../infrastructure/access-error.js';

@Catch()
export class AuthExceptionFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const reply = host.switchToHttp().getResponse<FastifyReply>();
    const known = error instanceof HttpException;
    const request = host.switchToHttp().getRequest<FastifyRequest>();
    const feature = request.routeOptions?.config?.configurationEndpoint;
    const structure = request.routeOptions?.config?.structureEndpoint;
    const inputStatus =
      error && typeof error === 'object' && 'statusCode' in error ? error.statusCode : undefined;
    let status = known
      ? error.getStatus()
      : typeof inputStatus === 'number' && inputStatus >= 400 && inputStatus < 500
        ? inputStatus
        : 503;
    const response = known ? error.getResponse() : undefined;
    if (
      response &&
      typeof response === 'object' &&
      'code' in response &&
      response.code === 'DEPLOYMENT_RESTRICTED'
    ) {
      reply
        .code(403)
        .header('cache-control', 'private, no-store')
        .send({ code: 'DEPLOYMENT_RESTRICTED', requestId: request.id });
      return;
    }
    if (request.routeOptions?.config?.peopleEndpoint) {
      const failure = peopleHttpFailure(response, status, request.id);
      if ('retryAfterSeconds' in failure)
        reply.header('retry-after', String(failure.retryAfterSeconds));
      reply
        .code(PEOPLE_ERROR_STATUS[failure.code])
        .header('cache-control', 'private, no-store')
        .header('referrer-policy', 'no-referrer')
        .send(failure);
      return;
    }
    if (request.routeOptions?.config?.recipientEndpoint) {
      reply
        .code(status >= 500 ? 503 : status)
        .header('cache-control', 'private, no-store')
        .header('referrer-policy', 'no-referrer')
        .send(recipientFailure(response, status, request.id));
      return;
    }
    if (structure) {
      const failure = structureFailure(response, status, request.id);
      reply
        .code(PEOPLE_ERROR_STATUS[failure.code])
        .header('cache-control', 'private, no-store')
        .header('referrer-policy', 'no-referrer')
        .send(failure);
      return;
    }
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
