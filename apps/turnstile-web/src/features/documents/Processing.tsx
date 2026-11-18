import { useQuery } from '@tanstack/react-query';
import {
  type DocumentsDetailDto,
  type DocumentsUploadReceipt,
  documentsConnectionSchema,
  documentsProcessingHistorySchema,
  documentsUploadHistorySchema,
  documentsVersionSchema,
} from '@thaarei/turnstile-contracts/documents';
import { peopleIdSchema } from '@thaarei/turnstile-contracts/runtime';
import { useEffect, useState } from 'react';
import { ButtonLink } from '@/components/button-link';
import { LoadingStatus } from '@/components/content-loading';
import { Notice } from '@/components/notice';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet';
import { company } from '@/features/people/client';
import {
  DocumentsError,
  documentsErrorMessage,
  documentsRead,
  draftDocumentCommand,
  executeDocumentCommand,
} from './client';
import { DocumentState } from './DocumentUi';
import { ExtractedContent, ExtractionCoverage, statusLabel } from './ExtractedContent';
import { type DocumentsToolProps, documentsScope, useDocumentWork } from './use-document-work';

type Profile = 'searchable' | 'structured';

export function Processing({
  document,
  mode,
  search,
  ...tools
}: DocumentsToolProps & {
  document: DocumentsDetailDto;
  mode: 'processing' | 'content';
  search: URLSearchParams;
}) {
  const requested = search.get('version');
  const selector = requested ?? document.currentVersionId;
  const version = peopleIdSchema.safeParse(selector);
  const runId = search.get('run');
  const cursor = search.get('cursor');
  if (!selector)
    return <Notice message="Processing is available after a secure original is published." />;
  if (!version.success || (runId !== null && !peopleIdSchema.safeParse(runId).success))
    return <Notice message="The version or run selector is invalid." />;
  return (
    <ProcessingVersion
      key={`${mode}:${version.data}`}
      {...tools}
      id={document.id}
      owned={document.ownership === 'owned'}
      version={version.data}
      requested={requested !== null}
      mode={mode}
      cursor={cursor}
      runId={runId}
      unitId={search.get('unit')}
    />
  );
}

