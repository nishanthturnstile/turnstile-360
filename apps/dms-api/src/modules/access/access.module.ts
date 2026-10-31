import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { CapabilitiesController } from './capabilities/capabilities.controller.js';
import { DmsDatabaseService } from './dms-database/dms-database.service.js';
import { MachineGuard } from './machine/machine.guard.js';
import { MachineVerifierService } from './machine-verifier/machine-verifier.service.js';

@Module({
  exports: [DmsDatabaseService],
  providers: [
    DmsDatabaseService,
    MachineVerifierService,
    { provide: APP_GUARD, useClass: MachineGuard },
  ],
  controllers: [CapabilitiesController],
})
export class AccessModule {}
