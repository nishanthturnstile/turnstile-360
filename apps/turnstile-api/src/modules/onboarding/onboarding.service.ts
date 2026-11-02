import { Injectable } from '@nestjs/common';
import { ConfigurationException } from '../../infrastructure/configuration-exception.js';
import { OrganizationService } from '../organization/organization.service.js';
import type { ConfigurationActor } from '../organization/persistence/organization.repository.js';

@Injectable()
export class OnboardingService {
  constructor(private readonly organization: OrganizationService) {}
  status(actor: ConfigurationActor) {
    return this.organization.status(actor);
  }
  async requireReady(actor: ConfigurationActor) {
    if ((await this.status(actor)).status !== 'complete')
      throw new ConfigurationException({ code: 'SETUP_REQUIRED' });
  }
  async setup(actor: ConfigurationActor) {
    return (await this.organization.read(actor)).setup;
  }
  complete(actor: ConfigurationActor, input: unknown) {
    return this.organization.complete(actor, input);
  }
}
