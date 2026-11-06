import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { UploadsModule } from '../uploads/uploads.module.js';
import { AdmissionPolicyController, DocumentsController } from './documents.controller.js';
import { DocumentsService } from './documents.service.js';
import { DownloadService } from './download.service.js';
import { SharingService } from './sharing.service.js';
import { VersionsService } from './versions.service.js';
@Module({
  imports: [StorageModule, AccessModule, UploadsModule, AuditModule],
  providers: [SharingService, DocumentsService, DownloadService, VersionsService],
  controllers: [DocumentsController, AdmissionPolicyController],
  exports: [DocumentsService],
})
export class DocumentsModule {}
