import { closeSync, fsyncSync, openSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { OAuthClient } from '@better-auth/oauth-provider';
import { DMS_MACHINE_SCOPES } from '@thaarei/dms-contracts';
import { z } from 'zod';
import { assertRuntimeRole, createPool } from '../../infrastructure/database/postgres.js';
import { DmsDatabaseService } from '../access/dms-database/dms-database.service.js';
import { captureAuthorityEvent } from '../audit/security-event.js';
import {
  type AuthorityConfiguration,
  parseAuthorityEnvironment,
} from './authority-configuration.js';
import { type Authority, createAuthority } from './authority-instance.js';
import { withOAuthOperator } from './oauth-operator-context.js';
import { clientApproval, LOGIN_SCOPES, userInfoResource } from './oauth-policy.js';
import { createRecoveryDelivery } from './recovery-delivery.js';

const inputSchema = z
  .object({
    action: z.enum(['issue', 'inspect', 'rotate', 'suspend', 'resume', 'set-scopes']),
    kind: z.enum(['login', 'machine']),
    clientId: z
      .string()
      .regex(/^[A-Za-z0-9_-]{3,128}$/)
      .optional(),
    applicationId: z.uuid().toLowerCase().optional(),
    scopes: z
      .array(z.enum(DMS_MACHINE_SCOPES))
      .min(1)
      .refine((values) => new Set(values).size === values.length)
      .optional(),
  })
  .strict();

function approvalOf(value: unknown) {
  // The provider flattens private metadata extensions into the registration response.
  return clientApproval.parse(z.object({ thaarei: z.unknown() }).parse(value).thaarei);
}

export async function manageOAuthClient(
  auth: Authority,
  config: AuthorityConfiguration,
  headers: Headers,
  input: unknown,
) {
  const request = inputSchema.parse(input);
  const clientId =
    request.clientId ??
    (request.kind === 'login' ? config.AUTH_LOGIN_CLIENT_ID : config.DMS_MACHINE_CLIENT_ID);
  if (
    (request.kind === 'machine' && clientId === config.AUTH_LOGIN_CLIENT_ID) ||
    (request.kind === 'login' && clientId === config.DMS_MACHINE_CLIENT_ID)
  )
    throw new Error('Client purposes must be distinct');
  if (request.action === 'issue' ? !request.applicationId : request.applicationId !== undefined)
    throw new Error('Application identity is required only at issuance');
  if (
    request.scopes !== undefined &&
    (request.kind !== 'machine' || !['issue', 'set-scopes'].includes(request.action))
  )
    throw new Error('Unexpected scope assignment');
  if (request.action === 'set-scopes' && (!request.scopes || request.kind !== 'machine'))
    throw new Error('Explicit machine scopes are required');
  if (request.action === 'issue' && request.kind === 'machine' && !request.scopes)
    throw new Error('Explicit machine scopes are required');
  const session = await auth.api.getSession({ headers });
  if (session?.user.role !== 'admin' || !session.user.emailVerified)
    throw new Error('Verified administrator required');

  const auditEvent = {
    action: `oauth.client.${request.action}`,
    actorKind: 'operator' as const,
    actorId: session.user.id,
    subjectId: clientId,
  };
  if (request.action !== 'inspect')
    await captureAuthorityEvent(config, { ...auditEvent, outcome: 'pending' });
  const managed = await withOAuthOperator(clientId, async () => {
    let result: OAuthClient;
    const resource = request.kind === 'login' ? userInfoResource(config) : config.DMS_RESOURCE_URL;
    if (request.action === 'issue') {
      if (request.kind === 'machine') {
        const context = await auth.$context;
        const existing = await context.adapter.findOne<{
          accessTokenTtl: number | null;
          signingAlgorithm: string | null;
          allowedScopes: string[] | null;
          disabled: boolean;
        }>({ model: 'oauthResource', where: [{ field: 'identifier', value: resource }] });
        if (!existing)
          await auth.api.adminCreateOAuthResource({
            headers,
            body: {
              identifier: resource,
              name: 'DMS API',
              accessTokenTtl: 300,
              signingAlgorithm: 'RS256',
              allowedScopes: [...DMS_MACHINE_SCOPES],
            },
          });
        else if (
          existing.disabled ||
          existing.accessTokenTtl === null ||
          existing.accessTokenTtl > 300 ||
          existing.signingAlgorithm !== 'RS256' ||
          !existing.allowedScopes?.length ||
          existing.allowedScopes.some(
            (scope) => !DMS_MACHINE_SCOPES.includes(scope as (typeof DMS_MACHINE_SCOPES)[number]),
          )
        )
          throw new Error('Existing resource requires operator policy review');
      }
      result = await auth.api.adminCreateOAuthClient({
        headers,
        body: {
          client_name: request.kind === 'login' ? 'Turnstile login' : 'DMS machine application',
          application_type: config.AUTH_PROFILE === 'production' ? 'web' : 'native',
          token_endpoint_auth_method: 'client_secret_basic',
          grant_types:
            request.kind === 'login'
              ? ['authorization_code', 'refresh_token']
              : ['client_credentials'],
          ...(request.kind === 'login'
            ? {
                redirect_uris: [config.AUTH_LOGIN_CALLBACK_URL],
                post_logout_redirect_uris: [`${config.AUTH_PUBLIC_ORIGIN}/sign-in`],
                response_types: ['code' as const],
                scope: LOGIN_SCOPES.join(' '),
                require_pkce: true,
                skip_consent: true,
                enable_end_session: true,
              }
            : {
                scope: request.scopes?.join(' '),
                client_credentials_scopes: request.scopes,
                resources: [resource],
                skip_consent: false,
                enable_end_session: false,
              }),
          metadata: {
            thaarei: {
              version: 1,
              kind: request.kind,
              tenantId: config.INSTALLATION_TENANT_ID,
              applicationId: request.applicationId,
              resource,
            },
          },
        },
      });
    } else {
      const current = await auth.api.getOAuthClient({ headers, query: { client_id: clientId } });
      const approval = approvalOf(current);
      if (
        approval.kind !== request.kind ||
        approval.tenantId !== config.INSTALLATION_TENANT_ID ||
        approval.resource !== resource
      )
        throw new Error('Client purpose or installation mismatch');
      if (request.action === 'rotate')
        result = await auth.api.rotateClientSecret({ headers, body: { client_id: clientId } });
      else if (request.action === 'suspend' || request.action === 'resume')
        result = await auth.api.adminUpdateOAuthClient({
          headers,
          body: { client_id: clientId, update: { disabled: request.action === 'suspend' } },
        });
      else if (request.action === 'set-scopes')
        result = await auth.api.adminUpdateOAuthClient({
          headers,
          body: {
            client_id: clientId,
            update: { scope: request.scopes?.join(' '), client_credentials_scopes: request.scopes },
          },
        });
      else result = current;
    }
    const approval = approvalOf(result);
    // Whitelist the operator record. The provider's returned registration may include a secret.
    return {
      record: {
        action: request.action,
        timestamp: new Date().toISOString(),
        operatorId: session.user.id,
        issuer: config.AUTH_ISSUER_URL,
        clientId: result.client_id,
        kind: approval.kind,
        tenantId: approval.tenantId,
        applicationId: approval.applicationId,
        resource: approval.resource,
        scopes: result.scope?.split(' ') ?? [],
        grantTypes: result.grant_types ?? [],
        redirectUris: result.redirect_uris ?? [],
        postLogoutRedirectUris: result.post_logout_redirect_uris ?? [],
        disabled: result.disabled ?? false,
      },
      secret: ['issue', 'rotate'].includes(request.action) ? result.client_secret : undefined,
    };
  });
  if (request.action === 'inspect') return managed;
  let audit: 'success' | 'pending' = 'success';
  try {
    await captureAuthorityEvent(config, { ...auditEvent, outcome: 'success' });
  } catch {
    audit =
      'pending'; /* Preserve the returned secret; the durable attempt record already exists. */
  }
  return { ...managed, record: { ...managed.record, audit } };
}

const commandSchema = inputSchema.extend({
  operatorEmail: z.email(),
  operatorPassword: z.string().min(15).max(128),
  credentialFile: z.string().min(1).optional(),
});

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  let descriptor: number | undefined;
  let pool: ReturnType<typeof createPool> | undefined;
  let dms: DmsDatabaseService | undefined;
  let auth: Authority | undefined;
  let operatorHeaders: Headers | undefined;
  try {
    if (process.stdin.isTTY) throw new Error('Supply private JSON on stdin');
    let json = '';
    for await (const chunk of process.stdin) {
      json += chunk;
      if (Buffer.byteLength(json) > 8192) throw new Error('Input too large');
    }
    const { operatorEmail, operatorPassword, credentialFile, ...operation } = commandSchema.parse(
      JSON.parse(json),
    );
    if (['issue', 'rotate'].includes(operation.action) !== !!credentialFile)
      throw new Error('Issuance/rotation requires a new private credential file');
    // Reserve the secret destination before any mutation. Never overwrite a previous credential.
    if (credentialFile) descriptor = openSync(credentialFile, 'wx', 0o600);
    const config = parseAuthorityEnvironment(process.env);
    pool = createPool(config.AUTH_DATABASE_URL, 1);
    await assertRuntimeRole(pool, 'auth');
    dms = new DmsDatabaseService();
    if (!(await dms.ready())) throw new Error('Installation is unavailable');
    auth = createAuthority(config, pool, createRecoveryDelivery(config));
    const login = await auth.api.signInEmail({
      body: { email: operatorEmail, password: operatorPassword },
      headers: new Headers({ origin: config.AUTH_PUBLIC_ORIGIN }),
      returnHeaders: true,
    });
    operatorHeaders = new Headers({
      origin: config.AUTH_PUBLIC_ORIGIN,
      cookie: login.headers
        .getSetCookie()
        .map((value) => value.split(';')[0])
        .join('; '),
    });
    const result = await manageOAuthClient(auth, config, operatorHeaders, operation);
    if (descriptor !== undefined) {
      if (!result.secret) throw new Error('Provider did not return a credential');
      writeFileSync(
        descriptor,
        `${JSON.stringify({ clientId: result.record.clientId, clientSecret: result.secret })}\n`,
      );
      fsyncSync(descriptor);
    }
    console.log(JSON.stringify(result.record));
  } catch {
    console.error(
      'OAuth operation failed; inspect the nonsecret client state before retrying. Rotation has no grace period.',
    );
    process.exitCode = 1;
  } finally {
    if (auth && operatorHeaders)
      await auth.api.signOut({ headers: operatorHeaders }).catch(() => {
        process.exitCode = 1;
      });
    if (descriptor !== undefined) closeSync(descriptor);
    await pool?.end();
    await dms?.onApplicationShutdown();
  }
}
