import {
  Archive01Icon,
  ArrowLeft01Icon,
  CheckmarkCircle02Icon,
  CloudUploadIcon,
  File01Icon,
  FilterHorizontalIcon,
  Folder01Icon,
  Layers01Icon,
  Plug01Icon,
  Search01Icon,
  TimeQuarterPassIcon,
} from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import {
  DOCUMENTS_PERMISSIONS,
  type DocumentsConnectionDto,
  type DocumentsDetailDto,
  type DocumentsPageDto,
  documentsConnectionSchema,
  documentsDetailSchema,
  documentsPageSchema,
} from '@thaarei/turnstile-contracts/documents';
import type { UserSessionDto } from '@thaarei/turnstile-contracts/runtime';
import { type ReactNode, useEffect, useLayoutEffect, useState } from 'react';
import { useSearchParams } from 'react-router';
import { ButtonLink } from '@/components/button-link';
import { ContentLoading, LoadingStatus } from '@/components/content-loading';
import { AppLink } from '@/components/navigation';
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
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@/components/ui/empty';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { company } from '@/features/people/client';
import { Batches } from './Batches';
import { canContribute } from './Contribute';
import { DocumentsError, documentsErrorMessage, documentsRead } from './client';
import { type DetailTask, DocumentTask } from './DocumentTask';
import { DocumentArrow, DocumentHeading, DocumentIdentity, DocumentState } from './DocumentUi';
import { Activity, ApplicationAccess, Lifecycle, Recovery } from './OwnerTools';
import { startDocumentsObservations } from './observations';
import { Processing } from './Processing';
import { DocumentFilterFields, DocumentSearch } from './Search';
import { DownloadOriginal, Uploads } from './Uploads';
import { Validation } from './Validation';
import { Versions } from './Versions';

export const isDocumentsPath = (path: string) =>
  path === '/documents' ||
  path === '/documents/search' ||
  path === '/documents/connection' ||
  path === '/documents/uploads' ||
  path === '/documents/batches' ||
  path === '/documents/recovery' ||
  path === '/documents/activity' ||
  path === '/documents/validation' ||
  /^\/documents\/[0-9a-f-]{36}$/.test(path);
export const canEnterDocuments = (session: UserSessionDto) =>
  DOCUMENTS_PERMISSIONS.some((permission) => company(session, permission));
