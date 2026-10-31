import { Injectable } from '@nestjs/common';
import { DMS_MACHINE_SCOPES } from '@thaarei/dms-contracts';
import {
  createRemoteJWKSet,
  customFetch,
  decodeProtectedHeader,
  errors,
  type JWTVerifyGetKey,
  jwtVerify,
} from 'jose';
import { parseAuthorityEnvironment } from '../../platform-auth/authority-configuration.js';
import type { MachinePrincipal } from '../access-policy.js';
import { dmsError } from '../dms-errors.js';

@Injectable()
export class MachineVerifierService {
  readonly config: ReturnType<typeof parseAuthorityEnvironment> | undefined;
  private readonly keys: ReturnType<typeof createRemoteJWKSet> | undefined;
  constructor() {
    try {
      this.config = parseAuthorityEnvironment(process.env);
      const jwks = `${this.config.AUTH_ISSUER_URL}/jwks`;
      this.keys = createRemoteJWKSet(new URL(jwks), {
        timeoutDuration: 5000,
        cacheMaxAge: 300000,
        cooldownDuration: 30000,
        [customFetch]: (url, options) => {
          if (url !== jwks) throw new Error('Unexpected signing-key endpoint');
          return fetch(url, { ...options, redirect: 'error' });
        },
      });
    } catch {
      /* Missing configuration fails closed at use. */
    }
  }
  async verify(token: string): Promise<MachinePrincipal> {
    if (!this.config || !this.keys) return dmsError(503, 'DMS_UNAVAILABLE');
    return verifyMachineToken(
      token,
      this.keys,
      this.config.AUTH_ISSUER_URL,
      this.config.DMS_RESOURCE_URL,
    );
  }
}

export async function verifyMachineToken(
  token: string,
  keys: JWTVerifyGetKey,
  issuer: string,
  audience: string,
): Promise<MachinePrincipal> {
  try {
    const header = decodeProtectedHeader(token);
    if (
      header.alg !== 'RS256' ||
      header.typ !== 'at+jwt' ||
      typeof header.kid !== 'string' ||
      !header.kid ||
      header.kid.length > 128 ||
      header.jku ||
      header.jwk ||
      header.x5u
    )
      return dmsError(401, 'INVALID_MACHINE_TOKEN');
    const { payload } = await jwtVerify(token, keys, {
      issuer,
      audience,
      algorithms: ['RS256'],
      typ: 'at+jwt',
      maxTokenAge: 300,
      requiredClaims: ['exp', 'iat', 'jti', 'sub', 'client_id'],
      clockTolerance: 0,
    });
    const clientId = payload.client_id;
    if (
      typeof clientId !== 'string' ||
      !/^[A-Za-z0-9_-]{3,128}$/.test(clientId) ||
      payload.sub !== clientId ||
      (payload.azp !== undefined && payload.azp !== clientId) ||
      'sid' in payload ||
      'cnf' in payload ||
      typeof payload.exp !== 'number' ||
      typeof payload.iat !== 'number' ||
      payload.exp <= payload.iat ||
      payload.exp - payload.iat > 300 ||
      (Array.isArray(payload.aud)
        ? payload.aud.length !== 1 || payload.aud[0] !== audience
        : payload.aud !== audience) ||
      typeof payload.jti !== 'string' ||
      !payload.jti ||
      typeof payload.scope !== 'string'
    )
      return dmsError(401, 'INVALID_MACHINE_TOKEN');
    const scopes = payload.scope.split(' ');
    if (
      !scopes.length ||
      scopes.some((scope) => !(DMS_MACHINE_SCOPES as readonly string[]).includes(scope)) ||
      new Set(scopes).size !== scopes.length
    )
      return dmsError(403, 'SCOPE_DENIED');
    return { issuer, clientId, scopes };
  } catch (error) {
    if (error instanceof errors.JWTExpired) return dmsError(401, 'MACHINE_TOKEN_EXPIRED');
    // Invalid credentials are distinct from an unavailable canonical signing-key endpoint.
    if (
      error instanceof errors.JWKSTimeout ||
      error instanceof TypeError ||
      (error instanceof errors.JOSEError && error.code === 'ERR_JOSE_GENERIC')
    )
      return dmsError(503, 'DMS_UNAVAILABLE');
    if (error instanceof errors.JOSEError || error instanceof SyntaxError)
      return dmsError(401, 'INVALID_MACHINE_TOKEN');
    throw error;
  }
}
