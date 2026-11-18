import { useQuery } from '@tanstack/react-query';
import {
  DOCUMENTS_ROUTES,
  documentsConnectionSchema,
  documentsServiceIdentitySchema,
  documentsValidationChecklistSchema,
} from '@thaarei/turnstile-contracts/documents';
import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ButtonLink } from '@/components/button-link';
import { LoadingStatus } from '@/components/content-loading';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldLabel } from '@/components/ui/field';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Contribute, canContribute } from './Contribute';
import { DocumentsError, documentsErrorMessage, documentsRead } from './client';
import { DocumentState } from './DocumentUi';
import { documentsObservations, subscribeDocumentsObservations } from './observations';
import { type DocumentsToolProps, documentsScope, useDocumentWork } from './use-document-work';

export function Validation(props: DocumentsToolProps & { query: URLSearchParams }) {
  const { query, ...tools } = props;
  const contribution = query.get('view') === 'contribute' || query.has('document');
  const mayContribute = canContribute(tools.session);
  return (
    <>
      <nav aria-label="Validation views" className="documents-tabs">
        <ButtonLink
          href="/documents/validation"
          variant="ghost"
          aria-current={contribution ? undefined : 'page'}
        >
          Coverage checklist
        </ButtonLink>
        {mayContribute && (
          <ButtonLink
            href="/documents/validation?view=contribute"
            variant="ghost"
            aria-current={contribution ? 'page' : undefined}
          >
            Contribute
          </ButtonLink>
        )}
      </nav>
      {contribution ? (
        mayContribute ? (
          <Contribute key={query.get('document') ?? ''} {...tools} />
        ) : (
          <Notice message="Contribute requires Documents edit or upload access." />
        )
      ) : (
        <Checklist {...tools} />
      )}
    </>
  );
}

