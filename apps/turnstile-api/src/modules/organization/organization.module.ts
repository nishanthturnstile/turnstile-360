import { Module } from '@nestjs/common';
import { ProductPersistenceModule } from '../../infrastructure/database/product-persistence.module.js';
import { AccessModule } from '../access/access.module.js';
import { OrganizationController } from './organization.controller.js';
import { OrganizationService } from './organization.service.js';
import { OrganizationRepository } from './persistence/organization.repository.js';
import { ScopedStructureController } from './scoped-structure.controller.js';
import { ScopedStructureService } from './scoped-structure.service.js';
import { StructureCommandsService } from './structure-commands.service.js';

@Module({
  imports: [ProductPersistenceModule, AccessModule],
  providers: [
    OrganizationService,
    OrganizationRepository,
    ScopedStructureService,
    StructureCommandsService,
  ],
  exports: [OrganizationService],
  controllers: [OrganizationController, ScopedStructureController],
})
export class OrganizationModule {}
