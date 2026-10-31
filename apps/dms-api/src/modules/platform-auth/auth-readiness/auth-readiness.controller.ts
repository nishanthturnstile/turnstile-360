import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { PublicDmsEndpoint } from '../../access/access-policy.js';
import { AuthorityService } from '../authority/authority.service.js';

@Controller('health/ready/auth')
export class AuthReadinessController {
  constructor(private readonly authority: AuthorityService) {}

  @Get()
  @PublicDmsEndpoint()
  async readiness() {
    if (await this.authority.ready()) return { status: 'ok' };
    throw new ServiceUnavailableException({
      status: 'unavailable',
      reason: this.authority.configurationError ? 'invalid_configuration' : 'database_unavailable',
    });
  }
}
