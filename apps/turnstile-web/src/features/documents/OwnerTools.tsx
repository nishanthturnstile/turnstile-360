import { useQuery } from '@tanstack/react-query';
import {
  type DocumentsUploadReceipt,
  type DocumentsWorkspaceCommand,
  documentRightSchema,
  documentsAuditPageSchema,
  documentsConnectionSchema,
  documentsGrantListSchema,
  documentsLifecycleSchema,
  documentsUploadHistorySchema,
} from '@thaarei/turnstile-contracts/documents';
import { peopleIdSchema } from '@thaarei/turnstile-contracts/runtime';
import { useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { ButtonLink } from '@/components/button-link';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldGroup, FieldLabel, FieldLegend, FieldSet } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { company } from '@/features/people/client';
import {
  documentsErrorMessage,
  documentsRead,
  draftDocumentCommand,
  executeDocumentCommand,
} from './client';
import { DocumentState } from './DocumentUi';
import { type DocumentsToolProps, documentsScope, useDocumentWork } from './use-document-work';

const recoveryPath = '/documents/recovery';
const retryable = (operation: DocumentsUploadReceipt) =>
  ['DRAFT', 'DISPATCHING', 'UNCERTAIN'].includes(operation.receipt.state);
const stateLabel = (value: string) => value.toLowerCase().replaceAll('_', ' ');

function useWritePolicy(
  props: DocumentsToolProps,
  operation: 'documents:lifecycle' | 'documents:permissions',
) {
  const { active, session } = props;
  const policy = useQuery({
    queryKey: [...documentsScope(session), '/api/documents/connection'],
    enabled: active,
    queryFn: ({ signal }) =>
      documentsRead('/api/documents/connection', documentsConnectionSchema, signal),
  });
  return (
    active &&
    !policy.isError &&
    policy.data?.productAccess === 'full' &&
    policy.data.dmsAccess === 'full' &&
    policy.data.effectiveOperations.includes(operation)
  );
}

export function Recovery(props: DocumentsToolProps) {
  const [search, setSearch] = useSearchParams();
  const selection = peopleIdSchema.safeParse(search.get('document'));
  const { scope, run, busy, message, setMessage } = useDocumentWork(props);
  const mayWrite = useWritePolicy(props, 'documents:lifecycle');
  const receipts = useQuery({
    queryKey: [...scope, 'recovery'],
    enabled: props.active,
    queryFn: ({ signal }) =>
      documentsRead('/api/documents/recovery', documentsUploadHistorySchema, signal),
  });
  return (
    <>
      <Card variant="panel">
        <CardHeader>
          <CardTitle>
            <h2>Find a document to restore</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const id = peopleIdSchema.safeParse(
                new FormData(event.currentTarget).get('document'),
              );
              if (!id.success) {
                setMessage('Enter a valid document ID.');
                return;
              }
              setMessage('');
              setSearch({ document: id.data });
            }}
          >
            <FieldGroup className="flex-row flex-wrap items-end">
              <Field className="w-full sm:max-w-sm">
                <FieldLabel htmlFor="recovery-document">Document ID</FieldLabel>
                <Input
                  key={selection.data}
                  id="recovery-document"
                  name="document"
                  defaultValue={selection.data}
                  maxLength={36}
                  required
                />
              </Field>
              <Button type="submit">Check lifecycle</Button>
            </FieldGroup>
          </form>
          {message && <Notice message={message} />}
          {receipts.error && <Notice message={documentsErrorMessage(receipts.error)} />}
          {!receipts.isError && !!receipts.data?.length && (
            <details className="documents-disclosure">
              <summary>Recorded lifecycle operations</summary>
              <ul className="mt-2 flex flex-col gap-2">
                {receipts.data
                  .filter((item) => item.documentId)
                  .map((item) => (
                    <li key={item.receipt.id} className="flex flex-wrap items-center gap-2">
                      <ButtonLink
                        variant="outline"
                        href={`${recoveryPath}?document=${item.documentId}`}
                      >
                        {item.receipt.kind === 'document.restore' ? 'Restore' : 'Delete'} ·{' '}
                        {item.documentId}
                      </ButtonLink>
                      <span>{stateLabel(item.receipt.state)}</span>
                      {retryable(item) && (
                        <Button
                          variant="outline"
                          disabled={busy || !mayWrite}
                          onClick={() =>
                            run(async (signal) => {
                              await executeDocumentCommand(item, props.session.csrfToken, signal);
                            })
                          }
                        >
                          Retry recorded operation
                        </Button>
                      )}
                    </li>
                  ))}
              </ul>
            </details>
          )}
        </CardContent>
      </Card>
      {selection.success && <Lifecycle key={selection.data} id={selection.data} {...props} />}
    </>
  );
}

