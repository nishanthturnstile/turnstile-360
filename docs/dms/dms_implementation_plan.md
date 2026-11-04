# Standalone DMS implementation plan

**Date:** 2026-11-04. **Owner:** Thaarei. Confidential and proprietary.

**Status:** Proposed delivery plan for the accepted DMS v1 scope and the owner's explicit
standalone/API-testing requirement. This file does not establish implementation or
deployment completion. Actual work, checks and handoffs belong in
[IN_PROGRESS.md](../../IN_PROGRESS.md). The owner's references to “EMS” in this request are
interpreted as DMS; this plan does not introduce a separate EMS product.

## 1. Outcome and sources of truth

Deliver a headless document service that can be installed, administered, tested and used
without either Turnstile application. A backend in another repository or language must
be able to register, enroll, obtain machine tokens and use all implemented document
capabilities over documented HTTP. Swagger UI supplies interactive API exploration;
supported private tools supply operator provisioning and recovery. Neither requires a
DMS management frontend.

Use these documents together; do not copy their technical defaults into competing tables:

| Reference                                                                      | Owns                                                                                  |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------- |
| [Product blueprint](headless_dms_product_blueprint_v1.md)                      | Accepted v1 promise, included and deferred scope                                      |
| [Functionality requirements](headless_dms_functionality_requirements_v1.md)    | FR-01–20, NFR-01–14 and functional dependencies                                       |
| [Architecture](../../architecture.md)                                          | Components, contracts, stack, policy values, security, deployment and recovery design |
| [Authentication plan](../authentication/authentication_implementation_plan.md) | Existing AUTH-01–07 foundations and their acceptance                                  |
| [Workspace standards](../standards/workspace.md)                               | Toolchain, boundaries and required checks                                             |
| This plan                                                                      | Delivery packages, dependency gates, standalone integration and verification          |

Standalone is a deployment and consumer-independence property. It still needs its
configured authority, database, storage and processing services. It does not mean one
executable, anonymous access, a browser holding application secrets, a second customer
tenant, or a new service architecture.

## 2. Baseline verified by source inspection

The 2026-11-04 inspection found the following. Existing runtime evidence is recorded in
the progress tracker; it was not rerun merely by writing this plan.

| Area                 | Present today                                                                                                                                                           | Remaining for this plan                                                                                                   |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| DMS API              | Nest/Fastify process, persisted Better Auth authority, private account/client tools, machine verifier, guarded enrollment, local disablement and bounded security audit | Complete resource API, resource authorization, document audit and independent packaging                                   |
| Public contracts     | Strict Zod enrollment/capability/error schemas; generated `docs/api/dms-auth.openapi.json`; server-only typed client                                                    | Feature schemas, pagination/revisions/retries, complete examples, private contract separation and cross-language fixtures |
| Capability discovery | Only enrollment and capability read; one DMS scope; empty format/profile/language arrays                                                                                | Expand only alongside verified implementations and installed profiles                                                     |
| Domain modules       | Documents, uploads, storage, policies, processing, search and lifecycle are reserved module shells                                                                      | Feature services, owning persistence, migrations and runtime behavior                                                     |
| Python               | Installable identification CLI, Ruff/mypy/pytest tooling; no runtime processing dependencies                                                                            | Publisher, Celery execution, job/transfer clients, processors and sandbox supervision                                     |
| Infrastructure       | Pinned PostgreSQL/RabbitMQ/SeaweedFS/Mailpit local definitions                                                                                                          | Authenticated storage integration, broker routing, scanner/parser services and complete production profile                |
| Images               | DMS runtime image already builds an isolated `pnpm deploy --prod` package                                                                                               | Coordinator entrypoint and complete independently installable service set                                                 |
| Manual API docs      | Generated authentication OpenAPI artifact                                                                                                                               | Served public schema and locally bundled Swagger UI; no interactive UI is installed                                       |

Specific standalone gaps must be closed rather than hidden behind new examples:

1. `authority-configuration.ts` requires a login callback and fixed application-origin
   paths; `authority-options.ts` points login/consent at `/sign-in`. The current local
   authority origin is served through Turnstile web routing. DMS-only installation needs
   canonical authority/discovery/token routing and private administration without those
   applications. Machine-only use must not require a functioning user callback page.
2. Login-client operator policy currently uses one configured callback. Independent
   machine consumers are the required first path; if another consumer also chooses the
   shared user authority, register its exact login/logout destinations through supported
   per-client policy. Do not assume Turnstile's recipient identity API is a generic IAM UI.
3. `scripts/provision-auth-database.mjs` currently requires auth, DMS and Turnstile role
   credentials together. Add an explicit DMS-only provisioning selection with auth/DMS
   roles and no product schema, while preserving existing full-workspace behavior.
4. `deploy/compose.dokploy.yaml` describes three JavaScript applications and omits the
   full stateful/processing profile. A selective service start is not yet a verified,
   complete standalone installation package.
5. The DMS auth generator supports `--check`, but root `check:contracts` currently invokes
   the other feature generators. Include DMS artifact drift and route coverage explicitly.
6. The Fastify global control-body limit is currently 16 KiB. Apply route-specific bounded
   envelopes for metadata plus control fields and the accepted larger batch manifest;
   do not globally permit file bodies or inadvertently reject valid configured metadata.

## 3. Product and integration boundaries

The DMS control plane is `apps/dms-api`: public control APIs, separate private job APIs,
and shared authority modules. Its future coordinator is another process composition
from the same TypeScript image. `apps/dms-processing` supplies the Python publisher and
workers. A separate control-plane management application is outside this plan.

Each installation has one tenant and multiple separately registered applications.
Applications have their own credentials, source namespaces, scope ceilings, policies and
document ownership. Same-customer applications have no implicit access to each other's
documents. Another customer gets a separate installation.

The integration sequence for any independent backend is:

1. Operator explicitly bootstraps the installation and verifies an operator account.
2. Operator provisions a distinct machine client and pending DMS registration, with
   least scopes and a bound one-time enrollment key delivered through protected files.
