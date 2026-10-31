import type { FastifyRequest } from 'fastify';
import { authError } from './auth-errors.js';
import { equal } from './bff-state.js';

export function verifyProductCsrf(
  request: Pick<FastifyRequest, 'headers'>,
  expected: string,
  origin: string,
) {
  if (
    request.headers.origin !== origin ||
    (request.headers['sec-fetch-site'] && request.headers['sec-fetch-site'] !== 'same-origin') ||
    !equal(request.headers['x-csrf-token'], expected)
  )
    authError(403, 'CSRF_REJECTED');
}
