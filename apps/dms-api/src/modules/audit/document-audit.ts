import { randomUUID } from 'node:crypto';
import type { DmsTransaction } from '../access/resource-policy.js';
export async function appendDocumentAudit(
  tx: DmsTransaction,
  event: {
    documentId: string;
    applicationId?: string;
    action:
      | 'document.admitted'
      | 'admission.reconciled'
      | 'upload.authorized'
      | 'upload.completion-requested'
      | 'upload.cancelled'
      | 'upload.expired'
      | 'upload.object-verified'
      | 'upload.failed'
      | 'work.queued'
      | 'work.completed'
      | 'work.recovered'
      | 'work.cancelled'
      | 'security.assessed'
      | 'security.invalidated'
      | 'document.published'
      | 'document.download-authorized'
      | 'document.soft-deleted'
      | 'document.logical-restored'
      | 'processing.requested'
      | 'processing.promoted'
      | 'processing.content-authorized'
      | 'document.permissions-changed'
      | 'document.version-restored'
      | 'document.metadata-updated'
      | 'document.reference-linked'
      | 'document.reference-unlinked'
      | 'disposal.requested'
      | 'disposal.completed'
      | 'document.purged';
    requestId?: string | undefined;
    assertedHuman?: { source: 'application-asserted'; subject: string } | undefined;
  },
) {
  const id = randomUUID();
  const applicationId =
    event.applicationId ??
    (
      await tx.client.query('SELECT application_id FROM dms.document WHERE id=$1', [
        event.documentId,
      ])
    ).rows[0]?.application_id;
  if (!applicationId) throw new Error('Attributed owning context required');
  const actor =
    tx.context.kind === 'machine' ? tx.context.principal.clientId : tx.context.subjectId;
  await tx.client.query(
    `INSERT INTO dms.audit_event (id,tenant_id,application_id,document_id,resource_id,resource_type,action,actor_kind,actor_id,request_id,asserted_human)
    VALUES ($1,$2,$3,$4,$4,'document',$5,$6,$7,$8,$9)`,
    [
      id,
      tx.context.tenantId,
      applicationId,
      event.documentId,
      event.action,
      tx.context.kind,
      actor,
      event.requestId ?? null,
      event.assertedHuman?.subject ?? null,
    ],
  );
  await tx.client.query(
    'INSERT INTO dms.outbox_intent (id,tenant_id,application_id,audit_id,kind) VALUES ($1,$2,$3,$4,$5)',
    [randomUUID(), tx.context.tenantId, applicationId, id, event.action],
  );
}