3. The backend obtains a short-lived DMS-audience client-credentials token and enrolls
   using the key plus idempotency contract. Normal requests thereafter need no key.
4. The backend checks its user's business rights, calls `/v1` with its machine token and
   gives the client only the narrowly scoped file-transfer capability it needs.
5. File bytes move directly to/from controlled SeaweedFS ingress; completion and polling
   use the backend/DMS HTTP contract. PostgreSQL owns accepted state.

The TypeScript DMS client is optional consumer convenience. Ship HTTP/curl and a small
Python-standard-library backend example that use no workspace imports. Examples are
integration aids, not a promise of published multi-language SDK packages. Consumers must
not import DMS source or databases. Turnstile roles, units, setup state, invitations and
product migrations cannot be prerequisites for a DMS operation.

User sessions and machine authority remain separate. Preserve Turnstile's current
login/recovery/recipient contracts during configuration changes. For consumers choosing
shared user login, supply the authority integration contract and consumer-owned screens;
standalone machine use requires only private operator account/recovery tooling. Complete
the accepted single-configured-external-issuer alternative before claiming that deployment
option supported; arbitrary federation and user delegation remain deferred.

Tenant-operator document powers use a separate **private command interface**, established
in I01/I03 and extended by each owning feature. Commands authenticate a freshly verified
authority identity, then check an explicit active DMS operator authorization bound to the
installation tenant. Authority-admin status alone, a consumer token, a browser session
or caller-supplied tenant ID does not grant document administration. Bootstrap the first
DMS operator only through an explicit private installation command with separately held
maintenance authority and fresh verified administrator proof. Subsequent assignment,
revocation and recovery use supported audited private commands. Credentials/proof stay
in protected input channels; commands invoke owning use cases with an attributed operator
context and narrowly scoped database privileges, never an unrestricted SQL console.
No operator endpoint or command is exposed through the consumer Swagger UI. This supplies
tenant administration without introducing DMS end-user/group ACLs or a management UI.

## 4. Libraries and services

These are inspected pins, not a request to upgrade dependencies. Manifests, lockfiles and
image digests remain authoritative. Add dependencies with their owning capability and
record exact versions, transitive/native artifacts, licenses and checksums there.

| Layer          | Installed/pinned now                                                            | Delivery decision                                                                           |
| -------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| JS toolchain   | Node 24.21.0, pnpm 12.16.1, TypeScript 6.0.3, Biome 2.6.4                       | Retain workspace pins and ESM/runtime packaging                                             |
| API            | Nest packages 12.3.2, Fastify 5.12.7                                            | Retain Fastify-compatible integrations and CLI scaffolding                                  |
| Identity       | Better Auth, OAuth Provider and Drizzle adapter 1.7.14; jose 6.2.14             | Reuse authority/token machinery; preserve separate user/machine/internal identities         |
| Persistence    | Drizzle ORM 0.45.4, Drizzle Kit 0.31.11, pg 8.23.1                              | Owning migrations, transactions, constrained roles and forced tenant RLS                    |
| Schemas        | Zod 4.6.7                                                                       | Generate JSON Schema/OpenAPI from the executable contracts; avoid duplicate DTO definitions |
| Verification   | Vitest 4.1.2 in API, Playwright 1.64.1 in workspace                             | Focused unit, real component integration and independent-browser/manual-doc tests           |
| Python         | Image Python 3.13.18; uv/uv_build 0.13.6; locked development tools              | Add runtime dependencies under uv with reproducible frozen installation                     |
| Infrastructure | Pinned PostgreSQL 18.6, RabbitMQ 4.3.7, SeaweedFS and Mailpit images in Compose | Verify actual storage/broker behavior; local definitions do not prove production readiness  |

Selected architecture components that are **not installed DMS runtime features today**:

| Capability              | Selected implementation                                                     | Introduction gate                                                                 |
| ----------------------- | --------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| S3 control/signing      | AWS SDK for JavaScript S3 client and presigner                              | DMS-I04: exact SeaweedFS condition/length/proxy tests                             |
| Interactive docs        | Proposed `@fastify/swagger` static-document mode plus `@fastify/swagger-ui` | DMS-I02: pin compatible Fastify/OpenAPI 3.1 versions and prove packaged UI assets |
| Work dispatch/execution | Python Celery with RabbitMQ; no Celery result backend                       | DMS-I07: confirmed routing, bounded retries and fenced private APIs               |
| Security scan           | Separate ClamAV daemon and signature-update tooling                         | DMS-I08: complete coverage, freshness and isolation                               |
| PDF/image/OCR           | pypdfium2/PDFium, Pillow, Tesseract and pinned English data                 | Security bounds in I08, extraction/OCR in I14–15                                  |
| Office/email            | Isolated Apache Tika forked-JVM runtime; Tika OCR disabled                  | Bounds/coverage in I08, extraction in I14                                         |
| Spreadsheet             | python-calamine/Calamine; standard-library CSV                              | Structural bounds in I08, attributable data extraction in I14                     |
| Optional structure      | Docling with approved pinned models/data and dependencies                   | DMS-I16: opt-in enabled-profile acceptance and offline packaging                  |
| Search                  | PostgreSQL FTS/GIN and pg_trgm for title/name                               | DMS-I17: live authorization inside queries and index-generation checks            |
| Observability           | Structured telemetry and selected OpenTelemetry instrumentation             | DMS-I18: private, bounded diagnostics; no mandatory hosted backend                |

Prefer the existing schema-driven OpenAPI generator over a second decorator-driven
schema source. Swagger tooling should serve that generated artifact. Its exact package
versions are selected and tested during I02, not guessed in this planning document.
If static serving cannot preserve the required 3.1 schemas, resolve that implementation
choice before enabling the UI; do not silently downgrade the public schema dialect.

