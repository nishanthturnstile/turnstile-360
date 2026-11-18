import {
  type BeforeApplicationShutdown,
  Controller,
  Get,
  Header,
  HttpException,
} from '@nestjs/common';
import { PublicDmsEndpoint } from '../modules/access/access-policy.js';
import { DmsDatabaseService } from '../modules/access/dms-database/dms-database.service.js';
import { evaluateStored } from '../modules/deployment/access.js';
import { AuthorityService } from '../modules/platform-auth/authority/authority.service.js';
import { withTenant } from './database/postgres.js';
@Controller('health')
export class HealthController implements BeforeApplicationShutdown {
  private stopping = false;
  constructor(
    private readonly authority: AuthorityService,
    private readonly database: DmsDatabaseService,
  ) {}
  beforeApplicationShutdown() {
    this.stopping = true;
  }
  @Get('live') @PublicDmsEndpoint() live() {
    return { status: 'ok' };
  }
  @Get('deployment')
  @Header('Cache-Control', 'no-store')
  @PublicDmsEndpoint()
  async deployment() {
    if (!this.database.pool) return { access: 'closed', state: 'unconfigured' };
    try {
      return await withTenant(
        this.database.pool,
        process.env.INSTALLATION_TENANT_ID as string,
        async (db) =>
          evaluateStored(
            (await db.query('SELECT dms.deployment_read() AS snapshot')).rows[0]?.snapshot,
          ),
      );
    } catch {
      return { access: 'closed', state: 'reconciliation-required' };
    }
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