function Checklist(tools: DocumentsToolProps) {
  const { session, active, onCheck } = tools;
  const [selection, setSelection] = useState('DV-E32');
  const inspector = useRef<HTMLDivElement>(null);
  const [check, setCheck] = useState<'identity' | 'policy'>();
  const observed = useSyncExternalStore(subscribeDocumentsObservations, documentsObservations);
  const { run, busy, message } = useDocumentWork(tools);
  const checklist = useQuery({
    queryKey: [...documentsScope(session), '/api/documents/validation'],
    queryFn: ({ signal }) =>
      documentsRead('/api/documents/validation', documentsValidationChecklistSchema, signal),
    enabled: active,
    staleTime: 0,
  });
  useEffect(() => {
    if (checklist.error instanceof DocumentsError && [401, 403].includes(checklist.error.status))
      void onCheck();
  }, [checklist.error, onCheck]);
  if (!active) return null;
  if (checklist.error) return <Notice message={documentsErrorMessage(checklist.error)} />;
  if (!checklist.data) return <LoadingStatus>Checking validator access…</LoadingStatus>;
  const { items } = checklist.data;
  const details = DOCUMENTS_ROUTES.find((route) => route.evidenceId === selection);
  const row = items.find((item) => item.evidenceId === details?.evidenceId);
  const readback = details && observed[details.evidenceId];
  return (
    <div className="documents-validation-layout">
      <Card
        variant="panel"
        ref={inspector}
        tabIndex={-1}
        id="documents-validation-inspector"
        className="documents-validation-inspector"
      >
        <CardHeader>
          <CardTitle>
            <h2>Validation checklist</h2>
          </CardTitle>
          <CardDescription>
            Inspect expected results and observations from this visit.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-3">
          <Field>
            <FieldLabel htmlFor="documents-operation-inspection">Operation details</FieldLabel>
            <NativeSelect
              id="documents-operation-inspection"
              className="w-full"
              value={selection}
              onChange={(event) => setSelection(event.target.value)}
            >
              {DOCUMENTS_ROUTES.map(({ evidenceId, operationId }) => (
                <NativeSelectOption key={evidenceId} value={evidenceId}>
                  {evidenceId} {operationId}
                </NativeSelectOption>
              ))}
            </NativeSelect>
          </Field>
          {details && row && (
            <dl className="documents-facts">
              <div>
                <dt>Operation</dt>
                <dd className="break-all">{details.operationId}</dd>
              </div>
              <div>
                <dt>Surface</dt>
                <dd>{details.ui}</dd>
              </div>
              <div className="documents-detail-block">
                <dt>Expected readback</dt>
                <dd>{row.expected}</dd>
              </div>
              <div>
                <dt>Ordinary product permissions</dt>
                <dd>
                  {details.product === null
                    ? 'Private provisioning'
                    : row.allowedByProductRole
                      ? 'Required permissions present'
                      : 'Additional access required'}
                </dd>
              </div>
              <div>
                <dt>HTTP status</dt>
                <dd>{readback?.status ?? '—'}</dd>
              </div>
              <div>
                <dt>Observed outcome</dt>
                <dd>{readback?.outcome ?? 'No observation this visit'}</dd>
              </div>
              <div>
                <dt>Request ID</dt>
                <dd className="break-all font-mono text-sm">{readback?.requestId ?? '—'}</dd>
              </div>
            </dl>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                run(async (signal) => {
                  await documentsRead(
                    '/api/documents/connection/identity',
                    documentsServiceIdentitySchema,
                    signal,
                  );
                  setCheck('identity');
                  setSelection('DV-E32');
                })
              }
            >
              Check service identity
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() =>
                run(async (signal) => {
                  await documentsRead(
                    '/api/documents/connection/policy',
                    documentsConnectionSchema.shape.admission,
                    signal,
                  );
                  setCheck('policy');
                  setSelection('DV-E30');
                })
              }
            >
              Check admission policy
            </Button>
            <ButtonLink href="/documents/connection" variant="outline">
              Open connection and policy
            </ButtonLink>
          </div>
          {check === 'identity' && (
            <p className="text-sm">
              Service identity confirmed. Check Connection and policy for current access.
            </p>
          )}
          {check === 'policy' && (
            <p className="text-sm">
              Admission policy read. Open Connection and policy to review its current limits.
            </p>
          )}
          {message && <Notice message={message} />}
        </CardContent>
      </Card>
      <Card variant="panel" className="documents-validation-coverage">
        <CardHeader>
          <CardTitle>
            <h2>Operation coverage</h2>
          </CardTitle>
          <CardDescription>
            {Object.keys(observed).length} observed this visit · {items.length} operations
          </CardDescription>
        </CardHeader>
        <CardContent className="min-w-0">
          <Table aria-label="Documents operation coverage" className="documents-validation-table">
            <TableHeader>
              <TableRow>
                <TableHead scope="col">Operation</TableHead>
                <TableHead scope="col">Product surface</TableHead>
                <TableHead scope="col">HTTP</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {DOCUMENTS_ROUTES.map(({ evidenceId, operationId, ui, mode }) => {
                const observation = observed[evidenceId];
                const status = observation?.status;
                return (
                  <TableRow
                    key={evidenceId}
                    data-state={selection === evidenceId ? 'selected' : undefined}
                  >
                    <TableCell className="whitespace-normal">
                      <Button
                        variant="ghost"
                        className="documents-operation-choice"
                        aria-controls="documents-validation-inspector"
                        aria-pressed={selection === evidenceId}
                        onClick={() => {
                          setSelection(evidenceId);
                          inspector.current?.focus();
                        }}
                      >
                        <span>
                          {operationId
                            .replace('Dms', '')
                            .replace(/([a-z])([A-Z])/g, '$1 $2')
                            .replace(/^get /, 'read ')
                            .toLowerCase()
                            .replace(/^\w/, (letter) => letter.toUpperCase())}
                        </span>
                        <span>{evidenceId}</span>
                      </Button>
                    </TableCell>
                    <TableCell className="whitespace-normal">{ui}</TableCell>
                    <TableCell>
                      <DocumentState
                        tone={status == null ? 'neutral' : status < 400 ? 'ready' : 'attention'}
                      >
                        {mode === 'private_provisioning'
                          ? 'Private'
                          : (status ?? (observation ? 'No reply' : 'Not run'))}
                      </DocumentState>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  );
}
