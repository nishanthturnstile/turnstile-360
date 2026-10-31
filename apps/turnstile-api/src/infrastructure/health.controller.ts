import { Controller, Get } from '@nestjs/common';
import { PublicEndpoint } from '../modules/auth/user-session/access-policy.js';

@Controller('health')
export class HealthController {
  @Get('live')
  @PublicEndpoint()
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
