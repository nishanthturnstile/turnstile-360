# Results, reprocessing and optional structure

DMS-I16 exposes accepted version/run results independently from original availability.
The [architecture](../../architecture.md#results-reprocessing-and-optional-structure-i16)
owns persistence, authorization, resource limits and the offline structure profile.
I17 [discovery](dms-discovery.md) projects PENDING/READY/PARTIAL/NOT_INDEXED independently
from original availability and extraction coverage.

## Read exact results

Apply migrations through 0041. Add `deploy/compose.dms-results.yaml` after the existing
uploads/downloads/work overlays and populate protected `.env.dms-results` from
`deploy/dms-results.env.example` with the provisioned artifact-read credential. This API
process receives GET signing authority only, while workers retain their separate artifact
write/read credentials. Storage policy and ingress must allow the configured artifact GET
path; never provide a maintenance or write key to the public API.

Use a current consumer machine token with `dms:documents:read`:

- `GET /v1/documents/{id}/processing?versionId={versionId}&limit=20` returns run history,
  `activeRunId`, each run's completion state and its independent manifest coverage. Omit
  `versionId` for the current binary. The limit is 1–50; `nextCursor` is signed and bound
  to the installation, application, document and selected version. Every page reauthorizes.
- `GET /v1/documents/{id}/content?versionId={versionId}&runId={runId}` selects that exact
  accepted result. Omit `runId` for the active result of the selected version. A run from
  another version returns `PROCESSING_RUN_NOT_FOUND`; it never falls back to current output.
  A known pending run without an accepted artifact returns `RESULT_UNAVAILABLE`.

The manifest records schema, document/version/run IDs, source SHA-256, fixed profile,
processor/configuration/model versions, language and actual source-unit coverage/warnings.
`SUCCEEDED` work transport does not mean complete extraction: the run manifest may be
`PARTIAL` or `FAILED`. Text, cached spreadsheet values, formulas/warnings, OCR coordinates
and optional layout remain untrusted source data. Never evaluate them, use them as policy
or tool instructions, or copy them into authoritative business fields without application
validation. Native text receives no invented OCR confidence. Element IDs need not survive
another run or processor version.

A content response has `untrusted: true` and at most one `extraction-json` artifact capability.
Its `schemaVersion: 1` refers to the public OpenAPI `ExtractionArtifact` component and the
public `extractionArtifactSchema`. The artifact includes its manifest, typed source units,
metadata and optional `structure`. Verify the returned byte count/SHA-256 before consuming
it. Artifacts are at most 25 MiB; the same bound covers all issued outputs of one run,
including retained partial/failed attempts and required native/OCR stages.

Issuance rechecks live READ rights, application status, logical lifecycle, the selected
available version and its passed source/security evidence, and holds the original fence
through signing/audit commit. Shared READ permits results; add-version rights alone do
not. Revocation, deletion and security invalidation stop new issuance immediately. After
logical restoration, history can expose a retained accepted run only when the exact
version is freshly available with the same source hash; an old lifecycle generation never
automatically becomes active. Existing signed GETs may remain usable until their bounded
120-second expiry. Do not log, persist in an idempotency receipt or publish their URLs.
Control responses are private/no-store; artifact access is read-only.

An independent stdlib example saves responses exclusively with mode 0600 and withholds
capabilities/content from stdout. Obtain a protected machine token file using the existing
[backend example](../../examples/dms/backend.py), then:

```sh
python examples/dms/results.py history --token-file /protected/dms-token.json \
  --output /protected/new-history.json < /protected/result-selection.json
python examples/dms/results.py content --token-file /protected/dms-token.json \
  --output /protected/new-content.json < /protected/result-selection.json
```

The bounded selection JSON contains `resource`, `documentId` and optionally `versionId`;
`runId` is optional for content. No secret belongs in argv or browser configuration.

## Request a replacement

`POST /v1/documents/{id}/versions/{versionId}/reprocess` accepts exactly
`{"profile":"searchable"}` or `{"profile":"structured"}` with `Idempotency-Key`.
It requires the owning application and both document read/write scopes. A shared READ,
EDIT_METADATA or ADD_VERSION grant never grants reprocessing. An active original/security
pass, current installed/enabled format/profile policy, file limit, fresh measured capacity,
physical storage budgets, scratch and tenant/application queued-work limits are required.
Only one pending run per version/upload is admitted; further new requests receive
`PROCESSING_IN_PROGRESS`. `secure-only` omits enrichment and is not a reprocessing profile.
Requests cannot select a model, language, executable, remote service or arbitrary config.

An accepted request returns `202`, the stable `operationId`/run identity, a processing
`Location`, `Retry-After: 2` and the 24-hour replay deadline. Repeating the same key/profile
returns `200` and the same run with current state; another profile conflicts. Replay does
not create another job, reservation, audit request, binary version or revision. Current
access and lifecycle/security still apply. Disabling a profile prevents new requests; a
valid receipt still returns its already-admitted run without creating more work.

A run grants its own bounded work window even after the original upload expires; it does
not change lifecycle recovery state or revoke a current contributor's upload-session access.
Pending or failed replacement leaves the previous active accepted result intact. Only
an accepted successful/partial final required stage of the latest eligible run in the
current lifecycle can atomically become active. Run provenance and accepted objects remain
immutable. Late/duplicate attempts, older generations and superseded runs cannot overwrite
that selection. A failed OCR/structure stage cannot promote an earlier native stage as a
successful replacement. Original availability and binary history remain independent.
Existing historical artifacts stay charged; disposal follows the private [recovery-aware policy](dms-recovery.md).

The private `dms:manage-operator` command also accepts `document-reprocess` with exact
`documentId`, `versionId`, `profile` and `idempotencyKey` plus fresh verified authority
credentials through protected JSON stdin. It requires the current explicit DMS operator
grant and private operator DB role; an authority administrator/session alone is insufficient.
The same database admission function, quotas, idempotency and attributed transactional audit
apply. There is no HTTP operator endpoint or operator artifact-signing command.

The independent example's `reprocess` action accepts those version/profile/key fields
without operator credentials, using only the owning application's protected machine token.

## Install the optional offline structure profile

The default processing target excludes Docling, PyTorch and model data. Build its separate
opt-in target at the repository root:

```sh
docker build --target structured -f apps/dms-processing/Dockerfile \
  -t thaarei-dms-processing-structured:local .
```

Apply `deploy/compose.dms-structure.yaml` after the private work/assessment overlays. It
uses a separate heavy image tag, sets `DMS_STRUCTURE_ENABLED=true` on API/coordinator/heavy
and allocates 4 GiB container memory, one CPU and a private writable tmpfs to heavy work.
Do not enable the API/operator flag without the qualified heavy image. Scanner and
ordinary extractor identities/images/resources remain separate. With the overlay absent,
structured support is absent from capabilities/effective policy and requests reject
explicitly. Merely installing the optional dependency does not enable the profile.

Explicitly allow `structured` and desired PDF/JPEG/PNG/TIFF/BMP/static WebP types in the
revision-checked operator admission policy. Structured is never automatic on `searchable`.
Office/email/tabular inputs do not support the structured profile; there is no silent
substitution. Newly uploaded structured originals still require the independent structural
inspection and fresh ClamAV security approval before any heavy result processing.

The fixed `docling-layout-v1` configuration pins Docling 2.146.0, CPU-only torch 2.15.0 and
torchvision 0.29.2 in `uv.lock`, Heron layout commit
`8f39ad3c0b4c58e9c2d2c84a38465abf757272d8` and TableFormer fast commit
`fc0f2d45e2218ea24bce5045f58a389aed16dc23`. `structure-models.json` versions every approved
file SHA-256; the private/shared contract pins that manifest's canonical hash. Build-time
prefetch verifies files and includes model cards/licenses. Runtime verifies the manifest,
model hashes, Docling version and existing Tesseract/English/orientation identities before
inference. Weights use safetensors. Remote services, external plugins, extra model
features, automatic language selection and runtime downloads are disabled. HF offline
settings and the no-network namespace are independent controls. See Docling's
[offline options](https://docling-project.github.io/docling/usage/advanced_options/).

Nested OCR provenance identifies the shared English engine/data configuration;
`docling-layout-v1` identifies the complete structured pipeline and its OCR region/orientation
handling. `languages: ["en"]` identifies configured recognition, not detected source language.
Structured results do not claim the searchable OCR profile's word/orientation score thresholds.

One isolated process handles one source PDF page or normalized image/TIFF frame. PDFium
never processes several pages concurrently; native/PyTorch/BLAS threads are bounded to one.
Docling uses the selected pinned English Tesseract CLI for necessary OCR, with no alternate
OCR cascade. Layout/table output is approximate, not a promise of exact tables or business
fields. Each page has at most 120 seconds, the document loop at most 480 seconds including
inspection, and the namespace deadline at most 510 seconds. Lease remaining time reduces
the budget and reserves 120 seconds for output/acceptance. The structure parser has 8 GiB
virtual-address space, 128 MiB scratch, a 100 MiB intermediate-file ceiling and the existing input/page/pixel/output limits.
Failed/skipped pages retain usable native text and explicit source-unit warnings. No
successfully structured page means failure and cannot replace an active result.

Layout coordinates use `top-left-normalized-page`: boxes are fractions of that Docling
page frame, from 0 to 1. Page indices refer to original PDF pages/TIFF frame order. Native
PDF rotation and image EXIF orientation precede page analysis. Raster dimensions/DPI and
word confidence in the searchable OCR contract are separate; normalized layout boxes do
not claim original PDF point coordinates. Table cells expose row/column offsets/spans,
text and header flags, with boxes when supplied; missing boxes remain null. Reading order,
clipped predictions, OCR and table recognition remain approximate and carry warnings.

For development parser qualification only, install `uv sync --locked --extra structured`
and build-time-prefetch the approved files with `scripts/prefetch_structure.py --output`
to a protected directory, then set trusted `DMS_STRUCTURE_HOME`, `DMS_OCR_HOME` and
`DMS_STRUCTURE_ENABLED=true`. A local request must contain profile `structured` and stage
`structure`. Use the existing `extract-local` command; it grants no security/publication
or DMS authority. Qualify actual PDF/image tables with `tests/test_structure.py` and use
the production image for the complete installed/offline runtime.

The committed [packaged qualification record](../qualification/dms-i16-structure.json)
records the exact image, enforced runtime bounds and actual PNG/PDF table and mixed-page
outcomes. It covers the owned fixtures, not arbitrary-document accuracy or throughput.
