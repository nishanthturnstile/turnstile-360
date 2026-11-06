import type { PoolClient } from 'pg';
import type { ApplicationRegistration, MachinePrincipal } from './access-policy.js';
import { dmsError } from './dms-errors.js';

export interface MachineContext {
  readonly kind: 'machine';
  readonly tenantId: string;
  readonly application: ApplicationRegistration;
  readonly principal: MachinePrincipal;
}
export interface OperatorContext {
  readonly kind: 'operator';
  readonly tenantId: string;
  readonly subjectId: string;
}
export interface CoordinatorContext {
  readonly kind: 'coordinator';
  readonly tenantId: string;
  readonly subjectId: 'thaarei_dms_coordinator';
}
export type DmsPrincipalContext = MachineContext | OperatorContext | CoordinatorContext;
export interface DmsTransaction<C extends DmsPrincipalContext = DmsPrincipalContext> {
  readonly client: PoolClient;
  readonly context: C;
}
export interface OwnedResource {
  readonly tenantId: string;
  readonly ownerApplicationId: string;
}
// Audit is owner/operator only. Future document sharing does not imply audit access.
// Owning routes load the current resource/grants inside this same transaction.
export function requireResourceOwner(transaction: DmsTransaction, resource: OwnedResource) {
  const context = transaction.context;
  if (
    context.kind === 'coordinator' ||
    resource.tenantId !== context.tenantId ||
    (context.kind === 'machine' && resource.ownerApplicationId !== context.application.id)
  )
    return dmsError(403, 'OPERATION_DENIED');
}

export async function bindPrincipal(client: PoolClient, context: DmsPrincipalContext) {
  await client.query(
    "SELECT set_config('app.principal_kind',$1,true), set_config('app.application_id',$2,true), set_config('app.actor_id',$3,true)",
    [
      context.kind,
      context.kind === 'machine' ? context.application.id : '',
      context.kind === 'machine' ? context.principal.clientId : context.subjectId,
    ],
  );
}

export type DocumentRight = 'READ' | 'EDIT_METADATA' | 'ADD_VERSION';
// This evaluator is reused by each owning surface; audit/admin retain owner-only checks.
export async function requireDocumentRight(
  tx: DmsTransaction,
  documentId: string,
  right: DocumentRight,
) {
  if (tx.context.kind === 'operator') return;
  if (tx.context.kind !== 'machine') return dmsError(403, 'OPERATION_DENIED');
  const doc = (
    await tx.client.query('SELECT application_id FROM dms.document WHERE id=$1', [documentId])
  ).rows[0];
  if (!doc) return dmsError(404, 'DOCUMENT_NOT_FOUND');
  await tx.client.query('SELECT id FROM dms.application_registration WHERE id=$1 FOR SHARE', [
    doc.application_id,
  ]);
  const allowed = (
    await tx.client.query('SELECT dms.has_document_right($1,$2) AS allowed', [documentId, right])
  ).rows[0]?.allowed;
  if (!allowed) return dmsError(404, 'DOCUMENT_NOT_FOUND');
}
export async function requireUploadControl(tx: DmsTransaction<MachineContext>, uploadId: string) {
  const doc = (
    await tx.client.query('SELECT document_id FROM dms.upload_admission WHERE id=$1', [uploadId])
  ).rows[0];
  if (!doc) return dmsError(404, 'UPLOAD_NOT_FOUND');
  await requireDocumentRight(tx, doc.document_id, 'ADD_VERSION');
  const allowed = (await tx.client.query('SELECT dms.controls_upload($1) AS allowed', [uploadId]))
    .rows[0]?.allowed;
  if (!allowed) return dmsError(404, 'UPLOAD_NOT_FOUND');
}
