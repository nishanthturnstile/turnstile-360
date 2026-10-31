# Headless Document Management Platform

## Product and Architecture Blueprint v1.4

**Updated:** 2026-10-31  
**Status:** Accepted architecture baseline. The owner selected SeaweedFS and accepted Better Auth, Python/Celery/RabbitMQ, expanded document processing, and the no-mandatory-paid-license policy.  
**Scope of this update:** Workspace decisions updated to NestJS/Fastify, Biome, Dokploy, and a separate Turnstile Vite/React frontend and backend. Application projects, development standards, and build/test pipelines are configured; product functionality and production validation remain pending.  
**Product:** A headless, reusable, self-hostable Document Management System (DMS) API.  
**Company:** Thaarei.  
**Demand target:** Up to 200,000 documents per month; capacity depends on the declared file/page mix, OCR share, arrival bursts, and processing window.

## 0. Decision status and how to use this document

This document is the accepted architecture baseline for direct implementation. The existing filename is retained to preserve links; the heading and revision history identify the document revision. The [sequenced functionality and requirements](headless_dms_functionality_requirements_v1.md) define what to build and its dependency order; this blueprint defines the selected architecture and technical rules.

- **Selected:** The v1 boundaries, architecture, technology defaults, access model, transfer strategy, and lifecycle rules below.
- **Configured defaults:** Initial limits and operational targets are explicit starting policies, not measured capacities or service guarantees.
- **Direct implementation:** Build the actual selected solution in the functionality dependency order. Pin dependencies and implement the documented requirements in the real product.
- **Normal product quality:** Functional tests, security checks, regression coverage, performance checks, and recovery testing belong to implementation and maintenance of the actual solution; they are not a separate architecture-selection stage.
- **Environment inputs:** Actual demand, deployment configuration, and business/compliance constraints are listed in section 19. Use the selected scope and configured defaults to proceed; these inputs do not establish a preliminary investigation requirement.
- **Change control:** Record the reason when changing a selected default. Material product, security, cost, or compatibility changes remain explicit decisions; routine implementation choices do not require another review cycle.

No claim of production readiness, unlimited scale, perfect extraction, or compliance follows from this specification.

## 1. Product promise and ownership

Provide stable APIs that independent applications can use to upload, version, organize, retrieve, process, and find documents. Consumer applications keep their own interfaces and business workflows. Normal file transfers go directly between clients and object storage.

The DMS owns document identity, immutable binary versions, bounded metadata/tags, application grants, transfer authorization, security/publication state, processing artifacts, search, audit, quotas, soft deletion, and controlled disposal.

Consumer applications own business records, their screens, and end-user business authorization. The deployment's shared authentication module supplies user login and machine identities. In v1 consumers call the DMS control API from trusted backends using machine access tokens. A browser can transfer bytes using a narrowly scoped capability obtained through that backend; it does not receive the application's service credentials.

A business reference is a pointer, not proof of access. Linking an invoice, employee, or case does not grant rights to its document or cause the DMS to fetch the referenced system.

The initial product targets trusted registered application backends receiving potentially hostile files. Independent repositories and frameworks are supported without code changes to the DMS.

## 2. Frozen v1 scope

### Included in the first release

| Area | v1 behavior |
|---|---|
| Integration | REST/JSON, generated OpenAPI, application access tokens, browser and backend examples |
| Identity/onboarding | Shared Better Auth authority, administrator-managed machine clients, and one-time Thaarei enrollment |
| Registry | Stable document IDs; title, filename, tags, bounded JSON metadata, external references |
| Transfer | Direct single-PUT uploads with sessions; multi-file batches with independent per-file admission, transfer, and outcomes |
| Versions | Immutable bytes, revision history, automatic publication after the security gate, restore as a new revision |
| Access | Tenant isolation, application ownership, explicit same-tenant application grants |
| Security | Byte/type validation, complete configured scan coverage, quarantine, immutable publication |
| Processing | Native/Office text, spreadsheet data, CPU OCR, and an optional configured structured-extraction profile; provenance and explicit partial results |
| Formats | PDF; approved common images; UTF-8 text/CSV/TSV; Word/PowerPoint/OpenDocument/RTF; Excel/OpenDocument spreadsheets; EML/MSG, as specified in section 9 |
| Languages | English OCR; additional languages are a future scope extension with language-specific quality requirements |
| Search | Authorized current-version metadata/text search using PostgreSQL |
| Async contract | Poll upload, version, and processing status; internal durable events |
| Lifecycle | Soft delete, restore window, reference-aware garbage collection, audit |
| Operations | Quotas, admission control, bounded workers, reconciliation, failure recovery, backups, self-hosted installation, and distribution/license records |

PDF support includes native, scanned, and mixed-page documents within configured limits. Format support distinguishes storage, security assessment, text extraction, structured extraction, and preview generation; detection alone does not establish any of these capabilities. Section 9 is the supported-format matrix. Password-protected/encrypted, malformed, or unassessable files and nested content are rejected or remain inconclusive and unpublished. A scan pass is a policy result, not a guarantee that a file is harmless.

The product does not promise universal extraction from every industrial file. An additional proprietary format may be enabled for storage-only use only when its security policy and bounded assessment can be fulfilled. Unsupported or unassessable content does not become published merely because extraction is disabled. Editing Office content in place, executing macros, recalculating spreadsheets, and proprietary CAD/PLC interpretation are outside v1; replacing a document means uploading a new immutable version.

Metadata is a size-limited JSON object with scalar values and bounded scalar arrays. There is no tenant-defined schema engine, arbitrary query language, or automatic indexing of every metadata key in v1. Promote frequently queried fields to explicit supported filters.

### Deferred until a consumer demonstrates the need

- Multipart/resumable uploads and larger file limits; v1 returns a clear size-limit error rather than exposing unimplemented multipart endpoints.
- Archive unpacking/import, HTML/SVG rendering, proprietary industrial-format interpretation, and other formats outside section 9's approved matrix.
- Searchable PDF derivatives, previews, thumbnails, and structural extraction beyond the configured Docling profile.
- Folders with inherited permissions, DMS end-user/group ACLs, arbitrary multi-issuer federation, and user token exchange/delegation.
- Signed webhooks, public event feeds, packaged SDKs, bulk import/export, and advanced multilingual relevance.
- Legal holds, immutable/WORM retention, governed disposal, electronic signatures, and business approval workflows.
- Semantic search, embeddings, document Q&A, classification, and generative field extraction.
- DMS management UI, microservice decomposition, a general workflow engine, mandatory Kubernetes, and active-active regions. Consumer login/recovery screens and supported operator tooling remain required.

A regulated launch requiring deferred governance features changes the release scope before customer data is accepted. Soft-delete grace periods are operational recovery policies, not legal retention.

## 3. Selected architecture and technology

Use a modular monolith for the TypeScript control plane and shared authentication module, with independently deployed Python/Celery scanning and extraction workers. PostgreSQL owns authoritative domain state. RabbitMQ transports Celery tasks; SeaweedFS stores bytes. Keep the client application, DMS modules, Python processing code, and generated contracts in one monorepo with explicit package boundaries. Repository membership never supplies runtime trust or shared credentials.

| Layer | Selected default | Boundary / reason |
|---|---|---|
| Control API | TypeScript + NestJS, Fastify adapter | Explicit modules and dependency injection; no parser CPU work in request handlers |
| Validation/contracts | Zod with generated JSON Schema and OpenAPI 3.1 | One payload definition; validate exported schemas in Python |
| Database | PostgreSQL | Domain transactions, job state, outbox, audit, and initial search |
| Queries/migrations | Drizzle ORM + reviewed SQL migrations | Explicit constraints and query plans; no schema synchronization in production |
| Object storage | SeaweedFS OSS, S3 endpoint | Owner-selected self-hosted default; small installation and distributed deployment path |
| Object client | AWS SDK for JavaScript S3 client; bounded Python streaming transfers using job-issued capabilities | Explicit SeaweedFS endpoint/signing; workers need no general storage credentials |
| Work transport/execution | RabbitMQ OSS + Celery, JSON serialization and prefork processes | Framework-managed execution/routing/retries; no custom AMQP consumer loop |
| Domain coordination | PostgreSQL-backed coordinator in the control-plane codebase | Authoritative stage eligibility, result acceptance, outbox, reconciliation, indexing, and maintenance |
| Task publishing | Small Python publisher from the processing image, using Celery's producer API | Claims outbox deliveries through the private API; no hand-built Celery protocol in TypeScript |
| Malware scanner | ClamAV daemon + managed signature updates | Separate security gate with explicit scan-coverage checks |
| PDF processing | pypdfium2/PDFium | Native text and bounded page rendering in separate processes |
| OCR | Tesseract CLI; Pillow for bounded image decoding | CPU-capable, local execution; no model service required |
| Office/email text | Apache Tika, isolated forked parser runtime | Bounded text/metadata extraction; no Office installation or converter required |
| Spreadsheet data | python-calamine/Calamine; Python standard CSV parser for CSV/TSV | Sheet/cell-oriented data; no formula execution or duplicate full-document parsing |
| Structured extraction | Docling as an optional enabled profile with pinned, approved models | Layout/table artifacts only when requested and configured |
| Identity | Better Auth + OAuth Provider + JWT/JWKS plugins, PostgreSQL/Drizzle | Shared user login and machine tokens; configured external OAuth/OIDC issuer may replace the default authority |
| Authorization | Local application ownership/grants and tenant isolation | No separate policy service |
| Search | PostgreSQL FTS + GIN; pg_trgm for title/name | Avoid another durable search system |
| Packaging | Linux Docker Compose managed by Dokploy | Dokploy/Traefik supplies ingress and TLS; run one ingress stack |
| Telemetry | Structured logs, health endpoints, metrics, OpenTelemetry instrumentation | Operator-selected monitoring backend; no bundled Grafana requirement |

