import { Injectable } from '@nestjs/common';
import {
  ClientCredentialsTokenProvider,
  DmsClientError,
  type MachineAccessToken,
  type MachineTokenProvider,
} from '@thaarei/dms-client';
import { DmsConfigurationService } from './dms-configuration/dms-configuration.service.js';

@Injectable()
export class MachineTokenService implements MachineTokenProvider {
  private readonly provider: ClientCredentialsTokenProvider | undefined;
  constructor(settings: DmsConfigurationService) {
    const config = settings.config;
    if (config)
      this.provider = new ClientCredentialsTokenProvider({
        issuerUrl: config.AUTH_ISSUER_URL,
        clientId: config.DMS_MACHINE_CLIENT_ID,
        clientSecret: config.DMS_MACHINE_CLIENT_SECRET,
        resource: config.DMS_RESOURCE_URL,
        scopes: ['dms:capabilities:read'],
        allowInsecureHttp: config.AUTH_PROFILE !== 'production',
      });
  }
  getToken() {
    if (!this.provider) throw new DmsClientError('DMS_UNAVAILABLE');
    return this.provider.getToken();
  }
  invalidate(rejected: MachineAccessToken) {
    this.provider?.invalidate(rejected);
  }
}
