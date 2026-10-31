import { randomUUID } from 'node:crypto';
import type { PoolClient } from 'pg';
import {
  assertRuntimeRole,
  createPool,
  withTenant,
} from '../../infrastructure/database/postgres.js';
import type { AuthorityConfiguration } from '../platform-auth/authority-configuration.js';

export interface SecurityEvent {
  action: string;
  outcome: 'success' | 'denied' | 'pending';
  actorKind: 'operator' | 'machine';
  actorId: string;
  subjectId: string;
  requestId?: string;
}
export async function insertSecurityEvent(
  client: PoolClient,
  tenantId: string,
  event: SecurityEvent,
) {
  await client.query(
    'INSERT INTO dms.security_event (id, tenant_id, action, outcome, actor_kind, actor_id, subject_id, request_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
    [
      randomUUID(),
      tenantId,
      event.action,
      event.outcome,
      event.actorKind,
      event.actorId,
      event.subjectId,
      event.requestId ?? null,
    ],
  );
}

// Used only by private authority commands. Neither DMS authorization nor enrollment reads auth SQL.
export async function captureAuthorityEvent(config: AuthorityConfiguration, event: SecurityEvent) {
  const pool = createPool(config.DMS_DATABASE_URL, 1);
  try {
    await assertRuntimeRole(pool, 'dms');
    await withTenant(pool, config.INSTALLATION_TENANT_ID, (client) =>
      insertSecurityEvent(client, config.INSTALLATION_TENANT_ID, event),
    );
  } finally {
    await pool.end();
  }
}
