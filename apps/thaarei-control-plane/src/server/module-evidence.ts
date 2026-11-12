import 'server-only';
import { readFileSync, statSync } from 'node:fs';
import { isAbsolute } from 'node:path';
import {
  DELIVERY_AUDIENCE,
  DELIVERY_TYPE,
  type DeliveryRequest,
  validateDeliveryEvidence,
} from '@thaarei/module-catalog';
import { importSPKI, jwtVerify } from 'jose';
import { z } from 'zod';
import {
  CATALOGUE_ATTESTATION_AUDIENCE,
  CATALOGUE_ATTESTATION_TYPE,
  classificationEvidence,
  codeEvidence,
} from '../contracts/module-catalogues.ts';
import { AccessError } from './access.ts';
import { runtime } from './runtime.ts';

const trustSchema = z
  .object({
    issuer: z.url().refine((v) => new URL(v).origin === v && new URL(v).protocol === 'https:'),
    keys: z
      .array(
        z
          .object({
            kid: z.string().regex(/^[A-Za-z0-9_-]{1,80}$/),
            publicKey: z.string().max(2048),
          })
          .strict(),
      )
      .min(1)
      .max(8),
  })
  .strict()
  .refine((v) => new Set(v.keys.map((k) => k.kid)).size === v.keys.length);
async function loadTrust(path: string) {
  try {
    if (!isAbsolute(path) || !statSync(path).isFile() || statSync(path).size > 32768)
      throw new Error();
    const parsed = trustSchema.parse(JSON.parse(readFileSync(path, 'utf8')));
    return {
      issuer: parsed.issuer,
      keys: await Promise.all(
        parsed.keys.map(async (entry) => ({
          kid: entry.kid,
          key: await importSPKI(entry.publicKey, 'RS256'),
        })),
      ),
    };
  } catch {
    throw new AccessError(503, 'Module release trust is unavailable');
  }
}
/** Local provisioned public trust only. Never fetch a token-selected key or URL. */
async function verifyReleasePayload(token: string, audience: string, type: string) {
  const path = runtime().config.moduleReleaseTrustFile;
  if (!path) throw new AccessError(503, 'Module release trust is not configured');
  const trust = await loadTrust(path);
  try {
    const verified = await jwtVerify(
      token,
      async (header) => {
        if (header.jku || header.jwk || header.x5u || header.x5c) throw new Error();
        const key = trust.keys.find((k) => k.kid === header.kid);
        if (!key) throw new Error();
        return key.key;
      },
      {
        issuer: trust.issuer,
        audience,
        typ: type,
        algorithms: ['RS256'],
        requiredClaims: ['iat', 'nbf', 'exp'],
        maxTokenAge: '24h',
      },
    );
    const { iss: _iss, aud: _aud, iat, nbf, exp, ...payload } = verified.payload;
    if (
      !Number.isInteger(iat) ||
      !Number.isInteger(nbf) ||
      !Number.isInteger(exp) ||
      !iat ||
      !nbf ||
      !exp ||
      exp <= nbf ||
      nbf < iat ||
      exp - iat > 86400
    )
      throw new Error();
    return { payload, keyId: verified.protectedHeader.kid as string };
  } catch {
    throw new AccessError(400, 'Invalid or expired module release evidence');
  }
}

export async function verifyModuleEvidence(token: string) {
  const result = await verifyReleasePayload(
    token,
    CATALOGUE_ATTESTATION_AUDIENCE,
    CATALOGUE_ATTESTATION_TYPE,
  );
  try {
    return {
      evidence: z
        .discriminatedUnion('kind', [codeEvidence, classificationEvidence])
        .parse(result.payload),
      keyId: result.keyId,
    };
  } catch {
    throw new AccessError(400, 'Invalid module catalogue evidence');
  }
}
export async function verifyDeliveryToken(token: string, request: DeliveryRequest) {
  const result = await verifyReleasePayload(token, DELIVERY_AUDIENCE, DELIVERY_TYPE);
  return validateDeliveryEvidence(request, result.payload);
}
