import { Module } from '@nestjs/common';
import { ProductPersistenceModule } from '../../infrastructure/database/product-persistence.module.js';
import { IdentityClientService } from './identity-client.service.js';

@Module({
  imports: [ProductPersistenceModule],
  exports: [IdentityClientService],
  providers: [IdentityClientService],
})
export class IdentityModule {}
