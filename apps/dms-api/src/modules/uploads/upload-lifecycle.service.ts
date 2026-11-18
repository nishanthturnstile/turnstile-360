import { randomUUID } from 'node:crypto';
import { HttpException, Injectable } from '@nestjs/common';
import {
  type UploadAdmissionRequest,
  uploadAdmissionRequestSchema,
  uploadResponseSchema,
} from '@thaarei/dms-contracts/public';
import type { MachinePrincipal } from '../access/access-policy.js';
import { DmsDatabaseService } from '../access/dms-database/dms-database.service.js';
import { dmsError } from '../access/dms-errors.js';
import { requireDocumentRight, requireUploadControl } from '../access/resource-policy.js';
import { appendDocumentAudit } from '../audit/document-audit.js';
import { StorageService } from '../storage/storage.service.js';
import { AdmissionService } from './admission.service.js';
import { AdmissionFeatures, readAdmissionPolicy } from './admission-policy.js';
import { BatchesService } from './batches.service.js';
import {
  cancelSession,
  expireSession,
  lockSession,
  type MachineTx,
  operationReceipt,
  projectSession,
  SESSION_SELECT,
  type SessionRow,
} from './upload-state.js';

@Injectable()
export class UploadLifecycleService {
  constructor(
    private readonly database: DmsDatabaseService,
    private readonly admission: AdmissionService,
    private readonly batches: BatchesService,
    private readonly storage: StorageService,
    private readonly features: AdmissionFeatures,
  ) {}
  async begin(
    principal: MachinePrincipal,
    body: unknown,
    key: string,
    requestId: string,
    version = false,
  ) {
    const request = uploadAdmissionRequestSchema.safeParse(body);
    if (!request.success) return dmsError(400, 'INVALID_REQUEST');
    if (request.data.documentId && !version) return dmsError(403, 'OPERATION_DENIED');
    const input = request.data;
    try {
      const result = await this.admission.beginUpload(
        principal,
        body,
        key,
        requestId,
        async (tx, receipt) => {
          await tx.client.query(
            `INSERT INTO dms.upload_session (id,tenant_id,application_id,batch_application_id,staging_id,descriptor,batch_id,item_id) VALUES ($1,$2,$3,$8,$4,$5,$6,$7)`,
            [
              receipt.id,
              tx.context.tenantId,
              receipt.application_id,
              randomUUID(),
              input,
              input.batchId ?? null,
              input.itemId ?? null,
              tx.context.application.id,
            ],
          );
          await this.batches.bind(tx, input, receipt.id);
          return this.withTransfer(tx, await lockSession(tx, receipt.id, requestId), requestId);
        },
        {
          before: (tx) => this.batches.beforeAdmission(tx, input, key),
          replay: async (tx, receipt) =>
            this.withTransfer(tx, await lockSession(tx, receipt.id, requestId), requestId),
        },
      );
      if (!result.transient) throw new Error('Missing upload response');
      return { ...result.transient, replay: result.replay };
    } catch (error) {
      if (error instanceof HttpException) {
        const response = error.getResponse();
        const code =
          typeof response === 'object' && 'code' in response ? String(response.code) : '';
        // Separate, reauthorized diagnostic write cannot roll back another item's success.
        await this.batches.admissionFailed(principal, input, code).catch(() => {});
      }
      throw error;
    }
  }
  status(principal: MachinePrincipal, id: string, _requestId: string) {
    return this.database.withMachine(principal, ['dms:documents:read'], async (tx) => {
      const row = (await tx.client.query<SessionRow>(`${SESSION_SELECT} WHERE s.id=$1`, [id]))
        .rows[0];
      if (!row) return dmsError(404, 'UPLOAD_NOT_FOUND');
      await requireDocumentRight(tx, row.document_id, 'READ');
      return projectSession(
        row.application_id === tx.context.application.id
          ? await lockSession(tx, id, _requestId)
          : row,
      );
    });
  }
  refresh(principal: MachinePrincipal, id: string, requestId: string) {
    return this.database.withMachine(principal, ['dms:documents:write'], async (tx) => {
      await requireUploadControl(tx, id);
      // Match begin's batch -> policy -> session ordering before locking accounting.
      const row = await lockSession(tx, id, requestId, () => readAdmissionPolicy(tx.client, true));
      return this.withTransfer(tx, row, requestId);
    });
  }
  complete(principal: MachinePrincipal, id: string, key: string, requestId: string) {
    return this.database.withMachine(principal, ['dms:documents:write'], async (tx) => {
      await requireUploadControl(tx, id);
      const receipt = await operationReceipt(tx, 'upload.complete', key, {}, { uploadId: id });
      const row = await lockSession(tx, id, requestId);
      if (
        ['INITIATED', 'OBJECT_VERIFIED'].includes(row.upload_state) &&
        !row.completion_requested_at
      ) {
        await tx.client.query(
          'UPDATE dms.upload_session SET completion_requested_at=clock_timestamp() WHERE id=$1',
          [id],
        );
        row.completion_requested_at = new Date();
        await appendDocumentAudit(tx, {
          documentId: row.document_id,
          action: 'upload.completion-requested',
          requestId,
          assertedHuman: row.descriptor.assertedHuman,
        });
      }
      await receipt.save?.({ uploadId: id });
      return uploadResponseSchema.parse({
        operationId: receipt.id,
        session: projectSession(row),
        transfer: null,
      });
    });
  }
  cancel(principal: MachinePrincipal, id: string, requestId: string) {
    return this.database.withMachine(principal, ['dms:documents:write'], async (tx) => {
      await requireUploadControl(tx, id);
      const row = await cancelSession(tx, await lockSession(tx, id, requestId), requestId);
      return uploadResponseSchema.parse({
        operationId: id,
        session: projectSession(row),
        transfer: null,
      });
    });
  }
  private async withTransfer(tx: MachineTx, row: SessionRow, requestId: string) {
    await expireSession(tx, row, requestId);
    let transfer = null;
    // Serialize issuance/max-expiry with coordinator accounting settlement/release.
    const reservation = (
      await tx.client.query(
        'SELECT state,storage_mode FROM dms.upload_admission WHERE id=$1 FOR UPDATE',
        [row.id],
      )
    ).rows[0];
    if (
      row.upload_state === 'INITIATED' &&
      reservation?.state === 'RESERVED' &&
      reservation.storage_mode === 'UPLOAD' &&
      !row.completion_requested_at
    ) {
      const policy = await readAdmissionPolicy(tx.client, true);
      const request: UploadAdmissionRequest = row.descriptor;
      if (
        !policy?.settings.enabled ||
        !policy.settings.profiles.includes(request.profile) ||
        !policy.settings.contentTypes.includes(request.contentType) ||
        request.size > policy.settings.maxFileBytes
      )
        return dmsError(403, 'POLICY_DENIED');
      if (!this.features.supports(request.contentType, request.profile))
        return dmsError(503, 'CAPACITY_UNAVAILABLE');
      transfer = await this.storage.forRole('upload').upload(
        {
          area: 'staging',
          tenantId: tx.context.tenantId,
          applicationId: row.application_id,
          id: row.staging_id,
        },
        request.size,
        request.contentType,
        900,
        row.expires_at,
      );
      await tx.client.query(
        'UPDATE dms.upload_admission SET capability_expires_at=greatest(capability_expires_at,$1::timestamptz) WHERE id=$2',
        [transfer.expiresAt, row.id],
      );
      await appendDocumentAudit(tx, {
        documentId: row.document_id,
        action: 'upload.authorized',
        requestId,
        assertedHuman: request.assertedHuman,
      });
    }
    return uploadResponseSchema.parse({
      operationId: row.id,
      session: projectSession(row),
      transfer,
    });
  }
}