function ProcessingVersion({
  id,
  owned,
  version,
  requested,
  mode,
  cursor,
  runId,
  unitId,
  ...tools
}: DocumentsToolProps & {
  id: string;
  owned: boolean;
  version: string;
  requested: boolean;
  mode: 'processing' | 'content';
  cursor: string | null;
  runId: string | null;
  unitId: string | null;
}) {
  const { session, active, onCheck } = tools;
  const scope = documentsScope(session);
  const base = `/documents/${id}`;
  const path = `/api${base}/processing?${new URLSearchParams({
    versionId: version,
    ...(cursor && mode === 'processing' ? { cursor } : {}),
  })}`;
  const url = (tab: 'processing' | 'content', next?: { run?: string; cursor?: string }) =>
    `${base}?${new URLSearchParams({ tab, version, ...next })}`;
  const history = useQuery({
    queryKey: [...scope, path],
    queryFn: ({ signal }) => documentsRead(path, documentsProcessingHistorySchema, signal),
    enabled: active,
    staleTime: 0,
    refetchInterval: ({ state }) => {
      if (!active || state.error || !state.data) return false;
      if (
        state.data.indexStatus === 'PENDING' ||
        state.data.items.some((item) => item.state === 'QUEUED' || item.state === 'RUNNING')
      )
        return 2500;
      return mode === 'content' ? 30000 : false;
    },
  });
  useEffect(() => {
    if (history.error instanceof DocumentsError && [401, 403].includes(history.error.status))
      void onCheck();
  }, [history.error, onCheck]);
  const value = !history.isError && active ? history.data : undefined;
  const latestActive = value?.activeRunId;
  const contentParams = new URLSearchParams({ versionId: version, ...(runId ? { runId } : {}) });
  const mayReprocess = owned && company(session, 'turnstile:documents:reprocess');
  return (
    <>
      <div className="flex flex-wrap items-center gap-2">
        <ButtonLink variant="outline" href={`${base}?tab=versions`}>
          Choose version
        </ButtonLink>
        {requested && (
          <ButtonLink variant="outline" href={`${base}?tab=${mode}`}>
            Current version
          </ButtonLink>
        )}
        <ButtonLink variant="outline" href={url(mode === 'processing' ? 'content' : 'processing')}>
          {mode === 'processing' ? 'Open active content' : 'Open processing history'}
        </ButtonLink>
        {mode === 'content' && runId && (
          <ButtonLink variant="outline" href={url('content')}>
            Open active content
          </ButtonLink>
        )}
        {mode === 'processing' && (
          <Button variant="outline" onClick={() => void history.refetch()}>
            Refresh processing
          </Button>
        )}
      </div>
      <p className="break-all text-sm text-muted-foreground">Version ID {version}</p>
      {history.error && <Notice message={documentsErrorMessage(history.error)} />}
      {history.isPending && active && <LoadingStatus>Loading processing history…</LoadingStatus>}
      {mode === 'content' &&
        value &&
        (runId || latestActive ? (
          <ExtractedContent
            key={`${path}:${runId ?? latestActive}:${unitId}`}
            path={`/api${base}/content?${contentParams}`}
            {...{ unitId, onCheck }}
          />
        ) : (
          <Notice message="This version has no active extraction result." />
        ))}
      {mode === 'processing' && value && (
        <>
          <div className="flex flex-wrap items-center gap-3">
            <DocumentState tone={value.indexStatus === 'READY' ? 'ready' : 'neutral'}>
              Index {statusLabel(value.indexStatus)}
            </DocumentState>
            {latestActive && (
              <span className="documents-record-id">Active run ID {latestActive}</span>
            )}
          </div>
          {value.items.length === 0 && <Notice message="No processing runs for this version." />}
          {value.items.map((item) => (
            <Card variant="panel" key={item.id}>
              <CardHeader>
                <CardTitle>
                  <h2>
                    Run {item.number} · {item.profile}
                  </h2>
                </CardTitle>
                <CardDescription className="break-all">{item.id}</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <div className="flex flex-wrap gap-2">
                  <DocumentState
                    tone={
                      item.state === 'SUCCEEDED'
                        ? 'ready'
                        : item.state === 'FAILED'
                          ? 'attention'
                          : 'neutral'
                    }
                  >
                    {statusLabel(item.state)}
                  </DocumentState>
                  <Badge variant="outline">Index {statusLabel(item.indexStatus)}</Badge>
                  {item.active && <Badge>Active result</Badge>}
                </div>
                <p className="text-sm">
                  Requested{' '}
                  <time dateTime={item.createdAt}>{new Date(item.createdAt).toLocaleString()}</time>
                </p>
                <ExtractionCoverage run={item} />
                {item.manifest && (item.state === 'SUCCEEDED' || item.state === 'PARTIAL') && (
                  <ButtonLink
                    className="self-start"
                    variant="outline"
                    href={url('content', { run: item.id })}
                  >
                    Open run {item.number} content
                  </ButtonLink>
                )}
              </CardContent>
            </Card>
          ))}
          <div className="flex flex-wrap gap-2">
            {cursor && (
              <ButtonLink variant="outline" href={url('processing')}>
                First page
              </ButtonLink>
            )}
            {value.nextCursor && (
              <ButtonLink variant="outline" href={url('processing', { cursor: value.nextCursor })}>
                Next page
              </ButtonLink>
            )}
          </div>
          {mayReprocess && <Reprocess {...tools} id={id} version={version} />}
        </>
      )}
    </>
  );
}

