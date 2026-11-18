import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module.js';
import { StorageModule } from '../storage/storage.module.js';
import { DiscoveryController } from './discovery.controller.js';
import { DiscoveryService } from './discovery.service.js';
import { ResultsController } from './results.controller.js';
import { ResultsService } from './results.service.js';
@Module({
  imports: [AccessModule, StorageModule],
  providers: [ResultsService, DiscoveryService],
  controllers: [ResultsController, DiscoveryController],
})
export class ProcessingModule {}
