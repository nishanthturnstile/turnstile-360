import { Injectable } from '@nestjs/common';
import { downloadCapabilitySchema } from '@thaarei/dms-contracts/public';
import type { MachinePrincipal } from '../access/access-policy.js';
import { DmsDatabaseService } from '../access/dms-database/dms-database.service.js';
import { dmsError } from '../access/dms-errors.js';
import { requireDocumentRight } from '../access/resource-policy.js';
import { appendDocumentAudit } from '../audit/document-audit.js';
import { StorageService } from '../storage/storage.service.js';
import { AVAILABLE_ORIGINAL, CURRENT_ORIGINAL, lockOriginal } from './download-policy.js';
@Injectable()
export class DownloadService {
  constructor(
    private readonly database: DmsDatabaseService,
    private readonly storage: StorageService,
  ) {}
  issue(principal: MachinePrincipal, documentId: string, requestId: string, versionId?: string) {
    return this.database.withMachine(principal, ['dms:documents:read'], async (tx) => {
      await lockOriginal(tx.client, tx.context.tenantId, documentId);
      const doc = (await tx.client.query('SELECT * FROM dms.document WHERE id=$1', [documentId]))
        .rows[0];
      if (!doc) return dmsError(404, 'DOCUMENT_NOT_FOUND');
      await requireDocumentRight(tx, doc.id, 'READ');
      if (
        versionId &&
        !(
          await tx.client.query(
            'SELECT id FROM dms.document_version WHERE document_id=$1 AND id=$2',
            [doc.id, versionId],
          )
        ).rowCount
      )
        return dmsError(404, 'VERSION_NOT_FOUND');
      const original = (
        await tx.client.query(
          `SELECT original.* FROM dms.document d CROSS JOIN LATERAL (${versionId ? `${AVAILABLE_ORIGINAL} AND v.id=$2` : CURRENT_ORIGINAL}) original WHERE d.id=$1`,
          versionId ? [doc.id, versionId] : [doc.id],
        )
      ).rows[0];
      if (!original) return dmsError(409, 'DOCUMENT_UNAVAILABLE');
      const cap = await this.storage.forRole('originalRead').downloadOriginal(
        {
          area: 'originals',
          tenantId: tx.context.tenantId,
          applicationId: doc.application_id,
          id: original.object_id,
        },
        original.file_name,
      );
      await appendDocumentAudit(tx, {
        documentId: doc.id,
        action: 'document.download-authorized',
        requestId,
      });
      return downloadCapabilitySchema.parse({
        documentId: doc.id,
        versionId: original.version_id,
        ...cap,
        size: Number(original.size),
        sha256: original.sha256,
      });
    });
  }
}
