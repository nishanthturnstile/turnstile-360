import { Injectable } from '@nestjs/common';
import {
  type IdentityPreparationRequest,
  identityPreparationRequestSchema,
  identityPreparationSchema,
  identityProjectionRequestSchema,
  identityProjectionResponseSchema,
} from '@thaarei/dms-contracts';
import { z } from 'zod';
import { AccessContextChangedException } from '../../infrastructure/access-context-exception.js';
import { authError } from '../../infrastructure/access-error.js';
import type { ConfigurationActor } from '../../infrastructure/configuration-context.js';
import { withTenant } from '../../infrastructure/database/postgres.js';
import { ProductPersistenceService } from '../../infrastructure/database/product-persistence.service.js';
import { covers, readAccess } from '../../modules/access/access-evaluator.js';
import {
  IdentityAuthorityUnavailable,
  IdentityServiceTransport,
} from './identity-service-transport.js';

export { IdentityAuthorityUnavailable } from './identity-service-transport.js';

@Injectable()
export class IdentityClientService extends IdentityServiceTransport {
  constructor(private readonly persistence: ProductPersistenceService) {
    super();
  }
  // Only the owning invitation operation calls this with its persisted, currently eligible input.
  // A lost response is read by operationId; no mutation is automatically retried.
  async prepare(input: Omit<IdentityPreparationRequest, 'tenantId' | 'applicationId' | 'purpose'>) {
    if (!this.config) throw new IdentityAuthorityUnavailable();
    const request = identityPreparationRequestSchema.parse({
      ...input,
      tenantId: this.config.INSTALLATION_TENANT_ID,
      applicationId: this.config.TURNSTILE_APPLICATION_ID,
      purpose: 'application_invitation',
    });
    const result = await this.call(
      '/internal/identity/v1/invitation-preparations',
      identityPreparationSchema,
      request,
    );
    if (
      result.tenantId !== request.tenantId ||
      result.applicationId !== request.applicationId ||
      result.operationId !== request.operationId ||
      result.id !== request.operationId ||
      result.invitationId !== request.invitationId ||
      result.generation !== request.generation
    )
      throw new IdentityAuthorityUnavailable();
    return result;
  }
  async preparation(operationId: string) {
    const id = z.uuid().parse(operationId);
    const result = await this.call(
      `/internal/identity/v1/invitation-preparations/${id}`,
      identityPreparationSchema,
    );
    if (
      result.id !== id ||
      result.operationId !== id ||
      result.tenantId !== this.config?.INSTALLATION_TENANT_ID ||
      result.applicationId !== this.config?.TURNSTILE_APPLICATION_ID
    )
      throw new IdentityAuthorityUnavailable();
    return result;
  }
  async projectMembers(actor: ConfigurationActor, memberIds: string[]) {
    const ids = z
      .array(z.uuid())
      .min(1)
      .max(100)
      .refine((v) => new Set(v).size === v.length)
      .parse(memberIds);
    if (!this.config || !this.persistence.pool || !(await this.persistence.ready()))
      throw new IdentityAuthorityUnavailable();
    const config = this.config;
    const subjects = await withTenant(
      this.persistence.pool,
      config.INSTALLATION_TENANT_ID,
      async (db) => {
        await db.query('SELECT turnstile.lock_access_context($1::uuid)', [
          config.INSTALLATION_TENANT_ID,
        ]);
        const access = await readAccess(db, config.INSTALLATION_TENANT_ID, actor.userId);
        if (!covers(access, 'turnstile:people:manage', { kind: 'company' }))
          return authError(403, 'PERMISSION_DENIED');
        if (actor.accessFingerprint && actor.accessFingerprint !== access.context.fingerprint)
          throw new AccessContextChangedException(actor.requestId, access.context.accessRevision);
        const rows = await db.query<{ user_id: string; id: string; version: number }>(
          'SELECT user_id,id,version FROM turnstile.access_member WHERE tenant_id=$1 AND id=ANY($2::uuid[])',
          [config.INSTALLATION_TENANT_ID, ids],
        );
        if (rows.rows.length !== ids.length) return authError(403, 'PERMISSION_DENIED');
        return rows.rows.map((row) => ({
          userId: row.user_id,
          memberId: row.id,
          memberVersion: row.version,
        }));
      },
      actor.deadlineAt,
    );
    const request = identityProjectionRequestSchema.parse({
      tenantId: config.INSTALLATION_TENANT_ID,
      applicationId: config.TURNSTILE_APPLICATION_ID,
      purpose: 'member_display',
      subjects,
    });
    const response = await this.call(
      '/internal/identity/v1/subject-projections',
      identityProjectionResponseSchema,
      request,
    );
    if (
      response.subjects.length !== subjects.length ||
      response.subjects.some((s) => !subjects.some((link) => link.userId === s.userId))
    )
      throw new IdentityAuthorityUnavailable();
    // Recheck current permission and canonical bindings after the network boundary.
    await withTenant(
      this.persistence.pool,
      config.INSTALLATION_TENANT_ID,
      async (db) => {
        await db.query('SELECT turnstile.lock_access_context($1::uuid)', [
          config.INSTALLATION_TENANT_ID,
        ]);
        const access = await readAccess(db, config.INSTALLATION_TENANT_ID, actor.userId);
        if (!covers(access, 'turnstile:people:manage', { kind: 'company' }))
          return authError(403, 'PERMISSION_DENIED');
        if (actor.accessFingerprint && actor.accessFingerprint !== access.context.fingerprint)
          throw new AccessContextChangedException(actor.requestId, access.context.accessRevision);
        const rows = await db.query<{ user_id: string; id: string; version: number }>(
          'SELECT user_id,id,version FROM turnstile.access_member WHERE tenant_id=$1 AND id=ANY($2::uuid[])',
          [config.INSTALLATION_TENANT_ID, ids],
        );
        if (
          rows.rows.length !== subjects.length ||
          subjects.some(
            (s) =>
              !rows.rows.some(
                (r) =>
                  r.id === s.memberId && r.user_id === s.userId && r.version === s.memberVersion,
              ),
          )
        )
          throw new IdentityAuthorityUnavailable();
      },
      actor.deadlineAt,
    );
    return response;
  }
}
