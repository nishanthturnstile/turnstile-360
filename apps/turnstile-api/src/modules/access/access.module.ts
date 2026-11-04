import { Module } from '@nestjs/common';
import { ProductPersistenceModule } from '../../infrastructure/database/product-persistence.module.js';
import { AccessRepositoryService } from './access-repository/access-repository.service.js';
import { StructureAccessService } from './structure-access.service.js';

@Module({
  imports: [ProductPersistenceModule],
  providers: [AccessRepositoryService, StructureAccessService],
  exports: [AccessRepositoryService, StructureAccessService],
})
export class AccessModule {}
