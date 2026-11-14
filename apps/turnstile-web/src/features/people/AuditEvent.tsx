import type { PeopleAuditEventDto } from '@thaarei/turnstile-contracts';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const auditActionLabel = (action: string) =>
  action.replaceAll('_', ' ').replace(/^./u, (v) => v.toUpperCase());

export function AuditEvent({ event }: { event: PeopleAuditEventDto }) {
  return (
    <Card size="sm">
      <CardHeader>
        <CardTitle>{auditActionLabel(event.action)}</CardTitle>
        <CardDescription>
          <time dateTime={event.occurredAt}>{new Date(event.occurredAt).toLocaleString()}</time> ·{' '}
          {event.source === 'access' ? 'Access change' : 'Invitation'}
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 break-words">
        <p>By {event.actorKind === 'system' ? 'System' : (event.actorName ?? 'Account')}</p>
        {event.subjectLabel && (
          <p>
            {event.subjectKind === 'invitation'
              ? 'Invitation'
              : event.subjectKind === 'role'
                ? 'Role'
                : 'Member'}
            : {event.subjectLabel}
          </p>
        )}
        <details className="member-meta">
          <summary className="cursor-pointer">Event identifiers</summary>
          <p className="break-all">Event: {event.id}</p>
          {event.actorKind === 'user' && <p className="break-all">Account: {event.actorId}</p>}
          {event.subjectId && <p className="break-all">Subject: {event.subjectId}</p>}
        </details>
        <div className="flex flex-wrap gap-2">
          {event.revisionBefore !== null && (
            <Badge variant="outline">
              Access revision {event.revisionBefore} → {event.revisionAfter}
            </Badge>
          )}
          {event.generation !== null && (
            <Badge variant="outline">Invitation generation {event.generation}</Badge>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
