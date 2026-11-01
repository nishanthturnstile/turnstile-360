import { HttpException, Injectable } from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import * as oidc from 'openid-client';
import { z } from 'zod';
import { AuthConfigurationService } from '../auth-configuration/auth-configuration.service.js';
import { authError } from './auth-errors.js';
import { ABSOLUTE_MS, type BffState, type UserIdentity } from './bff-state.js';

const parent = z.object({
  session: z.object({
    id: z.string(),
    userId: z.string(),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
  }),
});

export function authorityCookies(request: FastifyRequest) {
  return Object.entries(request.cookies ?? {})
    .filter(([name]) => /^(?:__Secure-)?thaarei-identity\.[A-Za-z0-9_.-]+$/.test(name))
    .map(([name, value]) => `${name}=${encodeURIComponent(value ?? '')}`)
    .join('; ');
}

export function loginFailure(error: unknown): never {
  if (error instanceof HttpException) throw error;
  if (
    error instanceof oidc.AuthorizationResponseError ||
    (error instanceof oidc.ResponseBodyError && error.error === 'invalid_grant') ||
    (error instanceof oidc.ClientError &&
      [
        'OAUTH_JWT_CLAIM_COMPARISON_FAILED',
        'OAUTH_JWT_TIMESTAMP_CHECK_FAILED',
        'OAUTH_INVALID_RESPONSE',
        'OAUTH_JWT_SIGNATURE_VERIFICATION_FAILED',
      ].includes(error.code ?? ''))
  )
    return authError(401, 'LOGIN_REQUIRED');
  return authError(503, 'AUTH_UNAVAILABLE');
}

@Injectable()
export class OidcService {
  private configuration: Promise<oidc.Configuration> | undefined;
  constructor(private readonly settings: AuthConfigurationService) {}

  get config() {
    if (!this.settings.config) return authError(503, 'AUTH_UNAVAILABLE');
    return this.settings.config;
  }
  get resource() {
    return `${this.config.AUTH_ISSUER_URL}/oauth2/userinfo`;
  }

  // Pin every discovery/HTTP endpoint to the accepted issuer. Do not follow redirects
  // carrying credentials or substitute internal hostnames for the canonical issuer.
  private readonly transport: oidc.CustomFetch = async (input, options) => {
    const url = new URL(input);
    const issuer = this.config.AUTH_ISSUER_URL;
    const allowed = [
      '/.well-known/openid-configuration',
      '/oauth2/token',
      '/oauth2/introspect',
      '/oauth2/revoke',
      '/oauth2/userinfo',
      '/jwks',
    ];
    if (!allowed.some((path) => url.href === `${issuer}${path}`))
      throw new Error('Unexpected identity endpoint');
    const body =
      options.body instanceof Uint8Array
        ? new Uint8Array(options.body).buffer
        : (options.body ?? null);
    return fetch(input, {
      ...options,
      body,
      redirect: 'error',
      signal: options?.signal
        ? AbortSignal.any([options.signal, AbortSignal.timeout(5000)])
        : AbortSignal.timeout(5000),
    });
  };

  async client() {
    if (!this.configuration) {
      this.configuration = oidc
        .discovery(
          new URL(this.config.AUTH_ISSUER_URL),
          this.config.AUTH_LOGIN_CLIENT_ID,
          { id_token_signed_response_alg: 'RS256' },
          oidc.ClientSecretBasic(this.config.AUTH_LOGIN_CLIENT_SECRET),
          {
            timeout: 5,
            [oidc.customFetch]: this.transport,
            execute: [
              ...(this.config.AUTH_PROFILE !== 'production' &&
              this.config.AUTH_ISSUER_URL.startsWith('http:')
                ? [oidc.allowInsecureRequests]
                : []),
              oidc.enableNonRepudiationChecks,
            ],
          },
        )
        .then((client) => {
          const metadata = client.serverMetadata();
          const expected = {
            authorization_endpoint: '/oauth2/authorize',
            token_endpoint: '/oauth2/token',
            introspection_endpoint: '/oauth2/introspect',
            revocation_endpoint: '/oauth2/revoke',
            userinfo_endpoint: '/oauth2/userinfo',
            jwks_uri: '/jwks',
            end_session_endpoint: '/oauth2/end-session',
          };
          for (const [field, path] of Object.entries(expected))
            if (metadata[field] !== `${this.config.AUTH_ISSUER_URL}${path}`)
              throw new Error('Identity metadata mismatch');
          return client;
        })
        .catch(() => {
          this.configuration = undefined;
          return authError(503, 'AUTH_UNAVAILABLE');
        });
    }
    return this.configuration;
  }

