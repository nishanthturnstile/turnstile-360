# Headless Document Management Platform

## Product Blueprint v1.5

**Updated:** 2026-10-31

**Status:** Accepted product baseline. Technical architecture is maintained in [architecture.md](../architecture.md).

**Scope of this update:** Technical architecture, stack, contracts, limits, security, deployment, and recovery design moved into the root architecture reference. Product promise, scope, correctness requirements, and decision history remain here. No functionality or selected policy changes.

**Product:** A headless, reusable, self-hostable Document Management System (DMS) API.

**Company:** Thaarei.

**Demand target:** Up to 200,000 documents per month; capacity depends on the declared file/page mix, OCR share, arrival bursts, and processing window.

## 0. Decision status and how to use this document

This document owns the accepted product promise and scope. [architecture.md](../architecture.md) owns the complete DMS/Turnstile technical architecture, components, stack, contracts, and configured defaults. The [sequenced functionality and requirements](headless_dms_functionality_requirements_v1.md) define what to build and its dependency order. The existing filename and numbered technical-section headings are retained for existing links; those sections now point to the architecture reference.

- **Selected:** The v1 product scope below and technical decisions in [architecture.md](../architecture.md).
- **Configured defaults:** [Architecture limits and targets](../architecture.md#limits-admission-control-and-performance) are explicit starting policies, not measured capacities or service guarantees.
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
| Formats | PDF; approved common images; UTF-8 text/CSV/TSV; Word/PowerPoint/OpenDocument/RTF; Excel/OpenDocument spreadsheets; EML/MSG, as specified in the [format matrix](../architecture.md#supported-format-and-capability-matrix) |
| Languages | English OCR; additional languages are a future scope extension with language-specific quality requirements |
| Search | Authorized current-version metadata/text search using PostgreSQL |
| Async contract | Poll upload, version, and processing status; internal durable events |
| Lifecycle | Soft delete, restore window, reference-aware garbage collection, audit |
| Operations | Quotas, admission control, bounded workers, reconciliation, failure recovery, backups, self-hosted installation, and distribution/license records |

PDF support includes native, scanned, and mixed-page documents within configured limits. Format support distinguishes storage, security assessment, text extraction, structured extraction, and preview generation; detection alone does not establish any of these capabilities. The [architecture format matrix](../architecture.md#supported-format-and-capability-matrix) defines support. Password-protected/encrypted, malformed, or unassessable files and nested content are rejected or remain inconclusive and unpublished. A scan pass is a policy result, not a guarantee that a file is harmless.

The product does not promise universal extraction from every industrial file. An additional proprietary format may be enabled for storage-only use only when its security policy and bounded assessment can be fulfilled. Unsupported or unassessable content does not become published merely because extraction is disabled. Editing Office content in place, executing macros, recalculating spreadsheets, and proprietary CAD/PLC interpretation are outside v1; replacing a document means uploading a new immutable version.

Metadata is a size-limited JSON object with scalar values and bounded scalar arrays. There is no tenant-defined schema engine, arbitrary query language, or automatic indexing of every metadata key in v1. Promote frequently queried fields to explicit supported filters.

### Deferred until a consumer demonstrates the need

- Multipart/resumable uploads and larger file limits; v1 returns a clear size-limit error rather than exposing unimplemented multipart endpoints.
- Archive unpacking/import, HTML/SVG rendering, proprietary industrial-format interpretation, and other formats outside the [approved format matrix](../architecture.md#supported-format-and-capability-matrix).
- Searchable PDF derivatives, previews, thumbnails, and structural extraction beyond the configured Docling profile.
- Folders with inherited permissions, DMS end-user/group ACLs, arbitrary multi-issuer federation, and user token exchange/delegation.
- Signed webhooks, public event feeds, packaged SDKs, bulk import/export, and advanced multilingual relevance.
- Legal holds, immutable/WORM retention, governed disposal, electronic signatures, and business approval workflows.
- Semantic search, embeddings, document Q&A, classification, and generative field extraction.
- DMS management UI, microservice decomposition, a general workflow engine, mandatory Kubernetes, and active-active regions. Consumer login/recovery screens and supported operator tooling remain required.

A regulated launch requiring deferred governance features changes the release scope before customer data is accepted. Soft-delete grace periods are operational recovery policies, not legal retention.

## 3. Selected architecture and technology

The technical design is maintained in [architecture.md — Selected architecture and technology](../architecture.md#selected-architecture-and-technology).

## 4. Module and contract boundaries

The technical design is maintained in [architecture.md — Module and contract boundaries](../architecture.md#module-and-contract-boundaries).

## 5. Tenancy, identity, and authorization

The technical design is maintained in [architecture.md — Tenancy, identity, and authorization](../architecture.md#tenancy-identity-and-authorization).

## 6. SeaweedFS storage and upload protocol

The technical design is maintained in [architecture.md — SeaweedFS storage and upload protocol](../architecture.md#seaweedfs-storage-and-upload-protocol).

## 7. Independent state machines and security coverage

The technical design is maintained in [architecture.md — Independent state machines and security coverage](../architecture.md#independent-state-machines-and-security-coverage).

## 8. Versioning, deletion, and retrieval rules

The technical design is maintained in [architecture.md — Versioning, deletion, and retrieval rules](../architecture.md#versioning-deletion-and-retrieval-rules).

## 9. Processing, provenance, and AI readiness

The technical design is maintained in [architecture.md — Processing, provenance, and AI readiness](../architecture.md#processing-provenance-and-ai-readiness).

## 10. Domain data and consistency constraints

The technical design is maintained in [architecture.md — Domain data and consistency constraints](../architecture.md#domain-data-and-consistency-constraints).

## 11. Public API and consumer contract

The technical design is maintained in [architecture.md — Public API and consumer contract](../architecture.md#public-api-and-consumer-contract).

## 12. Durable jobs, events, and reconciliation

The technical design is maintained in [architecture.md — Durable jobs, events, and reconciliation](../architecture.md#durable-jobs-events-and-reconciliation).

## 13. Limits, admission control, and performance

The technical design is maintained in [architecture.md — Limits, admission control, and performance](../architecture.md#limits-admission-control-and-performance).

## 14. Search and content visibility

The technical design is maintained in [architecture.md — Search and content visibility](../architecture.md#search-and-content-visibility).

## 15. Security and privacy controls

The technical design is maintained in [architecture.md — Security and privacy controls](../architecture.md#security-and-privacy-controls).

## 16. Self-hosted packaging and scale path

The technical design is maintained in [architecture.md — Self-hosted packaging and scale path](../architecture.md#self-hosted-packaging-and-scale-path).

## 17. Backups, recovery, and controlled disposal

The technical design is maintained in [architecture.md — Backups, recovery, and controlled disposal](../architecture.md#backups-recovery-and-controlled-disposal).

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

Thaarei-owned software and documentation remain confidential and proprietary under the
root [LICENSE](../LICENSE). The complete selected-component licensing and distribution
policy is maintained in [architecture.md — Ownership and distribution](../architecture.md#ownership-and-distribution).

### Deployment inputs

These inputs configure deployment and future scope without reopening the selected defaults or blocking the start of actual implementation:

1. Consumer-specific format restrictions and future extensions beyond the accepted matrix, non-English OCR, or additional structured/business fields.
2. The file/page/size mix, OCR/structured share, processing window, peak arrivals/transfers, tenants/applications, retention/growth, and acceptable processing delay for the known 200,000-document monthly target.
3. Host/storage/network resources, default Better Auth or configured external issuer, backup destination, and actual recovery/availability budget.
4. Customer/support terms, residency, and governance constraints; Thaarei's application source is proprietary, and dependency/model packaging follows the no-mandatory-paid-license policy above.

Use this product scope and the [architecture defaults](../architecture.md#limits-admission-control-and-performance) until deployment-specific values are supplied. Measured capacities remain unclaimed. A requirement outside the frozen v1 receives an explicit scope change rather than silently entering the first release.

| Revision | Decision |
|---|---|
| v1.0 | Proposed architecture and independent-review questions |
| v1.1, 2026-10-30 | Owner accepted review recommendations; SeaweedFS explicitly selected; fixed v1 access/scope/stack; added scan coverage, immutable publication, concurrency/fencing, delivery routing, admission, and recovery/GC |
| v1.2, 2026-10-30 | Owner selected direct implementation; removed preliminary discovery work and phased execution roadmap; added the separate sequenced functionality and requirements document |
| v1.3, 2026-10-31 | Owner accepted Celery/RabbitMQ, Better Auth/OAuth Provider, expanded format/batch/structured requirements, 200,000 documents/month demand, commercial OSS distribution policy, and the corrected company name Thaarei; supersedes earlier scope/stack defaults where changed |
| v1.4, 2026-10-31 | Owner selected NestJS/Fastify, Biome, Linux/Dokploy, and separate Turnstile Vite/React frontend/backend in the monorepo; recorded bounded workspace setup before feature implementation |
| v1.5, 2026-10-31 | Consolidated technical architecture in root architecture.md; retained product scope, stable numbered navigation, correctness, and decision history without changing selected behavior |

## 20. Official implementation references

Technical sources are maintained in [architecture.md — Official implementation references](../architecture.md#official-implementation-references).