export function Lifecycle({ id, ...props }: DocumentsToolProps & { id: string }) {
  const { scope, run, busy, message, setMessage } = useDocumentWork(props);
  const mayWrite = useWritePolicy(props, 'documents:lifecycle');
  const [confirm, setConfirm] = useState<{
    kind: 'document.delete' | 'document.restore';
    revision: string;
  }>();
  const [saved, setSaved] = useState<DocumentsUploadReceipt>();
  const navigate = useNavigate();
  const status = useQuery({
    queryKey: [...scope, 'lifecycle', id],
    enabled: props.active,
    queryFn: ({ signal }) =>
      documentsRead(`/api/documents/${id}/lifecycle`, documentsLifecycleSchema, signal),
    refetchInterval: ({ state }) =>
      props.active && !state.error && state.data?.restoration.state === 'PENDING' ? 2000 : false,
  });
  const current = status.isError ? undefined : status.data;
  const restoring = confirm?.kind === 'document.restore';
  async function execute(operation: DocumentsUploadReceipt, signal: AbortSignal) {
    await executeDocumentCommand(operation, props.session.csrfToken, signal);
    setSaved(undefined);
    setConfirm(undefined);
    if (operation.receipt.kind === 'document.delete') {
      void navigate(`${recoveryPath}?document=${id}`);
    } else {
      setMessage('Restore accepted. Check reassessment progress below.');
    }
  }
  return (
    <Card variant="panel">
      <CardHeader>
        <CardTitle>
          <h2>Lifecycle</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {status.isPending && <p role="status">Loading lifecycle…</p>}
        {status.error && <Notice message={documentsErrorMessage(status.error)} />}
        {message && <Notice message={message} />}
        {current && (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <DocumentState tone={current.lifecycle === 'ACTIVE' ? 'ready' : 'neutral'}>
                {stateLabel(current.lifecycle)}
              </DocumentState>
              <span className="text-muted-foreground">Revision {current.revision}</span>
            </div>
            {current.restoreDeadline && (
              <p>Restore deadline {new Date(current.restoreDeadline).toLocaleString()}</p>
            )}
            {current.restoration.state !== 'NOT_REQUESTED' && (
              <p>
                Reassessment {stateLabel(current.restoration.state)} · {current.restoration.pending}{' '}
                pending · {current.restoration.scanning} scanning · {current.restoration.completed}{' '}
                completed · {current.restoration.failed} failed
              </p>
            )}
            {current.lifecycle === 'ACTIVE' && (
              <p>Original {current.downloadable ? 'available' : 'unavailable'}</p>
            )}
            {current.lifecycle === 'ACTIVE' &&
              company(props.session, 'turnstile:documents:read') && (
                <ButtonLink href={`/documents/${id}`} className="self-start" variant="outline">
                  Open document
                </ButtonLink>
              )}
            {mayWrite && !confirm && !saved && current.lifecycle === 'ACTIVE' && (
              <Button
                className="self-start"
                variant="destructive"
                disabled={busy}
                onClick={() => setConfirm({ kind: 'document.delete', revision: current.revision })}
              >
                Delete document
              </Button>
            )}
            {mayWrite && !confirm && !saved && current.lifecycle === 'SOFT_DELETED' && (
              <Button
                className="self-start"
                disabled={
                  busy ||
                  (!!current.restoreDeadline && Date.parse(current.restoreDeadline) <= Date.now())
                }
                onClick={() => setConfirm({ kind: 'document.restore', revision: current.revision })}
              >
                Restore document
              </Button>
            )}
            {confirm && !saved && (
              <>
                <p>
                  {restoring
                    ? 'Restore the document and reassess retained versions.'
                    : 'Delete this document from active use and suspend access to its original.'}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant={restoring ? 'default' : 'destructive'}
                    disabled={busy || !mayWrite}
                    onClick={() =>
                      run(async (signal) => {
                        const operation = await draftDocumentCommand(
                          {
                            kind: confirm.kind,
                            documentId: id,
                            expectedRevision: confirm.revision,
                          },
                          props.session.csrfToken,
                          signal,
                        );
                        setSaved(operation);
                        await execute(operation, signal);
                      })
                    }
                  >
                    {restoring ? 'Confirm restore' : 'Confirm deletion'}
                  </Button>
                  <Button variant="outline" disabled={busy} onClick={() => setConfirm(undefined)}>
                    Back
                  </Button>
                </div>
              </>
            )}
          </>
        )}
        {saved && (
          <div className="flex flex-wrap gap-2">
            <Button
              className="self-start"
              disabled={busy || !mayWrite}
              onClick={() => run((signal) => execute(saved, signal))}
            >
              Retry saved operation
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                setSaved(undefined);
                setConfirm(undefined);
              }}
            >
              Review current state
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

type Grant = ReturnType<typeof documentsGrantListSchema.parse>['grants'][number];
type GrantDraft = Grant & { key: string };
const rightLabels: Record<Grant['rights'][number], string> = {
  READ: 'Read',
  EDIT_METADATA: 'Edit metadata',
  ADD_VERSION: 'Add versions',
};
export function ApplicationAccess({ id, ...props }: DocumentsToolProps & { id: string }) {
  const { scope, busy, run, message, setMessage } = useDocumentWork(props);
  const mayWrite = useWritePolicy(props, 'documents:permissions');
  const [draft, setDraft] = useState<{ revision: string; grants: GrantDraft[] }>();
  const [receipt, setReceipt] = useState<DocumentsUploadReceipt>();
  const grants = useQuery({
    queryKey: [...scope, 'grants', id],
    enabled: props.active,
    queryFn: ({ signal }) =>
      documentsRead(`/api/documents/${id}/permissions`, documentsGrantListSchema, signal),
  });
  const current = grants.isError ? undefined : grants.data;
  async function save(operation: DocumentsUploadReceipt, signal: AbortSignal) {
    await executeDocumentCommand(operation, props.session.csrfToken, signal);
    setReceipt(undefined);
    setDraft(undefined);
    setMessage('Application access updated.');
  }
  function revise(key: string, update: Partial<Grant>) {
    setDraft(
      (previous) =>
        previous && {
          ...previous,
          grants: previous.grants.map((grant) =>
            grant.key === key ? { ...grant, ...update } : grant,
          ),
        },
    );
  }
  function submit() {
    if (!draft || !current || current.revision !== draft.revision || !mayWrite) return;
    const grants = draft.grants.map(({ applicationId, rights }) => ({
      applicationId: applicationId.trim(),
      rights,
    }));
    const parsed = documentsGrantListSchema.safeParse({
      documentId: id,
      revision: draft.revision,
      grants,
    });
    if (!parsed.success) {
      setMessage('Enter a distinct provisioned application ID and select rights for each row.');
      return;
    }
    const command: DocumentsWorkspaceCommand = {
      kind: 'permissions.replace',
      documentId: id,
      expectedRevision: draft.revision,
      payload: { grants: parsed.data.grants },
    };
    run(async (signal) => {
      const operation = await draftDocumentCommand(command, props.session.csrfToken, signal);
      setReceipt(operation);
      await save(operation, signal);
    });
  }
  return (
    <Card variant="panel">
      <CardHeader>
        <CardTitle>
          <h2>Application access</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        <p>These grants apply to provisioned DMS applications.</p>
        {grants.isPending && <p role="status">Loading application access…</p>}
        {grants.error && <Notice message={documentsErrorMessage(grants.error)} />}
        {message && <Notice message={message} />}
        {current && (
          <>
            <p>Saved revision {current.revision}</p>
            {current.grants.length ? (
              <ul className="documents-grants-list">
                {current.grants.map((grant) => (
                  <li key={grant.applicationId}>
                    <span className="documents-record-id">{grant.applicationId}</span>
                    <div className="flex flex-wrap gap-1.5">
                      {grant.rights.map((right) => (
                        <DocumentState key={right}>{rightLabels[right]}</DocumentState>
                      ))}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p>No application grants.</p>
            )}
            {mayWrite && !draft && (
              <Button
                className="self-start"
                onClick={() =>
                  setDraft({
                    revision: current.revision,
                    grants: current.grants.map((grant) => ({ ...grant, key: crypto.randomUUID() })),
                  })
                }
              >
                Edit application access
              </Button>
            )}
          </>
        )}
        {draft && (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (!busy && !receipt) submit();
            }}
          >
            <FieldGroup>
              {draft.grants.map((grant, i) => (
                <FieldSet key={grant.key} className="documents-form-block">
                  <FieldLegend>Application {i + 1}</FieldLegend>
                  <Field>
                    <FieldLabel htmlFor={`application-${grant.key}`}>
                      Provisioned application ID
                    </FieldLabel>
                    <Input
                      id={`application-${grant.key}`}
                      value={grant.applicationId}
                      maxLength={36}
                      required
                      disabled={busy || !!receipt}
                      onChange={(event) => revise(grant.key, { applicationId: event.target.value })}
                    />
                  </Field>
                  <FieldGroup className="flex-row flex-wrap">
                    {documentRightSchema.options.map((right) => (
                      <Field key={right} orientation="horizontal" className="w-auto">
                        <Checkbox
                          id={`${grant.key}-${right}`}
                          checked={grant.rights.includes(right)}
                          disabled={busy || !!receipt}
                          onCheckedChange={(checked) =>
                            revise(grant.key, {
                              rights: checked
                                ? [...grant.rights, right]
                                : grant.rights.filter((item) => item !== right),
                            })
                          }
                        />
                        <FieldLabel htmlFor={`${grant.key}-${right}`}>
                          {rightLabels[right]}
                        </FieldLabel>
                      </Field>
                    ))}
                  </FieldGroup>
                  <Button
                    variant="outline"
                    type="button"
                    disabled={busy || !!receipt}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        grants: draft.grants.filter(({ key }) => key !== grant.key),
                      })
                    }
                  >
                    Remove application
                  </Button>
                </FieldSet>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  disabled={busy || !!receipt || draft.grants.length >= 64}
                  onClick={() =>
                    setDraft({
                      ...draft,
                      grants: [
                        ...draft.grants,
                        { key: crypto.randomUUID(), applicationId: '', rights: [] },
                      ],
                    })
                  }
                >
                  Add application
                </Button>
                {current && current.revision !== draft.revision && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy}
                    onClick={() => {
                      setReceipt(undefined);
                      setDraft({ ...draft, revision: current.revision });
                    }}
                  >
                    Use saved revision {current.revision}
                  </Button>
                )}
                {receipt && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={busy || !mayWrite}
                    onClick={() => run((signal) => save(receipt, signal))}
                  >
                    Retry saved operation
                  </Button>
                )}
                <Button
                  type="submit"
                  disabled={busy || !mayWrite || !!receipt || current?.revision !== draft.revision}
                >
                  Replace grants
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  disabled={busy}
                  onClick={() => {
                    setDraft(undefined);
                    setReceipt(undefined);
                  }}
                >
                  Back
                </Button>
              </div>
            </FieldGroup>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

export function Activity({ id, session, active }: DocumentsToolProps & { id?: string }) {
  const [params] = useSearchParams();
  const cursor = params.get('cursor');
  const query = cursor ? `?${new URLSearchParams({ cursor })}` : '';
  const base = id ? `/documents/${id}/audit` : '/documents/audit';
  const audit = useQuery({
    queryKey: [...documentsScope(session), base, cursor],
    enabled: active,
    queryFn: ({ signal }) => documentsRead(`/api${base}${query}`, documentsAuditPageSchema, signal),
  });
  const data = audit.isError ? undefined : audit.data;
  const href = (next?: string) => {
    const query = new URLSearchParams(id ? { tab: 'activity' } : {});
    if (next) query.set('cursor', next);
    return `${id ? `/documents/${id}` : '/documents/activity'}${query.size ? `?${query}` : ''}`;
  };
  return (
    <Card variant="panel">
      <CardHeader>
        <CardTitle>
          <h2>{id ? 'Document activity' : 'Application activity'}</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {audit.isPending && <p role="status">Loading activity…</p>}
        {audit.error && <Notice message={documentsErrorMessage(audit.error)} />}
        {data && data.items.length === 0 && <p>No activity on this page.</p>}
        {data && data.items.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Time</TableHead>
                <TableHead scope="col">Event</TableHead>
                <TableHead scope="col">Actor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {data.items.map((item) => (
                <TableRow key={item.id}>
                  <TableCell>
                    <time dateTime={item.createdAt}>
                      {new Date(item.createdAt).toLocaleString()}
                    </time>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {item.action === 'document.download-authorized'
                      ? 'Download authorized'
                      : item.action.replaceAll(/[.-]/g, ' ')}
                    <p className="break-all">{item.resourceId}</p>
                    {item.requestId && (
                      <p className="break-all text-muted-foreground">Request {item.requestId}</p>
                    )}
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    <p className="break-all">
                      {item.actor.kind} · {item.actor.id}
                    </p>
                    {item.assertedHuman && (
                      <p className="break-all">
                        Application-asserted subject {item.assertedHuman.subject}
                      </p>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <div className="flex gap-2">
          {cursor && (
            <ButtonLink variant="outline" href={href()}>
              First page
            </ButtonLink>
          )}
          {data?.nextCursor && (
            <ButtonLink variant="outline" href={href(data.nextCursor)}>
              Next page
            </ButtonLink>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
