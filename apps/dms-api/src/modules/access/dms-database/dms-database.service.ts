import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import { assertRuntimeRole, createPool } from '../../../infrastructure/database/postgres.js';
import { parseAuthorityEnvironment } from '../../platform-auth/authority-configuration.js';

@Injectable()
export class DmsDatabaseService implements OnApplicationShutdown {
  readonly pool: Pool | undefined;
  private readonly config: ReturnType<typeof parseAuthorityEnvironment> | undefined;

  constructor() {
    try {
      this.config = parseAuthorityEnvironment(process.env);
      this.pool = createPool(this.config.DMS_DATABASE_URL, this.config.AUTH_DATABASE_POOL_MAX);
    } catch {
      /* Missing configuration remains unavailable. */
    }
  }

  async ready(): Promise<boolean> {
    if (!this.pool || !this.config) return false;
    try {
      await assertRuntimeRole(this.pool, 'dms');
      const policy = await this.pool.query(
        "SELECT count(*) = 4 AND bool_and(relrowsecurity AND relforcerowsecurity) AS safe FROM pg_class WHERE oid IN ('dms.application_registration'::regclass, 'dms.enrollment_key'::regclass, 'dms.enrollment_receipt'::regclass, 'dms.security_event'::regclass)",
      );
      if (!policy.rows[0]?.safe) return false;
      await this.pool.query('SELECT principal_kind FROM dms.application_registration LIMIT 0');
      const { rows } = await this.pool.query(
        'SELECT tenant_id, customer_key FROM dms.installation WHERE singleton = 1',
      );
      return (
        rows[0]?.tenant_id === this.config.INSTALLATION_TENANT_ID &&
        rows[0]?.customer_key === this.config.INSTALLATION_CUSTOMER_KEY
      );
    } catch {
      return false;
    }
  }

  async onApplicationShutdown() {
    await this.pool?.end();
  }
}