SeaweedFS is the v1 storage backend. The DMS uses the S3 operations defined in section 6; implementing or certifying alternative storage backends is outside v1. Use `weed mini` for the small self-hosted profile, with component separation available for an expanded deployment. [SeaweedFS small deployment](https://github.com/seaweedfs/seaweedfs/wiki/Quick-Start-with-weed-mini)

Keep RabbitMQ for durable task transport; do not choose a broker because of a storage vendor's notification protocol. Storage events are optional hints, so v1 does not depend on native SeaweedFS-to-broker integration.

Tika and Calamine are selected for the included Office/spreadsheet scope. Install Docling and its approved models only when the structured profile is enabled. Do not add Dramatiq alongside Celery, a Redis/Valkey result store, LibreOffice, OCRmyPDF/Ghostscript, PyMuPDF/MuPDF, OpenSearch, NATS, or Temporal to the selected default. Those additions are not required for the agreed functionality.

Use the NestJS Fastify adapter and compatible Fastify plugins, with exact package/container versions pinned in the implementation. Maintain the lockfile and bill of materials as part of ordinary dependency management. [NestJS adapters](https://docs.nestjs.com/techniques/performance)

The monorepo uses pnpm/Turborepo, Biome, and uv. Turnstile 360 is the consumer product: its Vite/React frontend and separate NestJS/Fastify backend live beside the reusable DMS and Python processing project. Turnstile business functionality and data migration are specified separately. See the [workspace implementation plan](workspace_implementation_plan.md) and [standards](standards/workspace.md). Workspace setup precedes capability implementation without adding an architecture-selection stage.

## 4. Module and contract boundaries

The control plane has bounded modules for identity/access, documents/versions, uploads/storage, processing coordination, search, and lifecycle/audit. Modules share database transactions where needed and do not communicate through HTTP inside the monolith.

Run API and coordinator processes from the same TypeScript application image. The coordinator persists eligible stages/jobs/outbox records and owns domain reconciliation, indexing, and maintenance. A Python publisher claims due dispatch records through the private API, publishes through Celery, and records confirmed delivery. Celery owns ordinary transient execution retries; the coordinator does not run a competing retry timer for the same attempt. Multiple instances use database locking/leases; there is no assumed singleton in memory.

Celery tasks use a private authenticated job API to claim valid attempts, obtain narrow transfer capabilities, and submit outcomes. Publisher and worker identities have distinct permissions. They receive no general database credentials and cannot implement publication rules. Public routes never expose internal job/dispatch endpoints. Celery's result backend is disabled; client-visible state and accepted artifacts remain in PostgreSQL/SeaweedFS. A broker acknowledgement or Celery task state is not a DMS publication decision.

Host one Better Auth authority in a separate platform-auth module of the TypeScript API. Use a dedicated PostgreSQL `auth` schema, database role, signing-key storage, and reviewed migrations. Use the supported Better Auth Fastify integration on auth routes, preserving request/response and cookie semantics; keep session guards scoped to those routes rather than replacing DMS bearer-token guards. A community NestJS wrapper is not required. The DMS domain module validates access tokens through its configured issuer/JWKS contract; it does not query user/session tables or accept browser cookies as machine authority. Consumer applications own login/recovery screens and business-session enforcement. Preserve this boundary when deploying the same modules separately later.

```mermaid
flowchart LR
  User[User] -->|Login/session| Client[Client application/backend]
  Client -->|Login or token request| Auth[Shared Better Auth authority]
  Client -->|Scoped machine access token| DMS[DMS control API]
  Auth -.->|Issuer and signing keys| DMS
  DMS -->|Domain state, jobs, outbox| PG[(PostgreSQL)]
  Publisher[Python Celery publisher] -->|Private dispatch API| DMS
  Publisher -->|Confirmed task delivery| MQ[RabbitMQ]
  MQ --> Worker[Celery workers]
  Worker -->|Private job API| DMS
  Client -->|Signed file transfer| Storage[(SeaweedFS)]
  Worker -->|Narrow transfer capability| Storage
```

Author request, response, job, and event payload schemas once. Export JSON Schema and OpenAPI from the shared contract package. Zod transformations/refinements that cannot be represented faithfully in the exported schema are excluded from shared payload definitions; semantic domain checks remain explicit application logic. CI validates the same payload fixtures in TypeScript and Python. [Zod schema export](https://zod.dev/json-schema)

Job orchestration is deterministic code over a fixed stage registry. Tenant/application profiles select allowed stages and bounded settings; clients cannot submit executable code, arbitrary processors, storage destinations, or workflow graphs.

## 5. Tenancy, identity, and authorization

### Deployment and principals

- The default self-hosted deployment serves one tenant with multiple applications. The schema and query boundaries remain tenant-aware from the start.
- The code and data model enforce tenant isolation from the start. Shared multi-tenant hosting is outside the initial single-tenant deployment profile and is an operational expansion, not a preliminary implementation stage.
- A registered application belongs to one tenant. A service operating for multiple tenants has separate registrations/credentials for each tenant in v1.
- Validate the token signature, allowed issuer/algorithm, audience, expiry, and configured client-identity claim. Map the verified issuer/client identity to an active registration; never authorize from caller-supplied tenant/application IDs.
- Better Auth is the selected shared authority for this product deployment. Use its OAuth Provider plugin for client credentials and resource-bound access tokens, with JWT/JWKS signing; disable the standalone session-JWT issuance endpoint for this authority. Administrators provision confidential DMS machine clients limited to the client-credentials grant and their machine-scope ceilings. User-login OAuth clients are separate and are not mapped as DMS machine registrations. Disable open signup and unauthenticated dynamic client registration.
- The authority issues and rotates client credentials. Local DMS registration supplies activation, immediate disablement, tenant/application mapping, and allowed-scope ceilings. Give each application and internal worker role a separate client; multi-tenant consumers use separate registrations. A DMS resource server needs verification keys, not an issuer-wide signing secret.
- User login uses secure, HttpOnly session cookies through the application backend; separately deployed OAuth login clients use authorization code with PKCE. Enforce trusted origins, CSRF protection, expiry, login/recovery rate limits, operator-controlled account recovery, and session revocation. Client secrets never enter browser code. Persist signing keys and coordinate rotation across API instances; do not depend on process-local sessions or rate-limit counters in a replicated deployment.
- A client backend checks its user's business permissions, then uses a cached short-lived client-credentials access token for the DMS audience. This token represents the application, not delegated end-user rights. Direct end-user tokens, arbitrary multi-issuer federation, and user token exchange are outside the v1 DMS contract. Reported end-user identifiers are bounded audit context asserted by the application, not authorization input.
- An operator may configure a supported external OAuth/OIDC issuer, including an existing Keycloak installation, instead of running the embedded authority. Use one selected authority per deployment by default; do not deploy both systems merely because they share a repository. Keycloak is Apache 2.0, so replacement is an application/operations choice rather than a mandatory-license saving.

[Better Auth OAuth Provider](https://better-auth.com/docs/plugins/oauth-provider), [Drizzle/auth schema integration](https://better-auth.com/docs/adapters/drizzle), [Keycloak administration](https://www.keycloak.org/docs/latest/server_admin/index.html)

### Thaarei enrollment and activation

An operator bootstraps the tenant/admin and provisions each intended OAuth client. A client is not granted DMS access merely because the authority issues it a token. Initial consumer activation additionally requires a high-entropy, single-use **Thaarei enrollment key** issued through supported operator tooling; there is no universal vendor secret shipped in the frontend or images.

Bind the key record to the deployment, tenant, expected issuer/client identity, expiry, and one permitted activation. Store only its digest and nonsecret audit/receipt metadata. `POST /v1/application-enrollments` requires a valid DMS-audience machine token plus `X-Thaarei-Enrollment-Key`. This is the explicit pre-registration exception: token verification and key binding apply before an active application exists; normal DMS operations still require active registration.

Consume the key, activate the one bound registration, and record audit plus a nonsecret idempotency receipt in one transaction. An authenticated identical retry returns the same registration outcome; a different client/request, expired unused key, or already-used key without the matching receipt cannot create another registration. Explicitly revoked keys fail even when a receipt exists, and a receipt never re-enables a suspended application. Default unused-key lifetime is 24 hours; a matching receipt remains available for the disclosed idempotency window. Never log the key or token.

Routine API calls require only the access token and current DMS policy; the enrollment key is not an extra header on every request. Credential rotation preserves the application registration and document ownership. Internal service identities are provisioned through private operator tooling with separate scopes. Enrollment controls initial registration; it is not a tamper-proof commercial-license mechanism against an administrator controlling the self-hosted deployment.

### Ownership and sharing

A document has one owning application. Same-tenant applications receive no access by default. The owner or tenant administrator may explicitly grant `READ`, `EDIT_METADATA`, or `ADD_VERSION` to another registered application. `READ` includes authorized original/history retrieval, extraction, and search; a reference alone provides none of these rights.

Only the owner or tenant administrator may change grants, delete/restore the logical document, or request reprocessing. API scopes are an additional ceiling, not a replacement for resource authorization. Cross-tenant grants and ownership transfer are unavailable in v1.

References are namespaced by tenant, creating application, source system, entity type, and entity ID. An application may link only within its registered source namespace and must already have access to the document. Linking or unlinking does not change ownership or grants. Applications remain responsible for business-record permissions and record existence.

Every public read and mutation checks current tenant/application/resource policy, including version history, artifacts, audit, polling, and search. Revocation stops new capabilities immediately; issued signed URLs may remain usable until expiry. Audit authorization issuance separately from actual retrieval.

Use composite tenant-aware foreign keys and uniqueness constraints. Enable PostgreSQL tenant row-level security with transaction-local tenant context and a runtime role that cannot bypass it; do not reuse an owner/superuser migration role for requests. Reset context with transaction boundaries under connection pooling. A separate narrowly privileged coordinator/maintenance role handles global job discovery and outbox scheduling and is unavailable to public request code. RLS supplements application grant checks. [PostgreSQL RLS](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)

## 6. SeaweedFS storage and upload protocol

### Required adapter contract

The SeaweedFS integration must provide SigV4 presigned PUT/GET, signed-header enforcement, exact upload-length enforcement, atomic create-only PUT, HEAD, source-conditional copy to a new key, read-after-write visibility, private bucket policies, CORS, range GET, and exact-key deletion. Implement these behaviors in the actual storage integration and cover them with its normal integration tests. Record SDK versions, endpoint style, and proxy configuration.

Use separate private staging, originals, and artifacts buckets. Upload signing credentials can only PUT into staging; they cannot read, list, copy from, or delete originals/artifacts, change ACLs, or configure buckets. Download signing credentials are read-only. The trusted snapshot coordinator can read staging and create original candidates. Parser identities cannot replace/delete originals. Maintenance deletion uses a separate identity.

Require signed `If-None-Match: *` on staging PUTs to prevent replacement and signed exact content length matching the session reservation. Browser transfers use the automatically supplied `Content-Length` for a known-size file rather than attempting to set a forbidden header in JavaScript. The actual browser, Node, and Python integrations must honor the same contract. Unbounded or overwriteable uploads are not an acceptable fallback. [SeaweedFS conditionals](https://github.com/seaweedfs/seaweedfs/wiki/S3-Conditional-Operations)

Configure authentication before exposing SeaweedFS: `weed mini` otherwise permits unauthenticated access when credentials are absent. Keep filer, volume, master, administrative, and non-S3 interfaces private. Disable or block automatic archive extraction and vendor-specific write extensions on the transfer ingress; test unsigned header/query injection. Do not expose a path that bypasses S3 authorization. [SeaweedFS authentication defaults](https://github.com/seaweedfs/seaweedfs/wiki/Quick-Start-with-weed-mini), [SeaweedFS S3 API](https://github.com/seaweedfs/seaweedfs/wiki/Amazon-S3-API)

### Upload and immutable publication

1. The consumer backend calls `POST /v1/uploads` with metadata, declared size/type, optional SHA-256, processing profile, and an idempotency key.
2. In a transaction, validate policy, reserve staging/candidate capacity, create the logical document if new, allocate a candidate revision and upload session, and persist a unique staging key. A logical document without a current version is not downloadable or searchable.
3. Return a short-lived signed single-PUT capability bound to that key, exact length, permitted content type, and create-only condition. The client uploads directly to SeaweedFS.
4. `POST /v1/uploads/{id}/complete` records completion intent and returns `202`. The reconciler independently discovers existing objects for persisted active sessions, so a missed callback cannot strand a valid upload.
5. HEAD verifies session/key identity and actual size. The coordinator creates a private, server-owned original candidate from the create-only source using a source ETag precondition and a new unpredictable destination key. Persist the chosen candidate with compare-and-swap. A retry never overwrites a candidate; abandoned copies are collected later.
6. Scan that candidate, not a mutable staging key. Stream its bytes to compute authoritative SHA-256, compare any declared hash, detect actual media type, and assess configured scan coverage. After the malware scan, use the sandbox for bounded format-specific checks: PDF/image page and dimension bounds, Office package/embedded-content rules, spreadsheet limits, and email nesting/attachment policy. Encryption, identified macros, unsupported embedded content, or incomplete required checks cannot receive a final pass. An S3 ETag is an object concurrency token, not an assumed cryptographic checksum.
7. On a security pass, a PostgreSQL transaction marks the version available, updates the current pointer only under section 8's ordering rule, increments the document revision, creates initial jobs, and records audit/outbox intent.
8. Publication changes database eligibility; it does not copy or rewrite the scanned bytes again. Download signing checks eligibility before issuing a URL to the same protected candidate object.
9. Schedule optional enrichment independently. Failures do not make the already-passed original unavailable. Retain actual size/hash/security evidence and clean staging only after all issued upload capabilities have expired plus the cleanup margin.

Object versioning is optional storage protection, not the v1 publication mechanism or a backup substitute. If enabled, persist and use exact storage version IDs. There is no cross-tenant content deduplication in v1.

### Multi-file batches

A batch groups independent files; it is not an archive, one combined document, or multipart transfer. `POST /v1/upload-batches` records a bounded manifest of immutable client item IDs, intended operations, and file descriptors. Manifest creation alone creates no document, reserves no physical bytes, and grants no upload authority. The normal session-creation API accepts `batchId`/`itemId` and admits each file independently when capacity is available. Each item binds to at most one upload/candidate operation; idempotent retries cannot create another document for that item.

Keep each file's upload/security/availability/processing outcome and retry guidance. Batch status exposes separate per-stage counts and a paginated item list, not an assertion that every file succeeded. A failure or admission delay in one item must not roll back successful files. Cancellation prevents new item sessions and cancels eligible pending sessions under the normal cancellation race rules; already-published documents remain intact. Closing/expiring a batch prevents new sessions and settles remaining unstarted items. Batch ownership is the creating tenant/application; grouping never changes document permissions. New-version items require the versioning capability and current access checks.

## 7. Independent state machines and security coverage

| Concern | States / transition rules |
|---|---|
| Upload | `INITIATED -> OBJECT_VERIFIED -> SNAPSHOTTED -> COMPLETED`; terminal `EXPIRED`, `CANCELLED`, or `FAILED` |
| Security | `PENDING -> SCANNING -> PASSED`, `REJECTED`, or `INCONCLUSIVE`; a controlled retry may reassess an inconclusive candidate |
| Version availability | `CANDIDATE -> AVAILABLE` only after `PASSED`; rejected candidates never become available |
| Document lifecycle | `ACTIVE -> SOFT_DELETED -> PURGING -> PURGED`; restore is allowed only from `SOFT_DELETED` before its deadline |
| Processing run | `QUEUED -> RUNNING -> SUCCEEDED`, `PARTIAL`, `FAILED`, `UNSUPPORTED`, `SKIPPED`, or `CANCELLED` |
| Search generation | `PENDING -> BUILDING -> READY` or `FAILED`; failed replacement leaves the prior active generation intact |

A current version is a pointer to one available version, not another overloaded ready state. Upload `COMPLETED` means its version passed the security gate, even if a later revision is already current. Track the processing and indexing state separately. Terminal rejected/inconclusive uploads carry an explicit failure reason rather than appearing indefinitely pending.

A scan passes only when the file and assessed nested content satisfy configured type/size/coverage policies and the scanner reports no detection without a limit, timeout, truncation, encryption, or execution error. Record scanner engine/signature versions and time, assessed bytes, limits, and outcome. Keep `REJECTED` distinct from `INCONCLUSIVE`; neither allows publication.

Configure and test ClamAV's exceeded-limit and encryption alerts rather than accepting a nominal clean return for skipped content. Apply external deadlines in addition to scanner limits. Expose signature-age metrics and stop new publication when signatures exceed the configured freshness policy. Do not disable defensive limits to accommodate an unbounded upload. [ClamAV scanning configuration](https://raw.githubusercontent.com/Cisco-Talos/clamav/main/etc/clamd.conf.sample)

An assessment remains valid for existing available bytes until explicit reassessment/revocation or policy invalidation. The signature-freshness gate applies to new publications and historical restores; it does not automatically expire every existing document whenever signatures are updated. V1 has no periodic reassessment service or implicit assessment-age expiry. Record an explicit invalidation when a policy change requires reassessment.

Deleting, cancelling, or superseding work increments a persisted lifecycle/work generation. Every result must match the job's current attempt/lease token, version, and applicable lifecycle generation. Expired attempts cannot commit artifacts, publication, counters, or index updates. Duplicate submissions of an already-accepted result return its recorded outcome without repeating effects.

## 8. Versioning, deletion, and retrieval rules

Allocate monotonically increasing revision numbers transactionally per document; gaps from failed candidates are allowed. Keep the last available current version while a candidate is uploaded/scanned. Binary bytes and assigned revision identity never change after creation; mutable availability, processing, and security evidence are separate records/state.

Auto-publication rule: an available candidate advances `currentVersionId` only when its revision number exceeds the current version's. If v3 passes before v2, v2 may become available in history but cannot replace v3. Enforce the comparison and pointer update in the same locked/conditional database transaction.

Restoring historical bytes creates a new highest-numbered candidate revision referencing the protected object. It goes through a current-policy security assessment before becoming available; reusing historical bytes does not imply historical signatures remain sufficient. The existing current version stays available during this assessment. Reference-aware collection protects shared historical objects.

Metadata and grant changes require the expected document revision/ETag. Downloads require current authorization, an active document, and an available version with a current security pass. Default to the current version; historical retrieval is explicit. The original filename is sanitized presentation metadata, never an object key.

Soft deletion immediately hides the document from normal listing/search/retrieval, stops new signed URLs, cancels pending work, and increments its lifecycle generation. Search still checks live lifecycle/grants even while asynchronous deindexing runs. Existing signed URLs are bounded by their expiry; immediate revocation of delivered bytes is not a v1 promise.

Restore checks the deadline, object existence/integrity, and current policy, then advances the lifecycle generation. Needed work is rescheduled under that new generation; old jobs cannot resume themselves. A restored document with an invalidated security assessment remains unavailable until reassessed. There is no restore after `PURGING` begins.

If security status later changes to rejected/inconclusive, stop new reads and hide its derived content immediately. Invalidate affected runs and apply the new assessment to every version sharing those bytes. V1 does not automatically select an older revision as a replacement current version; an authorized restore creates a new revision.

## 9. Processing, provenance, and AI readiness

### Default processing profiles

- `secure-only`: Type/policy/integrity checks and malware scan; no extraction.
- `searchable` (default for extraction-supported types): The same security gate followed by format-routed text/data extraction, selective OCR, and indexing.
- `structured` (opt-in, when installed and enabled): The same security gate followed by configured Docling layout/table extraction for PDF/images, with text and structured artifacts. Reject an unsupported profile/format combination explicitly; do not silently substitute another profile.

Profiles, format policies, and processor configurations are versioned and operator-controlled. The selected engines are PDFium, Tesseract/Pillow, Tika, and Calamine, with Docling only for the enabled structured profile. Route one primary extraction path per file/run, with only the required OCR fallback; do not run every engine on every document. Tika OCR is disabled. The structured profile reuses the selected Tesseract OCR path where needed rather than installing another automatic OCR cascade.

### Supported-format and capability matrix

All listed families require a security pass before storage becomes ordinarily retrievable. Storage acceptance, security assessment, and extraction outcomes remain separate. Previews and searchable-PDF generation are deferred for every row.

| File family / initial allowlist | Text/searchable path | Data/structure behavior |
|---|---|---|
| PDF: native, scanned, mixed | PDFium native text and bounded rendering; selective Tesseract OCR | Page/region provenance; optional configured Docling layout/tables |
| JPEG, PNG, TIFF, BMP, static WebP | Bounded Pillow decoding/orientation and Tesseract | TIFF pages retain order; optional configured Docling image layout |
| UTF-8 TXT and Markdown | Deterministic decoding/normalization; never execute or render markup | Source line/offset references |
| UTF-8 CSV / TSV | Bounded standard-library CSV parsing and normalized search text | Row/column data; caller-declared delimiter policy; no formula execution |
| DOC/DOCX, PPT/PPTX, ODT/ODP, RTF | Tika body/slide text and bounded metadata | Logical paragraph/slide references where available; no invented rendered page numbers |
| XLS/XLSX/XLSB, ODS | Calamine through python-calamine; normalized cell search text | Bounded sheets/rows/cells, types and available cached values; no recalculation, macros, or layout guarantee |
| EML / MSG | Tika body, selected headers, and attachment inventory | Attachments are assessed under nesting policy; no automatic import as separate documents |
| Other explicitly approved industrial/proprietary types | `secure-only` when their assessment policy can be completed | Storage/retrieval only; no implied text, CAD/PLC interpretation, or preview support |

The default allowlist consists of the named families; additional storage-only types require explicit operator configuration and a defined assessment policy. File detection is not parser support. Actual deployed processors/profiles and policy restrictions are exposed through `/capabilities`. [Tika format coverage](https://tika.apache.org/docs/4.2.x/formats.html), [Calamine formats](https://github.com/tafia/calamine)

Macro-enabled Office content is outside the default policy, including macro payloads disguised by a different filename. Multi-page TIFF is supported within page/frame limits; other animated image variants are rejected. Containers such as Office/email still require bounded nested-content assessment even though general archive import is deferred. Encrypted or unassessable attachments prevent publication. Embedded images/objects that are security-assessed but not text-extracted must be reflected in extraction coverage; v1 does not promise OCR of every embedded Office/email image or attachment. Clients upload an attachment separately when independent extraction/versioning is needed.

Do not decide that a page is complete merely because it contains a short text header. If mixed-content coverage cannot be established, perform bounded OCR or report `PARTIAL` with page/region warnings. Spreadsheet formulas and cached results must be distinguished when available; unavailable/stale cached data is not a recomputed result. No profile guarantees exact tables, columns, handwriting, formula results, reading order, or business fields.

PDFium is not thread-safe; parallelize with processes, not concurrent PDFium calls from multiple threads. Limit Tesseract/OpenMP threads, page render dimensions, resident memory, scratch space, and wall time. [PDFium process guidance](https://pypdfium2.readthedocs.io/en/stable/python_api.html), [Tesseract outputs](https://tesseract-ocr.github.io/tessdoc/Command-Line-Usage.html)

Run Tika with a bounded forked-JVM pool in the isolated parser runtime; constrain heap, CPU, request/output sizes, embedded-content traversal, and deadlines. Expose only the internal required parsing surface, with per-request configuration, arbitrary fetch/emitter destinations, and optional ML/OCR routes disabled. Parser network egress is denied. Tika's internal process isolation does not replace container/OS isolation or grant access to application credentials. [Tika server isolation and limits](https://tika.apache.org/docs/4.2.x/using-tika/server/index.html)

### Result contract

Return document/version/run IDs, artifact schema version, processor/configuration/model versions, source SHA-256, language, format-appropriate source-unit coverage and warnings, completion time, and index status. Source units may be PDF/image pages, slides, paragraphs, sheets/cells, text lines, or email body/attachment references. Status and quality are separate. Use engine-specific confidence only; never fabricate universal confidence or missing text.

This example is a PDF run. Other families use the same common manifest with their actual source-unit type; page counters are not imposed on spreadsheets, Office text, or email. Unit IDs are scoped to the source version/run and their index/coordinate conventions are documented.

```json
{
  "schemaVersion": 1,
  "documentId": "doc_123",
  "versionId": "ver_004",
  "processingRunId": "run_002",
  "processor": "pdf-text-ocr",
  "processorVersion": "pinned-at-build-time",
  "profileVersion": "searchable_1",
  "sourceSha256": "<sha256-of-the-scanned-original>",
  "status": "PARTIAL",
  "languages": ["en"],
  "coverage": {"unitType": "page", "attempted": 20, "completed": 19},
  "textArtifactId": "artifact_text_001",
  "warnings": [{"sourceUnitId": "page_12", "code": "OCR_TIMEOUT"}],
  "searchIndexStatus": "PENDING"
}
```

Reprocessing creates a new run and immutable attempt-specific artifacts without changing original bytes. The latest requested valid generation may promote a successful/partial result according to the selected profile. Keep the previous successful active extraction until that promotion; a failed replacement does not clear working search. Index replacement is generation-aware and atomic from the query's perspective.

Maintain source-unit IDs, optional OCR word boxes/layout coordinates with documented units, and reproducible source/processor/model provenance. Structured results use versioned JSON artifacts and explicit table/layout coverage; they do not silently populate authoritative business fields. Element IDs are stable within a run; do not promise unchanged IDs across different parser versions. Downstream AI features consume this contract without rewriting document identity.

All extracted text remains untrusted content for downstream AI. Document text never grants tool permissions or changes DMS policy. Authorization remains deterministic, with filtering before content reaches an AI consumer. There is no automatic cloud fallback. [OWASP prompt injection guidance](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html)

## 10. Domain data and consistency constraints

| Aggregate / record | Responsibility |
|---|---|
| Tenant / ConsumerApplication | Namespace, verified identity mapping, pending/active/disabled state, scopes, policies, quotas |
| EnrollmentRecord | Key digest, deployment/tenant/issuer/client binding, expiry, revocation/consumption, activation receipt |
| UploadBatch / UploadBatchItem | Creating application, bounded manifest, per-file operation identity/outcomes, closure/expiry |
| Document | Stable identity, owning application, current version, mutable metadata, lifecycle/revision |
| DocumentVersion | Revision identity, storage reference, size/hash/type, availability and security references |
| StorageObject | Provider/bucket/key, optional storage version, role, actual bytes/hash, reference and disposal state |
| UploadSession | Bound key, expected identity/size, expiry, capability expiry, reservation, snapshot, outcome |
| DocumentReference / ApplicationGrant | External links and explicit application permissions, kept separate |
| SecurityAssessment | Object hash, scanner/signature/policy versions, coverage, outcome, time |
| ProcessingRun / Job / Attempt | Work generation, stage, dependencies, lease/fencing, attempts, result |
| ProcessingArtifact / SearchChunk | Immutable text/data/layout output, source-unit provenance, bounded text, index generation |
| QuotaReservation / Usage | Transactional admission reservations and measured storage/work usage |
| IdempotencyRecord | Operation namespace, canonical request hash, resource identity/result, expiry |
| AuditEvent / OutboxEvent | Durable actor/state-change evidence and atomic publication intent |

Constraints and transactions must enforce:

1. Every tenant-owned record carries `tenant_id`; composite keys/FKs prevent cross-tenant references, including grants, jobs, chunks, and audit targets.
2. The current version belongs to the same tenant/document and is available. Revision numbers are unique per document.
3. Session completion, cancellation, quota adjustment, and result acceptance use persisted state checks, not process-local locks.
4. Availability/current-pointer changes, required job creation, audit, and outbox intent commit atomically.
5. A processing attempt is uniquely bound to its job/generation; accepted artifacts cannot be replaced by a later duplicate.
6. Normal DMS idempotency keys are unique within tenant/application/operation, with a canonical request-body hash. Enrollment uses deployment/verified issuer/client/operation plus the key's bound tenant until activation supplies the application identity. Keys never deduplicate across tenants, clients, or unrelated routes.
7. Storage deletion checks every version/artifact reference, recovery window, and disposal record. Soft deletion alone does not release physical-byte usage.
8. Audit rows have bounded payloads; no bytes, extracted text, secrets, tokens, or presigned URLs. Application roles cannot silently modify past audit entries; this is not a WORM compliance guarantee.
9. Indexes follow actual access paths: tenant/owner/grant, document/revision, job state/next-attempt time, session expiry, and outbox delivery state. Avoid speculative partitioning or indexing arbitrary JSON.
10. Enrollment consumption and activation have one transactional winner for the bound issuer/client; retries cannot activate a second registration or reactivate a disabled one.
11. Batch item IDs are unique within their owning batch. Session creation binds an item once; batch aggregation never supplies permission to another document.

Better Auth owns its user, session, account, OAuth-client, token, and signing-key tables in the separate `auth` schema. DMS tenant RLS rules do not get applied blindly to global identity tables. Separate roles and explicit identity-module authorization protect that schema; DMS records store verified identity mappings rather than foreign keys into mutable session state.

## 11. Public API and consumer contract

Use `/v1` JSON/HTTP APIs. Public response schemas and examples are part of the release, not optional follow-up documentation. This table describes the selected surface; executable OpenAPI is produced during implementation from shared schemas.

| Method | Endpoint | Behavior |
|---|---|---|
| `POST` | `/application-enrollments` | Activate the bound consumer with verified machine token plus one-time Thaarei key; return a nonsecret receipt |
| `POST` | `/upload-batches` | Create a bounded file manifest without granting transfer authority |
| `GET` | `/upload-batches/{id}` | Authorized aggregate stage counts and paginated per-item outcomes |
| `POST` | `/upload-batches/{id}/close` | Close to new sessions; settle unstarted items without undoing published files |
| `DELETE` | `/upload-batches/{id}` | Cancel unstarted/eligible pending items; completed publications remain intact |
| `POST` | `/uploads` | Create a new document candidate/session; `201` with transfer capability |
| `POST` | `/documents/{id}/versions/uploads` | Create a new revision candidate/session |
| `GET` | `/uploads/{id}` | Upload, security, candidate availability, expiry, and failure details |
| `POST` | `/uploads/{id}/complete` | Persist completion intent; `202` with status location |
| `POST` | `/uploads/{id}/refresh` | Reauthorize a nonterminal session and reissue bounded transfer capability |
| `DELETE` | `/uploads/{id}` | Cancel an eligible session; cannot undo completed publication |
| `GET` | `/documents` | Authorized current document listing with bounded filters/cursor |
| `GET`, `PATCH`, `DELETE` | `/documents/{id}` | Read, guarded metadata update, soft delete |
| `POST` | `/documents/{id}/restore` | Restore logical record before its deadline |
| `GET` | `/documents/{id}/versions` | Authorized revision history and per-version status |
| `POST` | `/documents/{id}/versions/{versionId}/restore` | Create a new security-gated revision from historical bytes |
| `GET` | `/documents/{id}/download?versionId=...` | Short-lived capability for the current or explicit available version |
| `GET` | `/documents/{id}/processing?versionId=...` | Run history, active run, coverage, and indexing status |
| `POST` | `/documents/{id}/versions/{versionId}/reprocess` | Create a processing run; `202` |
| `GET` | `/documents/{id}/content?versionId=...&runId=...` | Authorized extraction manifest and bounded artifact capabilities |
| `GET` | `/search` | Authorized current-version search with bounded query/filter parameters |
| `POST`, `DELETE` | `/documents/{id}/references[/{referenceId}]` | Create or remove an authorized external reference |
| `PUT` | `/documents/{id}/permissions` | Guarded replacement of same-tenant application grants |
| `GET` | `/documents/{id}/audit` | Owner/admin audit access with pagination |
| `GET` | `/capabilities` | Active format/profile/limit/language and contract capabilities |

Tenant/operator bootstrap, enrollment-key issuance/revocation, OAuth-client provisioning, application disablement, and policy configuration use supported private operator tooling/admin APIs. Only the guarded enrollment operation is callable before an active consumer registration exists. Identity endpoints live under the configured auth base URL, separate from `/v1` DMS routes. Their login, token, discovery, and JWKS contracts belong to the selected authority. Client/enrollment secrets are shown only through their controlled issuance path, never stored in the DMS registration record or general API responses.

### Retry, consistency, and pagination

- Require bearer authentication and idempotency keys for enrollment, batch/session creation, completion, batch closure, restore, and reprocessing operations. Enrollment also requires its bound unused key or matching consumed-key receipt. Same key/body returns the same operation/resource identity; different body returns `409 IDEMPOTENCY_CONFLICT`. Concurrent in-progress requests receive a retryable conflict. The default idempotency window is 24 hours, disclosed to clients.
- Persist nonsecret operation results/resource IDs, not signed URLs, in the idempotency ledger. On replay, reauthorize and return current operation state; mint a fresh capability only if the same session remains eligible. An expired/cancelled session does not become active again through replay.
- A repeated storage PUT may return `412` because the create-only object already exists. The client checks the session and completes/polls the existing upload rather than treating this as permission to overwrite or create another document. Changing bytes requires a new session.
- Guard metadata, permissions, logical deletion, and restore with `If-Match`; stale revisions return `412`. Allocate version numbers under database concurrency control. Cancellation versus completion has one transactional winner; return the recorded outcome.
- `202` responses provide `Location`, a status resource, and `Retry-After`. Default client polling starts at two seconds with bounded exponential backoff and jitter. Document all terminal outcomes; no broker access is required.
- Normal GETs expose state and resource revisions, never imply immediate search readiness. Publish availability, processing, and indexing separately.
- Use keyset cursors bound to tenant/application, filters, and sort order, with a stable ID tie-breaker. Reauthorize every page. Listings are live views and do not promise a frozen multi-page snapshot during concurrent edits.
- Return stable error codes and request/trace IDs. Distinguish retryable availability errors from policy, authorization, scan-coverage, unsupported-format, concurrency, and quota errors. Follow HTTP `413` for size limits, `429` for rate/work admission, and `503` for infrastructure pressure, with retry guidance where useful.
- Capability responses use `Cache-Control: private, no-store`. No capabilities in logs, telemetry, events, or browser analytics. Browser origins and transfer headers are explicitly allowed in CORS.

Ship login/backend-session and machine-token examples, Thaarei enrollment/rotation/revocation examples, browser single-file/batch transfer through a consumer backend, a standalone backend integration, and contract fixtures validated from Python as well as TypeScript. Examples must never put service credentials or enrollment keys in browser code. SDK packaging and webhooks remain deferred.

## 12. Durable jobs, events, and reconciliation

Use Celery over RabbitMQ with `document.scan`, `document.extract`, and `document.heavy` queues and explicit dead-letter destinations. Heavy work is OCR and enabled Docling layout/table processing. Fixed task names accept a versioned envelope containing job/dispatch IDs and generation, not file bytes or caller-selected code. Indexing, lifecycle maintenance, and stage eligibility remain in the control plane. Celery replaces custom AMQP consumption/process-pool/retry plumbing; it does not replace domain handlers or security boundaries.

RabbitMQ is at-least-once transport. Declare durable queues, persistent messages, publisher confirms, mandatory publishing, and returned-message handling for initial publication and Celery retry publication. A confirmation alone does not prove routing. The Python publisher records outbox delivery only after routing/confirmation checks; a crash before that record permits duplicate dispatch. Use Celery's producer API and task protocol, not an arbitrary JSON envelope published directly from NestJS. [RabbitMQ confirms](https://www.rabbitmq.com/docs/confirms), [Celery task protocol](https://docs.celeryq.dev/en/stable/internals/protocol.html)

Configure Celery for JSON-only accepted content, prefork execution, late acknowledgements for idempotent tasks, explicit per-queue concurrency, and a prefetch multiplier of one for long tasks. Normally a task returns after the private API accepts its result or terminal outcome; transient failure uses a confirmed Celery retry. Celery can acknowledge child-process termination even with late acknowledgement, so database reconciliation must recover the lost attempt. Do not enable unbounded worker-loss requeue loops. No Celery result store, chord-based domain workflow, or additional scheduling framework is required. [Celery task acknowledgement/retry behavior](https://docs.celeryq.dev/en/stable/userguide/tasks.html), [configuration](https://docs.celeryq.dev/en/stable/userguide/configuration.html)

The coordinator transactionally creates jobs/outbox intent; publishing occurs outside that transaction. A task claims the current job/dispatch generation through the private API. Duplicate delivery cannot create a second active attempt. Leases carry opaque fencing tokens and heartbeats; expired attempts cannot commit. Celery task IDs and retry counters do not replace persisted execution budgets or fences. On shutdown, stop taking work, finish within grace or let the attempt expire safely.

Celery is the ordinary transient-execution retry owner, using bounded exponential backoff/jitter. The private API records retry eligibility, next eligible time, and remaining attempt/elapsed budget. The reconciler recovers missing retries or lost attempts only after their recorded deadline and a recovery grace period, issuing a new fenced dispatch generation; it does not run another normal retry schedule alongside Celery. Malformed content, rejected types, and policy failures are terminal. Controlled redrive is an authorized new action against current policy/lifecycle, not blind replay of a poison message.

Internal domain events carry schema/event IDs, tenant, document/version/run identity, aggregate revision, occurred-at and trace context. They contain references, not bytes, extracted text, secrets, or capabilities. Consumers deduplicate event IDs and reject stale aggregate revisions where state order matters. A work message has a job ID and contract version, not authority to select arbitrary tenant/object destinations.

V1 internal handlers/bindings are fixed in code, not a subscription-management framework. Create delivery work only for enabled handlers; record state-change audit even when no handler subscribes. A required configured handler with a missing binding is an error. An event with no configured subscriber does not create an undeliverable outbox backlog.

The reconciler discovers expired attempts, overdue retry/dispatch recovery, incomplete sessions/batches, missing delivery, and uncommitted artifacts using bounded indexed database scans. It rechecks authoritative state and fences any recovered dispatch. Full object inventories are a slower audit tool, not the regular upload-completion mechanism.

Storage notifications may later reduce discovery latency, but they never authorize publication, replace persisted sessions, or establish exactly-once behavior. External notifications in v1 are polling only. Signed webhook delivery is a separate future contract with tenant-scoped subscriptions, replay protection, secret rotation, and delivery history.

Bound operational history: expire idempotency records after their disclosed 24-hour window, delivered outbox records after seven days, and successful attempt details after 30 days. Keep failed work until resolution or recorded operator acknowledgement, with alerts on backlog growth. Default audit retention is 90 days, configurable before release for actual requirements. Preserve version/security/artifact provenance for as long as referenced content exists; history cleanup must not remove active job, deduplication, recovery, or disposal evidence prematurely.

Retain closed/expired batch operational details for 30 days after all started upload sessions terminate; document/version records and their provenance survive independently. Expired/revoked/consumed enrollment secrets and receipts follow the disclosed replay/audit retention rules, without deleting the active registration's identity mapping.

## 13. Limits, admission control, and performance

These are the configured v1 policy defaults, not measured maximum capacities. Operators can lower them; changes must preserve the documented scan, memory, transfer, and processing bounds. `/capabilities` publishes effective values.

| Limit / policy | Initial default |
|---|---|
| File size | 50 MiB, single PUT only |
| PDF pages / TIFF pages | 100 per file |
| Multi-file batch | 100 items; 24-hour lifetime for starting sessions; existing sessions retain their own bounded expiry |
| Open batches / manifest size | 4 per application, 16 per tenant; 256 KiB per manifest, with no file bytes |
| Decoded image/render dimensions | 25 million pixels per page/image |
| Office/email nesting and expansion | At most 5 embedded levels, 100 embedded items, and 100 MiB cumulative expanded content per file; lower engine limits still apply |
| Spreadsheet/CSV data | 100 sheets and 1 million visited cells per file; 32 KiB per cell; count sparse declared ranges and fail boundedly before unsafe allocation |
| Metadata payload | 16 KiB; bounded keys/values/arrays |
| Total extracted text/artifact output | 25 MiB per processing run |
| Active upload sessions | 4 per application, 16 per tenant |
| Queued enrichment jobs | 100 per tenant before admission backpressure |
| Worker concurrency, small profile | 2 scan, 1 ordinary extraction, 1 heavy OCR/layout task; a shared CPU/RAM budget may lower these ceilings |
| Tika fork concurrency, small profile | 1 parser fork within the ordinary-extraction budget; explicit JVM heap/CPU limits |
| Extraction deadline | At most 60 seconds per rendered/OCR page and 10 minutes per document; Office/spreadsheet/email operations also obey the document deadline |
| Execution recovery budget | At most 3 executions per job within a 30-minute execution/retry window; queue wait is reported separately |
| Machine access token / unused enrollment key | At most 5 minutes / 24 hours; enrollment is single-use |
| Upload session / PUT capability | 24 hours / at most 15 minutes, never beyond session expiry |
| Download capability | At most 2 minutes |
| Scanner signature age | At most 48 hours before publication stops |
| Restore window | 30 days after soft deletion |

Reserve declared staging and candidate-copy bytes transactionally before signing an upload. Finalize against actual bytes, release unused reservations once, and include versions/artifacts/quarantine/staging in usage accounting. Retained bytes remain charged until actually removed. Reject inaccurate sizes rather than treating reservation as permission to exceed the upload bound.

Gate uploads and processing on free storage, scratch-disk space, worker capacity, and maximum pending work. Rate-limit transfer ingress as well as metadata APIs. Never rely only on a post-upload HEAD check to enforce size. A tenant's queued-work cap applies to reprocessing too.

Use round-robin tenant/application selection and a per-tenant running-work cap when more than one tenant is enabled. Separate scanning capacity from enrichment so long OCR jobs cannot prevent otherwise valid originals from becoming available. Limit broker prefetch and native-library threads to the available CPU/memory budget.

Measure API p50/p95, database plans/connection saturation, upload completion-to-availability, queue age, extraction/index lag, CPU-seconds/page, peak RSS, scratch usage, artifact bytes, and error/timeout rates by document class. Queue age is more useful for user experience than queue depth alone.

The demand target is **200,000 documents/month**: approximately 6,667/day and 4.63/minute over a 30-day continuous month, or 18.94/minute over 22 eight-hour working days. These are average arrivals, not measured throughput or burst limits. Record pages/file, OCR share, formats, arrival peaks, allowed backlog/processing delay, and operating hours with deployment sizing. A 200,000-page month and a 200,000-document month are different workloads.

Size CPU work using documents × pages/document × OCR fraction × measured CPU-seconds/page, divided by available processing seconds and target utilization, plus scanning/native extraction/layout/storage overhead. Bound parser/model threads and resident memory as well as Celery task count. Long work scales by adding heavy workers; a JVM/model pool must fit its own memory allocation. The small-host profile is a starting package configuration, not a guarantee for every 200,000-document mix.

The metadata latency requirement is p95 below 300 ms for normal metadata requests under the declared operating workload. Original availability, per-class processing duration, queue age, and search lag are reported separately. Ordinary product performance checks verify the configured operating mix without introducing a preliminary architecture trial. A document count alone does not require a cache or separate search cluster.

## 14. Search and content visibility

Store bounded source-unit/chunk text with tenant, document/version, run generation, language, and page/slide/sheet-cell/line/email provenance as appropriate. Cap chunks below PostgreSQL FTS vector/position limits; do not build one unbounded vector for an entire document or spreadsheet. [PostgreSQL text-search limits](https://www.postgresql.org/docs/current/textsearch-limitations.html)

Default results include active documents' current available versions and active extraction generations only. Apply live grants, lifecycle, and security predicates inside the database query before selecting results, snippets, counts, or pagination state. Do not fetch a broad result set and filter it in application memory. Historical text search is deferred; explicit version content/history retrieval remains available.

Index title, filename, supported tags/filters, and extracted text. JSON metadata is not an unrestricted indexed schema. Use English FTS only for the initial language contract; Unicode storage alone does not establish Tamil/Hindi search quality. Additional languages require explicit tokenization and relevance tests.

Build replacement index generations without clearing active results; switch only when the permitted new generation is ready. Deleted/revoked/unsafe content disappears from query eligibility synchronously, even when physical deindexing is asynchronous. Track visible `indexStatus` and generation so consumers can distinguish an original being available from its text being searchable.

## 15. Security and privacy controls

- Expose only the required control/auth endpoints and signed transfer ingress over TLS. Login/token/discovery/JWKS endpoints are distinct from private identity administration. Keep PostgreSQL, RabbitMQ, clamd, Tika/parser interfaces, and SeaweedFS internal interfaces private.
- Validate actual content type, filenames, file signatures, parser output, nesting/expansion limits, and processing bounds across PDF/image, Office, spreadsheet, text, and email families. Reject unsupported active content/macros and block external-link resolution, formula execution, document scripts, and remote-resource fetching. Antivirus is one defensive layer, not content sanitization.
- Default downloads to `attachment` with sanitized filenames, safe response types, and `nosniff`. Future inline previews require a separate origin without application credentials and a separate threat assessment.
- Run workers as nonroot with read-only base images, limited CPU/RAM/PIDs/scratch, restricted system calls, and explicit network policy. Separate trusted transfer/job supervision from untrusted parsers; parsers receive local files without inherited credentials or external network. A plain child process alone is not the security boundary. Enforce these constraints in the actual worker runtime; do not mount a Docker socket into a parser container.
- Scanner, publisher, ordinary extraction, and heavy-processing identities have distinct private API permissions. Broker access is private and scoped; arbitrary task publication must not become an alternate authorization path. An extraction result cannot assert a security pass or publish an original.
- Pin images/dependencies, monitor vulnerabilities, verify artifacts, and record source/model/language-pack provenance. Updates run corpus and safety regressions before promotion.
- Keep client/enrollment secrets, credentials, and capabilities out of exceptions, traces, events, audit payloads, and URL logs. Bound audit context and minimize personal data. Current deletion/cleanup rules cover text, spreadsheet, and structured artifacts; any future export includes their current authorization/provenance boundaries.
- Configure host/volume encryption and encrypted backups for the default installation, with operator-controlled keys and a tested recovery path. Require encrypted service transport across hosts or untrusted networks; document the trusted network boundary in a single-host installation. KMS integration is optional rather than a mandatory service.
- Maintain a threat model for unsigned-header injection, presigned replay, cross-app/tenant access, scanner bypass/limits, malicious PDFs/images, parser SSRF, stale jobs, and capability leakage.

## 16. Self-hosted packaging and scale path

### Supported profiles

| Profile | Contents / acceptance |
|---|---|
| Local development | Same SeaweedFS product and API contracts as the deployment target; isolated test data and test identity configuration |
| Small self-hosted installation | Linux Docker Engine/Compose OSS: API with Better Auth module, coordinator, Python publisher/Celery worker roles, isolated Tika/parsers, ClamAV, PostgreSQL, RabbitMQ OSS, SeaweedFS `mini`, ingress |
| Optional structured profile | Add pinned Docling/model artifacts and a bounded heavy-worker resource allocation; disabled capabilities are not advertised |
| Expanded deployment | Same application images/contracts; separate durable services and worker hosts, distributed storage/HA configured for the required recovery/availability budget |

The default small profile is one host with 8 vCPU, 16 GiB RAM, and SSD-backed persistent volumes. Explicitly allocate memory/CPU to PostgreSQL, storage, scanner, Tika JVM, API, and worker roles; optional model processing needs additional budget or lower concurrent work. The profile is not an HA or guaranteed 200,000-documents/month promise. Persistent capacity includes historical versions, temporary snapshot duplication, retained deletes, artifacts, and backup headroom. Backups must survive loss of this host. No Docker Desktop subscription, commercial broker/storage edition, hosted auth platform, or paid monitoring service is required.

Provide separate liveness, API readiness, and processing-readiness checks. Database or authorization failures block affected requests; a stale scanner or stopped extraction worker reports degraded processing and blocks its unsafe transitions without unnecessarily hiding already available originals. Alert on signature age, oldest pending job/outbox item, dead letters, backup lag, free capacity, repeated reconciliation failures, and authentication errors. Metrics endpoints are private or authenticated.

A self-hosted installation must let an operator install from the versioned Compose/environment reference, bootstrap user/admin and machine identities, issue/revoke Thaarei enrollment keys, activate applications, configure TLS/CORS/volumes/format profiles, inspect diagnostics, upload/retrieve files and batches, and perform backup/restore from the runbook. Supply supported private operator commands/APIs for client creation, scope control, credential/key rotation, suspension, account recovery, and session revocation. Consumer login/recovery screens are application functionality; a full IAM or DMS management console is not required. Do not depend on a developer workstation, cloud account, silent telemetry, or runtime model download.

Bundle/prefetch pinned Tesseract language data, the Tika distribution, and the model artifacts for any enabled Docling profile; record checksums, licenses, notices, and redistributable dependencies. Document verified offline ClamAV signature updates. An offline deployment still needs timely signature updates and does not bypass the freshness gate. Disable model auto-downloads and unapproved remote inference endpoints. [Docling offline operation](https://docling-project.github.io/docling/usage/advanced_options/)

Scale extraction workers first when CPU/memory/queue-age measurements justify it. Scale stateless API/coordinator processes with bounded database pools, then database/storage resources according to observed bottlenecks. Additional SeaweedFS volume capacity does not by itself provide metadata/master HA: use the documented multi-component topology when availability requires it. RabbitMQ quorum queues and PostgreSQL HA belong to the expanded profile; the initial installation has no HA promise. [SeaweedFS deployment path](https://github.com/seaweedfs/seaweedfs/wiki/Quick-Start-with-weed-mini), [RabbitMQ quorum queues](https://www.rabbitmq.com/docs/quorum-queues)

Upgrades use pinned manifests, reviewed SQL migrations, backups, compatible worker/event schemas, and a documented application rollback boundary. Treat destructive schema changes as a separate migration after compatible application rollout. Never run schema synchronization or unreviewed destructive migrations at startup.

## 17. Backups, recovery, and controlled disposal

Back up PostgreSQL, including the platform-auth schema, with a tested base-backup/WAL recovery procedure. Back up both SeaweedFS object data and required filer/master metadata/configuration, using a documented consistent procedure or a verified logical object backup plus metadata manifest. Record identity/policy configuration, recoverable signing/encryption keys, enrollment/activation history, enabled processor/model configuration, and a manifest of object hashes and backup coverage. External-authority deployments also need that authority's recovery procedure. Storage replicas/versioning are not independent backups.

The small-profile recovery requirements are **RPO at most 24 hours and RTO at most 4 hours** for the documented operating data volume and hardware. These are requirements for the implemented solution, not claims about unimplemented software. Keep a seven-day database recovery window and a 30-day soft-delete restore window.

Database and object recovery must share a documented recovery point. Before exposing a restored API, verify all objects needed by the chosen database state exist in the restored store and match expected identity/hash. Do not select a newer database recovery point than object-backup coverage permits.

A disposal worker records a decision, rechecks live references/recovery policy, and performs idempotent exact-key/version deletion. No automatic bucket/volume lifecycle rule may bypass this decision for originals or committed artifacts. Account for shared objects created by historical restore. Audit both requested and completed disposal.

Physical purge is delayed beyond the restore deadline by the oldest retained database recovery horizon, object-backup lag, and a safety margin. With 30 days restore, seven days recovery history, at most one day backup lag, and one day margin, the default earliest purge is 39 days after soft deletion. Longer retained backups or delayed backup completion extend this; the backup catalog, not a hard-coded 39-day cron, determines eligibility. Unpublished staging and abandoned attempts have separate short cleanup policies after all capabilities expire.

Retained backups expire through their own documented policy; physical removal from the live store does not promise immediate erasure from every backup. A future legal hold overrides disposal and requires a separate supported governance feature.

After recovery, discard broker authority over business state: rebuild/reconcile dispatch from current PostgreSQL jobs/outbox records and reject stale generations. Run an application-level restore drill covering original/history retrieval, extraction, grants, pending work, and deletion. A green database restore command alone is insufficient.

## 18. Product correctness requirements

Implement the selected architecture directly. Functionality and dependency order are specified in the [sequenced requirements](headless_dms_functionality_requirements_v1.md). Normal testing and operational checks apply to the actual product as its functionality is built and maintained.

### Requirements that apply throughout

- Identity, Thaarei enrollment/activation, tenant/application authorization, bounded inputs, audit capture, and meaningful error/status reporting accompany each capability from its introduction. Browser sessions and machine tokens are distinct authorities.
- Originals remain unpublished until all required integrity, policy, and scan checks pass. Replayed/altered transfers, failed scanners, unsupported encryption, incomplete scan coverage, and stale signatures cannot bypass publication rules.
- Enrollment consumption, per-file batch/session identity, upload completion, version ordering, quota changes, cancellation, and worker results remain correct across retries, concurrent requests, process restarts, and missing callbacks.
- Parser isolation is enforced by the actual worker runtime. Untrusted parsing cannot access credentials, the external network, original writes, or arbitrary host files.
- English OCR of clean printed scans targets word error rate at most 10%; difficult input classes report their own warnings and partial coverage. No unflagged page omission or invented text is acceptable.
- Search snippets/counts, extraction artifacts, history, and polling enforce current access and lifecycle state. Stale results cannot resurrect deleted or revoked content.
- Self-hosted installation, no mandatory paid dependencies, pinned artifact/license records, health/status, backup recovery, and controlled disposal are supported product capabilities. Capacity checks cover the declared monthly demand and document mix rather than only counting files.

### Ordinary regression coverage

- Cross-tenant/app access through references, grants, versions, content, audit, polling, search snippets/counts, and storage capabilities.
- Login/session versus machine-token use, issuer/audience/scope checks, client/key rotation, enrollment expiry/replay/concurrent consumption, disabled registration, and secret redaction.
- Same/different-body idempotency replay, expired session refresh, cancellation/completion races, v2/v3 completion inversion, and restore of historical shared bytes.
- Batch partial success, per-item admission/retry, item/session deduplication, expiry, and cancellation without deleting completed documents.
- Wrong MIME, malformed/encrypted/embedded Office/email/PDF content, identified macros, spreadsheet sparse-range/cell bombs, multi-page TIFF, decompression/pixel bombs, scanner limits, unsigned storage headers, and capability replay.
- Native/OCR/Office/spreadsheet/structured routing, incomplete source-unit coverage, cached-formula warnings, disabled profiles, and offline artifact availability.
- Broker outage/misrouting, returned messages, Celery retry/child loss, worker lease loss, lost callbacks, duplicate/out-of-order events, parser/JVM OOM, full disks, and interrupted snapshot/index generation.
- Database recovery older than garbage collection, missing objects, restored stale broker messages, rejected-object reassessment, and unreferenced-artifact cleanup.

## 19. Licensing, deployment inputs, and revision history

### Commercial and self-hosted distribution policy

The selected solution must run as a commercial B2B product without mandatory paid commercial licenses or hosted subscriptions. Prefer permissive licenses for application-linked libraries. Open source still has license conditions; paid-license avoidance is not a promise of no attribution, source-availability, or redistribution obligations. RabbitMQ and the separately run ClamAV are explicit service-level copyleft exceptions, with their obligations retained.

| Selected component | Upstream license / distribution treatment |
|---|---|
| Better Auth and OAuth Provider | MIT; retain notices; no hosted/enterprise product required |
| Celery | BSD-3-Clause; selected instead of LGPL-3.0-or-later Dramatiq |
| SeaweedFS OSS | Apache-2.0; use the OSS distribution and supported OSS features |
| PostgreSQL | PostgreSQL License; preserve required notices |
| pypdfium2 / PDFium | Apache-2.0 or BSD-3-Clause wrapper; BSD-style PDFium plus bundled dependency licenses; include the complete binary notices |
| Tesseract / selected tessdata_fast data | Apache-2.0; retain engine and language-artifact provenance/notices |
| Pillow | MIT-CMU in the current upstream release; inventory the pinned release and its codec/font dependencies |
| Apache Tika / python-calamine / Calamine | Apache-2.0 / MIT / MIT respectively; inventory the packaged Java/native transitive dependencies |
| Optional Docling | MIT code; separately approve and pin every model/data artifact and runtime dependency |
| RabbitMQ OSS | MPL-2.0; preserve notices and applicable covered-source availability when distributed |
| ClamAV daemon | GPL-v2; preserve notices and fulfill corresponding-source/distribution requirements; communicate through its daemon protocol rather than linking proprietary code with libclamav |

Do not bundle proprietary/commercial-only editions or models with noncommercial/research-only restrictions. PyMuPDF/MuPDF and a Ghostscript-based conversion pipeline are excluded from the default; their stronger-copyleft/commercial alternatives are unnecessary for the selected paths. Grafana is operator-supplied if desired, rather than a bundled AGPL dependency. This preference does not imply copyleft software prohibits commercial use, nor does container separation remove distribution obligations.

As ordinary implementation/release work, pin package/image/model versions and hashes, retain a software bill of materials, and ship `THIRD_PARTY_NOTICES`, license texts, and required covered-source access/offer materials with customer distributions. Inventory TypeScript/Python dependencies, OS/JVM/native libraries, image codecs/fonts, OCR data, scanner signatures, and models, including optional profiles. Check hosted operation and customer redistribution separately; do not label the full stack license-free from top-level project licenses alone. Thaarei-owned application code and documentation are confidential and proprietary under the repository LICENSE; no open-source license is granted for that material. Third-party components retain their own licenses. No assembled distribution has yet been audited.

[Better Auth license](https://github.com/better-auth/better-auth/blob/main/LICENSE.md), [OAuth plugin license](https://github.com/better-auth/better-auth/blob/main/packages/oauth-provider/package.json), [Celery license](https://github.com/celery/celery/blob/main/LICENSE), [Dramatiq license](https://dramatiq.io/license.html), [PDFium build licenses](https://github.com/pypdfium2-team/pypdfium2#licensing), [MPL distribution guidance](https://www.mozilla.org/en-US/MPL/2.0/FAQ/), [ClamAV linking/license guidance](https://docs.clamav.net/manual/Development/libclamav.html#license), [Docling code/model licenses](https://github.com/docling-project/docling#license)

### Deployment inputs

These inputs configure deployment and future scope without reopening the selected defaults or blocking the start of actual implementation:

1. Consumer-specific format restrictions and future extensions beyond the accepted matrix, non-English OCR, or additional structured/business fields.
2. The file/page/size mix, OCR/structured share, processing window, peak arrivals/transfers, tenants/applications, retention/growth, and acceptable processing delay for the known 200,000-document monthly target.
3. Host/storage/network resources, default Better Auth or configured external issuer, backup destination, and actual recovery/availability budget.
4. Customer/support terms, residency, and governance constraints; Thaarei's application source is proprietary, and dependency/model packaging follows the no-mandatory-paid-license policy above.

Use the scope and configured defaults in this document until deployment-specific values are supplied. Measured capacities remain unclaimed. A requirement outside the frozen v1 receives an explicit scope change rather than silently entering the first release.

| Revision | Decision |
|---|---|
| v1.0 | Proposed architecture and independent-review questions |
| v1.1, 2026-10-30 | Owner accepted review recommendations; SeaweedFS explicitly selected; fixed v1 access/scope/stack; added scan coverage, immutable publication, concurrency/fencing, delivery routing, admission, and recovery/GC |
| v1.2, 2026-10-30 | Owner selected direct implementation; removed preliminary discovery work and phased execution roadmap; added the separate sequenced functionality and requirements document |
| v1.3, 2026-10-31 | Owner accepted Celery/RabbitMQ, Better Auth/OAuth Provider, expanded format/batch/structured requirements, 200,000 documents/month demand, commercial OSS distribution policy, and the corrected company name Thaarei; supersedes earlier scope/stack defaults where changed |
| v1.4, 2026-10-31 | Owner selected NestJS/Fastify, Biome, Linux/Dokploy, and separate Turnstile Vite/React frontend/backend in the monorepo; recorded bounded workspace setup before feature implementation |

## 20. Official implementation references

Reviewed on 2026-10-30–31. Links to `latest`, `current`, default branches, and project wikis may change. Record pinned artifact versions in the actual implementation. These sources support documented capabilities and technical rules; they are not performance results or a distribution-wide license audit for this product.

- [SeaweedFS OSS project and licence](https://github.com/seaweedfs/seaweedfs)
- [SeaweedFS small deployment and authentication defaults](https://github.com/seaweedfs/seaweedfs/wiki/Quick-Start-with-weed-mini)
- [SeaweedFS S3 capability list](https://github.com/seaweedfs/seaweedfs/wiki/Amazon-S3-API)
- [SeaweedFS conditional operations](https://github.com/seaweedfs/seaweedfs/wiki/S3-Conditional-Operations)
- [NestJS HTTP adapters](https://docs.nestjs.com/techniques/performance)
- [Zod JSON Schema export](https://zod.dev/json-schema)
- [Drizzle SQL migrations](https://orm.drizzle.team/docs/migrations)
- [Better Auth OAuth Provider, machine clients, scopes, and resource verification](https://better-auth.com/docs/plugins/oauth-provider)
- [Better Auth Drizzle adapter and auth schema](https://better-auth.com/docs/adapters/drizzle)
- [Better Auth Node handler integration](https://better-auth.com/docs/integrations/express) and [community-maintained NestJS integration](https://better-auth.com/docs/integrations/nestjs)
- [OAuth client credentials](https://www.rfc-editor.org/rfc/rfc6749.html#section-4.4) and [current security practices](https://www.rfc-editor.org/rfc/rfc9700.html)
- [PostgreSQL row security](https://www.postgresql.org/docs/current/ddl-rowsecurity.html)
- [PostgreSQL full-text search](https://www.postgresql.org/docs/current/textsearch.html) and [limits](https://www.postgresql.org/docs/current/textsearch-limitations.html)
- [RabbitMQ delivery acknowledgements and publisher confirms](https://www.rabbitmq.com/docs/confirms)
- [RabbitMQ quorum queues](https://www.rabbitmq.com/docs/quorum-queues)
- [Celery tasks, retries, and acknowledgement behavior](https://docs.celeryq.dev/en/stable/userguide/tasks.html)
- [Celery message protocol](https://docs.celeryq.dev/en/stable/internals/protocol.html) and [configuration](https://docs.celeryq.dev/en/stable/userguide/configuration.html)
- [ClamAV scanning configuration](https://raw.githubusercontent.com/Cisco-Talos/clamav/main/etc/clamd.conf.sample)
- [pypdfium2 API and process/thread constraints](https://pypdfium2.readthedocs.io/en/stable/python_api.html)
- [Tesseract CLI and output formats](https://tesseract-ocr.github.io/tessdoc/Command-Line-Usage.html)
- [Tesseract license](https://github.com/tesseract-ocr/tesseract/blob/main/LICENSE) and [tessdata_fast license](https://github.com/tesseract-ocr/tessdata_fast/blob/main/LICENSE)
- [Pillow license](https://pillow.readthedocs.io/en/stable/about.html#license)
- [Tika format coverage](https://tika.apache.org/docs/4.2.x/formats.html), [isolated server configuration](https://tika.apache.org/docs/4.2.x/using-tika/server/index.html), and [license](https://github.com/apache/tika/blob/main/LICENSE.txt)
- [Calamine formats/license](https://github.com/tafia/calamine) and [python-calamine license](https://github.com/dimastbk/python-calamine/blob/master/LICENSE)
- [OWASP file upload controls](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html)
- [OWASP prompt injection controls](https://cheatsheetseries.owasp.org/cheatsheets/LLM_Prompt_Injection_Prevention_Cheat_Sheet.html)
- [Docling supported formats](https://docling-project.github.io/docling/usage/supported_formats/) and [offline/model configuration](https://docling-project.github.io/docling/usage/advanced_options/)
- [PostgreSQL license](https://www.postgresql.org/about/licence/), [RabbitMQ OSS licensing](https://www.rabbitmq.com/), and [Grafana licensing](https://grafana.com/licensing/)
- [PyMuPDF/MuPDF licensing](https://pymupdf.readthedocs.io/en/latest/about.html#license-and-copyright)

