import { Module } from '@nestjs/common';
import { ModuleAccessModule } from '../../modules/module-access/module-access.module.js';
import { IncidentManagementController } from './incident-management.controller.js';
import { IncidentManagementService } from './incident-management.service.js';
@Module({
  imports: [ModuleAccessModule],
  controllers: [IncidentManagementController],
  providers: [IncidentManagementService],
  exports: [IncidentManagementService],
})
export class IncidentManagementModule {}
