import { randomUUID } from 'node:crypto';
import { HttpException, Injectable } from '@nestjs/common';
import { DmsClientError } from '@thaarei/dms-client';
import {
  DOCUMENTS_LIMITS,
  type DocumentsOperationMode,
  type DocumentsUploadReceipt,
  type DocumentsWorkspaceCommand,
  documentsBatchItemSchema,
  documentsBatchManifestSchema,
  documentsDraftRequestSchema,
  documentsExecuteRequestSchema,
  documentsUploadExecutionSchema,
  documentsUploadReceiptSchema,
  documentsWorkspaceCommandSchema,
  isContributionKind,
} from '@thaarei/turnstile-contracts/documents';
import { peopleIdSchema } from '@thaarei/turnstile-contracts/runtime';
import type { PoolClient } from 'pg';
import type { ConfigurationActor } from '../../infrastructure/configuration-context.js';
import { covers } from '../access/access-evaluator.js';
import { commandDigest } from '../access/access-transactions.js';
import { markerDigest } from '../deployment/access.js';
import { DocumentsService } from './documents.service.js';
import {
  dispatchDocumentsCommand,
  forwardedBodyFits,
  needsTransferOrigin,
  operation,
  permissions,
  subjectKey,
  workspaceKinds,
} from './documents-command.js';

type Receipt = DocumentsUploadReceipt['receipt'];
type Intent = {
  id: string;
  actor_id: string;
  kind: DocumentsWorkspaceCommand['kind'];
  state: Receipt['state'];
  digest: string;
  command: unknown;
  upload_id: string | null;
  batch_id: string | null;
  mode: DocumentsOperationMode;
  document_id: string | null;
  version_id: string | null;
  run_id: string | null;
  created_at: Date;
  reconciliation_until: Date | null;
  lease_until: Date | null;
  recovery_marker: string;
};

// Run under the owning access lock. A supported restore rotates the external
// marker, retiring even restored drafts that might have dispatched after backup.
export async function maintainDocumentsIntents(db: PoolClient, tenant: string, marker: string) {
  await db.query(
    `UPDATE turnstile.documents_intent
       SET state='UNRESOLVED_REQUIRES_REVIEW', terminal_at=statement_timestamp(),
           attempt_id=NULL, lease_until=NULL
       WHERE tenant_id=$1 AND (
         (state IN ('DRAFT','DISPATCHING','UNCERTAIN') AND recovery_marker<>$2)
         OR (state IN ('DISPATCHING','UNCERTAIN') AND reconciliation_until<=statement_timestamp()
             AND (lease_until IS NULL OR lease_until<=statement_timestamp()))
       )`,
    [tenant, marker],
  );
  await db.query(
    `DELETE FROM turnstile.documents_intent WHERE tenant_id=$1 AND (
       (state='DRAFT' AND created_at<=statement_timestamp()-interval '1 day')
       OR (state IN ('RESOLVED','DISPOSED') AND resolved_at<=statement_timestamp()-interval '90 days')
     )`,
    [tenant],
  );
  await db.query(
    `UPDATE turnstile.documents_intent SET command=NULL WHERE tenant_id=$1 AND command IS NOT NULL
     AND terminal_at<=statement_timestamp()-interval '30 days'`,
    [tenant],
  );
}

function receipt(row: Intent) {
  const command = documentsWorkspaceCommandSchema.safeParse(row.command);
  const descriptor =
    command.success &&
    (command.data.kind === 'upload.begin' || command.data.kind === 'version.begin')
      ? command.data.payload
      : null;
  return documentsUploadReceiptSchema.parse({
    receipt: {
      id: row.id,
      digest: row.digest,
      kind: row.kind,
      state: row.state,
      acknowledgement:
        row.state === 'RESOLVED'
          ? row.mode === 'contribute' ||
            [
              'upload.complete',
              'version.restore',
              'document.restore',
              'version.reprocess',
            ].includes(row.kind)
            ? 'accepted'
            : 'confirmed'
          : 'none',
      visibility: 'local_receipt_only',
      createdAt: row.created_at.toISOString(),
      reconciliationUntil: row.reconciliation_until?.toISOString() ?? null,
    },
    uploadId: row.upload_id,
    ...(row.mode === 'contribute' ? { mode: row.mode } : {}),
    ...(row.document_id ? { documentId: row.document_id } : {}),
    ...(row.version_id ? { versionId: row.version_id } : {}),
    ...(row.run_id ? { runId: row.run_id } : {}),
    ...(row.kind.startsWith('batch.') ? { batchId: row.batch_id } : {}),
    ...(command.success && command.data.kind === 'batch.item'
      ? { itemId: command.data.itemId }
      : {}),
    file: descriptor
      ? { fileName: descriptor.fileName, size: descriptor.size, sha256: descriptor.sha256 }
      : null,
  });
}
@Injectable()
export class DocumentsIntentsService {
  constructor(private readonly documents: DocumentsService) {}

