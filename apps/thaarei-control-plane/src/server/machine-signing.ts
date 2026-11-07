import 'server-only';
import { createHash } from 'node:crypto';
import { DECISION_TYPE, type Decision, decision } from '@thaarei/control-plane-contracts';
import { importPKCS8, SignJWT } from 'jose';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { AccessError } from './access.ts';
import { protectedSecret } from './config.ts';
import { runtime } from './runtime.ts';
export const digest = (value: string) => createHash('sha256').update(value).digest('hex');
export async function assertAuthority(db: Pick<PoolClient, 'query'>) {
  const path = runtime().config.recoveryMarkerFile;
  if (!path) throw new AccessError(503, 'Machine issuance requires protected recovery authority');
  const marker = protectedSecret(path);
  const saved = (
    await db.query('SELECT marker_digest FROM control_plane.machine_authority WHERE slot=1')
  ).rows[0];
  if (!saved || saved.marker_digest !== digest(marker))
    throw new AccessError(503, 'Central recovery quarantine');
}
const signingFile = z
  .object({ kid: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/), privateKey: z.string().max(3500) })
  .strict();
export function signingKeyId() {
  return signingMaterial().kid;
}
function signingMaterial() {
  const path = runtime().config.signingKeyFile;
  if (!path) throw new AccessError(503, 'Deployment signer unavailable');
  const config = signingFile.parse(JSON.parse(protectedSecret(path)));
  return config;
}
export async function signDecision(raw: Decision) {
  const config = signingMaterial();
  const key = await importPKCS8(config.privateKey, 'RS256');
  return new SignJWT(decision.parse(raw))
    .setProtectedHeader({ alg: 'RS256', typ: DECISION_TYPE, kid: config.kid })
    .sign(key);
}
