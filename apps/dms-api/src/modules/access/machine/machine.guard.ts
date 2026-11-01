import { type CanActivate, type ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { withTenant } from '../../../infrastructure/database/postgres.js';
import { type ApplicationRegistration, DMS_POLICY, DMS_PUBLIC } from '../access-policy.js';
import { DmsDatabaseService } from '../dms-database/dms-database.service.js';
import { dmsError } from '../dms-errors.js';
import { MachineVerifierService } from '../machine-verifier/machine-verifier.service.js';

@Injectable()
export class MachineGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly verifier: MachineVerifierService,
    private readonly database: DmsDatabaseService,
  ) {}
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(DMS_PUBLIC, targets)) return true;
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const url = new URL(request.url, 'http://localhost');
    if (
      Object.keys(request.headers).some((name) =>
        /^(?:x-)?(?:tenant|application)[-_]?id$/.test(name),
      ) ||
      [...url.searchParams.keys()].some((name) => /^(?:tenant|application)[_-]?id$/i.test(name))
    )
      return dmsError(400, 'TENANT_INPUT_REJECTED');
    const authorization = request.headers.authorization;
    const duplicates = request.raw.rawHeaders.filter(
      (_value, index) =>
        index % 2 === 0 && request.raw.rawHeaders[index]?.toLowerCase() === 'authorization',
    ).length;
    if (duplicates > 1 || request.headers.dpop !== undefined)
      return dmsError(401, 'INVALID_MACHINE_TOKEN');
    if (typeof authorization !== 'string') return dmsError(401, 'MACHINE_TOKEN_REQUIRED');
    const token = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)$/i.exec(
      authorization,
    )?.[1];
    if (!token || token.length > 16384) return dmsError(401, 'INVALID_MACHINE_TOKEN');
    const principal = await this.verifier.verify(token);
    const config = this.verifier.config;
    const pool = this.database.pool;
    if (!config || !pool || !(await this.database.ready())) return dmsError(503, 'DMS_UNAVAILABLE');
    const { rows } = await withTenant(pool, config.INSTALLATION_TENANT_ID, (client) =>
      client.query<ApplicationRegistration>(
        'SELECT * FROM dms.application_registration WHERE issuer = $1 AND client_id = $2',
        [principal.issuer, principal.clientId],
      ),
    );
    const registration = rows[0];
    const policy = this.reflector.getAllAndOverride<{
      kind: 'enrollment' | 'normal';
      scopes?: string[];
    }>(DMS_POLICY, targets);
    if (
      registration?.principal_kind !== 'consumer' ||
      registration.status === 'disabled' ||
      (policy?.kind !== 'enrollment' && registration.status !== 'active')
    )
      return dmsError(403, 'APPLICATION_DENIED');
    if (principal.scopes.some((scope) => !registration.scope_ceiling.includes(scope)))
      return dmsError(403, 'SCOPE_DENIED');
    if (
      !policy ||
      (policy.kind === 'normal' &&
        (!policy.scopes?.length ||
          policy.scopes.some((scope) => !principal.scopes.includes(scope))))
    )
      return dmsError(403, 'OPERATION_DENIED');
    request.machine = principal;
    request.registration = registration;
    return true;
  }
}
