import { HttpException, Injectable } from '@nestjs/common';
import {
  type DecisionState,
  evaluateModuleDecision,
  readProtectedTrust,
  verifyModuleDecision,
} from '@thaarei/deployment-control';
import {
  BUSINESS_MODULES,
  type BusinessModuleId,
  businessModuleIdSchema,
  type ModuleCapabilitiesDto,
  type ModuleEntryDto,
  moduleCapabilitiesSchema,
  moduleEntrySchema,
} from '@thaarei/turnstile-contracts';
import type { FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AccessContextChangedException } from '../../infrastructure/access-context-exception.js';
import type { ConfigurationActor } from '../../infrastructure/configuration-context.js';
import { productActor } from '../../infrastructure/configuration-http.js';
import { withTenant } from '../../infrastructure/database/postgres.js';
import { ProductPersistenceService } from '../../infrastructure/database/product-persistence.service.js';
import { covers, hasShell, readAccess } from '../access/access-evaluator.js';
import { featureWritesOpen } from '../access/release-state.js';
import { deploymentPreflight, evaluateStored } from '../deployment/access.js';
import { installedModuleRelease } from '../deployment/module-release.js';

const failure = (status: number, code: string): never => {
  throw new HttpException({ code }, status);
};
export function moduleActor(request: FastifyRequest) {
  if (!z.object({}).strict().safeParse(request.query).success)
    return failure(400, 'MODULE_INVALID_INPUT');
  return productActor(request);
}
export function locallyEnabledIds(
  allowed: readonly string[],
  definitions: readonly { id: string; requires: readonly string[] }[],
  disabled: readonly string[],
) {
  const enabled = new Set(allowed.filter((id) => !disabled.includes(id)));
  for (let changed = true; changed; ) {
    changed = false;
    for (const module of definitions)
      if (enabled.has(module.id) && module.requires.some((id) => !enabled.has(id))) {
        enabled.delete(module.id);
        changed = true;
      }
  }
  return enabled;
}
@Injectable()
export class ModuleAccessService {
  constructor(private readonly persistence: ProductPersistenceService) {}
  private async run<T>(
    actor: ConfigurationActor,
    work: (caps: ModuleCapabilitiesDto) => T,
  ): Promise<T> {
    const { pool, config } = this.persistence;
    if (!pool || !config || !(await this.persistence.ready()))
      return failure(503, 'MODULE_UNAVAILABLE');
    try {
      await deploymentPreflight(pool, config.INSTALLATION_TENANT_ID, 'read');
      return await withTenant(
        pool,
        config.INSTALLATION_TENANT_ID,
        async (db) => {
          // Existing read/lock function holds the deployment snapshot through admission.
          const row = (await db.query('SELECT turnstile.deployment_read() AS snapshot')).rows[0]
            ?.snapshot;
          const product = await evaluateStored(row);
          if (product.access === 'closed') return failure(403, 'DEPLOYMENT_RESTRICTED');
          await db.query('SELECT turnstile.lock_access_context($1::uuid)', [
            config.INSTALLATION_TENANT_ID,
          ]);
          const access = await readAccess(db, config.INSTALLATION_TENANT_ID, actor.userId);
          if (!hasShell(access)) return failure(403, 'PERMISSION_DENIED');
          if (actor.accessFingerprint && actor.accessFingerprint !== access.context.fingerprint)
            throw new AccessContextChangedException(actor.requestId, access.context.accessRevision);
          if (!access.workspaceComplete) return failure(409, 'SETUP_REQUIRED');
          const empty: ModuleCapabilitiesDto = { version: 1, modules: [], context: null };
          const release = await installedModuleRelease();
          if (!release || !(await featureWritesOpen(db, config.INSTALLATION_TENANT_ID)))
            return work(empty);
          const trust = await readProtectedTrust(
            process.env.TURNSTILE_CONTROL_PLANE_VERIFICATION_KEYS_FILE ?? '',
          );
          const state = row.decision as DecisionState;
          const decision = await evaluateModuleDecision(
            state,
            row.binding,
            trust,
            Math.floor(Date.now() / 1000),
            release,
          );
          if (decision.state !== 'approved' || !state.accepted) return work(empty);
          const claims = await verifyModuleDecision(
            state.accepted.token,
            row.binding,
            state.epoch,
            trust,
            Math.floor(Date.now() / 1000),
            release,
          );
          if (claims.state !== 'approved') return work(empty);
          const disabled = z
            .array(businessModuleIdSchema)
            .max(BUSINESS_MODULES.length)
            .refine((v) => new Set(v).size === v.length)
            .parse(JSON.parse(process.env.TURNSTILE_DISABLED_MODULES ?? '[]'));
          const enabled = locallyEnabledIds(
            decision.allowedModuleIds,
            release.request.catalogue.modules,
            disabled,
          );
          const modules = BUSINESS_MODULES.filter(
            (m) =>
              enabled.has(m.id) &&
              release.request.profile.modules.some((p) => p.id === m.id) &&
              covers(access, m.permission, { kind: 'company' }),
          ).map(({ id, title, path }) => ({ id, title, path }));
          return work(
            moduleCapabilitiesSchema.parse({
              version: 1,
              modules,
              context: claims.modulePolicy.active,
            }),
          );
        },
        actor.deadlineAt ?? Date.now() + 10000,
      );
    } catch (error) {
      if (error instanceof HttpException) throw error;
      return failure(503, 'MODULE_UNAVAILABLE');
    }
  }
  capabilities(actor: ConfigurationActor) {
    return this.run(actor, (caps) => caps);
  }
  entry(
    actor: ConfigurationActor,
    id: BusinessModuleId,
    read: () => { id: string; message: string },
  ): Promise<ModuleEntryDto> {
    return this.run(actor, (caps) => {
      const module = caps.modules.find((m) => m.id === id);
      if (!module) return failure(403, 'MODULE_ACCESS_DENIED');
      const value = read();
      if (value.id !== id) return failure(503, 'MODULE_UNAVAILABLE');
      return moduleEntrySchema.parse({ ...value, title: module.title });
    });
  }
}
