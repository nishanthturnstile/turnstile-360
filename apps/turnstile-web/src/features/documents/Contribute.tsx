import { useQuery } from '@tanstack/react-query';
import {
  type DocumentsUploadReceipt,
  type DocumentsWorkspaceCommand,
  documentsConnectionSchema,
  documentsUploadHistorySchema,
  documentsWorkspaceCommandSchema,
} from '@thaarei/turnstile-contracts/documents';
import type { UserSessionDto } from '@thaarei/turnstile-contracts/runtime';
import { useState } from 'react';
import { useSearchParams } from 'react-router';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';
import { company } from '@/features/people/client';
import {
  documentsErrorMessage,
  documentsRead,
  draftDocumentCommand,
  executeDocumentCommand,
} from './client';
import { DocumentSavedEntry } from './DocumentUi';
import { putDocumentFile, sha256 } from './file-transfer';
import { type DocumentsToolProps, useDocumentWork } from './use-document-work';

const editActions = [
  ['document.edit', 'Edit details'],
  ['reference.link', 'Link reference'],
  ['reference.unlink', 'Unlink reference'],
] as const;
const versionAction = ['version.begin', 'Add text version'] as const;
type Action = (typeof editActions)[number][0] | (typeof versionAction)[0];
const labels = Object.fromEntries([...editActions, versionAction]);
export const canContribute = (session: UserSessionDto) =>
  company(session, 'turnstile:documents:validate') &&
  (company(session, 'turnstile:documents:edit') || company(session, 'turnstile:documents:upload'));

