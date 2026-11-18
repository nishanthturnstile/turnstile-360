import { AsyncLocalStorage } from 'node:async_hooks';
import { HttpException } from '@nestjs/common';
import { PEOPLE_PERMISSIONS as LEGACY_PERMISSIONS } from '@thaarei/turnstile-contracts';
import {
  DOCUMENTS_ACCESS_GATED_ROUTES,
  DOCUMENTS_ACCESS_HEADER,
} from '@thaarei/turnstile-contracts/documents';
import type { FastifyInstance } from 'fastify';
import type { PoolClient } from 'pg';

export const accessWireContext = new AsyncLocalStorage<{ version: 2 | 3; gated: boolean }>();
// Every owning transaction fences its read/write before observing access state. The
// lock remains held through result construction/commit; no lock crosses remote HTTP.
export async function fenceAccessContract(db: PoolClient, tenant: string) {
  const context = accessWireContext.getStore();
  if (!context?.gated) return;
  await db.query('SELECT turnstile.lock_access_context($1::uuid)', [tenant]);
  const row = (
    await db.query<{ documents_contract_required: boolean }>(
      'SELECT documents_contract_required FROM turnstile.access_context WHERE tenant_id=$1',
      [tenant],
    )
  ).rows[0];
  if (!row) throw new HttpException({ code: 'AUTH_UNAVAILABLE' }, 503);
  if (context.version !== 3 && row.documents_contract_required)
    throw new HttpException({ code: 'LOGIN_REQUIRED' }, 401);
}
export function registerAccessContractHttp(server: FastifyInstance) {
  server.addHook('onRequest', (request, _reply, done) => {
    const path = request.routeOptions.url;
    const gated = DOCUMENTS_ACCESS_GATED_ROUTES.some(
      (route) =>
        route.method === request.method && route.path.replaceAll(/\{([^}]+)\}/g, ':$1') === path,
    );
    accessWireContext.run(
      { version: request.headers[DOCUMENTS_ACCESS_HEADER] === '3' ? 3 : 2, gated },
      done,
    );
  });
  server.addHook('onSend', async (request, reply, payload) => {
    const context = accessWireContext.getStore();
    if (!context?.gated || reply.statusCode >= 300 || typeof payload !== 'string') return payload;
    const value = JSON.parse(payload);
    if (request.routeOptions.url === '/api/people/catalog' && context.version === 2) {
      // Only static catalogue definitions are projected. Saved rights are never stripped.
      value.permissions = value.permissions.filter((row: { id: string }) =>
        (LEGACY_PERMISSIONS as readonly string[]).includes(row.id),
      );
    }
    function project(row: unknown): void {
      if (!row || typeof row !== 'object') return;
      if (Array.isArray(row)) {
        for (const item of row) project(item);
        return;
      }
      const object = row as Record<string, unknown>;
      if ('catalogVersion' in object) object.catalogVersion = context?.version;
      for (const [key, child] of Object.entries(object)) {
        if (
          context?.version === 2 &&
          ['permissions', 'grantableCompanyPermissions'].includes(key) &&
          Array.isArray(child) &&
          child.some((p) => typeof p === 'string' && p.startsWith('turnstile:documents:'))
        )
          throw new HttpException({ code: 'LOGIN_REQUIRED' }, 401);
        project(child);
      }
    }
    project(value);
    return JSON.stringify(value);
  });
}
