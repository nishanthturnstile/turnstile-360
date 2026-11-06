import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  type AuditPage,
  assertedHumanSchema,
  auditPageSchema,
} from '@thaarei/dms-contracts/public';
import type { MachinePrincipal } from '../access/access-policy.js';
import { DmsDatabaseService } from '../access/dms-database/dms-database.service.js';
import { dmsError } from '../access/dms-errors.js';
import {
  type DmsTransaction,
  type MachineContext,
  requireResourceOwner,
} from '../access/resource-policy.js';
import { parseAuthorityEnvironment } from '../platform-auth/authority-configuration.js';

export async function appendApplicationAudit(
  transaction: DmsTransaction<MachineContext>,
  requestId: string,
  assertedHuman?: { source: 'application-asserted'; subject: string },
) {
  const { client, context } = transaction;
  const id = randomUUID();
  const human =
    assertedHuman === undefined ? null : assertedHumanSchema.parse(assertedHuman).subject;
  await client.query(
    `INSERT INTO dms.audit_event (id,tenant_id,application_id,resource_id,resource_type,action,actor_id,asserted_human,request_id)
    VALUES ($1,$2,$3,$3,'application','application.enrolled',$4,$5,$6)`,
    [id, context.tenantId, context.application.id, context.principal.clientId, human, requestId],
  );
  await client.query(
    `INSERT INTO dms.outbox_intent (id,tenant_id,application_id,audit_id,kind)
    VALUES ($1,$2,$3,$4,'application.enrolled')`,
    [randomUUID(), context.tenantId, context.application.id, id],
  );
}

// Order on the stored timestamp so bounded pages can use the audit indexes.
export const AUDIT_PAGE_SQL = `SELECT id,application_id,resource_id,resource_type,action,actor_kind,actor_id,asserted_human,request_id,
    to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS created_at
    FROM dms.audit_event WHERE ($1::uuid IS NULL OR application_id=$1)
    AND ($2::timestamptz IS NULL OR (created_at,id) < ($2::timestamptz,$3::uuid))
    AND ($5::uuid IS NULL OR document_id=$5)
    ORDER BY audit_event.created_at DESC,audit_event.id DESC LIMIT $4`;

export async function readAuditPage(
  transaction: DmsTransaction,
  secret: string,
  options: {
    limit?: number | undefined;
    cursor?: string | undefined;
    applicationId?: string | undefined;
    documentId?: string | undefined;
  },
): Promise<AuditPage> {
  const { client, context } = transaction;
  const applicationId = context.kind === 'machine' ? context.application.id : options.applicationId;
  if (context.kind === 'machine')
    requireResourceOwner(transaction, {
      tenantId: context.tenantId,
      ownerApplicationId: context.application.id,
    });
  if (options.documentId) {
    const { rowCount } = await client.query(
      'SELECT id FROM dms.document WHERE id=$1 AND ($2::uuid IS NULL OR application_id=$2)',
      [options.documentId, context.kind === 'machine' ? context.application.id : null],
    );
    if (!rowCount) return dmsError(404, 'DOCUMENT_NOT_FOUND');
  }
  const binding = [
    2,
    context.tenantId,
    context.kind,
    context.kind === 'machine' ? context.application.id : context.subjectId,
    applicationId ?? null,
    options.documentId ?? null,
  ];
  const mac = (payload: string) =>
    createHmac('sha256', secret).update('dms-audit-cursor:v1:').update(payload).digest();
  let after: string[] | undefined;
  if (options.cursor) {
    try {
      const decoded = JSON.parse(Buffer.from(options.cursor, 'base64url').toString('utf8'));
      const payload = JSON.stringify(decoded.data);
      const signature = Buffer.from(decoded.signature, 'base64url');
      const expected = mac(payload);
      if (
        signature.length !== expected.length ||
        !timingSafeEqual(signature, expected) ||
        JSON.stringify(decoded.data.slice(0, 6)) !== JSON.stringify(binding) ||
        decoded.data.length !== 8 ||
        !/^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(decoded.data[6]) ||
        !/^[a-f0-9-]{36}$/.test(decoded.data[7])
      )
        throw new Error('Invalid cursor');
      after = decoded.data.slice(6);
    } catch {
      return dmsError(400, 'INVALID_REQUEST');
    }
  }
  const limit = options.limit ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) return dmsError(400, 'INVALID_REQUEST');
  const { rows } = await client.query<{
    id: string;
    application_id: string;
    resource_id: string;
    resource_type: string;
    action: string;
    actor_kind: string;
    actor_id: string;
    asserted_human: string | null;
    request_id: string | null;
    created_at: string;
  }>(AUDIT_PAGE_SQL, [
    applicationId ?? null,
    after?.[0] ?? null,
    after?.[1] ?? null,
    limit + 1,
    options.documentId ?? null,
  ]);
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const data = last ? [...binding, last.created_at, last.id] : null;
  const nextCursor =
    rows.length > limit && data
      ? Buffer.from(
          JSON.stringify({ data, signature: mac(JSON.stringify(data)).toString('base64url') }),
        ).toString('base64url')
      : null;
  return auditPageSchema.parse({
    items: page.map((row) => ({
      id: row.id,
      applicationId: row.application_id,
      resourceType: row.resource_type,
      resourceId: row.resource_id,
      action: row.action,
      actor: { kind: row.actor_kind, id: row.actor_id },
      assertedHuman:
        row.asserted_human === null
          ? null
          : { source: 'application-asserted', subject: row.asserted_human },
      requestId: row.request_id,
      createdAt: row.created_at,
    })),
    nextCursor,
  });
}

@Injectable()
export class AuditService {
  constructor(private readonly database: DmsDatabaseService) {}
  read(
    principal: MachinePrincipal,
    options: {
      limit?: number | undefined;
      cursor?: string | undefined;
      documentId?: string | undefined;
    },
  ) {
    const config = parseAuthorityEnvironment(process.env);
    return this.database.withMachine(principal, ['dms:audit:read'], (tx) =>
      readAuditPage(tx, config.AUTH_SECRET, options),
    );
  }
}
