import { useQuery } from '@tanstack/react-query';
import {
  type DocumentsDetailDto,
  documentsConnectionSchema,
  documentsVersionPageSchema,
  documentsVersionSchema,
} from '@thaarei/turnstile-contracts/documents';
import { peopleIdSchema, type UserSessionDto } from '@thaarei/turnstile-contracts/runtime';
import { useEffect } from 'react';
import { ButtonLink } from '@/components/button-link';
import { LoadingStatus } from '@/components/content-loading';
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
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { company } from '@/features/people/client';
import { DocumentsError, documentsErrorMessage, documentsRead } from './client';
import type { DetailTask } from './DocumentTask';
import { DocumentState } from './DocumentUi';
import { DownloadOriginal } from './Uploads';

export function Versions({
  document,
  search,
  session,
  active,
  onCheck,
  showTask,
}: {
  document: DocumentsDetailDto;
  search: URLSearchParams;
  session: UserSessionDto;
  active: boolean;
  onCheck: (fresh?: boolean) => Promise<boolean>;
  showTask: (task: DetailTask) => void;
}) {
  const base = `/documents/${document.id}`;
  const key = [
    'documents',
    session.user.id,
    session.access.fingerprint,
    session.access.accessRevision,
  ];
  const cursor = search.get('cursor');
  const pagePath = `/api${base}/versions${cursor ? `?${new URLSearchParams({ cursor })}` : ''}`;
  const page = useQuery({
    queryKey: [...key, pagePath],
    enabled: active,
    queryFn: ({ signal }) => documentsRead(pagePath, documentsVersionPageSchema, signal),
  });
  const requested = search.get('version');
  const versionId = peopleIdSchema.safeParse(requested);
  const versionPath = `/api${base}/versions/${versionId.data ?? ''}`;
  const selected = useQuery({
    queryKey: [...key, versionPath],
    enabled: active && versionId.success,
    queryFn: ({ signal }) => documentsRead(versionPath, documentsVersionSchema, signal),
  });
  const policy = useQuery({
    queryKey: [...key, '/api/documents/connection'],
    enabled: active && document.ownership === 'owned',
    queryFn: ({ signal }) =>
      documentsRead('/api/documents/connection', documentsConnectionSchema, signal),
  });
  useEffect(() => {
    if (
      [page.error, selected.error].some(
        (error) => error instanceof DocumentsError && [401, 403].includes(error.status),
      )
    )
      void onCheck();
  }, [page.error, selected.error, onCheck]);
  const canStart =
    document.ownership === 'owned' &&
    !policy.isError &&
    policy.data?.productAccess === 'full' &&
    policy.data.dmsAccess === 'full' &&
    policy.data.admission.state === 'enabled';
  const value = !selected.isError && selected.data;
  const visiblePage = page.isError ? undefined : page.data;
  return (
    <>
      <Card variant="panel">
        <CardHeader>
          <CardTitle>
            <h2>Version history</h2>
          </CardTitle>
          <CardDescription className="break-words">
            {document.title} · Revision {document.revision}
          </CardDescription>
        </CardHeader>
        <CardContent className="min-w-0">
          {page.isPending && <LoadingStatus>Loading version history…</LoadingStatus>}
          {page.error && <Notice message={documentsErrorMessage(page.error)} />}
          {visiblePage &&
            (visiblePage.items.length ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Version</TableHead>
                    <TableHead scope="col">File</TableHead>
                    <TableHead scope="col">Security</TableHead>
                    <TableHead scope="col">Original</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visiblePage.items.map((version) => {
                    const params = new URLSearchParams({ tab: 'versions', version: version.id });
                    if (cursor) params.set('cursor', cursor);
                    return (
                      <TableRow
                        key={version.id}
                        data-state={versionId.data === version.id ? 'selected' : undefined}
                      >
                        <TableCell>
                          <ButtonLink
                            href={`${base}?${params}`}
                            variant="ghost"
                            aria-current={versionId.data === version.id ? 'page' : undefined}
                          >
                            Version {version.number}
                          </ButtonLink>
                          {version.isCurrent && <Badge variant="secondary">Current</Badge>}
                        </TableCell>
                        <TableCell className="whitespace-normal wrap-anywhere">
                          {version.fileName}
                        </TableCell>
                        <TableCell>
                          <DocumentState tone={version.security === 'PASSED' ? 'ready' : 'neutral'}>
                            {version.security.toLowerCase()}
                          </DocumentState>
                        </TableCell>
                        <TableCell>
                          <DocumentState
                            tone={version.availability === 'AVAILABLE' ? 'ready' : 'neutral'}
                          >
                            {version.availability.toLowerCase()}
                          </DocumentState>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            ) : (
              <p>No versions on this page.</p>
            ))}
        </CardContent>
        <CardFooter className="flex flex-wrap gap-2">
          {canStart &&
            policy.data?.effectiveOperations.includes('versions:write') &&
            company(session, 'turnstile:documents:upload') && (
              <ButtonLink href={`/documents/uploads?document=${document.id}`}>
                {policy.data.admission.formats.length === 1 &&
                policy.data.admission.formats[0] === 'text/plain'
                  ? 'Add text version'
                  : 'Add version'}
              </ButtonLink>
            )}
          {cursor && (
            <ButtonLink variant="outline" href={`${base}?tab=versions`}>
              Newest versions
            </ButtonLink>
          )}
          {visiblePage?.nextCursor && (
            <ButtonLink
              variant="outline"
              href={`${base}?${new URLSearchParams({ tab: 'versions', cursor: visiblePage.nextCursor })}`}
            >
              Next versions
            </ButtonLink>
          )}
          {page.error && (
            <Button variant="outline" onClick={() => void page.refetch()}>
              Retry version list
            </Button>
          )}
        </CardFooter>
      </Card>
      {requested && !versionId.success && (
        <Notice message="Choose a version from the document’s history." />
      )}
      {versionId.success && selected.isPending && <LoadingStatus>Loading version…</LoadingStatus>}
      {selected.error && <Notice message={documentsErrorMessage(selected.error)} />}
      {value && (
        <Card variant="panel">
          <CardHeader>
            <CardTitle>
              <h3>Version {value.number} details</h3>
            </CardTitle>
            <CardDescription className="break-words">{value.fileName}</CardDescription>
          </CardHeader>
          <CardContent>
            <dl className="documents-facts">
              <div>
                <dt>Version ID</dt>
                <dd className="break-all">{value.id}</dd>
              </div>
              <div>
                <dt>Created</dt>
                <dd>{new Date(value.createdAt).toLocaleString()}</dd>
              </div>
              <div>
                <dt>Content type</dt>
                <dd>{value.contentType}</dd>
              </div>
              <div>
                <dt>Size</dt>
                <dd>{value.size.toLocaleString()} bytes</dd>
              </div>
              <div>
                <dt>Upload</dt>
                <dd>{value.upload?.toLowerCase().replaceAll('_', ' ') ?? 'Unavailable'}</dd>
              </div>
              <div>
                <dt>Security</dt>
                <dd>{value.security.toLowerCase()}</dd>
              </div>
              <div>
                <dt>Availability</dt>
                <dd>{value.availability.toLowerCase()}</dd>
              </div>
              <div>
                <dt>Publication</dt>
                <dd>{value.isCurrent ? 'Current version' : 'Historical or pending version'}</dd>
              </div>
              {value.sha256 && (
                <div>
                  <dt>SHA-256</dt>
                  <dd className="break-all">{value.sha256}</dd>
                </div>
              )}
              {value.restoredFromVersionId && (
                <div>
                  <dt>Restored from</dt>
                  <dd className="break-all">{value.restoredFromVersionId}</dd>
                </div>
              )}
            </dl>
          </CardContent>
          <CardFooter className="flex flex-wrap gap-2">
            {value.downloadable && (
              <DownloadOriginal key={value.id} id={document.id} versionId={value.id} />
            )}
            {value.downloadable && (
              <ButtonLink
                variant="outline"
                href={`${base}?${new URLSearchParams({ tab: 'processing', version: value.id })}`}
              >
                Open version processing
              </ButtonLink>
            )}
            {canStart &&
              value.downloadable &&
              policy.data?.admission.profiles.includes('secure-only') &&
              policy.data?.effectiveOperations.includes('versions:restore') &&
              company(session, 'turnstile:documents:restore') && (
                <Button
                  variant="outline"
                  onClick={() => showTask({ versionId: value.id, number: value.number })}
                >
                  Restore this version
                </Button>
              )}
          </CardFooter>
        </Card>
      )}
    </>
  );
}
