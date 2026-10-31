import { DMS_MACHINE_SCOPES, type DmsMachineScope } from '@thaarei/dms-contracts';
import { DmsClientError, fixedUrl, jsonRequest, timeout } from './http.js';

export interface MachineAccessToken {
  readonly accessToken: string;
  readonly expiresAt: number;
}
export interface MachineTokenProvider {
  getToken(): Promise<MachineAccessToken>;
  invalidate(rejected: MachineAccessToken): void;
}
export interface ClientCredentialsOptions {
  issuerUrl: string;
  clientId: string;
  clientSecret: string;
  resource: string;
  scopes: readonly DmsMachineScope[];
  allowInsecureHttp?: boolean;
  timeoutMs?: number;
  transport?: typeof fetch;
}

export class ClientCredentialsTokenProvider implements MachineTokenProvider {
  private readonly issuer: string;
  private readonly resource: string;
  private readonly clientId: string;
  private readonly secret: string;
  private readonly scopes: readonly string[];
  private readonly transport: typeof fetch;
  private readonly timeoutMs: number;
  // A provider owns exactly one immutable issuer/client/resource/scope cache partition.
  private readonly cacheKey: string;
  private cached: { key: string; token: MachineAccessToken; renewAt: number } | undefined;
  private pending: Promise<MachineAccessToken> | undefined;

  constructor(options: ClientCredentialsOptions) {
    this.issuer = fixedUrl(options.issuerUrl, options.allowInsecureHttp ?? false);
    this.resource = fixedUrl(options.resource, options.allowInsecureHttp ?? false);
    this.clientId = options.clientId;
    this.secret = options.clientSecret;
    this.scopes = [...new Set(options.scopes)].sort();
    if (
      !/^[A-Za-z0-9_-]{3,128}$/.test(this.clientId) ||
      !this.secret ||
      this.secret.length > 512 ||
      !this.scopes.length ||
      this.scopes.some((scope) => !(DMS_MACHINE_SCOPES as readonly string[]).includes(scope))
    )
      throw new DmsClientError('DMS_CONFIGURATION_INVALID');
    this.transport = options.transport ?? fetch;
    this.timeoutMs = timeout(options.timeoutMs);
    this.cacheKey = JSON.stringify([this.issuer, this.clientId, this.resource, this.scopes]);
  }

  async getToken(): Promise<MachineAccessToken> {
    if (this.cached?.key === this.cacheKey && this.cached.renewAt > Date.now())
      return this.cached.token;
    if (!this.pending) {
      this.pending = this.acquire()
        .then((token) => {
          const remaining = token.expiresAt - Date.now();
          this.cached = {
            key: this.cacheKey,
            token,
            renewAt: token.expiresAt - Math.min(30000, remaining / 10),
          };
          return token;
        })
        .finally(() => {
          this.pending = undefined;
        });
    }
    return this.pending;
  }

  invalidate(rejected: MachineAccessToken) {
    // A delayed 401 must not evict a newer token acquired by another concurrent call.
    if (this.cached?.token.accessToken === rejected.accessToken) this.cached = undefined;
  }

  private async acquire(): Promise<MachineAccessToken> {
    const started = Date.now();
    const encode = (value: string) => new URLSearchParams({ value }).toString().slice(6);
    const response = await jsonRequest(
      `${this.issuer}/oauth2/token`,
      {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/x-www-form-urlencoded',
          authorization: `Basic ${Buffer.from(`${encode(this.clientId)}:${encode(this.secret)}`).toString('base64')}`,
        },
        body: new URLSearchParams({
          grant_type: 'client_credentials',
          scope: this.scopes.join(' '),
          resource: this.resource,
        }).toString(),
      },
      this.transport,
      this.timeoutMs,
    );
    if (response.status !== 200) {
      const body = response.body;
      if (body && typeof body === 'object' && 'error' in body && body.error === 'invalid_scope')
        throw new DmsClientError('DMS_ACCESS_DENIED', response.status);
      throw new DmsClientError(
        response.status === 401 ? 'DMS_MACHINE_AUTH_FAILED' : 'DMS_UNAVAILABLE',
        response.status,
      );
    }
    const body = response.body;
    if (!body || typeof body !== 'object') throw new DmsClientError('DMS_INVALID_RESPONSE');
    const data = body as Record<string, unknown>;
    const expiresIn = data.expires_in;
    if (
      (data.token_type !== 'Bearer' && data.token_type !== 'bearer') ||
      typeof data.access_token !== 'string' ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(data.access_token) ||
      data.access_token.length > 16384 ||
      typeof expiresIn !== 'number' ||
      !Number.isInteger(expiresIn) ||
      expiresIn <= 0 ||
      expiresIn > 300 ||
      'refresh_token' in data ||
      'id_token' in data ||
      (data.scope !== undefined &&
        (typeof data.scope !== 'string' ||
          JSON.stringify(data.scope.split(' ').sort()) !== JSON.stringify(this.scopes)))
    )
      throw new DmsClientError('DMS_INVALID_RESPONSE');
    const token = Object.freeze({
      accessToken: data.access_token,
      expiresAt: started + expiresIn * 1000,
    });
    if (token.expiresAt <= Date.now()) throw new DmsClientError('DMS_UNAVAILABLE');
    return token;
  }
}