  async authorization(transaction: Extract<BffState, { kind: 'login' }>) {
    return oidc.buildAuthorizationUrl(await this.client(), {
      redirect_uri: transaction.redirect,
      scope: 'openid profile email offline_access',
      resource: this.resource,
      state: transaction.state,
      nonce: transaction.nonce,
      code_challenge: await oidc.calculatePKCECodeChallenge(transaction.verifier),
      code_challenge_method: 'S256',
    }).href;
  }

  async ready() {
    // Authenticate the configured login client and verify live endpoint reachability.
    // This probes no user token and does not cache a user's authorization decision.
    await oidc.tokenIntrospection(await this.client(), 'turnstile-readiness', {
      token_type_hint: 'access_token',
    });
  }

  private tokenSet(tokens: oidc.TokenEndpointResponse, previous?: UserIdentity) {
    if (
      tokens.token_type?.toLowerCase() !== 'bearer' ||
      !tokens.access_token ||
      !tokens.refresh_token ||
      !Number.isFinite(tokens.expires_in) ||
      (tokens.expires_in ?? 0) <= 0 ||
      (tokens.expires_in ?? 0) > 300 ||
      (!previous && !tokens.id_token)
    )
      return authError(401, 'LOGIN_REQUIRED');
    if (
      tokens.scope &&
      (tokens.scope
        .split(' ')
        .some((scope) => !['openid', 'profile', 'email', 'offline_access'].includes(scope)) ||
        !tokens.scope.split(' ').includes('openid'))
    )
      return authError(401, 'LOGIN_REQUIRED');
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      idToken: tokens.id_token ?? previous?.idToken ?? '',
      accessExpiresAt: Date.now() + (tokens.expires_in ?? 0) * 1000,
    };
  }

  async exchange(
    url: URL,
    transaction: Extract<BffState, { kind: 'login' }>,
    cookies: string,
  ): Promise<UserIdentity> {
    const client = await this.client();
    const tokens = await oidc.authorizationCodeGrant(
      client,
      url,
      {
        pkceCodeVerifier: transaction.verifier,
        expectedState: transaction.state,
        expectedNonce: transaction.nonce,
        idTokenExpected: true,
      },
      { resource: this.resource },
    );
    const claims = tokens.claims();
    const credentials = this.tokenSet(tokens);
    try {
      if (
        !claims ||
        typeof claims.sid !== 'string' ||
        typeof claims.auth_time !== 'number' ||
        claims.auth_time * 1000 > Date.now() + 5000
      )
        return authError(401, 'LOGIN_REQUIRED');
      const user = await oidc.fetchUserInfo(client, credentials.accessToken, claims.sub);
      if (
        user.email_verified !== true ||
        typeof user.email !== 'string' ||
        typeof user.name !== 'string'
      )
        return authError(401, 'IDENTITY_REQUIRED');
      // Read only the authority's public session projection over HTTP, never its database.
      // This binds the absolute product limit to the actual parent expiry, even when shortened.
      const current = await this.authorityRequest('/get-session', 'GET', cookies);
      const parsed = parent.safeParse(await current.json());
      if (
        !parsed.success ||
        parsed.data.session.id !== claims.sid ||
        parsed.data.session.userId !== claims.sub
      )
        return authError(401, 'IDENTITY_REQUIRED');
      const absoluteExpiresAt = Math.min(
        Date.parse(parsed.data.session.expiresAt),
        claims.auth_time * 1000 + ABSOLUTE_MS,
        Date.parse(parsed.data.session.createdAt) + ABSOLUTE_MS,
      );
      if (absoluteExpiresAt <= Date.now()) return authError(401, 'IDENTITY_REQUIRED');
      return {
        ...credentials,
        user: { id: claims.sub, name: user.name, email: user.email },
        sid: claims.sid,
        absoluteExpiresAt,
        idleExpiresAt: Math.min(Date.now() + 1800000, absoluteExpiresAt),
        permissions: [],
      };
    } catch (error) {
      await this.revoke({ refreshToken: credentials.refreshToken }).catch(() => {});
      throw error;
    }
  }

  async active(identity: UserIdentity) {
    let value: Awaited<ReturnType<typeof oidc.tokenIntrospection>>;
    try {
      value = await oidc.tokenIntrospection(await this.client(), identity.accessToken, {
        token_type_hint: 'access_token',
      });
    } catch {
      return authError(503, 'AUTH_UNAVAILABLE');
    }
    if (
      !value.active ||
      value.sub !== identity.user.id ||
      value.client_id !== this.config.AUTH_LOGIN_CLIENT_ID ||
      value.iss !== this.config.AUTH_ISSUER_URL ||
      value.sid !== identity.sid ||
      (Array.isArray(value.aud)
        ? value.aud.length !== 1 || value.aud[0] !== this.resource
        : value.aud !== this.resource) ||
      value.token_type?.toLowerCase() !== 'bearer' ||
      typeof value.exp !== 'number' ||
      value.exp * 1000 <= Date.now()
    )
      return authError(401, 'IDENTITY_REQUIRED');
  }

  async refresh(identity: UserIdentity) {
    const tokens = await oidc.refreshTokenGrant(await this.client(), identity.refreshToken, {
      resource: this.resource,
    });
    const claims = tokens.claims();
    if (claims && (claims.sub !== identity.user.id || claims.sid !== identity.sid))
      return authError(401, 'LOGIN_REQUIRED');
    return { ...identity, ...this.tokenSet(tokens, identity) };
  }

  private async authorityRequest(
    path: string,
    method: 'GET' | 'POST',
    cookies = '',
    body?: Record<string, string>,
  ) {
    const response = await fetch(`${this.config.AUTH_ISSUER_URL}${path}`, {
      method,
      redirect: 'error',
      signal: AbortSignal.timeout(5000),
      headers: {
        origin: this.config.AUTH_PUBLIC_ORIGIN,
        accept: 'application/json',
        ...(cookies ? { cookie: cookies } : {}),
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    if (!response.ok) throw new Error('Identity request unavailable');
    return response;
  }

  async logout(identity: UserIdentity, cookies: string) {
    await this.revoke(identity);
    // A retained, signed hint supports direct API clients without an authority cookie.
    // The hint is sent only in this server-side POST body, never a browser URL.
    await this.authorityRequest('/oauth2/end-session', 'POST', '', {
      client_id: this.config.AUTH_LOGIN_CLIENT_ID,
      id_token_hint: identity.idToken,
    });
    return this.clearBrowserSession(cookies, identity.sid);
  }

  async clearBrowserSession(cookies: string, sid: string) {
    if (!cookies) return [];
    const response = await this.authorityRequest('/get-session', 'GET', cookies);
    const current = (await response.json()) as unknown;
    const parsed = parent.safeParse(current);
    // Do not sign out a different authority login established in another tab.
    if (current !== null && (!parsed.success || parsed.data.session.id !== sid)) return [];
    const ended = await this.authorityRequest('/sign-out', 'POST', cookies, {});
    return ended.headers.getSetCookie();
  }

  async revoke(identity: Pick<UserIdentity, 'refreshToken'>) {
    await oidc.tokenRevocation(await this.client(), identity.refreshToken, {
      token_type_hint: 'refresh_token',
    });
  }
}
