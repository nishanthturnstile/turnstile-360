import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service.js';
import { PublicDmsEndpoint } from './modules/access/access-policy.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @PublicDmsEndpoint()
  getApplicationInfo(): { name: string } {
    return this.appService.getApplicationInfo();
  }
}
