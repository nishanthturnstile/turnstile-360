import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { DMS_MACHINE_SCOPES, DMS_PRINCIPAL_KINDS } from '@thaarei/dms-contracts';
import type { Pool } from 'pg';
import { z } from 'zod';
import { withTenant } from '../../infrastructure/database/postgres.js';
import type { ApplicationRegistration } from '../access/access-policy.js';
import { insertSecurityEvent } from '../audit/security-event.js';

export interface EnrollmentContext {
  tenantId: string;
  deploymentId: string;
  issuer: string;
}
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export function matchesDigest(value: string, expected: string) {
  return (
    /^[0-9a-f]{64}$/.test(expected) &&
    timingSafeEqual(Buffer.from(digest(value), 'hex'), Buffer.from(expected, 'hex'))
  );
}
const scopesSchema = z
  .array(z.enum(DMS_MACHINE_SCOPES))
  .max(DMS_MACHINE_SCOPES.length)
  .refine((values) => new Set(values).size === values.length);
const registrationSchema = z
  .object({
    applicationId: z.uuid().toLowerCase(),
    clientId: z.string().regex(/^[A-Za-z0-9_-]{3,128}$/),
    name: z
      .string()
      .min(1)
      .max(120)
      .regex(/^[\p{L}\p{N} ._'()-]+$/u),
    scopes: scopesSchema,
    principalKind: z.enum(DMS_PRINCIPAL_KINDS).default('consumer'),
  })
  .strict();
export interface ApprovedMachineClient {
  kind: string;
  issuer: string;
  clientId: string;
  applicationId: string;
  tenantId: string;
  resource: string;
  scopes: string[];
  disabled: boolean;
}
const operatorEvent = (
  action: string,
  subjectId: string,
  outcome: 'success' | 'pending' = 'success',
) => ({
  action,
  subjectId,
  outcome,
  actorKind: 'operator' as const,
  actorId: 'thaarei_dms_migrator',
});

export async function inspectApplication(
  pool: Pool,
  context: EnrollmentContext,
  applicationId: string,
) {
  z.uuid().parse(applicationId);
  return withTenant(pool, context.tenantId, async (client) => {
    const { rows } = await client.query<ApplicationRegistration>(
      'SELECT * FROM dms.application_registration WHERE id = $1',
      [applicationId],
    );
    if (!rows[0]) throw new Error('Registration unavailable');
    return rows[0];
  });
}

export async function registerApplication(
  pool: Pool,
  context: EnrollmentContext,
  input: unknown,
  approved: ApprovedMachineClient,
) {
  const value = registrationSchema.parse(input);
  if (
    approved.kind !== 'machine' ||
    approved.disabled ||
    approved.issuer !== context.issuer ||
    approved.resource !== context.deploymentId ||
    approved.tenantId !== context.tenantId ||
    approved.applicationId !== value.applicationId ||
    approved.clientId !== value.clientId ||
    value.scopes.some((scope) => !approved.scopes.includes(scope)) ||
    (value.principalKind === 'consumer' ? !value.scopes.length : value.scopes.length !== 0)
  )
    throw new Error('Approved machine identity required');
  return withTenant(pool, context.tenantId, async (client) => {
    await client.query(
      'INSERT INTO dms.application_registration (id, tenant_id, issuer, client_id, name, scope_ceiling, principal_kind) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING',
      [
        value.applicationId,
        context.tenantId,
        context.issuer,
        value.clientId,
        value.name,
        value.scopes,
        value.principalKind,
      ],
    );
    const { rows } = await client.query<ApplicationRegistration>(
      'SELECT * FROM dms.application_registration WHERE id = $1 FOR UPDATE',
      [value.applicationId],
    );
    const row = rows[0];
    if (
      !row ||
      row.tenant_id !== context.tenantId ||
      row.issuer !== context.issuer ||
      row.client_id !== value.clientId ||
      row.name !== value.name ||
      row.principal_kind !== value.principalKind ||
      JSON.stringify([...row.scope_ceiling].sort()) !== JSON.stringify([...value.scopes].sort())
    )
      throw new Error('Registration identity/policy cannot be replaced');
    await insertSecurityEvent(
      client,
      context.tenantId,
      operatorEvent('application.register', row.id),
    );
    return row;
  });
}

export async function issueEnrollmentKey(
  pool: Pool,
  context: EnrollmentContext,
  applicationId: string,
  hours = 24,
) {
  z.uuid().parse(applicationId);
  z.number().int().min(1).max(24).parse(hours);
  const keyId = randomUUID();
  const key = `the_${keyId}.${randomBytes(32).toString('base64url')}`;
  return withTenant(pool, context.tenantId, async (client) => {
    const { rows } = await client.query<ApplicationRegistration>(
      'SELECT * FROM dms.application_registration WHERE id = $1 FOR UPDATE',
      [applicationId],
    );
    const row = rows[0];
    if (
      row?.status !== 'pending' ||
      row.principal_kind !== 'consumer' ||
      row.issuer !== context.issuer
    )
      throw new Error('Pending bound consumer required');
    const inserted = await client.query<{ expires_at: Date }>(
      "INSERT INTO dms.enrollment_key (id, tenant_id, application_id, deployment_id, issuer, client_id, digest, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$7,now()+($8 * interval '1 hour')) RETURNING expires_at",
      [
        keyId,
        context.tenantId,
        row.id,
        context.deploymentId,
        row.issuer,
        row.client_id,
        digest(key),
        hours,
      ],
    );
    await insertSecurityEvent(
      client,
      context.tenantId,
      operatorEvent('enrollment.key.issue', keyId),
    );
    return { keyId, key, applicationId, expiresAt: inserted.rows[0]?.expires_at.toISOString() };
  });
}

export async function revokeEnrollmentKey(
  pool: Pool,
  context: EnrollmentContext,
  applicationId: string,
  keyId: string,
) {
  z.uuid().parse(applicationId);
  z.uuid().parse(keyId);
  await withTenant(pool, context.tenantId, async (client) => {
    await client.query('SELECT id FROM dms.application_registration WHERE id = $1 FOR UPDATE', [
      applicationId,
    ]);
    const result = await client.query(
      'UPDATE dms.enrollment_key SET revoked_at = coalesce(revoked_at, now()) WHERE id = $1 AND application_id = $2 RETURNING id',
      [keyId, applicationId],
    );
    if (!result.rowCount) throw new Error('Bound key unavailable');
    await insertSecurityEvent(
      client,
      context.tenantId,
      operatorEvent('enrollment.key.revoke', keyId),
    );
  });
}

export async function setApplicationScopes(
  pool: Pool,
  context: EnrollmentContext,
  applicationId: string,
  input: unknown,
) {
  z.uuid().parse(applicationId);
  const scopes = scopesSchema.parse(input);
  return withTenant(pool, context.tenantId, async (client) => {
    const result = await client.query(
      'UPDATE dms.application_registration SET scope_ceiling = $2, updated_at = now() WHERE id = $1 AND principal_kind = $3 RETURNING id',
      [applicationId, scopes, 'consumer'],
    );
    if (!result.rowCount) throw new Error('Consumer registration unavailable');
    await insertSecurityEvent(
      client,
      context.tenantId,
      operatorEvent('application.scopes', applicationId),
    );
  });
}

export async function disableApplication(
  pool: Pool,
  context: EnrollmentContext,
  applicationId: string,
  suspendIssuer: (registration: ApplicationRegistration) => Promise<void>,
) {
  z.uuid().parse(applicationId);
  const registration = await withTenant(pool, context.tenantId, async (client) => {
    const { rows } = await client.query<ApplicationRegistration>(
      "UPDATE dms.application_registration SET status = 'disabled', updated_at = now() WHERE id = $1 RETURNING *",
      [applicationId],
    );
    if (!rows[0]) throw new Error('Registration unavailable');
    await insertSecurityEvent(
      client,
      context.tenantId,
      operatorEvent('application.disable', applicationId),
    );
    await insertSecurityEvent(
      client,
      context.tenantId,
      operatorEvent('oauth.suspension', rows[0].client_id, 'pending'),
    );
    return rows[0];
  });
  // Local denial is already committed. Never hold its transaction across authority work.
  let issuer: 'disabled' | 'pending' = 'pending';
  try {
    await suspendIssuer(registration);
    await withTenant(pool, context.tenantId, (client) =>
      insertSecurityEvent(
        client,
        context.tenantId,
        operatorEvent('oauth.suspension', registration.client_id),
      ),
    );
    issuer = 'disabled';
  } catch {
    /* Retain durable local denial and pending evidence; explicit retry is safe. */
  }
  return { applicationId, clientId: registration.client_id, local: 'disabled' as const, issuer };
}