Preserve the proprietary root LICENSE and notices. Keep the accepted RabbitMQ/ClamAV
service-license treatment and complete native/JVM/codec/font/OCR/model inventory. No
mandatory paid services, unapproved noncommercial models, PyMuPDF/Ghostscript pipeline,
additional broker/search database, or public SDK release is introduced by this plan.

## 5. Standalone packaging and API explorer

### Installation profiles

Provide an explicit standalone Compose/environment/runbook path alongside the existing
combined workspace. The precise filenames are implementation deliverables, not existing
commands. Build contexts stay at the monorepo root; runtime artifacts must exclude
Turnstile code, dependencies, configuration and schema ownership.

| Profile                   | Required acceptance                                                                                                                                                                                                               |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DMS foundation            | DMS API/shared authority, PostgreSQL and configured mail transport; docs enabled only for controlled access. Prove bootstrap, token, enrollment and capability-read without Turnstile. No document capability claim.              |
| Secure document increment | Add authenticated SeaweedFS, coordinator, publisher, RabbitMQ, scan workers, isolated assessment runtimes and ClamAV/signature updates. Prove secure upload/publication/download. This is an intermediate increment, not full v1. |
| Full standalone v1        | Add ordinary/heavy extraction, OCR, lifecycle/search/maintenance, complete recovery and operational packaging. Optional structured services activate only when installed and enabled.                                             |

Dokploy owns production ingress/TLS; do not deploy a competing ingress stack. Route the
configured authority discovery/token/JWKS and DMS endpoints directly to DMS without a
Turnstile proxy. Give transfer ingress an authenticated S3 route. Job APIs, broker,
database, scanner, parser and non-S3 storage surfaces remain private.

Local manual service bindings stay within the fixed architecture reservation. Serve
documentation through DMS's existing 23601 listener; no extra host port is needed. For a
new DMS-only local installation, select a canonical authority origin reachable directly
on that listener and register it consistently. Preserve the existing installation's
issuer, credentials and data. Changing its public issuer is a separate coordinated
operator migration, never an incidental development fallback.

### Swagger/OpenAPI contract

Proposed explorer routes are `/docs` and `/docs/openapi.json` on the DMS listener, outside
the business `/v1` prefix. Freeze those paths in architecture during I02. Serve bundled
local assets with no CDN or remote validator. Use one generated public OpenAPI 3.1
artifact, stable operation IDs, explicit error/status/header examples and a relative
`/v1` server URL or validated deployment-origin configuration.

The public document contains only implemented consumer endpoints. Keep private
job/dispatch, operator and identity-service contracts in distinct artifacts and exports;
do not publish them through the consumer explorer. During development, planned routes
remain in this plan/architecture rather than executable consumer documentation.

Manual authorization uses a token obtained through a protected backend/CLI command and
pasted into Swagger's bearer field. Never embed or ask Swagger to retain a client secret.
Keep authorization in page memory, clear it on reload, disable persistence and external
validation, and keep tokens/capabilities out of logs, analytics and saved examples.
Enrollment stays documented, but its one-time key is supplied through the supported
CLI/backend recipe rather than a browser enrollment-key workflow. Disable its browser
execution control. Provide a clear protected-command route from “new installation” to
“enrolled token ready for Swagger.”

Production docs are off by default and may be enabled behind explicit operator access
controls. Protect UI, schema, configuration and asset endpoints together. In local mode,
use the loopback-only listener; remote binding requires the controlled deployment policy.
Explorer access does not replace endpoint authorization. CSP must permit only the
locally bundled UI resources and configured API, without broad unsafe origins.

Swagger exercises JSON control operations; file bytes remain a direct signed PUT/GET.
Provide a tiny local HTML/JavaScript transfer example plus CLI recipe to test those bytes
without Turnstile. The example calls an independent backend for control authorization,
holds no service credentials and uses the exact signed headers. Browser JavaScript must
not attempt to set forbidden `Content-Length`; the browser's actual known-size upload
must satisfy the signed length and CORS contract. Swagger request snippets containing
tokens are sensitive session output and must not be saved as release evidence.

## 6. Delivery dependency map

Each package includes relevant contracts, behavior, audit, focused tests and operator
documentation. Do not create all future tables up front. Migrations are delivered with
their owning implemented feature. Dependency entries below are delivery gates, not
permission to relax the requirements' functional prerequisites.

