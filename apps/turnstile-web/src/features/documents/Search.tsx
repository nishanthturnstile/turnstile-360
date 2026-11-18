import { useQuery } from '@tanstack/react-query';
import {
  documentsSearchPageSchema,
  documentsSearchQuerySchema,
} from '@thaarei/turnstile-contracts/documents';
import { useEffect, useState } from 'react';
import { ButtonLink } from '@/components/button-link';
import { LoadingStatus } from '@/components/content-loading';
import { Notice } from '@/components/notice';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldGroup, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { DocumentsError, documentsErrorMessage, documentsRead } from './client';
import { DocumentArrow, DocumentIdentity, DocumentState } from './DocumentUi';
import { type DocumentsToolProps, documentsScope } from './use-document-work';

const exactFilters = [
  ['title', 'Exact title', 240],
  ['fileName', 'Exact filename', 255],
  ['tag', 'Exact tag', 64],
] as const;
const referenceFilters = [
  ['referenceNamespace', 'Namespace', 64],
  ['referenceType', 'Type', 64],
  ['referenceId', 'External ID', 128],
] as const;

export function DocumentFilterFields({ values }: { values?: URLSearchParams }) {
  function fields(list: typeof exactFilters | typeof referenceFilters) {
    return list.map(([name, label, limit]) => (
      <Field key={name}>
        <FieldLabel htmlFor={`document-${name}`}>{label}</FieldLabel>
        <Input
          id={`document-${name}`}
          name={name}
          defaultValue={values?.get(name) ?? ''}
          maxLength={limit}
        />
      </Field>
    ));
  }
  return (
    <>
      <FieldGroup className="documents-filter-fields">{fields(exactFilters)}</FieldGroup>
      <details className="documents-disclosure mt-4" open={values?.has('referenceId')}>
        <summary>Reference filters</summary>
        <FieldGroup className="documents-filter-fields mt-4">{fields(referenceFilters)}</FieldGroup>
      </details>
    </>
  );
}

export function DocumentSearch({ session, active, onCheck }: DocumentsToolProps) {
  const [filters, setFilters] = useState<URLSearchParams>();
  const [cursor, setCursor] = useState<string>();
  const [invalid, setInvalid] = useState(false);
  const params = new URLSearchParams(filters);
  if (cursor) params.set('cursor', cursor);
  const api = `/api/documents/search?${params}`;
  const query = useQuery({
    queryKey: [...documentsScope(session), api],
    queryFn: ({ signal }) => documentsRead(api, documentsSearchPageSchema, signal),
    enabled: active && !!filters,
    gcTime: 0,
    staleTime: 0,
  });
  useEffect(() => {
    if (query.error instanceof DocumentsError && [401, 403].includes(query.error.status))
      void onCheck();
  }, [query.error, onCheck]);
  const visible = active && !query.isError && query.data;
  return (
    <>
      <Card variant="panel">
        <CardHeader>
          <CardTitle>
            <h2>Search documents</h2>
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(event) => {
              event.preventDefault();
              const next = new URLSearchParams();
              for (const [key, value] of new FormData(event.currentTarget))
                if (typeof value === 'string' && value !== '') next.set(key, value);
              if (next.has('metadataField') && !next.has('metadataValue'))
                next.set('metadataValue', '');
              const parsed = documentsSearchQuerySchema.safeParse(Object.fromEntries(next));
              setInvalid(!parsed.success);
              setCursor(undefined);
              if (parsed.success) {
                if (filters?.toString() === next.toString() && !cursor) void query.refetch();
                setFilters(next);
              } else {
                setFilters(undefined);
              }
            }}
          >
            <Field className="mb-4">
              <FieldLabel htmlFor="documents-search-text">Search extracted text</FieldLabel>
              <Input id="documents-search-text" name="q" maxLength={128} />
              <FieldDescription>
                English full-text search. Leave blank for exact filters only.
              </FieldDescription>
            </Field>
            <DocumentFilterFields />
            <details className="documents-disclosure mt-4">
              <summary>Metadata filter</summary>
              <FieldGroup className="mt-4 grid gap-4 sm:grid-cols-2">
                <Field>
                  <FieldLabel htmlFor="documents-metadata-field">Metadata field</FieldLabel>
                  <NativeSelect
                    id="documents-metadata-field"
                    name="metadataField"
                    className="w-full"
                  >
                    <NativeSelectOption value="">Any</NativeSelectOption>
                    <NativeSelectOption value="category">Category</NativeSelectOption>
                    <NativeSelectOption value="status">Status</NativeSelectOption>
                  </NativeSelect>
                </Field>
                <Field>
                  <FieldLabel htmlFor="documents-metadata-value">Exact metadata value</FieldLabel>
                  <Input id="documents-metadata-value" name="metadataValue" maxLength={2048} />
                </Field>
              </FieldGroup>
            </details>
            <div className="mt-4 flex flex-wrap gap-3">
              <Button type="submit">Search</Button>
              <ButtonLink href="/documents" variant="ghost">
                Back to directory
              </ButtonLink>
            </div>
          </form>
        </CardContent>
      </Card>
      {invalid && (
        <Notice message="Use at least three text characters, and complete any reference or metadata filter you select." />
      )}
      {active && filters && query.isFetching && <LoadingStatus>Searching documents…</LoadingStatus>}
      {query.error && <Notice message={documentsErrorMessage(query.error)} />}
      {visible && (
        <>
          {visible.items.length === 0 && <Notice message="No documents match your search." />}
          {visible.items.map((item) => (
            <Card variant="panel" key={item.documentId}>
              <CardHeader>
                <CardTitle>
                  <ButtonLink
                    href={`/documents/${item.documentId}`}
                    variant="link"
                    className="h-auto whitespace-normal px-0 text-left"
                  >
                    <DocumentIdentity name={item.fileName}>{item.title}</DocumentIdentity>
                  </ButtonLink>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex min-w-0 flex-col gap-2">
                <div>
                  <DocumentState tone={item.indexStatus === 'READY' ? 'ready' : 'neutral'}>
                    Index {item.indexStatus.toLowerCase().replaceAll('_', ' ')}
                  </DocumentState>
                </div>
                {item.match && item.runId && (
                  <>
                    <p className="documents-source-text">{item.match.snippet}</p>
                    <ButtonLink
                      variant="outline"
                      className="self-start whitespace-normal"
                      href={`/documents/${item.documentId}?${new URLSearchParams({
                        tab: 'content',
                        version: item.versionId,
                        run: item.runId,
                        unit: item.match.unitId,
                      })}`}
                    >
                      Open matched {item.match.kind}{' '}
                      {item.match.source.row ?? item.match.source.index}
                      <DocumentArrow />
                    </ButtonLink>
                  </>
                )}
              </CardContent>
            </Card>
          ))}
          {visible.nextCursor && (
            <Button
              className="self-start"
              variant="outline"
              onClick={() => setCursor(visible.nextCursor ?? undefined)}
            >
              Next page
            </Button>
          )}
        </>
      )}
    </>
  );
}
