import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { AuditController } from './audit.controller.js';
import { AuditService } from './audit.service.js';

@Module({
  imports: [AccessModule],
  controllers: [AuditController],
  exports: [AuditService],
  providers: [AuditService],
})
export class AuditModule {}
