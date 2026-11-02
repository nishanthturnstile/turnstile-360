import { Module } from '@nestjs/common';
import { ProductPersistenceService } from './product-persistence.service.js';

@Module({
  providers: [ProductPersistenceService],
  exports: [ProductPersistenceService],
})
export class ProductPersistenceModule {}
