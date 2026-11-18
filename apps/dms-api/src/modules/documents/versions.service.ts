import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  restoreVersionSchema,
  uploadResponseSchema,
  versionPageSchema,
  versionSchema,
} from '@thaarei/dms-contracts/public';
import type { MachinePrincipal } from '../access/access-policy.js';
import { DmsDatabaseService } from '../access/dms-database/dms-database.service.js';
import { dmsError } from '../access/dms-errors.js';
import { requireDocumentRight, requireResourceOwner } from '../access/resource-policy.js';
import { appendDocumentAudit } from '../audit/document-audit.js';
import { parseAuthorityEnvironment } from '../platform-auth/authority-configuration.js';
import { StorageFailure } from '../storage/s3-storage.js';
import { StorageService } from '../storage/storage.service.js';
import { AdmissionService } from '../uploads/admission.service.js';
import { lockSession, projectSession } from '../uploads/upload-state.js';
import { AVAILABLE_ORIGINAL } from './download-policy.js';

const VERSION_SELECT = `SELECT v.*,a.id AS upload_id,s.upload_state,d.current_version_id,c.state AS security,c.sha256,
 EXISTS(${AVAILABLE_ORIGINAL} AND v.id=outer_v.id) AS downloadable,source.version_id AS restored_from
 FROM dms.document_version outer_v JOIN dms.document_version v ON v.id=outer_v.id
 JOIN dms.document d ON d.id=v.document_id LEFT JOIN dms.upload_admission a ON a.version_id=v.id
 LEFT JOIN dms.upload_session s ON s.id=a.id LEFT JOIN dms.security_candidate c ON c.upload_id=a.id LEFT JOIN dms.binary_restore r ON r.id=a.id
 LEFT JOIN dms.security_candidate sc ON sc.id=r.source_candidate_id LEFT JOIN dms.upload_admission source ON source.id=sc.upload_id`;
const present = (row: Record<string, unknown>) =>
  versionSchema.parse({
    id: row.id,
    uploadId: row.upload_id ?? null,
    upload: row.upload_state ?? null,
    documentId: row.document_id,
    number: row.number,
    fileName: row.file_name,
    contentType: row.content_type,
    size: Number(row.size),
    sha256: row.sha256 ?? null,
    availability: row.availability === 'PENDING' ? 'CANDIDATE' : row.availability,
    security: !row.security || row.security === 'COPYING' ? 'PENDING' : row.security,
    isCurrent: row.id === row.current_version_id,
    downloadable: row.downloadable,
    restoredFromVersionId: row.restored_from ?? null,
    createdAt: (row.created_at as Date).toISOString(),
  });
