import { Injectable } from '@nestjs/common';
import type { ConfigurationActor } from '../../infrastructure/configuration-context.js';
import { ModuleAccessService } from '../../modules/module-access/module-access.service.js';
import { entry } from './entry.js';
@Injectable()
export class IncidentManagementService {
  constructor(private readonly modules: ModuleAccessService) {}
  read(actor: ConfigurationActor) {
    return this.modules.entry(actor, 'incident-management', entry);
  }
}
