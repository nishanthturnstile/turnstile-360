import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import pg from 'pg';

export async function verifyReports({
  admin,
  viewer,
  anonymous,
  database,
  runtimeUrl,
  call,
  syncInput,
  epoch,
  secret,
  productId,
  clientId,
  policy,
}) {
  const baseline = new Date().toISOString(),
    counterEpoch = randomUUID();
  const make = (sequence, count = sequence, counter = counterEpoch) => ({
    ...syncInput(epoch),
    report: {
      product: 'dms',
      reportEpoch: epoch,
      sequence,
      observedAt: baseline,
      buildVersion: '0.20.0-report-test',
      processingReady: true,
      pendingJobs: 0,
      failedJobs: 0,
      outbox: 0,
      storageFreeBytes: null,
      scratchFreeBytes: null,
      activeDocuments: count,
      retainedOriginalBytes: null,
      counters: {
        epoch: counter,
        startedAt: baseline,
        publishedDocuments: count,
        publishedVersions: count,
        completedProcessingJobs: count,
      },
    },
  });
  const send = (input, options) => call('sync', input, secret, options);
  const count = async () =>
    Number(
      (
        await database.query(
          'SELECT count(*) AS n FROM control_plane.report_snapshot WHERE product_id=$1',
          [productId],
        )
      ).rows[0].n,
    );
  const history = async (actor = viewer) => {
    const r = await actor.call(`/api/reports/products/${productId}`);
    assert.equal(r.status, 200, r.text);
    return r.json();
  };
  assert.equal((await anonymous.call('/api/reports')).status, 401);
  assert.equal((await anonymous.call(`/api/reports/products/${productId}`)).status, 401);
  const input = make(2);
  await assert.rejects(send(input, { dropResponse: true }), /discarded/);
  assert.equal(await count(), 1, 'A committed report survives lost HTTP acknowledgement');
  await policy('suspend');
  assert.equal((await send(input)).status, 200, 'Replay after an intervening policy change');
  assert.equal(await count(), 1, 'Retry never inserts another sample');
  assert.equal(
    (await send({ ...input, report: { ...input.report, activeDocuments: 999 } })).status,
    409,
    'Report ID content immutable',
  );
  assert.equal(
    (await send(make(2))).status,
    409,
    'Sequence cannot be reused under another report ID',
  );
  assert.equal((await send(make(1))).status, 200, 'Late report retained');
  let data = await history();
  assert.equal(data.product.sequence, 2);
  assert.equal(data.product.report.activeDocuments, 2);
  assert.equal(data.product.policyState, 'suspended');
  assert.equal(data.product.freshness, 'current');
  assert.equal(data.product.versionReview, 'notice');
  assert.equal(data.items.length, 2);
  assert.ok(data.items.every((i) => i.receivedAt && i.observedAt));
  assert.equal(
    (await send(make(3, 1))).status,
    409,
    'Cumulative totals cannot regress in an epoch',
  );
  const malformed = [
    { activeDocuments: -1 },
    { activeDocuments: Number.MAX_SAFE_INTEGER + 1 },
    { documentNames: ['private'] },
    { sequence: Number.MAX_SAFE_INTEGER + 1 },
    { reportEpoch: randomUUID() },
    { observedAt: new Date(Date.now() + 600000).toISOString() },
  ];
  for (const patch of malformed)
    assert.ok(
      [400, 409].includes(
        (await send({ ...make(3), report: { ...make(3).report, ...patch } })).status,
      ),
    );
  const resetEpoch = randomUUID();
  assert.equal((await send(make(3, 0, resetEpoch))).status, 200);
  data = await history();
  assert.equal(data.product.report.counters.epoch, resetEpoch);
  assert.ok(data.items.some((i) => i.counterReset));
  assert.equal((await send(make(4, 4))).status, 409, 'Retired counter epoch cannot return');
  assert.equal(
    (
      await send({
        ...make(4, 1, resetEpoch),
        report: {
          ...make(4, 1, resetEpoch).report,
          counters: {
            ...make(4, 1, resetEpoch).report.counters,
            startedAt: new Date(Date.now() - 10000).toISOString(),
          },
        },
      })
    ).status,
    409,
    'Baseline immutable in a counter epoch',
  );
  const overflow = make(4, 1, resetEpoch);
  for (const key of ['publishedDocuments', 'publishedVersions', 'completedProcessingJobs'])
    overflow.report.counters[key] = null;
  assert.equal((await send(overflow)).status, 200);
  assert.equal((await history()).product.report.counters.publishedDocuments, null);
  const missingCounters = make(8, 1, resetEpoch);
  delete missingCounters.report.counters;
  assert.equal((await send(missingCounters)).status, 200);
  const laterEpoch = randomUUID();
  assert.equal(
    (await send(make(7, 0, laterEpoch))).status,
    200,
    'A delayed reset advances the independent counter stream after a missing-counter interval',
  );
  assert.equal((await history()).product.sequence, 8);
  assert.equal(
    (await send(make(9, 1, laterEpoch))).status,
    200,
    'Newer report can continue that counter epoch',
  );
  const max = make(Number.MAX_SAFE_INTEGER, 2, laterEpoch);
  assert.equal((await send(max)).status, 200);
  assert.equal((await send(make(Number.MAX_SAFE_INTEGER - 1, 1, laterEpoch))).status, 200);
  assert.equal((await history()).product.sequence, Number.MAX_SAFE_INTEGER);
  const legacy = make(5);
  delete legacy.report.reportEpoch;
  delete legacy.report.sequence;
  delete legacy.report.counters;
  assert.equal((await send(legacy)).status, 200);
  assert.equal(
    (await history()).product.sequence,
    Number.MAX_SAFE_INTEGER,
    'Legacy report cannot replace ordered data',
  );
  const filtered = await viewer.call(
    `/api/reports?clientId=${clientId}&environment=protocol&product=dms`,
  );
  assert.equal(filtered.status, 200, filtered.text);
  assert.deepEqual(
    filtered.json().items.map((i) => i.id),
    [productId],
  );
  assert.equal((await viewer.call('/api/reports?environment=../private')).status, 400);
  assert.equal(
    (await viewer.call(`/api/reports/products/${productId}?before=${baseline}`)).status,
    400,
  );
  assert.equal(
    (await viewer.call(`/reports/${productId}`)).status,
    200,
    'History server page works for Viewer',
  );
  assert.equal((await admin.call('/reports')).status, 200);
  await database.query(
    `INSERT INTO control_plane.report_snapshot(id,product_id,epoch,sequence,observed_at,payload) SELECT gen_random_uuid(),$1,$2,5000+n,$3,$4::jsonb FROM generate_series(1,100) n`,
    [productId, epoch, baseline, JSON.stringify(make(5001).report)],
  );
  const page = await history();
  assert.equal(page.items.length, 96);
  assert.ok(page.next);
  const older = await viewer.call(
    `/api/reports/products/${productId}?${new URLSearchParams(page.next)}`,
  );
  assert.equal(older.status, 200, older.text);
  assert.ok(older.json().items.length > 0);
  assert.ok(
    older.json().items.every((i) => !page.items.some((j) => j.id === i.id)),
    'Bounded cursor pages never repeat records',
  );
  await database.query(
    "UPDATE control_plane.report_latest SET received_at=now()-interval '46 minutes' WHERE product_id=$1",
    [productId],
  );
  data = await history();
  assert.equal(data.product.freshness, 'stale');
  assert.equal(data.product.policyState, 'suspended', 'Missing reports never alter policy');
  // Age only this disposable product's history. Independent receipt/order evidence stays durable.
  await database.query(
    "UPDATE control_plane.report_snapshot SET received_at=now()-interval '91 days' WHERE product_id=$1",
    [productId],
  );
  await database.query(
    "UPDATE control_plane.report_latest SET received_at=now()-interval '91 days' WHERE product_id=$1",
    [productId],
  );
  const beforePolicy = (
    await database.query(
      'SELECT first_approved_at,policy_state,revision FROM control_plane.registry_product WHERE id=$1',
      [productId],
    )
  ).rows[0];
  const beforeMachine = (
    await database.query('SELECT * FROM control_plane.machine WHERE product_id=$1', [productId])
  ).rows[0];
  const runtime = new pg.Pool({ connectionString: runtimeUrl, max: 1 });
  try {
    await assert.rejects(
      runtime.query('SELECT control_plane.prune_reporting()'),
      (e) => e.code === '42501',
    );
  } finally {
    await runtime.end();
  }
  await database.query(
    "UPDATE control_plane.registry_audit SET committed_at=now()-interval '366 days' WHERE id=(SELECT id FROM control_plane.registry_audit WHERE resource_id=$1 LIMIT 1)",
    [productId],
  );
  await database.query(
    "UPDATE control_plane.staff_audit SET created_at=now()-interval '366 days' WHERE id=(SELECT id FROM control_plane.staff_audit LIMIT 1)",
  );
  const pruned = (await database.query('SELECT control_plane.prune_reporting() AS counts')).rows[0]
    .counts;
  assert.ok(pruned.snapshots >= 1);
  assert.ok(pruned.latestValues >= 1);
  assert.equal(pruned.registryAudit, 1);
  assert.equal(pruned.staffAudit, 1);
  assert.equal(await count(), 0);
  assert.equal((await history()).product.report, null);
  assert.equal((await send(max)).status, 200);
  assert.equal(await count(), 0, 'Old receipt replay never restores pruned payload');
  assert.equal(
    (await send(make(Number.MAX_SAFE_INTEGER, 2, laterEpoch))).status,
    409,
    'Pruning keeps durable sequence fence',
  );
  assert.equal((await send(make(10, 2, laterEpoch))).status, 200);
  assert.equal(
    (await history()).product.report,
    null,
    'Late sequence cannot repopulate pruned latest data',
  );
  assert.deepEqual(
    (
      await database.query(
        'SELECT first_approved_at,policy_state,revision FROM control_plane.registry_product WHERE id=$1',
        [productId],
      )
    ).rows[0],
    beforePolicy,
  );
  // Sync updates contact/decision sequence by design; identity and activation evidence are unchanged.
  const afterMachine = (
    await database.query('SELECT * FROM control_plane.machine WHERE product_id=$1', [productId])
  ).rows[0];
  for (const key of [
    'epoch',
    'first_issued_at',
    'first_acknowledged_at',
    'current_acknowledged_at',
  ])
    assert.deepEqual(afterMachine[key], beforeMachine[key]);
  await policy('approve');
  console.log(
    'Central reporting HTTP: lost acknowledgements, idempotence, delayed ordering, counter resets/overflow, invalid metrics, privacy, Viewer filters/history, missing intervals and retention fences passed.',
  );
}
