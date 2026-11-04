import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import { Pool } from 'pg';
import { accessSchemaSafe, canonicalAccessReady } from '../../modules/access/access-safety.js';
import { parseProductEnvironment } from '../auth-environment.js';
import { invitationSchemaSafe } from './invitation-safety.js';
import { peopleSchemaSafe } from './people-safety.js';
import { assertRuntimeRole, createPool, withTenant } from './postgres.js';

@Injectable()
export class ProductPersistenceService implements OnApplicationShutdown {
  readonly pool: Pool | undefined;
  readonly config: ReturnType<typeof parseProductEnvironment> | undefined;

  constructor() {
    try {
      this.config = parseProductEnvironment(process.env);
      this.pool = createPool(
        this.config.TURNSTILE_DATABASE_URL,
        this.config.TURNSTILE_DATABASE_POOL_MAX,
      );
    } catch {
      // Invalid configuration leaves persistence unavailable; never bootstrap at runtime.
    }
  }

  async ready(): Promise<boolean> {
    if (!this.pool || !this.config) return false;
    try {
      await assertRuntimeRole(this.pool, 'turnstile');
      const { rows } = await this.pool.query(
        'SELECT tenant_id, customer_key, application_id FROM turnstile.installation WHERE singleton = 1',
      );
      const identityMatches =
        rows[0]?.tenant_id === this.config.INSTALLATION_TENANT_ID &&
        rows[0]?.customer_key === this.config.INSTALLATION_CUSTOMER_KEY &&
        rows[0]?.application_id === this.config.TURNSTILE_APPLICATION_ID;
      if (!identityMatches) return false;
      const tenantId = this.config.INSTALLATION_TENANT_ID;
      return await withTenant(
        this.pool,
        this.config.INSTALLATION_TENANT_ID,
        async (client) =>
          (await accessSchemaSafe(client)) &&
          (await canonicalAccessReady(client, tenantId)) &&
          (await invitationSchemaSafe(client)) &&
          (await peopleSchemaSafe(client)),
      );
    } catch {
      return false;
    }
  }

  async onApplicationShutdown() {
    await this.pool?.end();
  }
}
