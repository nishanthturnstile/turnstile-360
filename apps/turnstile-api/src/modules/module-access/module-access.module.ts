import { Module } from '@nestjs/common';
import { ProductPersistenceModule } from '../../infrastructure/database/product-persistence.module.js';
import { ModuleAccessController } from './module-access.controller.js';
import { ModuleAccessService } from './module-access.service.js';
@Module({
  imports: [ProductPersistenceModule],
  controllers: [ModuleAccessController],
  providers: [ModuleAccessService],
  exports: [ModuleAccessService],
})
export class ModuleAccessModule {}
