import { Injectable } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    securityFailureStatus?: number;
    securityOutcome?: 'pending';
  }
}

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
    const event = ['/api/auth/login', '/api/auth/callback'].includes(path)
      ? 'product.login'
      : path === '/api/auth/session'
        ? 'product.session'
        : path === '/api/auth/logout'
          ? 'product.logout'
          : path === '/api/dms/capabilities'
            ? 'product.machine-request'
            : undefined;
    if (!event) return;
    const status = request.securityFailureStatus ?? reply.statusCode;
    const outcome =
      request.securityOutcome ??
      (status === 429
        ? 'limited'
        : status >= 500
          ? 'unavailable'
          : status === 401
            ? 'inactive'
            : status >= 400
              ? 'denied'
              : 'success');
    const key = `${event}.${outcome}`;
    const count = Math.min((this.counters.get(key) ?? 0) + 1, Number.MAX_SAFE_INTEGER);
    this.counters.set(key, count);
    if (this.enabled && process.stdout.writableLength < 65536)
      process.stdout.write(
        `${JSON.stringify({ type: 'security', event, outcome, status, count, requestId: request.id })}\n`,
      );
  }
}
