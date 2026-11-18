# Documents UI integration and validation implementation plan

Date: 2026-11-17. Owner: Codex. Status: DV-I01–08 and the DV-AUDIT-02 corrections locally qualified.
Actual completion and verification are recorded in IN_PROGRESS.md; target rollout remains separate.

Deliver a Documents workspace with its own contextual sidebar in Turnstile 360. Users
can exercise the implemented DMS capabilities through authorized product flows,
inspect resulting state and expose defects early. Scope, DV-R01–20 and the complete
34-operation inventory DV-E01–34 are in the
[specification](documents_validation_specification.md). Technical decisions live in
[architecture.md](../../../architecture.md#documents-validation-workspace-proposal).
Actual completion and verification live in [IN_PROGRESS.md](../../../IN_PROGRESS.md).
All six review findings have a settled disposition in this baseline and the specification's
RF-01–06 matrix. The contract foundation, guarded reads, uploads, ordinary document,
version and batch changes, owner recovery, grants and activity, known-ID Contribute,
processing, verified extracted content, discovery and protected Validation are
implemented. The coverage register records local qualification and separate target
evidence.

The [generated executable contract](../../api/turnstile-documents.contract.json) and
[coverage register](documents_validation_coverage.json) freeze DV-I01 routes, commands,
compatibility and evidence ownership. Generate with `pnpm docs:documents`; `pnpm check`
checks drift. Contract tests are not runtime HTTP, browser, image or target acceptance.

## Delivery approach

Implement complete vertical slices: contracts, authorization, adapter, UI, production
failure-path verification and handoff. Fix a reproduced blocking issue within its owning
DMS, client, product or deployment boundary before the next slice depends on it.
Preserve the current installation and the independent portal-refresh changes.

Prioritize a secure-only text upload through actual security assessment and exact
original download. Expand to runtime-advertised formats after transport and authority
work. Keep upload, security/publication, extraction and indexing independently visible.

## Ordered increments

| Increment                                             | Scope and dependencies                                                                                                                                                                                                                                                                                                                                         | Required exit evidence                                                                                                                                                                                                                                                                                                                                                                                           |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DV-I01 — Executable contracts and readiness record    | Encode DV-R01–20 and the settled architecture: foundation ownership, nine company permissions, catalogue-v3/legacy-v2 contracts and release barrier, private validator command, scoped HTTP budgets, finite intent commands, no-READ Contribute and full-access-only public writes. Generate contracts/examples and freeze route/evidence ownership.           | Six resolutions trace to executable DTO/command contracts and owning tests. Capture legacy fixtures from the actual current bundle. No role/grant or route is enabled; no ledger schema before DV-I03.                                                                                                                                                                                                           |
| DV-I02 — Compatibility, validator and read-only shell | DV-I01. Implement dual-contract rollout/barrier, private grant/revoke/handover, explicit machine provisioning, typed client reads, Documents services/HTTP hooks and foundation inventory. Add navigation, connection/policy, list/detail and scoped caching. Complete compatibility evidence before atomically enabling the barrier and first reviewed grant. | Actual old/new bundles pass session/catalogue/nested People/import/invitation/receipt checks before and after grants. Legacy writes cannot erase unseen rights; supported 401 recovery loads current assets. Proof/revision/retry/audit/revoke tests and real first-validator login pass. Scoped parser/ingress errors and all selected-profile foundation builds pass.                                          |
| DV-I03 — One real file and bounded reconciliation     | DV-I02. Implement draft-before-dispatch ledger/migrations, stable execution/retry IDs and expiry/manual-review/tombstone rules. Add begin → PUT → complete → poll → original GET, refresh/cancel and reopen. Configure exact CSP/CORS/ingress. Keep all public mutations full-access-only in both products.                                                    | Real text passes the production scanner/publication path and matching download digest. Lost begin/PUT/complete replies, local crash, replay expiry, pruning/restore and missing-ID retries create no replacements. Restrict each product independently: public complete/control denies, allowed reads and accepted private work remain separate, renewal resumes only eligible original intent.                  |
| DV-I04 — Metadata, references and versions            | DV-I03. Add typed metadata/tags/title/reference edits, versions/details, new binary, historical download and restore as new assessed revision through the intent boundary.                                                                                                                                                                                     | Two-tab conflict preserves drafts; uncertain writes reconcile. Inner/edit-envelope and UTF-8 limits pass. Out-of-order publication/current pointer and same-key restore after intervening changes retain authoritative behavior.                                                                                                                                                                                 |
| DV-I05 — Batches and durable activity                 | DV-I03–04. Add create/new-version manifests, bounded scheduler, all item pages/counters, retry/close/cancel and durable reopen. Apply batch intent/ingress/forwarded manifest budgets.                                                                                                                                                                         | A valid large manifest traverses actual product ingress; exact/over-budget and typed 413/415 cases pass. More than one page, capacity delay, close/cancel races, lost IDs/expiry and re-selection/hash checks preserve each binding and successful item.                                                                                                                                                         |
| DV-I06 — Lifecycle, sharing, Contribute and audit     | DV-I04–05. Add recorded/known-ID recovery, logical delete/restore, grants editor with provisioned IDs and owner Activity. Add known-ID metadata/reference/new-version contribution using owner-supplied inputs without READ or a new effective-rights API.                                                                                                     | One fixed Turnstile registration contributes to a separate fixture owner's documents. Browser EDIT_METADATA-only and ADD_VERSION-only actions succeed while detail/status/content/download deny. Reload shows receipt-only status; the owner backend independently verifies effects/publication. READ-only writes deny. Revocation, namespaces, owner-only actions, delete races, restore expiry and audit pass. |
| DV-I07 — Processing, extracted content and search     | DV-I03–06. Add exact version/run history, schema/hash/size-checked artifacts, bounded source/text/tabular/OCR presentation, reprocess, exact and English full-text search with provenance/index state. Optional structure only when installed.                                                                                                                 | Production extractor/OCR handles representative enabled formats. Failed enrichment preserves secure originals; PARTIAL coverage remains visible. Failed replacement preserves active results, wrong version/run denies, and delete/revoke/invalidation or late results cannot reopen visibility.                                                                                                                 |
| DV-I08 — Coverage and release qualification           | DV-I01–07. Finish coverage/diagnostics and every endpoint row. Repeat early compatibility/barrier/provisioning checks on exact selected images. Rehearse upgrade/backup/recovery, ledger retention and v3 rollback fence, then prepare target handoff.                                                                                                         | All 32 consumer operations have product coverage, including Contribute rights variants. Service identity/enrollment and signed/private surfaces have assigned evidence. Exact images preserve setup/users/grants/documents/operation IDs and cannot reopen legacy writes after restore. Required gates pass; optional-profile/target acceptance is reported separately.                                          |

DV-I01 encodes the decisions made here; it is not another open scope-selection phase.
No additive DMS directory, effective-rights endpoint or public completion exception is
required for this delivery. The existing foundation integration owns Documents; UUID
target input and known-ID Recovery/activity are the supported directory limitations.
Richer pickers/directories or selectable commercial packaging require separate scope.

## Entry decisions and blocking gates

| Decision                         | Settled baseline                                                                                                                                               | First blocking gate                                                                                       |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| RF-01: permission compatibility  | Catalogue v3 negotiation; exact legacy v2 until activation, then supported 401 recovery for legacy permission-bearing reads/writes. Never strip unseen rights. | DV-I02 actual old/current bundles and nested payload/write matrix before any Documents role/grant.        |
| RF-02: first validator           | Nine explicit company permissions in a custom role, private verified grant/revoke/handover and durable v3 barrier.                                             | DV-I02 real ordinary login/readback and proof/retry/audit/revoke tests; no implicit administrator rights. |
| RF-03: HTTP envelopes            | Scoped request/response/artifact/time budgets in architecture, plus independent upstream inner limits.                                                         | DV-I02 parser/gateway tests before opening routes; DV-I03–05 large real controls/manifests.               |
| RF-04: uncertain outcomes        | Server-minted draft intent before dispatch, finite authorized replay, unresolved/manual review and non-reusable IDs/tombstones.                                | DV-I03 commit → lost reply → crash → replay deadline, plus delayed/pruned/restored retry regression.      |
| RF-05: independent shared rights | Known-ID Contribute with owner-supplied revision/descriptor; no forbidden read/poll or owner-credential fallback.                                              | DV-I06 contributor browser and separately labelled fixture-owner verification.                            |
| RF-06: restricted completion     | All public mutations require full access in both products; no new public exception.                                                                            | DV-I03 independent restriction/closure/renewal/expiry matrix and worker/public-boundary checks.           |

DV-I01 freezes the finite product route catalogue using `/api/documents` for list/detail
and nested document reads, `/api/documents/search` for GET-to-DMS-POST translation,
`/api/documents/connection` for safe bootstrap, and nested `/uploads`, `/batches` and
`/audit` reads. Intent creation, local directory/readback and execution live under
`/api/documents/operations`; execution always identifies an existing stored intent.
A typed command discriminant maps to an owning use case and fixed DMS method/path;
the browser cannot supply a URL, HTTP method, tenant or calling application. Contribute
uses these same finite edit/reference/version commands, not an arbitrary proxy endpoint.

## Product and UI implementation

The Documents sidebar has All documents, Uploads, Batches, Recovery, Activity, Connection
and Validation; Validation contains Contribute. Search belongs with the directory.
Document pages have stable Overview, Versions, Processing, Content, Application access,
Lifecycle and Activity tabs. Use task sheets for reviewed changes. Bound/virtualize long
extracted content with provenance and omissions; do not dump unbounded JSON into the DOM.

Use installed shadcn/Base UI controls, Hugeicons and semantic tokens. Reuse workspace
navigation, ScrollRegion, loading/empty/error states, forms, tables, sheets, confirmations
and progress. Add missing primitives with the pinned CLI when needed; show reusable
states in the development gallery with fictional fixtures. The separate portal refresh
may later supply adopted shared tokens; do not import its proof or add a second theme.

Required states include cold loading, background refresh, empty/filter-empty, forbidden/
revoked access, paused/unconfigured policy, read-only deployment, outage/capacity delay,
stale revision, uncertain outcome, unresolved/manual review, pending/rejected/inconclusive
security, partial/failed enrichment, index lag and expiry. Pending work links to status;
request abort does not imply server cancellation. Confirm outcomes by acknowledgement
or authorized reconciliation, not local optimism.

Keep signed URLs, original/extracted bodies and secrets out of persistent browser caches,
localStorage, history, diagnostics and receipts. Storage uses a separate credential-
omitting transfer client without product CSRF/actor/compatibility headers or machine
authorization. Revoke temporary object URLs and discard capabilities/content on access
changes. Ordinary metadata caches are scoped and short-lived.

## Authorization and compatibility implementation

DV-I01 encodes the architecture's nine company-only action permissions and route
requirements. DV-I02 implements their owning catalogue migration, dual wire contracts,
private v3 barrier and first-validator command. The capabilities permission grants no
Documents action. Existing system role templates and ordinary HTTP anti-escalation
stay unchanged. Compatibility headers declare readable schemas; they are not authority.

The full authorization intersection is product session/access context, explicit action,
readiness/deployment/module policy, DMS deployment, machine scopes and resource rights.
Mutations require current CSRF/access-context generation and service checks. Server-derived
human attribution is not delegated DMS authority. Shared rights remain independent;
permission/lifecycle/binary restore/reprocess/audit remain DMS-owner-only.

Follow architecture's staged rollout: dual-contract API/web with grants disabled,
actual old/new-bundle checks, then private atomic barrier plus first reviewed grant.
Verify old clients receive supported recovery before any incompatible payload or write;
no permission stripping or silent legacy role replacement. Test session/catalogue,
role/member/access/eligible-role/invitation/import/impact/receipt payloads, activation
retries/concurrency and rollback. Repeat on production images in DV-I08, but do not defer
the first gate until then.

The private validator tool requires reviewed operator authority, current verified actor/
target proof, expected access revision, exact permissions, company scope and a custom
role. Test grant/retry/conflict/revoke/handover and audit rollback through the actual
tool; SQL-seeded roles do not close this gate. Verify ordinary login/session-v3 and
allowed/denied actions before calling the first validator provisioned. No startup grant,
HTTP escalation or DMS-operator credential bridge is introduced.

## Shared Contribute flow without READ

Normal shared document tabs are read-only. Validation → Contribute supplies explicit
shared edit/reference/new-version actions from known document ID and owner-supplied
revision/title/metadata as applicable. New-version files have a recorded SHA-256.
Require product validate plus edit/upload, full policies and the actual DMS mutation
right. Do not infer that right from capabilities or discover it through a test write.

Submit the user's intended finite command with the fixed Turnstile registration. Show
only submitted fields and minimal acknowledgement actually authorized by the mutation
response. Without READ, never enrich the receipt by GET detail/status/history/content/
download or by another application's credential. A 202 means completion accepted;
publication is unobservable with current rights. Reload uses local receipt-only state,
not a fresh live projection. Stale revisions require new owner-supplied inputs and review.

A separate private fixture owner supplies nonsecret inputs and independently verifies
persisted effects/publication. Browser tests must exercise successful EDIT_METADATA-only
and ADD_VERSION-only actions, denied reads/owner actions, READ-only denial of writes,
namespace boundaries, reload and grant revocation. Evidence labels contributor
acknowledgement separately from owner-observed results. No-READ batch views must preserve
DMS's omission of unauthorized live session details.

## Recoverable operations and failures

Create/acknowledge a server-minted draft intent before any DMS mutation. Persist the exact
command/digest, actor, expected revision and upstream key; execute/retry names that ID.
Lost local draft acknowledgement cannot already have created a DMS resource. Missing,
pruned or expired IDs never become new executions. Implement the ledger schema/migrations
only with the first mutation in DV-I03, following architecture's deadline/retention/capacity
rules. Never store file bytes, credentials, signed URLs or extracted bodies, or keep a
DB transaction open across HTTP.

Remote success plus local-link failure is uncertain, not rolled back. Reauthorize before
receipt replay and recover IDs only inside the upstream window. At the reconciliation
deadline/410, unknown IDs become durable UNRESOLVED_REQUIRES_REVIEW. Retain minimal
key/digest evidence, prohibit automatic replacement and require explicit disposition
before a newly reviewed command. Known-ID reads use normal current authority. Revision-
only writes require readback/conflict review rather than unconditional resend. User input
changed after timeout is a new reviewed intent, never a replay of changed data.

DV-I03 exercises commit → lost reply → local crash → replay deadline, denied timely
reconciliation, known-ID recovery, tombstone pruning, restored state and delayed retries.
Verify no missing-ID request recreates a row or sends another DMS command. Manual review
can attach a verified binding or remain unresolved; it cannot extend upstream replay.

Reopened Uploads/Batches cover authorized Turnstile-recorded activity, not a complete DMS
directory. Re-select a local file only if bytes still need transfer, verify its original
descriptor/hash and recheck eligibility; completed server work needs no file re-selection.
Ledger ownership never grants document READ or permits live data projection after revocation.

Poll active visible/reopened work with bounded backoff and server retry hints. Stop when
all displayed stages are terminal, on access/session loss or unmount. Upload completion
alone does not end security/processing/index monitoring. Contribute without READ never
starts forbidden polling. Use architecture's finite control deadlines; retry only with
proven receipt/conditional semantics and the original key/body/revision.

Public mutations stay paused while either product is existing-reads, closed or licence-
expired, including complete/refresh/cancel and batch controls. Preserve intent/IDs and
allow only authorized readback. Already accepted private work follows its separate
fences. After renewal, recheck authority, revision and original deadline; unresolved or
expired commands remain in review. Test each product restricted independently, both
restricted, closure/licence expiry and renewal through actual owning HTTP.

## Verification and coverage

| Layer               | Existing baseline                                                                   | Required new evidence                                                                                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contracts           | DMS generation, Zod/Ajv/Python fixtures and real-handler catalogue checks.          | Product finite commands/examples, catalogue-v2/v3 negotiation, typed headers/errors and full endpoint drift checks. Early old-client gates repeat on exact images.                      |
| Product authority   | Canonical access/session/CSRF and capability adapter.                               | Real HTTP action/context/scope/resource denial on reads, mutations, replay and every page; private first-validator grant/revoke/handover and normal-login evidence.                     |
| HTTP/transfer       | Real SeaweedFS/Chromium known-size transfers, ranges, expiry and forwarded headers. | Scoped product/gateway JSON boundaries, inner actor/manifest overhead, typed 413/415, exact production CSP/CORS, credential omission, digests and lost acknowledgements.                |
| Transactions/replay | DMS receipts, versions, sharing, lifecycle and processing fences.                   | Real intent/register/private command under lost replies, crash/expiry, pruning/restore, delayed retry, partial linking, intervening changes and quota contention; no duplicate effects. |
| Async processing    | Private HTTP/broker/Celery/security/extraction tests.                               | Real scanner/extractor/OCR in journeys, worker outage/restart and stale-generation rejection. Optional structured runtime is separately qualified.                                      |
| UX/accessibility    | Existing primitives and auth/People/Structure journeys.                             | Keyboard/narrow layout/focus, retained drafts, current access, independent stage states, deep-link/reload and no-READ receipt-only contribution.                                        |
| Release/target      | Selected-image and cutover machinery.                                               | Exact-image compatibility/barrier/first-validator/upgrade/backup/recovery, preserved setup/users/grants/documents/intent IDs, rollback fencing and separate target acceptance.          |

For each increment run `pnpm check`, `pnpm build`, `pnpm test` and
`pnpm test:integration`. Extend existing focused owning integration/browser fixtures
rather than introducing a test platform. Re-run auth/People/Structure where shared
navigation, contracts or guards change. A baseline test pass does not replace the new
production failure-path regression.

Create the version-controlled coverage register in DV-I01, keyed by DV-E/operationId,
with owner, product route/command, UI, action/mode, readback, denial/conflict/retry case,
automated test and source/image/target evidence. Record all RF-01–06 gates there, including
contributor versus owner verification. Do not add a general validation-result database.
Unavailable profiles are unavailable, not passed; retain the directory/known-ID limits.

For a defect, record reproduction/expected/actual, add a focused failing case against
the owning real handler/transport, fix it, rerun the regression/gates and update coverage
and handoff. Cross-service defects require integration regression. Substituting the
failed handler produces fixture evidence and cannot close production-path acceptance.

## Completion and release evidence

Complete delivery when the UI and all 32 consumer operations have real product coverage,
service identity/enrollment have assigned diagnostic/provisioning evidence, and the six
review resolutions, transfers and authorization/replay/failure paths pass their gates.
Record planned, implemented, source-tested, image-tested and target-accepted separately.
Production/customer acceptance remains separate from local qualification.

Use the [Documents runbook](../../runbooks/documents-validation.md#coverage-and-release-qualification)
to reproduce the local selected-image checks and prepare the separate customer handoff.
Cross-check the coverage register against the owning verification before opening
the target workspace to a reviewed validator.
