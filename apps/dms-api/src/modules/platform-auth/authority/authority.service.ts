import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import { assertRuntimeRole, createPool } from '../../../infrastructure/database/postgres.js';
import { DmsDatabaseService } from '../../access/dms-database/dms-database.service.js';
import { parseAuthorityEnvironment } from '../authority-configuration.js';
import { type Authority, authorityTables, createAuthority } from '../authority-instance.js';
import { createRecoveryDelivery, type RecoveryDelivery } from '../recovery-delivery.js';

@Injectable()
export class AuthorityService implements OnApplicationShutdown {
  readonly configurationError: string | undefined;
  readonly config: ReturnType<typeof parseAuthorityEnvironment> | undefined;
  readonly auth: Authority | undefined;
  private readonly pool: Pool | undefined;
  private readonly delivery: RecoveryDelivery | undefined;

  constructor(private readonly dms: DmsDatabaseService) {
    try {
      this.config = parseAuthorityEnvironment(process.env);
      this.pool = createPool(this.config.AUTH_DATABASE_URL, this.config.AUTH_DATABASE_POOL_MAX);
      this.delivery = createRecoveryDelivery(this.config);
      this.auth = createAuthority(this.config, this.pool, this.delivery);
    } catch (error) {
      this.configurationError =
        error instanceof Error ? error.message : 'Invalid auth configuration';
    }
  }

  async ready(): Promise<boolean> {
    if (!this.auth || !this.pool || !(await this.dms.ready())) return false;
    try {
      await assertRuntimeRole(this.pool, 'auth');
      const tables = await this.pool.query<{ safe: boolean }>(
        'SELECT count(*) = $2::int AND bool_and(NOT relrowsecurity) AS safe FROM pg_class WHERE oid = ANY($1::regclass[])',
        [authorityTables, authorityTables.length],
      );
      if (!tables.rows[0]?.safe) return false;
      await this.pool.query('SELECT id FROM auth."user" LIMIT 0');
      await this.auth.$context;
      return true;
    } catch {
      return false;
    }
  }

  async handle(request: Request): Promise<Response> {
    const auth = this.auth;
    if (!auth || !this.delivery) throw new Error('Authority unavailable');
    return this.delivery.run(() => auth.handler(request));
  }

  async onApplicationShutdown() {
    await this.pool?.end();
  }
}
