import 'server-only';
import { machineReport } from '@thaarei/control-plane-contracts';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { historyQuery, reportQuery } from '../contracts/reports.ts';
import { AccessError, identity, STAFF_LOCK, staffContext, transaction } from './access.ts';
import { runtime } from './runtime.ts';

const staleMs = 45 * 60 * 1000;
async function read<T>(headers: Headers, fn: (db: PoolClient) => Promise<T>) {
  const session = await identity(headers);
  if (!session) throw new AccessError(401, 'Sign in required');
  return transaction(async (db) => {
    await db.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');
    await db.query('SELECT pg_advisory_xact_lock_shared($1)', [STAFF_LOCK]);
    await staffContext(session.session.id, db);
    return fn(db);
  });
}
const projection = `SELECT p.id,p.client_id,c.name AS client_name,i.environment,p.product,p.policy_state,p.revision,
p.registered_at,p.first_approved_at,p.last_approved_at,m.epoch,m.revoked_at,m.first_issued_at,m.first_acknowledged_at,m.current_acknowledged_at,m.last_contact_at,
l.received_at,l.observed_at,l.sequence,CASE WHEN l.received_at>=now()-interval '90 days' THEN l.payload END AS payload,
(SELECT d.expires_at FROM control_plane.machine_decision d WHERE d.product_id=p.id AND d.epoch=m.epoch ORDER BY d.revision DESC,d.sequence DESC LIMIT 1) AS grant_expires_at
FROM control_plane.registry_product p JOIN control_plane.registry_client c ON c.id=p.client_id
JOIN control_plane.registry_installation i ON i.id=p.installation_id
LEFT JOIN control_plane.machine m ON m.product_id=p.id
LEFT JOIN control_plane.report_latest l ON l.product_id=p.id AND l.epoch=m.epoch`;
type ReportRow = {
  id: string;
  client_id: string;
  client_name: string;
  environment: string;
  product: 'dms' | 'turnstile';
  policy_state: string;
  revision: number;
  registered_at: Date;
  first_approved_at: Date | null;
  last_approved_at: Date | null;
  epoch: string | null;
  revoked_at: Date | null;
  first_issued_at: Date | null;
  first_acknowledged_at: Date | null;
  current_acknowledged_at: Date | null;
  last_contact_at: Date | null;
  received_at: Date | null;
  observed_at: Date | null;
  sequence: string | null;
  payload: unknown;
  grant_expires_at: Date | null;
};
function view(row: ReportRow) {
  const parsed = machineReport.safeParse(row.payload);
  const report = parsed.success ? parsed.data : null;
  const freshness = !row.received_at
    ? 'never'
    : Date.now() - new Date(row.received_at).getTime() > staleMs
      ? 'stale'
      : 'current';
  const configured = runtime().config.supportedVersions[row.product as 'dms' | 'turnstile'];
  const versionReview = !report
    ? 'unknown'
    : configured.length === 0
      ? 'unconfigured'
      : configured.includes(report.buildVersion)
        ? 'accepted'
        : 'notice';
  const notices: string[] = [];
  if (row.policy_state !== 'approved') notices.push(`Policy is ${row.policy_state}.`);
  if (row.revoked_at) notices.push('Machine credentials require reconciliation.');
  if (row.grant_expires_at && new Date(row.grant_expires_at).getTime() <= Date.now())
    notices.push(
      'Last issued grant has expired; customer enforcement may differ until a new grant is applied.',
    );
  if (freshness !== 'current')
    notices.push(
      freshness === 'never'
        ? 'No report received for the current machine epoch.'
        : 'Report overdue; current customer state is unknown.',
    );
  if (report && row.sequence === null)
    notices.push('Legacy report has no durable order; upgrade its reporter.');
  if (versionReview === 'notice')
    notices.push('Reported version is outside the configured version policy.');
  if (
    report?.localState &&
    (report.localState !== row.policy_state || report.appliedPolicyRevision !== row.revision)
  )
    notices.push('Customer reports an earlier policy; delivery or application is pending.');
  return {
    id: row.id,
    clientId: row.client_id,
    clientName: row.client_name,
    environment: row.environment,
    product: row.product,
    policyState: row.policy_state,
    revision: row.revision,
    registeredAt: row.registered_at,
    firstApprovedAt: row.first_approved_at,
    lastApprovedAt: row.last_approved_at,
    firstIssuedAt: row.first_issued_at,
    firstAcknowledgedAt: row.first_acknowledged_at,
    currentAcknowledgedAt: row.current_acknowledged_at,
    lastContactAt: row.last_contact_at,
    grantExpiresAt: row.grant_expires_at,
    epoch: row.epoch,
    freshness,
    receivedAt: row.received_at,
    observedAt: row.observed_at,
    sequence: row.sequence === null ? null : Number(row.sequence),
    report,
    versionReview,
    notices,
  };
}
export async function listReports(headers: Headers, input: unknown) {
  const filter = reportQuery.parse(input);
  return read(headers, async (db) => {
    const result = await db.query(
      `${projection} WHERE ($1::uuid IS NULL OR p.client_id=$1) AND ($2::text IS NULL OR i.environment=$2) AND ($3::text IS NULL OR p.product=$3) AND ($4::uuid IS NULL OR p.id>$4) ORDER BY p.id LIMIT 51`,
      [
        filter.clientId ?? null,
        filter.environment ?? null,
        filter.product ?? null,
        filter.after ?? null,
      ],
    );
    return {
      items: result.rows.slice(0, 50).map(view),
      next: result.rows.length > 50 ? result.rows[49].id : null,
    };
  });
}
export async function reportHistory(headers: Headers, id: string, input: unknown = {}) {
  z.uuid().parse(id);
  const cursor = historyQuery.parse(input);
  return read(headers, async (db) => {
    const product = (await db.query(`${projection} WHERE p.id=$1`, [id])).rows[0];
    if (!product) throw new AccessError(404, 'Product not found');
    const result = await db.query(
      `SELECT id,epoch,sequence,observed_at,received_at,payload,counter_reset FROM control_plane.report_snapshot WHERE product_id=$1 AND received_at>=now()-interval '90 days' AND ($2::timestamptz IS NULL OR (received_at,id)<($2,$3::uuid)) ORDER BY received_at DESC,id DESC LIMIT 97`,
      [id, cursor.before ?? null, cursor.beforeId ?? null],
    );
    const items = result.rows.slice(0, 96).map((row) => ({
      id: row.id,
      epoch: row.epoch,
      sequence: row.sequence === null ? null : Number(row.sequence),
      observedAt: row.observed_at,
      receivedAt: row.received_at,
      report: machineReport.parse(row.payload),
      counterReset: row.counter_reset,
    }));
    const last = items.at(-1);
    return {
      product: view(product),
      items,
      next:
        result.rows.length > 96 && last
          ? { before: last.receivedAt.toISOString(), beforeId: last.id }
          : null,
    };
  });
}
export type ReportView = Awaited<ReturnType<typeof reportHistory>>['product'];
