import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type DocumentsBatchPayload,
  type DocumentsBatchStatus,
  type DocumentsUploadReceipt,
  type DocumentsWorkspaceCommand,
  documentsBatchManifestSchema,
  documentsBatchPayloadSchema,
  documentsBatchStatusSchema,
  documentsConnectionSchema,
  documentsDetailSchema,
  documentsUploadHistorySchema,
  documentsUploadReceiptSchema,
} from '@thaarei/turnstile-contracts/documents';
import { peopleIdSchema, type UserSessionDto } from '@thaarei/turnstile-contracts/runtime';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ButtonLink } from '@/components/button-link';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
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
  DocumentsError,
  documentsErrorMessage,
  documentsRead,
  draftDocumentCommand,
  executeDocumentCommand,
} from './client';
import { DocumentSavedEntry } from './DocumentUi';
import { putDocumentFile, sha256 } from './file-transfer';

const base = '/documents/batches';
type FileMap = Record<string, File | undefined>;
type Source = { itemId: string; file: File; target: string };
type Execute = (
  command: DocumentsWorkspaceCommand,
  signal: AbortSignal,
) => ReturnType<typeof executeDocumentCommand>;
type Run = (work: (signal: AbortSignal) => Promise<void>) => void;
const text = (state: string) => state.toLowerCase().replaceAll('_', ' ');

