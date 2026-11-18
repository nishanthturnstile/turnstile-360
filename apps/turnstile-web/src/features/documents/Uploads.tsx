import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  type DocumentsUploadReceipt,
  type DocumentsWorkspaceCommand,
  documentsConnectionSchema,
  documentsDetailSchema,
  documentsProcessingHistorySchema,
  documentsUploadHistorySchema,
  documentsUploadReceiptSchema,
  downloadCapabilitySchema,
  uploadStatusSchema,
} from '@thaarei/turnstile-contracts/documents';
import { peopleIdSchema, type UserSessionDto } from '@thaarei/turnstile-contracts/runtime';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ButtonLink } from '@/components/button-link';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Progress, ProgressLabel, ProgressValue } from '@/components/ui/progress';
import { company } from '@/features/people/client';
import {
  DocumentsError,
  documentsErrorMessage,
  documentsRead,
  draftDocumentCommand,
  executeDocumentCommand,
} from './client';

import { DocumentSavedEntry } from './DocumentUi';
import { putDocumentFile, sha256, verifiedDocumentBytes } from './file-transfer';

export function DownloadOriginal({ id, versionId }: { id: string; versionId?: string }) {
  const pending = useRef<AbortController | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  useEffect(() => () => pending.current?.abort(), []);
  async function download() {
    if (pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setMessage('');
    try {
      const cap = await documentsRead(
        `/api/documents/${id}/download${versionId ? `?${new URLSearchParams({ versionId })}` : ''}`,
        downloadCapabilitySchema,
        controller.signal,
      );
      const bytes = await verifiedDocumentBytes(cap, 52_428_800, controller.signal);
      const url = URL.createObjectURL(new Blob([bytes], { type: 'application/octet-stream' }));
      try {
        const link = document.createElement('a');
        link.href = url;
        link.download = cap.fileName;
        link.click();
      } finally {
        setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
    } catch (error) {
      if (!controller.signal.aborted)
        setMessage(
          error instanceof DocumentsError
            ? documentsErrorMessage(error)
            : 'The original could not be verified and downloaded. Try again.',
        );
    } finally {
      pending.current = null;
      if (!controller.signal.aborted) setBusy(false);
    }
  }
  return (
    <>
      <Button type="button" disabled={busy} onClick={() => void download()}>
        {busy ? 'Verifying original…' : 'Download original'}
      </Button>
      {message && <Notice message={message} />}
    </>
  );
}

export function Uploads({
  session,
  active,
  onCheck,
}: {
  session: UserSessionDto;
  active: boolean;
  onCheck: (fresh?: boolean) => Promise<boolean>;
}) {
  const queryClient = useQueryClient();
  const key = [
    'documents-uploads',
    session.user.id,
    session.access.fingerprint,
    session.access.accessRevision,
  ];
  const canRead = company(session, 'turnstile:documents:read');
  const canUpload = company(session, 'turnstile:documents:upload');
  const [search] = useSearchParams();
  const target = peopleIdSchema.safeParse(search.get('document'));
  const savedId = peopleIdSchema.safeParse(search.get('operation'));
  const targetQuery = useQuery({
    queryKey: [...key, 'target', target.data],
    enabled: active && canRead && target.success,
    queryFn: ({ signal }) =>
      documentsRead(`/api/documents/${target.data}`, documentsDetailSchema, signal),
  });
  const opened = useQuery({
    queryKey: [...key, 'operation', savedId.data],
    enabled: active && savedId.success,
    queryFn: ({ signal }) =>
      documentsRead(
        `/api/documents/operations/${savedId.data}`,
        documentsUploadReceiptSchema,
        signal,
      ),
  });
  const [versionRevision, setVersionRevision] = useState<string>();
  const [versionConflict, setVersionConflict] = useState(false);
  const [file, setFile] = useState<File>();
  const [selectedFormat, setSelectedFormat] = useState('');
  const [selectedProfile, setSelectedProfile] = useState('secure-only');
  const [selected, select] = useState<DocumentsUploadReceipt>();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const pending = useRef<AbortController | null>(null);
  const [transferProgress, setTransferProgress] = useState<number>();
  useEffect(() => {
    if (!active) pending.current?.abort();
    return () => pending.current?.abort();
  }, [active]);
  const history = useQuery({
    queryKey: key,
    enabled: active,
    queryFn: ({ signal }) =>
      documentsRead('/api/documents/operations', documentsUploadHistorySchema, signal),
  });
  const current =
    selected ?? (!opened.isError && opened.data?.mode !== 'contribute' ? opened.data : undefined);
  const uploadId = current?.uploadId;
  const status = useQuery({
    queryKey: [...key, uploadId],
    enabled: active && canRead && !!uploadId,
    queryFn: ({ signal }) =>
      documentsRead(`/api/documents/uploads/${uploadId}`, uploadStatusSchema, signal),
    refetchInterval: (query) => {
      if (!active || query.state.error) return false;
      const current = query.state.data;
      if (current?.retryAfterSeconds) return current.retryAfterSeconds * 1000;
      return current?.processing === 'QUEUED' || current?.processing === 'RUNNING' ? 2500 : false;
    },
  });
  const currentStatus = status.isError ? undefined : status.data;
  const processingPath = currentStatus
    ? `/api/documents/${currentStatus.documentId}/processing?${new URLSearchParams({ versionId: currentStatus.versionId, limit: '1' })}`
    : '';
  const index = useQuery({
    queryKey: [...key, processingPath],
    enabled:
      active &&
      canRead &&
      currentStatus?.availability === 'AVAILABLE' &&
      currentStatus.processing !== 'NOT_SCHEDULED',
    queryFn: ({ signal }) =>
      documentsRead(processingPath, documentsProcessingHistorySchema, signal),
    refetchInterval: ({ state }) =>
      active &&
      !state.error &&
      (state.data?.indexStatus === 'PENDING' ||
        state.data?.items.some((run) => run.state === 'QUEUED' || run.state === 'RUNNING'))
        ? 2500
        : false,
  });
  useEffect(() => {
    if (status.error instanceof DocumentsError && [401, 403].includes(status.error.status))
      void onCheck();
    else if (index.error instanceof DocumentsError && [401, 403].includes(index.error.status))
      void onCheck();
  }, [status.error, index.error, onCheck]);
  const saved = history.data?.find((row) => row.receipt.id === current?.receipt.id) ?? current;
  const policy = useQuery({
    queryKey: [...key, 'policy'],
    enabled: active,
    queryFn: ({ signal }) =>
      documentsRead('/api/documents/connection', documentsConnectionSchema, signal),
  });
  const full =
    !policy.isError && policy.data?.productAccess === 'full' && policy.data.dmsAccess === 'full';
  const mayWrite =
    full && canUpload && policy.data?.effectiveOperations.includes('uploads:control');
  const versionTarget =
    target.success && !targetQuery.isError && targetQuery.data?.ownership === 'owned'
      ? targetQuery.data
      : undefined;
  const formats = policy.data?.admission.formats ?? [];
  const textOnly = formats.length === 1 && formats[0] === 'text/plain';
  const fileFormat =
    formats.find((format) => format === file?.type) ??
    (file && !file.type && /\.txt$/i.test(file.name)
      ? formats.find((format) => format === 'text/plain')
      : undefined);
  const contentType =
    formats.find((format) => format === selectedFormat) ??
    fileFormat ??
    (formats.length === 1 ? formats[0] : undefined);
  const profiles =
    policy.data?.admission.profiles.filter(
      (profile) =>
        profile !== 'structured' ||
        policy.data?.formatCapabilities?.some(
          (format) => format.contentType === contentType && format.structuredLayout,
        ),
    ) ?? [];
  const profile = profiles.find((candidate) => candidate === selectedProfile) ?? profiles[0];
  const operation = saved?.receipt.kind;
  const retryAllowed =
    full &&
    !!operation &&
    (operation === 'version.restore'
      ? policy.data?.effectiveOperations.includes('versions:restore')
      : operation === 'version.begin'
        ? policy.data?.effectiveOperations.includes('versions:write')
        : operation === 'document.edit'
          ? policy.data?.effectiveOperations.includes('documents:edit-metadata')
          : operation.startsWith('reference.')
            ? policy.data?.effectiveOperations.includes('documents:references')
            : mayWrite);
  const canStart =
    mayWrite &&
    policy.data?.admission.state === 'enabled' &&
    formats.length > 0 &&
    (!search.has('document') ||
      (!!versionTarget &&
        policy.data.effectiveOperations.includes('versions:write') &&
        !versionConflict));
  async function run(operation: (signal: AbortSignal) => Promise<void>) {
    if (!active || pending.current) return;
    const controller = new AbortController();
    pending.current = controller;
    setBusy(true);
    setMessage('');
    try {
      await operation(controller.signal);
    } catch (error) {
      if (!controller.signal.aborted) {
        if (error instanceof DocumentsError && [401, 403].includes(error.status)) void onCheck();
        if (
          versionTarget &&
          error instanceof DocumentsError &&
          error.guidance === 'review_conflict'
        )
          setVersionConflict(true);
        setMessage(
          error instanceof DocumentsError
            ? documentsErrorMessage(error)
            : 'The transfer reply was unavailable. Reopen the saved upload and check its state.',
        );
      }
    } finally {
      pending.current = null;
      setBusy(false);
      if (!controller.signal.aborted) {
        void queryClient.invalidateQueries({ queryKey: key });
        void queryClient.invalidateQueries({ queryKey: ['documents'] });
      }
    }
  }
  async function draft(command: DocumentsWorkspaceCommand, signal: AbortSignal) {
    const result = await draftDocumentCommand(command, session.csrfToken, signal);
    select(result);
    return result;
  }
  async function execute(current: DocumentsUploadReceipt, signal: AbortSignal) {
    const result = await executeDocumentCommand(current, session.csrfToken, signal);
    const { transfer, ...local } = result;
    select(local);
    return result;
  }
  async function transferFile(
    cap: NonNullable<Awaited<ReturnType<typeof execute>>['transfer']>,
    original: NonNullable<DocumentsUploadReceipt['file']>,
    candidate: File | undefined,
    signal: AbortSignal,
  ) {
    if (
      !candidate ||
      candidate.name !== original.fileName ||
      candidate.size !== original.size ||
      cap.size !== candidate.size ||
      (await sha256(await candidate.arrayBuffer())) !== original.sha256
    ) {
      setMessage('Choose the original file with the same name, size and contents.');
      return;
    }
    try {
      signal.throwIfAborted();
      setTransferProgress(0);
      await putDocumentFile(cap, candidate, signal, (sent) => {
        setTransferProgress(Math.floor((sent / candidate.size) * 100));
      });
      setMessage('Request completion to verify the staged file and start assessment.');
    } catch {
      signal.throwIfAborted();
      setMessage(
        'The transfer reply was lost. Request completion to check the staged file, or reselect it to retry.',
      );
    } finally {
      setTransferProgress(undefined);
    }
  }
  async function begin(signal: AbortSignal) {
    if (!canStart || !contentType || !profile) return;
    if (!file || file.size < 1 || file.size > (policy.data?.admission.limits.maxFileBytes ?? 0)) {
      setMessage('Choose a nonempty file within the current admission size limit.');
      return;
    }
    const sha = await sha256(await file.arrayBuffer());
    const payload = {
      title: versionTarget?.title ?? file.name,
      fileName: file.name,
      contentType,
      size: file.size,
      profile,
      metadata: versionTarget?.metadata ?? {},
      sha256: sha,
    };
    const revision = versionRevision ?? versionTarget?.revision;
    if (revision) setVersionRevision(revision);
    const current = await draft(
      versionTarget && revision
        ? {
            kind: 'version.begin',
            documentId: versionTarget.id,
            expectedRevision: revision,
            payload,
          }
        : { kind: 'upload.begin', payload },
      signal,
    );
    const result = await execute(current, signal);
    if (result.transfer && current.file)
      await transferFile(result.transfer, current.file, file, signal);
  }
  async function control(
    kind: 'upload.complete' | 'upload.cancel' | 'upload.refresh',
    signal: AbortSignal,
  ) {
    if (!uploadId) return;
    const original =
      saved?.file ??
      history.data?.find(
        (item) =>
          ['upload.begin', 'version.begin'].includes(item.receipt.kind) &&
          item.uploadId === uploadId,
      )?.file;
    if (
      kind === 'upload.refresh' &&
      (!original ||
        !file ||
        file.name !== original.fileName ||
        file.size !== original.size ||
        (await sha256(await file.arrayBuffer())) !== original.sha256)
    ) {
      setMessage('Choose the original file before refreshing transfer.');
      return;
    }
    const result = await execute(await draft({ kind, uploadId }, signal), signal);
    if (result.transfer && original) await transferFile(result.transfer, original, file, signal);
    if (kind === 'upload.complete')
      setMessage('Completion accepted. Assessment and availability update separately.');
  }
  const terminal =
    currentStatus && ['COMPLETED', 'EXPIRED', 'CANCELLED', 'FAILED'].includes(currentStatus.upload);
  return (
    <div className="documents-workflow">
      <div className="flex min-w-0 flex-col gap-4">
        {canUpload && (
          <Card variant="panel">
            <CardHeader>
              <CardTitle>
                <h2>{search.has('document') ? 'Upload a version' : 'Upload a file'}</h2>
              </CardTitle>
            </CardHeader>
            <CardContent>
              {versionTarget && (
                <p className="mb-3 break-words">
                  {versionTarget.title} · Revision {versionRevision ?? versionTarget.revision}
                </p>
              )}
              {search.has('document') && !versionTarget && (
                <Notice message="An owned document with current read access is required." />
              )}
              {versionConflict && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void run(async (signal) => {
                      if (!versionTarget) return;
                      const latest = await documentsRead(
                        `/api/documents/${versionTarget.id}`,
                        documentsDetailSchema,
                        signal,
                      );
                      setVersionRevision(latest.revision);
                      setVersionConflict(false);
                      setMessage(
                        `Revision ${latest.revision} selected. Review the file before submitting.`,
                      );
                    })
                  }
                >
                  Review latest revision
                </Button>
              )}
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void run(begin);
                }}
              >
                <FieldGroup>
                  <Field className="documents-file-field">
                    <FieldLabel htmlFor="documents-source-file">
                      {textOnly ? 'Plain text file' : 'Source file'}
                    </FieldLabel>
                    <Input
                      id="documents-source-file"
                      type="file"
                      accept={formats.join(',') || undefined}
                      disabled={busy}
                      onChange={(event) => {
                        setSelectedFormat('');
                        setFile(event.currentTarget.files?.[0]);
                      }}
                    />
                    {policy.data && (
                      <FieldDescription>
                        Maximum {policy.data.admission.limits.maxFileBytes.toLocaleString()} bytes
                        {formats.length === 1 && ` · ${formats[0]}`}
                        {profiles.length === 1 && ` · ${profiles[0]}`}
                      </FieldDescription>
                    )}
                  </Field>
                  {formats.length > 1 && (
                    <Field>
                      <FieldLabel htmlFor="documents-source-format">Source format</FieldLabel>
                      <NativeSelect
                        id="documents-source-format"
                        value={contentType ?? ''}
                        onChange={(event) => setSelectedFormat(event.currentTarget.value)}
                        disabled={busy}
                      >
                        <NativeSelectOption value="">Choose format</NativeSelectOption>
                        {formats.map((value) => (
                          <NativeSelectOption key={value}>{value}</NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </Field>
                  )}
                  {profiles.length > 1 && (
                    <Field>
                      <FieldLabel htmlFor="documents-upload-profile">Upload profile</FieldLabel>
                      <NativeSelect
                        id="documents-upload-profile"
                        value={profile ?? ''}
                        onChange={(event) => setSelectedProfile(event.currentTarget.value)}
                        disabled={busy}
                      >
                        {profiles.map((value) => (
                          <NativeSelectOption key={value} value={value}>
                            {value}
                          </NativeSelectOption>
                        ))}
                      </NativeSelect>
                    </Field>
                  )}
                  <Button
                    type="submit"
                    disabled={!file || !contentType || !profile || busy || !canStart}
                  >
                    Start upload
                  </Button>
                </FieldGroup>
              </form>
            </CardContent>
          </Card>
        )}
        {opened.error && <Notice message={documentsErrorMessage(opened.error)} />}
        {opened.data?.mode === 'contribute' && (
          <ButtonLink href="/documents/validation">Open Contribute</ButtonLink>
        )}
        {policy.error && <Notice message={documentsErrorMessage(policy.error)} />}
        {canUpload && policy.data && !mayWrite && (
          <Notice message="Upload controls are paused by current access policy." />
        )}
        {canUpload && policy.data && mayWrite && !canStart && !versionConflict && (
          <Notice message="Upload is unavailable under the current admission policy." />
        )}
        {message && <Notice message={message} />}
        {active && transferProgress !== undefined && (
          <Progress value={transferProgress}>
            <ProgressLabel>File transfer</ProgressLabel>
            <ProgressValue />
          </Progress>
        )}
        {saved && (
          <Card variant="panel">
            <CardHeader>
              <CardTitle>
                <h2>Selected operation</h2>
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <p className="documents-record-id">Operation ID {saved.receipt.id}</p>
              {saved.receipt.state === 'UNRESOLVED_REQUIRES_REVIEW' ? (
                <Notice message="An administrator must review the uncertain outcome before it can be replaced." />
              ) : (
                <p>Operation state {saved.receipt.state.toLowerCase()}</p>
              )}
              {['DRAFT', 'DISPATCHING', 'UNCERTAIN'].includes(saved.receipt.state) && (
                <Button
                  disabled={busy || !retryAllowed}
                  onClick={() =>
                    void run(async (signal) => {
                      const result = await execute(saved, signal);
                      const original =
                        saved.file ??
                        history.data?.find(
                          (entry) =>
                            ['upload.begin', 'version.begin'].includes(entry.receipt.kind) &&
                            entry.uploadId === result.uploadId,
                        )?.file;
                      if (result.transfer && original)
                        await transferFile(result.transfer, original, file, signal);
                    })
                  }
                >
                  Retry saved operation
                </Button>
              )}
              {currentStatus && (
                <dl className="documents-facts">
                  {(
                    [
                      ['Upload', currentStatus.upload],
                      ['Security', currentStatus.security],
                      ['Availability', currentStatus.availability],
                      ['Processing', currentStatus.processing],
                      [
                        'Index',
                        index.isError
                          ? 'Unavailable'
                          : (index.data?.indexStatus ??
                            (currentStatus.processing === 'NOT_SCHEDULED'
                              ? 'Not scheduled'
                              : 'Awaiting result')),
                      ],
                    ] as const
                  ).map(([label, value]) => (
                    <div key={label}>
                      <dt>{label}</dt>
                      <dd>{value.toLowerCase().replaceAll('_', ' ')}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {status.error && <Notice message={documentsErrorMessage(status.error)} />}
              {uploadId && !canRead && (
                <p>
                  Current access permits upload acknowledgements. Live status requires document read
                  access.
                </p>
              )}
              {canUpload &&
                uploadId &&
                operation !== 'version.restore' &&
                !terminal &&
                saved.receipt.state === 'RESOLVED' && (
                  <div className="flex flex-wrap gap-2">
                    {!currentStatus?.completionRequested && (
                      <Button
                        disabled={busy || !mayWrite}
                        onClick={() => void run((signal) => control('upload.complete', signal))}
                      >
                        Request completion
                      </Button>
                    )}
                    {!currentStatus?.completionRequested && (
                      <Button
                        disabled={busy || !file || !mayWrite}
                        variant="outline"
                        onClick={() => void run((signal) => control('upload.refresh', signal))}
                      >
                        Refresh transfer
                      </Button>
                    )}
                    <Button
                      disabled={busy || !mayWrite}
                      variant="outline"
                      onClick={() => void run((signal) => control('upload.cancel', signal))}
                    >
                      Cancel upload
                    </Button>
                  </div>
                )}
              {currentStatus?.availability === 'AVAILABLE' && (
                <div className="flex flex-wrap gap-2">
                  <ButtonLink href={`/documents/${currentStatus.documentId}`} variant="outline">
                    Open document
                  </ButtonLink>
                  <ButtonLink
                    href={`/documents/${currentStatus.documentId}?${new URLSearchParams({ tab: 'processing', version: currentStatus.versionId })}`}
                    variant="outline"
                  >
                    Open version processing
                  </ButtonLink>
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>
      <Card variant="panel">
        <CardHeader>
          <CardTitle>
            <h2>Saved uploads and operations</h2>
          </CardTitle>
        </CardHeader>
        <CardContent className="documents-saved-list">
          {history.error && <Notice message={documentsErrorMessage(history.error)} />}
          {history.isPending && <p role="status">Loading saved operations…</p>}
          {history.data?.length === 0 && <p>No saved upload operations.</p>}
          {history.data?.map((entry) => (
            <Button
              key={entry.receipt.id}
              variant="ghost"
              aria-pressed={saved?.receipt.id === entry.receipt.id}
              disabled={busy}
              onClick={() => {
                select(entry);
                setMessage('');
              }}
            >
              <DocumentSavedEntry
                title={entry.file?.fileName ?? entry.receipt.kind.replace('.', ' ')}
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