function Reprocess({
  id,
  version,
  ...tools
}: DocumentsToolProps & { id: string; version: string }) {
  const { scope, busy, message, setMessage, run } = useDocumentWork(tools);
  const { active } = tools;
  const [show, setShow] = useState(false);
  const [profile, setProfile] = useState<Profile>('searchable');
  const [selected, setSelected] = useState<DocumentsUploadReceipt>();
  const versionPath = `/api/documents/${id}/versions/${version}`;
  const policy = useQuery({
    queryKey: [...scope, '/api/documents/connection'],
    queryFn: ({ signal }) =>
      documentsRead('/api/documents/connection', documentsConnectionSchema, signal),
    enabled: active,
  });
  const source = useQuery({
    queryKey: [...scope, versionPath],
    queryFn: ({ signal }) => documentsRead(versionPath, documentsVersionSchema, signal),
    enabled: active,
  });
  const path = `${versionPath}/processing-operations`;
  const saved = useQuery({
    queryKey: [...scope, path],
    queryFn: ({ signal }) => documentsRead(path, documentsUploadHistorySchema, signal),
    enabled: active,
  });
  const type = !source.isError && source.data?.contentType;
  const capability = !policy.isError ? policy.data : undefined;
  const admission = capability?.admission;
  const profiles =
    capability?.profiles.filter(
      (candidate): candidate is Profile =>
        candidate !== 'secure-only' &&
        !!type &&
        admission?.state === 'enabled' &&
        admission.formats.includes(type) &&
        admission.profiles.includes(candidate) &&
        (candidate !== 'structured' ||
          capability.formatCapabilities?.some(
            (format) => format.contentType === type && format.structuredLayout,
          ) === true),
    ) ?? [];
  const allowed = capability?.effectiveOperations.includes('processing:reprocess') === true;
  const pendingStates = ['DRAFT', 'DISPATCHING', 'UNCERTAIN'];
  const rows = saved.isError ? [] : (saved.data ?? []);
  const current = rows.find((row) => row.receipt.id === selected?.receipt.id) ?? selected;
  const pending =
    current && pendingStates.includes(current.receipt.state)
      ? current
      : rows.find((row) => pendingStates.includes(row.receipt.state));
  const unresolved = rows.find((row) => row.receipt.state === 'UNRESOLVED_REQUIRES_REVIEW');
  const choice = profiles.includes(profile) ? profile : profiles[0];
  function submit(existing?: DocumentsUploadReceipt) {
    run(async (signal) => {
      if (!allowed) return;
      if (!existing && !choice) return;
      const operation =
        existing ??
        (await draftDocumentCommand(
          {
            kind: 'version.reprocess',
            documentId: id,
            versionId: version,
            payload: { profile: choice as Profile },
          },
          tools.session.csrfToken,
          signal,
        ));
      setSelected(operation);
      const result = await executeDocumentCommand(operation, tools.session.csrfToken, signal);
      setSelected(result);
      setShow(false);
      setMessage('Reprocessing accepted. Follow the run in processing history.');
    });
  }
  return (
    <div className="flex flex-col items-start gap-3">
      {message && <Notice message={message} />}
      {current?.runId && <p className="break-all text-sm">Accepted run ID {current.runId}</p>}
      {unresolved ? (
        <Notice
          message={`Processing operation ${unresolved.receipt.id} needs administrator review.`}
        />
      ) : pending ? (
        <>
          <p className="break-all text-sm">Saved processing operation {pending.receipt.id}</p>
          <Button disabled={busy || !allowed} onClick={() => submit(pending)}>
            Retry saved reprocessing
          </Button>
        </>
      ) : (
        <Button
          variant="outline"
          disabled={!choice || !allowed || busy || !saved.isSuccess}
          onClick={() => setShow(true)}
        >
          Request reprocessing
        </Button>
      )}
      {capability && !allowed && (
        <p className="text-sm text-muted-foreground">
          Reprocessing is unavailable under current access or deployment policy.
        </p>
      )}
      {allowed && type && !choice && (
        <p className="text-sm text-muted-foreground">
          No installed processing profile supports this version’s format.
        </p>
      )}
      {saved.error && <Notice message={documentsErrorMessage(saved.error)} />}
      <Sheet open={show} onOpenChange={(open) => setShow(open)}>
        <SheetContent>
          <SheetHeader>
            <SheetTitle>Request reprocessing</SheetTitle>
            <SheetDescription className="break-all">
              Version {version}. The current accepted result stays available while processing runs.
            </SheetDescription>
          </SheetHeader>
          <form
            className="flex flex-col gap-4 px-6"
            onSubmit={(event) => {
              event.preventDefault();
              submit();
            }}
          >
            <Field>
              <FieldLabel htmlFor="documents-processing-profile">Processing profile</FieldLabel>
              <NativeSelect
                id="documents-processing-profile"
                className="w-full"
                value={choice ?? ''}
                onChange={(event) => {
                  if (
                    event.currentTarget.value === 'searchable' ||
                    event.currentTarget.value === 'structured'
                  )
                    setProfile(event.currentTarget.value);
                }}
              >
                {profiles.map((value) => (
                  <NativeSelectOption key={value} value={value}>
                    {value === 'searchable' ? 'Searchable' : 'Structured'}
                  </NativeSelectOption>
                ))}
              </NativeSelect>
            </Field>
            {message && <Notice message={message} />}
            <Button type="submit" disabled={busy || !!pending || !choice || !allowed}>
              Confirm reprocessing
            </Button>
          </form>
        </SheetContent>
      </Sheet>
    </div>
  );
}
