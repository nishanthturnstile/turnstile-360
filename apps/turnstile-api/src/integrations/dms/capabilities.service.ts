import { HttpException, Injectable } from '@nestjs/common';
import { DmsClient, DmsClientError } from '@thaarei/dms-client';
import type { DmsCapabilitiesDto, DmsIntegrationErrorDto } from '@thaarei/turnstile-contracts';
import { DmsConfigurationService } from './dms-configuration/dms-configuration.service.js';
import { MachineTokenService } from './machine-token.service.js';

@Injectable()
export class CapabilitiesService {
  private readonly client: DmsClient | undefined;
  constructor(
    private readonly settings: DmsConfigurationService,
    tokens: MachineTokenService,
  ) {
    const config = settings.config;
    if (config)
      this.client = new DmsClient({
        baseUrl: config.DMS_API_URL,
        tokenProvider: tokens,
        // The operator-owned private transport may use HTTP inside the installation network.
        allowInsecureHttp: new URL(config.DMS_API_URL).protocol === 'http:',
      });
  }
  async read(userId: string, requestId: string): Promise<DmsCapabilitiesDto> {
    try {
      if (!this.client || !this.settings.config) throw new DmsClientError('DMS_UNAVAILABLE');
      const result = await this.client.capabilities({ userId, requestId });
      if (
        result.tenantId !== this.settings.config.INSTALLATION_TENANT_ID ||
        result.applicationId !== this.settings.config.TURNSTILE_APPLICATION_ID
      )
        throw new DmsClientError('DMS_INVALID_RESPONSE');
      return {
        formats: [...result.formats],
        profiles: [...result.profiles],
        languages: [...result.languages],
      };
    } catch (error) {
      const denied = error instanceof DmsClientError && error.code === 'DMS_ACCESS_DENIED';
      const body: DmsIntegrationErrorDto = {
        code: denied ? 'DMS_ACCESS_DENIED' : 'DMS_UNAVAILABLE',
      };
      throw new HttpException(body, denied ? 403 : 503);
    }
  }
}