| Package                                              | Depends on                          | Requirement groups                     | Exit gate                                                                                                |
| ---------------------------------------------------- | ----------------------------------- | -------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| DMS-I01 Standalone foundation                        | Existing AUTH foundations           | 01–02; 19 baseline                     | DMS-only bootstrap/operator policy, independent machine and user-login flows; no Turnstile dependency    |
| DMS-I02 Contracts and explorer                       | I01                                 | 03; NFR-08/12                          | Generated public docs, private separation, protected Swagger and HTTP-only example pass                  |
| DMS-I03 Persistence/access/audit foundations         | I01–02                              | 02, 04                                 | Owning transactions, tenant/operator isolation, private admin commands and audit retrieval pass          |
| DMS-I04 Authenticated storage adapter                | I02                                 | 06–07, 09–10 storage primitives        | Real SeaweedFS conditional/length/credential/ingress contract passes                                     |
| DMS-I05 Registry, policy and admission               | I03–04                              | 05–06                                  | Candidate identity and concurrent capacity accounting are authoritative                                  |
| DMS-I06 Upload sessions and batches                  | I05                                 | 07                                     | Single PUT, replay, expiry and independent per-item outcomes pass; bytes remain unpublished              |
| DMS-I07 Durable coordination and workers             | I03, I06                            | 08; 02 internal roles                  | Jobs/outbox, routing, leases/fences and bounded recovery pass over real HTTP/broker                      |
| DMS-I08 Security and publication                     | I04, I07                            | 09; 06 format limits                   | Only exact fully assessed bytes publish; scanner/parser failures remain unavailable                      |
| DMS-I09 Original retrieval                           | I08                                 | 10                                     | Independent consumer securely uploads, polls and retrieves original                                      |
| DMS-I10 Versions and historical restore              | I09                                 | 11                                     | Concurrent/out-of-order versions and reassessed restore preserve current identity                        |
| DMS-I11 Metadata and references                      | I03, I05                            | 12                                     | Bounded revision-checked metadata and namespaced references pass                                         |
| DMS-I12 Application sharing                          | I09–11                              | 13; 02                                 | Second independent application receives only explicit granted rights                                     |
| DMS-I13 Logical deletion and restoration             | I07, I10, I12                       | 14                                     | Lifecycle generations stop stale work and preserve bounded restoration                                   |
| DMS-I14 Native/Office/tabular/email extraction       | I08, I13                            | 15                                     | Format-routed bounded extraction has honest source-unit coverage                                         |
| DMS-I15 English OCR                                  | I14                                 | 16                                     | Native/scanned/mixed PDF and approved image cases meet coverage/quality gates                            |
| DMS-I16 Results, reprocessing and optional structure | I10, I14–15                         | 17                                     | Accepted result/artifact provenance, generation promotion and enabled structured profile pass            |
| DMS-I17 Authorized search                            | I11–13, I16                         | 18                                     | Current live eligibility filters all hits/snippets/counts; generation replacement is atomic              |
| DMS-I18 Operations and production packaging          | I01–17; incremental work throughout | 19; remaining 01–02 deployment options | Complete offline-aware self-hosted profile, supported authority options and diagnostics pass             |
| DMS-I19 Backup, recovery and physical cleanup        | I10, I13, I16, I18                  | 20                                     | Coherent off-host backup restore and reference/recovery-aware disposal pass                              |
| DMS-I20 Independent qualification and release        | I01–19                              | FR-01–20; NFR-01–14                    | Full standalone and combined regressions, documented operating mix, upgrade/recovery and target evidence |

I04 can run alongside I03 after the contracts are frozen. I11 can run alongside the
durable/security path after I05. Operational packaging, dependency inventory and backup
design begin early; full operations/recovery acceptance follows their listed dependencies.
Do not postpone all backup work until after real documents are accepted.

## 7. Package implementation and acceptance detail

### DMS-I01 — Standalone foundation

**Deliver:** DMS-only configuration and explicit role/provision/migration selection;
authority routing independent of web proxies; supported arbitrary machine-client names
and stable registration identities; distinct publisher/scanner/extractor policies reserved
for implementation; clean installation/operator runbook. Remove mandatory unused product
callback/client settings from machine-only startup through an explicit validated mode.
Preserve exact configured issuer/audience rules and existing combined-mode defaults.
Implement the independent shared-authority integration with approved per-client
login/consent entry and redirect/logout destinations, plus verification/reset return
policy. Replace the fixed authority-origin `/sign-in` assumption with validated
consumer-owned screens and server-held authorization continuation bound to the registered
client and transaction. Preserve code/PKCE, state/nonce and managed skip-consent policy;
unregistered destinations and arbitrary return URLs fail. Login screens and authority
credential handling keep their existing trust boundary; no credential forwarding through
DMS document endpoints. Define the private operator authentication/bootstrap/assignment/
revocation contract from section 3; document attribution, fresh-proof checks, tenant
binding and separately held maintenance recovery before any document admin command ships.

**Accept:** Install into a disposable auth/DMS database with no Turnstile schema,
environment, container or package import. Verify operator bootstrap is repeat-safe and
rejects another tenant; provision two differently named external consumer clients and
enroll them independently. Verify identity discovery/token/JWKS, audience/scopes,
disablement, rotation and account recovery tooling without `/sign-in` being served by
Turnstile. A minimal external-consumer browser/backend fixture, with no Turnstile
service, proves code-with-S256-PKCE sign-in, safe login/consent continuation, verified
account and reset-link returns, logout, expiry/revocation and recovery. Reject unregistered
login/redirect/logout/verification/reset destinations and stale or substituted transaction
state. This fixture is test/example infrastructure, not a new production application.
Prove first-operator private bootstrap and denial without its required maintenance and
fresh-identity proof. Preserve current combined-auth and recipient regressions. No new
client or schema is silently created on ordinary API startup.

### DMS-I02 — Contract growth and manual testing

**Deliver:** Public/private schema export boundaries, public OpenAPI artifact/generator,
drift checks, route-to-operation/security coverage, finite error families, request IDs,
retry/polling headers, revision and idempotency conventions, protected bundled Swagger,
curl/Python external-backend examples and the manual operator-to-token recipe. Retain
compatibility of existing authentication artifacts or document an intentional transition.
Select and pin any 3.1 schema validators needed for TypeScript/Python fixture parity.

**Accept:** Run the explorer from the isolated runtime image, obtain a token outside the
browser and call capability read. Missing/wrong/expired tokens fail normally. Reload
clears authorization; no external asset/validator request or private route leaks occur.
Automatic checks cover DMS schema drift, unique operation IDs, references, examples,
headers and runtime route/security parity. “Try it out” never becomes a bypass.

### DMS-I03 — Owning persistence, access and audit

**Deliver:** Extend existing owning DMS persistence instead of introducing unrelated
request pools; define transaction-scoped principal/tenant context and narrowly privileged
coordinator/maintenance access. Keep auth and DMS schema ownership separate. Define
resource-policy interfaces used by every subsequent route. Extend the bounded audit
model and implement the authorized audit surface as its resources become available;
freeze its route in architecture and generated contracts. Implement the private operator
interface defined in section 3: persisted tenant-bound DMS operator authorization,
supported assignment/revocation/recovery, fresh authority identity verification, a distinct
operator execution context and auditable paginated operator reads. Public consumer audit
reads retain machine/resource policy. Auth authority administration must not implicitly
create a DMS operator. Extend the operator command registry only with implemented owning
features; private contract artifacts remain separate from consumer OpenAPI.

