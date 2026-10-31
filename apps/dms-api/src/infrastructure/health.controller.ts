import { Controller, Get } from '@nestjs/common';
import { PublicDmsEndpoint } from '../modules/access/access-policy.js';

@Controller('health')
export class HealthController {
  @Get('live')
  @PublicDmsEndpoint()
  live(): { status: 'ok' } {
    return { status: 'ok' };
  }
}