type Props = {
  session: UserSessionDto;
  path: string;
  active: boolean;
  onCheck: (fresh?: boolean) => Promise<boolean>;
  verification: number;
};
export function Documents(props: Props) {
  const mayValidate = company(props.session, 'turnstile:documents:validate');
  // biome-ignore lint/correctness/useExhaustiveDependencies: Verified access changes retire the diagnostics collected under the earlier authority.
  useLayoutEffect(() => {
    return props.active && mayValidate ? startDocumentsObservations() : undefined;
  }, [
    props.active,
    mayValidate,
    props.session.access.accessRevision,
    props.session.access.fingerprint,
  ]);
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { retry: false, staleTime: 30000, gcTime: 300000, refetchOnWindowFocus: false },
          mutations: { retry: false },
        },
      }),
  );
  useEffect(
    () => () => {
      void client.cancelQueries();
      client.clear();
    },
    [client],
  );
  useEffect(() => {
    if (props.active && props.verification)
      void client.refetchQueries({ type: 'active', stale: true });
  }, [client, props.active, props.verification]);
  return (
    <QueryClientProvider client={client}>
      <DocumentsWorkspace {...props} />
    </QueryClientProvider>
  );
}
function DocumentsWorkspace({ session, path, active, onCheck }: Props) {
  const permitted = canEnterDocuments(session);
  const connection = path === '/documents/connection';
  const uploads = path === '/documents/uploads';
  const batches = path === '/documents/batches';
  const recovery = path === '/documents/recovery';
  const activity = path === '/documents/activity';
  const discovery = path === '/documents/search';
  const validation = path === '/documents/validation';
  const mayRecover = company(session, 'turnstile:documents:lifecycle');
  const mayAudit = company(session, 'turnstile:documents:audit');
  const mayValidate = company(session, 'turnstile:documents:validate');
  const mayUpload = company(session, 'turnstile:documents:upload');
  const mayRead = company(session, 'turnstile:documents:read');
  const maySeeOperations =
    mayUpload ||
    (mayRead &&
      (company(session, 'turnstile:documents:edit') ||
        company(session, 'turnstile:documents:restore')));
  const section = uploads || batches || recovery || activity || validation || discovery;
  const allowed =
    permitted &&
    (recovery
      ? mayRecover
      : activity
        ? mayAudit
        : validation
          ? mayValidate
          : uploads
            ? maySeeOperations
            : connection || mayRead || (batches && mayUpload));
  const [search, setSearch] = useSearchParams();
  const api = connection
    ? '/api/documents/connection'
    : path === '/documents'
      ? `/api/documents${search.size ? `?${search}` : ''}`
      : `/api/documents/${path.split('/').at(-1)}`;
  // Identity/access changes remount the scope in App; revision/URL partition every read.
  const query = useQuery<DocumentsConnectionDto | DocumentsDetailDto | DocumentsPageDto>({
    queryKey: [
      'documents',
      session.user.id,
      session.access.fingerprint,
      session.access.accessRevision,
      api,
    ],
    queryFn: ({ signal }) =>
      connection
        ? documentsRead(api, documentsConnectionSchema, signal)
        : path === '/documents'
          ? documentsRead(api, documentsPageSchema, signal)
          : documentsRead(api, documentsDetailSchema, signal),
    enabled: active && allowed && !section,
  });
  useEffect(() => {
    if (query.error instanceof DocumentsError && [401, 403].includes(query.error.status))
      void onCheck();
  }, [query.error, onCheck]);
  const directory = path === '/documents';
  const detail = !connection && !section && !directory;
  const destinations = [
    {
      label: 'All documents',
      href: '/documents',
      icon: Folder01Icon,
      show: mayRead,
      current: directory || detail,
    },
    {
      label: 'Search',
      href: '/documents/search',
      icon: Search01Icon,
      show: mayRead,
      current: discovery,
    },
    {
      label: 'Uploads',
      href: '/documents/uploads',
      icon: CloudUploadIcon,
      show: maySeeOperations,
      current: uploads,
    },
    {
      label: 'Batches',
      href: '/documents/batches',
      icon: Layers01Icon,
      show: mayRead || mayUpload,
      current: batches,
    },
    {
      label: 'Recovery',
      href: '/documents/recovery',
      icon: Archive01Icon,
      show: mayRecover,
      current: recovery,
    },
    {
      label: 'Activity',
      href: '/documents/activity',
      icon: TimeQuarterPassIcon,
      show: mayAudit,
      current: activity,
    },
    {
      label: 'Validation',
      href: '/documents/validation',
      icon: CheckmarkCircle02Icon,
      show: mayValidate,
      current: validation,
    },
    {
      label: 'Connection and policy',
      href: '/documents/connection',
      icon: Plug01Icon,
      show: permitted,
      current: connection,
    },
  ] as const;
  const destination = destinations.find((item) => item.current) ?? destinations[0];
  const description = {
    '/documents': 'Browse files you own or that another application has shared with you.',
    '/documents/search': 'Find files by their details or by text in an indexed result.',
    '/documents/uploads': 'Add a file and follow it from transfer to indexing.',
    '/documents/batches': 'Upload several files together and follow each result.',
    '/documents/recovery': 'Review a deleted document and check whether it can be restored.',
    '/documents/activity': 'Review actions recorded for this application.',
    '/documents/validation': 'Inspect real operation results and contribute to shared documents.',
    '/documents/connection': 'Check service access, file admission and available formats.',
  }[path];
  return (
    <div className="documents-workspace">
      <nav className="documents-navigation" aria-label="Documents sections">
        {destinations
          .filter(({ show }) => show)
          .map(({ label, href, icon, current }) => (
            <ButtonLink
              key={href}
              href={href}
              variant="ghost"
              aria-current={current ? 'page' : undefined}
            >
              <HugeiconsIcon icon={icon} data-icon="inline-start" aria-hidden="true" />
              {label}
            </ButtonLink>
          ))}
      </nav>
      <section
        className="documents-content"
        aria-label={detail ? 'Document overview' : destination.label}
      >
        {(!detail || !query.data) && (
          <DocumentHeading
            icon={detail ? File01Icon : destination.icon}
            title={directory || detail ? 'Documents' : destination.label}
            description={description}
            actions={
              directory && mayUpload ? (
                <ButtonLink href="/documents/uploads">
                  <HugeiconsIcon
                    icon={CloudUploadIcon}
                    data-icon="inline-start"
                    aria-hidden="true"
                  />
                  Upload file
                </ButtonLink>
              ) : undefined
            }
          />
        )}
        <div className="documents-content-body" aria-busy={query.isFetching}>
          {!allowed ? (
            <Notice message="You do not have access to this section. Check your session for current permissions." />
          ) : uploads ? (
            <Uploads key={search.toString()} session={session} active={active} onCheck={onCheck} />
          ) : batches ? (
            <Batches session={session} active={active} onCheck={onCheck} />
          ) : recovery ? (
            <Recovery {...{ session, active, onCheck }} />
          ) : activity ? (
            <Activity {...{ session, active, onCheck }} />
          ) : validation ? (
            <Validation query={search} {...{ session, active, onCheck }} />
          ) : discovery ? (
            <DocumentSearch {...{ session, active, onCheck }} />
          ) : query.error ? (
            <>
              <Notice message={documentsErrorMessage(query.error)} />
              {mayRecover && /^\/documents\/[0-9a-f-]{36}$/.test(path) && (
                <ButtonLink
                  className="self-start"
                  variant="outline"
                  href={`/documents/recovery?document=${path.split('/').at(-1)}`}
                >
                  Open Recovery
                </ButtonLink>
              )}
              <Button variant="outline" className="self-start" onClick={() => void query.refetch()}>
                Try again
              </Button>
            </>
          ) : query.isPending ? (
            <ContentLoading
              label={connection ? 'Checking document connection…' : 'Loading documents…'}
            />
          ) : (
            query.data && (
              <>
                {query.isFetching && <LoadingStatus>Refreshing saved information…</LoadingStatus>}
                {connection && documentsConnectionSchema.safeParse(query.data).success ? (
                  <Connection value={documentsConnectionSchema.parse(query.data)} />
                ) : path === '/documents' && documentsPageSchema.safeParse(query.data).success ? (
                  <>
                    <details
                      className="documents-filter-panel"
                      key={search.toString()}
                      open={Array.from(search.keys()).some((key) => key !== 'cursor') || undefined}
                    >
                      <summary>
                        <HugeiconsIcon icon={FilterHorizontalIcon} size={16} aria-hidden="true" />
                        Filter documents
                      </summary>
                      <form
                        aria-label="Document filters"
                        key={search.toString()}
                        onSubmit={(event) => {
                          event.preventDefault();
                          const form = new FormData(event.currentTarget);
                          const params = new URLSearchParams();
                          for (const [key, value] of form)
                            if (typeof value === 'string' && value) params.set(key, value);
                          setSearch(params);
                        }}
                      >
                        <DocumentFilterFields values={search} />
                        <div className="documents-filter-actions">
                          <Button type="submit">Apply filters</Button>
                          {Array.from(search.keys()).some((key) => key !== 'cursor') && (
                            <ButtonLink href="/documents" variant="ghost">
                              Clear filters
                            </ButtonLink>
                          )}
                        </div>
                      </form>
                    </details>
                    <Directory
                      page={documentsPageSchema.parse(query.data)}
                      filtered={Array.from(search.keys()).some((key) => key !== 'cursor')}
                      mayUpload={mayUpload}
                      search={search}
                    />
                  </>
                ) : documentsDetailSchema.safeParse(query.data).success ? (
                  <DocumentWorkspace
                    key={path}
                    document={documentsDetailSchema.parse(query.data)}
                    session={session}
                    active={active}
                    onCheck={onCheck}
                    search={search}
                  />
                ) : null}
              </>
            )
          )}
        </div>
        <footer className="documents-workspace-footer">
          <Button variant="ghost" size="sm" onClick={() => void onCheck()}>
            Refresh session and access
          </Button>
        </footer>
      </section>
    </div>
  );
}
function Directory({
  page,
  filtered,
  mayUpload,
  search,
}: {
  page: DocumentsPageDto;
  filtered: boolean;
  mayUpload: boolean;
  search: URLSearchParams;
}) {
  const next = new URLSearchParams(search);
  if (page.nextCursor) next.set('cursor', page.nextCursor);
  const first = new URLSearchParams(search);
  first.delete('cursor');
  return (
    <Card variant="panel">
      <CardHeader>
        <CardTitle>
          <h2>Document library</h2>
        </CardTitle>
        {page.items.length > 0 && (
          <CardDescription>
            {page.items.length} {page.items.length === 1 ? 'document' : 'documents'} on this page
          </CardDescription>
        )}
      </CardHeader>
      {page.items.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <HugeiconsIcon icon={Folder01Icon} />
            </EmptyMedia>
            <EmptyTitle>{filtered ? 'No matching documents' : 'No documents yet'}</EmptyTitle>
            <EmptyDescription>
              {filtered
                ? 'Try another exact value or clear the current filters.'
                : 'Files you upload or that are shared with you appear here.'}
            </EmptyDescription>
          </EmptyHeader>
          {!filtered && mayUpload && (
            <EmptyContent>
              <ButtonLink href="/documents/uploads">Upload your first file</ButtonLink>
            </EmptyContent>
          )}
        </Empty>
      ) : (
        <Table className="documents-library" aria-label="Document library" role="table">
          <TableHeader role="rowgroup">
            <TableRow role="row">
              <TableHead scope="col" role="columnheader">
                Document
              </TableHead>
              <TableHead scope="col" role="columnheader">
                Original
              </TableHead>
              <TableHead scope="col" role="columnheader">
                Search
              </TableHead>
              <TableHead scope="col" role="columnheader">
                Access
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody role="rowgroup">
            {page.items.map((document) => (
              <TableRow key={document.id} role="row">
                <TableCell className="whitespace-normal" role="cell">
                  <AppLink
                    className="documents-file-link"
                    href={`/documents/${document.id}`}
                    aria-label={document.title}
                  >
                    <DocumentIdentity
                      name={document.fileName !== document.title ? document.fileName : undefined}
                    >
                      {document.title}
                    </DocumentIdentity>
                  </AppLink>
                  {document.tags.length > 0 && (
                    <ul className="documents-library-tags" aria-label="Document tags">
                      {document.tags.map((tag) => (
                        <li key={tag}>
                          <Badge variant="secondary">{tag}</Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </TableCell>
                <TableCell role="cell">
                  <span className="documents-mobile-field" aria-hidden="true">
                    Original
                  </span>
                  <DocumentState tone={document.downloadable ? 'ready' : 'neutral'}>
                    {document.downloadable ? 'Available' : 'Unavailable'}
                  </DocumentState>
                </TableCell>
                <TableCell role="cell">
                  <span className="documents-mobile-field" aria-hidden="true">
                    Search
                  </span>
                  {document.searchable ? 'Searchable' : 'Not searchable'}
                </TableCell>
                <TableCell role="cell">
                  <span className="documents-mobile-field" aria-hidden="true">
                    Access
                  </span>
                  <Badge variant="outline">
                    {document.ownership === 'owned' ? 'Owned' : 'Shared'}
                  </Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {(page.nextCursor || search.has('cursor')) && (
        <CardFooter className="flex-wrap justify-between gap-3">
          {search.has('cursor') && (
            <ButtonLink variant="ghost" href={first.size ? `/documents?${first}` : '/documents'}>
              First page
            </ButtonLink>
          )}
          {page.nextCursor && (
            <ButtonLink className="ml-auto" variant="outline" href={`/documents?${next}`}>
              Next page
              <DocumentArrow />
            </ButtonLink>
          )}
        </CardFooter>
      )}
    </Card>
  );
}
function DocumentWorkspace({
  document,
  session,
  active,
  onCheck,
  search,
}: {
  document: DocumentsDetailDto;
  session: UserSessionDto;
  active: boolean;
  onCheck: Props['onCheck'];
  search: URLSearchParams;
}) {
  const [task, setTask] = useState<DetailTask>();
  const owned = document.ownership === 'owned';
  const tabs = [
    ['overview', 'Overview'],
    ['versions', 'Versions'],
    ['processing', 'Processing'],
    ['content', 'Content'],
  ];
  if (owned && company(session, 'turnstile:documents:share'))
    tabs.push(['access', 'Application access']);
  if (owned && company(session, 'turnstile:documents:lifecycle'))
    tabs.push(['lifecycle', 'Lifecycle']);
  if (owned && company(session, 'turnstile:documents:audit')) tabs.push(['activity', 'Activity']);
  const tab = tabs.find(([value]) => value === search.get('tab'))?.[0] ?? 'overview';
  const mayEdit = owned && company(session, 'turnstile:documents:edit');
  const policy = useQuery({
    queryKey: [
      'documents',
      session.user.id,
      session.access.fingerprint,
      session.access.accessRevision,
      '/api/documents/connection',
    ],
    enabled: active && mayEdit && tab === 'overview',
    queryFn: ({ signal }) =>
      documentsRead('/api/documents/connection', documentsConnectionSchema, signal),
  });
  const full =
    !policy.isError && policy.data?.productAccess === 'full' && policy.data.dmsAccess === 'full';
  return (
    <>
      <AppLink href="/documents" className="documents-back-link">
        <HugeiconsIcon icon={ArrowLeft01Icon} size={16} aria-hidden="true" />
        Back to documents
      </AppLink>
      <DocumentHeading
        icon={File01Icon}
        title={document.title}
        description={document.fileName !== document.title ? document.fileName : undefined}
        actions={
          tab === 'overview' && document.downloadable ? (
            <DownloadOriginal key={document.id} id={document.id} />
          ) : undefined
        }
      />
      <nav className="documents-tabs" aria-label="Document sections">
        {tabs.map(([key, label]) => (
          <ButtonLink
            key={key}
            variant="ghost"
            aria-current={tab === key ? 'page' : undefined}
            href={`/documents/${document.id}${key === 'overview' ? '' : `?tab=${key}`}`}
          >
            {label}
          </ButtonLink>
        ))}
      </nav>
      {tab === 'versions' ? (
        <Versions {...{ document, session, active, onCheck, search }} showTask={setTask} />
      ) : tab === 'processing' || tab === 'content' ? (
        <Processing {...{ document, session, active, onCheck, search }} mode={tab} />
      ) : tab === 'access' ? (
        <ApplicationAccess id={document.id} {...{ session, active, onCheck }} />
      ) : tab === 'lifecycle' ? (
        <Lifecycle id={document.id} {...{ session, active, onCheck }} />
      ) : tab === 'activity' ? (
        <Activity id={document.id} {...{ session, active, onCheck }} />
      ) : (
        <>
          <Overview document={document}>
            {!owned && canContribute(session) && (
              <ButtonLink variant="outline" href={`/documents/validation?document=${document.id}`}>
                Contribute
              </ButtonLink>
            )}
            {mayEdit &&
              full &&
              policy.data?.effectiveOperations.includes('documents:edit-metadata') && (
                <Button variant="outline" onClick={() => setTask('edit')}>
                  Edit document details
                </Button>
              )}
            {mayEdit &&
              full &&
              policy.data?.effectiveOperations.includes('documents:references') && (
                <Button variant="outline" onClick={() => setTask('references')}>
                  Manage references
                </Button>
              )}
          </Overview>
          {mayEdit && policy.data && !full && (
            <Notice message="Document changes require full access in both products." />
          )}
        </>
      )}
      {active && task && (
        <DocumentTask
          task={task}
          document={document}
          session={session}
          onCheck={onCheck}
          close={() => setTask(undefined)}
        />
      )}
    </>
  );
}
function Overview({ document, children }: { document: DocumentsDetailDto; children: ReactNode }) {
  return (
    <Card variant="panel">
      <CardHeader>
        <CardTitle>
          <h2>Document details</h2>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{document.ownership === 'owned' ? 'Owned' : 'Shared'}</Badge>
          <DocumentState tone={document.downloadable ? 'ready' : 'neutral'}>
            Original {document.downloadable ? 'available' : 'unavailable'}
          </DocumentState>
          <Badge variant="outline">{document.searchable ? 'Searchable' : 'Not searchable'}</Badge>
        </div>
        <dl className="documents-facts">
          <div>
            <dt>Document ID</dt>
            <dd className="break-all text-sm text-muted-foreground">{document.id}</dd>
          </div>
          <div>
            <dt>Revision</dt>
            <dd>{document.revision}</dd>
          </div>
          <div>
            <dt>Tags</dt>
            <dd className="flex flex-wrap gap-1.5">
              {document.tags.length
                ? document.tags.map((tag) => (
                    <Badge variant="secondary" key={tag}>
                      {tag}
                    </Badge>
                  ))
                : 'No tags'}
            </dd>
          </div>
          <div className="documents-detail-block">
            <dt>Metadata</dt>
            <dd>
              <dl className="grid min-w-0 gap-2">
                {Object.entries(document.metadata).map(([key, value]) => (
                  <div key={key}>
                    <dt>{key}</dt>
                    <dd className="break-words text-sm text-muted-foreground">
                      {JSON.stringify(value)}
                    </dd>
                  </div>
                ))}
              </dl>
              {!Object.keys(document.metadata).length && 'No metadata'}
            </dd>
          </div>
          <div className="documents-detail-block">
            <dt>References</dt>
            <dd>
              {document.references.length ? (
                <ul>
                  {document.references.map((reference) => (
                    <li className="break-words" key={reference.id}>
                      {reference.namespace} / {reference.type} / {reference.externalId}
                    </li>
                  ))}
                </ul>
              ) : (
                'No references'
              )}
            </dd>
          </div>
        </dl>
      </CardContent>
      <CardFooter className="documents-detail-actions flex-wrap gap-2">{children}</CardFooter>
    </Card>
  );
}
function Connection({ value }: { value: DocumentsConnectionDto }) {
  return (
    <Card variant="panel">
      <CardHeader>
        <CardTitle>
          <h2>Access and admission</h2>
        </CardTitle>
        <CardDescription>
          Product approval and document-service approval are managed independently.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-5">
        <dl className="documents-facts">
          {[
            ['Turnstile access', value.productAccess],
            ['Document-service access', value.dmsAccess],
            ['Upload admission', value.admission.state],
            [
              'Maximum file size',
              value.admission.limits
                ? `${value.admission.limits.maxFileBytes.toLocaleString()} bytes`
                : 'Not configured',
            ],
            ['Formats', value.formats.join(', ') || 'None enabled'],
            ['Profiles', value.profiles.join(', ') || 'None enabled'],
            ['Languages', value.languages.join(', ') || 'None enabled'],
          ].map(([label, text]) => (
            <div key={label}>
              <dt>{label}</dt>
              <dd className="break-words text-sm text-muted-foreground">{text}</dd>
            </div>
          ))}
        </dl>
        <details className="documents-disclosure">
          <summary>Admission limits</summary>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            {[
              ['Metadata size', `${value.admission.limits.metadataBytes.toLocaleString()} bytes`],
              [
                'Upload control size',
                `${value.admission.limits.uploadControlBytes.toLocaleString()} bytes`,
              ],
              [
                'Batch manifest size',
                `${value.admission.limits.batchManifestBytes.toLocaleString()} bytes`,
              ],
              [
                'Batch control size',
                `${value.admission.limits.batchControlBytes.toLocaleString()} bytes`,
              ],
              ['Active uploads for this application', value.admission.limits.activePerApplication],
              ['Active uploads for this installation', value.admission.limits.activePerTenant],
              ['Queued work limit', value.admission.limits.queuedWork],
              ['Admitted formats', value.admission.formats.join(', ') || 'None enabled'],
              ['Admitted profiles', value.admission.profiles.join(', ') || 'None enabled'],
            ].map(([label, text]) => (
              <div key={label}>
                <dt>{label}</dt>
                <dd className="break-words text-sm text-muted-foreground">{text}</dd>
              </div>
            ))}
          </dl>
        </details>
        <div className="min-w-0">
          <h3 className="section-title">Format capabilities</h3>
          {value.formatCapabilities?.length ? (
            <Table aria-label="Format capabilities">
              <TableHeader>
                <TableRow>
                  {['Format', 'Security', 'Text', 'OCR', 'Tables', 'Layout', 'Preview'].map(
                    (label) => (
                      <TableHead key={label}>{label}</TableHead>
                    ),
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {value.formatCapabilities.map((format) => (
                  <TableRow key={format.contentType}>
                    <TableCell>{format.contentType}</TableCell>
                    {[
                      format.securityAssessment,
                      format.textExtraction,
                      format.ocr,
                      format.tabularData,
                      format.structuredLayout,
                      format.preview,
                    ].map((available, i) => (
                      <TableCell
                        key={['security', 'text', 'ocr', 'tables', 'layout', 'preview'][i]}
                      >
                        {available === undefined
                          ? 'Not advertised'
                          : available
                            ? 'Available'
                            : 'Unavailable'}
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className="mt-3 text-sm text-muted-foreground">
              Per-format capabilities are not advertised by the document service.
            </p>
          )}
        </div>
        <div>
          <h3 className="section-title">Operations available in the ordinary workflow</h3>
          <ul className="mt-3 flex flex-wrap gap-2">
            {value.effectiveOperations.map((operation) => (
              <li key={operation}>
                <Badge variant="outline">
                  {operation.replaceAll(':', ' · ').replaceAll('-', ' ')}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}