**Accept:** Real PostgreSQL role/RLS tests reject cross-tenant references and request-role
privilege escalation. Transaction rollback also rolls back state-change audit and outbox
intent. Pooled requests cannot inherit previous context. Related owner/admin sees only
authorized bounded audit; another application cannot see it. Audit records contain no
file/text/secret/capability material and distinguish application-asserted human context.
An authorized operator can read the installation's permitted document audit through the
private command; revoked operators, authority admins lacking a DMS operator grant,
ordinary consumers, publisher/scanner/extractor identities and browser/user tokens cannot
exercise that power. Verify tenant binding, current authorization and attribution on every
command, including retries. Operator assignment/revocation is itself audited.

### DMS-I04 — Storage boundary

**Deliver:** S3 adapter, explicit endpoint/signature style, separate staging/original/
artifact credentials and buckets, restricted ingress/CORS, immutable snapshot primitive,
exact-key cleanup and integration fixtures using the pinned SeaweedFS image. No parser
or browser receives general storage credentials.

**Accept:** Exercise signed exact length and content type, create-only `If-None-Match`,
HEAD/read-after-write, source-ETag-conditional copy to a fresh private key, range GET,
expiry and deletion. Test unsigned header/query injection, ACL/vendor extensions,
anonymous access, bucket enumeration and direct non-S3 bypass. Real browser, Node and
Python transfer tests must agree. If selected storage/proxy cannot enforce a required
primitive, stop that capability and resolve the incompatibility explicitly; no overwrite,
unbounded upload or post-upload-only size check is an acceptable substitute.

### DMS-I05 — Document registry and admission

**Deliver:** Stable logical/candidate identities and version allocation, lifecycle/revision
baseline, versioned policy/capability projection, transactional reservations and measured
usage. Allocate documents through the upload-begin use case; a batch manifest alone
creates none. Prepare bounded storage/scratch/backlog admission and per-app fairness.

**Accept:** Concurrent admissions cannot spend the same capacity twice; a failed or
replayed operation cannot leak reservations or duplicate identities. Records without an
available version never receive downloads/search eligibility. Request limits account for
control envelope overhead and configured metadata/batch bounds. Capability discovery
exposes effective installed/enabled behavior, not merely recognized file extensions.

### DMS-I06 — Upload and batch lifecycle

**Deliver:** Begin/status/complete/refresh/cancel routes and bounded batch create/status/
close/cancel with per-item ordinary sessions. Persist request hashes and retry receipts;
use current access on retries/refresh. Document exact single-PUT transfer headers and
the separate upload/security/availability states.

**Accept:** Identical retries preserve operation identity; changed bodies conflict.
Ambiguous PUT does not overwrite and can be inspected. Completion returns accepted
intent, not a publication pass. Session expiry/cancellation wins consistently against
completion; batch close races do not create hidden items or undo published files. Mixed
batch failures remain per-file outcomes. No multipart/resume/archive-import claim exists.

### DMS-I07 — Authoritative work and private execution

**Deliver:** Coordinator process entrypoint from the DMS image; persisted jobs, attempts,
outbox, deadlines and leases; versioned dispatch/job/result schemas; separate private
HTTP audiences/scopes and network paths; Python Celery publisher and fixed tasks. Add
the processing image's locked runtime installation so Celery/native dependencies are
actually present, rather than merely building an application wheel.

**Accept:** Real RabbitMQ durable queues/messages, mandatory routing, returned-message
handling and confirms cover initial and retry publication. Crash before delivery receipt
can duplicate transport but never accepted effects. Concurrent claims, worker loss,
stale lease, lost retry and missed completion callback recover from PostgreSQL under one
persisted execution budget. Celery owns normal retries; reconciliation recovers only
after the authoritative deadline/grace. JSON-only messages, no result backend, bounded
prefetch/concurrency and no public access to job/dispatch routes. Scanner and extractor
identities cannot impersonate each other's result authority.

### DMS-I08 — Assessment, isolation and publication

**Deliver:** Server-owned snapshot selection, authoritative streamed SHA-256/type,
fresh-signature ClamAV integration, coverage evidence, format-policy inspection in bounded
isolated runtimes, quarantine and atomic publication/audit/outbox. Security parsers are
needed here even when extraction is delivered later. Stage the format matrix explicitly;
advertise only families with fully implemented assessment.

**Accept:** Malicious fixtures, hash/size/type mismatch, macros, encrypted or malformed
files, unsupported embedded content, nested expansion, sparse spreadsheet ranges,
pixel/page limits, scanner outage/staleness and timeouts never become a pass. Scan the
protected candidate and publish that same object without a second mutable copy. Enforce
process/container isolation, restricted mounts, no inherited application secrets or
parser network egress, CPU/memory/scratch/output/time limits and controlled supervision.
An extraction-role result cannot assert security approval. Later invalidation closes all
original/derived reads across every version sharing the object. Existing valid originals
survive enrichment outages.

### DMS-I09 — Authorized download and first usable increment

**Deliver:** Download capability issuance with live ownership/grants, lifecycle, version
and security checks; explicit historical selection when history becomes available; safe
filename/disposition, short lifetime, range support, no-store/referrer/logging controls.

**Accept:** A non-Turnstile backend completes create, direct PUT, completion/poll, security
publication and byte-for-byte SHA-256-verified GET. A second app, wrong token or unavailable
version cannot obtain authority. Disablement prevents new URLs; demonstrate the disclosed
bounded lifetime of previously issued URLs. Audit issuance separately from actual download.
Label this increment secure document transfer, not full DMS v1 or production acceptance.

### DMS-I10 — Version history and binary restoration

**Deliver:** New-version uploads, explicit history/status/download selection and historical
restore as a new highest candidate under current security policy. Reuse protected bytes
only with correct reference accounting and reassessment. Add new-version batch items.

**Accept:** Current valid bytes remain available during replacement; later completion of
a lower revision cannot replace a higher current revision. Failed candidates may leave
number gaps. Restore preserves logical identity, historical bytes and live references.
Metadata edits/reprocessing do not allocate binary revisions. Concurrent publication
and restore have one authoritative current-pointer outcome.

