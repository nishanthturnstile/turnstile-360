import { Cancel01Icon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { useQueryClient } from '@tanstack/react-query';
import {
  type ImportJobDto,
  importCreateSchema,
  importDetailSchema,
  importErrorsSchema,
  importListSchema,
  PEOPLE_IMPORT_LIMITS,
  permissionCatalogSchema,
  type RoleAssignmentRequestDto,
  type UserSessionDto,
} from '@thaarei/turnstile-contracts';
import { useEffect, useRef, useState } from 'react';
import { Notice } from '@/components/notice';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Field, FieldDescription, FieldLabel, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Progress, ProgressLabel } from '@/components/ui/progress';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { loadSession } from '../auth/product';
import { useUnsavedEntries } from '../configuration/shared';
import { usePeopleActivity } from './activity';
import { message, PeopleError, request } from './client';
import { downloadImportCsv, importErrorsCsv, importReasonLabel } from './import-export';
import { usePeopleScope } from './QueryScope';
import { invalidatePeopleDomains } from './query-cache';
import { AssignmentEditor, AssignmentSummary, usePage } from './shared';
import { useTaskConfirm, useTaskDismiss } from './TaskSheet';

const stateLabel = (job: ImportJobDto) =>
  ({
    draft: 'Ready for review',
    queued: job.reason === 'rate_limit' ? 'Waiting for allowance' : 'Queued',
    running: 'Processing',
    paused: 'Paused',
    completed: 'Completed',
    cancelled: 'Cancelled',
  })[job.state];
