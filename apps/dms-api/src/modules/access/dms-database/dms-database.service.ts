import { Injectable, type OnApplicationShutdown } from '@nestjs/common';
import type { DmsMachineScope } from '@thaarei/dms-contracts/public';
import { Pool } from 'pg';
import {
  assertRuntimeRole,
  createPool,
  withTenant,
} from '../../../infrastructure/database/postgres.js';
import { parseAuthorityEnvironment } from '../../platform-auth/authority-configuration.js';
import type { ApplicationRegistration, MachinePrincipal } from '../access-policy.js';
import { dmsError } from '../dms-errors.js';
import { bindPrincipal, type DmsTransaction, type MachineContext } from '../resource-policy.js';

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
        "SELECT count(*) = 6 AND bool_and(relrowsecurity AND relforcerowsecurity) AS safe FROM pg_class WHERE oid IN ('dms.application_registration'::regclass, 'dms.enrollment_key'::regclass, 'dms.enrollment_receipt'::regclass, 'dms.security_event'::regclass, 'dms.audit_event'::regclass, 'dms.outbox_intent'::regclass)",
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

  async withMachine<T>(
    principal: MachinePrincipal,
    scopes: readonly DmsMachineScope[],
    work: (transaction: DmsTransaction<MachineContext>) => Promise<T>,
    enrollment = false,
  ): Promise<T> {
    if (!this.pool || !this.config) return dmsError(503, 'DMS_UNAVAILABLE');
    const tenantId = this.config.INSTALLATION_TENANT_ID;
    return withTenant(this.pool, tenantId, async (client) => {
      // Shared lock holds live policy stable through commit; enrollment needs an update lock.
      const { rows } = await client.query<ApplicationRegistration>(
        `SELECT * FROM dms.application_registration WHERE issuer=$1 AND client_id=$2 ${enrollment ? 'FOR UPDATE NOWAIT' : 'FOR SHARE'}`,
        [principal.issuer, principal.clientId],
      );
      const application = rows[0];
      if (
        application?.principal_kind !== 'consumer' ||
        application.status === 'disabled' ||
        (!enrollment && application.status !== 'active')
      )
        return dmsError(403, 'APPLICATION_DENIED');
      if (
        principal.scopes.some((scope) => !application.scope_ceiling.includes(scope)) ||
        scopes.some((scope) => !principal.scopes.includes(scope))
      )
        return dmsError(403, 'SCOPE_DENIED');
      const context: MachineContext = {
        kind: 'machine',
        tenantId,
        application,
        principal,
      };
      await bindPrincipal(client, context);
      return work({ client, context });
    });
  }

  async onApplicationShutdown() {
    await this.pool?.end();
  }
}