### DMS-I11 — Metadata, tags and references

**Deliver:** Bounded scalar/scalar-array JSON metadata, title/tags, documented supported
filters, expected revisions and namespaced external references. Keep product entity
existence/business rights with the consumer; DMS performs no external reference fetch.

**Accept:** Stale revisions reject lost updates; unsafe/unbounded shapes fail before
storage. Same external entity IDs in unrelated application namespaces do not collide.
References neither confer access nor change ownership. Authorized independent HTTP
examples can link/unlink multiple records without importing a Turnstile contract.

### DMS-I12 — Explicit application sharing

**Deliver:** Owner/operator-managed revision-checked `READ`, `EDIT_METADATA` and
`ADD_VERSION` grants. Apply scope ceilings plus resource policy across all implemented
routes and extend the same evaluator to later content/search/audit surfaces. Extend
I03's private operator commands for grant changes; an owner uses the public machine API,
while tenant-operator administration requires its separate current private authority.

**Accept:** Application B initially sees none of A's resources; each grant authorizes
only its intended operations. READ covers explicit history/content/status as implemented;
it does not grant lifecycle/reprocessing/grant administration. Revocation stops new
capabilities and live projections. Test unrelated, disabled and cross-installation
clients; common tenant membership and a business reference never grant access.

### DMS-I13 — Soft delete and logical restore

**Deliver:** Revision-checked delete, lifecycle inspection and deadline-bound restore;
generation invalidation, work cancellation, retained objects/grants and usage. Physical
purge remains disabled until I19's recovery-aware disposal gate passes.

**Accept:** Delete immediately removes normal list/download/content/search eligibility;
late upload/publication/processing cannot restore it. Restore checks object integrity,
current policy and deadline, schedules required work with a new generation, and remains
unavailable if reassessment is required. No restoration once PURGING starts; no premature
quota release for retained physical bytes. Extend and test the private operator
command path for lifecycle administration; an unrelated consumer or authority-admin
account without a DMS operator grant must not perform it.

### DMS-I14 — Native, Office, tabular and email extraction

**Deliver:** Bounded format-routed PDFium/native text, UTF-8 text/Markdown, standard CSV,
Tika Office/email and Calamine spreadsheet paths; manifests/artifact contracts sufficient
for stage acceptance; honest source-unit coverage and warnings. No markup execution,
formula recalculation, macros, external fetch, automatic attachment document import or
invented Office pagination. `secure-only` explicitly omits enrichment.

**Accept:** Representative accepted-family fixtures plus malformed/oversized/embedded
content and limit failures exercise actual isolated runtimes. Formula versus cached
value, sheet/cell/slide/line/email provenance and omitted embedded coverage are explicit.
Native PDF text does not imply full mixed-page coverage. Processor failure preserves an
already-passed original; no unconditional multi-engine extraction cascade is introduced.

### DMS-I15 — English OCR and mixed pages

**Deliver:** Selective PDFium rendering and Tesseract/Pillow OCR with pinned English
data, page/frame orientation and source-unit/coordinate provenance. Use process isolation
for PDFium and bounded native/OpenMP threads. Preserve usable native text without duplicates.

**Accept:** Native-only, scanned, mixed-page, mixed-content-page, rotated and multi-page
TIFF fixtures; partial/time-bound outcomes; documented engine confidence. Evaluate the
accepted clean-printed-English OCR target on a versioned ground-truth set. Missing image
text is recognized or declared partial; handwriting/table exactness and other languages
are not promised. Record CPU/RSS/scratch and output bounds during verification.

### DMS-I16 — Results, reprocessing and optional structure

**Deliver:** Version/run-bound result manifest, bounded authorized artifact retrieval,
source hash and processor/profile/model provenance, source-unit coverage, active result
selection and explicit reprocess. Implement the included optional Docling PDF/image
layout/table adapter and pinned offline profile; disabled installations expose no support.
Extend the private operator interface for reprocessing under current limits and policy;
ordinary read/add-version grants never confer operator or owner reprocessing powers.

**Accept:** Stale/duplicate attempts cannot replace accepted artifacts. A failed or pending
replacement preserves the previous active result/index until eligible promotion. Historical
selection never silently returns another run/version. Enabled structured fixtures return
bounded versioned artifacts with warnings; disabled or unsupported combinations reject
explicitly. No runtime model download/cloud fallback. Extracted text is untrusted data,
never a tool/policy instruction or authoritative business-field write.

### DMS-I17 — Permission-aware discovery

**Deliver:** Bounded English PostgreSQL search, supported metadata/tag/reference filters,
pg_trgm title/name matching, source chunks and generation-aware atomic index replacement.
Avoid unbounded document vectors and unrestricted JSON metadata indexing.

**Accept:** Eligibility predicates execute inside queries before results, snippets, counts
and pagination. Deleted, unsafe or revoked documents disappear immediately despite queued
deindexing. Default search uses current available versions and active accepted results;
historical FTS is absent. Metadata-only search works for `secure-only`; processing/index
lag is explicit and failed replacement does not remove useful prior search.

### DMS-I18 — Operable standalone distribution

**Deliver:** Versioned complete standalone Compose/images/configuration/runbooks, separate
liveness/API/processing readiness, bounded logs/metrics/correlation, backlog age/fairness,
signature/storage/scratch/backup alerts, orderly shutdown, controlled redrive and history
retention. Include tested single-configured-external-authority setup if selected instead
of bundled Better Auth, preserving the same resource authorization and enrollment contract.
No claim that this external option already exists follows from the AUTH baseline.

**Accept:** Clean Linux install and upgrade without Turnstile, optional-profile-off/on
behavior, credential/key rotation/revocation, real canonical container DNS/TLS/issuer and
mail recovery, private route exposure tests and realistic service restarts. Supported
external-authority configuration passes token/client/admin provisioning and recovery
ownership tests, not only a mocked JWKS check. Verify offline scanner updates, bundled
parser/language/model artifacts, nonroot limits and complete SBOM/notices/covered-source
materials. Do not label a single host highly available.