export function ImportProgress({ job }: { job: ImportJobDto }) {
  const total = Object.values(job.counts).reduce((a, b) => a + b, 0);
  const done = total - job.counts.pending - job.counts.processing;
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Badge variant="secondary">{stateLabel(job)}</Badge>
        <span>
          {done} of {total} rows finished
        </span>
      </div>
      <Progress value={total ? (done / total) * 100 : 0}>
        <ProgressLabel>Import progress</ProgressLabel>
      </Progress>
      <p className="panel-help">
        {job.counts.succeeded} invitations saved · {job.counts.skipped} skipped ·{' '}
        {job.counts.failed} need attention · {job.counts.cancelled} cancelled
      </p>
    </div>
  );
}
export function PeopleImports({
  session,
  onClose,
}: {
  session: UserSessionDto;
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<string>();
  const [csv, setCsv] = useState(''),
    [filename, setFilename] = useState('');
  const [assignments, setAssignments] = useState<RoleAssignmentRequestDto[]>([]);
  const [intent, setIntent] = useState<ReturnType<typeof importCreateSchema.parse>>();
  const [busy, setBusy] = useState(false),
    [failure, setFailure] = useState<unknown>();
  const [inputError, setInputError] = useState('');
  const active = usePeopleActivity();
  const catalog = usePage(
    '/api/people/catalog',
    permissionCatalogSchema,
    session.access.fingerprint,
  );
  const confirmDiscard = useTaskConfirm();
  const markSaved = useUnsavedEntries(!selected && (!!csv || !!assignments.length || busy));
  const close = () => {
    if (busy) return;
    const finish = () => {
      markSaved();
      onClose();
    };
    if (!selected && (csv || assignments.length))
      confirmDiscard(
        'Discard the unsaved CSV entries? Saved import jobs continue independently.',
        finish,
      );
    else finish();
  };
  useTaskDismiss(close);
  async function fresh() {
    const current = await loadSession({ fresh: true });
    if (current.user.id !== session.user.id || !active)
      throw new PeopleError(403, 'PERMISSION_DENIED');
    return current.csrfToken;
  }
  async function validate(recover = false) {
    setBusy(true);
    setFailure(undefined);
    setInputError('');
    try {
      const body =
        intent ?? importCreateSchema.parse({ id: crypto.randomUUID(), csv, filename, assignments });
      setIntent(body);
      const result = recover
        ? await request(`/api/people/imports/${body.id}`, importDetailSchema)
        : await request('/api/people/imports', importDetailSchema, {
            method: 'POST',
            body,
            csrf: await fresh(),
          });
      setSelected(result.job.id);
      setCsv('');
      setFilename('');
      setAssignments([]);
      setIntent(undefined);
      markSaved();
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card variant="panel" className="access-panel">
      <CardHeader className="access-panel-header">
        <Button
          variant="ghost"
          size="icon-sm"
          className="access-panel-close"
          aria-label="Close imports"
          disabled={busy}
          onClick={close}
        >
          <HugeiconsIcon icon={Cancel01Icon} />
        </Button>
        <CardTitle>
          <h2>CSV imports</h2>
        </CardTitle>
        <CardDescription>
          Invite a larger team with saved progress. Accepted jobs continue after you close this
          panel.
        </CardDescription>
      </CardHeader>
      <CardContent className="access-panel-body">
        {!!failure && (
          <Notice
            message={
              failure instanceof PeopleError && failure.status === 404
                ? 'No saved review was found. Retry validation with the same entries.'
                : failure instanceof PeopleError && failure.status === 400
                  ? 'Use one email header, valid CSV quoting and up to 500 recipient records. Check the file and try validation again.'
                  : message(failure)
            }
          />
        )}
        {!!inputError && <Notice message={inputError} />}
        {catalog.loading && <p role="status">Checking import availability…</p>}
        {!!catalog.failure && <Notice message={message(catalog.failure)} />}
        {catalog.value && !catalog.value.durableImports && (
          <Notice message="CSV imports are not available in this installation yet." />
        )}
        {catalog.value?.durableImports &&
          (selected ? (
            <ImportDetail
              key={selected}
              id={selected}
              session={session}
              fresh={fresh}
              onBack={() => {
                setSelected(undefined);
                setFailure(undefined);
              }}
            />
          ) : (
            <>
              <FieldSet disabled={busy || !!intent} className="flex flex-col gap-5">
                <Field>
                  <FieldLabel htmlFor="users-import-file">Recipients CSV</FieldLabel>
                  <Input
                    id="users-import-file"
                    type="file"
                    accept=".csv,text/csv"
                    onChange={async (e) => {
                      const file = e.target.files?.[0];
                      setInputError('');
                      setCsv('');
                      setFilename('');
                      if (!file) return;
                      if (file.size > PEOPLE_IMPORT_LIMITS.csvBytes) {
                        setInputError('Choose a CSV file up to 128 KiB.');
                        return;
                      }
                      try {
                        const text = new TextDecoder('utf-8', { fatal: true }).decode(
                          await file.arrayBuffer(),
                        );
                        setCsv(text);
                        setFilename(file.name);
                      } catch {
                        setInputError('The file must use UTF-8 text encoding.');
                      }
                    }}
                  />
                  <FieldDescription>
                    One column named email · UTF-8 · up to 500 recipients and 128 KiB. Select roles
                    below for everyone in this batch.
                  </FieldDescription>
                </Field>
                <Button
                  variant="outline"
                  className="self-start"
                  onClick={() =>
                    downloadImportCsv(
                      'invitation-template.csv',
                      'email\r\nalex@example.com\r\njordan@example.com\r\n',
                    )
                  }
                >
                  Download CSV template
                </Button>
                <AssignmentEditor session={session} value={assignments} onChange={setAssignments} />
              </FieldSet>
              {intent ? (
                <div className="flex flex-wrap gap-2">
                  <Button disabled={busy} onClick={() => void validate(true)}>
                    Check saved review
                  </Button>
                  <Button variant="outline" disabled={busy} onClick={() => void validate()}>
                    Retry validation
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() => {
                      setIntent(undefined);
                      setFailure(undefined);
                    }}
                  >
                    Edit entries
                  </Button>
                </div>
              ) : (
                <Button
                  className="self-start"
                  disabled={
                    busy ||
                    !csv ||
                    !assignments.length ||
                    assignments.some(
                      (a) => !a.roleId || (a.scope.kind === 'units' && !a.scope.unitIds.length),
                    )
                  }
                  onClick={() => void validate()}
                >
                  {busy ? 'Validating…' : 'Validate and review'}
                </Button>
              )}
              <ImportHistory
                session={session}
                onSelect={(id) => {
                  if (csv || assignments.length)
                    confirmDiscard(
                      'Discard the unsaved CSV entries and open the saved job?',
                      () => {
                        setCsv('');
                        setFilename('');
                        setAssignments([]);
                        setIntent(undefined);
                        setSelected(id);
                        markSaved();
                      },
                    );
                  else setSelected(id);
                }}
              />
            </>
          ))}
      </CardContent>
      <CardFooter className="access-panel-footer">
        <Button variant="outline" disabled={busy} onClick={close}>
          Close imports
        </Button>
      </CardFooter>
    </Card>
  );
}
function ImportHistory({
  session,
  onSelect,
}: {
  session: UserSessionDto;
  onSelect: (id: string) => void;
}) {
  const page = usePage('/api/people/imports', importListSchema, session.access.fingerprint);
  return (
    <section className="flex flex-col gap-3" aria-label="Saved import jobs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3>Saved imports</h3>
        <Button variant="ghost" onClick={page.refresh}>
          Refresh imports
        </Button>
      </div>
      {page.loading && <p role="status">Loading imports…</p>}
      {!!page.failure && <Notice message={message(page.failure)} />}
      {page.value && !page.value.items.length && (
        <p className="panel-help">
          Your validated files and accepted jobs will appear here. Saved imports are retained for up
          to 90 days.
        </p>
      )}
      <ul className="users-import-history">
        {page.value?.items.map((job) => (
          <li key={job.id}>
            <div>
              <strong>{job.filename}</strong>
              <p className="panel-help">
                {new Date(job.createdAt).toLocaleString()} · {stateLabel(job)}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => onSelect(job.id)}>
              Open import
            </Button>
          </li>
        ))}
      </ul>
    </section>
  );
}
function ImportDetail({
  id,
  session,
  fresh,
  onBack,
}: {
  id: string;
  session: UserSessionDto;
  fresh: () => Promise<string>;
  onBack: () => void;
}) {
  const [after, setAfter] = useState(0),
    [busy, setBusy] = useState(false),
    [failure, setFailure] = useState<unknown>();
  const [cancelReview, setCancelReview] = useState(false);
  const page = usePage(
    `/api/people/imports/${id}?after=${after}`,
    importDetailSchema,
    session.access.fingerprint,
  );
  const active = usePeopleActivity();
  const job = page.value?.job;
  const queryClient = useQueryClient();
  const scope = usePeopleScope();
  const lastSaved = useRef<number | undefined>(undefined);
  useEffect(() => {
    const saved = job?.counts.succeeded;
    if (saved === undefined) return;
    if (lastSaved.current !== undefined && saved > lastSaved.current)
      void invalidatePeopleDomains(queryClient, scope, [
        'members',
        'invitations',
        'roles',
        'catalog',
        'audit',
      ]);
    lastSaved.current = saved;
  }, [job?.counts.succeeded, queryClient, scope]);

  useEffect(() => {
    if (!active || page.loading || !job || !['queued', 'running'].includes(job.state)) return;
    const timer = setTimeout(page.refresh, 3000);
    return () => clearTimeout(timer);
  }, [active, page.loading, job?.state, job?.updatedAt, page.refresh, job]);
  async function action(action: 'start' | 'resume' | 'cancel') {
    if (!job) return;
    setBusy(true);
    setFailure(undefined);
    try {
      await request(`/api/people/imports/${id}/actions`, importDetailSchema, {
        method: 'POST',
        csrf: await fresh(),
        body: { action, expectedVersion: job.version },
      });
      setCancelReview(false);
      page.refresh();
    } catch (error) {
      setFailure(error);
      page.refresh();
    } finally {
      setBusy(false);
    }
  }
  async function errors() {
    setBusy(true);
    setFailure(undefined);
    try {
      const result = await request(`/api/people/imports/${id}/errors`, importErrorsSchema);
      downloadImportCsv(`import-${id}-errors.csv`, importErrorsCsv(result.rows));
    } catch (error) {
      setFailure(error);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-col gap-5">
      <div className="flex flex-wrap gap-2">
        <Button variant="ghost" disabled={busy} onClick={onBack}>
          Back to imports
        </Button>
        <Button variant="outline" disabled={busy || page.loading} onClick={page.refresh}>
          Refresh progress
        </Button>
      </div>
      {!!failure && <Notice message={message(failure)} />}
      {!!page.failure && <Notice message={message(page.failure)} />}
      {page.loading && !job && <p role="status">Loading import…</p>}
      {job && (
        <>
          <h3 className="break-words">{job.filename}</h3>
          <ImportProgress job={job} />
          {job.actorId !== session.user.id && ['draft', 'paused'].includes(job.state) && (
            <p className="panel-help">
              Only the submitting administrator can start or resume this import. You can inspect its
              progress or cancel remaining work.
            </p>
          )}
          {job.state === 'draft' && (
            <p className="panel-help">
              Review the valid recipients and shared access below. Only ready rows will be invited.
              Existing members and open invitations stay unchanged. This review expires{' '}
              {new Date(job.reviewExpiresAt).toLocaleTimeString()}.
            </p>
          )}
          {!!job.reason && (
            <Notice
              message={`${importReasonLabel(job.reason)}.${job.state === 'queued' ? ` Next check: ${new Date(job.nextAttemptAt).toLocaleString()}.` : ''}`}
            />
          )}
          <details>
            <summary>Roles and coverage for this batch</summary>
            <AssignmentSummary assignments={job.assignments} session={session} />
          </details>
          <p className="panel-help">
            Invitation limits still apply, so larger batches can take several hours. Saved means
            queued for email; mail-server acceptance and recipient acceptance are tracked in
            Invitations.
          </p>
          <div className="flex flex-wrap gap-2">
            {job.actorId === session.user.id && job.state === 'draft' && (
              <Button
                disabled={
                  busy || job.counts.pending === 0 || Date.parse(job.reviewExpiresAt) <= Date.now()
                }
                onClick={() => void action('start')}
              >
                Start import · {job.counts.pending} recipients
              </Button>
            )}
            {job.actorId === session.user.id && job.state === 'paused' && (
              <Button
                disabled={busy || job.counts.pending + job.counts.processing === 0}
                onClick={() => void action('resume')}
              >
                Resume remaining work
              </Button>
            )}
            {['draft', 'queued', 'running', 'paused'].includes(job.state) && (
              <Button variant="outline" disabled={busy} onClick={() => setCancelReview(true)}>
                Cancel remaining work
              </Button>
            )}
            <Button
              variant="outline"
              disabled={busy || job.counts.failed + job.counts.skipped + job.counts.cancelled === 0}
              onClick={() => void errors()}
            >
              Download row errors
            </Button>
          </div>
          {cancelReview && (
            <div className="flex flex-col gap-3">
              <Notice message="Completed invitations remain valid and their queued emails may still be sent. Cancel only the rows that have not been saved?" />
              <div className="flex flex-wrap gap-2">
                <Button variant="destructive" disabled={busy} onClick={() => void action('cancel')}>
                  Confirm cancellation
                </Button>
                <Button variant="outline" disabled={busy} onClick={() => setCancelReview(false)}>
                  Keep remaining work
                </Button>
              </div>
            </div>
          )}
          <div className="users-import-rows">
            <Table>
              <caption className="sr-only">CSV recipient row outcomes</caption>
              <TableHeader>
                <TableRow>
                  <TableHead>Record</TableHead>
                  <TableHead>Recipient</TableHead>
                  <TableHead>Result</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.value?.rows.map((row) => (
                  <TableRow key={row.number}>
                    <TableCell>{row.number}</TableCell>
                    <TableCell>{row.email || 'Empty address'}</TableCell>
                    <TableCell>
                      {row.state === 'pending'
                        ? 'Ready'
                        : row.state === 'processing'
                          ? 'Processing'
                          : row.state === 'succeeded'
                            ? 'Invitation saved'
                            : importReasonLabel(row.reason) || row.state}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" disabled={busy || after === 0} onClick={() => setAfter(0)}>
              First rows
            </Button>
            <Button
              variant="outline"
              disabled={busy || !page.value?.nextAfter}
              onClick={() => setAfter(page.value?.nextAfter ?? 0)}
            >
              Next rows
            </Button>
          </div>
        </>
      )}
    </div>
  );
}
