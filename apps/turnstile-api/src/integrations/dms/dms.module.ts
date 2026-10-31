import { Module } from '@nestjs/common';
import { CapabilitiesController } from './capabilities.controller.js';
import { CapabilitiesService } from './capabilities.service.js';
import { DmsConfigurationService } from './dms-configuration/dms-configuration.service.js';
import { MachineTokenService } from './machine-token.service.js';

@Module({
  exports: [DmsConfigurationService],
  providers: [DmsConfigurationService, MachineTokenService, CapabilitiesService],
  controllers: [CapabilitiesController],
})
export class DmsModule {}
