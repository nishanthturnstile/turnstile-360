import { getOAuthProviderApi } from '@better-auth/oauth-provider';
import { DMS_MACHINE_SCOPES } from '@thaarei/dms-contracts';
import type { GenericEndpointContext } from 'better-auth';
import { APIError } from 'better-auth/api';
import { z } from 'zod';
import type { AuthorityConfiguration } from './authority-configuration.js';

export const LOGIN_SCOPES = ['openid', 'profile', 'email', 'offline_access'] as const;
export const clientApproval = z.object({
  version: z.literal(1),
  kind: z.enum(['login', 'machine']),
  tenantId: z.uuid().toLowerCase(),
  applicationId: z.uuid().toLowerCase(),
  resource: z.string(),
});

export function userInfoResource(config: AuthorityConfiguration) {
  return `${config.AUTH_ISSUER_URL}/oauth2/userinfo`;
}

function reject(error: string) {
  throw new APIError('BAD_REQUEST', { error, error_description: 'OAuth policy rejected request' });
}

export async function enforceOAuthPolicy(
  ctx: GenericEndpointContext,
  config: AuthorityConfiguration,
) {
  if (
    !['/oauth2/authorize', '/oauth2/token', '/oauth2/introspect', '/oauth2/revoke'].includes(
      ctx.path,
    )
  )
    return;
  const authorize = ctx.path === '/oauth2/authorize';
  const input = (authorize ? ctx.query : ctx.body) as Record<string, unknown> | undefined;
  if (!input) return reject('invalid_request');
  const provider = ctx.context.options.plugins?.find((plugin) => plugin.id === 'oauth-provider');
  if (!provider?.options) throw new Error('OAuth provider unavailable');
  const providerApi = getOAuthProviderApi(
    ctx,
    provider.options as Parameters<typeof getOAuthProviderApi>[1],
  );
  // The provider validates the registered Basic method and secret before policy-dependent reads.
  const authenticated = authorize
    ? undefined
    : await providerApi.authenticateClient({
        requireCredentials: true,
      });
  const clientId = authenticated?.clientId ?? input.client_id;
  if (typeof clientId !== 'string') return reject('invalid_client');
  const client = await ctx.context.adapter.findOne<{
    clientId: string;
    metadata: unknown;
    referenceId: string | null;
    disabled: boolean;
    requirePKCE: boolean;
    skipConsent: boolean;
    grantTypes: string[];
    scopes: string[];
    clientCredentialsScopes: string[];
    tokenEndpointAuthMethod: string;
    redirectUris: string[];
    postLogoutRedirectUris: string[];
  }>({ model: 'oauthClient', where: [{ field: 'clientId', value: clientId }] });
  let approval: z.infer<typeof clientApproval> | undefined;
  try {
    const metadata =
      typeof client?.metadata === 'string' ? JSON.parse(client.metadata) : client?.metadata;
    approval = z.object({ thaarei: clientApproval }).parse(metadata).thaarei;
  } catch {
    return reject('invalid_client');
  }
  if (
    !client ||
    client.disabled ||
    client.referenceId !== config.INSTALLATION_TENANT_ID ||
    approval.tenantId !== config.INSTALLATION_TENANT_ID ||
    client.tokenEndpointAuthMethod !== 'client_secret_basic'
  )
    return reject('invalid_client');
  const login = approval.kind === 'login';
  const resource = login ? userInfoResource(config) : config.DMS_RESOURCE_URL;
  const allowedScopes: readonly string[] = login ? LOGIN_SCOPES : DMS_MACHINE_SCOPES;
  const grants = login ? ['authorization_code', 'refresh_token'] : ['client_credentials'];
  if (
    approval.resource !== resource ||
    !client.grantTypes?.length ||
    client.grantTypes.length !== grants.length ||
    client.grantTypes.some((grant) => !grants.includes(grant)) ||
    client.scopes?.some((scope) => !allowedScopes.includes(scope))
  )
    return reject('invalid_client');
  if (
    login
      ? !client.requirePKCE ||
        !client.skipConsent ||
        client.clientCredentialsScopes?.length ||
        client.redirectUris?.length !== 1 ||
        client.redirectUris[0] !== config.AUTH_LOGIN_CALLBACK_URL ||
        client.postLogoutRedirectUris?.length !== 1 ||
        client.postLogoutRedirectUris[0] !== `${config.AUTH_PUBLIC_ORIGIN}/sign-in`
      : !client.clientCredentialsScopes?.length ||
        client.clientCredentialsScopes.some((scope) => !allowedScopes.includes(scope)) ||
        client.redirectUris?.length
  )
    return reject('invalid_client');
  if (ctx.path === '/oauth2/introspect' || ctx.path === '/oauth2/revoke') return;
  if (authorize && !login) return reject('unauthorized_client');
  if (!authorize && !grants.includes(String(input.grant_type)))
    return reject('unauthorized_client');
  if (input.resource !== resource) return reject('invalid_target');
  if (
    input.scope !== undefined &&
    (typeof input.scope !== 'string' ||
      input.scope.split(/\s+/).some((scope) => !allowedScopes.includes(scope)))
  )
    return reject('invalid_scope');
  if (authorize) {
    if (
      input.response_type !== 'code' ||
      input.code_challenge_method !== 'S256' ||
      typeof input.code_challenge !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(input.code_challenge)
    )
      return reject('invalid_request');
    if (typeof input.scope !== 'string' || !input.scope.split(' ').includes('openid'))
      return reject('invalid_scope');
    if (input.prompt !== undefined && !['login', 'none'].includes(String(input.prompt)))
      return reject('invalid_request');
  }
  if (input.grant_type === 'refresh_token' && typeof input.refresh_token === 'string') {
    const token = await providerApi.hashToken(input.refresh_token, 'refresh_token');
    const refresh = await ctx.context.adapter.findOne<{ sessionId: string | null }>({
      model: 'oauthRefreshToken',
      where: [{ field: 'token', value: token }],
    });
    if (refresh) {
      const session = refresh.sessionId
        ? await ctx.context.adapter.findOne<{ expiresAt: Date }>({
            model: 'session',
            where: [{ field: 'id', value: refresh.sessionId }],
          })
        : null;
      if (!session || new Date(session.expiresAt).getTime() <= Date.now())
        return reject('invalid_grant');
    }
  }
}
