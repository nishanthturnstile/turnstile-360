import type { ReportView } from '../../server/report-service.ts';
export const date = (value: string | Date | null) =>
  value ? new Date(value).toISOString() : 'Unknown';
export function Status({ item }: { item: ReportView }) {
  const report = item.report;
  return (
    <>
      <dl>
        <dt>Central policy</dt>
        <dd>
          {item.policyState} · revision {item.revision}
        </dd>
        <dt>Reporting</dt>
        <dd>
          {item.freshness} · received {date(item.receivedAt)}
        </dd>
        <dt>Observed at customer</dt>
        <dd>{date(item.observedAt)}</dd>
        <dt>Customer-reported health</dt>
        <dd>
          {!report
            ? 'Unknown'
            : report.product === 'dms'
              ? report.processingReady
                ? 'Processing ready'
                : 'Processing not ready'
              : 'Unknown'}
        </dd>
        <dt>Customer-applied policy</dt>
        <dd>
          {report?.localState ?? 'Unknown'} · revision {report?.appliedPolicyRevision ?? 'unknown'}
        </dd>
        <dt>Reported version</dt>
        <dd>
          {report?.buildVersion ?? 'Unknown'} · review {item.versionReview}
        </dd>
      </dl>
      {item.notices.length > 0 && (
        <ul className="notice">
          {item.notices.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>
      )}
    </>
  );
}