export function Batches({
  session,
  active,
  onCheck,
}: {
  session: UserSessionDto;
  active: boolean;
  onCheck: (fresh?: boolean) => Promise<boolean>;
}) {
  const [params, setParams] = useSearchParams();
  const id = peopleIdSchema.safeParse(params.get('batch'));
  const operationId = peopleIdSchema.safeParse(params.get('operation'));
  const [files, setFiles] = useState<{ id: string; values: FileMap }>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const running = useRef<AbortController | null>(null);
  const cache = useQueryClient();
  const scope = [
    'documents',
    session.user.id,
    session.access.fingerprint,
    session.access.accessRevision,
  ];
  const upload = company(session, 'turnstile:documents:upload');
  const read = company(session, 'turnstile:documents:read');
  const list = useQuery({
    queryKey: [...scope, 'batches'],
    enabled: active && upload,
    queryFn: ({ signal }) =>
      documentsRead('/api/documents/batches', documentsUploadHistorySchema, signal),
  });
  const selectedOperation = useQuery({
    queryKey: [...scope, 'batch-operation', operationId.data],
    enabled: active && upload && operationId.success && !id.success,
    queryFn: ({ signal }) =>
      documentsRead(
        `/api/documents/operations/${operationId.data}`,
        documentsUploadReceiptSchema,
        signal,
      ),
  });
  const policy = useQuery({
    queryKey: [...scope, '/api/documents/connection'],
    enabled: active && upload,
    queryFn: ({ signal }) =>
      documentsRead('/api/documents/connection', documentsConnectionSchema, signal),
  });
  const mayControl =
    active &&
    upload &&
    !policy.isError &&
    policy.data?.productAccess === 'full' &&
    policy.data.dmsAccess === 'full' &&
    policy.data.effectiveOperations.includes('upload-batches:control');
  const mayStart =
    mayControl &&
    policy.data?.effectiveOperations.includes('uploads:control') &&
    policy.data.admission.state === 'enabled' &&
    policy.data.admission.formats.includes('text/plain') &&
    policy.data.admission.profiles.includes('secure-only');
  useEffect(() => () => running.current?.abort(), []);
  useEffect(() => {
    if (!active) running.current?.abort();
  }, [active]);

  const run: Run = (work) => {
    if (!active || running.current) return;
    const attempt = new AbortController();
    running.current = attempt;
    setBusy(true);
    setMessage('');
    void work(attempt.signal)
      .catch((error: unknown) => {
        if (attempt.signal.aborted) return;
        if (error instanceof DocumentsError && [401, 403].includes(error.status)) void onCheck();
        setMessage(documentsErrorMessage(error));
      })
      .finally(() => {
        running.current = null;
        setBusy(false);
        if (!attempt.signal.aborted) void cache.invalidateQueries({ queryKey: scope });
      });
  };

  const execute: Execute = async (command, signal) =>
    executeDocumentCommand(
      await draftDocumentCommand(command, session.csrfToken, signal),
      session.csrfToken,
      signal,
    );
  const retry = (saved: DocumentsUploadReceipt, signal: AbortSignal) =>
    executeDocumentCommand(saved, session.csrfToken, signal);
  const open = (batch: string) => {
    setMessage('');
    setParams({ batch });
  };
  const saved =
    !selectedOperation.isError && selectedOperation.data?.receipt.kind === 'batch.create'
      ? selectedOperation.data
      : undefined;
  return (
    <>
      {message && <Notice message={message} />}
      {policy.error && <Notice message={documentsErrorMessage(policy.error)} />}
      {selectedOperation.error && (
        <Notice message={documentsErrorMessage(selectedOperation.error)} />
      )}
      {id.success ? (
        <>
          <ButtonLink href={base} variant="outline" className="self-start">
            Saved batches
          </ButtonLink>
          <BatchDetail
            key={id.data}
            id={id.data}
            cursor={params.get('cursor')}
            scope={scope}
            {...{
              active,
              read,
              upload,
              mayControl: !!mayControl,
              mayStart: !!mayStart,
              busy,
              run,
              execute,
              retry,
              onCheck,
            }}
            initialFiles={files?.id === id.data ? files.values : {}}
          />
        </>
      ) : (
        <div className="documents-workflow">
          <div className="flex min-w-0 flex-col gap-4">
            {saved && (
              <Card variant="panel">
                <CardHeader>
                  <CardTitle>
                    <h2>Saved batch operation</h2>
                  </CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col items-start gap-3">
                  <p className="break-all">
                    {saved.receipt.id} · {text(saved.receipt.state)}
                  </p>
                  {saved.batchId ? (
                    <Button onClick={() => open(saved.batchId as string)}>Open batch</Button>
                  ) : ['DRAFT', 'UNCERTAIN', 'DISPATCHING'].includes(saved.receipt.state) ? (
                    <Button
                      disabled={busy || !mayControl}
                      onClick={() =>
                        run(async (signal) => {
                          const result = await retry(saved, signal);
                          if (result.batchId) open(result.batchId);
                        })
                      }
                    >
                      Retry saved batch
                    </Button>
                  ) : (
                    <p>Keep the operation ID for administrator review.</p>
                  )}
                  <ButtonLink href={base} variant="ghost">
                    Back to batches
                  </ButtonLink>
                </CardContent>
              </Card>
            )}
            {upload && !operationId.success && (
              <BatchDraft
                session={session}
                canCreate={!!mayStart}
                canVersion={read && !!policy.data?.effectiveOperations.includes('versions:write')}
                maxFileBytes={policy.data?.admission.limits.maxFileBytes ?? 0}
                {...{ busy, run }}
                onSaved={(batch, selected) => {
                  setFiles({ id: batch, values: selected });
                  open(batch);
                }}
                onDraft={(operation) => setParams({ operation }, { replace: true })}
              />
            )}
          </div>
          <Card variant="panel">
            <CardHeader>
              <CardTitle>
                <h2>Saved batches</h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="documents-saved-list">
              {list.error && <Notice message={documentsErrorMessage(list.error)} />}
              {upload && list.isPending && <p role="status">Loading saved batches…</p>}
              {list.data?.length === 0 && <p>No batches have been recorded.</p>}
              {list.data?.map((row) => (
                <ButtonLink
                  key={row.receipt.id}
                  variant="outline"
                  className="max-w-full"
                  href={`${base}?${row.batchId ? `batch=${row.batchId}` : `operation=${row.receipt.id}`}`}
                >
                  <DocumentSavedEntry
                    title={row.batchId ? 'Upload batch' : 'Batch draft'}
                    state={row.receipt.state}
                    savedAt={row.receipt.createdAt}
                  />
                </ButtonLink>
              ))}
              {read && (
                <form
                  className="flex flex-wrap items-end gap-2"
                  onSubmit={(event) => {
                    event.preventDefault();
                    const next = peopleIdSchema.safeParse(
                      new FormData(event.currentTarget).get('batch'),
                    );
                    if (next.success) open(next.data);
                    else setMessage('Enter a valid batch ID.');
                  }}
                >
                  <Field className="w-auto">
                    <FieldLabel htmlFor="known-batch">Batch ID</FieldLabel>
                    <Input id="known-batch" name="batch" required />
                  </Field>
                  <Button type="submit" variant="outline">
                    Open batch
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}

function BatchDraft({
  session,
  canCreate,
  canVersion,
  maxFileBytes,
  busy,
  run,
  onDraft,
  onSaved,
}: {
  session: UserSessionDto;
  canCreate: boolean;
  canVersion: boolean;
  maxFileBytes: number;
  busy: boolean;
  run: Run;
  onDraft: (id: string) => void;
  onSaved: (id: string, files: FileMap) => void;
}) {
  const [sources, setSources] = useState<Source[]>([]);
  const [manifest, setManifest] = useState<DocumentsBatchPayload>();
  const [message, setMessage] = useState('');
  async function prepare(signal: AbortSignal) {
    setMessage('');
    if (
      !sources.length ||
      sources.length > 100 ||
      sources.some(
        ({ file }) =>
          file.size < 1 ||
          file.size > maxFileBytes ||
          (file.type ? file.type !== 'text/plain' : !/\.txt$/i.test(file.name)),
      )
    ) {
      setMessage('Choose 1 to 100 nonempty text files within the current file size limit.');
      return;
    }
    const items: DocumentsBatchPayload['items'] = [];
    const documents = new Map<string, ReturnType<typeof documentsDetailSchema.parse>>();
    for (const { itemId, file, target } of sources) {
      const digest = await sha256(await file.arrayBuffer());
      signal.throwIfAborted();
      const descriptor = {
        title: file.name,
        fileName: file.name,
        size: file.size,
        contentType: 'text/plain' as const,
        profile: 'secure-only' as const,
        metadata: {},
        sha256: digest,
      };
      if (!target.trim()) {
        items.push({ itemId, operation: 'create', descriptor });
        continue;
      }
      const id = peopleIdSchema.safeParse(target.trim());
      if (!canVersion || !id.success) {
        setMessage(`Enter an owned document ID for ${file.name}.`);
        return;
      }
      const current =
        documents.get(id.data) ??
        (await documentsRead(`/api/documents/${id.data}`, documentsDetailSchema, signal));
      if (current.ownership !== 'owned' || current.id !== id.data) {
        setMessage(`Use an owned document for ${file.name}.`);
        return;
      }
      documents.set(id.data, current);
      items.push({
        itemId,
        operation: 'new-version',
        documentId: current.id,
        expectedRevision: current.revision,
        descriptor: { ...descriptor, title: current.title, metadata: current.metadata },
      });
    }
    const result = documentsBatchPayloadSchema.safeParse({ items });
    if (!result.success) {
      setMessage('Check filenames and manifest size before creating the batch.');
      return;
    }
    setManifest(result.data);
  }
  return (
    <Card variant="panel">
      <CardHeader>
        <CardTitle>
          <h2>New batch</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {!canCreate && (
          <Notice message="Batch upload requires full access and secure-only text admission in both products." />
        )}
        {message && <Notice message={message} />}
        {manifest ? (
          <>
            <ul className="max-h-64 overflow-auto">
              {manifest.items.map((item) => (
                <li key={item.itemId} className="break-all py-1">
                  {item.descriptor.fileName} ·{' '}
                  {item.operation === 'create'
                    ? 'New document'
                    : `Version of ${item.descriptor.title} · Revision ${item.expectedRevision}`}
                </li>
              ))}
            </ul>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy || !canCreate}
                onClick={() =>
                  run(async (signal) => {
                    const saved = await draftDocumentCommand(
                      { kind: 'batch.create', payload: manifest },
                      session.csrfToken,
                      signal,
                    );
                    const selected = Object.fromEntries(
                      sources.map(({ itemId, file }) => [itemId, file]),
                    );
                    try {
                      const result = await executeDocumentCommand(saved, session.csrfToken, signal);
                      if (!result.batchId) throw new Error('Missing batch receipt');
                      onSaved(result.batchId, selected);
                    } catch (error) {
                      if (!signal.aborted) onDraft(saved.receipt.id);
                      throw error;
                    }
                  })
                }
              >
                Create batch
              </Button>
              <Button variant="outline" disabled={busy} onClick={() => setManifest(undefined)}>
                Edit selection
              </Button>
            </div>
          </>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (canCreate) run(prepare);
            }}
          >
            <FieldGroup>
              <Field className="documents-file-field">
                <FieldLabel htmlFor="batch-source-files">Plain text files</FieldLabel>
                <Input
                  id="batch-source-files"
                  type="file"
                  multiple
                  accept=".txt,text/plain"
                  disabled={busy || !canCreate}
                  onChange={(event) => {
                    const chosen = Array.from(event.currentTarget.files ?? []);
                    setMessage(chosen.length > 100 ? 'Select at most 100 files.' : '');
                    setSources(
                      chosen.length <= 100
                        ? chosen.map((file) => ({ itemId: crypto.randomUUID(), file, target: '' }))
                        : [],
                    );
                  }}
                />
              </Field>
              {canVersion && sources.length > 0 && (
                <p>Enter a document ID beside a file to add it as a version.</p>
              )}
              {sources.map(({ itemId, file, target }) => (
                <Field key={itemId}>
                  {canVersion ? (
                    <>
                      <FieldLabel htmlFor={`target-${itemId}`} className="break-all">
                        {file.name} · Document ID
                      </FieldLabel>
                      <Input
                        id={`target-${itemId}`}
                        value={target}
                        maxLength={36}
                        disabled={busy}
                        onChange={(event) =>
                          setSources(
                            sources.map((item) =>
                              item.itemId === itemId
                                ? { ...item, target: event.target.value }
                                : item,
                            ),
                          )
                        }
                      />
                    </>
                  ) : (
                    <p className="break-all">{file.name}</p>
                  )}
                </Field>
              ))}
              <Button type="submit" disabled={busy || !canCreate || !sources.length}>
                Review manifest
              </Button>
            </FieldGroup>
          </form>
        )}
      </CardContent>
    </Card>
  );
}

function BatchDetail({
  id,
  cursor,
  scope,
  active,
  read,
  upload,
  mayControl,
  mayStart,
  busy,
  run,
  execute,
  retry,
  onCheck,
  initialFiles,
}: {
  id: string;
  cursor: string | null;
  scope: (string | number)[];
  active: boolean;
  read: boolean;
  upload: boolean;
  mayControl: boolean;
  mayStart: boolean;
  busy: boolean;
  run: Run;
  execute: Execute;
  retry: (operation: DocumentsUploadReceipt, signal: AbortSignal) => ReturnType<Execute>;
  onCheck: (fresh?: boolean) => Promise<boolean>;
  initialFiles: FileMap;
}) {
  const path = `/api${base}/${id}`;
  const [files, setFiles] = useState(initialFiles);
  const [messages, setMessages] = useState<Record<string, string>>({});
  const [confirm, setConfirm] = useState<'batch.close' | 'batch.cancel'>();
  const manifest = useQuery({
    queryKey: [...scope, path, 'manifest'],
    enabled: active && upload,
    queryFn: ({ signal }) =>
      documentsRead(`${path}/manifest`, documentsBatchManifestSchema, signal),
  });
  const status = useQuery({
    queryKey: [...scope, path, cursor],
    enabled: active && read,
    queryFn: ({ signal }) =>
      documentsRead(
        `${path}${cursor ? `?${new URLSearchParams({ cursor })}` : ''}`,
        documentsBatchStatusSchema,
        signal,
      ),
    refetchInterval: ({ state }) =>
      active &&
      !state.error &&
      state.data &&
      (state.data.counts.upload.OBJECT_VERIFIED > 0 ||
        state.data.counts.security.PENDING > 0 ||
        (state.data.counts.processing.QUEUED ?? 0) > 0 ||
        (state.data.counts.processing.RUNNING ?? 0) > 0)
        ? 5000
        : false,
  });
  const operations = useQuery({
    queryKey: [...scope, path, 'operations'],
    enabled: active && upload,
    queryFn: ({ signal }) =>
      documentsRead(`${path}/operations`, documentsUploadHistorySchema, signal),
  });
  useEffect(() => {
    if (status.error instanceof DocumentsError && [401, 403].includes(status.error.status))
      void onCheck();
  }, [onCheck, status.error]);
  const batch = status.isError ? undefined : status.data;
  const local = new Map(
    (manifest.isError ? [] : (manifest.data?.items ?? [])).map((item) => [item.itemId, item]),
  );
  const visible =
    batch?.items ??
    Array.from(local.values(), (item) => ({
      ...item,
      state: null,
      session: null,
      admissionError: null,
      retryAfterSeconds: null,
    }));
  const selected = visible.filter((item) => {
    if (!files[item.itemId] || !local.has(item.itemId)) return false;
    if (item.admissionError && item.retryAfterSeconds === null) return false;
    if (item.session)
      return item.session.upload === 'INITIATED' && !item.session.completionRequested;
    return item.state === 'UNSTARTED' || item.state === null || (item.state === 'BOUND' && !read);
  });

  async function transfer(signal: AbortSignal) {
    for (const item of selected) {
      const expected = local.get(item.itemId);
      const file = files[item.itemId];
      if (!file || !expected) continue;
      if (
        file.name !== expected.fileName ||
        file.size !== expected.size ||
        (await sha256(await file.arrayBuffer())) !== expected.sha256
      ) {
        setMessages((previous) => ({
          ...previous,
          [item.itemId]: 'Select the original file with matching name, size and SHA-256.',
        }));
        continue;
      }
      signal.throwIfAborted();
      try {
        const saved = await execute(
          { kind: 'batch.item', batchId: id, itemId: item.itemId },
          signal,
        );
        if (!saved.uploadId) throw new Error('Missing upload binding');
        const cap =
          saved.transfer ??
          (await execute({ kind: 'upload.refresh', uploadId: saved.uploadId }, signal)).transfer;
        if (!cap) throw new Error('Missing transfer');
        await putDocumentFile(cap, file, signal);
        await execute({ kind: 'upload.complete', uploadId: saved.uploadId }, signal);
        setFiles((previous) => ({ ...previous, [item.itemId]: undefined }));
        setMessages((previous) => ({
          ...previous,
          [item.itemId]: 'Completion accepted. Assessment continues separately.',
        }));
      } catch (error) {
        signal.throwIfAborted();
        const explanation =
          error instanceof DocumentsError
            ? documentsErrorMessage(error)
            : 'The transfer reply was unavailable. Select the original file to retry this saved item.';
        setMessages((previous) => ({ ...previous, [item.itemId]: explanation }));
        if (!(error instanceof DocumentsError) || [401, 403, 429, 503].includes(error.status))
          throw error;
      }
    }
  }

  const navigation = (next?: string) =>
    `${base}?${new URLSearchParams({ batch: id, ...(next ? { cursor: next } : {}) })}`;
  const activity = operations.isError ? undefined : operations.data;
  return (
    <Card variant="panel">
      <CardHeader>
        <CardTitle>
          <h2>Batch details</h2>
        </CardTitle>
        <p className="documents-record-id">Batch ID {id}</p>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {read && status.isPending && <p role="status">Loading batch state…</p>}
        {status.error && <Notice message={documentsErrorMessage(status.error)} />}
        {manifest.error && upload && !batch && (
          <Notice message={documentsErrorMessage(manifest.error)} />
        )}
        {!read && (
          <p>Showing your saved manifest. Live item status requires Documents read access.</p>
        )}
        {batch && (
          <>
            <p>
              {batch.total} items · {text(batch.state)} · Start deadline{' '}
              {new Date(batch.expiresAt).toLocaleString()}
            </p>
            <BatchCounts counts={batch.counts} />
          </>
        )}
        {visible.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead scope="col">File</TableHead>
                <TableHead scope="col">State</TableHead>
                <TableHead scope="col">Source</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((item) => (
                <TableRow key={item.itemId}>
                  <TableCell className="whitespace-normal break-all">
                    {item.fileName}
                    <p className="text-muted-foreground">
                      {item.operation === 'create' ? 'New document' : 'New version'}
                    </p>
                  </TableCell>
                  <TableCell className="whitespace-normal">
                    {item.state ? text(item.state) : 'Saved manifest'}
                    {item.session && (
                      <p>
                        {[
                          item.session.upload,
                          item.session.security,
                          item.session.availability,
                          item.session.processing,
                        ]
                          .map(text)
                          .join(' · ')}
                      </p>
                    )}
                    {item.session?.failure && <p>{text(item.session.failure)}</p>}
                    {item.admissionError && (
                      <p>
                        {text(item.admissionError)}
                        {item.retryAfterSeconds ? ' · Retry when capacity is available' : ''}
                      </p>
                    )}
                    {messages[item.itemId] && <p role="status">{messages[item.itemId]}</p>}
                  </TableCell>
                  <TableCell>
                    {local.has(item.itemId) &&
                      mayStart &&
                      !item.session?.completionRequested &&
                      (item.state === null ||
                        item.state === 'UNSTARTED' ||
                        item.session?.upload === 'INITIATED') && (
                        <Field>
                          <FieldLabel htmlFor={`file-${item.itemId}`} className="sr-only">
                            Source for {item.fileName}
                          </FieldLabel>
                          <Input
                            id={`file-${item.itemId}`}
                            type="file"
                            accept=".txt,text/plain"
                            disabled={busy}
                            onChange={(event) => {
                              const file = event.currentTarget.files?.[0];
                              setFiles((previous) => ({ ...previous, [item.itemId]: file }));
                            }}
                          />
                          {files[item.itemId] && (
                            <p className="whitespace-normal break-all">
                              {files[item.itemId]?.name} selected
                            </p>
                          )}
                        </Field>
                      )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
        <div className="flex flex-wrap gap-2">
          {cursor && (
            <ButtonLink href={navigation()} variant="outline">
              First page
            </ButtonLink>
          )}
          {batch?.nextCursor && (
            <ButtonLink href={navigation(batch.nextCursor)} variant="outline">
              Next page
            </ButtonLink>
          )}
          {read && (
            <Button
              variant="outline"
              disabled={busy || status.isFetching}
              onClick={() => void status.refetch()}
            >
              Refresh status
            </Button>
          )}
          {mayStart && selected.length > 0 && (
            <Button disabled={busy} onClick={() => run(transfer)}>
              Transfer selected files
            </Button>
          )}
          {mayControl && local.size > 0 && !confirm && (
            <>
              {(!batch || batch.state === 'OPEN') && (
                <Button variant="outline" disabled={busy} onClick={() => setConfirm('batch.close')}>
                  Close batch
                </Button>
              )}
              {(!batch || ['OPEN', 'CLOSED'].includes(batch.state)) && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() => setConfirm('batch.cancel')}
                >
                  Cancel batch
                </Button>
              )}
            </>
          )}
        </div>
        {confirm && (
          <>
            <p>
              {confirm === 'batch.close'
                ? 'Closing stops new admissions. Started sessions keep their deadlines.'
                : 'Cancelling stops unstarted items and eligible sessions. Published documents stay available.'}
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={busy || !mayControl}
                onClick={() =>
                  run(async (signal) => {
                    await execute({ kind: confirm, batchId: id }, signal);
                    setConfirm(undefined);
                  })
                }
              >
                {confirm === 'batch.close' ? 'Confirm close' : 'Confirm cancellation'}
              </Button>
              <Button disabled={busy} variant="outline" onClick={() => setConfirm(undefined)}>
                Back
              </Button>
            </div>
          </>
        )}
        {activity?.length ? (
          <details className="documents-disclosure">
            <summary>Saved batch operations</summary>
            <ul className="mt-2 flex flex-col gap-2">
              {activity.map((entry) => (
                <li key={entry.receipt.id} className="break-all">
                  <p>
                    {entry.itemId
                      ? (local.get(entry.itemId)?.fileName ?? entry.itemId)
                      : entry.receipt.kind.replace('.', ' ')}{' '}
                    · {text(entry.receipt.state)}
                  </p>
                  <p className="text-muted-foreground">{entry.receipt.id}</p>
                  {mayControl &&
                    ['batch.close', 'batch.cancel'].includes(entry.receipt.kind) &&
                    ['DRAFT', 'DISPATCHING', 'UNCERTAIN'].includes(entry.receipt.state) && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busy}
                        onClick={() =>
                          run(async (signal) => {
                            await retry(entry, signal);
                            setConfirm(undefined);
                          })
                        }
                      >
                        Retry {entry.receipt.kind === 'batch.close' ? 'close' : 'cancellation'}
                      </Button>
                    )}
                </li>
              ))}
            </ul>
          </details>
        ) : null}
      </CardContent>
    </Card>
  );
}

function BatchCounts({ counts }: { counts: DocumentsBatchStatus['counts'] }) {
  return (
    <dl className="documents-facts">
      {Object.entries(counts).map(([group, values]) => (
        <div key={group}>
          <dt className="font-medium capitalize">{group}</dt>
          <dd>
            {Object.entries(values)
              .filter(([, count]) => (count ?? 0) > 0)
              .map(([state, count]) => `${count} ${text(state)}`)
              .join(' · ') || 'None'}
          </dd>
        </div>
      ))}
    </dl>
  );
}
