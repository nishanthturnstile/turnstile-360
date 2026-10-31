import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { DmsConfigurationService } from '../../../integrations/dms/dms-configuration/dms-configuration.service.js';
import { AuthConfigurationService } from '../auth-configuration/auth-configuration.service.js';
import { OidcService } from '../browser-auth/oidc.service.js';
import { ProductDatabaseService } from '../product-database/product-database.service.js';
import { PublicEndpoint } from '../user-session/access-policy.js';

@Controller('health/ready/auth')
@PublicEndpoint()
export class AuthReadinessController {
  constructor(
    private readonly auth: AuthConfigurationService,
    private readonly dms: DmsConfigurationService,
    private readonly database: ProductDatabaseService,
    private readonly oidc: OidcService,
  ) {}

  @Get()
  async readiness() {
    if (
      !this.auth.configurationError &&
      !this.dms.configurationError &&
      (await this.database.ready())
    ) {
      try {
        await this.oidc.ready();
        return { status: 'ready' };
      } catch {
        /* Controlled readiness failure. */
      }
    }
    throw new ServiceUnavailableException({
      status: 'unavailable',
      reason:
        this.auth.configurationError || this.dms.configurationError
          ? 'invalid_configuration'
          : (await this.database.ready())
            ? 'authority_unavailable'
            : 'database_unavailable',
    });
  }
}
