import type { ReportView } from '../../server/report-service.ts';
import { Badge } from '../ui/Primitives.tsx';
export const date = (value: string | Date | null) =>
  value ? new Date(value).toISOString() : 'Unknown';
export function Status({ item }: { item: ReportView }) {
  const report = item.report;
  return (
    <>
      <div className="report-statuses">
        <Badge
          tone={
            item.policyState === 'approved'
              ? 'success'
              : item.policyState === 'pending'
                ? 'warning'
                : 'danger'
          }
        >
          Policy {item.policyState}
        </Badge>{' '}
        <Badge tone={item.freshness === 'current' ? 'success' : 'warning'}>
          {item.freshness === 'current'
            ? 'Reporting current'
            : item.freshness === 'never'
              ? 'No reports yet'
              : 'Not recently seen'}
        </Badge>
      </div>
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
