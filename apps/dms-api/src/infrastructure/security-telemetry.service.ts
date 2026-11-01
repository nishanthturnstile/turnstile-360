import { Injectable } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

@Injectable()
export class SecurityTelemetryService {
  private enabled = false;
  private readonly counters = new Map<string, number>();
  enable(enabled: boolean) {
    this.enabled = enabled;
  }
  snapshot() {
    return Object.fromEntries(this.counters);
  }
  observe(request: FastifyRequest, reply: FastifyReply) {
    const path = request.url.split('?')[0] ?? '';
    const event =
      path === '/identity/sign-in/email'
        ? 'identity.login'
        : /^\/identity\/(request-password-reset|reset-password|verify-email|send-verification-email)(\/|$)/.test(
              path,
            )
          ? 'identity.recovery'
          : path === '/identity/oauth2/token'
            ? 'identity.token'
            : path === '/identity/jwks'
              ? 'identity.key-fetch'
              : path === '/v1/application-enrollments'
                ? 'machine.enrollment'
                : path.startsWith('/v1/')
                  ? 'machine.access'
                  : undefined;
    if (!event) return;
    const status = reply.statusCode;
    const outcome =
      status === 429
        ? 'limited'
        : status >= 500
          ? 'unavailable'
          : status >= 400
            ? 'denied'
            : 'success';
    const key = `${event}.${outcome}`;
    const count = Math.min((this.counters.get(key) ?? 0) + 1, Number.MAX_SAFE_INTEGER);
    this.counters.set(key, count);
    if (this.enabled && process.stdout.writableLength < 65536)
      process.stdout.write(
        `${JSON.stringify({ type: 'security', event, outcome, status, count, requestId: request.id })}\n`,
      );
  }
}
