import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { discoveryPageSchema, type discoveryRequestSchema } from '@thaarei/dms-contracts/public';
import { z } from 'zod';
import type { MachinePrincipal } from '../access/access-policy.js';
import { DmsDatabaseService } from '../access/dms-database/dms-database.service.js';
import { dmsError } from '../access/dms-errors.js';
import { CURRENT_ORIGINAL } from '../documents/download-policy.js';
import { parseAuthorityEnvironment } from '../platform-auth/authority-configuration.js';
@Injectable()
export class DiscoveryService {
  constructor(private readonly database: DmsDatabaseService) {}
  search(principal: MachinePrincipal, input: z.infer<typeof discoveryRequestSchema>) {
    return this.database.withMachine(principal, ['dms:documents:read'], async (tx) => {
      const { cursor, ...filters } = input;
      const binding = createHash('sha256')
        .update(JSON.stringify([tx.context.tenantId, tx.context.application.id, filters]))
        .digest('hex');
      const mac = (data: unknown) =>
        createHmac('sha256', parseAuthorityEnvironment(process.env).AUTH_SECRET)
          .update('dms-discovery:')
          .update(JSON.stringify(data))
          .digest();
      let after: string | null = null;
      if (cursor) {
        try {
          const decoded = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
          const expected = mac(decoded.data),
            signature = Buffer.from(decoded.signature, 'base64url');
          if (
            signature.length !== expected.length ||
            !timingSafeEqual(signature, expected) ||
            decoded.data[0] !== binding ||
            decoded.data.length !== 2 ||
            !z.uuid().safeParse(decoded.data[1]).success
          )
            throw new Error();
          after = decoded.data[1];
        } catch {
          return dmsError(400, 'INVALID_REQUEST');
        }
      }
      await tx.client.query("SET LOCAL statement_timeout='2s'");
      await tx.client.query("SET LOCAL pg_trgm.similarity_threshold='0.3'");
      const reference = input.referenceNamespace
        ? JSON.stringify([
            {
              applicationId: tx.context.application.id,
              namespace: input.referenceNamespace,
              type: input.referenceType,
              externalId: input.referenceId,
            },
          ])
        : null;
      const rows = (
        await tx.client.query(
          `
   WITH eligible AS MATERIALIZED (
    SELECT d.id,d.current_version_id,d.title,d.file_name,d.lifecycle_generation FROM dms.document d JOIN dms.application_registration reg ON reg.id=d.application_id
    WHERE d.tenant_id=$1 AND reg.status='active' AND d.lifecycle='ACTIVE' AND dms.has_document_right(d.id,'READ') AND EXISTS(${CURRENT_ORIGINAL})
    AND ($2::uuid IS NULL OR d.id>$2) AND ($4::text IS NULL OR d.tags @> jsonb_build_array($4::text))
    AND ($5::jsonb IS NULL OR d."references" @> $5::jsonb)
    AND ($6::text IS NULL OR ($6='category' AND jsonb_typeof(d.metadata->'category')='string' AND d.metadata->>'category'=$7) OR ($6='status' AND jsonb_typeof(d.metadata->'status')='string' AND d.metadata->>'status'=$7))
    AND ($8::text IS NULL OR d.title=$8) AND ($9::text IS NULL OR d.file_name=$9)
   )
   SELECT d.id,d.current_version_id,d.title,d.file_name,r.id AS run_id,coalesce(dms.processing_index_status(r.id),'NOT_INDEXED') AS index_status,m.unit_id,m.kind,m.source,m.ordinal,m.snippet
   FROM eligible d LEFT JOIN dms.processing_run r ON r.version_id=d.current_version_id AND r.active AND r.lifecycle_generation=d.lifecycle_generation AND EXISTS(SELECT 1 FROM dms.security_candidate sc WHERE sc.upload_id=r.upload_id AND sc.state='PASSED' AND sc.sha256=r.source_sha256)
   LEFT JOIN LATERAL (
    SELECT c.unit_id,c.kind,c.source,c.ordinal,left(ts_headline('english',c.text,plainto_tsquery('english',$3),'StartSel=,StopSel=,MaxWords=35,MinWords=15,MaxFragments=1'),480) AS snippet
    FROM dms.search_chunk c JOIN dms.search_generation g ON g.stage_id=c.stage_id AND g.run_id=r.id
    WHERE c.stage_id=r.accepted_stage_id AND c.tenant_id=$1 AND $3::text IS NOT NULL AND c.vector @@ plainto_tsquery('english',$3)
    ORDER BY c.ordinal LIMIT 1
   ) m ON true
   WHERE $3::text IS NULL OR d.title OPERATOR(dms.%) $3 OR d.file_name OPERATOR(dms.%) $3 OR strpos(lower(d.title),lower($3))>0 OR strpos(lower(d.file_name),lower($3))>0 OR m.ordinal IS NOT NULL
   ORDER BY d.id LIMIT $10`,
          [
            tx.context.tenantId,
            after,
            input.q ?? null,
            input.tag ?? null,
            reference,
            input.metadataField ?? null,
            input.metadataValue ?? null,
            input.title ?? null,
            input.fileName ?? null,
            input.limit + 1,
          ],
        )
      ).rows;
      const page = rows.slice(0, input.limit),
        last = page.at(-1),
        data = last ? [binding, last.id] : null;
      return discoveryPageSchema.parse({
        language: 'en',
        untrusted: true,
        items: page.map((row) => ({
          documentId: row.id,
          versionId: row.current_version_id,
          title: row.title,
          fileName: row.file_name,
          runId: row.run_id ?? null,
          indexStatus: row.index_status,
          match:
            row.ordinal === null
              ? null
              : {
                  unitId: row.unit_id,
                  kind: row.kind,
                  source: row.source,
                  chunk: row.ordinal,
                  snippet: Array.from(row.snippet as string)
                    .slice(0, 240)
                    .join(''),
                },
        })),
        nextCursor:
          rows.length > input.limit && data
            ? Buffer.from(
                JSON.stringify({ data, signature: mac(data).toString('base64url') }),
              ).toString('base64url')
            : null,
      });
    });
  }
}
