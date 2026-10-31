import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import { parseProductEnvironment } from '../../../infrastructure/auth-environment.js';
import { assertRuntimeRole, createPool } from '../../../infrastructure/database/postgres.js';
import { PostgresSessionStore } from '../persistence/postgres-session-store.js';

@Injectable()
export class ProductDatabaseService implements OnApplicationShutdown {
  readonly pool: Pool | undefined;
  readonly store: PostgresSessionStore | undefined;
  private readonly config: ReturnType<typeof parseProductEnvironment> | undefined;

  constructor() {
    try {
      this.config = parseProductEnvironment(process.env);
      this.pool = createPool(
        this.config.TURNSTILE_DATABASE_URL,
        this.config.TURNSTILE_DATABASE_POOL_MAX,
      );
      this.store = new PostgresSessionStore(
        this.pool,
        this.config.INSTALLATION_TENANT_ID,
        Buffer.from(this.config.TURNSTILE_TOKEN_ENCRYPTION_KEY, 'hex'),
      );
    } catch {
      /* Missing configuration leaves persistence unavailable. */
    }
  }

  async ready(): Promise<boolean> {
    if (!this.pool || !this.config) return false;
    try {
      await assertRuntimeRole(this.pool, 'turnstile');
      const policies = await this.pool.query(
        "SELECT count(*) = 2 AND bool_and(relrowsecurity AND relforcerowsecurity) AS safe FROM pg_class WHERE oid IN ('turnstile.session'::regclass, 'turnstile.user_access'::regclass)",
      );
      if (!policies.rows[0]?.safe) return false;
      await this.pool.query('SELECT permissions FROM turnstile.user_access LIMIT 0');
      const { rows } = await this.pool.query(
        'SELECT tenant_id, customer_key, application_id FROM turnstile.installation WHERE singleton = 1',
      );
      return (
        rows[0]?.tenant_id === this.config.INSTALLATION_TENANT_ID &&
        rows[0]?.customer_key === this.config.INSTALLATION_CUSTOMER_KEY &&
        rows[0]?.application_id === this.config.TURNSTILE_APPLICATION_ID
      );
    } catch {
      return false;
    }
  }

  async onApplicationShutdown() {
    await this.pool?.end();
  }
}
