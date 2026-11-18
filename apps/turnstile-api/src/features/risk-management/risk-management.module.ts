import { Module } from '@nestjs/common';
import { ModuleAccessModule } from '../../modules/module-access/module-access.module.js';
import { RiskManagementController } from './risk-management.controller.js';
import { RiskManagementService } from './risk-management.service.js';
@Module({
  imports: [ModuleAccessModule],
  controllers: [RiskManagementController],
  providers: [RiskManagementService],
  exports: [RiskManagementService],
})
export class RiskManagementModule {}
