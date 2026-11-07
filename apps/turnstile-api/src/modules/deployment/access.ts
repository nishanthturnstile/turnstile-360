import { createHash } from 'node:crypto';
import { lstat, readFile } from 'node:fs/promises';
import { HttpException } from '@nestjs/common';
import { binding } from '@thaarei/control-plane-contracts';
import {
  type DecisionState,
  evaluateDecision,
  readProtectedTrust,
} from '@thaarei/deployment-control';
import type { Pool, PoolClient } from 'pg';
import { withTenant } from '../../infrastructure/database/postgres.js';

const deploymentError = (status: number, code: string): never => {
  throw new HttpException({ code }, status);
};
export type DeploymentMode = 'full' | 'read' | 'completion' | 'recovery';
export async function markerDigest() {
  const path = process.env.TURNSTILE_CONTROL_PLANE_RECOVERY_MARKER_FILE;
  if (!path) throw new Error('Independent recovery marker required');
  const file = await lstat(path);
  if (!file.isFile() || file.mode & 0o022 || file.size > 256)
    throw new Error('Protected recovery marker required');
  const value = (await readFile(path, 'utf8')).trim();
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(value)) throw new Error('Invalid recovery marker');
  return createHash('sha256').update(value).digest('hex');
}
export async function evaluateStored(row: Record<string, unknown> | undefined) {
  try {
    if (!row?.binding && !row?.decision && !row?.marker_digest && !row?.quarantined)
      return { access: 'closed' as const, state: 'unpaired' };
    if (
      !row?.binding ||
      !row.decision ||
      row.quarantined ||
      row.marker_digest !== (await markerDigest())
    )
      throw new Error('Unpaired or quarantined');
    const expected = binding.parse(row.binding);
    if (
      expected.product !== 'turnstile' ||
      expected.applicationId !== process.env.TURNSTILE_APPLICATION_ID ||
      expected.tenantId !== process.env.INSTALLATION_TENANT_ID ||
      expected.localInstallationId !== row.local_installation_id
    )
      throw new Error('Installation mismatch');
    if (
      (process.env.TURNSTILE_CONTROL_PLANE_INSTALLATION_ID &&
        expected.installationId !== process.env.TURNSTILE_CONTROL_PLANE_INSTALLATION_ID) ||
      (process.env.TURNSTILE_CONTROL_PLANE_PRODUCT_ID &&
        expected.productId !== process.env.TURNSTILE_CONTROL_PLANE_PRODUCT_ID)
    )
      throw new Error('Configured central binding changed');
    const path = process.env.TURNSTILE_CONTROL_PLANE_VERIFICATION_KEYS_FILE;
    if (!path) throw new Error('Trust required');
    const trust = await readProtectedTrust(path);
    if (trust.issuer !== process.env.TURNSTILE_CONTROL_PLANE_ORIGIN)
      throw new Error('Issuer mismatch');
    return await evaluateDecision(
      row.decision as DecisionState,
      expected,
      trust,
      Math.floor(Date.now() / 1000),
    );
  } catch {
    return { access: 'closed' as const, state: 'reconciliation-required' };
  }
}
export function allowed(access: string, mode: DeploymentMode) {
  return (
    mode === 'recovery' ||
    access === 'full' ||
    ((mode === 'read' || mode === 'completion') && access === 'existing-reads')
  );
}
export async function deploymentPreflight(pool: Pool, tenantId: string, mode: DeploymentMode) {
  if (mode === 'recovery') return;
  // The clock/quarantine fence commits independently of a rejected business transaction.
  const status = await withTenant(pool, tenantId, async (client) => {
    const row = (await client.query('SELECT turnstile.deployment_clock() AS snapshot')).rows[0]
      ?.snapshot;
    const result = await evaluateStored(row ?? undefined);
    if (row && result.state === 'reconciliation-required')
      await client.query('SELECT turnstile.deployment_quarantine()');
    return result;
  });
  if (!allowed(status.access, mode)) return deploymentError(403, 'DEPLOYMENT_RESTRICTED');
}
export async function requireDeployment(client: PoolClient, mode: DeploymentMode) {
  if (mode === 'recovery') return;
  const status = await deploymentStatus(client);
  if (!allowed(status.access, mode)) return deploymentError(403, 'DEPLOYMENT_RESTRICTED');
}

export async function deploymentStatus(client: PoolClient) {
  const row = (await client.query('SELECT turnstile.deployment_read() AS snapshot')).rows[0]
    ?.snapshot;
  return evaluateStored(row);
}