export function Contribute(props: DocumentsToolProps) {
  const { session, active } = props;
  const [params] = useSearchParams();
  const { scope, run, busy, message, setMessage } = useDocumentWork(props);
  const mayEdit = company(session, 'turnstile:documents:edit');
  const mayUpload = company(session, 'turnstile:documents:upload');
  const actions = [...(mayEdit ? editActions : []), ...(mayUpload ? [versionAction] : [])];
  const [action, setAction] = useState<Action>(mayEdit ? 'document.edit' : 'version.begin');
  const [selected, setSelected] = useState<DocumentsUploadReceipt>();
  const [resumeFile, setResumeFile] = useState<File>();
  const [staged, setStaged] = useState<string>();
  const history = useQuery({
    queryKey: [...scope, 'contributions'],
    enabled: active,
    queryFn: ({ signal }) =>
      documentsRead('/api/documents/contributions', documentsUploadHistorySchema, signal),
  });
  const policy = useQuery({
    queryKey: [...scope, '/api/documents/connection'],
    enabled: active,
    queryFn: ({ signal }) =>
      documentsRead('/api/documents/connection', documentsConnectionSchema, signal),
  });
  const canWrite =
    active &&
    !policy.isError &&
    policy.data?.productAccess === 'full' &&
    policy.data.dmsAccess === 'full';
  const mayStart =
    canWrite &&
    (action !== 'version.begin' ||
      (policy.data?.admission.state === 'enabled' &&
        policy.data.admission.formats.includes('text/plain') &&
        policy.data.admission.profiles.includes('secure-only')));
  const entries = history.isError ? [] : (history.data ?? []);
  const current = entries.find((item) => item.receipt.id === selected?.receipt.id) ?? selected;
  const uploadId = current?.uploadId;
  const source = uploadId
    ? (current?.file ?? entries.find((item) => item.uploadId === uploadId && item.file)?.file)
    : current?.file;
  const completed =
    !!uploadId &&
    ((current?.receipt.kind === 'upload.complete' && current.receipt.state === 'RESOLVED') ||
      entries.some(
        (item) =>
          item.uploadId === uploadId &&
          item.receipt.kind === 'upload.complete' &&
          item.receipt.state === 'RESOLVED',
      ));
  const cancelled =
    (current?.receipt.kind === 'upload.cancel' && current.receipt.state === 'RESOLVED') ||
    (!!uploadId &&
      entries.some(
        (item) =>
          item.uploadId === uploadId &&
          item.receipt.kind === 'upload.cancel' &&
          item.receipt.state === 'RESOLVED',
      ));
  const canRetry = current && ['DRAFT', 'DISPATCHING', 'UNCERTAIN'].includes(current.receipt.state);
  function draft(command: DocumentsWorkspaceCommand, signal: AbortSignal) {
    return draftDocumentCommand(command, session.csrfToken, signal, 'contribute');
  }
  async function execute(operation: DocumentsUploadReceipt, signal: AbortSignal, file?: File) {
    setSelected(operation);
    const { transfer, ...result } = await executeDocumentCommand(
      operation,
      session.csrfToken,
      signal,
    );
    setSelected(result);
    if (result.receipt.kind === 'upload.complete') {
      setMessage(
        'Completion accepted. Publication is not observable from this contribution receipt.',
      );
    } else if (result.receipt.kind === 'upload.cancel') {
      setMessage('Cancellation acknowledged by DMS.');
    } else if (transfer && file && result.uploadId) {
      try {
        await putDocumentFile(transfer, file, signal);
        setStaged(result.uploadId);
        setMessage('Source staged. Request completion to start assessment.');
      } catch (error) {
        signal.throwIfAborted();
        throw error;
      }
    } else {
      setMessage('Contribution acknowledged by DMS.');
    }
  }
  async function matches(file: File | undefined, signal: AbortSignal) {
    if (
      !file ||
      !source ||
      file.name !== source.fileName ||
      file.size !== source.size ||
      (await sha256(await file.arrayBuffer())) !== source.sha256
    ) {
      setMessage('Select the original file with matching name, size and SHA-256.');
      return false;
    }
    signal.throwIfAborted();
    return true;
  }
  async function submit(values: FormData, signal: AbortSignal) {
    const string = (name: string) => String(values.get(name) ?? '').trim();
    const target = { documentId: string('documentId'), expectedRevision: string('revision') };
    let command: unknown;
    let file: File | undefined;
    if (action === 'reference.link') {
      command = {
        ...target,
        kind: action,
        payload: {
          namespace: string('namespace'),
          type: string('type'),
          externalId: string('externalId'),
        },
      };
    } else if (action === 'reference.unlink') {
      command = { ...target, kind: action, referenceId: string('referenceId') };
    } else {
      let metadata: unknown;
      try {
        metadata = string('metadata') ? JSON.parse(string('metadata')) : undefined;
      } catch {
        setMessage('Enter metadata as a JSON object.');
        return;
      }
      const title = string('title');
      if (action === 'document.edit') {
        const tags = string('tags');
        const replacementTags = values.has('clearTags')
          ? []
          : tags
            ? tags
                .split('\n')
                .map((tag) => tag.trim())
                .filter(Boolean)
            : undefined;
        command = {
          ...target,
          kind: action,
          payload: {
            ...(title ? { title } : {}),
            ...(metadata !== undefined ? { metadata } : {}),
            ...(replacementTags ? { tags: replacementTags } : {}),
          },
        };
      } else {
        const candidate = values.get('source');
        if (
          !(candidate instanceof File) ||
          !candidate.size ||
          candidate.size > (policy.data?.admission.limits.maxFileBytes ?? 0) ||
          (candidate.type ? candidate.type !== 'text/plain' : !/\.txt$/i.test(candidate.name))
        ) {
          setMessage('Choose a nonempty plain text file within the admission size limit.');
          return;
        }
        file = candidate;
        command = {
          ...target,
          kind: action,
          payload: {
            title,
            metadata: metadata ?? {},
            fileName: file.name,
            size: file.size,
            contentType: 'text/plain',
            profile: 'secure-only',
            sha256: await sha256(await file.arrayBuffer()),
          },
        };
        signal.throwIfAborted();
      }
    }
    const parsed = documentsWorkspaceCommandSchema.safeParse(command);
    if (!parsed.success) {
      setMessage('Check the document ID, expected revision and contribution fields.');
      return;
    }
    await execute(await draft(parsed.data, signal), signal, file);
  }
  return (
    <div className="documents-workflow">
      <div className="flex min-w-0 flex-col gap-4">
        <Card variant="panel">
          <CardHeader>
            <CardTitle>
              <h2>Contribute</h2>
            </CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-sm text-muted-foreground">
              Use the document ID and revision provided by its owner. Saved receipts show your
              submission and acknowledgement.
            </p>
            {message && <Notice message={message} />}
            {policy.error && <Notice message={documentsErrorMessage(policy.error)} />}
            {policy.data && !canWrite && (
              <Notice message="Contributions require full access in both products." />
            )}
            <form
              onSubmit={(event) => {
                event.preventDefault();
                const values = new FormData(event.currentTarget);
                if (mayStart) run((signal) => submit(values, signal));
              }}
            >
              <FieldGroup>
                <ToggleGroup
                  aria-label="Contribution action"
                  className="flex-wrap"
                  variant="outline"
                  value={[action]}
                  onValueChange={(values) => {
                    const next = actions.find(([candidate]) => candidate === values[0]);
                    if (next) setAction(next[0]);
                  }}
                >
                  {actions.map(([value, label]) => (
                    <ToggleGroupItem key={value} value={value} disabled={busy}>
                      {label}
                    </ToggleGroupItem>
                  ))}
                </ToggleGroup>
                <Field>
                  <FieldLabel htmlFor="contribute-id">Document ID</FieldLabel>
                  <Input
                    id="contribute-id"
                    name="documentId"
                    maxLength={36}
                    defaultValue={params.get('document') ?? ''}
                    required
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="contribute-revision">Expected revision</FieldLabel>
                  <Input
                    id="contribute-revision"
                    name="revision"
                    inputMode="numeric"
                    pattern="[1-9][0-9]{0,14}"
                    required
                  />
                </Field>
                {(action === 'document.edit' || action === 'version.begin') && (
                  <>
                    <Field>
                      <FieldLabel htmlFor="contribute-title">
                        {action === 'version.begin' ? 'Owner-supplied title' : 'Title'}
                      </FieldLabel>
                      <Input
                        id="contribute-title"
                        name="title"
                        maxLength={240}
                        required={action === 'version.begin'}
                      />
                    </Field>
                    {action === 'document.edit' && (
                      <>
                        <Field>
                          <FieldLabel htmlFor="contribute-tags">Tags, one per line</FieldLabel>
                          <Textarea id="contribute-tags" name="tags" maxLength={2080} />
                        </Field>
                        <Field orientation="horizontal">
                          <Checkbox id="contribute-clear-tags" name="clearTags" />
                          <FieldLabel htmlFor="contribute-clear-tags">Clear all tags</FieldLabel>
                        </Field>
                      </>
                    )}
                    <Field>
                      <FieldLabel htmlFor="contribute-metadata">Metadata as JSON</FieldLabel>
                      <Textarea id="contribute-metadata" name="metadata" maxLength={36864} />
                    </Field>
                  </>
                )}
                {action === 'reference.link' &&
                  (
                    [
                      ['namespace', 'Namespace'],
                      ['type', 'Reference type'],
                      ['externalId', 'External ID'],
                    ] as const
                  ).map(([key, label]) => (
                    <Field key={key}>
                      <FieldLabel htmlFor={`contribute-${key}`}>{label}</FieldLabel>
                      <Input
                        id={`contribute-${key}`}
                        name={key}
                        maxLength={key === 'externalId' ? 128 : 64}
                        required
                      />
                    </Field>
                  ))}
                {action === 'reference.unlink' && (
                  <Field>
                    <FieldLabel htmlFor="contribute-reference">Reference ID</FieldLabel>
                    <Input id="contribute-reference" name="referenceId" maxLength={36} required />
                  </Field>
                )}
                {action === 'version.begin' && (
                  <Field>
                    <FieldLabel htmlFor="contribute-source">Plain text file</FieldLabel>
                    <Input
                      id="contribute-source"
                      name="source"
                      type="file"
                      accept=".txt,text/plain"
                      required
                    />
                  </Field>
                )}
                <Button type="submit" disabled={busy || !mayStart}>
                  Submit contribution
                </Button>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
        {current && (
          <Card variant="panel">
            <CardHeader>
              <CardTitle>
                <h2>Contribution receipt</h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="documents-record-id">Operation {current.receipt.id}</p>
              <p>
                {current.receipt.acknowledgement === 'accepted'
                  ? 'Acknowledged'
                  : current.receipt.state.toLowerCase().replaceAll('_', ' ')}{' '}
                · Local receipt only
              </p>
              {uploadId && <p className="break-all">Upload {uploadId}</p>}
              {completed && (
                <p>
                  Completion accepted. Publication is not observable from this contribution receipt.
                </p>
              )}
              {mayUpload && source && !completed && !cancelled && (
                <Field>
                  <FieldLabel htmlFor="contribute-resume">Original text file</FieldLabel>
                  <Input
                    id="contribute-resume"
                    type="file"
                    accept=".txt,text/plain"
                    disabled={busy}
                    onChange={(event) => setResumeFile(event.currentTarget.files?.[0])}
                  />
                </Field>
              )}
              <div className="flex flex-wrap gap-2">
                {canRetry && (
                  <Button
                    variant="outline"
                    disabled={!canWrite || busy}
                    onClick={() =>
                      run(async (signal) => {
                        if (
                          current.receipt.kind === 'version.begin' ||
                          current.receipt.kind === 'upload.refresh'
                        ) {
                          if (!(await matches(resumeFile, signal))) return;
                        }
                        await execute(current, signal, resumeFile);
                      })
                    }
                  >
                    Retry saved contribution
                  </Button>
                )}
                {mayUpload &&
                  uploadId &&
                  current.receipt.state === 'RESOLVED' &&
                  !completed &&
                  !cancelled && (
                    <>
                      <Button
                        variant="outline"
                        disabled={!canWrite || busy || staged === uploadId || !resumeFile}
                        onClick={() =>
                          run(async (signal) => {
                            if (!(await matches(resumeFile, signal))) return;
                            await execute(
                              await draft({ kind: 'upload.refresh', uploadId }, signal),
                              signal,
                              resumeFile,
                            );
                          })
                        }
                      >
                        Refresh transfer
                      </Button>
                      <Button
                        disabled={!canWrite || busy}
                        onClick={() =>
                          run(async (signal) =>
                            execute(
                              await draft({ kind: 'upload.complete', uploadId }, signal),
                              signal,
                            ),
                          )
                        }
                      >
                        Complete contribution
                      </Button>
                      <Button
                        variant="outline"
                        disabled={!canWrite || busy}
                        onClick={() =>
                          run(async (signal) =>
                            execute(
                              await draft({ kind: 'upload.cancel', uploadId }, signal),
                              signal,
                            ),
                          )
                        }
                      >
                        Cancel contribution upload
                      </Button>
                    </>
                  )}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
      <Card variant="panel">
        <CardHeader>
          <CardTitle>
            <h2>Saved contributions</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="documents-saved-list">
          {history.isPending && <p role="status">Loading contributions…</p>}
          {history.error && <Notice message={documentsErrorMessage(history.error)} />}
          {!history.isPending && !history.error && entries.length === 0 && (
            <p className="text-muted-foreground">No saved contributions.</p>
          )}
          {entries.map((entry) => (
            <Button
              key={entry.receipt.id}
              variant="ghost"
              aria-pressed={current?.receipt.id === entry.receipt.id}
              disabled={busy}
              onClick={() => {
                setSelected(entry);
                setResumeFile(undefined);
                setMessage('');
              }}
            >
              <DocumentSavedEntry
                title={
                  entry.file?.fileName ??
                  labels[entry.receipt.kind] ??
                  entry.receipt.kind.replace('.', ' ')
                }
                state={entry.receipt.state}
                savedAt={entry.receipt.createdAt}
              />
            </Button>
          ))}
        </CardContent>
      </Card>
    </div>
  );
}
