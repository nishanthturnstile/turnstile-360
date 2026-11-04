import { HttpException, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { AccessContextChangedException } from '../../infrastructure/access-context-exception.js';
import type { ConfigurationActor } from '../../infrastructure/configuration-context.js';
import { withTenant } from '../../infrastructure/database/postgres.js';
import { ProductPersistenceService } from '../../infrastructure/database/product-persistence.service.js';
import { covers, type EffectiveAccess, readAccess } from '../access/access-evaluator.js';

export type PeoplePolicy = 'people' | 'roles' | 'either';
export interface PeopleTransaction {
  db: PoolClient;
  tenant: string;
  actor: ConfigurationActor;
  access: EffectiveAccess;
  organizationRevision: number;
}
export const peopleFailure = (status: number, code: string, extra: object = {}): never => {
  throw new HttpException({ code, ...extra }, status);
};
@Injectable()
export class PeopleStoreService {
  constructor(private readonly persistence: ProductPersistenceService) {}
  async run<T>(
    actor: ConfigurationActor,
    policy: PeoplePolicy,
    work: (tx: PeopleTransaction) => Promise<T>,
  ): Promise<T> {
    const { pool, config } = this.persistence;
    if (!pool || !config || !(await this.persistence.ready()))
      return peopleFailure(503, 'PEOPLE_UNAVAILABLE', { reason: 'readiness' });
    try {
      return await withTenant(
        pool,
        config.INSTALLATION_TENANT_ID,
        async (db) => {
          await db.query('SELECT turnstile.lock_access_context($1::uuid)', [
            config.INSTALLATION_TENANT_ID,
          ]);
          const access = await readAccess(db, config.INSTALLATION_TENANT_ID, actor.userId);
          const people = covers(access, 'turnstile:people:manage', { kind: 'company' }),
            roles = covers(access, 'turnstile:roles:manage', { kind: 'company' });
          if (policy === 'people' ? !people : policy === 'roles' ? !roles : !people && !roles)
            return peopleFailure(403, 'PERMISSION_DENIED');
          if (actor.accessFingerprint && actor.accessFingerprint !== access.context.fingerprint)
            throw new AccessContextChangedException(actor.requestId, access.context.accessRevision);
          if (!access.workspaceComplete) return peopleFailure(409, 'SETUP_REQUIRED');
          const org = (
            await db.query<{ revision: number }>(
              'SELECT revision FROM turnstile.organization_configuration WHERE tenant_id=$1',
              [config.INSTALLATION_TENANT_ID],
            )
          ).rows[0];
          if (!org) throw new Error('Missing configuration');
          return work({
            db,
            tenant: config.INSTALLATION_TENANT_ID,
            actor,
            access,
            organizationRevision: org.revision,
          });
        },
        actor.deadlineAt ?? Date.now() + 10000,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined;
      const detail =
        error && typeof error === 'object' && 'message' in error ? error.message : undefined;
      const reasons: Record<string, string> = {
        people_last_admin: 'last_administrator',
        people_last_manager: 'last_configuration_manager',
        people_reference: 'reference_in_use',
        people_version: 'version',
        people_conflict: 'idempotency_mismatch',
        people_impact: 'impact_stale',
      };
      if (typeof detail === 'string' && reasons[detail])
        return peopleFailure(409, 'PEOPLE_CONFLICT', { reason: reasons[detail] });
      if (detail === 'people_denied') return peopleFailure(403, 'ACCESS_COVERAGE_DENIED');
      if (code === '23505')
        return peopleFailure(409, 'PEOPLE_CONFLICT', { reason: 'duplicate_name' });
      if (code === '54000') return peopleFailure(503, 'PEOPLE_UNAVAILABLE', { reason: 'capacity' });
      return peopleFailure(503, 'PEOPLE_UNAVAILABLE', { reason: 'dependency' });
    }
  }
}
