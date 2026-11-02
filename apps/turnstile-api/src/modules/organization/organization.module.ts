import { Module } from '@nestjs/common';
import { ProductPersistenceModule } from '../../infrastructure/database/product-persistence.module.js';
import { OrganizationController } from './organization.controller.js';
import { OrganizationService } from './organization.service.js';
import { OrganizationRepository } from './persistence/organization.repository.js';

@Module({
  imports: [ProductPersistenceModule],
  providers: [OrganizationService, OrganizationRepository],
  exports: [OrganizationService],
  controllers: [OrganizationController],
})
export class OrganizationModule {}