### DMS-I19 — Coherent backup, recovery and disposal

**Deliver:** Versioned backup manifest and off-host backup process covering auth/DMS DB,
SeaweedFS required data/metadata, originals/artifacts, registrations, policies and key
recovery material. Document compatible recovery points, measured volume/hardware and
RPO/RTO evidence. Add authorized controlled cleanup of staging, artifacts, histories and
originals under separate retention rules and reference/recovery checks.

**Accept:** Restore to an isolated empty installation, reestablish intended access before
opening it, verify original hashes/history/grants/security/results and reconcile pending
jobs. Stale broker deliveries cannot resurrect deleted/completed work. Restored/reused
objects survive deletion of another reference. Physical disposal waits for logical
restore, all live references, retained database recovery history and object backup lag;
retry interrupted disposal safely and release usage only after confirmed removal.
Retain failed work/provenance appropriately; live deletion does not claim immediate
erasure from independently retained backups. Compare measured recovery against NFR-10.

### DMS-I20 — Qualification and handover

**Deliver:** Per-FR/NFR evidence ledger, independent consumer harness/manual recipes,
exact compatible image/dependency/contract inventory, fresh-install/upgrade/rollback
runbooks, operating-mix performance report and controlled target acceptance checklist.

**Accept:** All gates in section 9 pass against the exact candidate. Record implemented,
automated-tested, manual-tested, deployed and target-accepted states separately. A locally
verified candidate does not authorize production deployment or customer data migration.
Turnstile changes, if needed later for its own document UI, remain separate consumer work.

## 8. Parallel work and ownership

Use branches from up-to-date development and target development. Assign one owner per
shared contract/migration/lockfile/Compose change; integrate those through development
before dependent work consumes them. Do not have parallel owners amend the same migration
journal. Every worker preserves the active owner-test installation and credentials.

| Work lane                | Can progress independently                                                        | Integration dependency                                                           |
| ------------------------ | --------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| Foundation/API contracts | I01–03, explorer and independent-client recipes                                   | Shared configuration/auth changes must preserve combined-mode consumers          |
| Storage                  | I04 after I02 contracts                                                           | I05–09 require verified length/immutability/authorization primitives             |
| Domain API               | I05–06, then versions/metadata/sharing/lifecycle                                  | Requires owning persistence, policy and storage; no publication before I08       |
| Processing runtime       | Image dependencies, sandbox fixtures and parser adapters after contract agreement | End-to-end acceptance requires I07 private APIs/fences and I08 security outcomes |
| Operations/recovery      | Inventory, standalone Compose, backup design, ingress and installation docs       | Full acceptance follows actual implemented services and I18–20 gates             |

Keep independent test fixtures in their own database/container namespaces; no reset of the
current installation. Fixed manual host ports must fail on conflict, never fall back.
Ephemeral automated fixture ports remain permitted under the existing architecture rule.
This plan recommends parallel ownership; creating more agents or starting these packages
is not part of this documentation task.

## 9. Verification and completion contract

### Required checks for implementation changes

Run `pnpm check`, `pnpm build`, `pnpm test` and `pnpm test:integration` for workspace
changes. Add meaningful risk-focused integration coverage with owning packages, not an
exhaustive mirror of each service method. Keep Python Ruff/mypy and locked-environment
checks. Contract parity, route classification and isolated image smoke belong in CI.
Unavailable Docker/runtime/deployment evidence must be reported separately from passed
static checks. Existing cache use must not be described as a fresh uncached runtime test.

Standalone fixtures must provision only auth/DMS roles and schemas and run without
Turnstile packages, processes or secrets. Preserve the separate full-workspace regression
lane for supported consumers. Add a dedicated DMS-only CI entrypoint; final script names
are chosen during implementation. New test commands named here are deliverables, not
commands that currently exist.

### Release acceptance scenarios

| Evidence                      | Required scenario                                                                                                                                                                                                        |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Independent installation      | Start the documented DMS-only stack from a clean package/environment; no Turnstile service/schema required; explicit migration/bootstrap is repeat-safe                                                                  |
| Independent application A     | CLI/Python HTTP-only client performs provisioning recipe, enrollment, token renewal, uploads, status, retrieval, metadata, versions, content and search                                                                  |
| Independent application B     | Separate credentials and namespace; denied by default; each explicit grant and revocation behaves correctly across every applicable surface                                                                              |
| Independent shared user login | Minimal non-Turnstile consumer-owned screens/backend prove code/PKCE login/consent continuation, approved verification/reset returns, logout, expiry/revocation and recovery; unregistered destinations fail             |
| Tenant operator               | Explicitly authorized tenant-bound operator uses private commands for audit/grants/lifecycle/reprocessing; revocation takes effect; consumers, user sessions and authority-admin status alone cannot obtain those powers |
| Explorer                      | Bundled Swagger runs with Turnstile absent; public implemented operations/errors visible; short-lived bearer control calls work; private routes/secrets absent                                                           |
| Direct browser transfer       | Tiny independent backend plus browser sample proves exact-size create-only signed PUT, CORS, completion/poll and bounded original/artifact GET                                                                           |
| Real component chain          | PostgreSQL + SeaweedFS + RabbitMQ + private HTTP + actual scanner/parsers; no mock-only claim of publication or extraction                                                                                               |
| Failure/recovery              | Lost callback, duplicate/out-of-order dispatch, worker/coordinator crash, stale lease, unreachable broker/storage, stale scanner and partial extraction remain bounded and recoverable                                   |
| Access/lifecycle              | Token misuse, inactive registration, scope ceiling, unrelated app, revoked grant, deleted/unsafe version, stale cursor/revision and late result cannot reveal or mutate content                                          |
| Optional structure            | Disabled profile rejects honestly; enabled offline profile emits attributable bounded artifacts without automatic download                                                                                               |
| Performance                   | Declared file/page/size mix, OCR/structured share, bursts, operating window and resources; API latency, original availability, queue age, processing/index lag measured separately                                       |
| Recovery                      | Off-host backup restored and reconciled in isolation; recovery objectives checked for declared volume/hardware; reference/recovery-aware purge proven                                                                    |
| Packaging/security            | Exact nonroot image set, resource limits, frozen pins, SBOM/notices, offline artifacts, private interfaces and controlled TLS/docs/transfer ingress                                                                      |
| Compatibility                 | Existing combined Turnstile authentication/identity-service tests pass; supported fresh install and preserved-data upgrade/rollback rehearsal pass                                                                       |

