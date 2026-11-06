import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { LifecycleController } from './lifecycle.controller.js';
import { LifecycleService } from './lifecycle.service.js';
@Module({
  imports: [AccessModule],
  providers: [LifecycleService],
  controllers: [LifecycleController],
})
export class LifecycleModule {}
