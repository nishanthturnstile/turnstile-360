import { Module } from '@nestjs/common';
import { ProductPersistenceModule } from '../../infrastructure/database/product-persistence.module.js';
import { DmsModule } from '../../integrations/dms/dms.module.js';
import { DocumentsController } from './documents.controller.js';
import { DocumentsService } from './documents.service.js';
import { DocumentsIntentsService } from './documents-intents.service.js';

@Module({
  imports: [DmsModule, ProductPersistenceModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, DocumentsIntentsService],
})
export class DocumentsModule {}
