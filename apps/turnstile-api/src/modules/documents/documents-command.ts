import { isDeepStrictEqual } from 'node:util';
import { type DmsClient, DmsClientError } from '@thaarei/dms-client';
import {
  DOCUMENTS_LIMITS,
  type DocumentsBatchPayload,
  type DocumentsOperationMode,
  type DocumentsWorkspaceCommand,
  documentsCommandPermissions,
  documentsForwardedBodyFits,
  documentsJsonBytes,
} from '@thaarei/turnstile-contracts/documents';
import type { ConfigurationActor } from '../../infrastructure/configuration-context.js';
import { commandDigest } from '../access/access-transactions.js';

export type WorkspaceKind = DocumentsWorkspaceCommand['kind'];
type UploadStart = Extract<DocumentsWorkspaceCommand, { kind: 'upload.begin' | 'version.begin' }>;
type RevisionChange = Extract<
  DocumentsWorkspaceCommand,
  { kind: 'document.edit' | 'reference.link' | 'reference.unlink' }
>;
type Binding = Pick<Awaited<ReturnType<DmsClient['beginUpload']>>, 'session' | 'transfer'>;

export const workspaceKinds = [
  'upload.begin',
  'upload.complete',
  'upload.refresh',
  'upload.cancel',
  'document.edit',
  'reference.link',
  'reference.unlink',
  'version.begin',
  'version.restore',
  'version.reprocess',
  'batch.create',
  'batch.item',
  'batch.close',
  'batch.cancel',
  'document.delete',
  'document.restore',
  'permissions.replace',
] as const satisfies readonly WorkspaceKind[];

export function permissions(kind: WorkspaceKind, mode: DocumentsOperationMode = 'ordinary') {
  const actions = documentsCommandPermissions(kind, mode);
  if (
    mode === 'ordinary' &&
    (kind === 'document.edit' || kind.startsWith('reference.') || kind.startsWith('version.'))
  )
    actions.push('turnstile:documents:read');
  return actions;
}

export function operation(kind: WorkspaceKind) {
  switch (kind) {
    case 'document.edit':
      return 'documents:edit-metadata';
    case 'reference.link':
    case 'reference.unlink':
      return 'documents:references';
    case 'version.begin':
      return 'versions:write';
    case 'version.restore':
      return 'versions:restore';
    case 'version.reprocess':
      return 'processing:reprocess';
    case 'document.delete':
    case 'document.restore':
      return 'documents:lifecycle';
    case 'permissions.replace':
      return 'documents:permissions';
    case 'batch.create':
    case 'batch.close':
    case 'batch.cancel':
      return 'upload-batches:control';
    default:
      return 'uploads:control';
  }
}
export function needsTransferOrigin(kind: WorkspaceKind) {
  return ['upload.begin', 'version.begin', 'upload.refresh', 'batch.item'].includes(kind);
}
export function subjectKey(command: DocumentsWorkspaceCommand) {
  if (command.kind === 'batch.create')
    return commandDigest(
      command.payload.items
        .map((item) =>
          JSON.stringify([
            item.operation,
            item.operation === 'new-version' ? item.documentId : null,
            item.descriptor.sha256,
          ]),
        )
        .sort(),
    );
  if (command.kind === 'batch.item') return commandDigest([command.batchId, command.itemId]);
  if ('batchId' in command) return commandDigest(command.batchId);
  if (command.kind === 'upload.begin') return command.payload.sha256;
  if ('uploadId' in command) return commandDigest(command.uploadId);
  if (command.kind === 'version.begin')
    return commandDigest([command.documentId, command.payload.sha256]);
  if (command.kind === 'version.restore' || command.kind === 'version.reprocess')
    return commandDigest([command.documentId, command.versionId]);
  return commandDigest(command.documentId);
}
function attributed(payload: UploadStart['payload'], actor: ConfigurationActor) {
  return {
    ...payload,
    assertedHuman: { source: 'application-asserted' as const, subject: actor.userId },
  };
}
function batchBody(payload: DocumentsBatchPayload, actor: ConfigurationActor) {
  return {
    items: payload.items.map((item) => ({
      itemId: item.itemId,
      operation: item.operation,
      descriptor: {
        ...attributed(item.descriptor, actor),
        ...(item.operation === 'new-version'
          ? {
              documentId: item.documentId,
              expectedRevision: item.expectedRevision,
            }
          : {}),
      },
    })),
  };
}
export function forwardedBodyFits(command: DocumentsWorkspaceCommand, actor: ConfigurationActor) {
  if (command.kind === 'batch.create') {
    const body = batchBody(command.payload, actor);
    return (
      /^[A-Za-z0-9_.:@-]{1,128}$/.test(actor.userId) &&
      documentsJsonBytes(body.items) <= DOCUMENTS_LIMITS.manifestBytes &&
      documentsForwardedBodyFits(command.kind, body)
    );
  }
  if (command.kind === 'upload.begin' || command.kind === 'version.begin') {
    // Account for the DMS controller's addition of the selector and revision too.
    const body = attributed(command.payload, actor);
    return (
      /^[A-Za-z0-9_.:@-]{1,128}$/.test(actor.userId) &&
      documentsForwardedBodyFits(
        command.kind,
        command.kind === 'version.begin'
          ? { ...body, documentId: command.documentId, expectedRevision: command.expectedRevision }
          : body,
      )
    );
  }
  return !('payload' in command) || documentsForwardedBodyFits(command.kind, command.payload);
}

