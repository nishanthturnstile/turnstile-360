import { randomUUID } from 'node:crypto';
import { IDENTITY_SERVICE_SCOPES, identityServiceErrorSchema } from '@thaarei/dms-contracts';
import { z } from 'zod';
import { parseIdentityEnvironment } from './identity-environment.js';

export class IdentityAuthorityUnavailable extends Error {
  constructor(
    readonly code = 'IDENTITY_SERVICE_UNAVAILABLE',
    readonly status?: number,
  ) {
    super(code);
  }
}
/** Server-only adapter. No browser credentials, provider cookies or password operation. */
export class IdentityServiceTransport {
  readonly config: ReturnType<typeof parseIdentityEnvironment> | undefined;
  private token: { value: string; expiresAt: number } | undefined;
  private pending: Promise<string> | undefined;
  constructor(environment: NodeJS.ProcessEnv = process.env) {
    try {
      this.config = parseIdentityEnvironment(environment);
    } catch {
      /* Staged installations fail closed on use. */
    }
  }
  private async json(url: string, init: RequestInit): Promise<unknown> {
    const response = await fetch(url, {
      ...init,
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
    });
    const reader = response.body?.getReader();
    if (!reader) throw new IdentityAuthorityUnavailable();
    const chunks: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const next = await reader.read();
        if (next.done) break;
        length += next.value.length;
        if (length > 1048576) throw new IdentityAuthorityUnavailable();
        chunks.push(next.value);
      }
    } finally {
      await reader.cancel().catch(() => {});
    }
    if (!response.headers.get('content-type')?.toLowerCase().startsWith('application/json'))
      throw new IdentityAuthorityUnavailable();
    const data: unknown = JSON.parse(Buffer.concat(chunks).toString());
    if (!response.ok) {
      if (response.status === 401) this.token = undefined;
      const error = identityServiceErrorSchema.safeParse(data);
      throw new IdentityAuthorityUnavailable(
        error.success ? error.data.code : undefined,
        response.status,
      );
    }
    return data;
  }
  private async accessToken() {
    if (!this.config) throw new IdentityAuthorityUnavailable();
    if (this.token && this.token.expiresAt > Date.now()) return this.token.value;
    if (!this.pending) {
      const config = this.config;
      this.pending = (async () => {
        const body = new URLSearchParams({
          grant_type: 'client_credentials',
          resource: config.IDENTITY_SERVICE_RESOURCE_URL,
          scope: IDENTITY_SERVICE_SCOPES.join(' '),
        });
        const data = await this.json(`${config.IDENTITY_SERVICE_API_URL}/identity/oauth2/token`, {
          method: 'POST',
          headers: {
            'content-type': 'application/x-www-form-urlencoded',
            authorization: `Basic ${Buffer.from(`${encodeURIComponent(config.IDENTITY_SERVICE_CLIENT_ID)}:${encodeURIComponent(config.IDENTITY_SERVICE_CLIENT_SECRET)}`).toString('base64')}`,
          },
          body,
        });
        const result = z
          .object({
            access_token: z.string().min(1).max(8192),
            token_type: z.literal('Bearer'),
            expires_in: z.number().int().min(1).max(300),
            scope: z.string(),
            refresh_token: z.never().optional(),
          })
          .parse(data);
        const scopes = result.scope.split(' ');
        if (
          scopes.length !== IDENTITY_SERVICE_SCOPES.length ||
          IDENTITY_SERVICE_SCOPES.some((s) => !scopes.includes(s))
        )
          throw new IdentityAuthorityUnavailable();
        this.token = {
          value: result.access_token,
          expiresAt: Date.now() + Math.max(0, result.expires_in - 15) * 1000,
        };
        return result.access_token;
      })().finally(() => {
        this.pending = undefined;
      });
    }
    return this.pending;
  }
  protected async call<T>(path: string, schema: z.ZodType<T>, body?: unknown): Promise<T> {
    if (!this.config) throw new IdentityAuthorityUnavailable();
    try {
      const token = await this.accessToken();
      const result = await this.json(`${this.config.IDENTITY_SERVICE_API_URL}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
      return schema.parse(result);
    } catch (error) {
      if (error instanceof IdentityAuthorityUnavailable) throw error;
      throw new IdentityAuthorityUnavailable();
    }
  }
  async verifyRelease() {
    try {
      // A scoped, authenticated v1 not-found response proves the narrow service
      // contract and live client policy without creating accounts/preparations.
      await this.call(`/internal/identity/v1/invitation-preparations/${randomUUID()}`, z.never());
    } catch (error) {
      if (
        error instanceof IdentityAuthorityUnavailable &&
        error.status === 404 &&
        error.code === 'IDENTITY_SERVICE_NOT_FOUND'
      )
        return { version: 1 as const };
      throw error;
    }
    throw new IdentityAuthorityUnavailable();
  }
}
