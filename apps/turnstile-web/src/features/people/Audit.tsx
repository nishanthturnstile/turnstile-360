import {
  auditActions,
  peopleAuditResponseSchema,
  type UserSessionDto,
} from '@thaarei/turnstile-contracts';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Spinner } from '@/components/ui/spinner';
import { AccessEmpty, Reload } from './AccessViews';
import { AuditEvent, auditActionLabel } from './AuditEvent';
import { auditCsv } from './audit-export';
import { message } from './client';
import { usePage } from './shared';

export function PeopleAudit({ session }: { session: UserSessionDto }) {
  const [params, setParams] = useSearchParams();
  const [from, setFrom] = useState(params.get('from')?.slice(0, 10) ?? '');
  const [to, setTo] = useState(params.get('to')?.slice(0, 10) ?? '');
  const [invalid, setInvalid] = useState(false);
  const fromParam = params.get('from');
  const toParam = params.get('to');
  useEffect(() => {
    setFrom(fromParam?.slice(0, 10) ?? '');
    setTo(toParam?.slice(0, 10) ?? '');
    setInvalid(false);
  }, [fromParam, toParam]);
  const query = new URLSearchParams();
  for (const key of ['source', 'action', 'subjectId', 'from', 'to', 'cursor']) {
    const value = params.get(key);
    if (value) query.set(key, value);
  }
  query.set('limit', '25');
  const page = usePage(
    `/api/people/audit?${query}`,
    peopleAuditResponseSchema,
    session.access.fingerprint,
  );
  const filter = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    next.delete('cursor');
    if (value) next.set(key, value);
    else next.delete(key);
    setParams(next);
  };
  const exportPage = () => {
    if (!page.value || page.loading || page.failure) return;
    const url = URL.createObjectURL(
      new Blob([auditCsv(page.value.items)], { type: 'text/csv;charset=utf-8' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = 'turnstile-user-activity.csv';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 0);
  };
  return (
    <section className="flex flex-col gap-5" aria-label="Users activity">
      <div className="users-section-heading">
        <div>
          <h2>Activity</h2>
          <p>Recorded access changes and invitation events.</p>
        </div>
        <Button
          variant="outline"
          disabled={page.loading || !!page.failure || !page.value?.items.length}
          onClick={exportPage}
        >
          Export displayed events
        </Button>
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (from && to && from > to) {
            setInvalid(true);
            return;
          }
          setInvalid(false);
          const next = new URLSearchParams(params);
          next.delete('cursor');
          for (const [key, value] of [
            ['from', from ? `${from}T00:00:00.000Z` : ''],
            ['to', to ? `${to}T23:59:59.999Z` : ''],
          ] as const) {
            if (value) next.set(key, value);
            else next.delete(key);
          }
          setParams(next);
        }}
      >
        <FieldGroup className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Field>
            <FieldLabel htmlFor="audit-source">Event source</FieldLabel>
            <NativeSelect
              id="audit-source"
              value={params.get('source') ?? ''}
              onChange={(e) => filter('source', e.target.value)}
            >
              <option value="">All sources</option>
              <option value="access">Access changes</option>
              <option value="invitations">Invitations</option>
            </NativeSelect>
          </Field>
          <Field>
            <FieldLabel htmlFor="audit-action">Action</FieldLabel>
            <NativeSelect
              id="audit-action"
              value={params.get('action') ?? ''}
              onChange={(e) => filter('action', e.target.value)}
            >
              <option value="">All actions</option>
              {auditActions.map((action) => (
                <option key={action} value={action}>
                  {auditActionLabel(action)}
                </option>
              ))}
            </NativeSelect>
          </Field>
          <Field data-invalid={invalid}>
            <FieldLabel htmlFor="audit-from">From (UTC)</FieldLabel>
            <Input
              type="date"
              id="audit-from"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              aria-invalid={invalid}
            />
          </Field>
          <Field data-invalid={invalid}>
            <FieldLabel htmlFor="audit-to">Through (UTC)</FieldLabel>
            <Input
              type="date"
              id="audit-to"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              aria-invalid={invalid}
            />
          </Field>
        </FieldGroup>
        <div className="flex flex-wrap gap-2 mt-3">
          <Button variant="outline" type="submit">
            Apply dates
          </Button>
          <Reload loading={page.loading} onClick={page.refresh} />
          {params.get('subjectId') && (
            <Button variant="ghost" type="button" onClick={() => filter('subjectId', '')}>
              Show all subjects
            </Button>
          )}
        </div>
        {invalid && (
          <p className="field-error" role="alert">
            Choose an end date on or after the start date.
          </p>
        )}
      </form>
      <p className="panel-help">
        Events from the last {page.value?.retentionDays ?? 90} days are available. Exports contain
        only the displayed page. Historical events show recorded facts and revisions; older field
        values are not reconstructed. Names use current or last verified product records and may
        differ from names at the time of an event. Stable IDs are available under Event identifiers.
      </p>
      {page.loading && !page.value && (
        <p className="picker-loading" role="status">
          <Spinner />
          Loading activity…
        </p>
      )}
      {page.refreshing && (
        <p className="picker-loading" role="status">
          Updating activity…
        </p>
      )}
      {!!page.failure && <Notice message={message(page.failure)} />}
      {!page.loading && !page.failure && !page.value?.items.length && (
        <AccessEmpty
          title="No matching activity"
          description="Try another action, source or date range."
        />
      )}
      {!page.failure &&
        page.value?.items.map((event) => (
          <AuditEvent key={`${event.source}:${event.id}`} event={event} />
        ))}
      <nav aria-label="Activity pages" className="flex flex-wrap gap-2">
        {params.has('cursor') && (
          <Button variant="outline" onClick={() => filter('cursor', '')}>
            First events
          </Button>
        )}
        <Button
          variant="outline"
          disabled={page.loading || !!page.failure || !page.value?.nextCursor}
          onClick={() => filter('cursor', page.value?.nextCursor ?? '')}
        >
          Older events
        </Button>
      </nav>
    </section>
  );
}
