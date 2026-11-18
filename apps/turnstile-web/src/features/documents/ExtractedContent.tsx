import {
  DOCUMENTS_LIMITS,
  documentsContentSchema,
  documentsExtractionArtifactSchema,
} from '@thaarei/turnstile-contracts/documents';
import { useEffect, useState } from 'react';
import { LoadingStatus } from '@/components/content-loading';
import { Notice } from '@/components/notice';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { DocumentsError, documentsErrorMessage, documentsRead } from './client';
import { verifiedDocumentBytes } from './file-transfer';

type Artifact = ReturnType<typeof documentsExtractionArtifactSchema.parse>;
type Run = ReturnType<typeof documentsContentSchema.parse>['run'];
const batchSize = 20;
export const statusLabel = (value: string) => value.toLowerCase().replaceAll('_', ' ');

export function ExtractionCoverage({ run }: { run: Run }) {
  if (!run.manifest) return null;
  const { coverage, warnings, processor, processorVersion, ocr, structure } = run.manifest;
  return (
    <div className="flex min-w-0 flex-col gap-2 text-sm">
      <p>
        {processor} {processorVersion}
      </p>
      <p>
        {coverage.completed} completed · {coverage.attempted} attempted · {coverage.omitted} omitted
        · {coverage.ocrNeeded} need OCR
      </p>
      {ocr && (
        <p>
          OCR · {ocr.engine} {ocr.engineVersion} · {ocr.language}
        </p>
      )}
      {structure && <p>Structured layout · Docling {structure.processorVersion}</p>}
      {warnings.length > 0 && <p>Warnings · {warnings.map(statusLabel).join(', ')}</p>}
    </div>
  );
}

export function ExtractedContent({
  path,
  unitId,
  onCheck,
}: {
  path: string;
  unitId: string | null;
  onCheck: (fresh?: boolean) => Promise<boolean>;
}) {
  const [attempt, setAttempt] = useState(0);
  const [outcome, setOutcome] = useState<{ artifact: Artifact; run: Run } | { error: unknown }>();
  // biome-ignore lint/correctness/useExhaustiveDependencies: A user retry starts a fresh transfer without keeping the previous capability.
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    async function load() {
      const descriptor = await documentsRead(path, documentsContentSchema, signal);
      const cap = descriptor.artifacts[0];
      if (!cap) throw new Error('Missing extraction artifact');
      const bytes = await verifiedDocumentBytes(cap, DOCUMENTS_LIMITS.artifactBytes, signal);
      const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      const artifact = documentsExtractionArtifactSchema.parse(JSON.parse(text));
      if (
        !descriptor.run.manifest ||
        JSON.stringify(artifact.manifest) !== JSON.stringify(descriptor.run.manifest) ||
        artifact.manifest.documentId !== descriptor.run.documentId ||
        artifact.manifest.versionId !== descriptor.run.versionId ||
        artifact.manifest.runId !== descriptor.run.id ||
        artifact.manifest.sourceSha256 !== descriptor.run.sourceSha256
      )
        throw new Error('Extraction identity changed');
      // Recheck the same selection after transfer. A capability already issued
      // by DMS can still finish after the server revokes the selection.
      const current = await documentsRead(path, documentsContentSchema, signal);
      if (
        current.run.id !== descriptor.run.id ||
        current.artifacts[0]?.sha256 !== cap.sha256 ||
        current.artifacts[0].size !== cap.size
      )
        throw new Error('Extraction changed during transfer');
      signal.throwIfAborted();
      setOutcome({ artifact, run: current.run });
    }
    void load().catch((error: unknown) => {
      if (!signal.aborted) setOutcome({ error });
    });
    return () => controller.abort();
  }, [path, attempt]);
  useEffect(() => {
    if (
      outcome &&
      'error' in outcome &&
      outcome.error instanceof DocumentsError &&
      [401, 403].includes(outcome.error.status)
    )
      void onCheck();
  }, [outcome, onCheck]);

  if (!outcome) return <LoadingStatus>Verifying extracted content…</LoadingStatus>;
  if ('error' in outcome)
    return (
      <div className="flex flex-col items-start gap-3">
        <Notice
          message={
            outcome.error instanceof DocumentsError
              ? documentsErrorMessage(outcome.error)
              : 'The extracted content could not be verified. Try loading it again.'
          }
        />
        <Button
          variant="outline"
          onClick={() => {
            setOutcome(undefined);
            setAttempt((previous) => previous + 1);
          }}
        >
          Retry content
        </Button>
      </div>
    );
  return <ArtifactViewer {...outcome} unitId={unitId} />;
}

