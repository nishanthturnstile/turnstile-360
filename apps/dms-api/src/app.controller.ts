import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service.js';
import { DmsOperation } from './modules/access/dms-operation.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @DmsOperation('getDmsServiceInfo')
  getApplicationInfo(): { name: string } {
    return this.appService.getApplicationInfo();
  }
}
