import 'server-only';
import { createHash, createPublicKey } from 'node:crypto';
import { DECISION_TYPE } from '@thaarei/control-plane-contracts';
import { INTENT_TYPE, installationIntent, versionedDecision } from '@thaarei/module-catalog';
import { importPKCS8, importSPKI, jwtVerify, SignJWT } from 'jose';
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
export async function signDecision(raw: unknown) {
  const config = signingMaterial();
  const key = await importPKCS8(config.privateKey, 'RS256');
  return new SignJWT(versionedDecision.parse(raw))
    .setProtectedHeader({ alg: 'RS256', typ: DECISION_TYPE, kid: config.kid })
    .sign(key);
}

export async function signInstallationIntent(raw: unknown) {
  const config = signingMaterial(),
    key = await importPKCS8(config.privateKey, 'RS256');
  return new SignJWT(installationIntent.parse(raw))
    .setProtectedHeader({ alg: 'RS256', typ: INTENT_TYPE, kid: config.kid })
    .sign(key);
}

export async function verifyOwnInstallationIntent(token: string) {
  const material = signingMaterial();
  const pem = createPublicKey(material.privateKey)
    .export({ type: 'spki', format: 'pem' })
    .toString();
  const value = await jwtVerify(
    token,
    async (header) => {
      if (
        header.kid !== material.kid ||
        Object.keys(header).some((k) => !['alg', 'typ', 'kid'].includes(k))
      )
        throw new Error('Untrusted intent header');
      return importSPKI(pem, 'RS256');
    },
    {
      algorithms: ['RS256'],
      issuer: runtime().config.origin,
      audience: 'urn:thaarei:installer',
      typ: INTENT_TYPE,
      requiredClaims: ['iat', 'nbf', 'exp'],
      maxTokenAge: '24h',
    },
  );
  return installationIntent.parse(value.payload);
}