function ArtifactViewer({
  artifact,
  run,
  unitId,
}: {
  artifact: Artifact;
  run: Run;
  unitId: string | null;
}) {
  const [selected, setSelected] = useState(() =>
    unitId
      ? Math.max(
          0,
          artifact.units.findIndex((unit) => unit.id === unitId),
        )
      : 0,
  );
  const [structurePage, setStructurePage] = useState(0);
  const [structureOffset, setStructureOffset] = useState(0);
  const [cellOffset, setCellOffset] = useState(0);
  const [wordOffset, setWordOffset] = useState(0);
  const unit = artifact.units[selected];
  const table = unit?.kind === 'cell';
  const start = table ? selected - (selected % batchSize) : selected;
  const group = artifact.units.slice(start, start + batchSize);
  const layout = artifact.structure?.pages[structurePage];
  const element = layout?.elements[structureOffset];
  function select(index: number) {
    setSelected(index);
    setWordOffset(0);
  }
  return (
    <Card variant="panel">
      <CardHeader>
        <CardTitle>
          <h2>Extracted content</h2>
        </CardTitle>
        <CardDescription>Untrusted extracted data · Run {run.number}</CardDescription>
      </CardHeader>
      <CardContent className="flex min-w-0 flex-col gap-5">
        <div className="flex flex-wrap gap-2">
          <Badge variant="secondary">{statusLabel(run.state)}</Badge>
          <Badge variant="outline">Index {statusLabel(run.indexStatus)}</Badge>
        </div>
        <ExtractionCoverage run={run} />
        {unit ? (
          <section className="flex min-w-0 flex-col gap-3" aria-label="Source units">
            <div className="flex flex-wrap items-center gap-2">
              <Button
                variant="outline"
                disabled={start === 0}
                onClick={() => select(Math.max(0, start - (table ? batchSize : 1)))}
              >
                Previous source
              </Button>
              <p className="text-sm text-muted-foreground tabular-nums">
                {table ? `${start + 1}–${start + group.length}` : selected + 1} of{' '}
                {artifact.units.length}
              </p>
              <Button
                variant="outline"
                disabled={start + (table ? batchSize : 1) >= artifact.units.length}
                onClick={() => select(start + (table ? batchSize : 1))}
              >
                Next source
              </Button>
            </div>
            {table ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Source</TableHead>
                    <TableHead scope="col">Value</TableHead>
                    <TableHead scope="col">Formula</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {group.map((cell) => (
                    <TableRow
                      key={cell.id}
                      data-state={cell.id === unitId ? 'selected' : undefined}
                    >
                      <TableCell className="whitespace-normal">
                        {cell.source.sheet && <span>{cell.source.sheet} · </span>}
                        Row {cell.source.row} · Column {cell.source.column}
                        {cell.source.valueType && <div>{cell.source.valueType}</div>}
                      </TableCell>
                      <TableCell className="max-w-64 whitespace-pre-wrap break-all">
                        {cell.text}
                      </TableCell>
                      <TableCell className="max-w-64 whitespace-pre-wrap break-all">
                        {cell.source.formula}
                        {cell.source.cached && <div>Cached value</div>}
                        {cell.warnings.map((warning) => (
                          <div key={warning}>{statusLabel(warning)}</div>
                        ))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <>
                <h3 className="font-medium">
                  {unit.kind} {unit.source.index}
                </h3>
                <p className="break-words text-sm text-muted-foreground">
                  {unit.source.fileName && <>{unit.source.fileName} · </>}
                  {unit.recognition ? statusLabel(unit.recognition) : statusLabel(unit.state)}
                  {unit.warnings.length > 0 && <> · {unit.warnings.map(statusLabel).join(', ')}</>}
                </p>
                <p className="documents-source-text">
                  {unit.text || 'No text in this source unit.'}
                </p>
                {unit.ocr && (
                  <section className="flex flex-col gap-3" aria-label="OCR detail">
                    <h4 className="font-medium">OCR detail</h4>
                    <p className="text-sm">
                      {unit.ocr.width} × {unit.ocr.height} pixels · {unit.ocr.dpi} DPI ·{' '}
                      {unit.ocr.rotationClockwise}° rotation
                    </p>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead scope="col">Recognized word</TableHead>
                          <TableHead scope="col">Confidence</TableHead>
                          <TableHead scope="col">Box (x, y, width, height)</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {unit.ocr.words.slice(wordOffset, wordOffset + batchSize).map((word) => (
                          <TableRow
                            key={`${word.box.x}:${word.box.y}:${word.box.width}:${word.box.height}:${word.text}`}
                          >
                            <TableCell className="whitespace-normal break-all">
                              {word.text}
                            </TableCell>
                            <TableCell>{word.confidence.toFixed(1)}%</TableCell>
                            <TableCell>
                              {word.box.x}, {word.box.y}, {word.box.width}, {word.box.height}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        disabled={!wordOffset}
                        onClick={() => setWordOffset(wordOffset - batchSize)}
                      >
                        Previous words
                      </Button>
                      <Button
                        variant="outline"
                        disabled={wordOffset + batchSize >= unit.ocr.words.length}
                        onClick={() => setWordOffset(wordOffset + batchSize)}
                      >
                        Next words
                      </Button>
                    </div>
                  </section>
                )}
              </>
            )}
          </section>
        ) : (
          <p>No source units were extracted.</p>
        )}
        {layout && (
          <section className="flex min-w-0 flex-col gap-3" aria-label="Structured layout">
            <h3 className="font-medium">Structured layout · Page {layout.index}</h3>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={!structurePage}
                onClick={() => {
                  setStructurePage(structurePage - 1);
                  setStructureOffset(0);
                  setCellOffset(0);
                }}
              >
                Previous layout page
              </Button>
              <Button
                variant="outline"
                disabled={structurePage + 1 >= (artifact.structure?.pages.length ?? 0)}
                onClick={() => {
                  setStructurePage(structurePage + 1);
                  setStructureOffset(0);
                  setCellOffset(0);
                }}
              >
                Next layout page
              </Button>
            </div>
            {element && (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    variant="outline"
                    disabled={!structureOffset}
                    onClick={() => {
                      setStructureOffset(structureOffset - 1);
                      setCellOffset(0);
                    }}
                  >
                    Previous element
                  </Button>
                  <p>
                    {element.kind} · {structureOffset + 1} of {layout.elements.length}
                  </p>
                  <Button
                    variant="outline"
                    disabled={structureOffset + 1 >= layout.elements.length}
                    onClick={() => {
                      setStructureOffset(structureOffset + 1);
                      setCellOffset(0);
                    }}
                  >
                    Next element
                  </Button>
                </div>
                <p className="documents-source-text">{element.text}</p>
                {element.table && (
                  <>
                    <p>
                      {element.table.rows} rows · {element.table.columns} columns
                    </p>
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead scope="col">Position</TableHead>
                          <TableHead scope="col">Cell</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {element.table.cells
                          .slice(cellOffset, cellOffset + batchSize)
                          .map((cell) => (
                            <TableRow key={`${cell.row}:${cell.column}`}>
                              <TableCell>
                                Row {cell.row + 1} · Column {cell.column + 1}
                              </TableCell>
                              <TableCell className="whitespace-pre-wrap break-all">
                                {cell.text}
                              </TableCell>
                            </TableRow>
                          ))}
                      </TableBody>
                    </Table>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        variant="outline"
                        disabled={!cellOffset}
                        onClick={() => setCellOffset(cellOffset - batchSize)}
                      >
                        Previous layout cells
                      </Button>
                      <Button
                        variant="outline"
                        disabled={cellOffset + batchSize >= element.table.cells.length}
                        onClick={() => setCellOffset(cellOffset + batchSize)}
                      >
                        Next layout cells
                      </Button>
                    </div>
                  </>
                )}
              </>
            )}
          </section>
        )}
      </CardContent>
    </Card>
  );
}
