import { type BeforeApplicationShutdown, Controller, Get, HttpException } from '@nestjs/common';
import { PublicDmsEndpoint } from '../modules/access/access-policy.js';
import { AuthorityService } from '../modules/platform-auth/authority/authority.service.js';
@Controller('health')
export class HealthController implements BeforeApplicationShutdown {
  private stopping = false;
  constructor(private readonly authority: AuthorityService) {}
  beforeApplicationShutdown() {
    this.stopping = true;
  }
  @Get('live') @PublicDmsEndpoint() live() {
    return { status: 'ok' };
  }
  @Get('ready/api') @PublicDmsEndpoint() async api() {
    if (this.stopping || !(await this.authority.ready()))
      throw new HttpException({ ready: false }, 503);
    return { ready: true };
  }
  @Get('ready/processing') @PublicDmsEndpoint() async processing() {
    try {
      if (this.stopping || process.env.DMS_OPERATIONS_ENABLED !== 'true') throw new Error();
      const target = new URL(process.env.DMS_PROCESSING_ORIGIN ?? '');
      if (
        !['https:', 'http:'].includes(target.protocol) ||
        target.username ||
        target.password ||
        target.pathname !== '/' ||
        target.search ||
        target.hash
      )
        throw new Error();
      const response = await fetch(new URL('/health/ready/processing', target), {
        signal: AbortSignal.timeout(2000),
        redirect: 'error',
      });
      if (!response.ok) throw new Error();
      return { ready: true };
    } catch {
      throw new HttpException({ ready: false }, 503);
    }
  }
}
