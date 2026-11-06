import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import {
  type DocumentResponse,
  documentEditSchema,
  documentListQuerySchema,
  documentPageSchema,
  documentReferenceInputSchema,
  documentResponseSchema,
} from '@thaarei/dms-contracts/public';
import type { MachinePrincipal } from '../access/access-policy.js';
import { DmsDatabaseService } from '../access/dms-database/dms-database.service.js';
import { dmsError } from '../access/dms-errors.js';
import type { DmsTransaction } from '../access/resource-policy.js';
import { requireDocumentRight } from '../access/resource-policy.js';
import { appendDocumentAudit } from '../audit/document-audit.js';
import { parseAuthorityEnvironment } from '../platform-auth/authority-configuration.js';
import {
  AdmissionFeatures,
  policyProjection,
  readAdmissionPolicy,
} from '../uploads/admission-policy.js';
import { CURRENT_ORIGINAL, lockOriginal } from './download-policy.js';

function present(row: Record<string, unknown>): DocumentResponse {
  return documentResponseSchema.parse({
    id: row.id,
    applicationId: row.application_id,
    title: row.title,
    fileName: row.file_name,
    lifecycle: row.lifecycle,
    revision: String(row.revision),
    currentVersionId: row.current_version_id ?? null,
    downloadable: row.downloadable === true && row.can_read !== false,
    searchable: row.searchable === true,
    metadata: row.metadata,
    tags: row.tags,
    references: row.references,
    createdAt: (row.created_at as Date).toISOString(),
  });
}
export async function inspectDocument(
  tx: DmsTransaction,
  id: string,
  right: 'READ' | 'EDIT_METADATA' = 'READ',
) {
  await requireDocumentRight(tx, id, right);
  const row = (
    await tx.client.query(
      `SELECT d.*,CASE WHEN current_setting('app.principal_kind',true)='machine' THEN dms.has_document_right(d.id,'READ') ELSE true END AS can_read,EXISTS(${CURRENT_ORIGINAL}) AS downloadable,EXISTS(SELECT 1 FROM dms.processing_run pr WHERE dms.search_stage_visible(pr.accepted_stage_id) AND dms.processing_index_status(pr.id) IN ('READY','PARTIAL') AND pr.document_id=d.id AND pr.version_id=d.current_version_id AND pr.active AND pr.lifecycle_generation=d.lifecycle_generation) AS searchable FROM dms.document d WHERE d.id=$1 AND d.lifecycle='ACTIVE'`,
      [id],
    )
  ).rows[0];
  if (!row) return dmsError(404, 'DOCUMENT_NOT_FOUND');

  return present(row);
}
@Injectable()
export class DocumentsService {
  constructor(
    private readonly database: DmsDatabaseService,
    private readonly features: AdmissionFeatures,
  ) {}
  mutate(
    principal: MachinePrincipal,
    id: string,
    expected: string,
    requestId: string,
    action: 'edit' | 'link' | 'unlink',
    input: unknown,
  ) {
    return this.database.withMachine(principal, ['dms:documents:write'], async (tx) => {
      await lockOriginal(tx.client, tx.context.tenantId, id, true);
      const row = (await tx.client.query('SELECT * FROM dms.document WHERE id=$1 FOR UPDATE', [id]))
        .rows[0];
      if (!row) return dmsError(404, 'DOCUMENT_NOT_FOUND');
      await requireDocumentRight(tx, id, 'EDIT_METADATA');
      if (String(row.revision) !== expected) return dmsError(412, 'REVISION_CONFLICT');
      if (row.lifecycle !== 'ACTIVE' || BigInt(row.revision) >= 999999999999999n)
        return dmsError(409, 'DOCUMENT_UNAVAILABLE');
      let title = row.title,
        metadata = row.metadata,
        tags = row.tags;
      let references = row.references as {
        id: string;
        applicationId: string;
        namespace: string;
        type: string;
        externalId: string;
      }[];
      if (action === 'edit') {
        const parsed = documentEditSchema.safeParse(input);
        if (!parsed.success) return dmsError(400, 'INVALID_REQUEST');
        title = parsed.data.title ?? title;
        metadata = parsed.data.metadata ?? metadata;
        tags = parsed.data.tags ?? tags;
      } else if (action === 'link') {
        const parsed = documentReferenceInputSchema.safeParse(input);
        if (!parsed.success) return dmsError(400, 'INVALID_REQUEST');
        const v = parsed.data;
        if (
          references.some(
            (r) =>
              r.applicationId === tx.context.application.id &&
              r.namespace === v.namespace &&
              r.type === v.type &&
              r.externalId === v.externalId,
          )
        )
          return inspectDocument(tx, id, 'EDIT_METADATA');
        if (references.length >= 32) return dmsError(409, 'DOCUMENT_UNAVAILABLE');
        references = [
          ...references,
          { id: randomUUID(), applicationId: tx.context.application.id, ...v },
        ];
      } else {
        if (!references.some((r) => r.id === input)) return dmsError(404, 'DOCUMENT_NOT_FOUND');
        const ref = references.find((r) => r.id === input);
        if (
          row.application_id !== tx.context.application.id &&
          ref?.applicationId !== tx.context.application.id
        )
          return dmsError(403, 'OPERATION_DENIED');
        references = references.filter((r) => r.id !== input);
      }
      await tx.client.query(
        'UPDATE dms.document SET title=$2,metadata=$3,tags=$4,"references"=$5,revision=revision+1 WHERE id=$1',
        [id, title, JSON.stringify(metadata), JSON.stringify(tags), JSON.stringify(references)],
      );
      await appendDocumentAudit(tx, {
        documentId: id,
        action:
          action === 'edit'
            ? 'document.metadata-updated'
            : action === 'link'
              ? 'document.reference-linked'
              : 'document.reference-unlinked',
        requestId,
      });
      return inspectDocument(tx, id, 'EDIT_METADATA');
    });
  }
  read(principal: MachinePrincipal, id: string) {
    return this.database.withMachine(principal, ['dms:documents:read'], (tx) =>
      inspectDocument(tx, id),
    );
  }
  policy(principal: MachinePrincipal) {
    return this.database.withMachine(principal, ['dms:documents:read'], async (tx) =>
      policyProjection(await readAdmissionPolicy(tx.client), this.features),
    );
  }
  list(
    principal: MachinePrincipal,
    options: {
      limit?: number | undefined;
      cursor?: string | undefined;
      fileName?: string | undefined;
      title?: string | undefined;
      tag?: string | undefined;
      referenceNamespace?: string | undefined;
      referenceType?: string | undefined;
      referenceId?: string | undefined;
    },
  ) {
    return this.database.withMachine(principal, ['dms:documents:read'], async (tx) => {
      if (
        !documentListQuerySchema.safeParse({ ...options, limit: options.limit?.toString() }).success
      )
        return dmsError(400, 'INVALID_REQUEST');
      const filters = [
        options.fileName ?? null,
        options.title ?? null,
        options.tag ?? null,
        options.referenceNamespace ?? null,
        options.referenceType ?? null,
        options.referenceId ?? null,
      ];
      const secret = parseAuthorityEnvironment(process.env).AUTH_SECRET;
      const binding = [
        1,
        tx.context.tenantId,
        tx.context.application.id,
        'documents:created-desc',
        createHash('sha256').update(JSON.stringify(filters)).digest('hex'),
      ];
      const mac = (value: string) =>
        createHmac('sha256', secret).update('dms-document-page:').update(value).digest();
      let after: string[] | undefined;
      if (options.cursor) {
        try {
          const cursor = JSON.parse(Buffer.from(options.cursor, 'base64url').toString('utf8'));
          const expected = mac(JSON.stringify(cursor.data)),
            supplied = Buffer.from(cursor.signature, 'base64url');
          if (
            supplied.length !== expected.length ||
            !timingSafeEqual(expected, supplied) ||
            JSON.stringify(cursor.data.slice(0, 5)) !== JSON.stringify(binding) ||
            cursor.data.length !== 7 ||
            typeof cursor.data[5] !== 'string' ||
            typeof cursor.data[6] !== 'string'
          )
            throw new Error('Invalid cursor');
          after = cursor.data.slice(5);
        } catch {
          return dmsError(400, 'INVALID_REQUEST');
        }
      }
      const limit = options.limit ?? 20;
      if (!Number.isInteger(limit) || limit < 1 || limit > 50)
        return dmsError(400, 'INVALID_REQUEST');
      const { rows } = await tx.client.query(
        `SELECT id,tenant_id,application_id,title,tags,"references",file_name,lifecycle,revision,current_version_id,created_at,EXISTS(${CURRENT_ORIGINAL}) AS downloadable,EXISTS(SELECT 1 FROM dms.processing_run pr WHERE dms.search_stage_visible(pr.accepted_stage_id) AND dms.processing_index_status(pr.id) IN ('READY','PARTIAL') AND pr.document_id=d.id AND pr.version_id=d.current_version_id AND pr.active AND pr.lifecycle_generation=d.lifecycle_generation) AS searchable,'{}'::jsonb AS metadata,to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_time FROM dms.document d
        WHERE dms.has_document_right(d.id,'READ') AND ($1::timestamptz IS NULL OR (created_at,id)<($1::timestamptz,$2::uuid)) AND ($4::text IS NULL OR title=$4) AND ($5::jsonb IS NULL OR tags @> $5::jsonb) AND ($6::jsonb IS NULL OR "references" @> $6::jsonb) AND ($7::text IS NULL OR file_name=$7) ORDER BY d.created_at DESC,d.id DESC LIMIT $3`,
        [
          after?.[0] ?? null,
          after?.[1] ?? null,
          limit + 1,
          options.title ?? null,
          options.tag ? JSON.stringify([options.tag]) : null,
          options.referenceNamespace
            ? JSON.stringify([
                {
                  applicationId: tx.context.application.id,
                  namespace: options.referenceNamespace,
                  type: options.referenceType,
                  externalId: options.referenceId,
                },
              ])
            : null,
          options.fileName ?? null,
        ],
      );
      const page = rows.slice(0, limit),
        last = page.at(-1);
      const data = last ? [...binding, last.cursor_time, last.id] : null;
      return documentPageSchema.parse({
        items: page.map((row) => {
          const {
            metadata: _metadata,
            references: _references,
            createdAt: _createdAt,
            ...summary
          } = present(row);
          return summary;
        }),
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
}