function isRevisionChange(command: DocumentsWorkspaceCommand): command is RevisionChange {
  return (
    command.kind === 'document.edit' ||
    command.kind === 'reference.link' ||
    command.kind === 'reference.unlink'
  );
}
function hasDesiredState(
  command: RevisionChange,
  document: Awaited<ReturnType<DmsClient['document']>>,
  applicationId: string,
) {
  if (BigInt(document.revision) < BigInt(command.expectedRevision)) return false;
  if (command.kind === 'document.edit')
    return Object.entries(command.payload).every(([field, value]) =>
      isDeepStrictEqual(document[field as keyof typeof command.payload], value),
    );
  if (command.kind === 'reference.unlink')
    return !document.references.some((r) => r.id === command.referenceId);
  const { namespace, type, externalId } = command.payload;
  return document.references.some(
    (r) =>
      r.applicationId === applicationId &&
      r.namespace === namespace &&
      r.type === type &&
      r.externalId === externalId,
  );
}

function canonicalGrants(grants: Awaited<ReturnType<DmsClient['documentPermissions']>>['grants']) {
  return grants
    .map(({ applicationId, rights }) => ({
      applicationId: applicationId.toLowerCase(),
      rights: [...rights].sort(),
    }))
    .sort((a, b) => a.applicationId.localeCompare(b.applicationId));
}

function revisionMutation(client: DmsClient, command: RevisionChange, actor: ConfigurationActor) {
  const { documentId, expectedRevision } = command;
  switch (command.kind) {
    case 'document.edit':
      return client.editDocument(documentId, expectedRevision, command.payload, actor);
    case 'reference.link':
      return client.linkReference(documentId, expectedRevision, command.payload, actor);
    case 'reference.unlink':
      return client.unlinkReference(documentId, command.referenceId, expectedRevision, actor);
  }
}

export async function dispatchDocumentsCommand(options: {
  client: DmsClient;
  applicationId: string;
  actor: ConfigurationActor;
  command: DocumentsWorkspaceCommand;
  key: string;
  recovering: boolean;
  mode: DocumentsOperationMode;
  item?: DocumentsBatchPayload['items'][number];
  authorizeVersion: () => Promise<unknown>;
  authorizeRead: () => Promise<unknown>;
}): Promise<
  | {
      binding: Binding | null;
      batchId?: string;
      processing?: { runId: string; replayUntil: string };
    }
  | undefined
