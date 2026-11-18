import { useQueryClient } from '@tanstack/react-query';
import {
  type DocumentsDetailDto,
  type DocumentsUploadReceipt,
  type DocumentsWorkspaceCommand,
  documentsDetailSchema,
  documentsWorkspaceCommandSchema,
} from '@thaarei/turnstile-contracts/documents';
import type { UserSessionDto } from '@thaarei/turnstile-contracts/runtime';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { ButtonLink } from '@/components/button-link';
import { Notice } from '@/components/notice';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Button } from '@/components/ui/button';
import { Field, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { Textarea } from '@/components/ui/textarea';
import {
  DocumentsError,
  documentsErrorMessage,
  documentsRead,
  draftDocumentCommand,
  executeDocumentCommand,
} from './client';

export type DetailTask = 'edit' | 'references' | { versionId: string; number: number };
type RevisionCommand = Extract<DocumentsWorkspaceCommand, { documentId: string }>;

export function DocumentTask({
  task,
  document,
  session,
  onCheck,
  close,
}: {
  task: DetailTask;
  document: DocumentsDetailDto;
  session: UserSessionDto;
  onCheck: (fresh?: boolean) => Promise<boolean>;
  close: () => void;
}) {
  const queryClient = useQueryClient();
  const [initial] = useState(document);
  const [base, setBase] = useState(document);
  const [title, setTitle] = useState(document.title);
  const [tags, setTags] = useState(document.tags.join('\n'));
  const [metadata, setMetadata] = useState(JSON.stringify(document.metadata, null, 2));
  const [namespace, setNamespace] = useState('');
  const [type, setType] = useState('');
  const [externalId, setExternalId] = useState('');
  const [removing, setRemoving] = useState<DocumentsDetailDto['references'][number]>();
  const [operation, setOperation] = useState<DocumentsUploadReceipt>();
  const [blocked, setBlocked] = useState(false);
  const [conflict, setConflict] = useState(false);
  const [latest, setLatest] = useState<DocumentsDetailDto>();
  const [busy, setBusy] = useState(false);
  const [discard, setDiscard] = useState(false);
  const [origin] = useState(() => window.document.activeElement);
  const [message, setMessage] = useState('');
  const [done, setDone] = useState<DocumentsUploadReceipt>();
  const running = useRef<AbortController | null>(null);
  useEffect(() => () => running.current?.abort(), []);
  const target = { documentId: base.id, expectedRevision: base.revision };
  const caption =
    task === 'edit'
      ? 'Edit document details'
      : task === 'references'
        ? 'Manage references'
        : 'Restore a version';
  const editChanged =
    title !== initial.title ||
    tags !== initial.tags.join('\n') ||
    metadata !== JSON.stringify(initial.metadata, null, 2);
  const dirty =
    !done && (task === 'edit' ? editChanged : !!(namespace || type || externalId || removing));
  function dismiss() {
    if (busy) return;
    if (dirty) setDiscard(true);
    else close();
  }
  async function run(work: (signal: AbortSignal) => Promise<void>) {
    if (running.current) return;
    const request = new AbortController();
    running.current = request;
    setBusy(true);
    setMessage('');
    try {
      await work(request.signal);
    } catch (error) {
      if (request.signal.aborted) return;
      if (error instanceof DocumentsError) {
        if ([401, 403].includes(error.status)) void onCheck();
        if (error.guidance === 'review_conflict') {
          setOperation(undefined);
          setConflict(true);
          setMessage(
            'The saved revision changed. Review the latest details before submitting your draft again.',
          );
          return;
        }
        if (error.guidance === 'manual_review' || error.status === 410) setBlocked(true);
      }
      setMessage(documentsErrorMessage(error));
    } finally {
      running.current = null;
      if (!request.signal.aborted) setBusy(false);
    }
  }
  async function execute(saved: DocumentsUploadReceipt, signal: AbortSignal) {
    const { transfer: _transfer, ...result } = await executeDocumentCommand(
      saved,
      session.csrfToken,
      signal,
    );
    signal.throwIfAborted();
    setDone(result);
    setOperation(undefined);
    void queryClient.invalidateQueries({ queryKey: ['documents'] });
    void queryClient.invalidateQueries({ queryKey: ['documents-uploads'] });
  }
  function submit(command: RevisionCommand) {
    const parsed = documentsWorkspaceCommandSchema.safeParse(command);
    if (!parsed.success) {
      setMessage('Check the field lengths and metadata values. Tags must be unique.');
      return;
    }
    void run(async (signal) => {
      const saved = await draftDocumentCommand(parsed.data, session.csrfToken, signal);
      signal.throwIfAborted();
      setOperation(saved);
      await execute(saved, signal);
    });
  }
  function saveEdit() {
    let value: DocumentsDetailDto['metadata'];
    try {
      value = JSON.parse(metadata) as DocumentsDetailDto['metadata'];
    } catch {
      setMessage('Enter metadata as a JSON object.');
      return;
    }
    const payload = {
      ...(title !== initial.title ? { title } : {}),
      ...(tags !== initial.tags.join('\n')
        ? {
            tags: tags
              .split('\n')
              .map((tag) => tag.trim())
              .filter(Boolean),
          }
        : {}),
      ...(metadata !== JSON.stringify(initial.metadata, null, 2) ? { metadata: value } : {}),
    };
    if (!Object.keys(payload).length) {
      setMessage('Change at least one field.');
      return;
    }
    submit({ kind: 'document.edit', ...target, payload });
  }
  const disabled = busy || conflict || !!operation || blocked || !!done;
  const confirmRestore = () => {
    if (typeof task !== 'string')
      submit({
        kind: 'version.restore',
        ...target,
        versionId: task.versionId,
        payload: { profile: 'secure-only' },
      });
  };
  const confirmUnlink = () => {
    if (removing) submit({ kind: 'reference.unlink', ...target, referenceId: removing.id });
  };
  let form: ReactNode;
  if (task === 'edit') {
    form = (
      <form
        id="document-detail-task"
        onSubmit={(event) => {
          event.preventDefault();
          saveEdit();
        }}
      >
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="document-edit-title">Title</FieldLabel>
            <Input
              id="document-edit-title"
              value={title}
              maxLength={240}
              disabled={disabled}
              required
              onChange={(event) => setTitle(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="document-edit-tags">Tags, one per line</FieldLabel>
            <Textarea
              id="document-edit-tags"
              value={tags}
              maxLength={2080}
              disabled={disabled}
              onChange={(event) => setTags(event.target.value)}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="document-edit-metadata">Metadata as JSON</FieldLabel>
            <Textarea
              id="document-edit-metadata"
              value={metadata}
              maxLength={36864}
              disabled={disabled}
              rows={7}
              onChange={(event) => setMetadata(event.target.value)}
            />
          </Field>
        </FieldGroup>
      </form>
    );
  } else if (task === 'references') {
    form = (
      <>
        {base.references.length > 0 && (
          <ul className="flex min-w-0 flex-col gap-2">
            {base.references.map((reference) => (
              <li key={reference.id} className="flex flex-wrap items-center gap-2">
                <span className="break-all">
                  {reference.namespace} / {reference.type} / {reference.externalId}
                </span>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={disabled}
                  onClick={() => setRemoving(reference)}
                  aria-label={`Unlink ${reference.namespace} / ${reference.type} / ${reference.externalId}`}
                >
                  Unlink
                </Button>
              </li>
            ))}
          </ul>
        )}
        {removing ? (
          <div className="flex flex-col gap-3">
            <p className="break-all">
              Remove {removing.namespace} / {removing.type} / {removing.externalId}?
            </p>
            <Button variant="outline" disabled={busy} onClick={() => setRemoving(undefined)}>
              Keep reference
            </Button>
          </div>
        ) : (
          <form
            id="document-detail-task"
            onSubmit={(event) => {
              event.preventDefault();
              submit({
                kind: 'reference.link',
                ...target,
                payload: { namespace, type, externalId },
              });
            }}
          >
            <FieldGroup>
              <Field>
                <FieldLabel htmlFor="reference-namespace">Namespace</FieldLabel>
                <Input
                  id="reference-namespace"
                  required
                  maxLength={64}
                  value={namespace}
                  disabled={disabled}
                  onChange={(event) => setNamespace(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="reference-type">Type</FieldLabel>
                <Input
                  id="reference-type"
                  required
                  maxLength={64}
                  value={type}
                  disabled={disabled}
                  onChange={(event) => setType(event.target.value)}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="reference-id">External ID</FieldLabel>
                <Input
                  id="reference-id"
                  required
                  maxLength={128}
                  value={externalId}
                  disabled={disabled}
                  onChange={(event) => setExternalId(event.target.value)}
                />
              </Field>
            </FieldGroup>
          </form>
        )}
      </>
    );
  } else {
    form = (
      <div className="flex flex-col gap-3">
        <p>
          Restore version {task.number} as a new version. It will undergo a fresh security
          assessment before it can become current.
        </p>
      </div>
    );
  }
  return (
    <>
      <Sheet
        open
        onOpenChange={(open) => {
          if (!open && !discard) dismiss();
        }}
      >
        <SheetContent
          className="documents-task-sheet"
          finalFocus={() => (origin instanceof HTMLElement && origin.isConnected ? origin : false)}
        >
          <SheetHeader className="documents-task-header">
            <SheetTitle>{caption}</SheetTitle>
            <SheetDescription className="break-words">
              {base.title} · Revision {base.revision}
            </SheetDescription>
          </SheetHeader>
          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto px-6 py-5">
            {message && <Notice message={message} />}
            {done ? (
              <>
                <Notice
                  message={
                    done.uploadId
                      ? 'Restore accepted. Check the new version’s assessment and availability.'
                      : 'The saved document state confirms the requested change.'
                  }
                />
                {done.uploadId && (
                  <ButtonLink href={`/documents/uploads?operation=${done.receipt.id}`}>
                    View restore progress
                  </ButtonLink>
                )}
              </>
            ) : (
              form
            )}
            {operation && !blocked && (
              <Button
                disabled={busy}
                variant="outline"
                onClick={() => void run((signal) => execute(operation, signal))}
              >
                Check saved operation
              </Button>
            )}
            {operation && (
              <ButtonLink
                href={`/documents/uploads?operation=${operation.receipt.id}`}
                variant="ghost"
              >
                Open saved operation
              </ButtonLink>
            )}
            {conflict && !latest && (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() =>
                  void run(async (signal) => {
                    setLatest(
                      await documentsRead(
                        `/api/documents/${base.id}`,
                        documentsDetailSchema,
                        signal,
                      ),
                    );
                  })
                }
              >
                Review latest revision
              </Button>
            )}
            {latest && (
              <section aria-label="Latest saved details" className="flex min-w-0 flex-col gap-3">
                <p className="break-words">
                  Revision {latest.revision} · {latest.title}
                </p>
                <p className="break-words">Tags: {latest.tags.join(', ') || 'None'}</p>
                {task === 'edit' && (
                  <pre className="documents-source-text">
                    {JSON.stringify(latest.metadata, null, 2)}
                  </pre>
                )}
                {task === 'references' && (
                  <ul>
                    {latest.references.map((ref) => (
                      <li className="break-all" key={ref.id}>
                        {ref.namespace} / {ref.type} / {ref.externalId}
                      </li>
                    ))}
                  </ul>
                )}
                <Button
                  variant="outline"
                  onClick={() => {
                    setBase(latest);
                    setLatest(undefined);
                    setConflict(false);
                    setMessage('Latest revision selected. Review your draft before submitting.');
                  }}
                >
                  Use revision {latest.revision}
                </Button>
              </section>
            )}
          </div>
          <SheetFooter className="documents-task-footer flex-row flex-wrap justify-end px-6 py-4">
            {done ? (
              <Button onClick={close}>Done</Button>
            ) : (
              <>
                <Button variant="outline" disabled={busy} onClick={dismiss}>
                  Cancel
                </Button>
                {typeof task !== 'string' ? (
                  <Button disabled={disabled} onClick={confirmRestore}>
                    Confirm restore
                  </Button>
                ) : removing ? (
                  <Button variant="destructive" disabled={disabled} onClick={confirmUnlink}>
                    Confirm unlink
                  </Button>
                ) : (
                  <Button type="submit" form="document-detail-task" disabled={disabled}>
                    {task === 'edit' ? 'Save details' : 'Link reference'}
                  </Button>
                )}
              </>
            )}
          </SheetFooter>
        </SheetContent>
      </Sheet>
      <AlertDialog open={discard} onOpenChange={setDiscard}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Discard unsaved changes?</AlertDialogTitle>
            <AlertDialogDescription>
              Saved operations remain available in Uploads.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep editing</AlertDialogCancel>
            <AlertDialogAction variant="destructive" onClick={close}>
              Discard changes
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
