import { Injectable } from '@nestjs/common';
import { ProductPersistenceService } from '../../../infrastructure/database/product-persistence.service.js';
import { PostgresSessionStore } from '../persistence/postgres-session-store.js';

@Injectable()
export class ProductDatabaseService {
  readonly store: PostgresSessionStore | undefined;

  constructor(private readonly persistence: ProductPersistenceService) {
    const { pool, config } = persistence;
    if (pool && config) {
      this.store = new PostgresSessionStore(
        pool,
        config.INSTALLATION_TENANT_ID,
        Buffer.from(config.TURNSTILE_TOKEN_ENCRYPTION_KEY, 'hex'),
      );
    }
  }

  get pool() {
    return this.persistence.pool;
  }

  async ready(): Promise<boolean> {
    if (!this.store || !this.pool || !(await this.persistence.ready())) return false;
    try {
      const policies = await this.pool.query(
        "SELECT relrowsecurity AND relforcerowsecurity AS safe FROM pg_class WHERE oid = 'turnstile.session'::regclass",
      );
      if (!policies.rows[0]?.safe) return false;
      await this.pool.query('SELECT ciphertext FROM turnstile.session LIMIT 0');
      return true;
    } catch {
      return false;
    }
  }
}
