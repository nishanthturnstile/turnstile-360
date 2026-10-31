# Headless DMS: Sequenced Functionality and Requirements

**Version:** 1.2

**Updated:** 2026-10-31

**Status:** Product requirements aligned with [architecture.md](../architecture.md) and the accepted [product blueprint v1.5](headless_dms_product_blueprint_v1.md).

**Approach:** Direct implementation of the actual solution.

## Purpose and reading rules

This document identifies the functionality the product must provide and a dependency-safe order in which to build it. The owner can select a capability or requirement ID for later discussion and planning. After the bounded [workspace setup](workspace_implementation_plan.md), begin with capability 01 and build the actual solution.

Each numbered group describes required product behavior, its prerequisites, and the capability it makes available. Requirement IDs identify individual behaviors for future discussion and tracking. The numbers are dependency order, not release phases, sprint assignments, estimates, engineering tasks, or a prescribed code structure. A partially built sequence is not automatically a complete release.

[architecture.md](../architecture.md) owns architecture, technical contracts, and configured numeric defaults. The [product blueprint](headless_dms_product_blueprint_v1.md) owns product scope. This document owns the functionality inventory and ordering. If a numeric policy changes, update architecture.md and the affected requirement references together. Every functional requirement below belongs to v1 unless it appears in the explicitly deferred section.

The structured-extraction capability is an included opt-in profile: its installation, model artifacts, resource allocation, and advertised formats are required when enabled. It is not an architecture trial or an automatic processing step for every file. Existing requirement IDs remain stable; newly accepted behavior is appended within the relevant groups.

Security, tenant isolation, audit capture, safe retries, bounded resources, and operational visibility apply as each relevant capability is introduced. Their appearance in a later reporting or management capability does not defer the underlying protection. Normal tests and operational checks concern the actual implemented product; they are not a separate architecture-selection activity.

## Product boundary

