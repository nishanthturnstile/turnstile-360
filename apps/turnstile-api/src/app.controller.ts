import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service.js';
import { PublicEndpoint } from './modules/auth/user-session/access-policy.js';

@Controller()
export class AppController {
  constructor(private readonly appService: AppService) {}

  @Get()
  @PublicEndpoint()
  getApplicationInfo(): { name: string } {
    return this.appService.getApplicationInfo();
  }
}