  async batchManifest(actor: ConfigurationActor, input: string) {
    const id = peopleIdSchema.safeParse(input);
    if (!id.success) return this.documents.fail(actor, 400, 'DOCUMENTS_INVALID');
    return this.documents.transaction(
      actor,
      permissions('batch.create'),
      'read',
      async (db, tenant) => {
        const row = (
          await db.query(
            `SELECT command FROM turnstile.documents_intent
         WHERE tenant_id=$1 AND actor_id=$2 AND batch_id=$3 AND kind='batch.create' AND state='RESOLVED'`,
            [tenant, actor.userId, id.data],
          )
        ).rows[0];
        const saved = documentsWorkspaceCommandSchema.safeParse(row?.command);
        if (!saved.success || saved.data.kind !== 'batch.create')
          return this.documents.fail(actor, 404, 'DOCUMENTS_NOT_FOUND');
        return documentsBatchManifestSchema.parse({
          id: id.data,
          items: saved.data.payload.items.map((item) => ({
            itemId: item.itemId,
            operation: item.operation,
            fileName: item.descriptor.fileName,
            size: item.descriptor.size,
            sha256: item.descriptor.sha256,
          })),
        });
      },
    );
  }

  async draft(actor: ConfigurationActor, input: unknown) {
    const draft = documentsDraftRequestSchema.safeParse(input);
    if (!draft.success) return this.documents.fail(actor, 400, 'DOCUMENTS_INVALID');
    const parsed = documentsWorkspaceCommandSchema.safeParse(draft.data.command);
    if (!parsed.success) return this.documents.fail(actor, 400, 'DOCUMENTS_INVALID');
    const command = parsed.data;
    const { mode } = draft.data;
    if (!forwardedBodyFits(command, actor))
      return this.documents.fail(actor, 413, 'DOCUMENTS_TOO_LARGE');
    const marker = await markerDigest();
    const required = permissions(command.kind, mode);
    await this.documents.authorize(actor, required, 'full');
    if (needsTransferOrigin(command.kind)) this.documents.requireTransferOrigin(actor);
    await this.documents.boundClient(actor, 'full', operation(command.kind));
    const digest = commandDigest(mode === 'ordinary' ? command : { mode, command });
    return this.documents.transaction(actor, required, 'full', async (db, tenant) => {
      await maintainDocumentsIntents(db, tenant, marker);
      if ('uploadId' in command) {
        const found = await db.query(
          `SELECT 1 FROM turnstile.documents_intent
           WHERE tenant_id=$1 AND actor_id=$2 AND kind IN ('upload.begin','version.begin','batch.item')
             AND state='RESOLVED' AND upload_id=$3 AND mode=$4`,
          [tenant, actor.userId, command.uploadId, mode],
        );
        if (!found.rowCount) return this.documents.fail(actor, 404, 'DOCUMENTS_NOT_FOUND');
      }
      if ('batchId' in command) {
        const found = await db.query(
          `SELECT 1 FROM turnstile.documents_intent
           WHERE tenant_id=$1 AND actor_id=$2 AND batch_id=$3 AND kind='batch.create' AND state='RESOLVED'
           AND ($4::text IS NULL OR EXISTS (SELECT 1 FROM jsonb_array_elements(command->'payload'->'items') item
                                           WHERE item->>'itemId'=$4))`,
          [
            tenant,
            actor.userId,
            command.batchId,
            command.kind === 'batch.item' ? command.itemId : null,
          ],
        );
        if (!found.rowCount) return this.documents.fail(actor, 404, 'DOCUMENTS_NOT_FOUND');
      }
      const prior = (
        await db.query<Intent>(
          `SELECT * FROM turnstile.documents_intent WHERE tenant_id=$1 AND kind=$2 AND subject_key=$3
             AND (state IN ('DRAFT','DISPATCHING','UNCERTAIN','UNRESOLVED_REQUIRES_REVIEW')
               OR ($2='batch.item' AND state='RESOLVED'))
           ORDER BY created_at DESC LIMIT 1`,
          [tenant, command.kind, subjectKey(command)],
        )
      ).rows[0];
      if (prior) {
        if (
          prior.actor_id !== actor.userId ||
          prior.mode !== mode ||
          prior.digest !== digest ||
          prior.state === 'UNRESOLVED_REQUIRES_REVIEW'
        )
          return this.documents.fail(actor, 409, 'DOCUMENTS_CONFLICT', 'manual_review');
        return receipt(prior);
      }
      const capacity = (
        await db.query(
          `SELECT count(*)<1000 AS available FROM turnstile.documents_intent WHERE tenant_id=$1 AND state='DRAFT'`,
          [tenant],
        )
      ).rows[0]?.available;
      if (!capacity) return this.documents.fail(actor, 429, 'DOCUMENTS_CAPACITY');
      const inserted = (
        await db.query<Intent>(
          `INSERT INTO turnstile.documents_intent (tenant_id,id,actor_id,recovery_marker,kind,digest,subject_key,command,upload_id,batch_id,mode,document_id,version_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
          [
            tenant,
            randomUUID(),
            actor.userId,
            marker,
            command.kind,
            digest,
            subjectKey(command),
            command,
            'uploadId' in command ? command.uploadId : null,
            'batchId' in command ? command.batchId : null,
            mode,
            command.kind === 'document.delete' ||
            command.kind === 'document.restore' ||
            command.kind === 'version.reprocess'
              ? command.documentId
              : null,
            command.kind === 'version.reprocess' ? command.versionId : null,
          ],
        )
      ).rows[0];
      return receipt(inserted ?? this.documents.fail(actor, 503, 'DOCUMENTS_UNAVAILABLE'));
    });
  }

  async history(
    actor: ConfigurationActor,
    id?: string,
    filter: {
      group?: 'batches' | 'contributions' | 'lifecycle';
      batchId?: string;
      processing?: { documentId: string; versionId: string };
    } = {},
  ) {
    if (id && !peopleIdSchema.safeParse(id).success)
      return this.documents.fail(actor, 400, 'DOCUMENTS_INVALID');
    const batch = filter.batchId ? peopleIdSchema.safeParse(filter.batchId) : undefined;
    if (batch && !batch.success) return this.documents.fail(actor, 400, 'DOCUMENTS_INVALID');
    const processing = filter.processing;
    if (
      processing &&
      (!peopleIdSchema.safeParse(processing.documentId).success ||
        !peopleIdSchema.safeParse(processing.versionId).success)
    )
      return this.documents.fail(actor, 400, 'DOCUMENTS_INVALID');
    const marker = await markerDigest();
    const result = await this.documents.transaction(
      actor,
      filter.group === 'contributions'
        ? 'turnstile:documents:validate'
        : filter.group === 'lifecycle'
          ? 'turnstile:documents:lifecycle'
          : processing
            ? permissions('version.reprocess')
            : undefined,
      'read',
      async (db, tenant, access) => {
        const matches = (kind: (typeof workspaceKinds)[number]) => {
          if (id) return true;
          if (filter.group === 'contributions') return false;
          if (filter.group === 'lifecycle')
            return kind === 'document.delete' || kind === 'document.restore';
          if (filter.group === 'batches') return kind === 'batch.create';
          if (batch) return kind.startsWith('batch.');
          if (processing) return kind === 'version.reprocess';
          return (
            !kind.startsWith('batch.') &&
            ![
              'document.delete',
              'document.restore',
              'permissions.replace',
              'version.reprocess',
            ].includes(kind)
          );
        };
        const allows = (kind: (typeof workspaceKinds)[number], mode: DocumentsOperationMode) =>
          permissions(kind, mode).every((permission) =>
            covers(access, permission, { kind: 'company' }),
          );
        const ordinary = workspaceKinds.filter((kind) => matches(kind) && allows(kind, 'ordinary'));
        const contributions =
          id || filter.group === 'contributions'
            ? workspaceKinds.filter(
                (kind) => isContributionKind(kind) && allows(kind, 'contribute'),
              )
            : [];
        await maintainDocumentsIntents(db, tenant, marker);
        return (
          await db.query<Intent>(
            `SELECT * FROM turnstile.documents_intent WHERE tenant_id=$1 AND actor_id=$2
           AND ($3::uuid IS NULL OR id=$3) AND ($5::uuid IS NULL OR batch_id=$5)
           AND ($7::uuid IS NULL OR (document_id=$7 AND version_id=$8))
           AND ((mode='ordinary' AND kind=ANY($4::text[])) OR (mode='contribute' AND kind=ANY($6::text[])))
           ORDER BY created_at DESC,id DESC LIMIT 100`,
            [
              tenant,
              actor.userId,
              id ?? null,
              ordinary,
              batch?.data ?? null,
              contributions,
              processing?.documentId ?? null,
              processing?.versionId ?? null,
            ],
          )
        ).rows.map(receipt);
      },
    );
    if (id) return result[0] ?? this.documents.fail(actor, 410, 'DOCUMENTS_INTENT_GONE');
    return result;
  }

  async execute(actor: ConfigurationActor, inputId: string, input: unknown) {
    const parsed = documentsExecuteRequestSchema.safeParse(input);
    const parsedId = peopleIdSchema.safeParse(inputId);
    if (!parsed.success || !parsedId.success)
      return this.documents.fail(actor, 400, 'DOCUMENTS_INVALID');
    const id = parsedId.data;
    const marker = await markerDigest();
    const existing = await this.history(actor, id);
    if (Array.isArray(existing)) return this.documents.fail(actor, 410, 'DOCUMENTS_INTENT_GONE');
    if (
      existing.receipt.state === 'UNRESOLVED_REQUIRES_REVIEW' ||
      existing.receipt.state === 'DISPOSED'
    )
      return this.documents.fail(actor, 410, 'DOCUMENTS_INTENT_GONE', 'manual_review');
    if (existing.receipt.digest !== parsed.data.digest)
      return this.documents.fail(actor, 409, 'DOCUMENTS_CONFLICT');
    const kind = workspaceKinds.find((item) => item === existing.receipt.kind);
    if (!kind) return this.documents.fail(actor, 410, 'DOCUMENTS_INTENT_GONE');
    const mode = existing.mode ?? 'ordinary';
    const required = permissions(kind, mode);
    await this.documents.authorize(actor, required, 'full');
    if (needsTransferOrigin(kind) && existing.receipt.state !== 'RESOLVED')
      this.documents.requireTransferOrigin(actor);
    const bound = await this.documents.boundClient(actor, 'full', operation(kind));
    const attempt = randomUUID();
    const claim = await this.documents.transaction(actor, required, 'full', async (db, tenant) => {
      await maintainDocumentsIntents(db, tenant, marker);
      const row = (
        await db.query<Intent>(
          'SELECT * FROM turnstile.documents_intent WHERE tenant_id=$1 AND id=$2 AND actor_id=$3',
          [tenant, id, actor.userId],
        )
      ).rows[0];
      if (!row || row.state === 'DISPOSED') return { blocked: 'gone' } as const;
      if (row.digest !== parsed.data.digest || row.mode !== mode)
        return { blocked: 'conflict' } as const;
      if (row.state === 'UNRESOLVED_REQUIRES_REVIEW') return { blocked: 'review' } as const;
      if (row.state === 'RESOLVED') return { row, resolved: true } as const;
      const now = (await db.query<{ now: Date }>('SELECT clock_timestamp() AS now')).rows[0]?.now;
      if (!now) return this.documents.fail(actor, 503, 'DOCUMENTS_UNAVAILABLE');
      if (row.lease_until && row.lease_until > now) return { blocked: 'busy' } as const;
      if (row.state === 'DRAFT') {
        const capacity = (
          await db.query(
            `SELECT count(*)<$2 AS available FROM turnstile.documents_intent
           WHERE tenant_id=$1 AND state IN ('DISPATCHING','UNCERTAIN','UNRESOLVED_REQUIRES_REVIEW')`,
            [tenant, DOCUMENTS_LIMITS.unreconciledOperations],
          )
        ).rows[0]?.available;
        if (!capacity) return { blocked: 'capacity' } as const;
      }
      const command = documentsWorkspaceCommandSchema.parse(row.command);
      const item =
        command.kind === 'batch.item'
          ? documentsBatchItemSchema.safeParse(
              (
                await db.query(
                  `SELECT item FROM turnstile.documents_intent i,
             LATERAL jsonb_array_elements(i.command->'payload'->'items') item
           WHERE i.tenant_id=$1 AND i.actor_id=$2 AND i.batch_id=$3
             AND i.kind='batch.create' AND i.state='RESOLVED' AND item->>'itemId'=$4`,
                  [tenant, actor.userId, command.batchId, command.itemId],
                )
              ).rows[0]?.item,
            )
          : undefined;
      if (item && !item.success) return { blocked: 'gone' } as const;
      const claimed = (
        await db.query<Intent>(
          `UPDATE turnstile.documents_intent
          SET state='DISPATCHING', attempt_id=$3, lease_until=statement_timestamp()+interval '15 seconds',
              reconciliation_until=coalesce(reconciliation_until,statement_timestamp()+make_interval(secs=>$4))
         WHERE tenant_id=$1 AND id=$2 RETURNING *`,
          [tenant, id, attempt, DOCUMENTS_LIMITS.reconciliationSeconds],
        )
      ).rows[0];
      if (!claimed) return this.documents.fail(actor, 503, 'DOCUMENTS_UNAVAILABLE');
      return {
        row: claimed,
        command,
        item: item?.data,
        recovering: row.state !== 'DRAFT',
      } as const;
    });
    if (claim.blocked === 'gone') return this.documents.fail(actor, 410, 'DOCUMENTS_INTENT_GONE');
    if (claim.blocked === 'review')
      return this.documents.fail(actor, 410, 'DOCUMENTS_INTENT_GONE', 'manual_review');
    if (claim.blocked === 'conflict') return this.documents.fail(actor, 409, 'DOCUMENTS_CONFLICT');
    if (claim.blocked === 'busy')
      return this.documents.fail(actor, 409, 'DOCUMENTS_CONFLICT', 'retry_same_intent');
    if (claim.blocked === 'capacity') return this.documents.fail(actor, 429, 'DOCUMENTS_CAPACITY');
    if (claim.resolved)
      return documentsUploadExecutionSchema.parse({ ...receipt(claim.row), transfer: null });

    const { command, recovering, row } = claim;
    let outcome: Awaited<ReturnType<typeof dispatchDocumentsCommand>>;
    try {
      const scoped = {
        ...actor,
        deadlineAt: Math.min(
          actor.deadlineAt ?? Infinity,
          row.reconciliation_until?.getTime() ?? 0,
        ),
      };
      outcome = await dispatchDocumentsCommand({
        client: bound.client,
        applicationId: bound.capabilities.applicationId,
        actor: scoped,
        command,
        key: id,
        recovering,
        mode,
        ...(claim.item ? { item: claim.item } : {}),
        authorizeVersion: async () => {
          await this.documents.authorize(scoped, 'turnstile:documents:read', 'full');
          if (!bound.capabilities.operations.includes('versions:write'))
            this.documents.fail(scoped, 403, 'DOCUMENTS_DENIED');
        },
        authorizeRead: () => this.documents.authorize(scoped, 'turnstile:documents:read'),
      });
    } catch (error) {
      if (
        !recovering &&
        kind === 'version.reprocess' &&
        error instanceof DmsClientError &&
        (error.domainCode === 'PROFILE_UNAVAILABLE' ||
          error.domainCode === 'PROCESSING_IN_PROGRESS')
      ) {
        await this.finish(actor, id, attempt, 'DISPOSED');
        return this.documents.fail(
          actor,
          409,
          error.domainCode === 'PROFILE_UNAVAILABLE'
            ? 'DOCUMENTS_PROFILE_UNAVAILABLE'
            : 'DOCUMENTS_PROCESSING_ACTIVE',
        );
      }
      if (
        !recovering &&
        error instanceof DmsClientError &&
        error.domainCode === 'RESTORE_WINDOW_EXPIRED'
      ) {
        await this.finish(actor, id, attempt, 'DISPOSED');
        return this.documents.fail(actor, 410, 'DOCUMENTS_RESTORE_EXPIRED');
      }
      const stale =
        !recovering &&
        error instanceof DmsClientError &&
        (error.domainCode === 'REVISION_CONFLICT' || error.domainCode === 'BATCH_CLOSED');
      if (stale) {
        await this.finish(actor, id, attempt, 'DISPOSED');
        return this.documents.fail(actor, 409, 'DOCUMENTS_CONFLICT');
      }
      const gone = error instanceof DmsClientError && error.status === 410;
      const rejected =
        !recovering &&
        error instanceof DmsClientError &&
        error.domainCode &&
        ([400, 401, 403, 404, 409, 429].includes(error.status ?? 0) ||
          error.domainCode === 'CAPACITY_UNAVAILABLE');
      // Release the subject after a proven refusal so a corrected review can proceed.
      const refused =
        (mode === 'contribute' ||
          kind === 'version.reprocess' ||
          ['permissions.replace', 'document.delete', 'document.restore'].includes(kind)) &&
        rejected &&
        error instanceof DmsClientError &&
        [400, 403, 404].includes(error.status ?? 0) &&
        error.domainCode !== 'DEPLOYMENT_RESTRICTED';
      await this.finish(
        actor,
        id,
        attempt,
        gone
          ? 'UNRESOLVED_REQUIRES_REVIEW'
          : refused
            ? 'DISPOSED'
            : rejected
              ? 'DRAFT'
              : 'UNCERTAIN',
      );
      if (gone) return this.documents.fail(actor, 410, 'DOCUMENTS_INTENT_GONE', 'manual_review');
      if (error instanceof HttpException) throw error;
      if (error instanceof DmsClientError && error.domainCode === 'DEPLOYMENT_RESTRICTED')
        return this.documents.fail(actor, 403, 'DEPLOYMENT_RESTRICTED');
      if (error instanceof DmsClientError) {
        if (error.status === 400) return this.documents.fail(actor, 400, 'DOCUMENTS_INVALID');
        if (error.status === 403) return this.documents.fail(actor, 403, 'DOCUMENTS_DENIED');
        if (error.status === 404) return this.documents.fail(actor, 404, 'DOCUMENTS_NOT_FOUND');
        if (error.status === 429) return this.documents.fail(actor, 429, 'DOCUMENTS_CAPACITY');
        if (error.status === 409 || error.status === 412)
          return this.documents.fail(actor, 409, 'DOCUMENTS_CONFLICT');
      }
      return this.documents.fail(actor, 503, 'DOCUMENTS_UNAVAILABLE', 'retry_same_intent');
    }
    if (!outcome) {
      await this.finish(actor, id, attempt, 'UNRESOLVED_REQUIRES_REVIEW');
      return this.documents.fail(actor, 410, 'DOCUMENTS_INTENT_GONE', 'manual_review');
    }
    const saved = await this.finish(
      actor,
      id,
      attempt,
      'RESOLVED',
      outcome.binding?.session.id,
      outcome.binding?.session.replayUntil ?? outcome.processing?.replayUntil,
      outcome.batchId,
      outcome.processing?.runId,
    );
    // Commit the binding before checking current authority for transient output.
    await this.documents.authorize(actor, required, 'full');
    return documentsUploadExecutionSchema.parse({
      ...receipt(saved),
      transfer: outcome.binding?.transfer
        ? {
            ...outcome.binding.transfer,
            url: this.documents.transferUrl(outcome.binding.transfer.url, actor),
          }
        : null,
    });
  }

  private async finish(
    actor: ConfigurationActor,
    id: string,
    attempt: string,
    state: 'DRAFT' | 'RESOLVED' | 'DISPOSED' | 'UNCERTAIN' | 'UNRESOLVED_REQUIRES_REVIEW',
    uploadId?: string,
    replayUntil?: string,
    batchId?: string,
    runId?: string,
  ) {
    // An in-flight mutation may finish after local access changes. The attempt
    // token allows settling its binding, while no response can bypass reauthorization.
    const row = await this.documents.settle(
      actor,
      async (db, tenant) =>
        (
          await db.query<Intent>(
            `UPDATE turnstile.documents_intent SET state=$4, attempt_id=NULL, lease_until=NULL,
        terminal_at=CASE WHEN $4 IN ('DRAFT','UNCERTAIN') THEN NULL ELSE statement_timestamp() END,
        resolved_at=CASE WHEN $4 IN ('RESOLVED','DISPOSED') THEN statement_timestamp() ELSE NULL END,
        upload_id=coalesce($5,upload_id), batch_id=coalesce($9,batch_id), run_id=coalesce($10,run_id),
        reconciliation_until=CASE WHEN $4='DRAFT' THEN NULL WHEN $6::timestamptz IS NULL THEN reconciliation_until
          ELSE least(reconciliation_until,$6::timestamptz-make_interval(secs=>$7)) END
       WHERE tenant_id=$1 AND id=$2 AND attempt_id=$3 AND state='DISPATCHING'
         AND recovery_marker=$8 RETURNING *`,
            [
              tenant,
              id,
              attempt,
              state,
              uploadId ?? null,
              replayUntil ?? null,
              DOCUMENTS_LIMITS.replaySafetySeconds,
              await markerDigest(),
              batchId ?? null,
              runId ?? null,
            ],
          )
        ).rows[0],
    );
    return row ?? this.documents.fail(actor, 503, 'DOCUMENTS_UNAVAILABLE', 'retry_same_intent');
  }
}
