import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { EnrollmentController } from './enrollment.controller.js';
import { EnrollmentService } from './enrollment.service.js';

@Module({
  imports: [AccessModule],
  providers: [EnrollmentService],
  controllers: [EnrollmentController],
})
export class EnrollmentModule {}
