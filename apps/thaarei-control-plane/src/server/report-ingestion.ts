import 'server-only';
import type { machineReport } from '@thaarei/control-plane-contracts';
import type { PoolClient } from 'pg';
import type { z } from 'zod';
import { AccessError } from './access.ts';

type Report = z.infer<typeof machineReport>;
const counterKeys = ['publishedDocuments', 'publishedVersions', 'completedProcessingJobs'] as const;
// Caller holds the product-row lock and inserts the immutable sync receipt in this transaction.
export async function ingestReport(
  db: PoolClient,
  productId: string,
  epoch: string,
  id: string,
  report: Report,
) {
  if (
    !Number.isFinite(Date.parse(report.observedAt)) ||
    Date.parse(report.observedAt) > Date.now() + 300000
  )
    throw new AccessError(400, 'Report observation time invalid');
  const ordered = report.reportEpoch === epoch && report.sequence !== undefined;
  if (report.reportEpoch !== undefined && !ordered)
    throw new AccessError(409, 'Report epoch changed');
  const sequence = ordered ? (report.sequence as number) : null;
  if (
    sequence !== null &&
    (
      await db.query(
        'SELECT 1 FROM control_plane.report_snapshot WHERE product_id=$1 AND epoch=$2 AND sequence=$3',
        [productId, epoch, sequence],
      )
    ).rowCount
  )
    throw new AccessError(409, 'Report sequence reused');
  const latest = (
    await db.query('SELECT * FROM control_plane.report_latest WHERE product_id=$1 FOR UPDATE', [
      productId,
    ])
  ).rows[0];
  const same = latest?.epoch === epoch;
  const newer =
    !same ||
    (sequence !== null && (latest.sequence === null || sequence > Number(latest.sequence))) ||
    (sequence === null && latest.sequence === null);
  let reset = false;
  if (report.product === 'dms' && report.counters) {
    if (sequence === null) throw new AccessError(400, 'Counters require ordered reporting');
    const totals = report.counters;
    const old = (
      await db.query(
        'SELECT * FROM control_plane.report_counter WHERE product_id=$1 AND epoch=$2 AND counter_epoch=$3 FOR UPDATE',
        [productId, epoch, totals.epoch],
      )
    ).rows[0];
    if (old) {
      if (old.totals.startedAt !== totals.startedAt)
        throw new AccessError(409, 'Counter baseline changed without a new epoch');
      const increasing = sequence > Number(old.sequence);
      for (const key of counterKeys) {
        const before = old.totals[key],
          after = totals[key];
        if (before !== null && after !== null && (increasing ? after < before : after > before))
          throw new AccessError(409, 'Counter order regressed');
      }
    }
    const active = (
      await db.query(
        'SELECT counter_epoch,sequence FROM control_plane.report_counter WHERE product_id=$1 AND epoch=$2 AND NOT retired LIMIT 1',
        [productId, epoch],
      )
    ).rows[0];
    const counterNewer = !active || sequence > Number(active.sequence);
    if (counterNewer && old?.retired) throw new AccessError(409, 'Counter epoch was retired');
    reset = !!(counterNewer && active && active.counter_epoch !== totals.epoch);
    if (counterNewer)
      await db.query(
        'UPDATE control_plane.report_counter SET retired=true WHERE product_id=$1 AND epoch=$2 AND counter_epoch<>$3',
        [productId, epoch, totals.epoch],
      );
    if (!old)
      await db.query(
        'INSERT INTO control_plane.report_counter(product_id,epoch,counter_epoch,sequence,totals,retired) VALUES($1,$2,$3,$4,$5,$6)',
        [
          productId,
          epoch,
          totals.epoch,
          sequence,
          JSON.stringify(totals),
          !counterNewer && !!active && active.counter_epoch !== totals.epoch,
        ],
      );
    else if (sequence > Number(old.sequence)) {
      // Missing/overflowed values never erase a previously observed monotonic fence.
      const merged = { ...totals };
      for (const key of counterKeys) if (merged[key] === null) merged[key] = old.totals[key];
      await db.query(
        'UPDATE control_plane.report_counter SET sequence=$4,totals=$5 WHERE product_id=$1 AND epoch=$2 AND counter_epoch=$3',
        [productId, epoch, totals.epoch, sequence, JSON.stringify(merged)],
      );
    }
  }
  const received = (
    await db.query(
      'INSERT INTO control_plane.report_snapshot(id,product_id,epoch,sequence,observed_at,payload,counter_reset) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING received_at',
      [id, productId, epoch, sequence, report.observedAt, JSON.stringify(report), reset],
    )
  ).rows[0].received_at;
  if (newer)
    await db.query(
      'INSERT INTO control_plane.report_latest(product_id,epoch,report_id,sequence,observed_at,received_at,payload) VALUES($1,$2,$3,$4,$5,$6,$7) ON CONFLICT(product_id) DO UPDATE SET epoch=EXCLUDED.epoch,report_id=EXCLUDED.report_id,sequence=EXCLUDED.sequence,observed_at=EXCLUDED.observed_at,received_at=EXCLUDED.received_at,payload=EXCLUDED.payload',
      [productId, epoch, id, sequence, report.observedAt, received, JSON.stringify(report)],
    );
}
