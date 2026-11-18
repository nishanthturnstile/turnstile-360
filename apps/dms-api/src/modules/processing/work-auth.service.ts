import { Injectable } from '@nestjs/common';
import { WORK_SCOPES } from '@thaarei/dms-contracts/private';
import { createRemoteJWKSet, customFetch } from 'jose';
import { verifyMachineToken } from '../access/machine-verifier/machine-verifier.service.js';
import { WorkConfiguration, WorkError } from './work-configuration.js';
@Injectable()
export class WorkAuthService {
  private readonly keys;
  constructor(private readonly config: WorkConfiguration) {
    const jwks = `${config.value.DMS_WORK_ISSUER_URL}/jwks`;
    this.keys = createRemoteJWKSet(new URL(jwks), {
      timeoutDuration: 3000,
      cacheMaxAge: 300000,
      cooldownDuration: 30000,
      [customFetch]: (target, options) => {
        if (target !== jwks) throw new WorkError('WORK_DENIED', 403);
        return fetch(target, { ...options, redirect: 'error' });
      },
    });
  }
  async verify(authorization: unknown) {
    if (typeof authorization !== 'string') throw new WorkError('WORK_DENIED', 401);
    const token = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(
      authorization,
    )?.[1];
    if (!token || token.length > 16384) throw new WorkError('WORK_DENIED', 401);
    return verifyMachineToken(
      token,
      this.keys,
      this.config.value.DMS_WORK_ISSUER_URL,
      this.config.audience,
      WORK_SCOPES,
    );
  }
}
