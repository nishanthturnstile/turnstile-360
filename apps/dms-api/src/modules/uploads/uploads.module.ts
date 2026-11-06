import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { AdmissionService } from './admission.service.js';
import { AdmissionFeaturesModule } from './admission-features.module.js';
import { BatchesController } from './batches.controller.js';
import { BatchesService } from './batches.service.js';
import { UploadLifecycleService } from './upload-lifecycle.service.js';
import { UploadsController } from './uploads.controller.js';
@Module({
  imports: [AccessModule, StorageModule, AdmissionFeaturesModule],
  providers: [AdmissionService, UploadLifecycleService, BatchesService],
  exports: [AdmissionService, AdmissionFeaturesModule, UploadLifecycleService],
  controllers: [UploadsController, BatchesController],
})
export class UploadsModule {}
