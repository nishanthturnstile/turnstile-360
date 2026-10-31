import { Module } from '@nestjs/common';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { HealthController } from './infrastructure/health.controller.js';
import { SecurityTelemetryService } from './infrastructure/security-telemetry.service.js';
import { AccessModule } from './modules/access/access.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { DocumentsModule } from './modules/documents/documents.module.js';
import { EnrollmentModule } from './modules/enrollment/enrollment.module.js';
import { LifecycleModule } from './modules/lifecycle/lifecycle.module.js';
import { PlatformAuthModule } from './modules/platform-auth/platform-auth.module.js';
import { PoliciesModule } from './modules/policies/policies.module.js';
import { ProcessingModule } from './modules/processing/processing.module.js';
import { SearchModule } from './modules/search/search.module.js';
import { StorageModule } from './modules/storage/storage.module.js';
import { UploadsModule } from './modules/uploads/uploads.module.js';

@Module({
  imports: [
    PlatformAuthModule,
    AccessModule,
    EnrollmentModule,
    AuditModule,
    DocumentsModule,
    UploadsModule,
    StorageModule,
    PoliciesModule,
    ProcessingModule,
    SearchModule,
    LifecycleModule,
  ],
  controllers: [AppController, HealthController],
  providers: [AppService, SecurityTelemetryService],
})
export class AppModule {}
