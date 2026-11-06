import type { PoolClient } from 'pg';
// Every security publication/invalidation and capability issuer shares this fence.
// Hold it through signing and audit commit; an issued URL remains valid until expiry.
export async function lockOriginal(
  client: PoolClient,
  tenantId: string,
  documentId: string,
  exclusive = false,
) {
  await client.query(
    `SELECT ${exclusive ? 'pg_advisory_xact_lock' : 'pg_advisory_xact_lock_shared'}(hashtextextended($1,0))`,
    [`dms-original:${tenantId.toLowerCase()}:${documentId.toLowerCase()}`],
  );
}
// The same SQL predicate drives detail/list projections and capability issuance.
export const AVAILABLE_ORIGINAL = `SELECT v.id AS version_id,v.file_name,c.object_id,c.size,c.sha256,c.id AS candidate_id
 FROM dms.document_version v JOIN dms.upload_admission a ON a.version_id=v.id AND a.document_id=v.document_id
 JOIN dms.security_candidate c ON c.upload_id=a.id AND c.tenant_id=v.tenant_id AND c.application_id=v.application_id
 WHERE v.document_id=d.id AND v.tenant_id=d.tenant_id AND v.application_id=d.application_id
 AND d.lifecycle='ACTIVE' AND v.lifecycle_generation=d.lifecycle_generation AND v.availability='AVAILABLE' AND c.state='PASSED' AND c.sha256 IS NOT NULL
 AND c.evidence IS NOT NULL AND c.assessed_at IS NOT NULL`;

export const CURRENT_ORIGINAL = `${AVAILABLE_ORIGINAL} AND v.id=d.current_version_id`;
