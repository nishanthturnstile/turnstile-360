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

  async ready(allowClosed = false): Promise<boolean> {
    if (!this.pool || !this.config) return false;
    try {
      await assertRuntimeRole(this.pool, 'dms');
      const policy = await this.pool.query(
        "SELECT count(*) = 36 AND bool_and(relrowsecurity AND relforcerowsecurity) AS safe FROM pg_class WHERE oid IN ('dms.application_registration'::regclass, 'dms.enrollment_key'::regclass, 'dms.enrollment_receipt'::regclass, 'dms.security_event'::regclass, 'dms.audit_event'::regclass, 'dms.outbox_intent'::regclass,'dms.document'::regclass,'dms.document_version'::regclass,'dms.upload_admission'::regclass,'dms.admission_policy'::regclass,'dms.admission_capacity'::regclass,'dms.admission_tenant_usage'::regclass,'dms.admission_application_usage'::regclass,'dms.upload_batch'::regclass,'dms.upload_batch_item'::regclass,'dms.upload_batch_slot'::regclass,'dms.upload_session'::regclass,'dms.upload_receipt'::regclass,'dms.work_identity'::regclass,'dms.work_job'::regclass,'dms.work_dispatch'::regclass,'dms.work_attempt'::regclass,'dms.security_candidate'::regclass,'dms.binary_restore'::regclass,'dms.document_grant'::regclass,'dms.lifecycle_restore'::regclass,'dms.lifecycle_receipt'::regclass,'dms.security_assessment_history'::regclass,'dms.extraction_stage'::regclass,'dms.processing_run'::regclass,'dms.search_generation'::regclass,'dms.search_chunk'::regclass,'dms.service_observation'::regclass,'dms.recovery_state'::regclass,'dms.backup_catalog'::regclass,'dms.disposal_intent'::regclass)",
      );
      if (!policy.rows[0]?.safe) return false;
      if (
        !allowClosed &&
        !(await this.pool.query('SELECT dms.recovery_open() AS open')).rows[0]?.open
      )
        return false;
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
    sharingWrite = false,
  ): Promise<T> {
    if (!this.pool || !this.config) return dmsError(503, 'DMS_UNAVAILABLE');
    const tenantId = this.config.INSTALLATION_TENANT_ID;
    return withTenant(this.pool, tenantId, async (client) => {
      if (!(await client.query('SELECT dms.recovery_open() AS open')).rows[0]?.open)
        return dmsError(503, 'DMS_UNAVAILABLE');
      await client.query(
        `SELECT ${sharingWrite ? 'pg_advisory_xact_lock' : 'pg_advisory_xact_lock_shared'}(hashtextextended($1,0))`,
        [`dms-sharing:${tenantId}`],
      );
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
