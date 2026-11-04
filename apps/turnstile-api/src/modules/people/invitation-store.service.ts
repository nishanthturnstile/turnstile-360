import { HttpException, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { AccessContextChangedException } from '../../infrastructure/access-context-exception.js';
import type { ConfigurationActor } from '../../infrastructure/configuration-context.js';
import { withTenant } from '../../infrastructure/database/postgres.js';
import { ProductPersistenceService } from '../../infrastructure/database/product-persistence.service.js';
import { covers, readAccess } from '../access/access-evaluator.js';
import { parseInvitationEnvironment } from './invitation-environment.js';
import { unavailable } from './invitation-policy.js';
@Injectable()
export class InvitationStoreService {
  readonly config: ReturnType<typeof parseInvitationEnvironment> | undefined;
  constructor(private readonly persistence: ProductPersistenceService) {
    try {
      this.config = parseInvitationEnvironment(process.env);
    } catch {
      /* staged */
    }
  }
  async run<T>(
    work: (
      db: PoolClient,
      tenant: string,
      config: ReturnType<typeof parseInvitationEnvironment>,
    ) => Promise<T>,
    actor?: ConfigurationActor,
    deadlineAt?: number,
  ): Promise<T> {
    const config = this.config;
    const pool = this.persistence.pool;
    if (!config || !pool || !(await this.persistence.ready())) return unavailable();
    const deadline = actor?.deadlineAt ?? deadlineAt ?? Date.now() + 10000;
    try {
      return await withTenant(
        pool,
        config.INSTALLATION_TENANT_ID,
        async (db) => {
          await db.query('SELECT turnstile.lock_access_context($1::uuid)', [
            config.INSTALLATION_TENANT_ID,
          ]);
          if (actor) {
            const access = await readAccess(db, config.INSTALLATION_TENANT_ID, actor.userId);
            if (!covers(access, 'turnstile:people:manage', { kind: 'company' }))
              throw new HttpException({ code: 'PERMISSION_DENIED' }, 403);
            if (actor.accessFingerprint && actor.accessFingerprint !== access.context.fingerprint)
              throw new AccessContextChangedException(
                actor.requestId,
                access.context.accessRevision,
              );
            if (!access.workspaceComplete) throw new HttpException({ code: 'SETUP_REQUIRED' }, 409);
          }
          return work(db, config.INSTALLATION_TENANT_ID, config);
        },
        deadline,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      return unavailable();
    }
  }
}
