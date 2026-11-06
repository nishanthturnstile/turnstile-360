import { Injectable } from '@nestjs/common';
import {
  documentPermissionsResponseSchema,
  documentPermissionsSchema,
} from '@thaarei/dms-contracts/public';
import type { MachinePrincipal } from '../access/access-policy.js';
import { DmsDatabaseService } from '../access/dms-database/dms-database.service.js';
import { dmsError } from '../access/dms-errors.js';
import { type DmsTransaction, requireResourceOwner } from '../access/resource-policy.js';
import { appendDocumentAudit } from '../audit/document-audit.js';
import { lockOriginal } from './download-policy.js';

// Caller holds the installation sharing fence before registration/document locks.
export async function documentPermissions(
  tx: DmsTransaction,
  id: string,
  input?: unknown,
  expected?: string,
  requestId?: string,
) {
  await lockOriginal(tx.client, tx.context.tenantId, id, input !== undefined);
  const doc = (
    await tx.client.query(
      `SELECT * FROM dms.document WHERE id=$1 ${input !== undefined ? 'FOR UPDATE' : ''}`,
      [id],
    )
  ).rows[0];
  if (!doc) return dmsError(404, 'DOCUMENT_NOT_FOUND');
  requireResourceOwner(tx, { tenantId: doc.tenant_id, ownerApplicationId: doc.application_id });
  if (input !== undefined) {
    if (String(doc.revision) !== expected) return dmsError(412, 'REVISION_CONFLICT');
    if (doc.lifecycle !== 'ACTIVE' || BigInt(doc.revision) >= 999999999999999n)
      return dmsError(409, 'DOCUMENT_UNAVAILABLE');
    const parsed = documentPermissionsSchema.safeParse(input);
    if (!parsed.success) return dmsError(400, 'INVALID_REQUEST');
    const grants = parsed.data.grants.map((g) => ({
      ...g,
      applicationId: g.applicationId.toLowerCase(),
    }));
    const ids = grants.map((g) => g.applicationId).sort();
    if (ids.includes(doc.application_id)) return dmsError(400, 'INVALID_REQUEST');
    const targets = (
      await tx.client.query(
        tx.context.kind === 'operator'
          ? 'SELECT dms.operator_grant_targets($1::uuid[]) AS id'
          : "SELECT id FROM dms.application_registration WHERE id=ANY($1::uuid[]) AND tenant_id=$2 AND status='active' AND principal_kind='consumer' ORDER BY id FOR SHARE",
        tx.context.kind === 'operator' ? [ids] : [ids, tx.context.tenantId],
      )
    ).rows;
    if (targets.length !== ids.length) return dmsError(400, 'INVALID_REQUEST');
    await tx.client.query('DELETE FROM dms.document_grant WHERE document_id=$1', [id]);
    for (const grant of grants)
      await tx.client.query(
        'INSERT INTO dms.document_grant (tenant_id,owner_application_id,document_id,application_id,rights) VALUES ($1,$2,$3,$4,$5)',
        [tx.context.tenantId, doc.application_id, id, grant.applicationId, grant.rights],
      );
    await tx.client.query('UPDATE dms.document SET revision=revision+1 WHERE id=$1', [id]);
    doc.revision = String(BigInt(doc.revision) + 1n);
    await appendDocumentAudit(tx, {
      documentId: id,
      action: 'document.permissions-changed',
      requestId,
    });
  }
  const grants = (
    await tx.client.query(
      'SELECT application_id AS "applicationId",rights FROM dms.document_grant WHERE document_id=$1 ORDER BY application_id',
      [id],
    )
  ).rows;
  return documentPermissionsResponseSchema.parse({
    documentId: id,
    revision: String(doc.revision),
    grants,
  });
}
@Injectable()
export class SharingService {
  constructor(private readonly database: DmsDatabaseService) {}
  read(principal: MachinePrincipal, id: string) {
    return this.database.withMachine(principal, ['dms:documents:read'], (tx) =>
      documentPermissions(tx, id),
    );
  }
  set(principal: MachinePrincipal, id: string, body: unknown, expected: string, requestId: string) {
    return this.database.withMachine(
      principal,
      ['dms:documents:write'],
      (tx) => documentPermissions(tx, id, body, expected, requestId),
      false,
      true,
    );
  }
}
