import { closeSync, fsyncSync, openSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DMS_MACHINE_SCOPES, DMS_PRINCIPAL_KINDS } from '@thaarei/dms-contracts';
import { z } from 'zod';
import { bootstrapInstallation } from '../../infrastructure/database/migrate.js';
import { assertRuntimeRole, createPool } from '../../infrastructure/database/postgres.js';
import { parseAuthorityEnvironment } from '../platform-auth/authority-configuration.js';
import { type Authority, createAuthority } from '../platform-auth/authority-instance.js';
import { manageOAuthClient } from '../platform-auth/manage-client.js';
import { createRecoveryDelivery } from '../platform-auth/recovery-delivery.js';
import {
  disableApplication,
  inspectApplication,
  issueEnrollmentKey,
  registerApplication,
  revokeEnrollmentKey,
  setApplicationScopes,
} from './enrollment-operator.js';

const identity = { applicationId: z.uuid().toLowerCase() };
const credentials = { operatorEmail: z.email(), operatorPassword: z.string().min(15).max(128) };
const scopes = z.array(z.enum(DMS_MACHINE_SCOPES));
const commandSchema = z.discriminatedUnion('action', [
  z
    .object({
      action: z.literal('register'),
      ...identity,
      ...credentials,
      clientId: z.string(),
      name: z.string(),
      scopes,
      principalKind: z.enum(DMS_PRINCIPAL_KINDS).optional(),
    })
    .strict(),
  z.object({ action: z.literal('inspect'), ...identity }).strict(),
  z
    .object({
      action: z.literal('issue-key'),
      ...identity,
      credentialFile: z.string().min(1),
      hours: z.number().int().min(1).max(24).default(24),
    })
    .strict(),
  z.object({ action: z.literal('revoke-key'), ...identity, keyId: z.uuid() }).strict(),
  z.object({ action: z.literal('set-scopes'), ...identity, scopes }).strict(),
  z
    .object({
      action: z.literal('disable'),
      ...identity,
      operatorEmail: z.string().max(254).optional(),
      operatorPassword: z.string().max(512).optional(),
    })
    .strict(),
]);

export async function runApplicationCommand(input: unknown, environment = process.env) {
  const operation = commandSchema.parse(input);
  // Only dedicated operator credentials enter this process; the runtime never loads this file.
  await bootstrapInstallation(environment);
  const url = environment.DMS_MIGRATION_DATABASE_URL;
  if (!url) throw new Error('Missing operator database');
  const context = {
    tenantId: z.uuid().parse(environment.INSTALLATION_TENANT_ID),
    issuer:
      operation.action === 'disable'
        ? (environment.AUTH_ISSUER_URL ?? '')
        : z.url().parse(environment.AUTH_ISSUER_URL),
    deploymentId:
      operation.action === 'disable'
        ? (environment.DMS_RESOURCE_URL ?? '')
        : z.url().parse(environment.DMS_RESOURCE_URL),
  };
  for (const value of operation.action === 'disable'
    ? []
    : [context.issuer, context.deploymentId]) {
    const parsed = new URL(value);
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      (environment.AUTH_PROFILE === 'production' && parsed.protocol !== 'https:')
    )
      throw new Error('Invalid canonical boundary');
  }
  const pool = createPool(url, 1);
  let descriptor: number | undefined;
  let auth: Authority | undefined;
  let headers: Headers | undefined;
  let authorityPool: ReturnType<typeof createPool> | undefined;
  async function issuerClient(action: 'inspect' | 'suspend', clientId: string) {
    if (operation.action !== 'register' && operation.action !== 'disable')
      throw new Error('Unexpected authority operation');
    const config = parseAuthorityEnvironment(environment);
    if (config.AUTH_ISSUER_URL !== context.issuer) throw new Error('Issuer mismatch');
    authorityPool = createPool(config.AUTH_DATABASE_URL, 1);
    await assertRuntimeRole(authorityPool, 'auth');
    auth = createAuthority(config, authorityPool, createRecoveryDelivery(config));
    const login = await auth.api.signInEmail({
      body: {
        email: credentials.operatorEmail.parse(operation.operatorEmail),
        password: credentials.operatorPassword.parse(operation.operatorPassword),
      },
      headers: new Headers({ origin: config.AUTH_PUBLIC_ORIGIN }),
      returnHeaders: true,
    });
    headers = new Headers({
      origin: config.AUTH_PUBLIC_ORIGIN,
      cookie: login.headers
        .getSetCookie()
        .map((cookie) => cookie.split(';')[0])
        .join('; '),
    });
    return manageOAuthClient(auth, config, headers, { action, kind: 'machine', clientId });
  }
  try {
    if (operation.action === 'register') {
      const approved = (await issuerClient('inspect', operation.clientId)).record;
      const { applicationId, clientId, name, scopes, principalKind } = operation;
      const row = await registerApplication(
        pool,
        context,
        { applicationId, clientId, name, scopes, ...(principalKind ? { principalKind } : {}) },
        approved,
      );
      return {
        action: operation.action,
        applicationId: row.id,
        tenantId: row.tenant_id,
        clientId: row.client_id,
        status: row.status,
      };
    }
    if (operation.action === 'inspect')
      return {
        action: operation.action,
        registration: await inspectApplication(pool, context, operation.applicationId),
      };
    if (operation.action === 'issue-key') {
      descriptor = openSync(operation.credentialFile, 'wx', 0o600);
      const issued = await issueEnrollmentKey(
        pool,
        context,
        operation.applicationId,
        operation.hours,
      );
      try {
        writeFileSync(
          descriptor,
          `${JSON.stringify({ applicationId: issued.applicationId, keyId: issued.keyId, enrollmentKey: issued.key, expiresAt: issued.expiresAt })}\n`,
        );
        fsyncSync(descriptor);
      } catch (error) {
        await revokeEnrollmentKey(pool, context, operation.applicationId, issued.keyId).catch(
          () => {},
        );
        throw error;
      }
      return {
        action: operation.action,
        applicationId: issued.applicationId,
        keyId: issued.keyId,
        expiresAt: issued.expiresAt,
      };
    }
    if (operation.action === 'revoke-key')
      await revokeEnrollmentKey(pool, context, operation.applicationId, operation.keyId);
    if (operation.action === 'set-scopes')
      await setApplicationScopes(pool, context, operation.applicationId, operation.scopes);
    if (operation.action === 'disable')
      return {
        action: operation.action,
        ...(await disableApplication(pool, context, operation.applicationId, async (row) => {
          if (row.issuer !== context.issuer) throw new Error('Issuer mismatch');
          await issuerClient('suspend', row.client_id);
        })),
      };
    return { action: operation.action, applicationId: operation.applicationId, status: 'complete' };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (auth && headers) await auth.api.signOut({ headers }).catch(() => {});
    await authorityPool?.end();
    await pool.end();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    if (process.stdin.isTTY) throw new Error('Supply private JSON on stdin');
    let input = '';
    for await (const chunk of process.stdin) {
      input += chunk;
      if (Buffer.byteLength(input) > 8192) throw new Error('Input too large');
    }
    const result = await runApplicationCommand(JSON.parse(input));
    console.log(JSON.stringify(result));
    if ('issuer' in result && result.issuer === 'pending') process.exitCode = 2;
  } catch {
    console.error(
      'Application operation failed; inspect nonsecret registration/audit state before retrying. Local disablement is never rolled back after an issuer failure.',
    );
    process.exitCode = 1;
  }
}