> {
  const { client, applicationId, actor, command, key, recovering, mode, item } = options;
  if (command.kind === 'document.delete' || command.kind === 'document.restore') {
    const { documentId, expectedRevision } = command;
    const lifecycle =
      command.kind === 'document.restore'
        ? await client.restoreDocument(documentId, expectedRevision, key, actor)
        : recovering
          ? await client.lifecycle(documentId, actor)
          : await client.deleteDocument(documentId, expectedRevision, actor);
    if (lifecycle.documentId !== documentId) throw new DmsClientError('DMS_INVALID_RESPONSE');
    if (
      command.kind === 'document.delete' &&
      (lifecycle.lifecycle !== 'SOFT_DELETED' ||
        BigInt(lifecycle.revision) <= BigInt(expectedRevision))
    )
      return undefined;
    return { binding: null };
  }
  if (command.kind === 'permissions.replace') {
    const { documentId, expectedRevision, payload } = command;
    const access = recovering
      ? await client.documentPermissions(documentId, actor)
      : await client.replaceDocumentPermissions(documentId, expectedRevision, payload, actor);
    if (access.documentId !== documentId) throw new DmsClientError('DMS_INVALID_RESPONSE');
    return BigInt(access.revision) > BigInt(expectedRevision) &&
      isDeepStrictEqual(canonicalGrants(access.grants), canonicalGrants(payload.grants))
      ? { binding: null }
      : undefined;
  }
  if (command.kind === 'batch.create') {
    const result = await client.createBatch(batchBody(command.payload, actor), key, actor);
    if (result.batch.total !== command.payload.items.length)
      throw new DmsClientError('DMS_INVALID_RESPONSE');
    return { binding: null, batchId: result.batch.id };
  }
  if (command.kind === 'batch.close' || command.kind === 'batch.cancel') {
    if (command.kind === 'batch.cancel' && recovering) await options.authorizeRead();
    const batch =
      command.kind === 'batch.close'
        ? (await client.closeBatch(command.batchId, key, actor)).batch
        : recovering
          ? await client.batch(command.batchId, {}, actor)
          : (await client.cancelBatch(command.batchId, actor)).batch;
    if (batch.id !== command.batchId) throw new DmsClientError('DMS_INVALID_RESPONSE');
    if (command.kind === 'batch.cancel' && batch.state !== 'CANCELLED') return undefined;
    return { binding: null, batchId: batch.id };
  }
  if (command.kind === 'batch.item') {
    if (!item || item.itemId !== command.itemId) throw new DmsClientError('DMS_INVALID_RESPONSE');
    const body = {
      ...attributed(item.descriptor, actor),
      batchId: command.batchId,
      itemId: item.itemId,
    };
    if (item.operation === 'create') return { binding: await client.beginUpload(body, key, actor) };
    await options.authorizeVersion();
    const current = await client.document(item.documentId, actor);
    if (current.id !== item.documentId) throw new DmsClientError('DMS_INVALID_RESPONSE');
    if (current.applicationId !== applicationId)
      throw new DmsClientError('DMS_ACCESS_DENIED', 403, 'OPERATION_DENIED');
    const binding = await client.beginVersion(
      item.documentId,
      item.expectedRevision,
      body,
      key,
      actor,
    );
    if (binding.session.documentId !== item.documentId)
      throw new DmsClientError('DMS_INVALID_RESPONSE');
    return { binding };
  }
  if (command.kind === 'version.reprocess') {
    const { documentId, versionId, payload } = command;
    const { operationId, run, replayUntil } = await client.reprocess(
      documentId,
      versionId,
      payload,
      key,
      actor,
    );
    if (
      run.id !== operationId ||
      run.documentId !== documentId ||
      run.versionId !== versionId ||
      run.profile !== payload.profile
    )
      throw new DmsClientError('DMS_INVALID_RESPONSE');
    return { binding: null, processing: { runId: run.id, replayUntil } };
  }
  if ('documentId' in command) {
    const current =
      mode === 'ordinary' ? await client.document(command.documentId, actor) : undefined;
    if (current) {
      if (current.id !== command.documentId) throw new DmsClientError('DMS_INVALID_RESPONSE');
      if (current.applicationId !== applicationId)
        throw new DmsClientError('DMS_ACCESS_DENIED', 403, 'OPERATION_DENIED');
    }
    if (isRevisionChange(command)) {
      // Compare the authorized current outcome. Never resend a revision-only
      // request after a lost reply, even when the old revision still matches.
      if (recovering)
        return current && hasDesiredState(command, current, applicationId)
          ? { binding: null }
          : undefined;
      const saved = await revisionMutation(client, command, actor);
      if (saved.id !== command.documentId || !hasDesiredState(command, saved, applicationId))
        throw new DmsClientError('DMS_INVALID_RESPONSE');
      return { binding: null };
    }
    const binding =
      command.kind === 'version.begin'
        ? await client.beginVersion(
            command.documentId,
            command.expectedRevision,
            attributed(command.payload, actor),
            key,
            actor,
          )
        : await client.restoreVersion(
            command.documentId,
            command.versionId,
            command.expectedRevision,
            command.payload,
            key,
            actor,
          );
    if (binding.session.documentId !== command.documentId)
      throw new DmsClientError('DMS_INVALID_RESPONSE');
    return { binding };
  }
  if (command.kind === 'upload.begin')
    return { binding: await client.beginUpload(attributed(command.payload, actor), key, actor) };
  let binding: Binding;
  if (command.kind === 'upload.complete')
    binding = await client.completeUpload(command.uploadId, key, actor);
  else if (!recovering)
    binding =
      command.kind === 'upload.cancel'
        ? await client.cancelUpload(command.uploadId, actor)
        : await client.refreshUpload(command.uploadId, actor);
  else {
    if (mode === 'contribute') return undefined;
    await options.authorizeRead();
    const session = await client.uploadStatus(command.uploadId, actor);
    if (command.kind !== 'upload.cancel' || session.upload !== 'CANCELLED') return undefined;
    binding = { session, transfer: null };
  }
  if (binding.session.id !== command.uploadId) throw new DmsClientError('DMS_INVALID_RESPONSE');
  return { binding };
}