### Manual operator journey

The completed runbook must let an operator perform this sequence using documented
commands and the explorer, without reading source code:

1. Validate configuration, bring up prerequisites and explicitly provision auth/DMS roles.
2. Apply owning migrations, bootstrap the single tenant and verify the operator account.
3. Issue a consumer machine client, pending registration and bound enrollment key through
   protected command inputs/outputs. Enroll from a trusted CLI/backend; remove key material
   from the test session when no longer needed.
4. Obtain a short-lived token through a protected recipe, open `/docs`, authorize and read
   capabilities. Re-obtain the token on expiry without storing a client secret in Swagger.
5. Create upload JSON in Swagger or the HTTP example, transfer bytes with the independent
   browser/CLI recipe, complete and poll until the actual security outcome is visible.
6. Request download, verify bytes/hash and inspect audit. Test one forbidden request and
   one rejected or inconclusive file so availability is not confused with acceptance.
7. Exercise versioning, references, explicit second-app sharing, extraction/OCR/content,
   search and delete/restore as those capabilities are delivered.
8. Inspect processing health, rotate/disable a test client, and rehearse isolated backup
   recovery. Save only redacted outcomes and fixture IDs, never tokens or signed URLs.

Full standalone v1 is complete only when requirement groups 01–20 and shared quality
requirements have evidence, including the optional structured adapter when enabled.
Secure upload/download alone, generated Swagger alone, or container health alone is an
intermediate milestone. Target customer provisioning, data migration and actual production
acceptance are explicitly recorded actions, not inferred from fixture success.

## 10. Decisions and first implementation scope

The selected architecture is sufficient to proceed. Routine library pins, private route
names, compatible schema validation and Compose organization are resolved in their owning
package and recorded in architecture/manifests. Do not create a separate architecture
selection project or block independent fixtures on customer-specific deployment inputs.

Before a real target release, obtain its canonical domains/origins, TLS/mail/secret
delivery, storage/backup locations, operating file mix/resources, recovery requirements
and any compliance constraints. These inputs refine the operating deployment; they do
not authorize SaaS provisioning, deferred governance features or business workflows.

**Recommended first authorized implementation:** DMS-I01 followed by DMS-I02. Deliver
a clean DMS-only foundation plus token/enrollment recipe and Swagger capability testing,
with no Turnstile process/schema required. Then advance I03/I04 and the secure-document
chain. No Turnstile frontend work or business specification is needed to complete the
accepted standalone DMS v1 scope.

## 11. Review and verification record

Planning inspection covers the accepted product/requirements/architecture, current API
and contract/client source, bootstrap/configuration/operator tools, Python manifest/image,
OpenAPI generator, workspace checks and deployment definitions. Source inspection proves
the baseline and gaps, not runtime compatibility of future dependencies.

GPT Astra (`gpt-6-astra`) completed the owner-requested read-only final review on
2026-11-04. It returned two material P2 findings; the parent reconciled both directly:

| Finding                                                                  | Document correction and required implementation evidence                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Tenant-operator document powers lacked an authentication/assignment path | Sections 3 and I01/I03 now specify private commands, fresh authority identity plus explicit tenant-bound DMS operator authorization, bootstrap/assignment/revocation/recovery, distinct execution context and audit. I12/I13/I16 extend it with owning features; release acceptance includes positive operator and negative consumer/user-session cases. |
| Independent machine tests did not prove shared consumer login            | I01 now assigns implementation of approved consumer login/consent continuation and verification/reset destinations, with a minimal external-consumer code/PKCE browser fixture proving login, logout, expiry/revocation and recovery with Turnstile absent. Release acceptance and architecture retain this gate alongside combined-mode regressions.    |

The reviewer otherwise found the inventory, sequence, explorer, storage, processing,
extraction and recovery gates materially aligned with accepted scope. The corrections
have been checked by the parent; no second independent review is claimed.

Planning verification on 2026-11-04: `pnpm check`, `pnpm build`, `pnpm test` and
`pnpm test:integration` pass. Build/unit tasks retained normal Turbo caches; integration
executed uncached (21 Fastify and 218 PostgreSQL cases across 15 database files).
Biome/document formatting, `git diff --check`, all 83 relative document targets and the
20 ordered delivery sections were checked. An initial Markdown table-formatting failure
was corrected before the successful checks. No new implementation tests were added for
this documentation change. No new standalone runtime, Swagger integration or future
library compatibility has been verified by those existing-workspace suites.

No DMS feature implementation, library installation, persistent installation migration
or deployment is performed by this planning task. Disposable database verification
fixtures were used; the current owner-test installation is preserved.

## 12. Upstream references for the documentation choice

Reviewed 2026-11-04; implementation must verify the exact pinned releases. These primary
references support the proposed serving/configuration approach, not compatibility results
for packages that are not installed yet:

- [Fastify Swagger static mode](https://github.com/fastify/fastify-swagger#static).
- [Fastify Swagger UI integration](https://github.com/fastify/fastify-swagger-ui).
- [Swagger UI configuration](https://swagger.io/docs/open-source-tools/swagger-ui/usage/configuration/): authorization persistence and validator controls.
- [Nest OpenAPI integration](https://docs.nestjs.com/openapi/introduction): integration context and Fastify CSP considerations; this plan keeps shared schemas as the source of truth.