- **Consumers:** Registered application backends and tenant operators; applications retain their own screens, business records, and end-user business authorization.
- **Identity:** One shared authority per deployment, Better Auth by default; supported login/session/recovery and machine-client administration. DMS operations use machine access tokens, with one-time Thaarei enrollment for initial consumer activation.
- **Access:** One owning application per document, explicit same-tenant application grants, and no cross-tenant sharing. Browser sessions do not authorize DMS machine operations.
- **Deployment:** Self-hosted, one tenant with multiple applications by default; tenant-aware isolation is required throughout.
- **Files:** PDF; JPEG/PNG/TIFF/BMP/static WebP; UTF-8 text/Markdown/CSV/TSV; the approved Word/PowerPoint/OpenDocument/RTF, spreadsheet, and EML/MSG families in the [architecture format matrix](../architecture.md#supported-format-and-capability-matrix). English OCR is included. Additional industrial formats require explicit storage-only policy and complete required assessment; universal extraction is not promised.
- **Storage:** SeaweedFS. Normal file bytes transfer directly between clients/workers and storage, outside the control API.
- **Processing:** A security requirement precedes every original publication. Native/Office text, spreadsheet data, OCR, optional structured artifacts, and search have explicit capabilities and independent outcomes. The selected Python/Celery/RabbitMQ runtime implements the durable-work behavior; these requirements do not prescribe engineering tasks.
- **Demand:** Up to 200,000 documents/month, with declared file/page mix, OCR/structured share, processing window, and bursts used for capacity sizing.
- **Commercial operation:** No mandatory paid commercial licenses or hosted subscriptions; customer distributions include applicable notices, covered-source obligations, and dependency/model records.
- **Integration:** REST/JSON, documented contracts, polling, and browser/backend examples. A DMS frontend and public broker access are not required.

## Ordered capability index

Follow this order for the initial product. The prerequisite column names the main functional dependencies, rather than every shared non-functional requirement.

| Order | Functionality | Primary prerequisites |
|---|---|---|
| 01 | Shared identity, tenant bootstrap, and application provisioning | None; authorized operator bootstrap |
| 02 | Machine authentication, Thaarei enrollment, and access boundaries | 01 |
| 03 | Consistent API and integration contract | 01, 02 |
| 04 | Audit capture and authorized audit access | 01, 02, 03 |
| 05 | Document identity and registry | 01, 02, 03, 04 |
| 06 | Policies, quotas, and admission control | 01, 02, 03 |
| 07 | Upload sessions, multi-file batches, and direct transfer | 05, 06 |
| 08 | Durable background work, status, and recovery | 03, 04, 05, 06, 07 |
| 09 | File assessment, quarantine, and publication | 07, 08 |
| 10 | Authorized original retrieval | 02, 09 |
| 11 | Binary version history and historical restore | 05, 07, 08, 09, 10 |
| 12 | Metadata, tags, and business references | 03, 05 |
| 13 | Explicit application sharing | 02, 05, 10 |
| 14 | Soft deletion and document restoration | 04, 08, 11, 13 |
| 15 | Native/Office text, spreadsheet data, and source coverage | 08, 09, 14 |
| 16 | OCR and mixed-document handling | 15 |
| 17 | Processing results, optional structure, and reprocessing | 10, 11, 15, 16 |
| 18 | Authorized metadata and full-text search | 12, 13, 14, 17 |
| 19 | Self-hosted administration and operational visibility | 01, 03, 04, 06, 08 |
| 20 | Backup, recovery, and controlled physical cleanup | 11, 14, 17, 19 |

### 01. Shared identity, tenant bootstrap, and application provisioning

**Outcome:** An operator can establish the shared identity/tenant context, support user login, and provision intended applications without changing DMS code.

- **FR-01.01:** The product must support authorized bootstrap of a tenant and its operator/admin identity, without unauthenticated public sign-up.
- **FR-01.02:** A tenant must be able to provision multiple intended applications with stable identities, pending/active/disabled state, permitted scopes, source namespaces, and applicable policies. Provisioning alone must not activate a consumer before group 02's enrollment requirements pass.
- **FR-01.03:** Each application registration must belong to exactly one tenant and map to a verified identity-provider client. A service acting for multiple tenants must use separate registrations in v1.
- **FR-01.04:** Operators must be able to change an application's enabled state, scopes, and policy settings through supported administration interfaces.
- **FR-01.05:** Application credentials must be issued/rotated through the configured identity provider without changing document ownership or requiring changes to consumer repositories.
- **FR-01.06:** Configuration must support the default single-tenant installation while preserving tenant identity on every tenant-owned resource.
- **FR-01.07:** The shared authority must support user sign-in/sign-out, session expiry/revocation, and controlled account recovery for consumer applications. Consumers supply their screens and retain business permissions; these users do not automatically become DMS end-user principals.
- **FR-01.08:** Supported private operator interfaces must provision accounts/machine clients, control scopes, rotate credentials/signing keys, and recover or suspend access without requiring a full identity-management UI or public self-registration.
- **FR-01.09:** Consumer applications and the DMS must be able to use the same selected identity authority without sharing service credentials or deriving trust from monorepo membership.

**Available after this group:** Shared identity/login capability, tenant/admin context, and provisioned clients ready for guarded activation.

### 02. Machine authentication, Thaarei enrollment, and access boundaries

**Outcome:** Every request has a verified application and tenant context, with access denied unless explicitly permitted.

- **FR-02.01:** The product must authenticate application tokens using the configured issuer, signature/algorithm, audience, expiry, and client-identity rules.
- **FR-02.02:** The product must derive tenant/application context from the verified registration. Caller-supplied identifiers must not establish authorization.
- **FR-02.03:** Disabled, expired, invalid, or wrongly scoped credentials must not authorize new control operations or new file-transfer capabilities.
- **FR-02.04:** Tenant resources must remain isolated across document metadata, versions, files, processing, search, audit, and administrative operations.
- **FR-02.05:** Applications in the same tenant must remain isolated by default; ownership or a permitted explicit grant is required for document access.
- **FR-02.06:** Ordinary applications must not exercise tenant-admin powers. API scopes must constrain, rather than replace, document-level authorization.
- **FR-02.07:** Consumer backends must retain their own end-user permissions. Reported end-user identifiers may supply audit context but must not be treated as verified DMS principals.
- **FR-02.08:** Provisioned application backends must obtain short-lived, audience-bound tokens through dedicated client-credentials clients under administrator-assigned scope ceilings. User-login clients must remain separate from DMS machine registrations; ordinary users must not self-assign machine scopes.
- **FR-02.09:** Browser session cookies or identity tokens must not substitute for DMS machine access tokens. Service credentials and enrollment keys must never be required in browser code.
- **FR-02.10:** Authorized operators must be able to issue/revoke a single-use Thaarei enrollment key bound to the deployment, tenant, expected issuer/client, and expiry, retaining only its digest and nonsecret metadata.
- **FR-02.11:** Initial activation must require both a valid machine token and the matching enrollment key. The enrollment route may accept the bound provisioned client before activation; normal DMS routes must deny pending registrations.
- **FR-02.12:** Enrollment must atomically consume the key, activate one bound application, and record a nonsecret retry receipt. An authenticated identical retry returns the same outcome; reuse for another request/client cannot create a second registration or re-enable a disabled one.
- **FR-02.13:** Expired unused or revoked enrollment keys must fail clearly. Routine DMS requests must not require an enrollment key; key/token values must be excluded from logs and audit payloads.
- **FR-02.14:** Credential/signing-key rotation must preserve registered application identity and document ownership. Local application disablement must stop new DMS authority even while previously issued tokens remain cryptographically valid.
- **FR-02.15:** Publisher/scanner/extraction roles must have distinct internal machine identities and permissions; an extraction identity must not assert a security pass or publish content.
- **FR-02.16:** An operator may select a supported external OAuth/OIDC authority instead of the default without changing the DMS machine-token/resource-authorization contract. Arbitrary simultaneous issuer federation and delegated end-user access remain outside v1.

**Available after this group:** A consistent access boundary that every subsequent capability uses.

### 03. Consistent API and integration contract

**Outcome:** Consumers can understand requests, outcomes, retries, pagination, and supported capabilities without depending on DMS internals.

- **FR-03.01:** Public capabilities must have versioned request/response contracts and generated API documentation that remain compatible within the declared API version.
- **FR-03.02:** Responses must use stable error codes and request/correlation identifiers, distinguishing authorization, policy, concurrency, capacity, processing, and infrastructure failures.
- **FR-03.03:** Retrying protected enrollment, batch/session creation, completion, batch closure, restore, or reprocessing with the same idempotency key and body must preserve operation/resource identity within the disclosed window.
- **FR-03.04:** Reusing that key with different request content must return a conflict. Concurrent duplicates must return the recorded result or an explicit retryable in-progress outcome.
- **FR-03.05:** Mutable document operations must support an expected revision and reject stale changes rather than silently overwrite another caller's work.
- **FR-03.06:** Lists must have bounded pages, supported filters, stable ordering, and tenant/application-bound cursors. Each page must use current authorization.
- **FR-03.07:** Capability discovery must distinguish accepted storage/security policy, text extraction, structured data/layout, and preview support by format, together with languages, enabled profiles, limits, and active API capabilities. Detection alone must not advertise extraction support.
- **FR-03.08:** Long-running operations must expose a status resource and polling guidance. Acceptance of work must be distinguishable from completion, with terminal success/failure outcomes documented.
- **FR-03.09:** Each implemented public capability must include usable request/response examples. Complete v1 examples must cover user/backend sessions, machine tokens, Thaarei enrollment and rotation/revocation, single-file/batch browser transfer through a backend, and independent backend integration without exposing service secrets to a browser.

**Available after this group:** A common consumer contract that grows with the actual functionality.

### 04. Audit capture and authorized audit access

**Outcome:** Security-sensitive operations and document changes leave attributable, queryable records from their introduction.

- **FR-04.01:** Capture application/actor context, tenant, action, affected resource, outcome, time, and correlation information for security-sensitive operations and state changes.
- **FR-04.02:** Record enrollment issuance/consumption/revocation, activation/disablement, credential administration, authorization/grant changes, batch/session operations, transfer authorization, publication, metadata/reference changes, deletion/restoration, reprocessing, and disposal as those operations become available.
- **FR-04.03:** State-change audit must agree with the corresponding committed operation. A retry must not create a fictitious second publication or second lifecycle change.
- **FR-04.04:** The owning application and authorized tenant operators must be able to retrieve paginated document audit records; unrelated applications and tenants must not see them.
- **FR-04.05:** Audit must exclude file bytes, extracted text, credentials, bearer tokens, and signed URLs. Reported user context must be identified as application-asserted context.
- **FR-04.06:** Ordinary application access must not allow silent rewriting of audit history. Retention must follow configured operational policy without claiming regulated immutable storage.
- **FR-04.07:** Issuing a download capability must be recorded as authorization issuance; it must not be presented as proof that the entire file was downloaded.

**Available after this group:** A reliable record of subsequent document and access operations.

### 05. Document identity and registry

**Outcome:** An application can identify and inspect a logical document independently of its binary revisions.

- **FR-05.01:** Allocate a stable document ID, tenant, owning application, and initial candidate version identity as part of beginning a new document upload.
- **FR-05.02:** Preserve the logical document ID across new binaries, metadata changes, reprocessing, and supported restores.
- **FR-05.03:** Expose document title, original display filename, ownership, lifecycle state, current-version identity when present, and revision information to authorized callers.
- **FR-05.04:** Distinguish an existing logical record from an available original. A record with no published version must not appear as a downloadable or searchable document.
- **FR-05.05:** Provide authorized document retrieval and bounded listing; original filenames must be sanitized presentation data rather than storage locations or authority.
- **FR-05.06:** Document, binary version, upload session, security assessment, processing run, and indexing statuses must remain distinguishable.

**Available after this group:** Stable document and candidate identities for transfer and processing.

### 06. Policies, quotas, and admission control

**Outcome:** The product accepts only work and storage consumption allowed by policy and current capacity.

- **FR-06.01:** Enforce configured format, size, page/frame, image-dimension, nested-item/expanded-size, spreadsheet sheet/cell/range, batch-item, metadata, artifact-output, and processing-time limits before unsafe allocation or execution.
- **FR-06.02:** Support operator-controlled `secure-only` and `searchable` profiles and the installed/enabled opt-in `structured` profile, with versioned settings and application permissions. Reject unsupported/disabled profile-format combinations explicitly.
- **FR-06.03:** Reserve the declared upload and candidate-storage capacity before granting transfer authority. Concurrent requests must not spend the same remaining capacity more than once.
- **FR-06.04:** Account separately for staging, originals, historical versions, artifacts, and retained rejected/deleted content. Release unused reservations and removed bytes once, against actual outcomes.
- **FR-06.05:** Bound open batches, manifest/request size, active uploads, queued work, running work, and reprocessing. Return an explicit admission/rate/capacity outcome with retry guidance where applicable.
- **FR-06.06:** Limit expensive processing fairly across enabled tenants/applications, while preserving separate capacity for mandatory scanning.
- **FR-06.07:** Storage/scratch pressure and unavailable mandatory dependencies must block affected unsafe work without incorrectly reporting success or permanently consuming reservations.
- **FR-06.08:** Effective policy values must be discoverable. Consumer applications must not select arbitrary processors, executable instructions, or file-storage destinations.
- **FR-06.09:** Additional industrial/proprietary types may be admitted for storage-only use only under explicit operator policy with assessable required security checks. Unsupported extraction must remain distinct from a security pass; unassessable content must remain unavailable.

**Available after this group:** Bounded admission for upload and asynchronous work, before transfer begins.

### 07. Upload sessions, multi-file batches, and direct transfer

**Outcome:** A consumer can send a supported file to private storage reliably without routing its bytes through the DMS control API.

- **FR-07.01:** Create an upload session bound to the authorized document/candidate, declared size/type, requested profile, optional checksum, reservation, and expiry.
- **FR-07.02:** Return a short-lived capability restricted to a unique staging destination, the declared byte length, permitted transfer operation, and create-only behavior.
- **FR-07.03:** Support direct single-PUT transfer from a browser or independent backend to SeaweedFS. Do not expose general storage credentials or original/artifact write access.
- **FR-07.04:** A replayed upload must not overwrite an existing staging object or published original. The consumer must be able to inspect and complete the existing session after an ambiguous/repeated transfer.
- **FR-07.05:** Completion must acknowledge receipt of the request and expose status; it must not itself imply security approval or original availability.
- **FR-07.06:** Refresh transfer authorization only after current access and session eligibility checks, without reviving expired/cancelled sessions or exceeding their expiry.
- **FR-07.07:** Support cancellation/expiry with a single consistent outcome against concurrent completion. A completed publication cannot be undone by cancelling its former upload session.
- **FR-07.08:** Reconcile uploaded bytes with the correct persisted session and candidate, including actual size and any declared checksum. Do not treat an unrelated storage object as a completed upload.
- **FR-07.09:** Preserve private staging isolation and clean abandoned data only after issued capabilities are no longer usable and retention/cleanup conditions permit it.
- **FR-07.10:** Reject unsupported multipart/resumable requests and files outside the single-PUT limit with clear capability/size errors; do not advertise these deferred features.
- **FR-07.11:** Permit an application to create a bounded multi-file batch manifest with stable unique item IDs and file descriptors. Manifest creation alone must not create documents, reserve physical bytes, or issue transfer authority.
- **FR-07.12:** Start each batch item's ordinary upload session independently under current authorization/admission limits. Bind an item to at most one document/candidate operation, preserving that identity across retries.
- **FR-07.13:** Expose authorized aggregate stage counts and paginated per-file upload/security/availability/processing outcomes, including admission delay and retry guidance. A batch must not imply every item succeeded.
- **FR-07.14:** One item's failure or retry must not roll back successful items. Each file must remain an independent document/version with ordinary access and processing rules.
- **FR-07.15:** Support batch closure/expiry and cancellation of unstarted/eligible pending items, with consistent outcomes against concurrent session creation/completion. Never delete already-published documents as a side effect of batch cancellation.
- **FR-07.16:** Restrict batch inspection/control to its creating application and authorized tenant operators. Grouping must not grant access to another document; new-version batch items require group 11's versioning rights and behavior.
- **FR-07.17:** Treat multi-file batches, archive contents, and multipart upload as separate capabilities. Batch support must not silently unpack archives or advertise deferred multipart transfer.

**Available after this group:** Private uploaded bytes attached to a persisted candidate, awaiting assessment.

### 08. Durable background work, status, and recovery

**Outcome:** Required work remains observable and recoverable despite retries, lost callbacks, duplicate delivery, or process restarts.

- **FR-08.01:** Persist required work and its relationship to the document/version before reporting the operation as accepted.
- **FR-08.02:** Expose separate upload, security, publication, processing, and indexing outcomes. Pending work must progress to a documented result or visible actionable failure.
- **FR-08.03:** Recover incomplete uploads and due work without depending on the client completion callback or optional storage notifications.
- **FR-08.04:** Duplicate/out-of-order delivery must not create duplicate accepted results, revisions, quota charges, or state transitions.
- **FR-08.05:** Recover interrupted execution with bounded attempts and elapsed-work budgets. Treat policy/content rejection as terminal rather than retrying indefinitely.
- **FR-08.06:** Late results from cancelled, expired, replaced, or invalid attempts must not affect active state or resurrect unavailable content.
- **FR-08.07:** Authorized operators must be able to inspect failed work and request a controlled retry against current policy and lifecycle state.
- **FR-08.08:** Record domain changes and required outgoing work consistently. Missing delivery/routing must remain visible and recoverable, rather than marking work complete merely because transport accepted a message.
- **FR-08.09:** Consumers must be able to poll authorized status without access to internal queues, workers, or administrative interfaces.
- **FR-08.10:** Persist one authoritative execution budget and retry eligibility per job. Ordinary transient retries and recovery of lost execution must not compete to create independently accepted work; transport/framework status alone must not establish business completion.
- **FR-08.11:** Long OCR/structured work must not exhaust mandatory scanning capacity or prevent ordinary text extraction from progressing. Expose queue age and processing delay by work class.

**Available after this group:** The reliable work and status capability used by scanning, extraction, indexing, and cleanup.

### 09. File assessment, quarantine, and publication

**Outcome:** Only the exact assessed bytes become an available original.

- **FR-09.01:** Keep every new upload/candidate unavailable through normal file retrieval until required integrity, format, structural-policy, and malware assessments pass.
- **FR-09.02:** Establish a server-controlled immutable original candidate, assess that object, and publish access to the same bytes. Reusable upload authority must not change those bytes.
- **FR-09.03:** Derive the authoritative content checksum from the file and check any declared checksum. A storage concurrency identifier must not be mistaken for an equivalent checksum.
- **FR-09.04:** Determine actual content type from content and enforce the supported-format policy, irrespective of filename or claimed MIME type.
- **FR-09.05:** Apply format-specific PDF/image, Office/spreadsheet, text, and email policies, including page/frame/dimension, sparse-range/cell, nested-item/expanded-content bounds, macro policy, and rejection/inconclusive handling for encrypted, malformed, embedded, or unassessable content.
- **FR-09.06:** Distinguish security pass, rejection, and inconclusive assessment. Scanner errors, skipped content, exceeded coverage limits, timeouts, encryption, and stale signatures must not become a pass.
- **FR-09.07:** Retain the assessed source identity/hash, policy/scanner/signature versions, time, coverage evidence, and outcome with the affected object/version.
- **FR-09.08:** Automatically make a passed candidate available and select the first current version consistently with the document record, audit, and required work. A failed candidate must not replace an existing current original.
- **FR-09.09:** Make the passed original available independently of optional extraction/indexing success; expose those statuses separately.
- **FR-09.10:** A later security invalidation must stop new access to affected originals and derived content, including every version referencing the same bytes. Existing short-lived issued capabilities retain only their bounded validity.

**Available after this group:** A protected original whose availability has an attributable security basis.

### 10. Authorized original retrieval

**Outcome:** An authorized consumer can retrieve an available original without exposing private storage or bypassing current access policy.

- **FR-10.01:** Authorize tenant, application, ownership/grants, document lifecycle, version availability, and security state before issuing read authority.
- **FR-10.02:** Return short-lived read-only access to the selected protected object; normal original bytes must transfer outside the control API.
- **FR-10.03:** Default retrieval to the current available version. Pending, rejected, inconclusive, deleted, or purging content must not receive normal read authority.
- **FR-10.04:** Support ordinary large-response/range retrieval within the selected storage contract without granting access to other files.
- **FR-10.05:** Return safe content disposition and a sanitized display filename. Prevent accidental caching, logging, or analytics capture of signed capabilities.
- **FR-10.06:** Disabling/revoking access must prevent new capabilities immediately. Disclose that an already-issued capability can remain usable until its short expiry.
- **FR-10.07:** Retrieval failure must distinguish policy/unavailability from transient infrastructure errors without leaking another application's document information.

**Available after this group:** The first complete secure upload-to-retrieval document capability.

### 11. Binary version history and historical restore

**Outcome:** Applications can replace content and retrieve history while preserving document identity and immutable past bytes.

- **FR-11.01:** Support new candidate uploads under the existing document ID with unique, monotonically increasing revision numbers; failed candidates may leave gaps.
- **FR-11.02:** Keep the current available version accessible while a replacement is uploaded and assessed.
- **FR-11.03:** Every replacement must pass the same upload, quota, integrity, and security requirements as a first version.
- **FR-11.04:** Expose authorized version history and explicit historical retrieval, including revision identity, availability/security status, file identity, and relevant processing status.
- **FR-11.05:** When candidates finish out of order, a lower revision must not replace a higher current version. Concurrent publication must have one consistent current outcome.
- **FR-11.06:** Restore historical bytes by creating a new highest-numbered revision and applying the current security/publication policy, without rewriting the historical version.
- **FR-11.07:** Preserve live object references when historical restores reuse protected bytes; reprocessing or metadata changes must not create a new binary version by themselves.
- **FR-11.08:** Version-specific retrieval, content, and status must remain bound to that version rather than silently switching to a newer current original.

**Available after this group:** Reliable revision management and explicit history restoration.

### 12. Metadata, tags, and business references

**Outcome:** Applications can organize and associate documents without transferring their business domain into the DMS.

- **FR-12.01:** Allow authorized changes to title, tags, and bounded JSON metadata without modifying original bytes or binary revision history.
- **FR-12.02:** Enforce supported metadata shapes, size/value bounds, revision checks, and audit for accepted changes.
- **FR-12.03:** Support documented list filters over title/name, supported tags/fields, and external references; do not expose an unrestricted arbitrary metadata query engine.
- **FR-12.04:** Allow authorized applications to link/unlink external source-system, entity-type, and entity-ID references within their registered source namespace.
- **FR-12.05:** Namespace references by tenant and application so identical external IDs in unrelated applications do not collide or imply shared ownership.
- **FR-12.06:** Require existing document access for reference operations. Creating/removing a reference must not grant/revoke document access or cause the DMS to fetch the external record.
- **FR-12.07:** Preserve multiple authorized references to one document, retaining their source/application namespaces, and expose them only to callers authorized for the document.

**Available after this group:** Useful document organization and business links through the API.

### 13. Explicit application sharing

**Outcome:** Independent applications within one tenant can share selected document capabilities without weakening default isolation.

- **FR-13.01:** Support explicit grants to registered applications in the same tenant for `READ`, `EDIT_METADATA`, and `ADD_VERSION` as separate permitted capabilities.
- **FR-13.02:** Only the owning application or tenant administrator may change grants. Grant changes must use revision checks and be audited.
- **FR-13.03:** Enforce read grants consistently across original/history retrieval, extraction, status, and search as those capabilities are available.
- **FR-13.04:** Restrict delete/restore, reprocessing, and permission management to the owner/admin; an ordinary read or add-version grant must not confer these powers.
- **FR-13.05:** Apply revocation to new control requests and new capabilities immediately, including search snippets/counts and processing results.
- **FR-13.06:** Reject cross-tenant sharing and ownership transfer. Business references and common tenant membership must not create implicit grants.

**Available after this group:** Controlled reuse of one document across independent applications.

### 14. Soft deletion and document restoration

**Outcome:** Owners can withdraw documents immediately while preserving a bounded recovery window.

- **FR-14.01:** Permit only the owner/admin to soft-delete an active document with the required revision protection and audit.
- **FR-14.02:** Immediately remove a deleted document from ordinary listing, search, content, and retrieval eligibility and stop new transfer capabilities.
- **FR-14.03:** Cancel/ignore affected work so late upload, processing, or indexing results cannot restore visibility.
- **FR-14.04:** Preserve versions and object references through the configured logical restore window; do not release retained physical-byte usage prematurely.
- **FR-14.05:** Let the owner/admin inspect the lifecycle outcome and restore an eligible document before the deadline, preserving its logical identity and valid grants.
- **FR-14.06:** Check object availability/integrity and current security policy on restore. Invalidated content must remain unavailable until reassessed.
- **FR-14.07:** Resume needed work under a fresh valid lifecycle context, without accepting results from the former deleted context.
- **FR-14.08:** Refuse logical restore once physical disposal has begun or the restore window has ended. Keep physical disposal as the separately controlled capability in group 20.

**Available after this group:** Reversible logical deletion with consistent visibility and background-work behavior.

### 15. Native/Office text, spreadsheet data, and source coverage

**Outcome:** Available supported PDFs, text, Office documents, spreadsheets, and email produce attributable text/data results without altering their originals.

- **FR-15.01:** For the `searchable` profile, extract text from security-passed native PDF pages and supported text files using bounded asynchronous work.
- **FR-15.02:** Preserve source document/version identity and appropriate page, slide, paragraph, sheet/cell, line, or email-part references. Record source hash and processor/profile versions; never invent rendered pagination for a format that does not supply it.
- **FR-15.03:** Distinguish usable text, legitimately empty pages, pages needing OCR, unsupported extraction, and failures. A small text header must not establish complete page coverage.
- **FR-15.04:** Record per-source-unit outcomes, warnings, attempted/completed coverage, and overall success/partial/failure without inventing missing content, including assessed embedded content omitted from extraction.
- **FR-15.05:** Enforce extraction-time, memory, image, and output bounds. A failed extraction must not make an otherwise available original inaccessible.
- **FR-15.06:** The `secure-only` profile must omit enrichment explicitly rather than appear stuck or imply that text extraction succeeded.
- **FR-15.07:** Extract bounded body/slide text and supported metadata from the approved Word, PowerPoint, OpenDocument, and RTF families, reporting unsupported elements and incomplete coverage.
- **FR-15.08:** Read supported Excel/OpenDocument sheets and bounded cells into attributable tabular results with available value types and cached values. Distinguish formulas/cached results when available; never imply recalculation, execute macros, or fetch external workbook links.
- **FR-15.09:** Parse supported UTF-8 CSV/TSV under explicit delimiter and cell/row/output limits, preserving row/column references and treating formula-like content as data.
- **FR-15.10:** Extract approved EML/MSG body/headers and a bounded attachment inventory. Security assessment of attachments must remain distinct from text extraction; do not automatically import attachments as separate documents or promise OCR of every embedded image.
- **FR-15.11:** Route each format/profile to its selected primary extraction path, with only the required OCR fallback. Avoid running every engine on every file; unsupported extraction must have an explicit outcome independent of original availability.

**Available after this group:** Format-aware text/tabular data and an explicit inventory of unsupported, incomplete, or OCR-needed source units.

### 16. OCR and mixed-document handling

**Outcome:** Scanned PDFs and supported images produce English OCR with honest coverage and quality information.

- **FR-16.01:** Recognize text from scanned PDF pages and approved JPEG/PNG/TIFF/BMP/static WebP images within configured pixel/page/frame/time limits, preserving multi-page TIFF order and reporting any unprocessed pages.
- **FR-16.02:** Support English OCR and identify the configured language/model version; do not claim support for unconfigured languages.
- **FR-16.03:** Handle native, scanned, and mixed pages within one PDF without needlessly replacing usable native text or duplicating native and OCR output.
- **FR-16.04:** Account for pages containing both native text and image text; perform bounded recognition or report incomplete coverage rather than silently omitting image content.
- **FR-16.05:** Apply supported orientation handling and identify failed/uncertain pages or image regions in the result.
- **FR-16.06:** Use engine-specific confidence only where available, with no fabricated universal confidence or guaranteed table/handwriting accuracy.
- **FR-16.07:** OCR must preserve the original bytes and report explicit partial/failure outcomes when limits are reached. The accepted OCR quality target is recorded in the shared quality requirements below.

**Available after this group:** OCR text for the supported PDF/image paths, with explicit coverage outcomes; storage-only and unprocessed embedded content never imply OCR support.

### 17. Processing results, optional structure, and reprocessing

**Outcome:** Consumers can retrieve text/tabular results, opt into enabled structural extraction, and request replacement results without changing original versions.

- **FR-17.01:** Expose processing run history, the active accepted run, independent indexing status, and the distinction between run completion and extraction completeness.
- **FR-17.02:** Provide an authorized result manifest with document/version/run IDs, source hash, artifact schema and processor/profile/model versions, language, format-appropriate source-unit coverage/warnings, and artifact references.
- **FR-17.03:** Permit authorized access to accepted text/artifact results using bounded responses or short-lived capabilities, with the same current lifecycle/security/access checks as originals.
- **FR-17.04:** Support explicit version/run selection without silently returning output for another version or a different run.
- **FR-17.05:** Permit the owner/admin to request a new bounded processing run under an allowed profile/configuration while preserving original bytes and binary revision history.
- **FR-17.06:** Keep the previous accepted active extraction while a replacement is pending or fails. Promote an eligible accepted replacement consistently.
- **FR-17.07:** Prevent stale/duplicate attempts or superseded runs from overwriting accepted artifacts or the active result; retain provenance for accepted results.
- **FR-17.08:** Preserve page identity and documented coordinate meaning where OCR boxes exist, without promising stable element IDs across different processor versions.
- **FR-17.09:** When the structured profile is installed/enabled, permit authorized opt-in PDF/image layout/table extraction and expose versioned JSON artifacts with source references, coverage, and warnings. It must not be an automatic expensive step for every document.
- **FR-17.10:** Return structured/spreadsheet artifacts through bounded authorized results or short-lived capabilities, preserving types and documented coordinates where available, without promising exact tables or automatically accepting extracted values as authoritative business fields.
- **FR-17.11:** Extracted content must remain untrusted data; it cannot change access policy, choose executable tools/processors, or trigger an undisclosed external AI service.

**Available after this group:** A reusable text/data/optional-layout API with provenance and safe result replacement for downstream applications.

### 18. Authorized metadata and full-text search

**Outcome:** Applications can find only the current, available documents they are allowed to read.

- **FR-18.01:** Search supported title/name, tags/filters, business references, and extracted text under the configured English search contract.
- **FR-18.02:** Default results to active documents' current available binary versions and active accepted extraction results. Historical full-text search is outside v1.
- **FR-18.03:** Enforce current tenant/application grants, lifecycle, and security before returning documents, snippets, counts, or pagination information.
- **FR-18.04:** Return source document/version identity and page, slide, sheet/cell, line, or email-part references where available, without leaking unauthorized extracted content through excerpts or counts.
- **FR-18.05:** Support bounded queries, supported filters, stable pagination, and documented title/name fuzzy matching; reject unsupported arbitrary searches clearly.
- **FR-18.06:** Show indexing status/lag separately from original availability and allow metadata-only search for `secure-only` documents.
- **FR-18.07:** Keep the previous usable index active while replacing extraction/index generations. Failed replacement must not clear working search.
- **FR-18.08:** Remove deleted, revoked, or newly unsafe content from query eligibility immediately, even if physical index cleanup continues asynchronously.

**Available after this group:** Permission-aware discovery across the supported document collection.

### 19. Self-hosted administration and operational visibility

**Outcome:** An operator can run and administer the actual product on controlled infrastructure without relying on a developer workstation or mandatory cloud service.

- **FR-19.01:** Provide a versioned self-hosted installation package and configuration reference for the selected application, storage, identity, and processing services.
- **FR-19.02:** Support configuration of the selected authority, clients/scopes, signing-key and credential rotation, Thaarei enrollment, TLS, browser origins, persistent storage, approved formats/profiles, resource limits, secrets, and signature updates through documented operator interfaces.
- **FR-19.03:** Expose liveness, API readiness, and processing readiness separately so an enrichment outage does not incorrectly hide available originals.
- **FR-19.04:** Expose authorized operational status for upload/batch/work backlog, per-class queue age and processing delay, failures, signature freshness, CPU/memory/scratch capacity, backup lag, and repeated recovery errors.
- **FR-19.05:** Provide bounded logs/metrics and correlation for diagnosing an operation without exposing bytes, extracted text, credentials, or transfer capabilities.
- **FR-19.06:** Support orderly service restart/shutdown and controlled failed-work retry without losing accepted document state or duplicating accepted effects.
- **FR-19.07:** Package required OCR language data, parser distributions, and every approved model artifact for enabled profiles, with checksums/provenance and verified offline scanner updates. Customer processing must not trigger an undisclosed cloud fallback or runtime model download.
- **FR-19.08:** Document supported upgrades, compatibility, dependency versions/attributions, and application rollback boundaries while preserving stored documents and contracts.
- **FR-19.09:** Keep operational/admin interfaces private or authenticated. The default single-host deployment must not be represented as highly available.
- **FR-19.10:** Provide a dependency/image/model inventory, license texts/notices, and applicable covered-source access/offer materials with customer distributions. Document the selected copyleft service obligations and exclude mandatory paid/noncommercial-only dependencies from required product paths.
- **FR-19.11:** Permit the declared monthly demand to be supported by configuring bounded ordinary/heavy worker resources without changing public contracts. Report operating-mix capacity and backlog honestly rather than claiming the small-host configuration suits every file mix.

**Available after this group:** Supported installation, administration, diagnostics, and operational control.

### 20. Backup, recovery, and controlled physical cleanup

**Outcome:** Operators can recover the document system coherently and remove physical bytes only when every live and recovery dependency permits it.

- **FR-20.01:** Support recoverable backups of document/database and shared-auth state, original/text/data/layout artifacts, required SeaweedFS metadata/configuration, application/enrollment mappings, enabled processor/model policy, and signing/encryption-key recovery information. Configured external authorities require their own documented recovery coverage.
- **FR-20.02:** Keep backups outside the failure boundary of the default host. Replication and object versioning alone must not be presented as independent backup.
- **FR-20.03:** Record backup coverage/recovery points and select a mutually consistent database/object state during recovery; do not expose records whose required bytes cannot be recovered.
- **FR-20.04:** Recover ownership/grants, current/history identities, security state, accepted processing results, batch/session outcomes, activation mappings, lifecycle decisions, and pending work coherently. Reestablish the intended identity/authorization policy before reopening access.
- **FR-20.05:** Restore/reconcile pending work from authoritative recovered state without letting stale broker messages recreate deleted or completed work.
- **FR-20.06:** Support the documented recovery-time/data-loss objectives and recovery-history window for the operating deployment.
- **FR-20.07:** Physically remove originals/artifacts only after the logical restore window, all live references, retained database recovery history, object-backup lag, and disposal policy allow it.
- **FR-20.08:** Protect objects shared by multiple historical/restored versions; deleting one logical reference must not remove another live version's bytes.
- **FR-20.09:** Record requested and completed disposal outcomes, recover interrupted cleanup safely, and release physical-byte usage only when removal actually occurs.
- **FR-20.10:** Clean expired staging, abandoned attempts, closed/expired batch history, enrollment receipts, completed operational history, and expired audit/idempotency records under distinct policies without deleting required identity mappings, provenance, or recovery evidence.
- **FR-20.11:** Expose that backup copies follow their own expiry policy; live-store deletion must not be described as immediate erasure of all retained backups.

**Available after this group:** A recoverable document product with controlled storage growth and disposal.

## Shared quality requirements

These requirements accompany the relevant functionality from its introduction and its ordinary quality checks. Numeric values and detailed operating rules are owned by [architecture.md](../architecture.md), including identity, format/processing contracts, durable jobs, limits, security, deployment, recovery, and distribution.

| ID | Requirement |
|---|---|
| NFR-01 | Deny unauthorized access across tenant/application/resource boundaries, including indirect metadata, snippets, counts, polling, artifacts, and signed transfers. |
| NFR-02 | Never issue normal read authority for unpublished, rejected, inconclusive, deleted, or otherwise unavailable content. |
| NFR-03 | Preserve immutable original bytes, stable document identity, monotonic version selection, and attributable source/result provenance. |
| NFR-04 | Remain consistent across retries, concurrent updates, duplicate/out-of-order delivery, interrupted processes, missed callbacks, and stale results. |
| NFR-05 | Bound request sizes, decoded content, storage/work reservations, processing resources, queue growth, and operational-history retention. |
| NFR-06 | Report incomplete extraction honestly; target word error rate at most 10% for clean printed English scans, with no claim of exact tables/handwriting or invented content. |
| NFR-07 | Target metadata p95 latency below 300 ms for the documented normal operating workload; distinguish API latency, original availability, processing duration, and search lag. |
| NFR-08 | Provide versioned, language-independent integration contracts and examples without consumer-repository or frontend-framework coupling. |
| NFR-09 | Operate on self-hosted infrastructure, including the documented offline data/update arrangements; isolate untrusted processing from credentials, external networks, and unrelated files. |
| NFR-10 | Support RPO at most 24 hours and RTO at most 4 hours for the documented small-profile operating volume/hardware, with compatible database/object recovery. |
| NFR-11 | Preserve effective access, security, lifecycle, and quota behavior during degraded operation, recovery, and supported upgrades. |
| NFR-12 | Keep the architecture maintainable through shared contracts, explicit module ownership, pinned dependencies, and bounded processor/configuration choices. |
| NFR-13 | Run the required commercial/self-hosted product without mandatory paid licenses or hosted subscriptions; meet applicable open-source distribution conditions for code, containers, native dependencies, fonts/codecs, signatures, language data, and models. |
| NFR-14 | Support the demand target of up to 200,000 documents/month under a declared format/page/size mix, OCR/structured share, processing window, arrival bursts, and resourced deployment; report API latency, original availability, queue age, processing delay, and search lag separately. |

Default file/page/output limits, capability lifetimes, scanner freshness, logical restore time, physical-disposal timing, and history retention remain as specified in [architecture.md](../architecture.md). A deployment configuration is not a measured capacity guarantee. Legal holds and regulated immutable retention remain outside v1.

## Deferred functionality and its dependencies

These are future scope options already identified by the product plan. They are not requirements for completing v1 and are not automatically scheduled after it. When an option is selected, its prerequisites below establish where it fits; options with unrelated prerequisites have no implied strict order between them.

| Future functionality | Depends on / relationship to the v1 capabilities |
|---|---|
| Multipart/resumable transfer and larger files | 06–09, 20; preserve reservation, immutable assessment, abandonment cleanup, and original safety |
| Formats beyond the accepted matrix, archive unpacking/import, industrial CAD/PLC interpretation, and additional OCR languages | 06, 09, 15–17; define explicit format/language/security behavior and bounds; listed Office/TIFF/email formats are already included |
| Structure beyond the enabled Docling profile and searchable PDF derivatives | 15–17; extend attributable artifact contracts; configured PDF/image layout/table output is already an opt-in v1 capability |
| Previews, thumbnails, and Office rendering | 09, 10, 17; additional formats/converters where required and safe preview access |
| Folders, inherited permissions, and configurable metadata schemas | 05, 12, 13; make inheritance/schema semantics explicit before exposing them |
| DMS end-user/group permissions, user delegation, arbitrary multi-issuer federation, and finer sharing | 01, 02, 13; extend the principal/access model; shared login and one configured external issuer are already supported |
| Signed webhooks, public event feeds, and packaged SDKs | 03, 08, 13; versioned consumer contracts, authorization, delivery/retry/signature behavior |
| Bulk migration/import/export and bulk metadata operations | 05–07, 12–14, 20; extend the already-included multi-file upload batches while preserving per-item authorization, quotas, and recoverable outcomes |
| Advanced ranking, multilingual relevance, facets, and historical text search | 16–18; explicit language/version visibility and bounded result semantics |
| Retention rules, legal holds, WORM storage, and governed disposal | 04, 11, 14, 20; governance must constrain deletion before regulated data relies on it |
| Classification, redaction, field extraction, embeddings, and document Q&A | 09, 13, 15–18; provenance, current authorization, quality limits, and untrusted-content boundaries |
| Check-out, approvals, electronic signatures, or other business workflows | 04, 11, 13; an explicit expansion of the current consumer-owned workflow boundary |
| Optional DMS management UI | The relevant administration/document APIs; consumer login/recovery screens and private operator tooling are already required |

Mandatory Kubernetes, microservices, new brokers/databases, and active-active regions are architectural changes, not missing v1 functionality.

## Scope coverage

| Blueprint scope area | Requirement groups |
|---|---|
| Shared identity, Thaarei enrollment, machine access, and integration | 01–03 |
| Registry, identity, metadata, tags, references | 05, 12 |
| Single-file/batch upload, download, binary versions | 06–11 |
| Tenant/application access and explicit sharing | 02, 13; applied throughout |
| File security and immutable publication | 06, 07, 09, 10 |
| Format/security matrix, text/spreadsheet/OCR/optional structure, and quality | 03, 06, 09, 15–17, NFR-06 |
| Asynchronous status, retries, durable events, reconciliation | 03, 08 |
| Search and permission-aware visibility | 18 |
| Audit | 04; capture accompanies every relevant capability |
| Delete, logical restore, physical disposal | 14, 20 |
| Quotas, self-hosting, administration, operations, recovery | 06, 08, 19, 20 |
| Performance, maintainability, isolation, and compatibility | Shared quality requirements throughout |
| Monthly demand and commercial/self-hosted distribution | 06, 08, 19, NFR-13, NFR-14 |

## Research basis for the ordering

The functional inventory comes from the accepted product blueprint. The sequence is a dependency analysis of that product, rather than a prescribed sequence from an external standard.

- Authentication/access limits precede transfer authority, and unassessed uploads stay isolated before ordinary retrieval. This follows the separation of upload authorization, content assessment, and storage controls in [OWASP file upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html).
- Default isolation accompanies every capability; explicit sharing is added only after ownership and retrieval exist. [OWASP authorization guidance](https://cheatsheetseries.owasp.org/cheatsheets/Authorization_Cheat_Sheet.html) supports default denial and checking every access path.
- Durable status/work precedes security and enrichment processing. HTTP acceptance does not mean completion, so consumers need a status resource and explicit outcomes. [HTTP asynchronous acceptance](https://www.rfc-editor.org/rfc/rfc9110.html#section-15.3.3)
- Work delivery must be distinguished from business completion; retries and duplicate-safe effects accompany processing from the start. [RabbitMQ acknowledgements and confirms](https://www.rabbitmq.com/docs/confirms)
- Shared user login and machine identity have different authority. Enrollment is an application-owned activation rule layered on the selected machine-token flow, not a second credential on every DMS request. [OAuth client credentials](https://www.rfc-editor.org/rfc/rfc6749.html#section-4.4), [Better Auth OAuth Provider](https://better-auth.com/docs/plugins/oauth-provider)
- Format identification, extraction, and useful structure differ. The expanded inventory follows the approved matrix rather than assuming a parser can fully interpret every detected file. [Tika format coverage](https://tika.apache.org/docs/4.2.x/formats.html), [Calamine](https://github.com/tafia/calamine), [Docling formats](https://docling-project.github.io/docling/usage/supported_formats/)
- Logical deletion/restoration and backup recovery rules precede physical disposal so recovery cannot depend on bytes already removed. Database backup/recovery remains a required product capability. [PostgreSQL backup and recovery](https://www.postgresql.org/docs/current/backup.html)

Security assessments, ordinary tests, and backup/restore correctness in these requirements concern the actual product. The build sequence begins with capability 01 and proceeds directly toward the complete v1 solution.

## Revision history

| Revision | Change |
|---|---|
| v1.0, 2026-10-30 | Initial sequenced inventory aligned with blueprint v1.2 |
| v1.1, 2026-10-31 | Aligned with blueprint v1.3: shared identity, Thaarei enrollment, batch uploads, expanded text/data/OCR/optional-structure behavior, durable-work ownership, monthly demand, and commercial OSS distribution; retained existing IDs |
| v1.2, 2026-10-31 | Updated architecture ownership/references after consolidation into root architecture.md; requirement IDs, functionality and ordering unchanged |
