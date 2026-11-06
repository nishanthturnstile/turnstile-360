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
                : path.startsWith('/v1/') || path.startsWith('/internal/work/')
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
    const durationMs = Math.max(0, Math.min(30000, reply.elapsedTime));
    const bucket = [50, 100, 300, 1000, 5000, 30000].find((value) => durationMs <= value) ?? 30000;
    for (const threshold of [50, 100, 300, 1000, 5000, 30000])
      if (durationMs <= threshold) {
        const latencyKey = `${event}.latency_le_${threshold}`;
        this.counters.set(
          latencyKey,
          Math.min(Number.MAX_SAFE_INTEGER, (this.counters.get(latencyKey) ?? 0) + 1),
        );
      }
    if (this.enabled && process.stdout.writableLength < 65536)
      process.stdout.write(
        `${JSON.stringify({ type: 'security', event, outcome, status, count, durationMs, bucket, requestId: request.id })}\n`,
      );
  }
}
