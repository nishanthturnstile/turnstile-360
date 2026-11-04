import type { PoolClient } from 'pg';
/** Caller holds the fixed installation/configuration/access locks using the private migrator. */
export async function pruneInvitationRecords(db: PoolClient, tenant: string, budget = 1000) {
  const counts: Record<string, number> = {};
  let remaining = budget;
  for (const [table, condition] of [
    ['invitation_acceptance', 'expires_at<=statement_timestamp()'],
    ['invitation_operation', 'expires_at<=statement_timestamp()'],
    ['invitation_rate', '"window"<statement_timestamp()-interval \'2 hours\''],
    ['invitation_audit', "created_at<statement_timestamp()-interval '90 days'"],
    [
      'invitation_delivery',
      "state NOT IN ('queued','sending') AND outcome_at<statement_timestamp()-interval '90 days'",
    ],
    [
      'invitation_generation',
      "created_at<statement_timestamp()-interval '90 days' AND NOT EXISTS(SELECT 1 FROM turnstile.invitation i WHERE i.tenant_id=t.tenant_id AND i.id=t.invitation_id AND i.generation=t.generation AND (i.state IN ('pending','needs_reapproval') OR (i.state='accepted' AND i.approval_id=t.id))) AND NOT EXISTS(SELECT 1 FROM turnstile.invitation_delivery d WHERE d.tenant_id=t.tenant_id AND d.invitation_id=t.invitation_id AND d.generation=t.generation)",
    ],
  ] as const) {
    if (remaining <= 0) break;
    const result = await db.query(
      `DELETE FROM turnstile.${table} WHERE ctid IN (SELECT t.ctid FROM turnstile.${table} t WHERE tenant_id=$1 AND ${condition} LIMIT $2)`,
      [tenant, remaining],
    );
    counts[table] = result.rowCount ?? 0;
    remaining -= result.rowCount ?? 0;
  }
  if (remaining <= 0) return counts;
  // An accepted result needs its current approval until both can be removed together.
  // Drain every other FK dependent first so a parent delete cascades at most one known row.
  const parents = await db.query<{ id: string; generation_id: string | null }>(
    `SELECT i.id,g.id AS generation_id FROM turnstile.invitation i
    LEFT JOIN turnstile.invitation_generation g ON g.tenant_id=i.tenant_id AND g.invitation_id=i.id
      AND i.state='accepted' AND g.generation=i.generation AND g.id=i.approval_id
    WHERE i.tenant_id=$1 AND i.state IN ('accepted','cancelled','expired')
      AND coalesce(i.cancelled_at,i.accepted_at,i.expires_at)<statement_timestamp()-interval '90 days'
      AND NOT EXISTS(SELECT 1 FROM turnstile.invitation_generation other WHERE other.tenant_id=i.tenant_id AND other.invitation_id=i.id AND (g.id IS NULL OR other.generation<>g.generation))
      AND NOT EXISTS(SELECT 1 FROM turnstile.invitation_delivery d WHERE d.tenant_id=i.tenant_id AND d.invitation_id=i.id)
      AND NOT EXISTS(SELECT 1 FROM turnstile.invitation_reference r WHERE r.tenant_id=i.tenant_id AND r.invitation_id=i.id)
      AND NOT EXISTS(SELECT 1 FROM turnstile.invitation_acceptance a WHERE a.tenant_id=i.tenant_id AND a.invitation_id=i.id)
    ORDER BY coalesce(i.cancelled_at,i.accepted_at,i.expires_at),i.id LIMIT $2 FOR UPDATE OF i`,
    [tenant, remaining],
  );
  for (const parent of parents.rows) {
    const cost = parent.generation_id ? 2 : 1;
    if (cost > remaining) continue;
    const result = await db.query('DELETE FROM turnstile.invitation WHERE tenant_id=$1 AND id=$2', [
      tenant,
      parent.id,
    ]);
    if (!result.rowCount) continue;
    counts.invitation = (counts.invitation ?? 0) + 1;
    if (parent.generation_id)
      counts.invitation_generation = (counts.invitation_generation ?? 0) + 1;
    remaining -= cost;
  }
  return counts;
}
