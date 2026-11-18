import 'server-only';
import { versionedDecision } from '@thaarei/module-catalog';
import { decodeJwt } from 'jose';
import type { PoolClient } from 'pg';
import { acknowledgedModules, productHandover } from '../contracts/module-assignments.ts';
import { AccessError } from './access.ts';
import { assertAuthority } from './machine-signing.ts';

const iso = (v: unknown) => (v ? new Date(String(v)).toISOString() : null);
/** Issued decision + validated acknowledgement, never a self-reported inventory alone. */
type Acknowledged = ReturnType<typeof acknowledgedModules.parse>;
export async function moduleHandover(
  db: Pick<PoolClient, 'query'>,
  installationId: string,
): Promise<{
  handover: { authorityReady: boolean; products: ReturnType<typeof productHandover.parse>[] };
  effective: Acknowledged | null;
}> {
  let authorityReady = true;
  try {
    await assertAuthority(db);
  } catch (error) {
    if (!(error instanceof AccessError)) throw error;
    authorityReady = false;
  }
  const rows = (
    await db.query(
      `SELECT p.id,p.product,p.policy_state,p.licence_expires_at,p.revision,m.epoch,m.revoked_at,m.last_contact_at,c.archived,
      a.applied_at,a.received_at,d.id AS decision_id,d.token,d.expires_at,d.revision AS decision_revision,
      l.received_at AS report_received_at
    FROM control_plane.registry_product p JOIN control_plane.registry_client c ON c.id=p.client_id
    LEFT JOIN control_plane.machine m ON m.product_id=p.id
    LEFT JOIN control_plane.machine_application a ON a.product_id=p.id AND a.epoch=m.epoch
    LEFT JOIN control_plane.machine_decision d ON d.id=a.decision_id AND d.product_id=p.id AND d.epoch=m.epoch
    LEFT JOIN control_plane.report_latest l ON l.product_id=p.id AND l.epoch=m.epoch
    WHERE p.installation_id=$1 ORDER BY p.product`,
      [installationId],
    )
  ).rows;
  let effective: Acknowledged | null = null;
  const products = rows.map((r) => {
    const acknowledged =
      authorityReady &&
      !r.archived &&
      !r.revoked_at &&
      r.policy_state === 'approved' &&
      r.licence_expires_at &&
      new Date(r.licence_expires_at).getTime() > Date.now() &&
      r.decision_revision === r.revision &&
      new Date(r.expires_at).getTime() > Date.now();
    if (acknowledged && r.product === 'turnstile') {
      const parsed = versionedDecision.safeParse(decodeJwt(r.token));
      if (parsed.success && parsed.data.version === 2 && parsed.data.state === 'approved') {
        const c = parsed.data;
        effective = acknowledgedModules.parse({
          epoch: c.epoch,
          decisionId: c.decisionId,
          policyRevision: c.policyRevision,
          decisionSequence: c.decisionSequence,
          appliedAt: iso(r.applied_at),
          receivedAt: iso(r.received_at),
          expiresAt: iso(r.expires_at),
          catalogueDigest: c.modulePolicy.active.catalogueDigest,
          profileDigest: c.modulePolicy.active.profileDigest,
          assignmentRevision: c.modulePolicy.active.assignmentRevision,
          allowedIds: c.modulePolicy.allowedModuleIds,
        });
      }
    }
    return productHandover.parse({
      product: r.product,
      productId: r.id,
      policyState: r.policy_state,
      revision: r.revision,
      paired: !!r.epoch && !r.revoked_at,
      acknowledged: !!acknowledged,
      lastContactAt: iso(r.last_contact_at),
      reportReceivedAt: iso(r.report_received_at),
      reportFreshness: !r.report_received_at
        ? 'never'
        : Date.now() - new Date(r.report_received_at).getTime() > 45 * 60 * 1000
          ? 'stale'
          : 'current',
    });
  });
  return { handover: { authorityReady, products }, effective };
}
