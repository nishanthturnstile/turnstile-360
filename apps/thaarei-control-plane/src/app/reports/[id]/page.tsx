import { headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { ZodError } from 'zod';
import { AccessError } from '../../../server/access.ts';
import { reportHistory } from '../../../server/report-service.ts';
import { date, Status } from '../Status.tsx';
export const dynamic = 'force-dynamic';
export default async function History({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string>>;
}) {
  const { id } = await params;
  const data = await reportHistory(await headers(), id, await searchParams).catch(
    (error: unknown) => {
      if (error instanceof ZodError) notFound();
      if (error instanceof AccessError) {
        if (error.status === 404) notFound();
        redirect('/access');
      }
      throw error;
    },
  );
  const p = data.product;
  // Plot gauges only, with gaps at missing intervals or epoch changes. Cumulative totals are never summed.
  const points = [...data.items].reverse().map((i) => ({
    id: i.id,
    time: new Date(i.receivedAt).getTime(),
    epoch: i.epoch,
    value: i.report.product === 'dms' ? (i.report.activeDocuments ?? null) : i.report.activeMembers,
  }));
  const min = points[0]?.time ?? 0,
    max = points.at(-1)?.time ?? min;
  const highest = Math.max(1, ...points.map((p) => p.value ?? 0));
  const paths: string[] = [];
  let path = '';
  points.forEach((p, i) => {
    const previous = points[i - 1];
    if (p.value === null) {
      if (path) paths.push(path);
      path = '';
      return;
    }
    const x = 20 + ((p.time - min) / Math.max(1, max - min)) * 760,
      y = 150 - (p.value / highest) * 130;
    if (previous && (p.time - previous.time > 45 * 60 * 1000 || p.epoch !== previous.epoch)) {
      if (path) paths.push(path);
      path = '';
    }
    path += `${path ? ' L' : 'M'}${x},${y}`;
  });
  if (path) paths.push(path);
  return (
    <main>
      <p>
        <a href="/reports">← Reports</a> · <a href={`/clients/${p.clientId}`}>Client policy</a>
      </p>
      <h1>{p.clientName}</h1>
      <p>
        {p.environment} · {p.product}
      </p>
      <section>
        <h2>Current status</h2>
        <Status item={p} />
        <dl>
          <dt>Registered</dt>
          <dd>{date(p.registeredAt)}</dd>
          <dt>First approved</dt>
          <dd>{date(p.firstApprovedAt)}</dd>
          <dt>Last approved</dt>
          <dd>{date(p.lastApprovedAt)}</dd>
          <dt>First grant issued</dt>
          <dd>{date(p.firstIssuedAt)}</dd>
          <dt>First acknowledged</dt>
          <dd>{date(p.firstAcknowledgedAt)}</dd>
          <dt>Current epoch acknowledged</dt>
          <dd>{date(p.currentAcknowledgedAt)}</dd>
          <dt>Last authenticated contact</dt>
          <dd>{date(p.lastContactAt)}</dd>
          <dt>Last grant expires</dt>
          <dd>{date(p.grantExpiresAt)}</dd>
        </dl>
      </section>
      <section>
        <h2>{p.product === 'dms' ? 'Active logical documents' : 'Active members'}</h2>
        <p>
          Gauge by server receipt time. Gaps and epoch changes break the line. Delayed samples
          remain in the table; the current status uses durable sequence order.
        </p>
        {points.length > 0 ? (
          <svg
            role="img"
            aria-label="Recent gauge history; exact values in the following table"
            viewBox="0 0 800 180"
          >
            {paths.map((d) => (
              <path key={d} d={d} fill="none" stroke="#215b64" strokeWidth="3" />
            ))}
            {points.map((v) =>
              v.value === null ? null : (
                <circle
                  key={v.id}
                  cx={20 + ((v.time - min) / Math.max(1, max - min)) * 760}
                  cy={150 - (v.value / highest) * 130}
                  r="3"
                  fill="#215b64"
                />
              ),
            )}
          </svg>
        ) : (
          <p>No retained reports.</p>
        )}
      </section>
      <section>
        <h2>Report history</h2>
        <p>
          Up to 96 reports per page; retained for 90 days. Gauges and cumulative totals are
          independent. Cumulative totals start at the reported counter epoch and baseline;
          unavailable values remain unknown.
        </p>
        <div className="report-table">
          <table>
            <caption>Exact customer aggregates, newest received first</caption>
            <thead>
              <tr>
                <th scope="col">Received / observed (UTC)</th>
                <th scope="col">Epoch / sequence</th>
                <th scope="col">Gauges</th>
                <th scope="col">Cumulative totals</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((i) => (
                <tr key={i.id}>
                  <td>
                    {date(i.receivedAt)}
                    <br />
                    {date(i.observedAt)}
                  </td>
                  <td>
                    <code>{i.epoch}</code>
                    <br />
                    {i.sequence ?? 'Legacy unordered'}
                  </td>
                  <td>
                    {i.report.product === 'dms' ? (
                      <>
                        Active documents: {i.report.activeDocuments ?? 'Unknown'}
                        <br />
                        Retained original bytes: {i.report.retainedOriginalBytes ?? 'Unknown'}
                        <br />
                        Pending jobs: {i.report.pendingJobs ?? 'Unknown'}
                        <br />
                        Processing ready: {String(i.report.processingReady)}
                      </>
                    ) : (
                      <>
                        Active members: {i.report.activeMembers}
                        <br />
                        Health: Unknown (not supplied)
                      </>
                    )}
                  </td>
                  <td>
                    {i.report.product === 'dms' && i.report.counters ? (
                      <>
                        Epoch: <code>{i.report.counters.epoch}</code>
                        <br />
                        Since {i.report.counters.startedAt}
                        <br />
                        Published logical documents:{' '}
                        {i.report.counters.publishedDocuments ?? 'Unknown'}
                        <br />
                        Published versions: {i.report.counters.publishedVersions ?? 'Unknown'}
                        <br />
                        Completed processing jobs:{' '}
                        {i.report.counters.completedProcessingJobs ?? 'Unknown'}
                        {i.counterReset && <p>Counter epoch reset</p>}
                      </>
                    ) : (
                      'Unknown / not supplied'
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {data.next && (
          <p>
            <a href={`/reports/${id}?${new URLSearchParams(data.next)}`}>Older reports →</a>
          </p>
        )}
      </section>
    </main>
  );
}
