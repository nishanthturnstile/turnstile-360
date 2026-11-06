# Native, Office, tabular and email extraction

DMS-I14 adds private, asynchronous extraction of security-passed originals. The
[architecture](../../architecture.md#native-extraction-and-private-artifacts-i14)
owns the format matrix, process boundaries and configured limits. This stage does not
install the I16 consumer result/history/reprocessing API or I17 search.

An operator must explicitly enable the required content types and `searchable` in the
existing revision-checked admission policy. Existing policies are preserved. Query
`GET /v1/capabilities` and `GET /v1/admission-policy` before admitting a file. Capabilities
distinguish security assessment, text extraction, tabular data, structured layout and
preview; no preview, structured profile or OCR is advertised by I14.

`secure-only` explicitly omits enrichment (`processing: NOT_SCHEDULED`). For `searchable`,
upload status progresses from `WAITING_FOR_SECURITY` to `QUEUED`/`RUNNING` and the accepted
manifest's `SUCCEEDED`, `PARTIAL` or `FAILED` status. Retry wait projects as `QUEUED`.
The original becomes `AVAILABLE` after its security pass, independently of extraction.
An extraction failure does not revoke that pass or change the current binary version.
Required structural inspection discards text output and uses metadata-only Tika traversal;
an enrichment line/text-output limit cannot serve as a security-failure shortcut.
Batch processing counters follow the same independent outcomes.

## Primary paths and coverage

| Family                              | Primary path                 | Result and limits                                                                                                                                                                                                                                           |
| ----------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UTF-8 text, Markdown                | Strict decoding              | One-based lines and zero-based decoded character offsets after BOM removal; original newline lengths count toward offsets, normalized output omits line terminators. Markup remains data.                                                                   |
| UTF-8 CSV, TSV                      | Standard CSV reader          | Explicit comma/tab selected by declared content type, quoted multiline fields, one-based record/column coordinates. Formula-like strings remain data. No delimiter guessing or formula evaluation.                                                          |
| PDF                                 | PDFium in a separate process | Ordered one-based pages; native text, blank pages and incomplete/mixed/OCR-needed pages remain distinct. Any non-text object prevents a short native header from establishing full coverage. I15 supplies OCR.                                              |
| XLS, XLSX, XLSB, ODS                | Calamine                     | Sheet names, one-based rows/columns, value type and cached values. The selected binding does not expose formula expressions: `formula: null` plus `FORMULA_UNAVAILABLE` and `FORMULA_NOT_RECALCULATED` disclose this. No external workbook link is fetched. |
| DOC, DOCX, PPT, PPTX, ODT, ODP, RTF | Tika                         | Logical paragraphs and slide references when supplied by the parser. No rendered page numbers. Conservative `UNSUPPORTED_ELEMENT` warnings keep body extraction partial.                                                                                    |
| EML, MSG                            | Tika                         | Body text, selected headers and bounded attachment inventory. Assessed attachments/images omitted from text extraction appear as `attachment`/`OMITTED`; none is imported as a document.                                                                    |

Unsupported, encrypted, macro-bearing, malformed or structurally unassessable content
fails its required security assessment and remains unavailable. A family entry is not
a promise that every embedded-object variant can be assessed. Office ZIP/XML structure,
expansion and declared spreadsheet ranges are checked before native conversion. Legacy
binary formats additionally have strict process memory/time bounds. Native parser faults,
including Rust panics, are contained and returned as failed extraction.

Bounds are 50 MiB input, 25 MiB total JSON output, 32 KiB UTF-8 per source unit/cell,
100 PDF pages, 100 sheets, one million visited/declared cells, five embedded levels,
100 embedded items and 100 MiB cumulative expansion. Dense or formatted sparse ranges
that exceed the cell bound fail rather than being silently truncated. Tika uses one
384 MiB-heap JVM per ordinary task with a 120-second parser timeout; the outer supervisor
has a 240-second wall deadline and 180-second CPU limit. PDFium/Calamine/text children
have a 768 MiB address-space bound, the JVM child a 4 GiB virtual-address bound; container
memory limits remain separate. Each parser namespace has 128 MiB scratch. Ordinary
extraction concurrency is one; the two-process mandatory scanner has a separate 2 GiB
container budget for structural assessment.

## Private deployment

Build `apps/dms-processing/Dockerfile` from the repository root. The image bundles pinned
PDFium, Calamine, Pillow and the SHA-512-verified Tika 4.2.0 distribution, plus the pinned
Java runtime. Tika's fetcher/emitter plugins are not installed. Runtime downloads, OCR
recognizers and optional model routes are disabled. Retain upstream licenses/notices.

Use the existing private work overlay plus `deploy/compose.dms-assessment.yaml`. The
extractor needs its own OAuth and RabbitMQ identity, private work API access and private
S3 capability connectivity; it receives no general storage or database credentials.
The coordinator alone holds distinct original-read, artifact-write and artifact-read
pairs shown in `deploy/coordinator.env.example`. Keep protected environment files out of
source control and credentials out of command arguments.

A trusted supervisor downloads only the lease-bound original and verifies its size/hash.
The parser receives a read-only local input, approved runtime files, bounded request JSON,
no inherited environment/secrets, no network namespace connectivity and bounded scratch.
Unavailable Bubblewrap namespaces fail closed; there is no unrestricted parser fallback.
Tika is a fresh child JVM, never a public or credential-bearing parser server.

The private input/output routes require the live extractor identity and current attempt.
Output allocation reserves exact capacity under current policy before signing a short
create-only PUT for an unpredictable attempt-specific artifact key. The coordinator
streams the stored artifact to verify size and SHA-256 before accepting its bounded
manifest, then rechecks lease, source/security, run and lifecycle generations. Accepted
manifest rows are immutable. Output text stays in the artifacts bucket, never broker
messages, audit/outbox or logs. Verified output becomes charged artifact bytes; issued but
unconfirmed output remains reserved, including after cancellation. I19 owns physical
cleanup and reservation disposal. A delivered capability retains its bounded lifetime.

## Manual parser qualification

For a local parser-only check, create a protected request JSON conforming to
`ExtractionRequest` in [the private work contract](../api/dms-work.contract.json):
`schemaVersion: 1`, UUID document/version/run IDs, positive `generation` and
`lifecycleGeneration`, exact source SHA-256, approved content type and profile.
This local check does not provide security approval or mutate DMS state.

```sh
turnstile-processing extract-local \
  --source /protected/input \
  --request /protected/request.json \
  --output /protected/new-result.json
```

The output path must not exist and is created with mode 0600. Use the built image for
all installed engines; development qualification can set trusted `DMS_TIKA_HOME` and
`DMS_JAVA_HOME` directory paths. The parser still mounts only those approved runtimes
and the input, clears environment credentials and disables network access.

The focused Python suite uses actual isolated parser processes, pinned upstream Apache
fixtures and generated malformed/sparse/mixed-page cases. With the bundled runtime:
`uv run --locked pytest tests/test_extraction.py -q`. A development host without Tika/Java
reports the Office qualification cases as skipped; this is not a full runtime acceptance.
The owning PostgreSQL/HTTP/RabbitMQ/SeaweedFS suite additionally exercises the production
Celery extractor and authoritative artifact acceptance/accounting.

Explicit native security qualification against fresh official ClamAV signatures:
`uv run --locked python tests/extraction_native.py` (requires the pinned Tika/Java paths
on development hosts). It creates disposable scanner fixtures and tests all 18 I14
content types; it never uses installed service credentials or data.