@Injectable()
export class VersionsService {
  constructor(
    private readonly database: DmsDatabaseService,
    private readonly admission: AdmissionService,
    private readonly storage: StorageService,
  ) {}
  read(
    principal: MachinePrincipal,
    documentId: string,
    versionId?: string,
    options: { limit?: number; cursor?: string } = {},
  ) {
    return this.database.withMachine(principal, ['dms:documents:read'], async (tx) => {
      await requireDocumentRight(tx, documentId, 'READ');
      const doc = (
        await tx.client.query("SELECT id FROM dms.document WHERE id=$1 AND lifecycle='ACTIVE'", [
          documentId,
        ])
      ).rows[0];
      if (!doc) return dmsError(404, 'DOCUMENT_NOT_FOUND');
      if (versionId) {
        const row = (
          await tx.client.query(`${VERSION_SELECT} WHERE v.document_id=$1 AND v.id=$2`, [
            doc.id,
            versionId,
          ])
        ).rows[0];
        if (!row) return dmsError(404, 'VERSION_NOT_FOUND');
        return present(row);
      }
      const binding = [
        tx.context.tenantId,
        tx.context.application.id,
        doc.id,
        'versions:number-desc',
      ];
      const secret = parseAuthorityEnvironment(process.env).AUTH_SECRET;
      const mac = (value: string) =>
        createHmac('sha256', secret).update('dms-version-page:').update(value).digest();
      let after: number | null = null;
      if (options.cursor) {
        try {
          const decoded = JSON.parse(Buffer.from(options.cursor, 'base64url').toString('utf8'));
          const signature = Buffer.from(decoded.signature, 'base64url'),
            expected = mac(JSON.stringify(decoded.data));
          if (
            signature.length !== expected.length ||
            !timingSafeEqual(signature, expected) ||
            JSON.stringify(decoded.data.slice(0, 4)) !== JSON.stringify(binding) ||
            decoded.data.length !== 5 ||
            !Number.isInteger(decoded.data[4]) ||
            decoded.data[4] < 1
          )
            throw new Error();
          after = decoded.data[4];
        } catch {
          return dmsError(400, 'INVALID_REQUEST');
        }
      }
      const limit = options.limit ?? 20;
      if (!Number.isInteger(limit) || limit < 1 || limit > 50)
        return dmsError(400, 'INVALID_REQUEST');
      const rows = (
        await tx.client.query(
          `${VERSION_SELECT} WHERE v.document_id=$1 AND ($2::integer IS NULL OR v.number<$2) ORDER BY v.number DESC LIMIT $3`,
          [doc.id, after, limit + 1],
        )
      ).rows;
      const page = rows.slice(0, limit),
        last = page.at(-1),
        data = last ? [...binding, last.number] : null;
      return versionPageSchema.parse({
        items: page.map(present),
        nextCursor:
          rows.length > limit && data
            ? Buffer.from(
                JSON.stringify({
                  data,
                  signature: mac(JSON.stringify(data)).toString('base64url'),
                }),
              ).toString('base64url')
            : null,
      });
    });
  }
  async restore(
    principal: MachinePrincipal,
    documentId: string,
    versionId: string,
    body: unknown,
    expectedRevision: string,
    key: string,
    requestId: string,
  ) {
    const input = restoreVersionSchema.safeParse(body);
    if (!input.success) return dmsError(400, 'INVALID_REQUEST');
    const source = await this.database.withMachine(
      principal,
      ['dms:documents:read', 'dms:documents:write'],
      async (tx) => {
        const doc = (await tx.client.query('SELECT * FROM dms.document WHERE id=$1', [documentId]))
          .rows[0];
        if (!doc) return dmsError(404, 'DOCUMENT_NOT_FOUND');
        requireResourceOwner(tx, {
          tenantId: doc.tenant_id,
          ownerApplicationId: doc.application_id,
        });
        if (doc.lifecycle !== 'ACTIVE') return dmsError(409, 'DOCUMENT_UNAVAILABLE');
        if (
          !(
            await tx.client.query(
              'SELECT id FROM dms.document_version WHERE document_id=$1 AND id=$2',
              [doc.id, versionId],
            )
          ).rowCount
        )
          return dmsError(404, 'VERSION_NOT_FOUND');
        const row = (
          await tx.client.query(
            `SELECT c.*,v.file_name,v.content_type FROM dms.document_version v JOIN dms.upload_admission a ON a.version_id=v.id JOIN dms.security_candidate c ON c.upload_id=a.id WHERE v.id=$1 AND v.document_id=$2 AND c.evidence->>'outcome'='PASSED' AND c.sha256 IS NOT NULL`,
            [versionId, doc.id],
          )
        ).rows[0];
        if (!row) return dmsError(409, 'DOCUMENT_UNAVAILABLE');
        return { doc, row };
      },
    );
    // Admission binds restore retries to the caller's revision/profile and immutable
    // source, not these mutable metadata values. Only the first allocation saves them.
    const descriptor = {
      documentId: source.doc.id,
      expectedRevision,
      title: source.doc.title,
      metadata: source.doc.metadata,
      fileName: source.row.file_name,
      contentType: source.row.content_type,
      size: Number(source.row.size),
      sha256: source.row.sha256,
      profile: input.data.profile,
    };
    const result = await this.admission.beginUpload(
      principal,
      descriptor,
      key,
      requestId,
      async (tx, receipt) => {
        // Allocation already holds usage -> document fence -> document row. No shared
        // bytes/reference can change beneath this HEAD or the persisted source generation.
        const current = (
          await tx.client.query('SELECT * FROM dms.security_candidate WHERE id=$1', [source.row.id])
        ).rows[0];
        if (!current) return dmsError(409, 'DOCUMENT_UNAVAILABLE');
        const head = await (async () => {
          try {
            return await this.storage.forRole('originalRead').head({
              area: 'originals',
              tenantId: tx.context.tenantId,
              applicationId: tx.context.application.id,
              id: current.object_id,
            });
          } catch (error) {
            if (error instanceof StorageFailure && error.code === 'not-found')
              return dmsError(409, 'DOCUMENT_UNAVAILABLE');
            throw error;
          }
        })();
        if (head.etag !== current.etag || head.size !== Number(current.size))
          return dmsError(409, 'DOCUMENT_UNAVAILABLE');
        await tx.client.query(
          `INSERT INTO dms.binary_restore (id,tenant_id,application_id,source_candidate_id,source_generation) VALUES ($1,$2,$3,$4,$5)`,
          [
            receipt.id,
            tx.context.tenantId,
            tx.context.application.id,
            current.id,
            current.invalidation_generation,
          ],
        );
        await tx.client.query(
          `INSERT INTO dms.upload_session (id,tenant_id,application_id,batch_application_id,staging_id,descriptor,upload_state,observed_etag,observed_size,observed_at,completion_requested_at) VALUES ($1,$2,$3,$3,$4,$5,'OBJECT_VERIFIED',$6,$7,clock_timestamp(),clock_timestamp())`,
          [
            receipt.id,
            tx.context.tenantId,
            tx.context.application.id,
            randomUUID(),
            descriptor,
            current.etag,
            current.size,
          ],
        );
        await appendDocumentAudit(tx, {
          documentId: source.doc.id,
          action: 'document.version-restored',
          requestId,
        });
        return uploadResponseSchema.parse({
          operationId: receipt.id,
          session: projectSession(await lockSession(tx, receipt.id, requestId)),
          transfer: null,
        });
      },
      {
        reuseSourceId: source.row.id,
        before: async () => {},
        replay: async (tx, receipt) =>
          uploadResponseSchema.parse({
            operationId: receipt.id,
            session: projectSession(await lockSession(tx, receipt.id, requestId)),
            transfer: null,
          }),
      },
    );
    if (!result.transient) throw new Error('Missing restore response');
    return { ...result.transient, replay: result.replay };
  }
}
