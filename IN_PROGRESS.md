# Project progress

Last updated: 2026-11-06

This is the shared implementation status and handoff record for Turnstile 360 and the
Thaarei DMS. All agents must read it before starting work and update it as work progresses.
Technical design is maintained in [architecture.md](architecture.md); product scope and
requirements remain in their linked specifications. This file records what has actually
been completed, verified, or left pending.

## Current position

The owner-authorized 2026-11-04 fresh local reset has now replaced the earlier preserved
installation: all seven Compose services are recreated, with fresh database/storage and
server credentials, exactly one verified protected administrator, enrolled machine access
and empty incomplete v2 company setup for owner testing. No old installation archive was
restored. Earlier preserved-v1 statements below describe historical release milestones.
PR #7 is merged to development as ec07a12, with green PR and post-merge CI.
The local installation is ready for owner login. Documentation PR #8 passed every
push/PR check on bacf7c4 and merged to development as 266044b (2026-11-04).
The access UI redesign is merged through PR #9 as bd7f1a2, after all push/PR checks
passed on 8611279. Local development matches that merge and the tested UI remains running.

The workspace foundation and AUTH-01–07 implementation and local verification are complete. The DMS authority supports
persisted verified accounts, sessions, signing keys, controlled recovery and managed distinct
login/machine OAuth clients with private issuance/rotation/suspension commands.
Auth/DMS/product schemas have separate roles/migrations, and product session storage is
encrypted. The Turnstile BFF implements OIDC login, live user/local permission checks,
fenced refresh and recoverable logout. The DMS implements machine JWT verification, live
registration/scope checks, bound transactional enrollment, local-first disablement and
bounded audit. The typed DMS client and product-permission-protected capability request
use a separate machine token over real HTTP. Login/recovery/reset and safe session/logout UI,
bounded security telemetry and Mailpit development/pilot configuration are implemented.
Real client provisioning/enrollment,
document/processing/business capabilities and source/data migration remain incomplete.
A persistent local-development authentication installation has now been provisioned and
passes live login/recovery/logout and machine-enrollment/capability checks. Earlier feature
verification used disposable fixtures; no real customer has been onboarded.
The web design system and shared designer/developer guide are implemented and locally
verified; review the live development catalogue at /design-system.
The owner-prioritized onboarding discovery and design proposal informed the accepted
[onboarding specification](docs/turnstile/onboarding/onboarding_specification.md) established in ONB-I01.
The [implementation plan](docs/turnstile/onboarding/onboarding_implementation_plan.md) defines delivery,
acceptance, verification and upgrade sequencing. ONB-I02–03 implement executable shared
contracts/generated documentation, product persistence composition and canonical audited
organization/setup operations with guarded HTTP and private maintenance commands.
ONB-I04 adds protected private manager grants and backend readiness enforcement.
ONB-I05 adds guarded resumable onboarding and ordinary waiting with typed transport.
ONB-I06 adds ongoing canonical Settings; ONB-I07 complete-chain verification and ONB-I08
upgrade/recovery implementation with the selected existing local release are complete.
Production/customer target acceptance remains separate. Document Approval
still requires separate product agreement.
ONB-RD01 adopts the authorized redesign's versioned first-unit, move and layout baseline;
ONB-RD02 implements compatible v1/v2 contracts, exact Kolkata/Calcutta support and the
adopted move payload/generated API documentation. ONB-RD03 adds v2 initialization,
incomplete-only v1 upgrades, canonical first-unit readiness and completion/deletion
protection while retaining completed v1. ONB-RD04 implements guarded transactional
subtree moves with atomic audit/revision and canonical ancestry. ONB-RD05 adds dedicated
setup/waiting layouts, saved-gap Organization/First unit/Review resume, explicit India
confirmation and guarded Finish setup with readback. ONB-RD06 adds the shared visual
structure editor, contextual CRUD/search and confirmed keyboard/pointer/touch moves.
ONB-RD07 adds completed-workspace collapsible navigation, an accessible mobile overlay,
compact Settings sections, available dashboard actions and the optional legacy unit prompt.
ONB-RD08 completes exact image/archive verification and the selected local release of the
[redesign plan](docs/turnstile/onboarding/onboarding_redesign_implementation_plan.md). The existing local
installation is migrated through 0010, retains completed v1 and all saved configuration,
and passes real administrator Settings/connection/logout/relogin checks. Fresh v2 and
upgrade variants are verified in isolated fixtures. Production/customer DNS/TLS, external
email and rollout acceptance remain separate.
UM-I01 adopts the accepted [user-management specification](docs/turnstile/user-management/user_management_specification.md)
and freezes the next feature's architecture/contracts policy. UM-I02 adds strict shared
contracts and generated API documentation. UM-I03 adds staged canonical access persistence,
scope-pair evaluation, exact legacy import and private administrator recovery. UM-I04
replaces flat readers with canonical login/session, route and transactional configuration
policy, with access-context/CSRF generation fencing. UM-I05 adds scoped
structure operations, receipt/readback and confirmed effective move impact with a closed
invitation-policy integration boundary. UM-I06 implements the separate authority service,
recipient account setup and server-only product identity adapter. UM-I07 implements the
invitation approval/lifecycle service and durable captured SMTP delivery. UM-I08 implements
restricted recipient identity, setup/verification/recovery resume, atomic acceptance and
the recipient entry. UM-I09 implements guarded administration reads, commands, impact
review and linked identity display. UM-I10 adds independent People/roles/invitations and
scoped Structure UI, reviewed changes, safe drafts and complete recipient browser entry.
UM-I11 implements the versioned release barrier, verified private administrator handover,
credential retirement, exact production-image inventory and isolated upgrade/restore
rehearsal. Implementation and local verification through UM-I11 are complete. Actual
coordinated target cutover is separately planned as UM-REL-001 and remains gated on
a fresh target time/source preflight. UM-VERIFY-02 has now passed observed clock stability
and the complete local verification sequence. The existing installation and grants have not been
migrated/initialized by this workspace work.
The UM-AUDIT-01 per-item OCR audit has fixed 15 medium findings and passes its final
local checks/browser suites. UM-VERIFY-02 now passes measured clock stability and runtime
regressions; Windows time-source freshness remains an OPS-003 follow-up before cutover.
No existing installation was changed by the audit or these verification fixtures.
The technical design is maintained in [architecture.md](architecture.md).

## Updating this file

1. Read this file and the relevant specifications before changing code. Confirm current
   implementation details rather than assuming an old verification still applies.
2. Add or update a work item when a task starts: stable ID, status, owner, scope, and next
   action. Reference existing requirement IDs when applicable.
3. Update the item after meaningful milestones and before handing work back. Record files
   changed, checks actually run, results, and remaining work. Include dated verification.
4. Mark work completed only when its agreed scope and required checks are satisfied.
   Distinguish configured, implemented, tested, and deployed states.
5. For blocked work, record the specific blocker and what resolves it. Planned work is
   not authorization to implement it; deferred features stay outside current scope.
6. Preserve other agents' entries. Read the latest file before editing and do not mark
   another agent's task completed without evidence. Keep completed milestones available.
7. Never record credentials, tokens, signed URLs, customer data, or sensitive logs here.

Statuses: **Planned**, **In progress**, **Blocked**, **Completed**, **Deferred**.

## Active work

TCP-PR-01 — **Completed** (documentation integration and branch preparation;
owner: Codex control-plane planning thread, 2026-11-06). Committed only the eight
control-plane planning/reference/progress Markdown files and merged
[PR #12](https://github.com/nishanthturnstile/turnstile-360/pull/12) into development as
`a2ac3a815da768258b21c1a7f810232a5a27745f`. Both push and PR workflows passed all 12
checks on `e805efc`, including workspace check/build/test/integration/smoke and all five
container builds per workflow. The initial Markdown-formatting failure was corrected
with installed Biome 2.6.4; local full Biome CI, document-content preservation checks,
149 local reference checks and git diff checks passed. No target deployment occurred.

Fetched updated origin/development after the merge and created
`feat/thaarei-control-plane-implementation` from that exact merge commit. Only this
administrative handoff changes on the new branch; no control-plane implementation,
scaffold, schema, dependency or runtime configuration has started. Customer services,
credentials, data and the separate DMS checkout remain untouched. The GitHub connector
returned HTTP 403 when creating the PR; the already-authenticated GitHub CLI completed
PR creation/merge and T3 linking succeeded.

Handoff: branch preparation is complete. Wait for a new implementation instruction before
starting TCP-I01 or later increments. The planning merge does not adopt remaining product
defaults; seven-day approval/daily renewal stays selected and the documented read/recovery,
staff-policy and metric/retention decisions remain proposed. Implementation must follow
the merged specification, architecture proposal and reviewed delivery plan.

TCP-REVIEW-01 — **Completed** (planning review and corrections; owner: Codex
control-plane planning thread, 2026-11-06). Owner requested review against separate
central/customer Linux hosts and an independent GPT Astra reviewer. One read-only delegate
ran as gpt-6-astra and completed with three high and four medium planning findings. Parent
validated and corrected all seven; no second independent recheck or runtime validation
is claimed. The [review record](docs/thaarei/control-plane-review.md) maps each finding to
its correction and implementing acceptance gate.

Updated architecture, proposed specification, detailed delivery plan, overview and docs
index. The two-host inventory now explicitly includes central Next.js/PostgreSQL and the
customer Turnstile web/API, DMS/local auth, separately owned auth/DMS/Turnstile persistence,
and selected transfer/coordinator/storage/broker/worker/scanner/parser dependencies.
Customer combined-origin login and private identity-service audience/client/scopes/token/
invitation/account transport are mapped to actual configuration. Standalone DMS screen
policy alone is not Turnstile auth compatibility. Defined separate central configuration,
explicit Compose delivery, durable protected reporter secret files, public-key trust,
read-only-container recovery, qualified egress and startup/approval readiness separation.

Corrected signed decision state/revision/sequence and durable-denial semantics, candidate
pairing recovery after receipt expiry, generation-fenced concurrent/crashed rotation,
prior-activation read eligibility versus never-approved/invalid-proof/clock states, and
supported restore quarantine. Central recovery requires independent decision evidence or
fresh approvals; cached rollback records cannot provide missing evidence. Signing-key
compromise requires an independently authenticated trust update, including operator delivery
for disconnected installations. Arbitrary root/VM rollback and automatic offline emergency
revocation are explicitly outside the guarantee. Seven-day approval/daily renewal remains
selected; read/recovery exceptions and other documented product defaults remain proposed.

Verification on 2026-11-06: source/example/Compose review, including read-only inspection of
the separate DMS checkout, covered actual auth validators, private identity transport,
Nginx/Vite routing and the I18 distribution/network declarations without reading private
environments. Parent final checks passed 150 local links/headings across seven documents
and this handoff; 15 requirements map to eight increments and all seven review findings
have correction/gate references. Document whitespace/final-newline checks and git diff
--check pass. No pnpm check/build/test/test:integration, container or target-host checks
ran for these documentation-only changes; no implemented/runtime security claim is made.

Handoff: proceed with TCP-I01 adoption of remaining product defaults and final isolated
runtime configuration, then the documented I02–08 sequence. No active review blocker
remains. Implementation, target qualification and customer cutover remain future work.
All work stays on feat/thaarei-control-plane-plan; no application code, schemas, runtime
configuration, services, credentials or customer data changed; no commit/push/PR/deployment.
The running standalone DMS checkout and other agents' entries remain untouched.

TCP-PLAN-02 — **Completed** (detailed planning; owner: Codex control-plane planning
thread, 2026-11-06). Owner clarified a separate central application with an integrated
backend, approval before customer Turnstile/DMS operation, and health/usage reporting.
The owner then selected seven-day signed approval with daily renewal; this policy is
agreed but unimplemented. Read/recovery access after expiry/suspension, other defaults
and staff-role choices remain proposals for review.

Replaced the earlier registry-only overview and added the proposed
[specification](docs/thaarei/control-plane-specification.md) with TCP-R01–15 and
[detailed implementation plan](docs/thaarei/control-plane-implementation-plan.md) with
TCP-I01–08. The architecture's explicitly proposed central-control section owns topology,
identity/authorization matrix, pairing/credential lifecycle, signed-decision validation,
outage/revocation policy, product-owned reporting sources and versioned machine protocol.
Updated the documentation index and DMS plan cross-reference without adopting a new guard
or rewriting accepted DMS requirements. The earlier TCP-PLAN-01 scope is superseded.

Recommended topology is one Next.js app with its own PostgreSQL and staff identity, plus
separate outbound Turnstile and DMS reporters using distinct product credentials. Local
customer sessions, DMS OAuth/enrollment, resource permissions and single-tenant boundaries
remain separate. No central per-request lookup, customer inbound polling, remote shell,
document/user-content collection, billing or automatic deployment is introduced. Product
approval and reporting freshness/health have distinct state; offline suspension cannot be
instant and reported usage is not tamper-proof billing evidence. Initial setup manifests,
activation acknowledgement, epoch/revision/retry fencing, two-customer isolation,
backup/restore, signing recovery and existing-installation cutover have explicit gates.

Verification on 2026-11-06: read-only inspection covered this branch's architecture,
enrollment services/operator, contracts/plans, workspace standards/toolchain and the
separate DMS checkout's current I18 handoff/enrollment design. Consulted official Next.js
Route Handler/auth/self-hosting documentation, Better Auth v1.7.14 adapter/session sources
and RFC 8725. Local reference/heading checks and requirement-to-increment coverage pass;
manual scope/policy review and git diff --check pass. An inline architecture visual was
previewed at desktop/mobile widths. No pnpm check/build/test/test:integration or container/
target qualification ran for these documentation-only edits; no implementation behavior
is claimed.

Handoff: continue with TCP-I01 to adopt the remaining defaults, client metrics/privacy,
connectivity and isolated fixed-port topology, then I02–04 central app/protocol. Integrate
DMS only after coordination with its owning I18 baseline, followed by Turnstile and full
release qualification. Existing installs need explicit registration/approval before opening
enforcement. The branch remains feat/thaarei-control-plane-plan, with no runtime/schema/
credential/customer-data changes, commit, push, PR or deployment. The running DMS branch
and its uncommitted work were not changed.

TCP-PLAN-01 — **Completed** (planning assessment; owner: Codex control-plane
planning thread, 2026-11-06). Reviewed the DMS delivery plan, accepted architecture,
workspace plan/standards, toolchain pins and documentation index. The existing DMS plan
explicitly excludes a separate management portal. Drafted the proposed
[Thaarei employee control-plane plan](docs/thaarei/control-plane-plan.md) with TCP-R01–10,
TCP-I01–05, acceptance gates and open decisions; added it to docs/README.md.

Work is isolated on feat/thaarei-control-plane-plan in its own worktree, based on fetched
origin/development ebd9fdb. The first proposed usable slice is employee access and an
audited client registry; installation inventory follows. The proposal distinguishes client
records from DMS/OAuth registrations, preserves one customer tenant per installation and
standalone runtime independence, and excludes remote provisioning and unspecified business
activities. Proposed architecture remains unaccepted; architecture.md was not changed.
Local runtime topology must be settled before service work because reserved host ports
23600–23608 are already assigned. Later DMS implementation in the separate checkout was
not copied into this branch or reassessed; preserve its newer handoffs when integrating.

Verification: local link/heading validation passed for all 27 references in the new plan
and documentation index; 10 unique requirement rows and five delivery increments checked.
Manual scope/boundary review and git diff --check passed. Documentation-only work: pnpm
check/build/test/test:integration and container/runtime qualification were not run; no
runtime behavior or deployed acceptance is claimed. No code, schemas, credentials,
services or customer data changed; no commit/push/PR/deployment performed.

Handoff: owner reviews first-release activities, staff identity/MFA/recovery and client
visibility, required client fields/retention, and repository/hosting/test topology. Next
planned step is TCP-I01 scope/design adoption, followed by TCP-I02–03. Implementation has
not started; no DMS dependency blocks drafting or the proposed registry work.

DMS-I03-REVIEW — **Completed** (owner: Codex, 2026-11-05). Owner requested
Open Code Review plugin review of I03, fixes and commit. Used the installed OCR
host-delegation skill for deterministic selection/rules and a separate read-only reviewer.
All 93 staged I01–I03 paths were reviewed (73 OCR-selected plus 20 supplemental exclusions),
with zero skips; I03 was the primary scope. No critical/high finding or authorization/RLS
bypass was found. Both reported findings are corrected: the medium formatted-timestamp
alias sort now orders on stored timestamp/ID and has a real PostgreSQL EXPLAIN regression
against the production page SQL; the low fresh-setup omission now explains optional private
role credentials, distinct passwords and NOLOGIN behavior. Reviewer inspected both fixes.

Post-fix pnpm check/build/test/test:integration pass; integration ran uncached with 28
Fastify and 230 PostgreSQL cases across 16 database files. All three generated contract
drift checks and git diff checks pass. No post-fix image rebuild is claimed; I03's earlier
standalone image evidence remains recorded below. OCR artifacts:
/tmp/dms-i03-ocr-{preview,rules,review}.json and pagination-explain.txt. The review report
accounts for every path and records both finding dispositions. The owner-authorized local
commit includes the staged I01/I02 dependencies, I03 and these corrections on
feat/dms-i01-standalone-foundation. No live installation/data/credentials changes,
deployment, push or PR. Future document audit and dispatch remain with their owning features.

DMS-I03 — **Completed** (owner: Codex, 2026-11-05). Implemented owning
persistence/access/audit on feat/dms-i01-standalone-foundation while preserving I01/I02
and the existing installation. Scope: transaction-scoped principal/tenant context on
the owning pool, live resource policy, immutable bounded application audit and atomic
outbox intent, narrowly privileged private operator reads with fresh identity/current
grants, generated public/private contracts and real PostgreSQL boundary verification.
Document-specific records/routes extend this boundary with their owning feature; no
placeholder document schema, live installation migration or deployment is authorized.
Implemented owning machine transactions with live locked registration/scope checks, local
principal context reset and failed-rollback pool eviction; migrated enrollment/capabilities
to this boundary. Added forced-RLS bounded application audit/outbox with composite
references and atomic enrollment/replay behavior, owner-scoped GET /v1/audit, signed keyset
cursors, a distinct private operator read context and dedicated least-privilege operator/
coordinator roles. Private reads authenticate every invocation, recheck installation/current
grant and record attributed inspection evidence; supported grant/revoke uses the same
command fence. Generated public and separate private command contracts, documented the
explicit role-provision-before-migration upgrade, and preserved I01/I02 behavior.

Final verification (2026-11-05): pnpm check, pnpm build, pnpm test and
pnpm test:integration pass. Integration ran uncached: 28 Fastify cases and 230 PostgreSQL
cases across 16 files. Real database regressions cover role escalation/auth separation,
forced RLS, cross-tenant/application references, pooled context after commit/rollback,
owner isolation, live scopes/operator grants, supported revocation/recovery, signed cursor
binding/timestamp tie-breakers, no fictitious state-change replay and failed-outbox atomic
rollback. The freshly built thaarei-dms-i03:verification image passes all ten isolated
standalone cases, including independent consumers and source/packaged Chromium explorer.
Generated consumer, legacy auth and private operator contracts pass drift checks;
git diff --check passes. Fixture cleanup preserves independent first-bootstrap testing.
The interrupted run's two disposable fixtures were removed, and final fixtures cleaned up.

No existing installation data, credentials, live containers or deployed release were
changed. At the implementation handoff these changes were uncommitted and no I03 review had
been claimed; the subsequent authorized OCR review/fixes and local commit are recorded
above. The feature branch contains freshly fetched development and preserves I01/I02. Before target rollout, provision the new private roles and run
the owned DMS migrations using the audit runbook. Document-specific audit/resource-grant
extensions and actual outbox dispatch remain with their later owning features.

DMS-I02-REVIEW — **Completed** (owner: Codex, 2026-11-04). Owner requested an
OpenCode DeepSeek V4.1 Flash review with high thinking effort and fixes for findings.
The read-only delegate ran opencode-go/deepseek-v4.1-flash with variant high and found
one confirmed P2 stock-explorer alias issue, one P3 generated-description defect, and an
unverified operational concern about ambient proxies. No authority bypass was reported.

Fixed the stock entry/config surface in the docs scope after its existing access check:
index/directory aliases redirect to /docs/, only explicit schema/static assets are served,
and stock top-level initializer/other wildcard files are rejected. Required local assets
and packaged third-party notices remain available. Added authenticated/unauthenticated
alias/config regressions and real Chromium checks that index.html reaches the hardened
UI; image checks also probe canonicalization and stock-initializer rejection.
Corrected public identity, capability and enrollment create/replay descriptions in the
shared OpenAPI builder, regenerated the artifact and added semantic distinction checks.
Made Python and curl examples explicitly direct-only (ProxyHandler({}), noproxy), updated
the runbook/architecture and verified Python ignores unusable ambient proxy settings with
an isolated HTTP probe. Existing I01 work and owner installation remain preserved.

Post-fix verification: pnpm check/build/test/test:integration all pass with normal Turbo
caches. Integration runs uncached: 28 Fastify tests and 225 PostgreSQL cases across 16
files. The freshly built thaarei-dms-i02-review:verification image passes the reviewer's
bare-Fastify reproducer; the dedicated standalone/image lane passes all ten cases,
including independent Python/curl, source/packaged real Chromium, alias handling,
read-only enrollment, cleared bearer state, expired-token denial and no external loads.
Biome and git diff --check pass. Parent verified the corrections; no second delegated
review is claimed. No remaining actionable finding, live data/credential change,
installation migration, deployment, commit or PR. Changes remain uncommitted on
feat/dms-i01-standalone-foundation. Customer ingress/TLS/SMTP acceptance stays separate.

DMS-I02 — **Completed** (owner: Codex, 2026-11-04). Owner authorized contract growth
and manual testing. Extended feat/dms-i01-standalone-foundation, preserving I01's
uncommitted implementation and the existing installation.

Delivered explicit consumer/private package exports with a compatibility root barrel;
the public client uses the consumer entrypoint under dependency-rule enforcement.
Generated docs/api/dms.openapi.json from shared Zod schemas and the implemented
route/security catalog; retained and drift-checked the legacy dms-auth artifact. Root
checks cover finite errors/status families, request/header examples, local references,
unique operations and shared positive/negative fixtures in Zod, Ajv 2020 and Python.
Runtime checks observe every physical versioned Fastify route (including HEAD) and
compare Nest handler/guard metadata with the catalog. Responses retain authoritative
request IDs/no-store caching and now provide bounded 503 retry guidance; revision/202
conventions are reserved without introducing future feature endpoints or schemas.

The protected bundled explorer serves /docs and /docs/openapi.json on the DMS listener,
with protected JSON/YAML/configuration/assets. It is off by default; enabled access uses
a separate generated key, loopback/controlled binding policy and production HTTPS.
The browser offers only ephemeral machine bearer input, clears it on reload and disables
enrollment execution/key input. It loads local assets only, with restricted CSP and no
validator/CDN/analytics. Independent stdlib Python/curl recipes obtain a token, enroll and
read capabilities without workspace imports. Architecture, environment examples and the
manual operator-to-token runbook are updated. Exact dependencies/lockfiles and packaged
third-party notices retain the Swagger asset licenses; Scarf's install script is disabled.

Verification (2026-11-04): pnpm check/build/test/test:integration all pass, retaining
normal Turbo caches. Integration runs uncached: 27 Fastify tests plus 225 PostgreSQL
cases across 16 database files. The dedicated standalone lane with the freshly rebuilt
thaarei-dms-i02:verification image passes all ten cases, including independent Python/curl,
real Chromium source/packaged explorer, token acquisition outside the browser, capability
read, missing/wrong/genuinely expired JWT denial, cleared auth after reload, disabled
enrollment execution and no external requests/browser storage. Docker Desktop carries
image browser requests over private fixture IPC to real container HTTP; authorization
and responses are not mocked and no host service port is published. Manual image
inventory verifies nonroot execution, local assets/LICENSE/NOTICE/bundled dependency
notices and no Turnstile package/schema. All 180 checked relative documentation targets
resolve; Biome and git diff --check pass. Browser verification corrected an upstream
query/relative-URL issue and fixture selectors/transport; initial failing attempts are
not represented as passing. The final complete checks and image qualification pass.

No I02 database migration, live credential/data modification, deployment, commit or PR
was performed. Documentation stays disabled on the preserved owner installation. Actual
customer ingress/TLS/access-control/SMTP rollout remains separate. No I02 blocker or
remaining implementation work; next planned package is DMS-I03, pending owner instruction.
Changes remain uncommitted on the current branch for review.

DMS-I01 — **Completed** (owner: Codex, 2026-11-04). Owner authorized standalone
foundation implementation and subsequent DeepSeek V4.1 Flash high-effort review.
Implemented on feat/dms-i01-standalone-foundation from fetched origin/development.

Delivered explicit standalone configuration, exact per-client login/recovery/logout
policies, persisted browser-bound authorization continuation, auth/DMS-only provisioning
and foundation Compose/environment/runbook. Private operator bootstrap, assignment,
revocation and recovery use fresh verified identity, separate maintenance authority,
explicit tenant-bound grants, forced RLS migration 0005 and attributed atomic audit.
No document capability, Swagger UI, Turnstile schema or new runtime dependency is added.

Post-review verification: pnpm check/build/test/test:integration all pass with normal
Turbo caches retained; integration runs uncached and passes 21 Fastify plus 225 PostgreSQL
tests across 16 database files. The separate standalone lane passes all eight cases,
including real Chromium, two independent machine enrollments/capability reads, recovery,
operator denial/recovery, unchanged audit on rejected commands and bounded continuation
cleanup preserving active/provider records. DMS_STANDALONE_IMAGE verification proves the
refreshed production image becomes ready and serves direct discovery with auth/DMS-only
schemas/runtime credentials. Separate manual image inventory confirms nonroot execution,
private tools and auth/DMS migrations without Turnstile packages/schema/source. An
unprovisioned image returns liveness 200/readiness 503. Installed Docker Compose validates
the standalone profile; relative documentation targets and git diff --check pass.
An initial overlapping local build/compiled-fixture run failed; serial reruns pass.

DeepSeek V4.1 Flash (opencode-go/deepseek-v4.1-flash, variant high) completed the requested
read-only review. Fixed both P2 findings: operator commands now validate installation
read-only, installation bootstrap audits only real creation, and interaction capture
reclaims at most 100 expired continuation rows with SKIP LOCKED. Addressed both P3
findings with supported new-client destination migration, current combined/standalone
auth guidance and concrete private-network/environment-file commands. Aligned subject
input with the 128-character audit bound. Existing authority SDK tests already cover the
reviewer's suggested combined login-page regression; no duplicate test was added.
The parent verified the corrections; no second delegated review is claimed.

No existing installation migration, data/credential reset, deployment, commit or PR was
performed. Customer Dokploy/TLS/SMTP acceptance remains separate from isolated local
verification. No I01 blocker or remaining implementation work. Subsequent owner-authorized
I02 work is tracked above. Changes remain uncommitted on the requested branch for review.

DOC-ORG-01 — **Completed** (owner: Codex, 2026-11-04).
Owner requested organizing documentation before DMS implementation and updating references.
Moved 14 loose documents into docs/dms/, docs/authentication/, docs/workspace/,
docs/turnstile/onboarding/, docs/turnstile/user-management/ and docs/turnstile/.
Added docs/README.md as the reading index and linked it from root README/architecture.
Updated relative and repository-path references across plans/specifications, runbooks,
progress, architecture, app/package READMEs and AGENTS guidance, the authentication
presentation and the design-system catalogue/footer CSS comment. Kept generated API
artifacts, presentations and runbooks in their existing folders; preserved root LICENSE,
notices, architecture/progress/agent files and the prior DMS planning changes.

Verification: 509 relative Markdown/HTML targets resolve; no original loose-doc paths
remain in tracked/unignored text files. Biome formatting and git diff --check pass.
pnpm check/build/test/test:integration all pass; build used 5/7 cached tasks, unit test
pipeline 6/9 cached tasks, and integration ran uncached (21 Fastify plus 218 PostgreSQL
cases across 15 database files). No new tests were added for this documentation/path
change. The existing non-fatal frontend chunk-size advisory remains. No runtime,
provisioning, schema, dependency, credential or deployment change was made; no commit/PR
was requested. Existing owner-test installation is preserved. Next: use docs/README.md
and docs/dms/dms_implementation_plan.md for DMS-I01/I02; implementation has not started.

DMS-PLAN-01 — **Completed** (planning; owner: Codex, 2026-11-04).
Owner requested a detailed DMS plan (called EMS in parts of the request), independent
of Turnstile, with external-application integration, Swagger-style manual testing,
current/selected libraries, standalone completion and a final GPT Astra review.
Created [the standalone DMS implementation plan](docs/dms/dms_implementation_plan.md):
20 requirement-mapped delivery packages covering independent authority/provisioning and
packaging, generated public/private contracts, protected Swagger, secure direct transfer,
durable work, security/publication, versions/metadata/grants/lifecycle, extraction/OCR/
optional structure, search, operations, recovery and independent qualification. Inspected
actual source/manifests/configuration rather than treating reserved modules as complete.
Architecture records the standalone delivery target; the workspace plan links the sequence.

GPT Astra (`gpt-6-astra`) completed the requested read-only final review and returned two
P2 planning findings. Both are reconciled: I01/I03 define private tenant-operator commands
with fresh identity plus explicit DMS authorization, assignment/revocation/recovery and
negative consumer/session tests; I01 and release acceptance require an independent
consumer-owned login/consent/verification/reset continuation fixture proving PKCE,
logout, expiry/revocation and recovery without Turnstile. Review dispositions are in
section 11 of the plan. The parent checked the corrections; no second review is claimed.

Verification: all four required workspace commands pass (`pnpm check`, `pnpm build`,
`pnpm test`, `pnpm test:integration`). Build/unit retained normal Turbo caches; integration
ran uncached and passed 21 Fastify plus 218 PostgreSQL cases across 15 database files.
An initial Markdown table-formatting check failed and was corrected with Biome before
the passing checks. Document formatting/whitespace, 83 relative link targets and all
20 ordered package sections pass. No new tests were added for this documentation-only
change. The existing suites do not establish future standalone-stack/Swagger/library
compatibility; those implementation and target checks remain explicit plan gates.

Only this entry, architecture, workspace plan and the new DMS plan changed. No dependency,
feature code, persistent installation migration, credential/provisioning change, runtime
reset, deployment, commit or PR was made. Disposable verification fixtures preserve the
active owner-test installation. Next implementation scope is DMS-I01, then DMS-I02;
planned entries do not authorize starting the features. No planning blocker remains.

UM-UI-PR-01 — **Completed** (owner: Codex, 2026-11-04). Owner authorized checking
in the accumulated access UI redesign, creating a PR to parent development, resolving
CI/review issues and merging after green checks. Committed all 27 intended web/test/doc
files as 86112792dadb7a4d8be8b6bf7c010f2a7826a3c8 and created PR #9 targeting
development. No backend/schema/dependency/lockfile, License/notices or private runtime/
credential file was included. Preserved the previous work and other agents' entries.

Both push and PR workflows passed their checks job and all five image builds on the exact
8611279 head: 12 successful check runs, no failures. PR was clean/mergeable with no review
or comment objections. Merged through the SHA-matched PR merge API at 2026-11-04T11:24:38Z
as bd7f1a28f0d76fc47f070e7f8430c337105eb779. GitHub initially returned internal Git/
GraphQL errors; HTTP/1.1 non-thin Git push and REST PR creation/merge succeeded without
creating duplicates. Local development now matches origin/development at bd7f1a2.
The merge tree matches the reviewed feature head. No main branch operation occurred.

Local check/build/test/integration and expanded real HTTPS People browser suite passed
as recorded in UM-PANELS-UI-01; compiled smoke and both CI Compose configurations also
passed during PR preparation. Read-only post-merge runtime verification confirms all seven
services running, six configured healthchecks healthy and web HTTP 200. No runtime/data
reset, reseed, account change or service replacement occurred during this PR task.
The development post-merge workflow 41820619096 was still running at handoff; its result
is not claimed as passed. All pre-merge checks are green and merge is confirmed. The prior
development workflow 41800545904 also passed. T3 PR watch is stopped before owner handback.
Only this current local progress handoff remains uncommitted; application source is merged.
Next: owner continues acceptance testing at localhost:23600 with existing credentials.

UM-PANELS-UI-01 — **Completed** (owner: Codex, 2026-11-04). Owner requested
Members Invite person to navigate and open the composer in one action and consistent
redesign of People/access inspector forms, reviews and follow-up states. Members now
carries a one-shot router-state intent; the owning Invitations route consumes it with
history replacement. Cancelling and ordinary tab navigation do not reopen it; another
Invite person action opens a fresh composer. No invitation or role is created on navigation.

Added the shared Card panel variant, quiet task header/kicker/close control, scrollable
body and persistent action footer for role/invitation/member forms and structure actions.
Impact/uncertain-result actions render into the same footer via a portal while their
owning Review component retains its key/state. Pending/uncertain writes disable header
close. Dirty header close and role-action switches protect unsaved entries; explicit
Cancel discards transient form changes. Removed the heavy noninteractive focus outline;
panels scroll into view at all widths and use natural page scrolling on narrow screens.
Screenshot inspection corrected primitive spacing, label alignment and panel height.

Permission choices are grouped by purpose with required/company labels and plain-language
scope explanations; role description uses a textarea. New assignments start with no role
selected rather than silently choosing the first eligible role. Invalid/incomplete new
invitations cannot enter review. Routine reload/advanced actor-grant noise was removed
from normal form entry while failure retries remain. Saved invitations show read-only
approval/lifecycle/coverage summaries. Reviews explain the current intended change,
affected access and save uncertainty, with consistent confirmation/readback actions.
No backend/contract/schema change, permission widening or data migration was made.

Verification, 2026-11-04: pnpm check/build/test/test:integration pass (21 Fastify and all
218 PostgreSQL cases). Expanded real HTTPS People browser suite passes direct navigation/
composer opening, cancel/reopen/consumed intent, explicit initial role choice, role create/
copy, invitation approval and recipient lifecycle, member overview/edit/save/cancel and
status, stale/uncertain outcomes, close disabled while uncertain, independent loaders,
dirty/session recovery, scoped structure operations and narrow layouts. Final layout
browser run passed, with fixture-only screenshots inspected for role creation, invitation
composition/review and recovery. Final minor permission-count grammar cleanup also passed
static/build/unit checks. Production web image and Compose configuration validation pass;
existing chunk-size advisory remains non-fatal. No test timeout or policy was relaxed.

Activated immutable web image
081e968373f1bd292f03618d91d5e686a4b5cae21bd8d008ccbe445760247fbd
using the existing private web-only overlay. Protected rollback/container evidence:
`/home/dev/.local/state/thaarei/turnstile-360/ui-redesign/panels-20261104/`.
All seven services run and all six configured healthchecks pass; four access entry URLs
serve HTTP 200 and match final compiled HTML. Only the web container changed; all other
six identities, including PostgreSQL, remain unchanged. Existing data/accounts/credentials
are intact. No reset, seed, migration, authority provisioning, PR/push/merge or additional
agent work occurred. Work remains local on feat/access-workspace-redesign, preserving
previous changes and other agents' entries. Next: owner tests the updated panel workflows.

UM-MEMBERS-UI-01 — **Completed** (owner: Codex, 2026-11-04). Owner requested a
functional redesign of the Members screen shown in the attachment (called numbers in
the request). Implemented compact person/contact/status/role-coverage directory rows and
a direct Invitations entry. Selection opens a saved-access overview instead of an opaque
ID and immediately editable form. Explicit Edit access opens stacked role/scope controls;
Cancel changes restores saved assignments. Membership suspension/reactivation has its own
explanation and existing impact review. Per-role permission disclosures preserve their
coverage binding; active imported company grants stay visible. Immutable account IDs,
identity-display state and retired imported-source history are secondary details. Identity
availability and membership status remain separate. Routine role-choice refresh controls
and long permission previews use disclosures. Counts label matching results without
inventing whole-directory statistics. Added an inert gallery example and design guidance.

The owning browser regression found that reopening immediately after a save could capture
old list assignments. Directory selection is now fenced through fresh session refresh and
list loading; explicit reload sets loading synchronously. The owning test checks updated
saved roles before reopening. No backend, schema, contract or stored permission changed.
Existing session/draft fencing, status protection, grant ceilings, uncertain-write recovery,
review/confirmation and independent authorized loaders remain in place. Previous work and
other agents' progress entries were preserved on feat/access-workspace-redesign.

Verification, 2026-11-04: pnpm check, pnpm build, pnpm test and pnpm test:integration pass
(21 Fastify and all 218 PostgreSQL cases). Expanded real HTTPS People browser suite passes
member overview/edit/save/readback/cancel, suspension/reactivation, system-role copy,
child-coverage defaults, invitations/delivery/recipient verification/acceptance, scoped
structure, stale/uncertain reviews, independent loaders and draft/session recovery, plus
narrow Members overflow. A separate attempt failed at disposable Mailpit startup before
browser requests; bounded command exit/signal/error diagnostics were added without raw
logs/secrets or timeout changes. The subsequent full browser run passed. Final minor
copy/count-grammar cleanup also passed static/build/unit checks. Production web image
build and Compose validation pass; the existing chunk-size advisory remains non-fatal.

Activated web image
27b7d0420709f69623f1ba1dab0bfd1fe499cd6a43030b794e4ba2065d47687c
through the existing private web-only overlay. Protected rollback/container evidence:
`/home/dev/.local/state/thaarei/turnstile-360/ui-redesign/members-20261104/`.
Only the web container changed; the other six container identities, including PostgreSQL,
are unchanged. All seven services run, all six configured healthchecks pass, and Members
returns HTTP 200 with HTML matching the final build. Data/accounts/credentials are intact;
no reset, seed, migration, PR/push/merge or identity provisioning ran. Next: owner tests
Members at localhost:23600/people/members using existing credentials.

UM-UX-FIX-01 — **Completed** (owner: Codex, 2026-11-04). Implemented owner-
authorized navigation/workflow consolidation from UM-UX-AUDIT-01 on the existing
feat/access-workspace-redesign branch. Sidebar groups Members/Invitations/Roles under
People & access; sidebar and peer links use requested-route aria-current and explicit
primary emphasis. Structure is separate, without the misleading People strip. Old Settings
Structure and Workspace URLs redirect to the canonical Structure and General settings
pages. General settings combines organization name/time zone. Setup overview and the
legacy empty-unit prompt link to canonical Structure; onboarding remains independent.

One scoped Structure controller/editor serves chart and outline presentations, site/child
creation, rename, move impact/confirmation, deletion and uncertain-command readback.
Company managers can create sites, including completed legacy empty structures using an
authorized root-context read. Scoped users never fetch that company profile. Read-only
units show View/details without mutation controls. Editing drafts stay mounted and inert
when management is revoked, and survive directory filtering. New unit-scope choices default
Include child units on; existing assignments are copied unchanged. Roles use one selected
operation (details/permissions/custom copy/delete) with relevant fields and explicit review;
system templates remain immutable and copy names start distinct. No backend, contract,
schema, stored grant or product rate-limit changes were made.

Verification, 2026-11-04: pnpm check/build/test/test:integration pass, including the focused
read/exact/subtree/company control test, all 21 Fastify and 218 PostgreSQL cases. Expanded
real HTTPS People browser suite passes system-role copy, new child-coverage default,
sidebar/peer highlighting across all three People routes, old-route redirects, General
settings presence, chart/outline selection, root site creation/deletion, role creation,
stale/uncertain review, invitation approval/account verification/acceptance, member status,
independent loaders, draft/session recovery, scoped moves/collapse and narrow layouts.
Auth/onboarding/Settings browser suite also passes combined profile/zone persistence,
dirty navigation, stable activation/root, narrow layouts, permission revocation/restoration,
authenticated refresh and full login/recovery/logout journeys. Updated obsolete Settings
editor tests to the consolidated workflow; test:browser:structure now aliases the owning
People fixture through the existing flag. Removed the retired Settings-only visual test.
Test fixes wait for confirmed deletion before navigating, clear owning fixture rate buckets
between added stages and retain a second configuration manager during revocation. Product
safety invariants, rate limits and timeouts were not relaxed. No failed check remains.

Built and activated web image
f11e101da2a0c34db0cd9fd7f2f5e7e69ebfde632d79f5ac6f4a347625a44db9
through the existing private web-only Compose overlay. Rollback/container evidence is
protected outside Git under
`/home/dev/.local/state/thaarei/turnstile-360/ui-redesign/workflow-fixes-20261104/`.
All seven services run and all six configured healthchecks pass; five public entry URLs
serve HTTP 200 and match the final compiled index. Only the web container changed; all
other six identities, including PostgreSQL, are unchanged. Existing data/accounts and
credentials remain intact. No reset, seed, migration, PR/push/merge or authority provisioning
was performed. Next: owner acceptance testing at localhost:23600 using existing credentials.
Other agents' entries and prior implementation work were preserved.

UM-UX-AUDIT-01 — **Completed** (assessment; owner: Codex, 2026-11-04).
Traced current workspace navigation, Settings/People routes, both structure editors and
controllers/services/repository policy, role catalog, assignments, invitation actions and
impact/recovery UI. Settings Structure and root Structure edit the same canonical hierarchy;
the Structure link under Roles is the root route repeated by peer navigation, not another
structure or a role-owned feature. Settings uses company configuration snapshots/chart
editing; root uses authorized scoped projections and current impact/receipt commands.
Confirmed the old Settings move endpoint rejects effective member/invitation coverage
changes because it has no impact confirmation contract; root provides the required review.
No bypass or duplicate hierarchy storage was identified in this source assessment.

Recommended one root Organization structure destination with chart/outline presentations,
a shared permission-aware editor and reviewed completed-workspace mutations; replace the
Settings structure editor/tab with a link/redirect. Keep onboarding as its own guided entry
and keep profile/time-zone/setup data company-only. Group Members/Invitations/Roles under
People & access and remove the repeated cross-section strip from standalone Structure.
Preserve independently gated child routes/loaders, role-vs-scope separation, additive grants,
protected roles/members, scoped visibility, audit, impact confirmation and uncertain readback.
Flagged current UI issues: read-only visible units still expose Manage/actions that the
server must reject; Include child units initializes false at new unit-scope entry points
despite D01/UM-R05 requiring a true default; role editor separate details/permission/copy
review actions and repeated reload controls create unnecessary workflow friction. These
are findings/recommendations, not implemented changes. Existing saved coverage must never
be altered to fix a new-assignment default. Four system roles remain useful and distinct;
manage implies read, but removing the explicitly frozen stored read permission is unnecessary.
Current permissions administer the workspace and unit tree; no delivered document/business
permission model is implied by role names or the Document connection capability label.

Verification: read-only source/specification inspection and git diff --check passed.
No application source, tests, accounts, permissions, containers or data changed for this
assessment. No build/browser/runtime verification was run; earlier redesign checks remain
separate evidence. Next: owner considers the consolidation recommendations; implementation
of this additional navigation/workflow consolidation has not started.

UM-UI-REDESIGN-01 — **Completed** (owner: Codex, 2026-11-04). Owner requested
a consolidated modern redesign of Roles and scoped Structure. Implemented on
feat/access-workspace-redesign from current development: shared compact search/filter/
reload toolbar and adjacent non-modal editor; role comparison table with permission,
system and protected labels; expandable hierarchy reconstructed solely from scoped page/
path context. Ancestors remain non-actionable and result counts exclude them. Narrow
layouts place the editor before its directory. Unit editing now selects one rename,
child-create, move or delete operation and exposes only relevant fields, with the saved
unit path in the inspector. Preserved independent permissions, owning APIs, transient
drafts, dirty navigation, impact review/confirmation and uncertain-write readback.
Added the installed shadcn Table primitive, inert gallery examples, architecture/design
guidance and two focused ancestry/projection tests. No backend/schema/contract change.

Verification: final pnpm check, pnpm build, pnpm test and pnpm test:integration passed
(21 Fastify cases plus all 218 PostgreSQL cases across 15 files). The real HTTPS People
browser suite passed role creation/system-role inspection, stale/uncertain reviews, invitation approval/
acceptance, member status changes, independent authority/loaders, same-subject draft
retention, hierarchy collapse/context isolation, moves and narrow-screen overflow checks.
Fixed an ambiguous search accessible label found by the first browser run. Final minor
badge/path presentation cleanup also passed static/build/unit verification. Production
web image build and Compose configuration validation pass; the existing Vite chunk-size
advisory remains non-fatal. No identity/security constraint or test timeout was relaxed.

Local web updated using immutable image
b25d56214261944b4e39fbd40b8b7f8fef058c636bd25dfe185467ae5ebb6bd7.
A private web-only Compose overlay is appended to the ignored local environment; rollback
configuration/container evidence is mode-protected outside Git under
`/home/dev/.local/state/thaarei/turnstile-360/ui-redesign/20261104/`.
Only the web container changed; all other six container identities, including PostgreSQL,
are unchanged. All seven services run, all six configured healthchecks pass, and served
HTTP-200 HTML matches the final build. Existing accounts, credentials and data remain in
place; no reset/reseed/migration ran. Earlier exact-image release evidence is historical
and does not certify this new web image. Changes remain local on the feature branch;
no redesign PR, push or merge was requested/performed. Next: owner reviews Roles and
Structure at localhost:23600. Other agents' progress/handoff entries were preserved.

NEXT-WORK-01 — **Completed** (assessment; owner: Codex, 2026-11-04).
Reviewed current position, pending work, accepted architecture/component boundaries,
workspace plan, DMS capability dependencies and representative DMS/Python source shells.
Recommended starting a requirement-mapped DMS delivery plan/foundation-gap review,
Turnstile business-workflow discovery and operational readiness assessment in parallel.
DMS implementation should advance through registry/policy/upload, durable execution,
assessment/publication and authorized retrieval before promising usable document storage;
extraction/OCR/search follow their accepted dependencies. Python runtime preparation can
proceed independently, but real publisher/worker integration requires agreed private
job/dispatch contracts and the owning DMS coordinator APIs. Keep shared contracts,
authority, migration ownership, lockfiles/Compose and shared documentation coordinated.
The accepted control plane is the DMS TypeScript API/codebase, with a future separate
coordinator process from the same image; no separate administration frontend is established.
If the owner means another control-plane application, identify its scope/repository before
assuming it is this component or implementing a new portal. Other systems need separate
registrations and product requirements; do not expand to multi-customer provisioning.
Latest local reset supersedes historical preserved-installation handoffs; customer/production
acceptance and the recorded Windows time-source freshness follow-up remain separate.
Verification: read-only documentation/source inspection and `git diff --check` passed.
No build, tests, runtime mutation, deployment, feature implementation or new branch was
performed for this planning assessment. Only this entry was added; prior working-tree
progress edits were preserved. Next implementation requires selection of the workstream;
this assessment does not authorize planned features.

DMS-PARALLEL-01 — **Completed** (assessment; owner: Codex, 2026-11-04).
Reviewed README, workspace/app instructions, accepted DMS blueprint, all capability-group
boundaries/dependencies, relevant architecture and user-management plan, and current source
scaffolds/contracts/client. DMS document implementation can proceed alongside Turnstile
People/access work: consumer business authorization stays in Turnstile; DMS authorizes
registered applications. AUTH-01–07 supply implemented foundations, not completion of
requirement groups 01–04. Document/upload/storage/processing/search/lifecycle modules remain
shells and the Python runtime has no processing dependencies or tasks. Full accepted v1
also requires secure publication, durable jobs, extraction/OCR, optional enabled structured
processing, search, quotas, operations and recovery; HTTP CRUD alone is insufficient.
Coordinate shared platform-auth/identity-service contracts and migrations, machine scope
ceilings/capability contract expansion, root lockfiles/Compose and shared documentation.
Use a separate worktree/branch from up-to-date development, consume shared authority changes
through development, and isolate fixtures from the active UM-RELEASE-RESET-01 runtime.
Recommended next authorized implementation step: a requirement-mapped DMS delivery plan
with foundation-gap acceptance, ordered vertical increments and verification/recovery gates.
Verification: read-only source/status inspection and documentation diff review; no runtime,
lint/build/test commands run for this assessment. Only this handoff entry was changed;
no feature work, runtime mutation, new worktree/branch or release action was started.

UM-RELEASE-RESET-01 — **Completed** (owner: Codex, 2026-11-04). Owner explicitly
authorized committing the accumulated user-management implementation, creating/merging a
PR to its parent development branch after green CI, and deleting/recreating this
application's local runtime containers/test resources and persistent database/storage.
Bootstrap exactly one administrator, leave fresh company setup for owner testing, and
deliver credentials privately outside Git/logs. Scope resource deletion by this repository's
Compose project and verified fixture ownership; preserve other projects, source, private
configuration access and existing protected release evidence. Inspect actual CI and runtime
state before mutations; record reset, provisioning, verification and merge results.

Reset/provisioning completed: removed all seven turnstile-local containers and all three
project data volumes (PostgreSQL, RabbitMQ and SeaweedFS), plus the two verified orphaned
Turnstile Mailpit test containers. Recreated the entire scoped stack; other projects were
untouched. Installed fresh dedicated database credentials, cookie/token/invitation secrets
and an external invitation epoch through private files only. Owning migrations/bootstrap
create four authority, five DMS and 28 product migration entries, explicit access templates
and empty revision-0/v2 setup. No old data was imported or restored.

Exactly one authority account was provisioned through the supported private command and
verified through captured Mailpit mail, without direct verification-flag updates. Issued
three distinct OAuth clients; registered/enrolled the product machine. Real normal OIDC
login supplied the proof for private protected-administrator bootstrap and feature opening.
Retired the temporary canonical legacy bootstrap source: one canonical member remains,
with one protected administrator, zero active legacy grants, no child units/invitations and
no company name/zone/completion. Normal login returns the onboarding route and permits
configuration. The default administrator role correctly receives 403 for the separately
granted DMS capability-read permission; machine activation was verified independently.

All seven services are running, with each configured healthcheck passing (SeaweedFS has
no configured healthcheck). The stack uses the prepared exact-image local Compose overlay
and canonical loopback routing; the root private environment selects it for subsequent
Compose commands. Credentials and nonsecret verification are retained mode 0600 outside
the checkout under `/home/dev/.local/state/thaarei/turnstile-360/local-resets/20261104/`.
No password or service credential is recorded in Git or this progress log.

Committed implementation as aee1c8e and opened PR #7 targeting development. Both original
push/PR workflows passed their checks job and all five image builds. Local compiled-entrypoint
smoke and both Compose configuration checks pass. PR #7 merged as ec07a12 after all checks passed, and its development push workflow also
passed. The reset handoff followed through documentation-only PR #8, merged as 266044b
after every push/PR check passed on bacf7c4; no review objections were present. The checkout
is on development at that merge, preserving the concurrent DMS assessment. Final read-only
runtime checks confirm all seven services running, all six configured healthchecks healthy
and the application returning HTTP 200. The documentation merge push workflow
41800545904 was still running at handoff; its pre-merge push/PR checks passed, and the
implementation merge workflow 41798766810 passed. No further reset occurred.
All credentials are available only through the protected local CREDENTIALS.txt handoff.

UM-VERIFY-02 — **Completed** (owner: Codex, 2026-11-04). Owner requested the
next verification in the accepted release plan. Recheck the retained clock preflight,
candidate/private-bundle integrity and required workspace checks; run trusted runtime
acceptance only after the stability gate passes. Continue independent isolated image/archive
verification as applicable. Preserve the existing installation and all earlier evidence;
no target migration, credential rotation, feature opening or WSL restart is part of this
verification request. Record actual outcomes and any blocked acceptance separately.

Verification milestone: required check/build/unit commands pass (normal workspace caching
retained). The private bundle hashes/permissions match the recorded candidate. Exact-image
and protected-archive isolated verification are running alongside a fresh strict 180-second
clock sample. Ubuntu timesyncd remains inactive/disabled; Windows still reports leap 0 and
stratum 5 but its latest sync attempt reports stale data (error 2). This warning is tracked
separately from measured guest-clock stability. No further host setting was changed.
New evidence: `/tmp/turnstile-verification-20261104-7kiOhC/`.

The fresh 180-second clock preflight passed: 1,797 samples, no backward intervals and
no relative steps above the retained 5 ms diagnostic threshold (range approximately
-3.55 to +0.06 ms). Exact-image checks and archive rehearsal pass against the unchanged
prepared release ID. Continuing runtime verification with continuous clock monitoring.
The formerly failing DMS enrollment suite now passes all six cases, including private
credential issuance; no timeout or validation was changed. Full integration and owning
browser verification remain in progress; no release gate is opened by these fixtures.

Runtime milestone: the complete integration command now passes all 21 Fastify and 218
PostgreSQL cases without diagnostic overrides or timeout changes. Auth/onboarding/Settings
HTTPS browser regressions also pass. Continuous clock observation has not recorded a
discontinuity so far. People, fresh structured onboarding and visual structure browser
acceptance remain to complete; earlier failures are not assigned a cause solely from
their non-reproduction in this run.

Final verification, 2026-11-04: all required check/build/unit commands, complete integration
(21 Fastify plus 218 PostgreSQL cases across 15 files), all four owning HTTPS browser
suites (auth, People, fresh structured onboarding and visual structure), exact production
images and protected archive rehearsal pass. No source fix, validation relaxation,
diagnostic override, timeout change or repeat-until-pass was needed in this run. Normal
workspace task caches were retained; database and browser suites execute uncached.

The 180-second clock preflight passed with zero backwards intervals or relative steps
above 5 ms. Continuous monitoring throughout runtime verification also passed: 573.048
seconds, 5,714 samples, zero backwards intervals/steps, approximately -3.58 to +0.86 ms
relative range. This establishes observed stability for this verification window, not a
permanent platform-clock guarantee or proof that prior failures were caused by time.
Windows still reports leap 0/stratum 5, but latest resync error 2 (stale time data) remains
an unresolved source-freshness warning. Recheck time/source before cutover and after
host restart/resume; no further host setting or WSL/Docker restart was changed here.

Candidate/image/private-bundle hashes still match release
`280ec04778079cf3c233510fec1a673b260648dc6c4fe3d74c5450a34ac1766b`. Archive rehearsal
preserves the original installation/archive and changes only a disposable clone, proving
exact legacy/setup/identity preservation, retired credentials/connections, epoch rotation,
mail quarantine and six synthetic variants. All fixtures were cleaned up. Evidence and
bounded log hashes are in `/tmp/turnstile-verification-20261104-7kiOhC/verification.json`;
a durable mode-0600 copy is in
`/home/dev/.local/state/thaarei/turnstile-360/user-management-release-preparations/20261104/verification-20261104-7kiOhC.json`.
The private maintenance handoff is updated to distinguish current results from earlier
blocked observations; a WSL/Docker restart is no longer asserted to be required by this
successful verification window. No selected-target migration, configuration installation,
credential rotation, first-administrator grant or feature opening occurred. Actual
coordinated local cutover remains UM-REL-001, with target preflight and handover separate.

OPS-003 / UM-REL-001 preparation — **Completed** (preparation; owner: Codex,
2026-11-04). The following records the earlier blocked clock observations; latest measured
stability/runtime acceptance is recorded in UM-VERIFY-02 above, with the Windows source
freshness warning still retained.
Owner selected clock investigation and local-release preparation after UM-I11 completion.
Remeasure realtime/monotonic stability, inspect WSL synchronization and compare the exact
candidate with the current local installation prerequisites. Prepare concrete cutover
materials and record remaining blockers. Stable-time verification still gates cutover;
this preparation does not migrate the target, rotate credentials or open feature writers.
Preserve the existing installation, private configuration, archive and completed evidence.

Preparation milestone: the fresh 60-second sample captured four clock steps, including
-3,757 ms. Confirmed simultaneous Hyper-V implicit synchronization and enabled Ubuntu
timesyncd; guest NTP reported approximately -3.76 seconds offset while Windows Time was
stopped. Owner explicitly approved the documented host-service fix. Windows Time is now
automatic/running using its existing time.windows.com source, with leap 0, stratum 5 and
last-sync error 0 after a bounded resync retry. Disabled/stopped this Ubuntu distribution's
competing systemd-timesyncd only after host synchronization was confirmed. Implicit Hyper-V
sync remains enabled; no kernel clocksource, NTP source policy or WSL shutdown was changed.
Post-fix 180-second observation and runtime acceptance are pending.

Post-fix result: the 180-second WSL observation still failed (six backward steps; worst
-618 ms), despite host synchronization and inactive/disabled guest NTP. A simultaneous
60-second comparison then recorded no Windows steps (approximately -3.61 to +2.77 ms
realtime-versus-monotonic difference), but two WSL steps, worst -377 ms. The approved
service repair is applied; OPS-003 is **not resolved**. Residual WSL timing requires
further investigation; no kernel clocksource, security setting or restart was attempted.
Extended observation and the required workspace checks are running; passing under this
clock cannot establish stable-time release acceptance.

Prepared a private bundle at
`/home/dev/.local/state/thaarei/turnstile-360/user-management-release-preparations/20261104/`:
exact-image Compose selection, loopback bridges for canonical local URLs, same-origin Nginx
configuration, private feature additions and instructions. Merged Compose, Node entrypoint
syntax and candidate-image Nginx syntax pass without starting target applications. Local
HTTP requires the existing local auth profile with NODE_ENV=development; no production
security claim or validator relaxation is made. Identity-service credentials remain unissued.
Read-only target preflight confirms fixed identities, completed v1/UTC, 11 installed product
migrations (through 0010), one enabled legacy row and no user-management schema. Existing
runtime files and database remain unchanged. Clock/preparation evidence is private under
`/tmp/turnstile-local-release-preparation-20261104/`.
The bundle additionally passes an isolated smoke check of all three exact images using
its entrypoint bridges and Nginx ingress, without runtime credentials or host ports:
compiled entrypoints, canonical loopback routing, fail-closed readiness, internal identity
denial, CSP and proxy-query redaction pass. The target's existing product container can
also read matching canonical discovery over its current development route (200); this
does not substitute for configured candidate target acceptance. Two authority and 17
product migrations remain unapplied; DMS has no pending migration.

Final handoff: private release preparation is complete and actual cutover remains planned.
`MAINTENANCE-HANDOFF.md`, `clock-preflight.json` and a retained clock-observation utility
are in the durable preparation bundle. The extended five-minute WSL sample had no events
above its original coarse 250 ms threshold, but still a -235 ms relative discontinuity;
this is **not** stable-time acceptance. The retained observer additionally reports smaller
steps and actual negative intervals. A private, cleaned-up kernel syscall trace observed
`chronyd` clock adjustments in another Linux PID namespace, plus `settimeofday`; ownership
was not safely identified in the visible Ubuntu/Docker/system distributions, so no unknown
service was killed or disabled. Read-only kernel timing inspection also saw changing tick/
frequency correction. Residual fault attribution remains open; upstream WSL clock reports
are investigative leads, not a proven diagnosis or repair.

Fresh `pnpm check`, `pnpm build`, `pnpm test` and all 21 Fastify integration cases pass.
The required database integration attempt failed in DMS enrollment's private issuance case:
the subprocess closed by signal (`code: null`), rather than the required successful exit.
This failure has not been attributed to time; no deadline/validation was weakened and the
suite was not repeatedly retried. Stable-time browser acceptance was not rerun after the
clock preflight failed. Prior UM-I11 successful suites remain historical evidence.

Next diagnostic candidate is a coordinated WSL/Docker restart in a maintenance window,
followed by fresh clock observation and runtime suites. It is not a proven fix and was
explicitly excluded from the approved service-change plan: it terminates all distributions,
Docker workloads and this session, so coordinate/save other work and stop services cleanly
before execution. No restart was performed. No target database/configuration, grants,
credentials or feature gate was changed. The approved Windows/Ubuntu time-service changes
remain applied, with original states and rollback commands retained in the private plan.

UM-I11 — **Completed** (implementation and isolated local verification; owner: Codex,
2026-11-04). Implemented the accepted complete-chain release package on `development`,
preserving all earlier work. Actual installation rollout is separate as UM-REL-001;
OPS-003 remains a target-release acceptance blocker. No target migration, credential
rotation, administrator grant, gate opening, deployment, commit or push was performed.

The owning migration `0027_user_management_release` adds release version/ID/epoch metadata,
removes runtime SELECT on the retired flat inventory and preserves immutable access
history and revision fencing. Private `access:release` implements real signed normal-session
administrator bootstrap/verification, explicit opening, authority-independent closing and
atomic restore recovery. Opening verifies the distinct versioned identity-service transport,
complete legacy import, protected-person counts and full invitation configuration.
Recovery binds a new external epoch, closes writers, invalidates pending invitations and
quarantines captured delivery payloads/leases while preserving accepted membership/grants.
Runtime readiness rejects incompatible versions, unsafe legacy privileges and old epochs;
recipient entry and delivery also observe the gate. Startup never grants or opens access.

Added protected local backup, six-role credential/connection retirement, isolated archive
rehearsal, exact authority/API/web image inventory and target verifier commands, plus the
[user-management release runbook](docs/runbooks/user-management-release.md). Private release
commands load runtime and migrator configuration; persistent applications retain runtime
credentials only. Updated architecture, plan handoff, README and standards references.
All owning database/browser tests use the real persisted gate; no feature-gate spies remain.

Final verification, 2026-11-04:

- `pnpm check`, `pnpm build` and `pnpm test` pass, including generated contracts, dependency
  boundaries, TypeScript, Python, deployment checks and offline Better Auth generation.
- `pnpm test:integration` passes all 21 Fastify and 218 PostgreSQL cases. The final full run
  used a private, nonsecret SQLSTATE diagnostic observer; no timeout, credential validation,
  assertion, application outcome or failure policy was relaxed. Individually rerun recipient
  and scoped-structure suites also pass (26 and 22 cases).
- All four owning HTTPS browser suites pass: auth, structured onboarding, structure and
  People. People uses the actual production API entrypoint, real private administrator
  handover/open/verify-login, restart with persisted session/invitation, scoped access and
  Mailpit-backed recipient verification/acceptance. No browser gate override is used.
- Exact authority/API/web production images pass non-root/read-only entrypoint checks,
  closed readiness, migration/command packaging, compiled/public-package byte comparisons,
  web routes, CSP/referrer policy, internal-route denial and query-secret redaction. Candidate
  `280ec04778079cf3c233510fec1a673b260648dc6c4fe3d74c5450a34ac1766b` binds the immutable
  image IDs, owning migration payloads and private operation hashes in `candidate-release.json`.
- The final protected 20261102-rd08 archive rehearsal passes against that candidate. Its
  original identity/client/enrollment/setup/grant fingerprints and source archive remain
  unchanged. Only a disposable clone underwent owning migrations/import, all-six-role
  password retirement plus old-connection termination, fresh external epoch binding and
  mail quarantine. Six synthetic fresh/partial/completed v1/v2 archive round trips pass;
  the recipient suite additionally restores a real dump containing accepted grants and
  pending mail. Reusing old epochs and stale links/work is rejected.
- Git whitespace and 181 local document-path references pass. Disposable containers from
  these completed checks were removed; pre-existing containers were preserved.

Evidence is retained under `/tmp/turnstile-um-i11-20261104/` (private directory; inventory
and archive reports mode 0600): `check-handoff.log`, `build-release.log`, `test-release.log`,
`integration-diagnostics.log`, `browser-{auth,structured,structure,people-final}.log`,
`images-release.log`, `candidate-release.json` and `existing-archive-release.json`.
Earlier deterministic failures were stale inventory/readiness expectations and were fixed;
earlier intermittent invitation/recipient unavailable failures are retained separately.
The final pass does not establish a stable runtime or prove every earlier failure was caused
by time. Both ordinary and CPU-pinned clock observers still captured backward steps around
3.5 seconds. Stabilize host/WSL time and rerun runtime acceptance before target release;
no host clock/admin setting was changed. Target container canonical DNS/TLS and customer
production/external-email acceptance also remain separate. The selected existing database,
private configuration and backup were not modified by this implementation.

UM-AUDIT-01 — **Completed** (owner: Codex, 2026-11-04). Completed the owner's
separate-agent OCR review for each implemented package UM-I01–UM-I10, fixed all 15
reported medium findings and completed the required checks plus both owning browser suites.
No critical/high findings were reported. Used the installed Open Code Review plugin at
`/home/dev/.codex/plugins/cache/open-code-review/open-code-review-codex/1.0.0` in supported
host-delegation mode: OCR resolved files/rules and ten native agents performed the reviews;
no external model endpoint was used. Initial CLI was 1.13.4; final CLI reports 1.13.5.
The review accounts for all 207 baseline paths, including 20 supplemental OCR
exclusions, with no skips. Separate coverage/findings and consolidated disposition evidence
are under `/tmp/turnstile-um-audit-20261104/`. Codex coordinated overlapping fixes and this
handoff, preserving earlier staged/unstaged work. Final runtime verification passed, with
clock instability retained separately as OPS-003; passing once does not establish that the
runtime is stable. No release, existing-installation migration, gate opening, commit or push
was performed. At audit handoff, UM-I11 remained pending explicit authorization and stable runtime acceptance.

Audit milestone: `review_i01`–`review_i03` completed all 47 assigned paths with OCR
preview/rules and supplemental documentation coverage, no skips and no source changes.
Confirmed candidates include a 600-character database bound rejecting valid 16-anchor
scope keys (602–603 characters), generated continuation-cookie names differing from
runtime transport, and current documentation contradictions. Incomplete-setup acceptance
is a policy/reachability reconciliation candidate, not yet a demonstrated supported-flow
failure. `review_i04`–`review_i06` have also completed full coverage, bringing the
completed total to 137/207 paths across six agents. UM-I05 found no actionable defect;
UM-I04 reproduced an invitation-promotion cookie lifetime error, and UM-I06 identified
missing audit-UPDATE privilege-drift rejection. UM-I07–UM-I09 are reviewing invitation
lifecycle, recipient entry and administration. Candidate fixes now also cover bounded
retention/recovery and recipient stale-response/response-size behavior; source remains
unchanged while initial package reviews finish.

Initial review phase complete: ten distinct item agents account for all 207/207 changed
paths with zero skips (187 OCR-selected and 20 supplemented exclusions). Reports contain
13 medium findings, no critical/high findings. All baseline source hashes were unchanged
during review. Fix phase: lifecycle/pruning (`review_i07`), recipient client (`review_i08`)
and subject-bound draft preservation (`review_i10`) have disjoint ownership; Codex handles
the database scope bound, session promotion lifetime, cookie documentation, audit readiness,
shared-role impact duplication and accepted incomplete-setup compatibility reconciliation.
The accepted specification is preserved; administrative issuance/business readiness stay
gated. Required workspace and owning runtime/browser verification follows source convergence.

Fix milestone: all reported code/document fixes are implemented. Added generated owning
migrations 0025 (scope-key bound) and 0026 (accepted recipient/setup separation); neither
was applied to an existing installation. New regressions cover sixteen anchors, distinct
shared-role invitation impact, table/column audit-UPDATE drift, actual Fastify cookie
promotion lifetimes, bounded/ordered invitation client responses, accepted-history pruning,
audit-capacity recovery, same-subject draft recovery and owner-seeded incomplete setup.
The incomplete-state fixture does not rewrite completed metadata, manufacture a recovery
command or revive an old epoch. `pnpm check`, `pnpm build` and `pnpm test` pass; the full
real PostgreSQL integration suite is running, followed by browser regression verification.

Runtime verification follow-up: the new incomplete-setup fixture passes all 24 recipient
cases after following the rotated cookie on acceptance replay. Full integration has passed
the new scope, impact, audit-drift and retention regressions; a later full run encountered
an intermittent existing identity-dependency 503 on resend and is being diagnosed with
finite error classification. Real browser checks pass same-subject rights recovery, then
exposed two additional medium concurrency findings: post-commit list/session refreshes
race, and a late passive old-cookie 401 clears the newly rotated valid cookie. Both have
concrete source/real Fastify reproductions; `review_i10` and `review_i04` are fixing them
with focused regressions. This brings the audit to 15 medium findings. No stale session
will be accepted, no mutation retried automatically and no production limit weakened.

Final review disposition by item (each row has its own OCR delegation agent; baseline
coverage includes supplemental files excluded by OCR defaults):

| Item   | Paths reviewed | Medium issues fixed | Result                                                                                                                                                        |
| ------ | -------------: | ------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UM-I01 |              8 |                   3 | Current session/move documentation corrected; accepted recipient/setup separation implemented for current valid approval with saved incomplete configuration. |
| UM-I02 |             19 |                   1 | Generated recipient security schemes match the actual product and authority cookies.                                                                          |
| UM-I03 |             20 |                   1 | Scope-key persistence accepts the documented sixteen anchors.                                                                                                 |
| UM-I04 |             44 |                   2 | Promotion uses verified absolute expiry; late stale responses cannot erase a rotated cookie.                                                                  |
| UM-I05 |             12 |                   0 | No actionable issue; isolated effective move-impact comparison passed.                                                                                        |
| UM-I06 |             34 |                   1 | Readiness rejects table and column UPDATE privilege drift on append-only authority audit.                                                                     |
| UM-I07 |             21 |                   2 | Accepted approvals survive until atomic parent pruning; pruning can recover a full audit budget.                                                              |
| UM-I08 |             11 |                   2 | New invitation purposes fence old async results; streamed responses enforce their byte bound.                                                                 |
| UM-I09 |             15 |                   1 | Shared-role impact deduplicates affected invitations across multiple scopes.                                                                                  |
| UM-I10 |             23 |                   2 | Same-subject recovery preserves private drafts; post-save session/list refreshes run in order.                                                                |

Final verification on 2026-11-04: `pnpm check`, `pnpm build`, `pnpm test` and
`pnpm test:integration` pass. The final integration run passes all 21 Fastify integration
cases and all 210 owning PostgreSQL cases, including repeatable migrations/bootstrap and
runtime privilege isolation. Both `pnpm test:browser:people` and `pnpm test:browser:auth`
pass against real HTTPS/OIDC/SMTP and disposable PostgreSQL. The People journey includes
role revocation/restoration, hidden same-subject draft recovery, identity-change clearing,
scoped changes and recipient acceptance; the broader suite includes 20 refreshes, Settings,
onboarding, recovery/logout and redaction. Four real Fastify cookie cases, seven bounded
recipient-client cases, six People/session transport cases and ten repeated lifecycle
cases also pass. Case-only diagnostic runs skipped unrelated tests deliberately; the final
complete integration run has no skipped files/cases. Generated API consistency, pinned
framework CLI verification, Biome and Git whitespace checks pass.

Verification corrections: fixtures now follow the rotated replay cookie, select an
immutable Member invitation role before deliberately editing the operator role, and avoid
reading diagnostic headers after browser teardown. The existing BFF absolute-expiry test
now compares the product expiry with the actual verified parent expiry/creation ceiling,
matching the accepted authentication-time contract rather than assuming zero clock skew.
No production token/CSRF checks, timeouts, configured limits or mutation retry policy changed.
Temporary production diagnostics and focused-only markers were removed; the three affected
production files match their original audit-baseline hashes. Test-only diagnostics retain
bounded protocol/database error classifications and a private JWT timing/verification probe;
real SQL/transactions are forwarded unchanged and response credentials are never recorded.

Known runtime limitation, OPS-003: earlier full runs intermittently failed with identity
or dependency errors (including resend/reapproval and an existing BFF machine read). A passive
host-clock observer during the final passing run captured repeated backward wall-clock
steps relative to the monotonic clock: minimum -3,564 ms, maximum +837 ms across 2,323 samples
(`/tmp/turnstile-um-audit-20261104/clock-observer.log`). Some recorded wall-clock timestamps
themselves decrease; this is not only a slow test. Such clock movement invalidates reliable
JWT/expiry acceptance. It is a demonstrated runtime issue, not proof that every observed
503 has the same cause. Stabilize host/WSL time and rerun integration before release
acceptance; no host clock or administrator setting was changed by this audit.

Follow-up OCR preview/rules account for 41 fix paths, including eight newly changed paths
beyond the 207-path baseline (215 current changed paths total). Generated migration snapshots
are verified structurally, not claimed as manual line review. Migrations 0025/0026 were
applied only to disposable fixtures. The existing installation remains unchanged and public
writers stay gated. No source finding from the ten item reviews remains open; the next
feature/release package is UM-I11, with the separate runtime follow-up above carried forward.

UM-I10 — **Completed** (owner: Codex, 2026-11-04). Independent Members,
Invitations, Roles and scoped Structure routes/editors, bounded typed transport, server
impact review/readback, in-memory drafts, navigation guards, permission/path summaries,
generated Checkbox and inert People gallery are implemented. The minimal catalog adds
organization revision and current company grant coverage; focused owning integration
assertions verify independent People-only/role-only coverage. Architecture, design guide,
generated API documentation and sensitive ingress exclusions are updated. No installation
migration, grant initialization, production writer opening or deployment was performed.
Verification: `pnpm check`, `pnpm build`, `pnpm test` and `pnpm test:integration` pass,
including 21 Fastify integration tests and 204 owning database tests in real disposable
PostgreSQL. `pnpm test:browser:auth` passes the complete gallery/onboarding/Settings,
refresh/recovery/logout and redaction regression suite. The real HTTPS/OIDC/SMTP People
journey passes role creation, uncertain-command readback, stale-review retention,
invitation approval, suspension/reactivation, independent People-only/role-only loaders,
expired-session drafts, scoped creation, long paths, narrow/reduced-motion/touch navigation,
wrong-account switching, same-tab link reopening, recipient setup/verification/acceptance
and ordinary entry without repeat onboarding. The final run also passes a scoped
impact-reviewed move and canonical path refresh after the move. Intentional stale-review,
expired-session and transient old-context denials recover without replaying a mutation.
Browser-discovered catalog-readiness and scoped fingerprint-refresh races are fixed, as
is same-document invitation credential capture. Saved pending/terminal approvals are
read-only; manual grant-choice reload preserves drafts. The private identity fixture proxy
and older navigation/revocation test expectations were corrected without weakening guards.
The scoped move preview now uses its frozen command body, with the confirmation wrapper
reserved for the mutation. Same-document invitation arrivals also clear account-setup input.
The existing non-blocking Vite chunk-size advisory remains.

Handoff: UM-I11 remains the authorized-plan next package, covering complete-chain image
verification and fresh/existing-installation upgrade, recovery and coordinated release
acceptance. Those operations were not started here. Ordinary writers remain closed outside
the disposable owning fixtures; the existing installation remains unmigrated by this work.
There are no UM-I10 blockers. No commit or push was made.

UM-I09 — **Completed** (owner: Codex, 2026-11-03). The 20 frozen administration
handlers are implemented and locally verified on `development`; UM-I01–08 work is preserved.
No existing-installation migration/provisioning, grant initialization, ordinary writer
opening, external mail, deployment, commit or push occurred.

PeopleModule adds AdministrationController/Service, PeopleCommandsService, PeopleStoreService
and current source projections. Members, invitations and eligible roles require People
rights; role definitions require Roles rights; catalog/impact/readback authorize independently.
Bounded list/detail/search shows every assignment and explicit legacy source. Product-linked
identity display records fresh/stale/deleted/unavailable provenance, follows immutable subject
IDs and never exposes an authority directory. An older response cannot overwrite a newer
confirmed deletion. Recycled addresses require resolution of the deleted former membership
and fresh approval; suspended reactivation checks live verified identity.

Custom-role new/copy/details/permissions/delete, member assignment replacement, explicit
legacy retirement and suspension/reactivation enforce current grant/scope ceilings and
protected distinct-subject counts under shared locks. Retained independent assignments keep
their IDs and are not silently widened or removed. System definitions stay immutable; copies
have no protected identity. Referenced permission changes require both management rights,
including reductions, and added reusable powers require company coverage. Confirmations bind
current actor, command, versions and affected sources. Audit/revision/receipt changes commit
atomically; no-ops do not append change audit or advance revision. Readback/replay returns
current authorized outcomes, including role tombstones, without restoring grants.

Generated migration 0023 adds the member display cache and nullable receipt change metadata;
custom 0024 adds forced RLS and narrow non-PUBLIC database helpers/capability. Runtime Access
tables retain read-only privileges. Runtime/private readiness verifies the cache's individual
CRUD privileges, ownership/RLS and capability ACL/search path. Strict HTTP/body/query/path,
CSRF, bounded safe errors/Retry-After, deadlines and finite telemetry compose existing guards.
Invitation issue/resend/reapprove/cancel reuse the lifecycle owner. Impact uses its actual
eligibility; completed reservations skip stale confirmation checks and concurrent creation
returns one 201 plus a current 200 replay. Shared edits invalidate approvals in the same
transaction, including full rollback on an invitation audit failure.

Architecture, contract README, generated API implementation status and drift assertions are
updated; policy and configured bounds are in the
[administration baseline](architecture.md#people-administration-implementation-um-i09).
The database harness runs every owning test file independently on disposable PostgreSQL,
asserts normal synchronization and preserves migration/privilege/RLS/restore checks. Fixture
rate buckets no longer depend on finishing within a wall-clock minute; disposable product
membership resets also reset their owning authority assertions. Production limits/storage
and credential validation are unchanged. All temporary diagnostics were removed.

Verification (2026-11-03): `pnpm check`, `pnpm build`, `pnpm test` and
`pnpm test:integration` passed. Full runtime verification covers 21 Fastify HTTP integration
checks and all 204 PostgreSQL cases across 14 files (30 authority/DMS, 174 product), including
20 administration cases and the real OIDC/HTTP recipient acceptance/shared-role race.
Administration tests use the established verified browser-auth adapter seam with real guards,
CSRF, Access and authority projection HTTP; the separate integrated race uses actual OIDC.
Checks cover independent rights, escalation/ceiling denials, retained sources, protected
counts and mutual suspension, shared-role/assignment/acceptance races, stale impact, concurrent
replay, lifecycle state/generation, recycled identity/out-of-order cache, missing cache UPDATE
privilege and late audit rollback. Logs: `/tmp/turnstile-um-i09-final-{check,build,test,integration}.log`.
The full runtime pass included the last cache regression; final static/build/unit checks also
passed after diagnostic removal. Earlier runs saw pre-existing intermittent DMS credential
and identity-service dependency test failures; the unchanged validators passed isolated and
full traced verification without reproducing those failures. Retain that reliability follow-up
for UM-I11 rather than weakening credential checks or adding blind retries.

Handoff: UM-I10 owns the People administration UI and independent loaders/drafts/navigation;
UM-I11 owns complete-chain browser/image and upgrade/recovery/release acceptance. Ordinary
writers remain release-gated and the existing installation remains at its previous release.
No UM-I10 implementation or target rollout was started.

UM-I08 — **Completed** (owner: Codex, 2026-11-03). Restricted recipient identity and
atomic acceptance are implemented and verified on `development`; preceding UM-I01–07
work is preserved. No existing-installation migration/provisioning, ordinary People writer
opening, external recipient mail, deployment, commit or push occurred.

PeopleModule installs the nine frozen recipient handlers for exchange/context/start/setup/
accept/decline/cancel/switch-account/logout. Strict JSON/query/Origin/Fetch Metadata and
current synchronizer CSRF protect mutations. Persistent independent IP/digest attempt
budgets cover exchange, context and invalid continuation attempts across replicas; public
rate metadata is bounded and obsolete buckets are pruned in bounded batches. Request and
response limits remain 16 KiB/1 MiB with the shared ten-second database deadline. Finite
errors and telemetry exclude credentials, cookies, mail links and identity-service data.

The existing encrypted BFF store holds an invitation/generation/recovery-epoch continuation,
server-generated setup operation and separate restricted verified identity. Purpose-bound
five-minute OIDC uses the existing exact callback, state/nonce/PKCE and actual parent expiry.
Restricted identity cannot authorize ordinary session/setup/profile/structure/DMS routes.
Live introspection, verified userinfo and exact current browser parent are checked without
positive authorization caching. Wrong-account acceptance fails; explicit switch/logout
retires local identity first, preserves another tab's different authority parent and has a
bounded retry with credential cleanup. Flow cancellation preserves any established normal
session; recipient decline cancels only the current invitation and closes delivery work.

Explicit setup reconciles a server-held operation before authority preparation, checks
current eligibility again after HTTP and returns only a one-shot setup handoff. The public
recipient entry captures/removes the fragment before rendering and exchanges only on
explicit action. Name/password submit directly to the authority. Its existing ordinary
unverified creation, verification and passwordless/recovery flow resumes through purpose-
aware sign-in/reset destinations or by reopening current mail. Existing credentials,
profiles, bans and other application memberships are preserved. Authority epoch advancement
now retains the approved email for subsequent same-generation preparations.

Owning generated migration 0021 adds the immutable FORCE RLS acceptance receipt with
seven-day retention and runtime SELECT only; 0022 adds the fixed-search-path, non-PUBLIC
narrow acceptance capability. Runtime Access tables remain read-only. Acceptance locks
installation/access and current invitation, revalidates current generation/version, expiry
with database time, approval/role permissions/scopes/units, recovery epoch and matching live
verified identity. It also locks/revalidates the encrypted session in that transaction,
fencing cancellation, switching and callback changes from another tab without HTTP under
locks. Canonical member/assignments/anchors, one subject-bound result, invitation state,
Access revision/audit and delivery/reference cleanup commit together. Existing active or
suspended membership is never overwritten. Ordinary session establishment follows commit;
its failure leaves durable membership recoverable. Replay reads current access without
restoring grants and follows immutable subject ID after a verified email change. Consuming
the server purpose in the same transaction permits subsequent ordinary canonical login.
Readiness and bounded private pruning include the receipt and capability.

The recipient landing route composes the established authentication layout and shadcn
primitives. Public Turnstile contracts add the safe optional unavailable-context action
target and browser-safe authority response projections; browser package boundaries remain
unchanged. Architecture, generated API implementation status, contract documentation and
disposable authority/HTTPS fixtures are updated. No new dependency or host service port is
introduced.

Verification completed 2026-11-03: `pnpm check`, `pnpm build`, `pnpm test` and
`pnpm test:integration` pass. Final integration passes 21 Fastify and 183 real PostgreSQL
cases (30 authority/DMS + 153 product). Twenty-one focused recipient cases cover real
separate-process authority HTTP and HTTPS Secure/HttpOnly/host-only continuation cookies,
new account creation/verification, existing unverified/passwordless preservation/recovery,
wrong accounts and changed authority parents, CSRF/HTTP bounds and independent/capacity
quotas, bans/outages/logout retry, token lifetime/database expiry, existing suspended
membership, double acceptance, cancel/resend/reapproval races, stale scope approval,
another-tab cancellation, late audit rollback, partial session success/normal relogin,
verified email changes and no restored access on replay. Browser node verification proves
fragment removal precedes requests and exchange requires explicit action. Repeatable owned
migrations/bootstrap and runtime database isolation pass in disposable containers.

During verification, scoped breadcrumb projection, inactive-identity error precedence and
subject-based replay were corrected. One initial concurrent run hit the existing DMS
transport test's 100 ms fixture deadline; it passed unchanged on rerun. Generated-document
status expectations were updated for the implemented recipient handlers. Production
transport validation was not relaxed. Existing-installation/customer ingress/TLS, external
mail and rollout acceptance remain separate; browser visual verification was not run.

Handoff: UM-I09 owns ordinary People/role/member/invitation administration handlers and
impact-reviewed commands. Preserve current canonical action/scope ceilings, protected
administrators, global command receipt namespace and release-gated ordinary writers.
Recipient acceptance/setup remains confined to this owning verified/purpose boundary;
never accept browser-supplied identity assertions or replay approved assignment snapshots
into an existing member. UM-I10 owns the full People administration UI; UM-I11/12 own full
journey/release acceptance. The existing installation remains at migration 0010/completed v1.

UM-I07 — **Completed** (owner: Codex, 2026-11-03). Implementation and all required
workspace verification are complete. Work remains on `development`; earlier
UM-I01–06 changes are preserved. No existing-installation migration/provisioning, public
product writer opening, external recipient delivery, deployment, commit or push occurred.

PeopleModule implements issue, same-actor receipt/readback, resend, reapprove, cancel,
expiry and read-only current credential lookup. Current completed-workspace People
authority, complete action/scope ceilings, role/version/unit references, protected-role
eligibility and expected Access/organization/entity/generation versions are rechecked.
One normalized actionable email is enforced in PostgreSQL. A durable reservation precedes
authority HTTP; known operation reconciliation precedes a new preparation. Matched current
active/suspended product members are refused rather than overwritten. No placeholder account
or product membership is created. Exact command retries do not resend or recharge limits.
Authority preparation now permits an email change only at a strictly newer generation;
ordinary resend lookup does not advance provider purpose beyond the current product state.

Owning migrations 0017–0020 implement seven FORCE RLS tables, immutable approved generation
history, actionable role/unit FK references, command reservation/completion, hashed credentials,
authenticated encrypted temporary delivery payloads, finite audit and durable rate counters.
Access tables/receipts remain read-only and immutable to runtime; narrow invitation-only
reserve/commit functions advance one audited Access revision and fence repeat completion.
Six deferred source-commit constraints invalidate approvals on loss of current approver
power/ceiling/protected status or approved role permissions. Restoration does not revive
old approval; equivalent atomic grant replacement and display edits remain harmless.
Readiness/private verification include invitation tables, privileges and policy functions.

The real StructureInvitationPolicy adapter replaces the closed transition adapter. It uses
live actionable references, effective coverage unions, generation/snapshot-bound impact and
transactional invalidation. Actual confirmed moves and invitation audit failure are tested
against the same transaction. Upgrade/unsafe-storage fixtures now use this owning policy.

The owning API drain claims at most ten jobs every five seconds using durable 30-second
leases. SMTP runs outside Access locks and outcomes use a current-generation/lease/epoch
fence. Resend rotates first; old senders cannot overwrite current work. Definite unavailable
transport retries with bounded backoff/five attempts; rejection fails, and ambiguous DATA/
acknowledgement loss or abandoned send lease becomes unknown without automatic retries.
Secret payloads are purged on terminal/unknown/superseded/cancelled/expired work. Current
external recovery epoch fences restored pending approval/delivery; explicit review is
required again. Before-shutdown stops new claims and awaits the bounded active batch before
persistence closes; the product container gets 45-second stop grace.

Turnstile owns its SMTP adapter and dedicated validated encryption key/recovery epoch.
Development forwarding reuses reserved port 23604 and existing Mailpit. Production pilot
Compose reuses its STARTTLS CA, readiness and capture limits. No relay is introduced.
Environment examples, architecture, generated domain implementation status and contract
README are updated. Public People/recipient handlers and all public write flags remain
closed. Private Access pruning expires obsolete work and shares its bounded deletion budget
with invitation operations/rates and eligible old terminal/audit/generation metadata.

Verification completed 2026-11-03: all required `pnpm check`, `pnpm build`, `pnpm test`
and `pnpm test:integration` pass. Final integration passed 21 Fastify and 162 PostgreSQL
cases (30 authority/DMS + 132 product). Nineteen focused real PostgreSQL + separate-process
authority HTTP + SMTP/Mailpit cases pass, including durable issue/replay, normalized duplicates, active/suspended
members, actual current-generation capture, stale sender versus resend, cancel/expiry,
lease recovery, rejection/unknown/backoff, revocation followed by restoration, harmless
grant replacement, role edits/references, real Structure rollback, recovery epoch, quotas/
capacity, late audit rollback/retry, immutable history/prune, scope ceilings and redaction.
The final full run uses disposable owned PostgreSQL/Mailpit, verifies repeatable migrations/
bootstrap and runtime database isolation, and sanitizes inherited optional feature secrets/
transports. Earlier full attempts exposed and fixed
two outdated policy fixtures; pre-existing intermittent DMS invalid-token and one transient
authority dependency failure were also observed. No relaxed token validation or automatic
business write retry was added. Production ingress/TLS and existing-installation rollout
acceptance are not claimed.

Handoff: UM-I08 owns restricted invitation continuation/OIDC, recipient name/password
handoff/recovery/resume and explicit atomic acceptance. Compose the existing credential
lookup with its current-generation/approval/expiry/recovery-epoch checks and separate
IP/digest budgets. Acceptance must retire outstanding delivery payloads in its own shared
transaction and commit canonical grants/subject-bound result once; mail/identity setup never
activate membership. UM-I09 owns ordinary People HTTP handlers and safe command projection
(including preparing reservations). Keep public writers closed until coordinated release.

UM-I06 — **Completed** (owner: Codex, 2026-11-03). Implemented the narrow authority
service and recipient setup integration. Work remains on `development`; previous UM-I01–05
changes are preserved. No existing-installation migration/provisioning, public product writer
opening, deployment, commit or push was performed.

The authority privately manages a third `identity_service` confidential client/resource,
with client-credentials only, five-minute audience-bound RS256 tokens, exact installation/
application approval and separate scopes. Login/DMS credentials, administrator cookies and
DMS enrollment cannot authorize it. Every operation rechecks live client/resource/scope
state, including browser setup after token issuance. The pinned provider's serialized
registration metadata is decoded explicitly. Configuration is optional until privately
provisioned; incomplete/invalid bindings fail closed. Operator issuance/inspection/rotation/
suspension/resumption/scope commands, backend-only environment examples and production
Compose bindings include the new purpose; web Nginx rejects `/internal/identity/`.

Generated authority migrations 0002–0003 own preparation/epoch/setup/subject-link/audit/limit
persistence. All six feature tables use FORCE RLS and installation policies, separately from
the 13 provider tables. Receipt secrets are digested and purpose-sealed; setup cookies are
digested, separate HttpOnly continuations with exact Origin/Fetch Metadata and synchronizer
CSRF. Bounded request/rate/storage/retention policy and private `auth:prune-identity` are
implemented; runtime audit remains append-only. See architecture.md for exact limits.

All seven authority routes are implemented: preparation, same-operation reconciliation,
linked subject projection and recipient exchange/context/complete/cancel. Preparation never
creates a placeholder account. Single-use receipt exchange consumes no identity state;
context GET creates no account or credential. Recipient completion uses Better Auth 1.7.14's
supported headless creation API and existing password hashing on the outer transaction's
exact connection. Ordinary unverified account, credential, completion receipt and audit
commit atomically; fixed-callback verification mail follows commit. Duplicate creation and
lost responses reconcile without a second credential; known duplicate conflicts reread once
without permitting another creation. Mail failure leaves a completed receipt and replay does
not resend implicitly. Existing verified/unverified/passwordless/banned profiles, passwords,
roles and flags are preserved. No general signup/admin HTTP is enabled.

The product's server-only IdentityModule uses a separate confidential token/transport cache,
strict bounded contracts, no credential forwarding and no automatic mutation retry. Subject
projections derive immutable subject/member/version assertions from canonical memberships
after current company People permission, then recheck permission and bindings after HTTP.
Missing/deleted identities never transfer membership through email reuse. Generated OpenAPI,
contracts README, architecture and next-item integration notes are updated.

Verification completed 2026-11-03: `pnpm check`, `pnpm build`, `pnpm test` and
`pnpm test:integration` pass. Full integration passed 21 Fastify and 143 real PostgreSQL
cases (30 authority/DMS + 113 product). Sixteen new separate-process authority HTTP cases
cover preparation without placeholders, strict input/purpose/binding rejection, all account
states, real hashing/verification with fixed callback and 30-minute token, CSRF/name/password/
expiry/generation/cancel fences, immediate suspension/scope removal, concurrent creation,
forced audit rollback, dropped completion response, SMTP failure replay, canonical People
projection/deletion/rebinding/permission denial, unsafe grants/outage and rate bounds.
An additional focused rerun of all 16 cases also verified private bounded pruning removes
expired preparations while preserving current receipts and fresh audit. Disposable owned
migrations/bootstrap and runtime database isolation passed. An earlier full run had two
intermittent invalid-token/enrollment failures in existing DMS tests; the final full rerun
passed all 30. Failure assertions now include finite status/code diagnostics. No browser,
production ingress/TLS or existing-installation acceptance was claimed.

Handoff: UM-I07 invitation approval/storage/state/mail is next. It must replace the closed
StructureInvitationPolicy adapter, persist eligibility before calling the identity adapter,
and reconcile preparation by its known operation UUID. A lost receipt exchange requires a
fresh operation after current invitation eligibility recheck. UM-I08 owns product restricted
continuations, guided verification/recovery and invitation-purpose sign-in/reset resume;
UM-I09+ own administration handlers/UI and later release acceptance. Keep all current
product public writer gates closed until the coordinated release requirements are met.

UM-I05 — **Completed** (owner: Codex, 2026-11-03). Completed the scoped organization
package as requested, including the earlier read milestone. All required checks and final
OCR host review are complete. No release gate is opened and no existing installation
migration/import/initialization, deployment, commit or push is authorized or performed.

Implemented all eight scoped Structure routes: list/detail, create/rename/delete, move-impact
preview, confirmed move and same-actor command readback. Current transaction policy applies
exact/subtree action coverage, parent/new-child/deletion relationships, root restrictions,
whole moved-subtree coverage and company authority across separate anchors. Shared canonical
validation now serves both scoped commands and the existing company configuration service;
root/type/depth/cycle/name/first-unit and completed v1/v2 behavior stay authoritative there.
Responses, replays, tombstones and conflicts remain scoped; hidden/missing records share 404.
A create receipt cannot expose later deletion outside current coverage. Successful deletion
receipts permit only their own parent-authorized tombstone. Public writers/impact issuance
remain closed; read-only current command readback remains available.

Generated owning migrations 0015 (receipt operation/terminal-parent/resulting-revision fields
and access audit action) and 0016 (three narrow structure receipt/proof/revision functions).
Access feature tables remain read-only to runtime; no grant/membership writer privilege was
added. Readiness verifies all four fixed owner/path/mode/return/ACL function signatures.
StructureAccess computes bounded effective coverage from the union of current sources,
checks people/company structure authority and before/after grant ceilings, hashes opaque
five-minute proofs and recomputes under installation/configuration/access locks. Confirmed
changes atomically commit the tree, one organization and access revision, truthful audits,
command receipt and approval invalidation. Harmless structure changes leave access revision
alone. Receipt keys are installation/actor/UUID across private/people/structure operations;
replay reads current authorized state and never reinstalls an old move/grant.

Legacy company moves use the same effective impact policy and reject access-changing moves
through their existing finite conflict envelope; redundant overlapping grants no longer
cause conservative false positives. Live/suspended assignment anchors block deletion.
StructureInvitationPolicy coordinates actionable references, impact generation digest and
invalidation in the same transaction. Its closed adapter proves no invitation storage and
closed release state; unknown invitation storage fails closed until UM-I07 wires its owning
adapter. No invitation feature schema is introduced early. Disposable PostgreSQL fixtures
exercise approval generation races, invalidation rollback and no invalidation on replay.

Ten-second server deadlines begin before guards/parsing and propagate to transactions;
expired transactions destroy their connection, including lock waits/queued acquisition,
and check time before commit. Receipts/current readback handle an uncertain commit without
automatic write replay. Stored command/proof limits and private pruning remain bounded.
Architecture, generated API implementation/gate/deadline status and the contracts README
are updated; the UM-I07 plan explicitly requires replacing the closed policy adapter.

Verification completed 2026-11-03: `pnpm check`, `pnpm build`, `pnpm test` and
`pnpm test:integration` all pass. Final integration includes 21 Fastify tests and 127 real
PostgreSQL tests (30 authority/DMS + 97 product). The 22 Structure cases cover scoped
reads/writes/parent boundaries; safe hidden/missing/conflict/tombstone projections; exact,
subtree, overlapping and cross-boundary policies; same-actor current replay and UUID
collisions across legacy/private/scoped commands; protected tree/no-op versions; confirmed
move revisions/user audit; changed assignments/hierarchy/generation/expired proofs; audit
and approval-invalidation rollback; retained/suspended references; request timeout with no
late mutation; finite proof capacity; narrow function privilege/readiness drift; and the
closed public writer gate. Existing setup v1/v2, upgrade, BFF/CSRF/refresh/logout and runtime
privilege regressions pass. Drizzle reports no schema drift; `git diff --check` passes.

OCR 1.13.4 host delegation accounts for all 102 workspace files (90 selected and 12
supplemental), none skipped. Earlier reviewed contents are carried forward only after exact
SHA-256 verification; changed/new source, generated artifacts and owning tests were reviewed.
No external LLM endpoint was used. Fixed findings during implementation/review: aggregate
readiness must reject a NULL function search path; out-of-scope former create receipts must
not reveal later deletion; UUID identity must also fence legacy configuration create routes;
capacity must map to the finite capacity outcome. No unresolved actionable finding.

Final evidence: `/tmp/turnstile-um-i05-complete-{ocr-preview,ocr-rules,ocr-review}.json`;
`/tmp/turnstile-um-i05-complete-{check-final,build,test-final,integration-final-checked,drizzle-drift}.log`.
The earlier first-milestone review and verification remain available in the prior
`/tmp/turnstile-um-i05-*` artifacts. Browser/image/customer rollout was not run for this
backend package. All migrations were applied only to disposable verification fixtures;
the existing installation remains through 0010 with its saved completed-v1 state.

Handoff: UM-I06 narrow authority integration is next. UM-I07 owns actual invitation
storage/lifecycle and must replace the tested closed StructureInvitationPolicy adapter
before opening invitation/structure writers. UM-I09/I11 own the remaining coordinated
public capability/release gates. UI and end-to-end recipient/mail/browser/customer rollout
remain their owning packages. No existing-installation migration/import/initialization,
deployment, commit or push was performed; previous workspace changes are preserved.

UM-I04 — **Completed** (owner: Codex, 2026-11-03). Scope: requested OCR review of
UM-I03, fix supported findings, then replace flat access consumers with canonical reads,
implement scope-aware session/CSRF generation fencing, preserve live identity/refresh/logout
and transaction-bound configuration authority, and verify with focused Fastify/PostgreSQL
regressions plus all required workspace checks. Preserve prior changes; no existing
installation migration/initialization, deployment, commit or push. Used the installed OCR
1.13.4 plugin's supported host delegation mode; no external LLM endpoint was configured or
used. Reviewed the 52-file UM-I03 workspace, then accounted for all 86 final changed files
(74 OCR-selected plus 12 supplementary documentation/test/relocation exclusions), none
skipped and no remaining actionable finding. Fixed a latent UM-I03 fixture teardown race:
pg-pool completion could precede socket removal, so forced database deletion could produce
an unhandled connection error. Fixtures now await removal events before ordinary database
drop, including archive restoration. Final review also caught/fixed regenerated cookies
reusing an old relative lifetime; renewal is capped at the original absolute identity limit,
with a shortened-expiry regression. Evidence: `/tmp/turnstile-um-i04-{before-ocr-preview,before-ocr-rules,ocr-preview,ocr-rules,ocr-review}.json`.

Replaced independent flat reads in login/session, readiness, guards, configuration/setup
and private inspection/replacement with canonical access. `user_access` appears in runtime
source only as the historical schema and the explicit owning import; there is no live
fallback. Role-only members enter without an inventory row, suspension overrides retained
sources, and per-request evaluation applies implications without separating actions from
scopes. Neutral infrastructure owns public/company/resource route metadata and finite access
errors; Organization no longer imports Auth helpers. Unannotated/unknown policy denies,
resource metadata names its action/path/exact-or-subtree requirement, and whole-company
configuration stays separate from people/unit authority and workspace readiness exemptions.

Generated owning custom migration 0014 and its unchanged-table snapshot. Its narrow,
tenant-bound SECURITY DEFINER function locks fixed installation/configuration/access in
order, returns void and performs no writes; runtime gets only EXECUTE and retains read-only
feature tables. Readiness/private verify reject missing initialization, unsafe tables or
unsafe function owner/path/mode/ACL. Configuration transactions use those locks, re-evaluate
enabled company authority and reject a changed server-derived actor fingerprint before
mutation, closing revocation between guard and commit. Private replacement requires explicit
canonical initialization and retains the legacy three-permission JSON source contract.

Normal session DTOs now require bounded access context and the auth document is v2.
Old encrypted sessions bind their first context after fresh identity/access verification.
Unsafe requests validate incoming CSRF/Origin/Fetch Metadata against their incoming
generation before renewal. Changed source/scope/permissions/ancestry regenerate cookie and
CSRF through existing generation/revision CAS and return typed ACCESS_CONTEXT_CHANGED
before mutation; safe session reads can return the new context. Unrelated actor revisions
do not churn the session. Existing refresh ownership, logout recovery and idle/absolute
limits remain. Web transport validates the complete session and recognizes context conflict;
editors retain drafts and require session refresh/deliberate resubmission, without automatic
write replay. Updated auth/configuration documentation, generator drift checks, canonical
fixtures and browser-harness explicit initialization; historical v1 archive variants remain.

Verification (2026-11-03): final `pnpm check`, `pnpm build`, `pnpm test` and
`pnpm test:integration` all passed. Integration includes 21 direct Fastify checks and 105
real disposable PostgreSQL tests (30 authority/DMS, 75 product). New coverage proves
resource/company scope isolation, configuration/people separation, role-only real OIDC
entry/suspension, scope-only and shared-role context renewal, concurrent incoming requests,
invalid CSRF without churn, unrelated revision stability, absolute cookie bounds, transaction
fingerprint revocation and lock-function/privilege safety. All existing refresh/logout and
configuration upgrade/rollback cases pass. The 14 web tests include validated session and
no-replay transport regression. Drizzle reports no schema drift; snapshot/journal invariants
and `git diff --check` pass. Logs: `/tmp/turnstile-um-i04-{check-final,build,test,test-integration-final,drizzle-drift}.log`.
The existing chunk-size advisory remains at 758.34 kB. Image/browser/customer-release
verification was not run for this package and remains separate complete-chain work.

Handoff: UM-I05 implements scoped organization projections/operations, reference policies
and access-changing move impact. Keep existing full configuration routes company-only;
do not relax guards to expose whole snapshots to scoped users. Public role/assignment
writers remain closed. No existing installation was migrated or initialized; release
still requires the coordinated access-aware images, explicit import and I11 verification.

UM-I03 — **Completed** (owner: Codex, 2026-11-03). Scope: requested Open Code
Review plugin review of current changes, fix supported findings, then implement canonical
access persistence/evaluation, repeat-safe legacy import, access audit, ordered private
operator recovery and focused real PostgreSQL verification. Preserve prior work and the
existing installation; no live migration, grant, commit/push or deployment. Used Open Code
Review 1.13.4's installed plugin delegation skill (host review; no configured external LLM).
Prior 27-file contract review found no new blocking issue. Final review accounts for all
52 changed files: 42 selected by OCR and ten supplementary documentation/fixture exclusions,
none skipped and no remaining actionable finding. Fixed inspection-envelope compatibility,
explicit current suspended-state replay and attribution of both handover subjects during
review. Evidence: `/tmp/turnstile-um-i03-{before-ocr-preview,before-ocr-rules,ocr-preview,ocr-rules,ocr-review}.json`.

Generated the Nest Access module/repository and owning Drizzle 0011–0013 schema, journal,
snapshots, forced-RLS policies and invoker guards. The ten access tables own membership,
explicit legacy sources, stable roles/permissions, scoped assignments/anchors, independent
revision/capability, command/impact receipts and attributable audit. Enforced composite
references, normalized-name uniqueness, immutable system templates/source identity/history,
assignment/anchor limits and closed runtime writes. The evaluator supports transaction-bound
reads, action/scope pairs, exact/subtree grant coverage, implications, distinct protected
administrator/effective company-manager counts and actor-specific hierarchy fingerprints.
No positive authorization cache, extra pool or cross-application data access was added.

`access:operator initialize` explicitly imports every old grant once, preserving disabled
states and exact old permission sets (including missing shell access) without role promotion.
Repeats retain source/template IDs, revision and audit. Old rows become frozen recovery
inventory; retained old readers check the import boundary in the same statement and fail
closed after import. Startup never imports. Private verify, bounded/global or per-subject
inspection, proof-bound administrator bootstrap/handover, versioned legacy retirement and
bounded pruning are implemented. `auth:set-access` retains its JSON replacement input;
after import it changes canonical legacy permissions/status, suspends all retained sources
when disabled, never un-retires a source and preserves the last administrator/manager.
All changes share installation/configuration/access lock order and atomic audit rollback.
Receipts bind installation/actor/key to operation/digest and replay current membership.
Configuration inspection retains its existing output while using canonical manager counts.

Verification (2026-11-03): final `pnpm check`, `pnpm build`, `pnpm test` and
`pnpm test:integration` all passed. Integration includes 19 direct Fastify checks and 101
real disposable PostgreSQL tests (30 authority/DMS and 71 product, including ten new access
groups). New groups cover the complete enabled/disabled legacy matrix, repeat import/no
promotion, role-only access, paired coverage, concurrent last-manager protection, explicit
live verified HTTP proof/bootstrap/handover, independent retirement and current-state
replay, audit-failure rollback, every new table's forced-RLS/privilege isolation, immutable
templates, actor-specific fingerprints and bounded inspection/maintenance. The historical
v1 upgrade fixture now seeds deployed SQL rows directly and checks current readiness
rejects the incomplete schema before the owning upgrade; six preservation/restore variants
still pass. Drizzle generation reports no schema drift; metadata checks prove the prior
seven tables are unchanged, ten are added and journal/snapshots are consistent.
`git diff --check` passes. Logs: `/tmp/turnstile-um-i03-{check-final,build,test,test-integration-final,drizzle-drift}.log`.
The existing 758.20 kB web-bundle advisory remains. No image/browser/customer-release
verification was run for this backend foundation; those remain complete-chain release work.

Handoff: UM-I04 replaces all deliberate post-import legacy-reader/readiness fences with
canonical login/session/configuration consumers and access-context generation fencing.
Do not initialize the existing installation or reopen public role/assignment writers as an
isolated release. All user-management public writers remain closed pending the dependent
packages and coordinated release gate. See architecture.md for the staged cutover contract.

UM-I02 — **Completed** (owner: Codex, 2026-11-03). Scope: owner-requested
Open Code Review plugin review/fixes followed by executable user-management and reusable
authority contracts and deterministic generated OpenAPI. Located the newly installed local
plugin under `/home/dev/.codex/plugins` and installed its required OCR 1.13.4 CLI. No
external LLM endpoint is configured; used the plugin's supported delegation mode (host
review, not an independent external model). Initial seven-file review found/fixed one
medium design defect: command receipt identity now matches UUID-only readback, so reusing
a key across operations conflicts. Final 27-file review covers all 17 OCR-selected files
plus ten supplementary documentation/fixture exclusions; no file skipped and no remaining
actionable critical/high/medium finding. Evidence:
`/tmp/turnstile-um-i0{1,2}-ocr-{preview,rules,review}.json`.

Added 73 product schemas and 37 classified operations in `people-common`, `access`,
`people` and `people-routes`; added 13 reusable authority schemas and seven operations in
`identity-service`/`identity-service-routes`. Contracts enforce finite catalog/applicability,
role/assignment bounds and normalization, permission versions, explicit legacy sources,
strict commands/impact/readback, scoped projections, independent approval/delivery states,
restricted recipient review and finite errors. Recipient context checks addressed identity,
invitation lifetime and only approved anchors/paths; ordinary session names agree with
bounded action/scope grant sources. Queued delivery cannot exceed the five-attempt total.
The installed flat permission catalog/private grant input, actual session producers and
DMS machine trust remain unchanged; only an optional additive session-access type is added.
No future route is represented as an implemented handler.

Generated `docs/api/turnstile-people.openapi.json` and
`docs/api/identity-invitations.openapi.json` from local Zod registries with shared schemas/
responses, every schema example validated, per-status errors and explicit normal/restricted/
service/setup policies. Added `pnpm docs:user-management` and deterministic checks to
`pnpm check:contracts`; example/generator/artifact changes invalidate owning test caches.
Updated architecture, package guides, plan/spec references and workspace standards.

Verification (2026-11-03): `pnpm check`, `pnpm build`, `pnpm test` and
`pnpm test:integration` pass, including 23 product-contract checks (10 existing onboarding
plus 13 new groups), four new reusable authority checks, 19 Fastify and 91 real disposable
PostgreSQL checks. Existing DMS-auth generated-document check also passes. A negative drift
probe rejects an altered generated file; original bytes restored and both new documents
then pass deterministic verification. All 214 local documentation targets/heading references,
unchanged UM-R01–22 text/IDs, targeted Biome and `git diff --check` pass. Logs:
`/tmp/turnstile-um-i02-{check,build,test,test-integration}.log`,
`/tmp/turnstile-um-i02-{generation,drift,drift-probe,existing-dms-contract}.log`.
The existing Vite bundle-size advisory remains. New feature images, browser/actual owning
HTTP journeys, customer runtime and production release were not exercised; disposable
PostgreSQL execution verifies existing regression behavior, not future feature persistence.
Handoff: UM-I02 is complete without blockers. Next is UM-I03 canonical access persistence,
repeat-safe legacy-source import and private operator recovery, preserving the coordinated
closed-writer transition. UM-I06 can follow independently after these contracts as planned.
All prior uncommitted planning/visual work remains on development. No new feature database
migration, live identity/access/invitation, saved installation, commit/push or deployment
change was performed.

UM-I01 — **Completed** (owner: Codex, 2026-11-03). Scope: start authorized
user-management implementation with the specification/architecture prerequisite from the
linked plan. Added `docs/turnstile/user-management/user_management_specification.md`, preserving UM-R01–22 wording
and confirmed D01–03, and adopted its product acceptance. Architecture now freezes the
seven-action versioned permission catalog (keeping the original flat catalog unchanged
until coordinated runtime replacement), four read-only system starters, protected role,
normalization/ceiling rules, exact/subtree operation matrix, invitation/approval/delivery
transitions, route/DTO/error/version policies, private recovery and release barrier.
Recorded an acyclic Nest dependency map, one-pool transaction coordination, every current
flat-access consumer/private writer and full-configuration success/replay/conflict path.
Updated proposal/implementation-plan/workspace references; product requirements belong to
the accepted specification, technical decisions remain centralized in architecture.

Verification (2026-11-03): `pnpm check`, `pnpm build`, `pnpm test` and
`pnpm test:integration` pass, including 19 Fastify and 91 real disposable PostgreSQL checks.
Build/unit tasks reused valid Turborepo cache; integration execution was live. Confirmed
unchanged text/IDs for all 22 requirements and validated local document targets/heading
references; targeted Biome and `git diff --check` pass. Node 24.21.0, pnpm 12.16.1 and
uv 0.13.6 match pins; development matches freshly fetched origin/development. Logs:
`/tmp/turnstile-um-i01-{check,build,test,test-integration}.log`. Existing Vite bundle-size
advisory remains. No new tests were added for documentation-only adoption. Exact feature
images, browser journeys, customer runtime and production deployment were not exercised
for this prerequisite; disposable database tests are distinct from those release gates.
Handoff: UM-I01 is complete without blockers; next is UM-I02 strict executable contracts
and deterministic generated API documentation, then UM-I03 onward in dependency order.
Runtime role/assignment/invitation persistence, recipient/administration handlers and UI
remain unimplemented. Preserve the closed-writer cutover and exact legacy grants. All
prior uncommitted planning/visual work remains intact on development. No schema/migration,
live identity/access/invitation, saved installation, commit/push or deployment change.

UM-REVIEW-04 — **Completed** (owner: Codex, 2026-11-03). Scope: owner-requested
final multi-model review of user-management journeys, use cases, authorization and failure
boundaries; resolve proposal gaps and create a detailed dependency-ordered implementation
plan. Requested reviewers: GPT 6.1 Sol at xhigh and opencode-go Gemini Argon 4, subject to
actual provider/model availability. Preserve confirmed custom roles, company/unit scopes,
child-unit default, multiple additive assignments, company-wide administration and Mailpit.
Both requested models were available and launched with the exact requested Sol xhigh
setting and `opencode-go/gemini-4-argon`. The Sol review returned 16 concrete gaps; checked
them against the actual flat-grant/session, organization-response, operator and authority
boundaries. Added explicit lifecycle/recovery outcomes and UM-R01–22 to the proposal,
a planned technical target in architecture, and `docs/turnstile/user-management/user_management_implementation_plan.md`
with UM-I01–11 dependencies, owners, exit gates, J01–16 acceptance and coordinated release/
restore policy. Updated the workspace-plan reference. Central targets cover canonical
legacy grants/evaluation, scoped projections/operation rules, access-changing moves,
restricted recipient state, approval generations, narrow service identity and durable mail.
Gemini Argon returned 15 substantially overlapping findings. Read both full reports and
reconciled them against code and current tests. Final additions specify read-only starter
copies, dual people/role authority for referenced-role permission edits, company coverage
for reusable added permissions, authority-owned recipient name/password setup followed by
separate verification, fixed sign-in/reset continuation, actor-specific access/CSRF recovery,
dedicated access audit/all-table RLS readiness and explicit recycled-address handling.
The plan's review-disposition table records closures and deliberately rejected alternatives:
invitation-as-identity-verification, DMS client reuse, weakened session fencing, implicit
resends and structure-only inherited-grant changes. No requested reviewer remains running
or unresolved, and no further product approval is required by these corrections.
Verification (2026-11-03): `pnpm check`, `pnpm build`, `pnpm test` and
`pnpm test:integration` pass, including 19 Fastify and 91 real disposable PostgreSQL
checks. Local document targets/heading references, targeted Biome and `git diff --check`
pass. Final candidate logs:
`/tmp/turnstile-user-management-review-final-{check,build,test,test-integration}.log`.
The existing Vite bundle advisory remains; no container-image/customer-runtime/production
verification was performed for this planning work. Handoff: the final multi-model review,
proposal corrections and detailed UM-I01–11 implementation plan are complete without
blockers. Start at UM-I01 when implementation is requested; keep confirmed D01–03 and
Mailpit, use the centralized target and verify each package's exit evidence. Initial-admin
identity and real production email/domain setup remain rollout prerequisites. Changes
remain uncommitted on development, preserving prior work. Documentation/planning only;
no schema/runtime, live identity/access, migration, commit/push or deployment change.

UM-SCOPE-03 — **Completed** (owner: Codex, 2026-11-03). Scope: update the
user-management proposal for owner-confirmed company-wide and Site/Department-scoped
access, confirm existing Mailpit for development invitation delivery, and identify
remaining product decisions requiring owner approval. Revised the purpose, invitation
journey, role/scope assignment model, scope-compatible Unit manager starter, company-only
permission handling, shared-role effects, hierarchy/reference enforcement and delivery
verification. The document explicitly supersedes the earlier company-wide-only concept;
that historical visual is unchanged. Mailpit reuses the existing architecture/port references.
D01–D03 were explicitly answered by the owner: Include child units is an option enabled
by default; several role/scope assignments per person are allowed with additive grants;
only company-wide authorized administrators manage people and role definitions in this
release. The proposal now records them as confirmed, with no remaining product approval
questions. Initial-admin account selection and production email configuration are rollout
prerequisites; bounded technical defaults remain specification work.

Verification (2026-11-03): `pnpm check`, `pnpm build`, `pnpm test` and
`pnpm test:integration` pass, including 19 Fastify and 91 real disposable PostgreSQL
checks. Final proposal/progress Biome and `git diff --check` pass. The existing Vite
bundle-size advisory remains. Logs:
`/tmp/turnstile-user-management-scope-{check,build,test,test-integration}.log`.
No container-image, customer-runtime or production verification was performed for this
documentation-only task. Handoff: the requested proposal/purpose update and owner
decisions are recorded without blockers; next is the detailed feature specification and
architecture/contracts before implementation. Prior uncommitted proposal/concept changes
are preserved on development. No runtime/schema, live invitation/account/access or
installation state changed; no commit, push or deployment was performed.

UM-VISUAL-02 — **Completed** (owner: Codex, 2026-11-03). Scope: illustrate the
people/invitation journey and explore owner-requested dynamically named/configured roles,
retaining confirmed company-wide scope. Prepare an interactive concept, revise the
discovery proposal to distinguish starter roles from custom roles and supported product
permissions, and show the visual in the conversation. No live administration, application
feature, schema or permission grant is authorized by this illustration. Added
`docs/presentations/user-management-concept.html` with Journey, Create a role and Invite &
join views. Revised `docs/turnstile/user-management/user_management_design_proposal.md` to recommend custom roles
from a supported permission catalog, starter templates, a protected administrator,
grant ceilings, shared-edit impact and explicit company-wide scope. Runtime architecture
and contracts remain unchanged; existing configuration managers are not promoted.
Desktop dark and narrow light HTML previews have no console messages. A disposable
Playwright run passes custom-role creation, selection on invite, verification, resend
invalidating acceptance, acceptance, suspension/reactivation and all three views at
320/390/728px with no horizontal overflow, page errors or network requests. Role editing
impact is explanatory in this concept; identity/email/access changes are simulated only.
Verification (2026-11-03): `pnpm check`, `pnpm build`, `pnpm test` and
`pnpm test:integration` pass, including 19 Fastify and 91 real disposable PostgreSQL
checks. Fixed prototype lint/accessibility issues before the successful check; final
targeted Biome and `git diff --check` pass. The existing Vite bundle advisory remains.
Logs: `/tmp/turnstile-user-management-visual-{check,build,test,test-integration}.log`.
The final HTML was previewed and rendered inline in the conversation. No container-image,
customer-runtime or production verification was performed for this illustration.
Handoff: requested visual/discovery work is complete without blockers; company-wide scope
remains confirmed and custom roles are the revised first-release recommendation. Adopt
the exact catalog, role/grant policy and invitation lifecycle in the feature specification
before architecture/contracts and runtime implementation. Changes remain uncommitted on
development; no live membership, authority account, schema or installation state changed.

UM-DISCOVERY-01 — **Completed** (owner: Codex, 2026-11-03). Scope: review the
post-authentication/onboarding user journey and existing identity/access boundaries,
then prepare the first user-management/invitation/RBAC proposal for product review.
The owner selected company-wide roles first. Reviewed current private account/access
provisioning, the three-permission catalog, Settings/readiness guards and the accepted
onboarding boundary. Added `docs/turnstile/user-management/user_management_design_proposal.md` with the recommended
People & access journey, proposed fixed roles, invitation/acceptance and administration
states, existing-grant/first-admin transition and delivery order. Configuration managers
are not implicitly people administrators; role definitions and lifecycle policy remain
proposed. The proposal identifies the pre-membership acceptance gap: ordinary login
already requires local product access, so invitees need a dedicated verified-identity
acceptance path before an ordinary product session can be established.

Verification (2026-11-03): `pnpm check`, `pnpm build`, `pnpm test` and
`pnpm test:integration` pass, including 91 real disposable PostgreSQL checks. Fixed the
new document's table formatting before the successful check; final Biome formatting and
`git diff --check` pass. The existing Vite bundle-size advisory remains. Logs:
`/tmp/turnstile-user-management-discovery-{check,build,test,test-integration}.log`.
No container-image, customer runtime or production deployment verification was performed
for this documentation-only task. Local development matches fetched origin/development;
changes remain uncommitted. No contracts, schemas, runtime or installation state changed.
Handoff: discovery is complete without blockers; company-wide scope is confirmed. Next
product work is adopting the proposed role matrix and invitation lifecycle in a dedicated
specification, followed by architecture/contracts and implementation in the linked order.
No implementation of invitations or roles is claimed by this discovery milestone.

WORKSPACE-DEVELOPMENT-PR — **Completed** (owner: Codex, 2026-11-03). The owner
authorized committing and merging the current branch into development. Scope: the
development-first branch policy and the previously verified Settings navigation consistency
fix, with their architecture/design guidance and handoffs. Reviewed all six changed files;
no additional application change is needed. The branch is based on current
`origin/development` (`2ea23fb`); local `pnpm check`, `pnpm build`, `pnpm test` and
`pnpm test:integration` passed as recorded in WORKSPACE-BRANCH-POLICY. Committed the
reviewed changes as `8d4eec6`, pushed the branch and opened
[PR #6](https://github.com/nishanthturnstile/turnstile-360/pull/6) targeting development.
At head `1d8b53d`, all push and PR checks and all five container builds passed. The first
PR integration run passed all 19 Fastify and 91 database tests but reported an unhandled
PostgreSQL administrative connection termination (`57P01`) during upgrade-fixture cleanup;
the failed job passed on rerun without source changes (workflow `41603919605`, attempt 2).
No review comments or conflicts were outstanding. Merged PR #6 into development as
`f053202` on 2026-11-03 and fast-forwarded/switched local development to that merge.
This documentation follow-up records the actual result; earlier entries retain their
historical verification state. `git diff --check` passes. No remaining work/blocker in
the authorized scope; main was unchanged and no production deployment was performed.

WORKSPACE-BRANCH-POLICY — **Completed** (owner: Codex, 2026-11-03). Recorded the owner's
development-first policy in root `AGENTS.md` and `docs/standards/workspace.md`: work on
development or branches created from up-to-date development, target development for change
PRs, and never commit, push changes or merge directly into main. Moved the checkout to
`docs/development-branch-policy`, created from freshly fetched `origin/development` at
`2ea23fb`. Its committed tree matches the previous main checkout; all prior uncommitted
changes and other agents' entries are preserved. Historical merge records remain unchanged.

Verification (2026-11-03): `pnpm check`, `pnpm build`, `pnpm test` and
`pnpm test:integration` pass, including real disposable PostgreSQL checks.
`git diff --check` passes; branch HEAD matches the fetched development base. Logs:
`/tmp/turnstile-branch-policy-{check,build,test,integration}.log`. Changes remain
uncommitted; no push, PR or merge was performed. No remaining work/blocker in scope.

ONB-SETTINGS-NAV-CONSISTENCY — **Completed** (owner: Codex, 2026-11-03). Removed the
Structure-only header flex/spacing overrides and narrow-screen label hiding. All Settings
sections now share the Settings label above the horizontal section links; Structure keeps
its existing full canvas/content ownership. Architecture and design guidance record this
shared layout. No application state, contracts or installation data changed.

Verification (2026-11-03): `pnpm check`, `pnpm build`, `pnpm test` and
`pnpm test:integration` pass, including 19 Fastify and 91 PostgreSQL checks. Shared preview
layout checks at 1280px and 320px confirm the label above the tabs for all four section
modes, identical header heights and no narrow page overflow. The restarted browser was
unauthenticated; visual checks used inert shared-header markup and production CSS with
writes blocked, rather than an account login. The existing Vite bundle advisory remains.
Restored the cancelled watcher with `docker compose watch --no-up`; source sync succeeded
and all application services remain healthy. Logs: `/tmp/turnstile-settings-nav-*.log`.
No remaining work/blocker in scope; changes are uncommitted and Watch remains running.

ONB-STRUCTURE-PR — **Completed** (owner: Codex, 2026-11-03). Reviewed and committed the
authorized organization-structure changes as `e9f6631`, reconciled main ancestry without
source changes, and created/reviewed [PR #4](https://github.com/nishanthturnstile/turnstile-360/pull/4).
The promotion explicitly includes the previously reviewed onboarding baseline from PR #3
that main lacked. Review found no blocking defect in canonical command fencing, retained
drafts/readback, gesture ownership, outline rendering or zoom cadence. Local verification
is recorded in ONB-CHART-ZOOM-STEPS and the preceding feature entries. GitHub push and PR
CI passed all workspace checks and all five container builds at head `abab942`; the PR
workflow run is `41576371604`. Merged to main as `099c434` on 2026-11-03 after those checks
passed, and fast-forwarded the local main branch. This documentation follow-up records the
actual merge outcome. No remaining work/blockers in the requested scope; no production
deployment was performed. Earlier feature entries describe their state at those milestones.

ONB-CHART-ZOOM-STEPS — **Completed** (owner: Codex, 2026-11-03). Scope: replace
oversensitive modifier-wheel chart zoom with the owner's requested 10-percentage-point
steps, shared with buttons/keyboard, while preserving pointer anchoring and touch pinch.
Implemented one shared additive step for modifier-wheel, buttons and keyboard. Large wheel
events produce at most one step; small trackpad deltas accumulate with pause/reversal/
modifier-release resets. Direct touch pinch and pointer anchoring remain intact. Added
three focused regressions for arbitrary Fit percentages, large notches and smooth input;
all 13 web tests pass. Verification (2026-11-03): `pnpm check`, `pnpm build`, `pnpm test`
and `pnpm test:integration` pass, including 19 Fastify integration and 91 real PostgreSQL
checks. The isolated visual-structure HTTPS suite passes exact 10-point large Ctrl-wheel,
Cmd-wheel, button and keyboard assertions, pointer anchoring and existing pan/pinch/move/
draft/recovery regressions. The running development web source has the stepped handler
and no exponential wheel calculation; its temporary watcher is stopped. Logs:
`/tmp/turnstile-zoom-steps-*.log`. All prior uncommitted work is preserved; no installation
data was changed. No remaining work/blockers in scope; no commit, push or production deploy.

ONB-CHART-NAVIGATION — **Completed** (owner: Codex, 2026-11-03). Scope: design and
implement whiteboard-style chart pan/zoom with discoverable controls and keyboard/touch
alternatives. Preserve automatic hierarchy layout, confirmed unit moves, outline behavior
and all editing/recovery state. Implemented a separate transient camera presentation with
blank/Hand/Space/middle drag, wheel pan, anchored modifier-wheel zoom, real touch pinch,
focused keyboard controls and an always-available zoom/reset/Fit bar. Pointer capture,
extra-touch guards and blur/Escape cleanup separate navigation from confirmed unit moves.
Added camera geometry tests and runtime assertions of zero navigation writes; updated the
wide navigation gallery example and accepted design references. Runtime coverage caught
filtered cards falling outside the camera and a reused camera transform scaling the
outline. Search now fits its results; camera/native-list render paths have separate keys,
and no-result messaging remains fixed and clickable after gestures.

Verification (2026-11-03): `pnpm check`, `pnpm build`, `pnpm test` and
`pnpm test:integration` pass, including ten web regressions, 19 Fastify integration and
91 real PostgreSQL checks. Auth/Settings and structured-onboarding HTTPS suites pass.
The final camera/outline/move journey passes, including explicit empty-filter clearing
after a gesture, zero navigation writes and all existing draft/readback protections.
Shared preview review confirms light/
dark controls, active Hand mode, wide-chart Fit, proper outline scale and controls bounded
at 320px. The development web files are synchronized and its temporary watcher is stopped;
no installation data was changed. Logs: `/tmp/turnstile-navigation-*.log`. The existing
Vite bundle-size advisory remains. No dependencies, contracts, schemas or deployment
topology changed. All existing uncommitted work is preserved. No remaining work/blockers
in this scope; no commit, push or production deployment.

ONB-OUTLINE-UX — **Completed** (owner: Codex, 2026-11-03). Scope: improve the
Compact outline's density, hierarchy, alignment and actions while preserving the accepted
connected chart and canonical editing/recovery behavior. Implemented a single list with
52–56px rows, ancestry guides/leading chevrons, aligned types/direct-child counts and
horizontal actions. Narrow lists stack type below the name; long/deep identities retain
full named paths and bounded canvas scrolling; a separate totals footer never overlays
rows. Added four inert outline gallery fixtures and density/alignment/keyboard browser
regressions. Corrected a Tailwind display-layer conflict caught by runtime coverage.

Verification (2026-11-03): `pnpm check`, `pnpm build`, `pnpm test` and
`pnpm test:integration` pass, including seven web regressions, 19 Fastify integration
checks and 91 real PostgreSQL checks. Final visual-structure and structured-onboarding
HTTPS browser suites pass. Shared preview review covers light/dark, long names, canonical
depth eight, full selected paths and 320px overflow/footer separation. The development
web service has the current files and remains healthy; no installation data was written.
The auth/Settings suite passes on retry after a disposable Mailpit startup failure;
all three isolated HTTPS browser suites pass, including retained drafts, recovery,
keyboard selection and confirmed mouse/touch moves. Logs: `/tmp/turnstile-outline-*.log`.
The existing Vite bundle-size advisory remains. All prior uncommitted changes are
preserved. No remaining work/blocker in this scope; no commit, push or production deploy.

ONB-STRUCTURE-POLISH — **Completed** (owner: Codex, 2026-11-02). Scope: owner feedback
on the new connected chart: use the available Settings workspace for the chart, consolidate
operations into one collapsible floating panel, remove the annotated persistent generic
success banner and polish duplicated controls/spacing. Preserve prior uncommitted work,
canonical mutations, accessible feedback, drafts, recovery and onboarding behavior.
Implemented the viewport-filling Settings canvas, compact heading/navigation and one
collapsible floating operations panel. Removed the repeated map title/global Add button,
permanent side column and guidance below the chart. Card + shortcuts open the same create
form with inferred parent; Settings supports an explicit valid-parent selector and repeated
additions. Routine save feedback is announced without the annotated persistent generic
Alert or routine recovery buttons. Errors/readback remain visible in the panel.

The pinned CLI generated the dependency-free Collapsible wrapper over installed Base UI.
`keepMounted` retains create/rename/move state while collapsed; failed hidden writes reopen
their editor. Shared Card gains an embedded variant to avoid nested surfaces. Live review
confirms the canvas fills Settings and the tools remain bounded at 320px with independent
scrolling and no page overflow. No saved installation was changed by verification.
The gallery now includes explicit open-tools, adding and retained-draft states. Embedded
cards avoid nested rings, and disabled chart cards retain readable text while their actions
remain fenced. A collapsed panel identifies active drafts and filters. Architecture and
design guidance describe the new canvas/panel scroll ownership and feedback conventions.

Verification (2026-11-02): `pnpm check`, `pnpm build`, `pnpm test` and
`pnpm test:integration` pass, including seven web regressions, 19 Fastify and 91 real
PostgreSQL checks. All three isolated HTTPS browser suites pass: auth/Settings, structured
onboarding and visual structure. New checks cover the canvas occupying the Settings area,
collapsed default tools, absence of routine success Alerts/recovery buttons, retained
create/move drafts, and a committed rename response lost after collapsing its pending
editor; the failure automatically reopens recovery without losing the draft or replaying
the write. Existing permission, CRUD/conflict/readback, keyboard/pointer/touch move,
dirty-navigation, session/logout, 320px and reduced-motion coverage is retained. The initial
visual fixture attempted a card action beneath the open panel; its interaction now
collapses tools before chart gestures. The final suite passes.

Live visual review confirms the available-width/height canvas, a single new-unit form and
submit action, no generic visible success banner, bounded 320px panel scrolling and no
document overflow. The fixture-only gallery verifies retained drafts and semantic dark
surfaces; disabled cards remain readable. The existing >500kB web-bundle warning remains.
Logs: `/tmp/turnstile-structure-polish-{check,build,test,integration,browser-auth,browser-structured,browser-structure}.log`.

Handoff: requested UI refinement and verification are complete and available through the
existing local Watch stack. Settings opens with tools collapsed; a card or + opens the
same panel, which can remain open for consecutive additions. All prior changes remain
uncommitted. No backend/schema, dependency/lockfile, credential, saved installation,
LICENSE/notice or deployment change was made. No commit or push was requested.

ONB-STRUCTURE-UX — **Completed** (owner: Codex, 2026-11-02). Scope: owner-requested
complete presentation/interaction redesign of Settings organization structure, using the
Emil design engineering and shadcn skills. Improve purpose, hierarchy scanning, selection
and contextual editing while preserving canonical CRUD/moves, permissions, recovery and
onboarding behavior. No schema, deployment, account or saved-organization changes.
Implemented an automatic top-down connected chart with transient zoom/Fit, branch collapse,
search with ancestor context and a compact outline. Selection opens a responsive inspector
with purpose, full path, unit counts and contextual actions; creation uses a focused panel.
Root-only guidance and Site/Plant/Department explanations clarify the page's purpose.
The shared composition serves Settings and onboarding. Editors retain draft/readback state
outside chart rows, including lost responses and removed units. Settings uses the available
page width; the gallery includes empty, long-name, wide and narrow examples.

Verification (2026-11-02): `pnpm check`, `pnpm build`, `pnpm test` (including two focused
chart-layout regressions; seven web tests total) and `pnpm test:integration` pass; real
integration includes 19 Fastify and 91 PostgreSQL checks. All three HTTPS browser suites
pass: `pnpm test:browser:auth`, `pnpm test:browser:onboarding:structured` and
`pnpm test:browser:structure`. They retain live permissions, canonical readback, exact-key
creation retries, rename/delete conflict and uncertain-response recovery, dirty navigation,
keyboard/pointer/touch moves, session/logout and 320px/reduced-motion coverage. New chart
checks verify connections, zoom and fitting every card within the viewport. Existing
fixtures now select a unit before using its inspector actions; an initial structured test
still addressed the old row action, and passes after that selector was corrected.

The shared local preview has an expired session; visual review used the development
gallery, and authenticated flows used isolated HTTPS fixtures without modifying the saved
local organization. Reviewed light/dark, long-name, empty and 16-unit wide states; Fit chart
contains all cards and the page has no horizontal overflow. The 500-unit layout regression
checks bounds/non-overlap. The existing >500kB production web-bundle warning remains.
Logs: `/tmp/turnstile-structure-ux-{check,build,test,integration,browser-auth,browser-structured,browser-structure}.log`.

Handoff: implementation and requested verification are complete. Source changes are
available through the existing local Watch stack; refresh Settings → Structure. The shared
chart/controller, responsive styles, Button surface variant, gallery, existing browser
fixtures, design guidance and architecture record are current. No backend/schema,
dependency/lockfile, credential, saved installation or deployment change was made. Root
LICENSE and third-party notices are preserved. No commit or push was requested.

ONB-RD-CI — **Completed** (owner: Codex, 2026-11-02). Scope: correct and verify hosted
checks for [PR #3](https://github.com/nishanthturnstile/turnstile-360/pull/3).
The owner also authorized merging the redesign after CI succeeds. On `f645dee`, both hosted checks jobs passed the
workspace suites and smoke checks but failed local Compose validation: the runner's
bundled Compose rejects `develop.watch.initial_sync`. All five image builds passed in
both workflow events. The architecture already requires Compose 5.6.1 or later; local
verification uses 5.6.1.

The checks job now installs exactly Compose v5.6.1 through Docker's setup action pinned
to commit `54042514f505b273907334ae2b9cdbb9a0213c1a`. The explicit version replaces
an incompatible preinstalled runner binary. Architecture records that CI tool boundary;
application code, Compose topology and Watch semantics are unchanged.

Verification (2026-11-02): workflow YAML/step ordering and immutable action pin validated;
`pnpm check`, `pnpm build`, `pnpm test`, `pnpm test:integration` and both real Compose
configurations pass under Compose 5.6.1. Logs use `/tmp/turnstile-redesign-ci-*`.
Hosted verification (2026-11-02): both push and pull-request workflows pass on
`e4c168e20f060130302fe250b893af0d1b9e866c`: workspace checks, owning PostgreSQL/archive
integration, smoke checks, both Compose validations and all five container builds.
The PR is mergeable with no outstanding review comments. CI runs:
[push](https://github.com/nishanthturnstile/turnstile-360/actions/runs/41487662023) and
[pull request](https://github.com/nishanthturnstile/turnstile-360/actions/runs/41487672401).

Handoff: all implementation, regression verification and the hosted Compose correction
are complete. PR #3 is the authoritative integration record for final-head checks and
the merge into `development`. This final record changes documentation only; application
code, runtime configuration and migrations remain the verified candidate. Customer and
production rollout remain separate from this authorized repository integration.

ONB-RD-REVIEW — **Completed** (owner: Codex, 2026-11-02). Scope: fix and locally verify the three
redesign review findings: untouched India suggestions after concurrent zone saves,
filtered inline-editor recovery, and large-tree move eligibility cost. Preserve all
staged ONB-RD01–08 implementation and add focused regressions. The owner now authorizes
committing the redesign and fixes, creating a PR, resolving CI failures and merging once
the PR is ready. No customer deployment, persistent database reset or release replay.

Implemented untouched-zone projection from canonical readback while retaining explicit
zone drafts, kept filtered active editors/ancestry visible through rename reconciliation,
and indexed/cached move validation by canonical unit snapshot. The maximum-width model
regression passes; the 500-unit eligibility calculation now takes about 20–32 ms locally
instead of roughly 700 ms, and transient typing reuses the cached eligibility set.
Added real HTTPS regressions for concurrent UTC confirmation followed by Save and exit,
and a lost rename response that stops matching the filter while recovery remains usable.
Architecture and affected delivery references are current. All prior staged work remains.

Verification (2026-11-02): focused web tests/typecheck, `pnpm check`, `pnpm build`,
`pnpm test` and `pnpm test:integration` pass, including 19 Fastify and 91 PostgreSQL
checks and real synthetic upgrade archives. All three browser suites pass: auth,
structured onboarding and the extended structure editor. The new recovery cases passed
on their initial run; a later touch-fixture geometry assumption was corrected by restoring
its original alphabetical name before the existing drag checks, and the full suite then
passed. Existing explicit drafts, dirty blocking, keyboard/pointer/touch moves, session
refresh/recovery/revocation and logout are retained.

Built `turnstile360-api:rd-review-20261102` and `turnstile360-web:rd-review-20261102`
from monorepo-root contexts; isolated candidate image checks pass for exact packaged
migrations/contracts, SPA/privacy policy, non-root and read-only runtime. `pnpm test:smoke`
and both local/Dokploy Compose configurations pass. Logs use
`/tmp/turnstile-redesign-fix-*`. The existing >500kB web bundle warning remains.

Handoff: source fixes and local verification are complete. Deliver the preserved redesign
and corrections through `feat/onboarding-redesign` → `development`; the associated GitHub
PR records hosted CI/review and merge status. The owner authorized resolving CI and merging.
No persistent installation migration, credential change or customer/production deployment
was performed by this task; retain RD08's recovery evidence and running Watch installation.

ONB-RD08 — **Completed** (owner: Codex, 2026-11-02). Scope: final redesign verification,
exact candidate image checks, version-aware archive rehearsal and the previously selected
existing local-development release. RD01–07 changes and staged/uncommitted work are preserved.
No customer/production rollout, account reset, tenant bootstrap or live database restoration.

Updated `test-onboarding-images.mjs` to compare every packaged migration journal entry and
SQL hash (including 0007–0010), verify packaged v1/v2 contracts/private commands, and retain
non-root/read-only/fail-closed runtime and SPA/CSP/notices checks. The backup helper can
record the matching candidate pair plus installed images, product journal and nonsecret
role inventory. Local archive rehearsal allows only the intended incomplete-v1 metadata
transition; all other saved configuration is compared exactly. The existing six upgrade
cases now dump/restore their synthetic v1 database before migration, validating empty,
partial, saved Calcutta/Kolkata, completed root-only and completed-structure preservation.
Synthetic cases use an identified disposable cluster and their own database. Failed
subprocess details are retained only in protected diagnostics outside the checkout.

The local release verifier follows Organization/First unit/Review and Finish setup, requires
an explicit protected approved-unit input only when missing in incomplete v2, preserves
existing saved zones, and performs exact canonical readback for completed installations.
It never invents a unit or replays activation to manufacture a fresh journey. Runbook,
architecture, README and generated OpenAPI implementation notes are current. No prior
I08 pair is approved for v2/move rollback: retain maintenance and fix forward unless a
specific immutable compatible pair is separately verified; do not undo parent guards.

Verification (2026-11-02):

- `pnpm check`, `pnpm build`, `pnpm test` and `pnpm test:integration` pass. Integration
  includes 19 Fastify and 91 PostgreSQL checks; the six upgrade cases include real archives.
  The final regenerated OpenAPI and architecture formatting check passes.
- `pnpm test:browser:auth`, `pnpm test:browser:onboarding:structured` and
  `pnpm test:browser:structure` pass: required Site/Department, waiting/resume/readback,
  manager permissions and canonical Settings, responsive sidebar/focus/dirty blocking,
  real keyboard/pointer/touch moves, 20 reloads, recovery/revocation and full/partial logout.
- Built `turnstile360-api:rd08-20261102` (image `sha256:6c3dc09471ee25ec9bc66eefd33a0b5304376dc4006b3fe11c7597751ac3687d`)
  and `turnstile360-web:rd08-20261102` (image `sha256:5fed7ae6dfd916cc4b85745a5ff0541a9f9d0c3f3cd638c6387517997977ce74`)
  from monorepo-root contexts. `pnpm test:images:onboarding` passes with no credentials,
  external network or host bindings. The existing >500kB web bundle warning remains.
- Both the retained pre-onboarding archive and a fresh coherent current-target archive
  pass isolated restore/owning migration/repeat initialization/grant/isolation plus the
  six-case matrix. An initial matrix subprocess failure was bounded; the two successful
  rehearsals and final integration run establish the recorded evidence.
- Verified the existing administrator login/logout before maintenance. Paused all three
  application writers, captured the fresh backup, rehearsed it, then applied only pending
  owning product migrations through 0010 and repeated initialization. Every original table
  fingerprint and recorded role setting matched before browser admission: identities,
  accounts, sessions, grants, clients, enrollment, saved UTC/profile/units and completed-v1
  revision/actor/time were preserved. Runtime authority-read, grant-write and missing-tenant
  denials plus the new parent-column privilege were verified on the actual target.
- Rebuilt the matching development images and started the established `docker compose up
  --watch` entry. All three application services are healthy and non-root on reserved
  23600/23601/23602; Watch is enabled. No ingress, port or persistent credential changed.
- The updated credentialed release runner passes on the actual target: direct Home,
  root-only legacy optional-unit prompt, canonical Settings, machine connection, local
  host-only HttpOnly SameSite=Lax cookies, logout and same-account relogin. Exact version,
  revision, profile, zone, units and completion readback remains unchanged. Ordinary waiting
  and fresh activation were deliberately not repeated on this already completed target.
  The private password file was removed after verification.
- 378 relative documentation links resolve, including 149 heading anchors; `git diff --check`
  passes. Root LICENSE, third-party notices and lockfile remain unchanged by RD08.

Recovery/evidence is retained privately at
`~/.local/state/thaarei/turnstile-360/onboarding-releases/20261102-rd08`: coherent dump,
checksum/manifest, original/candidate/runtime image IDs, role/journal inventory, operator
readbacks, `local-verification.json` and final `release-state.json`. The record distinguishes
production-image isolation checks from the actual development runtime and marks production
acceptance false. Original I08 backups remain intact. Public bounded logs are
`/tmp/turnstile-onboarding-rd08-{check,build,test,integration,images,prior-archive,target-rehearsal,target-migration,browser-auth,browser-department,browser-structure,local-verification,doc-links}.log`;
Compose build/Watch logs use the same prefix.

Handoff: RD01–08 are complete for the authorized local target. No implementation item
remains in this redesign plan. Production/customer release still needs its own selected
backup/rehearsal, compatible deployment, actual DNS/TLS/cookies/runtime evidence, named
customer administrator handover and external email acceptance. Local HTTP/fixture results
do not establish those outcomes. Keep the protected recovery point and approved candidate
pair; leave the healthy local Watch stack running. No commit or push was requested.

ONB-RD07 — **Completed** (owner: Codex, 2026-11-02). Scope: persistent completed
workspace sidebar with transient collapse and accessible narrow overlay, compact Settings
navigation, real dashboard actions and a legacy-only optional first-unit prompt. Preserve
RD01–06 changes, canonical editors, session/readiness boundaries and draft protection.
Implemented `WorkspaceNavigation` with shared 232px/64px navigation, generated Sheet/Tooltip/Empty compositions,
compact horizontal Settings sections and manager-only canonical legacy suggestion. Layout
state remains transient; accepted navigation dismisses the overlay, cancelled dirty
navigation retains it, and content focus handles return from Settings. The development
gallery reuses the navigation with inert anchors. `App` exposes only delivered Home and
authorized Settings actions; ordinary users never request manager configuration. The
optional prompt requires a completed v1 canonical snapshot with only the organization
root. Settings reuses the existing controllers and version-specific backend protections;
the overview no longer describes every v2 unit as optional. Activation is preserved.

Architecture/design guidance and gallery references are current. The pinned shadcn CLI
generated the three primitives without overwriting Button. Existing MIT notices cover
them; dependencies, lockfile and proprietary LICENSE are unchanged by RD07.

Verification (2026-11-02):

- `pnpm check`, `pnpm build`, `pnpm test` and `pnpm test:integration` pass, including
  19 Fastify and 91 PostgreSQL checks (30 authority/DMS + 61 product).
- `pnpm test:browser:auth` passes the full setup/Settings/auth chain. New coverage checks
  root-only completed-v1 direct entry and optional Settings navigation using read-only
  canonical projection fixtures, named keyboard icon links/tooltips, persistent chrome,
  modal focus/expanded state, Escape/desktop-resize dismissal, cancelled draft navigation
  and accepted navigation/content focus. Existing database upgrade tests separately prove
  preservation of real completed v1. Ordinary routes still make no configuration reads.
- Both `pnpm test:browser:onboarding:structured` and `pnpm test:browser:structure` pass:
  fresh required Department, DMS outage, canonical ongoing CRUD, real keyboard/pointer/touch
  moves, conflicts/readback, narrow layout and reduced motion.
- The full auth fixture retains 20 real reloads and one session check per reload. Its
  private rate counter resets between artificial reload groups to accommodate canonical
  manager Home reads; production limits and per-request authorization are unchanged.
  Tooltip assertions follow the installed Base UI visual-label contract, while modal
  assertions/captures wait for settled focus and the opening transition.
- Inspected desktop dashboard and 320px Settings/open-menu captures. Relative documentation
  file links resolve and `git diff --check` passes. The existing >500kB bundle warning remains.

Final logs: `/tmp/turnstile-onboarding-rd07-{check,build,test,integration,browser-auth,browser-department,browser-structure}.log`.
Captures: `/tmp/turnstile-rd07-{dashboard-desktop,settings-mobile,navigation-mobile}.png`.

Handoff: ONB-RD08 is next: coordinated verification/release, candidate API/web images,
upgrade/restore rehearsal and installed-target evidence. No persistent installation
migration, image deployment or target acceptance was performed in RD07. Preserve existing
RD01–06 worktree changes; do not reset an activated installation to manufacture setup tests.

ONB-RD06 — **Completed** (owner: Codex, 2026-11-02). Scope: one visual structure
editor for setup/Settings with connected expandable cards, compact outline, contextual
create/rename/remove, selection/search with ancestry, and confirmed keyboard/touch/pointer
moves through RD04. Existing RD01–05 worktree changes, canonical revisions, exact create
receipts, partial save/exit, shared dirty blocking and auth/session boundaries are retained.

Extracted `StructureEditor` owns create/recovery state for both callers. `StructureTree`
composes connected cards/outline from bounded canonical units, with contextual Add first
unit/Add below, valid type/parent inference, inline rename/remove and selected details.
Root naming stays in Organization. Search retains ancestor context/full paths and disables
filtered dragging without restricting the complete Move to chooser. Last required-unit,
root, child/reference and type/depth/name protections remain authoritative on the backend;
client preflight helpers explain restrictions and prevent invalid choices.

Typed parent PATCH plus `UnitMoveEditor` provide one destination search, old/new-path
preview and explicit Confirm move for keyboard/click/tap and Pointer Event gestures.
Touch-action is restricted to the handle; native scrolling, valid-target highlighting,
Escape/pointer cancellation and invalid/outside-drop cancellation stay available. No
sibling sorting, diagram coordinates, optimistic tree replacement or automatic PATCH
replay is added. Uncertain/conflicting writes keep the destination and require explicit
readback before retry; canonical readback can confirm an already-saved destination.
Stable flat row keys retain inline state across reparenting. If an edited unit disappears,
a clearly labelled transient row preserves draft/error/readback/Cancel controls, without
entering canonical units or write payloads. Drag feedback never shifts target geometry.

Files: extracted StructureEditor, new StructureTree/UnitMoveEditor/structure-model,
configuration API/shared errors/read hook and existing UnitEditor, shared CSS, fixture-only
StructureGallery and design-system composition, four Node model regressions, new HTTPS
visual-editor scenario/command and existing structured/Settings fixtures, OpenAPI
implementation description and affected architecture/design/workspace/release guidance.
Native Pointer Events require no new dependency; no schema/migration, port, topology,
LICENSE or third-party notice changes were made by RD06.

Verification actually run (2026-11-02): `pnpm check`, `pnpm build`, `pnpm test` and
`pnpm test:integration` pass. Integration executes 19 Fastify and 91 real PostgreSQL cases
(30 authority/DMS and 61 product). Four new Node tests cover cycle/type/root relationships,
whole-subtree depth eight/nine, sibling collisions and version-aware required-unit removal.
`pnpm test:browser:structure`, `pnpm test:browser:onboarding:structured` and
`pnpm test:browser:auth` all pass against disposable HTTPS/PostgreSQL/Mailpit fixtures.
The new suite exercises shared setup/Settings and stable IDs, contextual creation,
ancestor search/duplicate names, outline/details, keyboard Move to/invalid destinations,
real revision conflict, exact lost-response GET reconciliation with no write replay,
pointer cancellation/drop preview/confirmation, native Chromium touch drag and
320px/reduced motion. Existing suites verify fresh Department/India setup, partial saves,
restart/resume/dirty navigation, canonical Settings CRUD/concurrent edits/lost deletion,
live permission removal, twenty authenticated reloads and auth/recovery/reset/logout.
Desktop/mobile editor captures were inspected. Initial remount and drag-geometry findings
were corrected; accessible type/path names were restored, and an adapted fixture's stale
organization-name expectation was fixed. Final static/build/model checks pass after the
missing-unit copy correction. Unchanged tasks use valid Turbo caches; the existing web
chunk-size warning remains. Generated contract/example drift, targeted Biome/whitespace
and 203 local document links/anchors pass.

Handoff: ONB-RD07 is next: completed dashboard/sidebar, compact nested Settings navigation,
legacy completed-v1 optional-unit prompt and ongoing Settings refinements. Reuse this
editor and preserve its canonical/draft/readback boundaries. RD08 still owns coordinated
image/upgrade/restore/installed-target verification and release; local browser success is
not that rollout. No blocker remains for RD06. No persistent local/customer migration,
deployment, account/data/zone change, commit or push was performed. Logs:
`/tmp/turnstile-onboarding-rd06-{check,build,test,integration,docs,browser-department,browser-structure-complete,browser-auth-complete}.log`.

ONB-RD05 — **Completed** (owner: Codex, 2026-11-02). Scope: dedicated setup and
ordinary waiting layouts, canonical Organization/First unit/Review resume and guarded
completion, preserving typed transport, draft recovery and shared navigation blocking.
Existing RD01–04 worktree changes and authentication/session behavior are retained.

Implemented neutral entry and dedicated setup/waiting with `EntryLayout`/`EntryContent`;
completed `WorkspaceLayout` mounts only after verified session/readiness. Brand, signed-in
identity and Sign out remain available; shared `SetupProgress` stays outside the bounded
setup scroll pane. Incomplete dashboard/Settings entry resumes the first saved gap;
ordinary users receive waiting/Retry. Direct Review cannot bypass a missing profile or
first unit. Configuration failure stays distinct from identity expiry and DMS outages;
recoverable checks retain mounted hidden drafts, while successful canonical reads clear
stale failure state.

Organization suggests Indian Standard Time/Kolkata only without a saved zone. Continue
explicitly confirms it; untouched empty/partial Save and exit omits that suggestion and
preserves saved values. First unit creates a real direct-child Site/Plant or Department
with implicit root, required saved readiness and explicit partial save/exit. Exact
body/revision/key plus save/exit intent survive uncertain create retries and readback.
Existing rename/remove editors support actual Review corrections without a new mutation
path. Business-only Review summarizes saved profile/zone/first units and provides Edit,
Back and Finish setup; internal root/access checks stay on the server. Completion is
revision-bound and disabled while unready/checking or after a conflict/uncertain result
until explicit readback. No automatic mutation replay occurs. Active create/save-exit/
retry actions have their own pending feedback.

Files: App orchestration, new entry/progress compositions, configuration forms/unit
editor/routes/read hook, OnboardingJourney, shared CSS, gallery/design guide, existing
onboarding/structured/Settings HTTPS scripts, OpenAPI generator/output implementation
status, architecture and package/release references. No dependency, database schema or
migration changes were added by RD05.

Verification actually run (2026-11-02): `pnpm check`, `pnpm build`, `pnpm test` and
`pnpm test:integration` pass (19 Fastify and 91 real PostgreSQL cases: 30 authority/DMS,
61 product). Both `pnpm test:browser:auth` and
`pnpm test:browser:onboarding:structured` pass against disposable HTTPS/PostgreSQL/
Mailpit fixtures. Browser evidence covers fresh required Site and Department, empty and
partial profile/unit saves, India confirmation versus unsaved suggestion, saved UTC,
restart/relogin resume, Review/Settings deep links, first-unit rename, dirty Back/Forward,
root-only HTTP/UI rejection, exact-key lost-response create recovery, completion readback
without replay, ordinary waiting transitions, permission revocation, DMS outage isolation,
Settings CRUD/concurrency, twenty authenticated reloads, recovery/reset/logout and
320px/reduced-motion states. Desktop/mobile Review screenshots were inspected. Initial
expanded fixture runs exhausted the real 100/minute introspection window; only the
private disposable counter is reset between phases, leaving production limits unchanged.
An inherited root-only Settings assertion was corrected to check the retained first Site.
Final static/build/unit checks also pass after the action-feedback adjustment. Unchanged
tasks use valid Turbo caches; the existing web chunk-size warning remains. Generated
contract/example drift, targeted Biome/whitespace checks and 196 local documentation
links/anchors pass.

Handoff: ONB-RD06 is next: shared visual structure editor/contextual CRUD and accessible
moves consuming RD04, including Setup and Settings integration. RD07 owns completed
navigation/ongoing Settings refinements. RD08 still owns coordinated image/upgrade/
restore/installed-target release verification; the new browser evidence alone is not
that release. No blocker remains for RD05. No persistent local/customer migration,
deployment, account/data/zone change, commit or push occurred. Logs:
`/tmp/turnstile-onboarding-rd05-{check,build,test,integration,docs,browser-auth-final,browser-department-latest}.log`.

ONB-RD04 — **Completed** (owner: Codex, 2026-11-02). Scope: implement the adopted
revision-checked parent-change API with live manage/CSRF/tenant protections, validated
subtree movement and atomic move audit/revision. Add only the required parent-column
privilege, preserve immutable identities/types/root and v2 first-unit completion, and
extend PostgreSQL/Fastify coverage plus generated implementation status. Existing
RD01–03 worktree changes are retained.

Implemented `PATCH /api/organization/units/:id/parent` through the existing configuration
lock, live grant and CSRF boundary. Strict input forbids tenant/actor selectors; canonical
checks reject missing/root units, invalid types, self/descendant cycles, excessive subtree
depth and duplicate siblings. Valid moves preserve IDs/types, descendant links, existing
root/parent references and retry receipts, grants and v1/v2 completion. Each effective
move commits one revision and attributable `unit_moved` event atomically. Current-revision
same-parent requests are no-ops; stale lost-response retries conflict, with canonical
readback supporting explicit reconciliation. The completed-v2 required-unit guard remains
explicit; moving the sole direct child below its own subtree is already rejected as a cycle.

The installed Drizzle CLI generated `0009_unit_move_audit.sql` and custom
`0010_unit_move_guards.sql` plus metadata. Reviewed SQL grants only parent-column UPDATE
and replaces the invoker-rights guard with bounded ancestry/subtree validation, retaining
tenant/identity/type/root/count protections, forced RLS and the existing pool/lock boundary.
Existing references permit valid moves; no unimplemented business references were added.
Files: Organization controller/service/repository/schema, configuration HTTP classifier,
new `configuration-move.database-spec.ts`, existing HTTP/runtime privilege checks, generated
OpenAPI, architecture and package/deployment/authentication guidance.

Verification actually run (2026-11-02): `pnpm check`, `pnpm build`, `pnpm test` and
`pnpm test:integration` pass. Integration executes 19 Fastify and 91 real PostgreSQL cases
(30 authority/DMS and 61 product). Nine new move cases cover completed v1/v2 subtree
preservation, exact depth limits, SQL and bulk-cycle rollback, duplicate siblings,
audit-failure atomicity, stale/no-op/readback behavior, one-winner contention, permission
revocation while waiting and authenticated HTTP/CSRF/privacy/response bounds. The separate
initial database run also passes. One full run encountered an existing BFF capability
success read returning 503; the complete clean-fixture rerun passes without a code change,
and its cause remains unconfirmed. The initial tuple `.includes` type error and generated
journal formatting issue were corrected. Unchanged tasks use valid Turbo caches; the
existing web chunk-size warning remains. Drizzle metadata checks, generated-document drift,
195 relative documentation links/anchors and whitespace checks pass. Pre-existing SQL
0000–0008 and prior new snapshots remain byte-identical; existing committed journal entries
and the new snapshot chain are preserved.

Handoff: ONB-RD05 is next: dedicated resumable onboarding/waiting layouts and first-unit
forms. RD06 consumes the move API in the shared visual editor; RD07 completes navigation
and Settings. Current browser/release helpers still need their planned v2 changes and
RD08 browser/image/restore/target verification before coordinated rollout. No blocker
remains for RD04. No persistent local/customer migration, deployment, account/data/zone
change, commit or push occurred. Logs:
`/tmp/turnstile-onboarding-rd04-{check,build,test,integration,integration-rerun,database}.log`.

ONB-RD03 — **Completed** (owner: Codex, 2026-11-02). Scope: implement v2 product
configuration initialization and incomplete-only v1 metadata upgrade, canonical first-unit
readiness, locked activation and completed-v2 last-unit deletion protection. Preserve
completed v1, saved zones/revisions, forced RLS and runtime/migrator boundaries; extend
real PostgreSQL/Fastify verification and generated implementation status. Existing
RD01/RD02 worktree changes are retained.

Implemented generated `0007_setup_requirement_v2.sql` and reviewed custom
`0008_setup_v2_guards.sql` using the installed Drizzle CLI, with new journal entries and
snapshots. New contexts default to v2. The owning migration locks the installed identity
then tenant configuration and upgrades only incomplete v1 metadata without changing
profile, units or business revision; empty revision-0 remains not_started. Completed v1
retains its version, actor/time, revision and optional-unit policy. SQL guards remain
invoker-rights with fixed search paths/forced RLS; no runtime privilege or new pool is added.
Only the direct owning login can perform a 1→2 metadata-only change; mixed updates,
completed conversions, downgrades and runtime attempts are rejected.

Canonical snapshots derive first-unit readiness and Organization/Structure/Review resume
from saved records. Locked activation requires a saved direct-child Site or Department
for v2 and returns finite `body/required` without side effects when missing. Completed v2
cannot lose its last qualifying unit through service or single/bulk SQL deletion; a failed
bulk statement rolls back earlier row deletions. Incomplete removal resumes Structure.
Existing leaf/reference, revision, audit, grant and repeat-completion behavior is retained.
Private initialization/inspection now expose requirementVersion. Generated OpenAPI,
architecture, README/package guidance and auth/deployment/release references match the
implemented backend; the move handler remains explicitly planned for RD04.

Files: owning organization schema/repository/service/operator, `0007`/`0008` SQL and
metadata, configuration and real-BFF PostgreSQL fixtures, the new isolated
`configuration-upgrade.database-spec.ts`, OpenAPI generator/output and affected docs.
The upgrade fixture prepares the unmodified 0000–0006 baseline in a separate database
inside the disposable test cluster; it does not reset the shared or persistent installation.

Verification actually run (2026-11-02): `pnpm check`, `pnpm build`, `pnpm test` and
`pnpm test:integration` pass. Integration executes 19 Fastify and 82 real PostgreSQL
cases (30 DMS/authority and 52 product, including 11 added cases). Coverage includes six
empty/partial/completed old-version upgrades, saved UTC/Calcutta/Kolkata preservation,
repeat migrations/initialization, Site and Department activation, direct HTTP/business
gating, SQL/runtime/tenant protection, last-unit removal, completion/delete lock ordering
in both directions and grant revocation queued before valid activation. Existing audit
rollback checks now use a genuinely ready v2 fixture. A final `pnpm test:database` also
passes after adding the bulk-delete rollback assertion. The initial crypto import and
retention receipt-count findings were fixed. Unchanged tasks use valid Turbo caches;
the existing web chunk-size warning remains. `drizzle-kit check`, generated-document
drift checks, targeted Biome/whitespace checks and 303 local document links/anchors pass.
All seven applied SQL migrations and original journal entries are byte/content unchanged;
the two new snapshot links are consistent.

Handoff: ONB-RD04 is next: implement the adopted parent-change route with guarded parent
privileges, subtree/reference validation and atomic move audit/revision; retain the v2
last-unit invariant. RD05–07 still own dedicated setup/resume, shared editor and completed
navigation. Current v1 browser journeys/release helpers need their planned v2 updates and
RD08 browser/image/restore/target verification before coordinated rollout; they were not
claimed or rerun here. No blocker remains for RD03. No persistent local/customer migration,
account/data/zone change, image deployment, commit or push occurred. Logs:
`/tmp/turnstile-onboarding-rd03-{check,build,test,integration,database}.log`.

ONB-RD02 — **Completed** (owner: Codex, 2026-11-02). Scope: implement the adopted
versioned executable setup/completion contracts, v2 first-unit/snapshot agreement,
Kolkata/Calcutta/UTC compatibility and strict move payload/finite error contracts.
Regenerate time zones and OpenAPI with the pinned toolchain, distinguish adopted move
contracts from unimplemented handlers, and add focused contract regressions. Existing
v1 persistence, completion and browser layout remain until their dependent packages.
Implemented version-specific requirement tuples and completion metadata, lifecycle/resume
validation and canonical v2 first-unit agreement while preserving completed root-only v1.
Exported strict `UnitMove`/schema and finite `required_unit` conflict; no move handler is
claimed. The generated 420-zone allowlist retains all prior identifiers and adds Kolkata,
with independent list-version/provenance and explicit compatibility additions. OpenAPI
2.0.0 validates legacy/v2 named examples, documents parent-change input/snapshot/errors
and marks the handler planned for RD04. Shared-package guidance and the web review's
exhaustive label map are updated. Files: `packages/turnstile-contracts` source/tests/README,
both generation scripts, generated onboarding OpenAPI and `OnboardingJourney.tsx`.

Verification actually run (2026-11-02): `pnpm check`, `pnpm build`, `pnpm test` and
`pnpm test:integration` pass. The contract suite passes 10 cases (4 added focused
regressions covering v2 Site/Department readiness, mixed-version/nextStep rejection,
saved-zone/legacy preservation and strict moves). Integration runs 19 Fastify and 71
real disposable PostgreSQL cases. Generated allowlist/OpenAPI/reference/example drift
checks pass, including auth permission-catalog agreement. Unchanged build/unit tasks use
valid Turbo caches. Initial document-table formatting and a missing exhaustive web label
were corrected; final Biome/whitespace checks pass. Build retains the web chunk-size warning.

Handoff: implement ONB-RD03 next using these contracts: generate/review new migrations,
default initialization to v2, upgrade incomplete v1 metadata without changing business
revision, and enforce first-unit activation/deletion under existing locks with PostgreSQL
upgrade/contention evidence. Update the generator's runtime-initialization/implementation
status when that behavior is delivered. Then follow RD04–08; do not treat the contract-only
move route or v2 examples as live handlers/enforcement. No blocker remains for RD02.
No feature database schema/migration, target data change, image release, production/customer
rollout, commit or push occurred. Browser/image/target verification was not repeated and
remains required for the later runtime/layout/release packages. Existing installation
completion/profile/zone are untouched. Logs:
`/tmp/turnstile-onboarding-rd01-rd02-{check,build,test,integration}.log`.

ONB-RD01 — **Completed** (owner: Codex, 2026-11-02). Scope: begin the authorized
onboarding redesign with adoption of its specification and technical baseline. Reconcile
required direct-child Site/Plant-or-Department setup, version-aware completion/upgrade,
saved time zones, audited accessible moves and dedicated/completed layouts with the
existing implementation. Preserve ONB-I01–08 history and all other work entries.
Milestone: specification preserves ONB-R01–12 and adds ONB-R13 moves; architecture adopts
v1/v2 projections, migration-only incomplete upgrade, direct-child readiness/deletion,
Kolkata compatibility, move route/locking/errors/audit and layout/scroll ownership. The
proposal/original plan are explicitly historical where superseded; redesign plan links
the adopted target. No configured limit, application boundary or deployment topology
changed. README, workspace plan and authentication/deployment/release references distinguish
delivered v1 procedures from the adopted v2 target. No feature schema, runtime behavior,
persistent installation change or deployment belongs to this package. Initial worktree
was clean; all other entries and ONB-I01–08 history are preserved.

Verification actually run (2026-11-02): combined RD01/RD02 `pnpm check`, `pnpm build`,
`pnpm test` and `pnpm test:integration` pass as recorded above; targeted Biome/whitespace
checks and 234 local document-link/anchor resolutions across 11 affected documents pass.
No new tests were added for the documentation-only RD01 package. Handoff: adopted target
is consistent; RD02 contracts are delivered above, and RD03 is next. No blocker remains.

ONB-REDESIGN-PLAN-001 — **Completed** (owner: Codex, 2026-11-02). Scope: create a
separate implementation plan for the owner's onboarding redesign, carrying forward the
confirmed Site/Plant-or-Department first-unit rule. Reconcile the proposed delivery order
with current contracts, persistence, web navigation and existing verification/release
tooling; provide file-level work, dependencies, acceptance and a start-work handoff.
Planning only; do not begin feature implementation or change accepted runtime behavior.
The separate `docs/turnstile/onboarding/onboarding_redesign_implementation_plan.md` is written and linked
from the design proposal. ONB-RD01–08 cover adoption, versioned contracts/time zones,
persistence/readiness, audited moves, dedicated setup, the shared visual editor,
dashboard/Settings and coordinated verification/release. All nine document links resolve.
The plan includes file-level work, recommended version/upgrade defaults, focused boundary
acceptance, CLI/tooling guidance and a reusable start-work prompt. The original v1 plan
and accepted specification/architecture remain unchanged; RD01 owns their later adoption.

Verification actually run (2026-11-02): `pnpm check`, `pnpm build`, `pnpm test` and
`pnpm test:integration` pass. Build/unit tasks reuse valid Turbo caches; integration
executes 19 Fastify and 71 disposable PostgreSQL cases. Targeted Biome, whitespace and
document-link/package-presence checks pass. No application browser/image/production
verification was repeated for this documentation-only change. No feature implementation,
migration, persistent local-data change, deployment, commit or push occurred.

Handoff: begin future implementation with ONB-RD01 in the new plan, then follow its
dependency sequence. Record the actual package and owner before starting feature work;
preserve pre-existing worktree changes. No blocker remains for this planning task.
Logs: `/tmp/turnstile-onboarding-redesign-plan-{check,build,test,integration}.log`.

ONB-REDESIGN-001 — **Completed** (owner: Codex, 2026-11-02). Scope: owner-requested
planning/design review of fresh-install onboarding, organization/workspace terminology,
India-first time-zone defaults, mandatory first operational structure level, visual
hierarchy editing and the completed-dashboard shell. Reviewed current entry gating,
onboarding/shared editors, contracts, accepted architecture/specification and the recorded
2026-11-01 source-application inspection. Added a dated recommendation to
`docs/turnstile/onboarding/onboarding_design_proposal.md` and the separate transient interactive concept
`docs/presentations/onboarding-redesign-concept.html`, preserving the adopted v1 rationale.
The owner confirmed either Site/Plant or Department can satisfy the first operational
level. The proposal covers the three-screen setup, contextual/read-only information,
India business time versus UTC instants, the Kolkata/Calcutta allowlist mismatch,
visual creation and accessible transactional moves, dashboard collapse, and versioned
compatibility for already-completed root-only installations. Existing completion stays
valid under the recommended compatibility policy. No application/schema/accepted
architecture or requirement change, dependency, deployment, commit or push was made.

Verification actually run (2026-11-02): `pnpm check`, `pnpm build`, `pnpm test` and
`pnpm test:integration` pass; build/unit tasks reuse valid Turbo caches. Integration
executes 19 Fastify and 71 disposable PostgreSQL cases. Initial concept button/callback
lint and document formatting findings were fixed; final targeted Biome and whitespace
checks pass. The concept renders at 728px and 390px without console errors. Those
illustrations are not application browser, production deployment or customer acceptance
verification. Existing local installation/accounts/data were not changed.

Handoff: review the dated redesign recommendation and concept. Implementation remains
future work: adopt the requirement/resume/upgrade changes, settle the time-zone contract
compatibility, extend first-unit readiness and audited move behavior, then deliver the
dedicated setup/editor/dashboard layouts with focused integration/browser verification.
No blocker remains for this planning task. Logs: `/tmp/turnstile-onboarding-redesign-`
`{check,build,test,integration}.log`.

WEB-LOAD-001 — **Completed** (owner: Codex, 2026-11-02). Scope: localized skeletons
and spinners for server-backed content while retaining shared layout/navigation and drafts.

Implemented generated shadcn Spinner (pinned CLI, existing Hugeicons) with compatible
component props and reduced-motion support; shared form/list/card ContentLoading,
PendingContent and LoadingStatus compositions; stable Settings and onboarding navigation
during initial/retry reads; localized route skeletons; and action-specific spinners for
configuration save/readback, auth, session, document connection and logout operations.
Saves/readback retain entries; pending navigation content stays mounted and hidden, while
headers/navigation remain available. Loading is announced once per panel and skeletons/
adjacent spinner SVGs are decorative. No artificial delay, new dependency, backend/schema,
credential or deployment-topology change. Architecture, design guide and fixture gallery
are updated. Existing work and root/third-party licenses are preserved.

Verification actually run (2026-11-02): `pnpm check`, `pnpm build`, `pnpm test` and
`pnpm test:integration` pass (19 Fastify and 71 PostgreSQL cases; unchanged unit tasks use
valid caches). Full `pnpm test:browser:auth` passes design-system/CSP/font/reduced-motion
checks, onboarding, Settings, 20 reloads and all three auth/recovery/logout journeys.
New held-response assertions prove a Settings skeleton/spinner during configuration reads,
persistent header/sidebar through loading and loaded states, a content-only skeleton
during navigation checks and a save spinner with preserved form values/navigation.
Final whitespace checks pass. No remaining blocker in this scope.

Local runtime: restarted the cancelled Compose Watch; source synchronization is active,
all existing services are running, and health-checked services are healthy. Host/container
loading-composition and Settings hashes match. Authenticated verification used disposable
HTTPS fixtures; local accounts/data were retained. No production image/Dokploy/customer
verification, commit or push. Logs: `/tmp/turnstile-web-load-{check,build,test,integration,
browser,watch}.log`. Handoff: use the existing local web application; slow server reads
now show loading feedback in their content region while shared navigation stays visible.


WEB-NAV-001 — **Completed** (owner: Codex, 2026-11-02). Scope: shared web layout,
client navigation and independent content/navigation scrolling, starting at
`/settings/organization`.

Implemented React Router 8.5.1 and shared AppLink/ButtonLink, persistent WorkspaceLayout,
canonical Settings state across sections, isolated editor lifecycles, named keyboard
scroll panes and a responsive Settings sidebar/horizontal section row. Header, workspace
navigation and footer stay outside page scrolling. One unsaved-entry blocker aggregates
all editors and protects links plus Back/Forward; cancelled navigation retains drafts.
Router updates are synchronous so blocker dismissal does not defer form interactions.
Session/readiness checks accept the destination before replacing content, without
remounting chrome or returning to the startup skeleton. Onboarding steps wait for fresh
canonical reads, fencing late older revisions; successful saves clear only their own dirty
marker before navigation. Auth/identity exchanges retain full document navigation.
No backend, permission, schema, port or persistent browser-state change.

Files: web router/App, new navigation/scroll-region/workspace-layout compositions,
ButtonLink, auth text link, configuration editors/shared hook, onboarding/Settings,
shared CSS/gallery, web manifest/lockfile/notices, architecture/design guide and focused
Settings/onboarding browser assertions/diagnostics. Verification actually run (2026-11-02):
`pnpm check`, `pnpm build`, `pnpm test` and `pnpm test:integration` pass (19 Fastify and
71 PostgreSQL cases; unchanged unit tasks reuse valid caches). Full `pnpm test:browser:auth`
passes design-system/CSP/font checks, onboarding, Settings, 20 refresh-fenced reloads and
all three auth/recovery/logout journeys. New browser assertions prove zero document
navigation, stable header/navigation/sidebar/content-pane DOM nodes, content scroll reset,
320px/desktop independent scrolling without document overflow, and accepted/cancelled
Back/Forward/link navigation with correct draft handling. Initial browser failures exposed
an access-check/permission-transition overlap and asynchronous confirmation test races;
verified destination gating, fresh onboarding reads and explicit dialog waits resolve them.
Final whitespace/Biome checks pass.

Local runtime: rebuilt only the development web image/service for the routing dependency;
all existing services remain running and health-checked services are healthy. Compose
Watch is active; host/container App and router hashes match. The live gallery's independent
scroll pane is verified in the shared browser. The preview profile has no authenticated
local account session; authenticated Settings verification uses the real disposable HTTPS
fixture, preserving local accounts/data. No production Nginx image, Dokploy or customer
rollout verification was performed. No commit or push. No remaining blocker in this scope.
Logs: `/tmp/turnstile-web-nav-{check,build,test,integration,browser,local,watch}.log`.
Handoff: use the existing `http://localhost:23600/settings/organization`; refresh a previously
open tab once if it still has the old application bundle. Subsequent internal navigation
keeps the shell mounted.


ONB-REVIEW-FIXES staged-onboarding review follow-ups are completed (owner: DeepSeek V4.1
Flash, 2026-11-02). Scope: GPT-6.1 Sol (high) advised the fix/validation plan; addressed all
seven low-severity findings without changing contracts, routes, permissions, schema or
limits. Onboarding Save and exit now submits only non-empty values, so clearing a saved
required field preserves the saved data and pauses, while Continue still rejects empty
required fields; Settings re-saves compare the returned revision and report "No changes to
save."; the duplicate Structure "Set up later" link is removed in favour of the explicit
Continue link; configuration request ids fall back once to a server-generated UUID for any
adapter without the bootstrap generator; the snapshot depth guard uses
`CONFIGURATION_LIMITS.depth`; and the last-manager/inspection SQL uses
`CONFIGURATION_MANAGE_PERMISSION` parameters instead of duplicated literals. NativeSelect's
deliberate wrapper-level `className` is documented. Added focused actor-id unit tests, a
controller-independent route-classification/body-limit regression, and onboarding
cleared-field plus Settings no-op browser assertions; the expanded browser journey clears
only the disposable fixture rate-limit window before unit creation, keeping production
limits enabled. Files: the organization service/repository/operator, `set-user-access`,
`configuration-http` and its new spec, the configuration HTTP Fastify and PostgreSQL specs,
`ConfigurationEditors.tsx`, the onboarding/Settings/auth browser fixtures,
`verify-local-onboarding-release.mjs`, and the architecture/specification/design-system
docs. Checks actually run: `pnpm check` (Biome, boundaries, time-zone/OpenAPI drift,
typechecks, Ruff/mypy, deployment, Better Auth CLI), `pnpm build` and `pnpm test`
(26 product API units including 4 new) pass; `pnpm test:integration` passes all 15 Fastify
and 71 PostgreSQL cases; the full `pnpm test:browser:auth` passes under the existing
`~/.cache/ms-playwright` browsers (onboarding, Settings, 20 reloads, all three auth
journeys); the focused configuration-http e2e also passes standalone. No contract/OpenAPI
regeneration was required. Changes remain local/staged; no commit, push, deployment or
customer-target verification occurred.

ONB-I08 upgrade/recovery implementation and the selected existing local release are
completed (owner: Codex, 2026-11-02). Production/customer target acceptance remains
outside this authorized local target. The owner selected the existing local installation
and approved organization “Turnstile local development” / UTC. Those values are now
saved through the supported onboarding UI and setup is activated.

Implemented a private pre-onboarding installation preflight, protected local backup,
isolated restore/upgrade preservation rehearsal and credentialed local release runner.
The [release runbook](docs/runbooks/onboarding-release.md) supplies exact local and
one-off production-image migration, initialization, grant, inspection, retention,
handover and recovery commands; authentication/Dokploy docs link to it. Migrator
credentials stay out of persistent containers and the browser. No new role, schema,
permission, ingress service or reserved host port was introduced by I08.

Captured a coherent full database/configuration backup with all three application
writers paused. The disposable restore/upgrade rehearsal passes: original accounts,
sessions, clients, enrollment and data survive owning migrations; initialization/grant
repeats preserve revision/completion and runtime isolation holds. Fixed a clone startup
race by probing TCP instead of the temporary initialization socket. Local guards reject
production profiles/origins, remote hosts and mixed installation database names;
focused synthetic negative checks pass. Permission-denial probes use a false predicate.
The original installation then passed preflight, migrations and empty initialization;
all original table digests matched before browser admission. The coordinated Compose
rebuild leaves the authority and matching product API/web healthy at the reserved ports.
Actual local runtime authority-read/grant-write/no-tenant denials pass.

The first password was rejected and a private retry expired; neither changed grants or
profile data. After the owner's renewed private prompt, the valid password established
the existing account's real login. The first credentialed attempt proved ordinary-user
waiting and backend 409 before adding manage through the supported private writer,
preserving the account's existing baseline/capability permissions. It then saved the
partial name, restarted the API, resumed persisted data, explicitly saved UTC, skipped
optional structure, activated setup and verified canonical Settings, machine connectivity
and local HttpOnly/host-only/SameSite=Lax cookies. That attempt stopped during the logout
handover phase. A fresh supported login/readback run then passed connection/Settings,
logout and same-account relogin with unchanged completion. Added more precise runner
stage diagnostics; no production application behavior changed. The private password file
was deleted after verification. Final operator readback confirms one local manager,
exact intended permissions and durable completion even after repeat initialization.

Workspace check/build/test, 18 Fastify and 71 PostgreSQL cases, isolated production
API/web image packaging/runtime, compiled startup smoke and production Nginx/HTTPS
browser suites pass. Browser coverage includes onboarding, Settings, 20 refresh-fenced
reloads and all three authentication/recovery journeys. The initial formatting failure
was repaired. The final resumed-verification rerun of `pnpm check`, `pnpm build`,
`pnpm test` and `pnpm test:integration` passes (18 Fastify and 71 PostgreSQL cases).
Final web and both authority/product auth-readiness probes pass.

I08 handoff: retained backup, manifest, protected manager input, private operator outputs,
candidate image IDs and release/verification records are outside the checkout at
`~/.local/state/thaarei/turnstile-360/onboarding-releases/20261102T032532277Z`.
`release-state.json` distinguishes the first full setup attempt from the successful
completed-state logout/relogin run; the latter deliberately does not repeat activation.
No re-provisioning, account/password reset, database restoration or readiness bypass
occurred. All changes remain uncommitted and the pre-existing staged index is preserved.
Compose Watch services remain healthy. The selected target intentionally uses local HTTP;
production DNS/TLS, customer administrator handover and external mail delivery have not
been verified. No production/customer rollout was performed. Detailed development logs
are `/tmp/turnstile-onb-i08-*.log`; the protected backup is the retained recovery point.

ONB-I07 complete-chain verification is completed (owner: Codex, 2026-11-01).
Scope: map the accepted boundary evidence to existing provisioning, PostgreSQL,
Fastify and real HTTPS browser harnesses; add focused missing regressions; verify the
final local candidate with required suites, production images/runtime and Compose Watch
at the reserved ports. Preserve existing installation data/credentials and staged work.
No customer rollout, commit or ONB-I08 release action is included. Existing coverage maps
fresh provisioning/isolation, audit rollback, idempotent creates, concurrent activation,
last-manager contention, waiting/resume, auth refresh/logout and canonical Settings to
the existing harnesses. Added a genuine queued activation/revocation lock barrier,
contending unit renames with stale delete/required-value checks, explicit verified
authority-administrator denial without local manage permission, and DMS-outage completion
metadata readback. The outage scenario now establishes activation through supported HTTP
instead of depending on test order. Added a separate fresh structured-onboarding browser
mode and isolated API/web image packaging/runtime check; both reuse existing foundations.
Added browser assertions distinguishing configuration versus auth outages while retaining
drafts, and a saved profile that does not claim an unsent time zone was persisted.
No runtime, schema, contract shape, dependency or permission changes. Check/build/test,
18 Fastify and 71 PostgreSQL cases pass; only the initial build-concurrent DMS subprocess
timed out, and the separate fresh integration rerun passes without changing its timeout.
Both frozen production images build and pass the isolated runtime/packaging checks.
The structured Nginx browser mode passes. Compose Watch sync/restart, reserved-port
liveness/auth readiness, SPA/proxy/anonymous boundaries and unchanged private-data
fingerprints pass. Stopped only the watch session, restored same-content probe timestamps
and retained healthy local services/volumes. The persistent local database intentionally
remains pre-onboarding; no migration or initialization was applied. The optional container
HTTPS fixture probe reports unavailable host-network routing; real target DNS/TLS remains
I08 verification. The full production-Nginx root-only/Settings/auth browser journey now
passes, including the added auth/config outage distinction and truthful saved-zone
assertions. Compiled API smoke and generated contract consistency pass. Final documentation
formatting is corrected; no production behavior needed a fix for these added regressions.

Executed I07 boundary evidence (2026-11-01):

| Boundary                           | Executed evidence                                                                                                                                                                                                                         |
| ---------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fresh provisioning                 | Existing disposable harness repeats owned migrations/bootstrap, initializes explicitly and provisions verified accounts/local grants; installation/tenant mismatch and privilege rejection tests pass.                                    |
| Database integrity                 | Product PostgreSQL cases pass repeat initialization/root/restart, supported ancestry/bounds, absent/wrong tenant context, runtime privilege and transactional audit rollback checks.                                                      |
| Authorization                      | Real BFF denies a verified authority administrator with ordinary local access but no manage permission; existing Fastify/browser cases pass readiness, permission and CSRF ordering, ordinary waiting and direct API blocking.            |
| Concurrency and uncertain outcomes | Real lock waiters prove queued activation rechecks earlier revocation; contending rename/stale delete checks pass. Existing same-key create replay, two-manager activation, last-manager contention and lost-response browser cases pass. |
| Browser journeys                   | Separate fresh installations pass root-only and retained site/nested-department activation. Save/exit/resume, logout/restart, ordinary waiting → available, deep links and Back pass through real HTTPS APIs.                             |
| Failure recovery                   | Distinct configuration/auth outages retain drafts; unsent UTC is not shown as saved. DMS outage preserves exact completion, canonical configuration and session; revocation removes unauthorized editors.                                 |
| Existing auth                      | Real refresh overlap/generation, reset/recovery, denial and complete/partial logout pass in database and all three browser journeys, including 20 no-flash reloads.                                                                       |
| Settings                           | Canonical name/zone/units, identity-preserving rename, rejected required-field clearing, conflict/readback, root/non-leaf protection and unchanged activation pass.                                                                       |

Commands/results on this candidate:

- `pnpm check`: passes Biome, boundaries, generated contracts/time zones, typechecks,
  Ruff/mypy, deployment checks and offline Better Auth CLI generation. Host build inputs
  remain unchanged; `pnpm build` uses seven valid task caches. `pnpm test` passes the
  fresh root routing checks and seven project tasks (six cached, product unit task fresh).
- `pnpm test:integration`: separate final run executes all 18 Fastify cases fresh
  (4 DMS + 14 product), then all 71 PostgreSQL cases fresh (30 DMS + 41 product), with
  repeat owned provisioning/migration/bootstrap and runtime-role isolation checks.
- `pnpm test:smoke`: both compiled API entry points pass real identity/liveness HTTP checks.
- `docker build -f apps/turnstile-api/Dockerfile -t thaarei-onb-i07-api .` and
  `docker build -f apps/turnstile-web/Dockerfile -t thaarei-onb-i07-web .`: pass frozen
  dependency builds. Runtime image IDs are `sha256:1f93a5000e2c58e396d681d39ab4ac86135eddea180b86466c4450fc9abac418`
  and `sha256:eef4ecfeae33f088c9811f5235914f5fb2eeeba88846d43451df8f0bc5e63589`.
- `pnpm test:images:onboarding thaarei-onb-i07-api thaarei-onb-i07-web`: passes
  non-root/read-only runtime, packaged migration/private-command, liveness, fail-closed
  unconfigured API, ten SPA entries and actual CSP/referrer headers in isolated containers.
- `AUTH_BROWSER_WEB_IMAGE=thaarei-onb-i07-web AUTH_BROWSER_API_IMAGE=thaarei-onb-i07-api pnpm test:browser:auth`
  and the same environment with `pnpm test:browser:onboarding:structured`: both pass
  against production Nginx assets/CSP and real production-profile HTTPS/STARTTLS APIs.
  Both keep backend TLS verification and runtime rate-limit enforcement enabled. The optional
  container-to-fixture discovery probe reports unavailable host-network routing in both
  runs; actual target container DNS/TLS remains unverified and belongs in I08.
- `docker compose watch --no-up`: verified existing services at fixed 23600–23608,
  real same-content API sync/restart and web sync, matching source hashes, API liveness/
  auth readiness, SPA/proxy responses and anonymous denial. Private read-only fingerprints
  match before/after for installation, grants and encrypted sessions. No migration,
  initialization, access grant, credential change or volume removal occurred. Watch-only
  session stopped and probe timestamps restored; all existing services remain healthy.

Final Biome and staged/unstaged whitespace checks pass; all 201 relative file targets
in the seven changed documentation files resolve. Detailed local command logs use
`/tmp/turnstile-onb-i07-*.log`; reports contain no
credentials or raw signed/recovery URLs. This is local release-candidate evidence, not
customer/Dokploy rollout evidence. No staging, commit, push or deployment occurred.
ONB-I08 remains the next separately authorized package; it must apply the supported
upgrade/initialization/grant sequence and verify actual target DNS/TLS and customer access.

ONB-I06 ongoing Settings and basic structure is completed (owner: Codex, 2026-11-01).
Scope: completed-workspace Home/Settings navigation, setup overview, canonical organization
and regional editors, shared unit creation and explicit non-root rename/unused-leaf removal.
Reuse I05 transport/editors, preserve completion, authorization and session fencing; no
new database or People/Approval/Risk configuration. Implemented manager-only Home/Settings
entry, canonical overview and shared name/zone/create editors under features/configuration,
plus selected-unit rename/removal confirmation and current-readback recovery for stale or
uncertain writes. Known non-leaves/root have no removal path; backend checks remain
authoritative. No schema, backend, contract shape or dependencies changed. Typecheck,
workspace check and build pass. Added a disposable real Settings browser journey covering
two administrators, permissions, canonical updates, conflict/duplicate recovery, root and
completion stability, cancellation and lost delete response. Its initial region fixture
requested an alias outside the accepted pinned allowlist; corrected the fixture to an
existing supported zone, without changing the contract. The full expanded browser suite
now passes Settings, onboarding and all three auth journeys.
The final revocation assertion was corrected to respect existing identity → CSRF → route
permission precedence: changed grants rotate CSRF, so an old-token write may receive
CSRF_REJECTED before permission denial; Refresh session then removes the unauthorized
editor. No auth behavior was changed to accommodate the fixture.
Verification (2026-11-01): pnpm check/build/test/test:integration and compiled test:smoke
pass. Build rebuilt web; seven valid unit task caches were reused. Integration reran all
18 Fastify and 70 PostgreSQL cases fresh. The real production-profile HTTPS/STARTTLS
browser suite verifies canonical field-only PATCHes, manager-only routes/API denial,
shared creation, two-manager rename conflict and duplicate recovery, cancel, stable root/
completion metadata, non-leaf protection, confirmed removal and lost-delete readback,
live revocation, 20 no-flash reloads and existing recovery/reset/logout regressions.
Inspected Settings screenshots at desktop and 320px with reduced motion/no overflow.
The frozen-dependency production web image builds and passes isolated non-root Nginx,
liveness, all onboarding/Settings SPA deep links and CSP without host bindings/external
network. Local Markdown file targets (251), the new architecture anchor, Biome and
staged/unstaged whitespace checks pass. Architecture, plan, runbooks, README and generated
OpenAPI status describe I06; shared removal confirmation has a fixture-only gallery example.
DeepSeek V4.1 Flash review completed through the user's subscribed OpenCode Go model.
It reported no confirmed High/Medium defects and three Low findings: removed parents
remained selected, an earlier create readback marker survived a later uncertain attempt,
and a runbook paragraph still called Settings future work. Implemented fixes use one
current effective parent for display/new submissions, reset reconciliation inspection for
each create/new entry, and correct the release paragraph. Added browser regressions for
parent deletion/readback/fallback submission and two sequential uncertain creates.
Also improved neutral readback notices, cleared the session warning after a successful
save, added type/ancestry to unit action names, clear corrected field errors without
stealing focus, and fall back to UTC formatting if browser time-zone formatting fails.
The failure screen intentionally keeps separate configuration Retry and session-check
actions; Check session refreshes identity/status while Try again reloads configuration.
The earlier Free-model attempt stopped at quota with no verdict; the subsequent Go
connection/catalog repair below enabled the completed requested review. No alternate
reviewer was used. Post-fix check/build/test and all 18 Fastify/70 PostgreSQL cases pass;
the final image build/runtime and sequential API smoke check pass. The expanded browser
regressions exposed the fixture's shared identity introspection budget: status-only
diagnostics confirmed three authority 429s behind the final configuration GET 503s.
Added a fixture scenario boundary that waits a full real request window and extended
only the full-browser command deadline; production limits/auth remain unchanged. The
final full browser run passes all new regressions, manager revocation/restoration,
onboarding, 20 reloads and all three authentication journeys. Final check/build/test pass
(build and seven unit tasks reuse valid caches); the recorded fresh integration and
final image/runtime/smoke results above remain applicable. Staged/unstaged whitespace
checks pass. Review fixes and the requested I06 implementation are complete; ONB-I07
complete-chain acceptance and ONB-I08 coordinated target release remain separate work.
No commit or live deployment occurred; disposable feature fixtures remain the only
installation state used for verification.

ONB-I06-REVIEW provider connection repair is completed (owner: Codex, 2026-11-01).
Diagnosed the actual connection mismatch: normal OpenCode v2 already had Go connected
and advertised opencode-go/deepseek-v4.1-flash, but T3 runs an isolated OpenCode server
under separate XDG directories with no Go connection. Using supported OpenCode auth
export/import, transferred only the existing Go integration locally to that isolated
server, without printing credentials or importing other accounts. Created a private
rollback snapshot and verified other integration metadata is unchanged. The T3-owned
OpenCode server now advertises the subscribed model. No subscription purchase, global
default-model change, provider replacement or application change was needed. Refreshed
only the OpenCode provider through T3's existing provider-refresh RPC, using a short-lived
provider-scoped local session that was revoked afterward. No active session restart was
needed. Verified the refreshed provider cache is ready with 57 models and orchestration
capabilities now expose opencode-go/deepseek-v4.1-flash (low/high/max), alongside the
separate Free model. A first post-import review request was rejected by the stale T3
catalog before any child started; the catalog refresh resolves that metadata rejection.
The subsequent requested review successfully completed on that subscribed Go model.
No credentials or temporary access tokens were printed or added to the repository.

ONB-I05 onboarding web journey is completed (owner: Codex, 2026-11-01).
Scope: typed configuration transport, current readiness entry/routing, organization,
optional structure/review, save/exit/resume and ordinary-user waiting. Preserve existing
session/logout fencing and design-system/auth boundaries; Settings remains I06.
Implementation, requested DeepSeek V4.1 Flash review, fixes and local verification are
complete. No commit or live rollout was requested. Implemented typed
configuration transport, session/readiness entry, Organization/Structure/Review/paused/
waiting routes, partial save/exit, explicit revision reconciliation, same-key create
retries and confirmed activation. The pinned shadcn CLI added NativeSelect; its normal/
invalid states are in the development gallery. Forms use the shared design system and
contract validation. Async editor/navigation completions are fenced after unmount/logout.
The first complete browser journey passes: ordinary waiting, partial save/resume across
API restart, two administrators/shared progress, real revision conflict, uncertain create
replay, retained optional structure, root-only activation/readback, logout fencing and
320px/reduced-motion/deep-link/Back checks. Existing auth journeys also pass. Initial
lost-response fixture issues (route cancellation and API-fetch DNS) were fixed without
changing runtime networking. Ephemeral fixtures from failed/interrupted runs were cleaned.
Workspace check/build/test/integration pass, including 18 Fastify and 70 PostgreSQL
cases. The final expanded browser run also verifies retained drafts across readiness
outages and neutral startup until readiness returns. Mobile/desktop screenshots were
inspected. The production web image builds and passes non-root Nginx/liveness, SPA deep
links and CSP without host bindings. Current docs/contract references, Biome and Git
whitespace checks pass. Repaired an earlier documentation edit that had overwritten
the API reserved-port table row; actual Compose bindings remain unchanged.
DeepSeek V4.1 Flash completed its read-only I05 review with no blocking/high/medium
findings and three confirmed low-severity issues. Implemented fixes: untouched empty
Save/exit pauses without PATCH, duplicate sibling names show an editable associated error
without revision reconciliation, and persisted pageshow resets transient connection busy.
Also improved first-invalid focus/error ID references, user-scoped in-flight status sharing,
load-specific messaging, retained new-entry text, optional-step links and scroll-list keyboard
access; leaving a step through a link confirms discarding unsaved entries. Added focused
browser regressions for these paths.

Verification (2026-11-01): post-review pnpm check/build/test/test:integration and compiled
test:smoke pass on the pinned toolchain. The workspace build rebuilt web with six cached
tasks; unit checks reused seven valid Turbo caches. Integration reran all 18 Fastify and
70 PostgreSQL cases (30 DMS, 40 product) fresh. The expanded production-profile
HTTPS/STARTTLS browser suite passes onboarding plus all three auth journeys, including
20 reloads without a sign-in flash, CSRF, recovery/reset, logout and shared administrator
regressions. New browser assertions verify no PATCH on untouched pause, invalid-zone focus,
cancelled discard retaining input, real duplicate-name 409 remaining editable, and a
synthetic persisted-pageshow event during an in-flight capabilities request restoring
connection/sign-out controls. The latter deterministically covers the reported ordering;
it does not claim to reproduce a browser's BFCache fetch-abort timing. Updated desktop/
320px screenshots were inspected. Rebuilt the final production web image with frozen
dependencies and verified isolated non-root Nginx, liveness, all setup SPA deep links and
CSP without host bindings/external network. Biome and staged/unstaged whitespace checks
pass; contract/documentation consistency checks remain current.

Handoff: no confirmed review finding or I05 blocker remains. ONB-I06 ongoing Settings is
next when authorized; I07 acceptance and I08 coordinated target rollout remain pending.
This feature's state/grant/account fixtures were disposable. Existing installation data,
credentials, ingress/ports and user-staged I01–I04 work remain intact. No commit, push,
PR, live/customer initialization or deployment occurred. Target Linux/Dokploy DNS/TLS,
real installation rollout and backup/restore execution remain separate release work.

ONB-I04 access provisioning and backend gate is completed (owner: Codex, 2026-11-01).
Implementation, requested review, fixes and final verification are complete. Shared strict accessAssignmentSchema requires operator
attribution and the manage/access dependency. Private grants use the dedicated owning
operator verifier and exact existing initialized installation, never implicit bootstrap.
Grant changes serialize with activation, protect the final enabled local manager,
retain replacement-array semantics, and audit effective changes atomically without
changing configuration revision. Generated additive migration 0006 adds the bounded
addressed-user audit subject and enabled field. Runtime grants remain read-only.
Nest CLI generated ApplicationAccessGuard; AppModule registers it once to compose the
existing identity/local access, mutation CSRF and route permissions before current
backend readiness. Explicit setup/status/organization/session exemptions skip only
readiness; unannotated handlers remain denied. Capabilities calls cannot reach machine
issuance/DMS while incomplete. Auth/session/logout and authority-role separation remain.

DeepSeek V4.1 Flash (OpenCode) reviewed all uncommitted staged/unstaged/untracked I01–I04
changes, including new files/migrations/contracts/docs. It found no confirmed correctness,
security, isolation or contract defects, and identified one actionable contention issue:
readiness acquired the singleton configuration write lock. Fixed with one committed,
non-locking completion/local-grant SELECT under tenant context; mutations/private writers
retain shared locking and authorization rechecks. Role/installation/forced-RLS checks
remain current, without positive safety caching. Added a real PostgreSQL regression for
uncommitted activation, concurrent status reads, subsequent commit and live revocation.
Also addressed optional follow-ups: safe generic 401/403 envelopes, shared retention/batch
SQL constants, DB receipt-window/contract consistency, and grant-derived manager checklist.
The reviewer reran 7 DB-free Fastify cases; post-fix verification below was run by Codex.
I05/I08's web setup/waiting/error experience is deliberately deferred, as reviewed.

Verification (2026-11-01): post-review pnpm check/build/test/test:integration and
compiled test:smoke pass on the pinned toolchain. Build rebuilt product API/web after
contract generation with five other caches; final unit run executed 22 product API,
six contract and two transport cases fresh, with DMS/Python caches. Integration ran
18 fresh Fastify and 70 PostgreSQL scenarios, including last-manager contention,
activation locking, audit rollback, private command exits, strict input, committed
non-locking status and existing BFF/encrypted refresh/logout/machine regressions.
The initial integration fixture granted an intentionally unprovisioned administrator
too early; the grant now occurs only at its later setup scenario, preserving that
regression. Generated SQL/snapshots were formatted before final static checks passed.
All three post-review production-profile HTTPS/STARTTLS browser journeys pass, including
real pre-activation denial/API activation/capability success, recovery/reset, CSRF,
permissions, partial logout, CSP/fonts and 20 reloads without sign-in flash. Schema
check/no-change generation, dependency boundaries, Biome, Git whitespace, 253 local links
across 12 changed Markdown files and 28 auth OpenAPI references pass. Architecture,
OpenAPI status, plan, README, contract guide and runbooks describe the delivered boundary.
The final post-review production API image builds with frozen dependencies and passes
isolated non-root startup/liveness plus fail-closed auth readiness/configuration/business/
session checks without host bindings. Existing local Compose health checks remain healthy.
Handoff: ONB-I05 is next when authorized: typed browser configuration transport and the
manager onboarding/ordinary waiting journey. Settings, complete-chain acceptance and
coordinated target rollout remain I06–08. No actionable review finding remains. No new
production web image or target/customer rollout was performed; all feature grants/state/migrations
used disposable fixtures. Existing installation accounts/grants/credentials/data, root
LICENSE/notices, ingress and ports are preserved. User-staged baseline edits remain
intact; no commit, push, PR, private customer initialization or live rollout was performed.

ONB-I03 canonical configuration and domain operations is completed (owner: Codex,
2026-11-01). Scope: product-owned organization/setup schema and reviewed migrations,
canonical profile/root/optional units, revisioned/audited domain operations and owning
HTTP adapters, bounded create retries and private initialize/inspect/prune commands.
Preserve shared auth/persistence boundaries; broad grant provisioning/last-manager policy,
the business readiness gate and onboarding/Settings UI remain I04 onward.
Milestone: generated Organization/Onboarding scaffolds and additive product migrations;
implemented canonical revision/audit operations, bounded create receipts, guarded HTTP
and private initialize/inspect/prune. The legacy grant writer now coordinates the same
context lock without issuing configuration permission. Eleven new real-PostgreSQL cases
and product Fastify checks pass, including contention, root-only activation, audit rollback,
RLS/privilege limits, hierarchy/receipt bounds, retention and private command execution.
Tests exposed synchronous validation rejection handling and Nest/Fastify string parser
exceptions; async domain entry points and finite parser mapping now preserve safe errors.
SQL is isolated in the repository/private operator path; dependency boundaries pass.
Full workspace check/build/test and integration now pass: 16 Fastify and 65 PostgreSQL
cases, including an expired-key reuse regression with more expired receipts than one
cleanup batch. Cleanup prioritizes that key while preserving the 1,000-row bound.
Drizzle schema check/no-change generation and compiled API smoke pass. One preceding
run hit an unchanged DMS enrollment assertion (401 versus expected 403); the full rerun
passed without changing DMS code. Documentation link and whitespace checks pass.
Verification (2026-11-01): pnpm check/build/test/test:integration and test:smoke pass on
the pinned toolchain. The final workspace build used seven caches after the database
harness rebuilt the changed API; the production API image also rebuilt with frozen
dependencies. Final unit checks ran 22 product API and two transport cases fresh, with
22 DMS, six contract and Python checks cached. Integration ran all 16 Fastify and 65
PostgreSQL cases fresh. All three real production-profile HTTPS/STARTTLS auth browser
journeys pass, including recovery/reset, CSRF/permissions/logout, CSP/fonts and 20 reloads
without sign-in flash. The new HTTP/database fixtures exercise the existing global guard
with identity stubbed only in feature-specific HTTP cases; real auth remains covered by
the unchanged BFF/browser suites. Database tests include compiled private commands,
contention, root-only completion, audit rollback, hierarchy/receipt bounds and forced RLS.
The production API image passes isolated non-root startup/liveness and fail-closed
unconfigured readiness/configuration access with no host bindings. The existing local
Compose services remain running, with configured health checks healthy; no new production
web image or target Dokploy/customer deployment verification was performed. Schema
check/no-change generation, dependency boundaries, Biome, Git whitespace and 233 relative
links across 12 changed Markdown files pass. Architecture, OpenAPI status, plan, README,
contract guide and operator runbook describe the delivered I03 boundary.
Handoff: ONB-I04 is next when authorized: extend private access provisioning with the
configuration permission, initialized-context/operator input, transactional access audit
and last-manager protection, then add backend readiness gating/exemptions. No supported
configuration-management grant is issued by I03; test-only grants use disposable fixtures.
UI and coordinated target migration/initialization/release remain later packages. No
baseline blocker remains. Existing installation accounts/grants/credentials/data, root
LICENSE/notices, ingress and reserved ports are preserved. User-staged baseline changes
remain intact; all new work is local/uncommitted, with no commit/push/PR or live rollout.

ONB-I02 contracts and persistence composition is completed (owner: Codex, 2026-11-01).
Added explicit Zod 4.6.7 to turnstile-contracts with strict configuration request/response
schemas/DTOs, normalized Unicode names/comparison keys, bounded revisions/units/depth,
minimal status and detailed setup, safe errors/statuses and a generated 419-zone allowlist
with pinned Node/ICU/tz/Unicode provenance. Generated contract-only OpenAPI 3.1 and wired
list/schema/document/reference/example/auth-catalog drift checks into pnpm check.
The new permission is in shared contracts; current auth:set-access rejects it until I04
provides initialization/last-manager protection. Existing auth fixture grants now name
only their intended access/capability permissions rather than every catalog entry.
Nest CLI generated ProductPersistenceModule/Service with the installed module/service
schematics (`infrastructure/database/product-persistence --flat --no-spec`). That module
owns one configured pool, runtime-role/installation checks and shutdown. Auth consumes it
while retaining encrypted sessions, session/access RLS checks and its availability policy;
AppModule registers the existing default-deny guard once. Typed ConfigurationException
preserves safe domain status/envelopes through the existing filter. Architecture, package
guide, plan, standards, API guidance, README and auth runbook are aligned.
Verification (2026-11-01): pnpm check/build/test/test:integration and test:smoke pass on
the pinned toolchain. Final build rebuilt contracts/product API/web; four other builds
used caches. Final test ran 6 contract, 22 product API unit and 2 transport cases fresh;
22 DMS unit cases and Python smoke used caches. Integration ran 14 fresh Fastify and
54 fresh PostgreSQL cases, including shared-pool identity/limit/single shutdown, encrypted
restart persistence, owned migrations/bootstrap, forced RLS/runtime privilege isolation,
refresh/logout and real HTTP DMS integration. The initial integration's existing DMS
private-command child timed out at six seconds while an image build was running; a later
run exposed the expanded-catalog fixture grants, which were corrected before the final
full pass. Initial Biome formatting differences and the time-zone test's unlisted alias
were corrected; validation still uses exactly the adopted generated allowlist.
All three real production-profile HTTPS/STARTTLS auth browser journeys pass, including
20 reloads without sign-in flash, CSP/fonts, recovery/reset, permission/CSRF and partial
logout. Final production API image builds with frozen dependencies; isolated non-root
startup/liveness and fail-closed unconfigured auth readiness pass without host bindings.
Scoped/full Biome, Git whitespace and 242 relative document links/anchors pass. No new
production web image or target Dokploy/customer deployment check was performed; browser
evidence used disposable database/Mailpit/HTTPS fixtures, not customer provisioning.
Handoff: ONB-I03 is next when authorized: canonical organization/setup persistence,
reviewed migrations, audited/revisioned domain operations and private initialization/
inspection/retention commands. I04 then implements grant protection, feature HTTP access
and readiness enforcement. I02 adds no domain tables/migrations, organization/setup HTTP
handlers, gate bypass or private configuration grant. No baseline blocker remains.
Existing installation accounts/grants/credentials/data, root LICENSE/notices, ingress and
ports are preserved. User-staged baseline changes are preserved; this work remains local
and uncommitted, with no commit/push/PR or target deployment operation.

ONB-I01 implementation baseline is completed (owner: Codex, 2026-11-01).
Created the accepted [onboarding specification](docs/turnstile/onboarding/onboarding_specification.md) with
unchanged ONB-R01–12 IDs and acceptance journeys. Adopted root-only activation, private
verified administrator provisioning, narrow configuration authority and fixed Site/Department
labels. architecture.md now owns exact normalization/time-zone/body/unit/depth limits,
HTTP/permission/error projections, partial saves, revisions, bounded unit-create retries,
completion/grant locking, audit retention and private initialization/grant/maintenance
contracts. Aligned the implementation plan, proposal, workspace plan, README and both
operator/deployment runbooks; future commands/limits are explicitly not installed yet.
Verification: pnpm check/build/test/test:integration pass on Node 24.21.0, pnpm 12.16.1
and pinned uv/Python. All seven build tasks and API unit/type tasks used existing caches;
2 transport cases ran fresh, with 43 API unit cases replayed. Integration ran 13 fresh
Fastify and 54 fresh PostgreSQL cases plus repeatable owned migration/bootstrap and
runtime privilege isolation. Initial check found new Markdown table formatting differences;
scoped Biome formatting corrected them and the full check passed afterward. Relative
document links/anchors and all twelve requirement/plan mappings resolve; final scoped
formatting and Git whitespace checks pass. Existing suites establish repository health,
not implemented onboarding. No new browser, application-image or deployed-runtime check
was performed for this documentation-only package; target release evidence remains I08.
Handoff: ONB-I02 is next when authorized: executable shared schemas/time-zone allowlist,
generated feature OpenAPI/consistency checks and shared product persistence composition,
preserving auth/session behavior. Feature schema/migrations and private operations start
in I03; grant/readiness enforcement in I04. No baseline blocker remains. Custom terminology,
broad IAM, invitations and Document Approval remain separate follow-ons. No application
code, dependency, schema/migration, installation account/grant/secret/data, deployment or
commit/push/PR operation changed. Work remains local/uncommitted.

ONB-PLAN-001 planning is completed (owner: Codex, 2026-11-01): audited current
auth/provider composition, private access grants, runtime privileges, shared contracts,
web route/request handling and test harness. Created the
[onboarding implementation plan](docs/turnstile/onboarding/onboarding_implementation_plan.md) with ONB-I01–08:
baseline/specification, contracts/persistence composition, canonical audited configuration,
private provisioning/backend gate, web onboarding, ongoing Settings, complete-chain
verification and coordinated existing-installation release. Mapped all ONB-R01–12;
preserved optional units, shared configuration, separate feature readiness and private
account management. The proposal and workspace plan now link to the ordered packages.
Verification: pnpm check/build/test/test:integration pass on the pinned toolchain;
build/type/API unit tasks used existing caches, 2 transport tests ran fresh, and
13 Fastify plus 54 PostgreSQL integrations ran fresh with owned migration/bootstrap
and runtime-role isolation. All 33 relative links/anchors in the plan, proposal and
workspace plan resolve; package/requirement coverage, final scoped Biome and Git
whitespace checks pass. Existing suites establish workspace health, not implementation
of proposed onboarding. No new browser, application-image or deployed-runtime check was
performed for this documentation-only task.
Handoff: use ONB-I01 as the implementation starting point when authorized, then follow
the dependency order. Exact limits/contracts become accepted architecture/specification
in that package; broad IAM, invitations and Document Approval remain separate follow-ons.
No planning blocker remains. No application code, schema/migration, account/secret,
accepted architecture, customer data, deployment or commit/push/PR operation changed.

ONB-001 discovery/design is completed (owner: Codex, 2026-11-01): all four Version 1
reference areas and eight directly related screens were accessible after authorized login.
Inspected tabs, create/edit forms, conditional selectors, downloaded CSV template,
106-permission catalog and all 21 RACI matrix views. The field-level
[inventory](docs/turnstile/onboarding/onboarding_v1_discovery.md) records functionality, overlaps and evidence
limits. The [proposal](docs/turnstile/onboarding/onboarding_design_proposal.md) covers configuration
classification, minimal organization/time-zone/root setup, optional units, provisioning
versus bootstrap/onboarding, server readiness and permission gates, resume/waiting-user
behavior, settings navigation, dependencies, edge cases and phased delivery. Proposed
ONB-R01–12 are product-review requirements, not accepted implementation. A fictional
[interactive illustration](docs/presentations/onboarding-concept.html) presents the
screen grouping without application access or persistence. Existing architecture remains
authoritative; no new technical decision was silently adopted.
Verification: final pnpm check passed after document formatting; pnpm build and pnpm test
passed with existing workspace caches (2 fresh transport cases and 43 cached API unit
cases). pnpm test:integration passed with 13 fresh Fastify and 54 fresh PostgreSQL cases,
repeatable owned migrations/bootstrap and runtime-role isolation. All 16 local document
links/anchors resolve; HTML IDs/script syntax and absence of network/persistence calls
were checked. Desktop/mobile HTML previews of entry, structure, review and settings
states show readable layouts and no console errors. No new onboarding runtime behavior
is implemented or tested; no new application image/deployed/customer-runtime verification
was performed. V1 writes, SSO authentication/provider delivery, post-upload import and
fresh-database behavior remain unverified; its SSO page reports missing server credentials.
No V1 configuration was saved, user provisioned, invitation/test message sent or destructive
action invoked. The owned browser tab was closed; logout was not confirmed after its
UI action timed out. No credentials or demo contact records were written to repository docs.
Handoff: review the proposed minimal activation boundary, setup administrator policy and
settings grouping; agree separate Document Approval rules before implementation. No
discovery blocker remains. No application code, schema/migration, installation credentials,
accepted architecture, commit/push/PR, deployment or source/data migration changed in this task.

Entries below preserve dated handoffs and historical commands. Follow the latest
completed development entry and [current startup instructions](architecture.md#local-development)
for operational commands; older entries are verification history.

DS-001 is completed (owner: Codex, 2026-11-01): initialized and applied owner-selected
shadcn preset `biekTCUvD` through CLI 4.23.0 in the existing Vite web app. Installed
Tailwind/Vite integration and generated Base UI Maia primitives with exact dependencies.
The existing src/index.css now owns semantic light/dark colors, local body/heading fonts
and radius values; authentication/recovery/session states and the workspace consume shared
controls, cards, notices and skeletons. Shared ButtonLink composes Button variants with a
native anchor, preserving navigation semantics verified by the recovery browser regression.
The development-only /design-system gallery renders actual primitives and states without
account/API access. docs/turnstile/design-system.md provides one designer/developer handoff and
maintenance guide; web AGENTS.md, READMEs, workspace/tooling standards and architecture
references are aligned. Biome supports web Tailwind directives; dependency rules resolve
the web alias through root tsconfig.boundaries.json without weakening application boundaries.
UI/font/icon notices ship with built assets; the proprietary root LICENSE is preserved.
Final pnpm check/build/test/test:integration and test:browser:auth pass: 2 fresh transport
tests, 43 recorded API unit cases (cached), 13 fresh Fastify and 54 fresh PostgreSQL cases
plus owned migration/runtime-role isolation. All three production-profile HTTPS/STARTTLS
browser journeys pass, including bundled fonts under CSP, keyboard access, 320px/desktop
recovery forms, reduced motion, 20 authenticated reloads without sign-in flash, current
session/DMS permissions, verification/recovery/reset and logout/retry behavior. Final
Biome/whitespace checks pass. Development gallery light/dark switching, password reveal,
320/768/1280px layouts, zero API calls/runtime errors and fixture-only visual inspection
pass. Production assets exclude gallery code and include both font families and exact
notices. The final production web image rebuilds; isolated non-root Nginx configuration,
liveness and notice delivery pass. The development web image was rebuilt to include new
source files; all seven local services run and configured health checks are healthy.
Handoff: use http://localhost:23600 and http://localhost:23600/design-system with the
existing Compose Watch workflow. Designers/developers maintain tokens/primitives and
review gallery states together using the shared guide. Product pages remain light by
default; dark preview is available in the gallery. No Figma synchronization is configured.
No blockers remain in this scope. Existing accounts, secrets, auth authority, data,
reserved ports and unrelated local changes are preserved. Changes remain local/uncommitted;
no business/mobile feature, remote CI, push/PR or customer/production rollout was performed.

DEV-009 is completed (owner: Codex, 2026-11-01): fixed authenticated refresh loading
and a reproduced continuous-traffic authentication rate-limit defect. Startup now renders
a static neutral workspace shell instead of AuthLayout until the current backend session
is verified. Concurrent session reads share only their pending HTTP request; completion
clears it, without persisting identity or caching authorization. /auth-unavailable now
revalidates the session and restores a verified workspace to the canonical root URL.
The pinned Better Auth 1.7.14 database limiter advanced lastRequest on every admitted
request, letting continuous health/introspection traffic exhaust a budget across multiple
nominal windows and force an idle cooldown. A new real-PostgreSQL regression failed before
the fix (429 after the configured window) and passes afterward. Added a pnpm-managed patch
that anchors the database window, retaining the configured maximum, atomic increment,
persistent counters, denial and reset paths. No limiter is disabled, dependency version
upgraded, schema/migration added, or account/secret reset. The additional authenticated
introspection regression passes 110 continuous probes at 86/minute across multiple windows;
existing denial/restart/forged-forwarding tests pass. Patches are documented and copied
before development-image locked installation. Patch presence is verified in the running
DMS container and production DMS image; private runtime settings and fixed ports remain.
Final check/build/test/test:integration and test:smoke pass: 2 transport tests, 43 recorded
API unit cases, 13 Fastify plus 54 PostgreSQL integrations and role/DDL isolation. All
three isolated HTTPS browser journeys pass, including delayed bootstrap, pending-read
coalescing, 20 authenticated reloads with one session request per reload and no observed
auth-layout flash, and recovery from the error route to /. Final Biome/whitespace and
root/production Compose configuration checks pass. All five Docker images rebuild;
production API non-root/liveness, DMS patch, Nginx configuration and processing CLI checks
pass. The latest frontend redirect adjustment was rebuilt/rechecked with browser tests.
Architecture, patch guidance and script documentation are aligned. The owner's desktop
runtime cannot be directly automated here; a separate preview confirmed unsigned-user
sign-in access. Credentialed reload verification used isolated browser fixtures, not a
password reset or new login to the owner's account. The verification preview tab is closed.
Handoff: Compose Watch remains running at http://localhost:23600, with all seven services
running and all configured health checks healthy. Refresh the desktop tab to pick up the
new loading/recovery flow. Required authentication checks and rate limits remain enabled.
Changes are local/uncommitted; no push/PR, production deployment or remote CI run in this task.

DEV-008 UI recovery is completed (owner: Codex, 2026-11-01); the cause of the
historical intermittent API 503 remains unconfirmed. The annotated tab is local desktop runtime and
cannot be automated from this environment. A separate server preview receives the
expected 401/IDENTITY_REQUIRED and reaches the credential form. Desktop request 503s
were correlated with the running API; temporary diagnostics located them in OIDC
active-token introspection rather than cookie decryption. Fresh configured-client
introspection of the current persisted live token succeeds. The intermittent protocol
or transport cause remains unconfirmed; no backend fix is claimed. Temporary API
diagnostics are removed, and those backend files have no remaining changes.
Reproduced a frontend race under development StrictMode: a delayed older 503 replaces
a newer 401 and leaves only Try again. Fixed latest-check fencing, one bounded three-second
automatic retry, visible-tab focus recovery and explicit sign-in access on unavailable
screens. Existing logout generation fencing remains. Extended the real-browser journey
with late-failure, sign-in visibility and focus/automatic/manual recovery regressions;
aligned architecture. Controlled preview reproduction now retains the correct sign-in
state, and the live credential form opens normally.
Final pnpm check/build/test/test:integration and test:browser:auth pass: 2 transport tests,
43 recorded API unit cases (cached), 13 fresh Fastify and 52 fresh PostgreSQL integrations,
plus all three HTTPS browser journeys with the new recovery checks. Final Biome and
whitespace checks pass. All seven services run, all configured health checks are healthy,
and Compose Watch remains running at localhost:23600. No port, account, secret, database,
auth-validation or production deployment changes were made in DEV-008. No commit/push/PR.
Owner follow-up (2026-11-01): clicking Try again now shows Sign in in the desktop tab,
confirming that recovery is accessible there. The owner then confirmed they can log in
successfully. This is owner-reported desktop login evidence; it does not establish the
cause of the historical introspection 503. These follow-ups changed only the progress
record; Biome/whitespace checks passed, with runtime suites not repeated for the
documentation-only confirmation.
Handoff: desktop sign-in is working at localhost:23600. If an API 503 recurs, correlate that
fresh request before claiming its underlying cause is fixed. No current desktop failure
was reported in the owner's retry result. The temporary server preview tab opened for
verification is closed; owner desktop tabs remain intact.

DEV-007 verification is completed (owner: Codex, 2026-11-01): ran pnpm dev and
investigated the reported alternating login 302/503 telemetry. Effective Compose and
running container bindings use only loopback host ports 23600–23608; API public origins,
issuer, callback, resource and database URLs match. All configured health checks pass,
only one repository Compose Watch process runs, and twelve fresh login starts returned
302. All 41 inspected product session envelopes were readable with the configured key;
no key mismatch was found. The recorded local account exists, is verified, is not banned
and has a password. The first private password input was rejected with HTTP 401; after
the owner confirmed the email and supplied the current password through a new private
card, the live credential/callback/session flow passed. Five consecutive complete sign-ins
with retained cookies, current session and authenticated DMS capability checks passed.
An authenticated session survived a product API restart; logout completed locally and
at the authority, and subsequent session access correctly returned 401. All three
isolated HTTPS browser journeys passed in the preceding DEV-007 validation run.
The original intermittent 503 was not reproduced after correct credentials were supplied;
its cause remains unconfirmed, so this is verification evidence rather than a claimed
503 fix. Existing telemetry groups login start and callback under product.login, and
HTTP 200 token issuance alone does not establish a product session. No speculative auth
behavior change, account reset, password/secret rotation or deployment was made. Only this
progress record changed in DEV-007; Biome and whitespace checks pass. Temporary validation
script and private password input copies are removed after use; installation credentials,
backups and data remain intact.
Handoff: pnpm dev remains running at http://localhost:23600. Use a fresh sign-in with the
confirmed account/password. If 503 recurs, capture its new request ID and the failing
step/time to correlate with that running API instance; do not infer a port conflict from
this historical log. No commit/push/PR operation was performed.

DEV-006 is completed (owner: Codex, 2026-11-01): audited development/build/deploy
callers and removed obsolete per-API Nest watch commands and Turbo overrides, the unused
root Turbo dev task and infrastructure aliases, frontend preview command, unused
VITE_API_BASE_URL example/build arguments and Vite host-proxy fallback. Compose Watch is
the sole full-stack development entry point; production Dockerfiles/Dokploy, CI builds,
host checks and explicit operator commands remain supported. Updated architecture,
startup/component/standards/runbook docs and marked original plan/handoff evidence as
historical. CI now builds the development image alongside all four production images.
Deployment guards resolve YAML merge anchors (previously inherited builds were skipped),
validate reserved bindings/project identity and reject obsolete development entry points
or development watch/ports in production configuration.
All required pnpm check/build/test/test:integration commands and test:smoke pass locally:
2 fresh loopback tests, 43 recorded API unit cases (cached), 13 fresh Fastify and 52 fresh
PostgreSQL integrations plus migration/runtime-role isolation. Root/production Compose
configuration and final Biome/whitespace checks pass. All five Docker images rebuild;
both production API images pass non-root compiled-entry HTTP checks, web passes non-root
Nginx liveness/SPA/assets/CSP checks, and processing passes its packaged CLI check.
Live validation also found blank required values in both private API runtime files
(reason for the earlier replacement is unconfirmed). Backed up those files privately and
restored only missing values from the existing installation backup, translating restored
local database URLs to reserved port 23603. Kept current nonblank settings, accounts,
passwords, credentials and installation identity; no database writes/migrations or secret
rotation were performed by this recovery. Private snapshots remain outside Git with
restricted permissions. Both API auth readiness checks, canonical discovery/login
redirect, real machine token/DMS capabilities and Compose source sync/Vite HMR pass.
All seven local services run; all six configured Docker health checks are healthy.
No legacy host development processes remain and the original PostgreSQL volume is retained.
Handoff: Compose Watch remains running at http://localhost:23600. Start with
`docker compose up --build --watch` or its `pnpm dev` alias. No cleanup blockers remain;
password login, remote CI and actual Dokploy/pilot deployment were not repeated. Changes
remain local/uncommitted; no push/PR operation, unrelated resource deletion or backup purge.
Follow-up notification check (2026-11-01, Codex): the earlier port-change background
command reported exit 130 (interrupt). Rechecked the current stack: all seven services
run, all configured health checks are healthy, and web plus both auth readiness endpoints
return HTTP 200. No repair or restart was needed; the current Compose Watch session remains running.

DEV-005 is completed (owner: Codex, 2026-11-01): reserved fixed loopback host
ports 23600–23608 for web, DMS API, product API, PostgreSQL, Mailpit SMTP/inbox,
RabbitMQ AMQP/management and SeaweedFS S3. Docker keeps its isolated private listener
ports. Added deploy/development-ports.json, aligned Compose/forwarders/examples/docs,
reserved the range in AGENTS.md and added deployment checks for all bindings and the
pilot inbox. Startup has no fallback to default/random host ports. All nine host ports
bound successfully; application containers and configured infrastructure health checks pass.
Public auth is now http://localhost:23600; DMS audience/transport uses localhost:23601/v1.
Backed up private runtime/operator files and endpoint bindings before transactionally
updating only this installation's OAuth metadata, redirect/logout/resource links and DMS
issuer/enrollment bindings. Immediate foreign keys remained enforced, no persistent DDL,
new roles, re-enrollment, password or secret rotation was performed. Client credentials,
scopes, IDs, active status, key/receipt identities and the original PostgreSQL volume are
preserved; local operator database URLs now use 23603 and SMTP uses 23604. The current
private installation record is updated; historical reports remain historical.
New-origin discovery, real machine token/DMS access, browser-style authorization to the
sign-in form, old-callback rejection, SMTP handshake, AMQP reachability and Vite HMR pass.
All required workspace checks pass (2 transport checks, 43 recorded API unit cases,
13 Fastify and 52 fresh PostgreSQL integrations with isolation checks). Password login
and production/pilot rollout were not repeated. Handoff: Compose Watch remains running;
use http://localhost:23600 and a fresh sign-in. Start with docker compose up --build --watch
or pnpm dev; other applications must avoid 23600–23608. Credentials and data are retained,
and private backups/current binding reports remain outside Git with restricted permissions.
No blockers, commit/push/PR operation or target deployment in this task.


DEV-004 is completed (owner: Codex, 2026-11-01): the owner selected Docker Compose
with per-service hot reload. Root Compose includes the original infrastructure and a
separate development overlay/image, preserving the turnstile-local project, PostgreSQL
volume, accounts, credentials and localhost authentication addresses. pnpm dev aliases
`docker compose up --build --watch`; removed redundant host dev:auth/dev:dms/dev:turnstile
entry points and the old auth bootstrap, and discarded the unpublished host supervisor.
API/shared source sync rebuilds before container restart, web source uses Vite HMR and
manifest/lockfile changes rebuild images. Local-only loopback routing preserves issuer,
resource, PostgreSQL and Mailpit connectivity without changing auth validation. Each API
mounts only its own private .env; frontend/image privacy and unprivileged execution pass.
Docker Desktop rejected publishing the former host API port; keeping APIs private on the
Compose network resolved this, with only web/infrastructure ports published to loopback.
Corrected the image's complete workspace-manifest copy to prevent runtime reinstallation.
Live API source edits, shared rebuilds, frontend HMR, manifest-triggered image recreation
and process-crash restart/auth recovery passed; all three application containers are healthy.
Canonical discovery, real machine token issuance and authenticated DMS capabilities returned
200. Password login was not repeated in this task; no password or account was changed.
Required check/build/test/integration commands passed, including 2 new loopback transport
checks, 43 recorded API unit cases and 65 fresh Fastify/PostgreSQL integration cases with
role/DDL isolation. Updated architecture, startup/runbooks, component docs and CI Compose
validation. Handoff: Compose Watch remains running and the web is at localhost:5173.
Use the single Docker command above (or pnpm dev); stop with Ctrl+C/docker compose stop.
Private environment edits require service restart, topology edits require restarting the
Compose command, and migrations remain explicit. Source/dependency changes on compatible
branches are automatic; broken code/configuration and schema/runtime incompatibility still
require correction. No runtime credentials, installation data or production deployment
were changed; no commit, push or PR operation was performed in this task.


STATUS-002 is completed (owner: Codex, 2026-11-01): reviewed the recorded auth
verification, architecture and ordered DMS requirements. The local authentication chain is
implemented and verified; target customer provisioning and ingress/DNS/TLS/email delivery
remain rollout work. Recommended next milestone: DMS document foundations, first checking
and completing applicable API-contract/audit gaps (groups 03–04), then document registry
(group 05) and admission policies (group 06), before uploads (group 07), durable work,
security assessment/publication and retrieval. AUTH-01–07 completion does not declare all
requirements in groups 01–04 complete. Turnstile business screens still require agreement
on the first workflow and roles. Handoff: recommendation only; no new feature, schema,
remote publication or deployment started. Only this progress entry changed in this task;
Biome and whitespace checks passed. Runtime suites were not repeated for planning notes.

AUTH-DEV-003 is completed (owner: Codex, 2026-11-01): restored local auth after
switching branches while development was running. On branch development, Vite/product
were listening but the authority on port 3001 was absent; product readiness returned
503 authority_unavailable. The prior command was plain `pnpm dev`; the exact authority
crash log was unavailable. Stopped only the identified workspace Turbo process and
started `pnpm dev:auth`. Both APIs rebuilt with zero compilation errors, both auth
readiness endpoints returned 200, and the real browser's Try again button followed
login/authorization redirects to the credential form. Credentialed login was not repeated
in this task. No auth code, credentials, accounts, roles or installation data changed.
Required check/build/test/integration commands passed (43 cached API unit cases, 13 fresh
Fastify and 52 fresh PostgreSQL integration cases plus isolation checks). Updated the
branch-switch procedure in the authentication runbook. Handoff: development remains
running under `pnpm dev:auth`; stop it before future branch changes, install locked
dependencies when manifests/lockfile change, then restart that command and begin a fresh
login. No remote deployment or PR changes were performed.

STATUS-001 is completed (owner: Codex, 2026-11-01): reviewed the current web UI,
authentication plan/runbook, architecture and DMS requirement ordering to inventory
available capabilities. The owner reports sign-in and workspace access working. Current
UI supports login/recovery/reset/session/logout and a permission-protected DMS connection
check; the capability projection currently contains empty format/profile/language lists.
Account provisioning/access grants and application credential/enrollment administration
are private operator commands. Business screens, document registry/upload/processing/search
and target deployment remain pending. Handoff: agree the first Turnstile business workflow;
for a DMS document flow, implement registry/admission boundaries before transfer and
processing. This is a scope discussion, not authorization for new features or deployment.
Only this status record changed; Biome/whitespace validation passed, runtime checks were
not repeated for the documentation-only inventory.

AUTH-LOCAL-002 diagnostic validation is completed (owner: Codex): the owner confirmed
that a prompt fresh login at `/api/auth/login` in a private window reaches the workspace.
The reported `/session-expired` route identifies login/callback rejection; redacted logs
contained a password success followed by a product login 400 before token exchange.
A browser probe reproduced 400 LOGIN_TRANSACTION_INVALID after a newer login replaced
the earlier transaction; fresh transactions passed state validation. This points to stale
sign-in state in the regular browser, but expiry versus replacement (or other profile-specific
cookie behavior) was not established. No application defect or source/configuration repair
is claimed. Keep state/cookie validation intact.
Actual localhost browser login, reload, concurrent reads, DMS access, SSO, complete
logout/relogin and natural token refresh all passed; required workspace checks passed.
Handoff: close old sign-in tabs and start a fresh login in the regular browser. If that
profile still fails, clear only localhost site cookies and retry; a persistent failure
requires bounded callback diagnostics. Regular-profile recovery has not been confirmed.
The temporary private password input was deleted; validation records are redacted.

AUTH-LOCAL-001 is completed (owner: Codex): the persistent local-development installation
is provisioned through the supported role/migration/bootstrap, account, OAuth-client and
enrollment commands. Both APIs report auth readiness 200. Live SDK/OIDC login, safe session
cookies/DTOs, product-to-DMS access, recovery/reset revocation, complete logout, idempotent
enrollment and runtime-role isolation pass. All required workspace checks, 65 integration
cases and three isolated HTTPS/STARTTLS browser journeys passed. Scope is loopback development
with Mailpit; no customer deployment or external mail delivery is included. Handoff: services
are running under `pnpm dev:auth`; use the verified local operator account with the chosen
password. Runtime/operator credentials remain in ignored mode-0600 files, private backups
and provisioning records remain outside the repository, and temporary password inputs were
removed after validation. Restart ordinary development with `pnpm dev:auth`, without
re-provisioning roles or replacing the fixed installation identity.

AUTH-FIX-001 is completed (owner: Codex): implementation, local verification and remote CI.
Protected requests overlapping an in-progress or committed refresh now return retryable
503 while logout and idle/absolute expiry retain their 401 fences. The final session
check, real-HTTP/PostgreSQL regression coverage, and architecture reference are updated.
The owner explicitly authorized publication to the configured public GitHub repository
on 2026-10-31. [PR #1](https://github.com/nishanthturnstile/turnstile-360/pull/1) is open
from `fix/auth-refresh-session-race` to `main`. Remote CI exposed a fresh-checkout failure:
dependency-boundary validation ran before internal packages' public `dist` exports existed.
The boundary command now builds its workspace prerequisites first; validation with all
three package output directories removed passed. Required local checks passed again.
On implementation commit `c70f294`, all five checks passed for both push and PR workflows:
the workspace checks job and all four image builds. No review findings or merge conflicts
are present. Handoff: PR #1 remains open for owner review and merge; merging was not requested.
No deployed readiness is claimed.
AUTH-07 code and its earlier local verification are complete.
Real customer/client provisioning, target Mailpit deployment and Dokploy ingress/container
DNS/TLS verification remain pending; local evidence does not establish deployed readiness.

| ID             | Status    | Owner | Scope / requirement                                                         | Next action                                                                     | Verification / remaining work                                                                                                                                                                                                         | Updated    |
| -------------- | --------- | ----- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| AUTH-05        | Completed | Codex | DMS machine authorization and guarded enrollment                            | Handoff recorded below                                                          | Required workspace checks, 40 API unit cases, 61 integration cases, role/DDL matrix, compiled smoke and contract consistency passed; fixture provisioning only                                                                        | 2026-10-31 |
| AUTH-06        | Completed | Codex | Typed machine client and real cross-service request                         | Handoff recorded below                                                          | Required workspace checks, 43 API unit cases, 63 integration cases, role/DDL matrix, compiled smoke and generated-contract consistency passed; fixture provisioning only                                                              | 2026-10-31 |
| AUTH-07        | Completed | Codex | Login/recovery UI and operational verification                              | Handoff recorded below; target rollout pending                                  | Required checks, 43 API unit cases, 63 integration cases, three production-profile HTTPS/STARTTLS browser journeys, four image builds and isolated runtime checks passed; canonical-container probe unavailable on Docker Desktop/WSL | 2026-10-31 |
| AUTH-FIX-001   | Completed | Codex | Preserve valid sessions during refresh overlap and fix fresh-checkout CI    | PR #1 open for owner review                                                     | 65 local integration cases and required workspace checks passed; all five remote checks passed on implementation commit c70f294                                                                                                       | 2026-10-31 |
| AUTH-LOCAL-001 | Completed | Codex | Persistent local auth installation and operational validation               | Local sign-in available; use pnpm dev:auth after stopping services              | Live local login/recovery/logout, DMS enrollment/capabilities and role isolation passed; required checks, 65 integration cases and three browser journeys passed                                                                      | 2026-10-31 |
| AUTH-LOCAL-002 | Completed | Codex | Diagnose callback rejection and validate real local browser login           | Fresh private-window login confirmed by owner; regular-profile retry available  | Browser login, reload, DMS, logout/relogin and natural refresh passed; required checks passed; stale browser sign-in state indicated, exact trigger unconfirmed                                                                       | 2026-10-31 |
| AUTH-DEV-003   | Completed | Codex | Restore auth after live branch switching                                    | pnpm dev:auth running; stop/restart before switching branches                   | Missing authority listener restored; both APIs ready 200; browser retry reaches sign-in; required workspace checks and 65 integration cases passed                                                                                    | 2026-11-01 |
| DEV-004        | Completed | Codex | Container development with Compose Watch and single startup                 | Docker Compose watch running; use pnpm dev or docker compose up --build --watch | Live source/shared/HMR/image rebuild/crash recovery, canonical auth/machine access, required checks and 65 integration cases passed; private runtime files/data preserved                                                             | 2026-11-01 |
| DEV-005        | Completed | Codex | Reserve non-default local service ports and migrate local endpoint bindings | Web localhost:23600; reserve 23600–23608 for Turnstile                          | All nine bindings, OAuth/issuer/DMS routes, SMTP/AMQP, HMR and required checks passed; credentials/data/active enrollment preserved                                                                                                   | 2026-11-01 |

## Completed milestones

| ID            | Completed  | Result                                                                                                                                                                                                                                                        | Evidence                                                                                                                                                                                                                                                                                                                                                                         |
| ------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| UM-I02        | 2026-11-03 | Reviewed/fixed UM-I01 and implemented strict product/reusable authority contracts with generated API documentation and drift checks                                                                                                                           | Open Code Review delegation evidence; 73/13 schemas, 37/7 route policies; four required checks pass, including 19 Fastify and 91 PostgreSQL regressions; future handlers/persistence remain gated.                                                                                                                                                                               |
| UM-I01        | 2026-11-03 | Adopted unchanged user-management requirements/decisions and concrete architecture, API/lifecycle/ceiling and compatibility baseline                                                                                                                          | Accepted feature specification, source-bound transition inventory and acyclic dependency map; four workspace checks, 19 Fastify and 91 disposable PostgreSQL checks pass; runtime begins I02 onward.                                                                                                                                                                             |
| DS-001        | 2026-11-01 | Owner-selected shadcn preset applied to the web app; semantic tokens, reusable UI, local fonts, development gallery and designer/developer maintenance guide established                                                                                      | Required workspace checks, 54 PostgreSQL plus 13 Fastify integrations, all three HTTPS browser journeys, gallery states/layouts, production exclusion and non-root web image checks pass; local changes only                                                                                                                                                                     |
| WSP-001       | 2026-10-31 | Git repository, pnpm workspace, Turborepo tasks, runtime pins, and lockfiles established                                                                                                                                                                      | [Root manifest](package.json), [workspace](pnpm-workspace.yaml), [task graph](turbo.json)                                                                                                                                                                                                                                                                                        |
| WSP-002       | 2026-10-31 | DMS API and separate Turnstile API created with the Nest CLI and configured with Fastify                                                                                                                                                                      | [DMS API](apps/dms-api/README.md), [Turnstile API](apps/turnstile-api/README.md)                                                                                                                                                                                                                                                                                                 |
| WSP-003       | 2026-10-31 | Turnstile Vite/React/TypeScript frontend created; local API proxy configured                                                                                                                                                                                  | [Web application](apps/turnstile-web/README.md), [Vite configuration](apps/turnstile-web/vite.config.ts)                                                                                                                                                                                                                                                                         |
| WSP-004       | 2026-10-31 | Python package created with uv; processing folders, Ruff, mypy, pytest, and packaging configured                                                                                                                                                              | [Processing project](apps/dms-processing/README.md), [Python configuration](apps/dms-processing/pyproject.toml)                                                                                                                                                                                                                                                                  |
| WSP-005       | 2026-10-31 | DMS/Turnstile contracts and internal DMS client package boundaries established                                                                                                                                                                                | [DMS contracts](packages/dms-contracts/README.md), [DMS client](packages/dms-client/README.md), [Turnstile contracts](packages/turnstile-contracts/README.md)                                                                                                                                                                                                                    |
| WSP-006       | 2026-10-31 | Biome, TypeScript 6.0.3 strict checks, Nest decorator metadata support, and dependency rules configured and validated                                                                                                                                         | [Tooling](tooling/README.md), [standards](docs/standards/workspace.md)                                                                                                                                                                                                                                                                                                           |
| WSP-007       | 2026-10-31 | Dockerfiles, local infrastructure Compose, Dokploy application Compose, Nginx frontend serving, and CI workflow added                                                                                                                                         | [Deployment runbook](docs/runbooks/dokploy.md), [workflow](.github/workflows/workspace.yml); image builds/deployment remain unverified                                                                                                                                                                                                                                           |
| WSP-008       | 2026-10-31 | Application-specific identities replaced generated demo responses; proprietary Thaarei ownership recorded                                                                                                                                                     | [License](LICENSE), private package metadata, Python wheel license verified                                                                                                                                                                                                                                                                                                      |
| ARC-001       | 2026-10-31 | Future web/mobile clients share the Turnstile backend; authoritative business logic stays server-side                                                                                                                                                         | [Client architecture](architecture.md#turnstile-application-architecture); no mobile project added                                                                                                                                                                                                                                                                               |
| ARC-002       | 2026-10-31 | Codex clarified one customer tenant per installation with multiple independent applications; separate installations per customer, shared Turnstile web/mobile backend registration, no SaaS tenant provisioning                                               | [Customer deployment model](architecture.md#customer-deployment-and-application-model), blueprint v1.6, requirements v1.3 (FR-01.01/03/06, FR-06.06), DMS-001 bootstrap acceptance, README/runbook/agent rules; design only                                                                                                                                                      |
| DOC-001       | 2026-10-31 | Shared progress record and required agent handoff/update workflow established                                                                                                                                                                                 | [Agent instructions](AGENTS.md), this file                                                                                                                                                                                                                                                                                                                                       |
| DOC-002       | 2026-10-31 | Codex consolidated complete DMS/Turnstile architecture, component ownership, installed/selected stack, diagrams, deployment, and future-mobile boundaries; redirected overlapping docs and required agent reference                                           | [Architecture](architecture.md), blueprint v1.5, requirements v1.2, README/standards/runbook/app/package/tooling links, [agent instructions](AGENTS.md); documentation-only change                                                                                                                                                                                               |
| AUTH-PLAN-001 | 2026-10-31 | Codex audited absent auth implementation, researched official stable Better Auth/OAuth/Fastify/PostgreSQL/BFF guidance, recorded email/password-first decision and proposed the complete web/user/machine chain with seven work packages and acceptance tests | [Authentication plan](docs/authentication/authentication_implementation_plan.md), [architecture proposal](architecture.md#authentication-chain-implementation-proposal), blueprint v1.7, requirements v1.4; planning only, no auth/customer provisioning performed                                                                                                               |
| AUTH-01       | 2026-10-31 | Codex installed exact authentication dependencies, generated Nest configuration/readiness boundaries, added pure plugin-aware CLI options, validated local/test/production profiles, examples and `dev:auth` orchestration                                    | [Authentication foundations](architecture.md#authentication-configuration-foundations); required workspace checks, 39 API unit tests, 10 HTTP/plugin integration tests, CLI/Node ESM/runtime checks passed; persistence and handlers remain AUTH-02                                                                                                                              |
| DEV-001       | 2026-10-31 | Shared-package rebuilds and consuming API restarts are available through `pnpm dev:auth`; existing separate dev commands remain supported                                                                                                                     | Temporary shared-contract source change rebuilt the package and restarted an isolated-port DMS consumer; HTTP liveness passed, source restored and temporary process tree stopped                                                                                                                                                                                                |
| AUTH-02       | 2026-10-31 | Codex implemented owned PostgreSQL schemas/pools/migrations, least-privilege roles and tenant bootstrap/RLS, persisted native authority, private verified-account provisioning, controlled SMTP recovery, safe responses and encrypted product sessions       | [Architecture](architecture.md#owned-persistence-and-authority-handler), [operator runbook](docs/runbooks/authentication.md); required workspace checks, 14 real database tests plus 10 Fastify checks, production package startup/migrations and pinned unprivileged Nginx privacy checks passed; no real customer provisioning                                                 |
| DOC-AUTH-001  | 2026-10-31 | Codex created a self-contained seven-slide AUTH-01/AUTH-02 presentation with architecture/persistence diagrams, interactive account lifecycle, test-count chart and remaining work                                                                            | [Presentation](docs/presentations/auth-01-02.html); desktop/mobile light/dark previews, navigation/lifecycle/overflow assertions and required workspace checks passed; completed scope distinguished from pending product login and unverified production deployment                                                                                                             |
| DOC-AUTH-002  | 2026-10-31 | Codex clarified first-install/release/daily auth command timing and recorded the owner's corrected Mailpit choice for development/pilot SMTP capture                                                                                                          | [Runbook](docs/runbooks/authentication.md#when-to-run-these-commands), [architecture](architecture.md#owned-persistence-and-authority-handler); required workspace commands passed, final documentation checks and 71 relative file references passed; Mailpit not deployed or connected                                                                                         |
| AUTH-03       | 2026-10-31 | Codex implemented managed confidential login/code/PKCE and machine/client-credentials policies, distinct audiences, private client issuance/inspection/rotation/suspension/scope assignment and nonsecret operator records                                    | [Architecture](architecture.md#managed-oauth-provider-and-distinct-clients), [operator commands](docs/runbooks/authentication.md#issue-and-manage-distinct-oauth-clients); required checks and runtime smoke passed, 36 integration tests plus role-isolation assertions passed, both client secrets invalidate immediately on rotation; fixture provisioning only               |
| AUTH-04       | 2026-10-31 | Codex implemented persisted OIDC BFF routes, live parent/local permission authorization, default-deny guards, CSRF, fenced bounded refresh, recoverable logout and private product-access assignment                                                          | [Architecture](architecture.md#turnstile-bff-and-user-authorization-boundary), [runbook](docs/runbooks/authentication.md#configure-turnstile-login-and-local-access), [OpenAPI](docs/api/turnstile-auth.openapi.yaml); all required checks and compiled API smoke passed, 55 integration cases plus role isolation; migration/provisioning exercised only in disposable fixtures |

AUTH-05 completed on 2026-10-31 (Codex): default-deny machine guard, current local
registration/operation/scope authorization, private pending registration/key commands,
transactional enrollment and bounded replay, local-first disablement with explicit issuer
retry, reserved service categories, bounded audit and narrowed runtime privileges.
Shared Zod contracts generate the [DMS OpenAPI](docs/api/dms-auth.openapi.json); see
the [machine boundary](architecture.md#dms-machine-authorization-and-guarded-enrollment)
and [operator steps](docs/runbooks/authentication.md#register-and-enroll-a-dms-machine-application).
Verification and remaining environment work are recorded in the handoff below.

AUTH-06 completed on 2026-10-31 (Codex): typed server-only DMS HTTP client, coalesced
resource/scope-bound machine token provider and product-permission-protected capability
adapter, with bounded transport, expiry-only read replay and session-preserving DMS errors.
See the [client boundary](architecture.md#typed-machine-client-and-cross-service-capability-request),
[operator verification](docs/runbooks/authentication.md#verify-the-typed-cross-service-capability-request)
and [product OpenAPI](docs/api/turnstile-auth.openapi.yaml). Verification is recorded below.

AUTH-07 completed on 2026-10-31 (Codex): login, verification resend, recovery/reset,
authenticated entry and safe session/logout/error UI; fixed browser callback error destinations;
bounded redacted security events/counters; development Mailpit and optional pilot STARTTLS
configuration. Three focused browser journeys exercise production-profile HTTPS with real
APIs, PostgreSQL and Mailpit, including production Nginx assets/CSP. All four application
images build and isolated runtime checks pass. See the
[UI/operational boundary](architecture.md#loginrecovery-ui-and-operational-boundary) and
[operator runbook](docs/runbooks/authentication.md). Target DNS/TLS/proxy and real customer
provisioning remain explicitly unverified.

DOC-TEST-001 completed on 2026-10-31 (Codex): added one focused testing guideline to
[AGENTS.md](AGENTS.md). Biome and whitespace checks passed; runtime tests were not rerun
for this documentation-only change. No blockers or remaining work.

## Latest recorded verification

DEV-005 verification (2026-11-01, Codex): checked and successfully bound all nine
reserved host ports 23600–23608 under Docker Desktop/WSL. HTTP checks returned 200 for
web, both auth-readiness endpoints, Mailpit inbox, RabbitMQ management and SeaweedFS;
SMTP/AMQP socket handshakes passed. Container-to-public canonical discovery, existing
client-credentials token issuance and protected DMS capabilities returned 200 at the new
addresses. Browser-style HTTP authorization redirects use the exact new callback and
reach the sign-in form; the old callback is rejected with invalid_redirect. Actual Vite
WebSocket HMR works on 23600 and the temporary source probe was restored. PostgreSQL
retains turnstile-local_postgres-data; private old/new configuration comparison confirmed
credentials, role names, database identity and other non-address settings unchanged.
A bounded single-transaction local metadata update retained FK checks and active enrollment
state; no account or schema migration was needed. pnpm check/build/test/test:integration
passed; 2 transport tests, 43 recorded API unit cases, 13 Fastify and 52 fresh PostgreSQL
integration cases plus role/DDL isolation are recorded in the command logs. Root/default
Compose configuration, the fixed-port/pilot binding guards and Git whitespace checks pass.
Credentialed browser login, target deployment and pilot STARTTLS were not rerun. A final
Docker snapshot briefly showed product readiness unhealthy; it recovered without restart.
Subsequent direct API/issuer/JWKS requests and successive Docker health checks passed.
The exact transient trigger was not established; no persistent failure was reproduced.
Local services/watch remain running on the new addresses, with no outstanding blocker.

DEV-004 verification (2026-11-01, Codex): Docker Engine 29.9.2/Compose 5.6.1 built
and ran the separate development application images. Real Compose Watch API source sync,
shared dependency rebuild/restart, Vite WebSocket HMR, manifest-driven image rebuild and
restoration, and a deliberately killed API process all recovered to three healthy app
containers. Startup/restarts after the manifest-copy correction performed no runtime
installation. Canonical public issuer discovery and existing client-credentials/DMS access
returned 200 from the product container. Frontend private API files/variables are absent,
containers run as UID 1000, API host ports are unpublished and PostgreSQL retains
turnstile-local_postgres-data. All temporary source/manifest probes were restored.
`pnpm check`, `pnpm build` (7 projects, 4 cached), `pnpm test` (2 new transport cases plus
43 recorded API unit cases/Python check, workspace tasks partly cached) and
`pnpm test:integration` (13 Fastify + 52 fresh PostgreSQL cases, isolation checks) passed.
Root/default and existing Compose configuration validation and Git whitespace checks passed.
Password/browser login, production images/deployment and remote CI were not rerun for this
development change. Working development containers/watch remain available; no blockers.

AUTH-DEV-003 verification (2026-11-01, Codex): observed connection refusal on authority
port 3001 and 503 authority_unavailable on product readiness while Vite/product remained
up under plain pnpm dev. After restarting the verified workspace development process with
pnpm dev:auth, both APIs compiled without errors and returned auth readiness 200; product
login returned 302 to the configured authority. Real-browser Try again reached the signed
credential form through two successful redirects. The diagnostic tab was closed.
`pnpm check`, `pnpm build`, `pnpm test` (43 cached API unit cases and Python check), and
`pnpm test:integration` (13 Fastify plus 52 freshly executed PostgreSQL cases and role/DDL
isolation) passed on Node 24.21.0/pnpm 12.16.1. Build used Turbo cache; no auth source changed.
The runbook and this handoff are the only repository changes. Full password login and
remote CI/deployment were not repeated; the existing installation was preserved.

AUTH-LOCAL-002 verification (2026-10-31, Codex): T3 shared Chromium browser drove the
actual Vite development frontend and persistent local APIs through two email/password
logins, parallel initial session reads, reload, eight concurrent reads, existing-session
SSO, live DMS capability access, explicit logout and fresh relogin. Logout returned 200,
subsequent product session returned 401 and the authority session was null. Fresh relogin
completed at 17:38:58 UTC. Session polling remained 200 through the first natural refresh;
at 17:44:20 UTC (past the original five-minute token expiry), four parallel reads and
DMS capability access remained 200 with the signed-in workspace visible. The private
password input was deleted after credentialed checks. Required commands passed again:
`pnpm check`, `pnpm build`, `pnpm test` and `pnpm test:integration` (43 API unit cases and
13 Fastify integration cases from cache; 52 PostgreSQL cases freshly executed, including
role/DDL isolation). No app/schema/configuration source changed; only this handoff was
updated. The reported immediate expiry was not reproduced at the owner's confirmed
localhost origin. The owner subsequently confirmed `/session-expired`; callback transaction rejection
was narrowed as described above. The owner confirmed that a fresh private-window login reaches the workspace.
This points to stale regular-browser sign-in state; the exact trigger remains unconfirmed;
no repair, new deployment or updated PR checks are claimed.

AUTH-LOCAL-001 verification (2026-10-31, Codex): created a dedicated persistent local
installation database after confirming no existing installation/owned roles would be
replaced. Provisioned six least-privilege roles, applied committed auth/DMS/product
migrations and bootstrapped the same installation repeatedly. Provisioned and Mailpit-verified
one local operator, issued separate login/machine OAuth clients, assigned explicit product
access, registered/enrolled the pending DMS consumer, and retained its idempotent receipt.
Both live auth readiness endpoints return 200; the unsigned session endpoint correctly
returns 401. The real browser SDK over HTTP completed signed OIDC/PKCE login, safe opaque
cookie/session projection and a product-permission-protected DMS capability request.
Missing-CSRF/hostile-origin logout and callback replay were denied. Actual Mailpit recovery
and reset revoked the old parent/product session while retaining the chosen password;
relogin and complete local/authority logout passed. Pending machine denial, one-time
enrollment, identical receipt replay and activated capability read passed. Runtime-role
cross-schema access and missing-tenant access were denied; installed backend secrets were
absent from browser production assets. Environment permissions are mode 0600 and temporary
password input files were removed. No implementation/schema source changes were required.
`pnpm check`, `pnpm build`, `pnpm test` (43 API cases and Python entry point), and
`pnpm test:integration` (65 cases plus role/DDL isolation) and `pnpm test:smoke` passed;
unchanged tasks used Turbo cache. Three isolated production-profile HTTPS/STARTTLS browser journeys passed
separately from the persistent local HTTP installation. Development remains running with
frontend/API/authority and Mailpit on their documented loopback ports; real customer and
Dokploy provisioning remain pending.

AUTH-FIX-001 local verification (2026-10-31, Codex): both new overlap regressions failed
against the original code with 401 instead of 503, then passed after the fix.
`pnpm check`, `pnpm build`, `pnpm test` (43 API cases plus the Python entry point),
`pnpm test:integration` (13 Fastify plus 52 PostgreSQL cases, 65 total, including role/DDL
isolation), `pnpm test:smoke`, and Git whitespace checks passed. Unchanged tasks used
Turbo cache; affected product type checking, build, unit tests and integration tests ran.
No new image builds, deployed checks or real customer provisioning were performed.
CI follow-up (2026-10-31, Codex): PR #1's initial head `2f11d74` passed all four image
builds, but `checks` failed on 26 unresolved workspace imports before package exports
were built. Reproduced with the three package `dist` directories removed, then verified
that the updated `check:boundaries` command rebuilt the outputs and passed. Repeated
`pnpm check`, `pnpm build`, `pnpm test`, `pnpm test:integration` (65 cases), and
`pnpm test:smoke` successfully. The manifest script and architecture reference are updated;
GitHub verified implementation commit `c70f294`: the workspace checks and all four image
builds passed in both push and pull-request workflows. No review comments or conflicts were
present at handoff. This documentation-only update records that result; no implementation
changed. See [PR #1](https://github.com/nishanthturnstile/turnstile-360/pull/1).

The following results were observed on 2026-10-31, including the AUTH-07 final recheck. They
cover the authority, BFF, DMS enrollment, real typed cross-service request and login/recovery UI.
Actual Dokploy/customer authentication evidence and business features remain incomplete.
Re-run affected checks when implementation changes.

| Check                                           | Recorded result                                                                                                                                                                                                     |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Locked pnpm installation and uv synchronization | Passed                                                                                                                                                                                                              |
| `pnpm check`                                    | Passed: Biome, dependency boundaries, TypeScript, Ruff/mypy, deployment YAML/build paths and offline Better Auth CLI generation                                                                                     |
| `pnpm build`                                    | Passed for all seven application/library projects, including Python distributions                                                                                                                                   |
| `pnpm test`                                     | Passed: 43 API unit/configuration/security/transport cases and the installed Python entry point                                                                                                                     |
| `pnpm test:integration`                         | Passed after AUTH-07: 13 Fastify checks plus 50 PostgreSQL authority/product/enrollment/cross-service cases (63 total) and the runtime role/DDL isolation matrix                                                    |
| `pnpm test:smoke`                               | Passed: both compiled APIs started and responded over HTTP                                                                                                                                                          |
| Dependency-rule enforcement                     | AUTH-01 accepted browser SDK imports and rejected Better Auth server imports; temporary probes removed. Previous cross-app/Node boundary checks remain historical                                                   |
| Python distribution ownership                   | Proprietary metadata and matching Thaarei LICENSE confirmed in the wheel                                                                                                                                            |
| Running local Turnstile development services    | Frontend, API identity, API liveness, and Vite `/api` proxy returned HTTP 200                                                                                                                                       |
| Docker availability                             | Docker Engine 29.9.2 responds; it became available after initial workspace validation                                                                                                                               |
| All three Compose files                         | Passed YAML/build-path checks and `docker compose config --quiet`, including the optional pilot Mailpit overlay                                                                                                     |
| DMS production dependency packaging             | Passed for both APIs after AUTH-02: production dependencies, compiled startup and packaged migration files                                                                                                          |
| Container image builds / infrastructure startup | All four images built; API non-root startup/liveness, Nginx headers/log privacy, Python entry and disposable PostgreSQL/Mailpit verified. Full broker/storage compatibility and remote deployment remain unverified |
| Browser authentication journeys                 | Passed: three real HTTPS/STARTTLS journeys with Mailpit and production Nginx assets/CSP; mobile layout and bounded/redacted event assertions included                                                               |
| Canonical issuer from application container     | Unavailable: Docker Desktop host-network routing cannot reach the WSL HTTPS fixture. Target container DNS/TLS must be verified during rollout                                                                       |
| Remote CI                                       | Passed on implementation commit c70f294 in PR #1: workspace checks and all four image builds, for both push and pull-request workflows                                                                              |
| Dokploy deployment and routing                  | Execution not verified; remote CI does not establish target deployment readiness                                                                                                                                    |

Documentation consolidation verified on 2026-10-31 (DOC-002, Codex): configured Biome
checks passed for 17 Markdown files (the two DMS specifications are excluded by the
existing Biome configuration); Git whitespace checks passed. All 130 relative file links
and heading targets resolved across 19 documentation files; all 120 technical blocks moved from blueprint sections 3–17 and
the distribution policy were preserved; original numbered blueprint heading targets remain.
All 189 FR statements and 14 NFR statements are unchanged. Documented direct dependency
versions were checked against manifests and Python tools against `uv.lock`. No application,
manifest, lockfile, schema, or deployment configuration changed. Runtime/build tests were
not repeated for this documentation-only task; prior runtime results above remain historical.
No blockers or remaining work for DOC-002.

Customer tenancy clarification verified on 2026-10-31 (ARC-002, Codex): affected Markdown
passed configured Biome and whitespace checks; relative links/anchors resolved. All 189
FR IDs and 14 NFR IDs remain stable; only FR-01.01, FR-01.03, FR-01.06 and FR-06.06 changed
to reflect the owner's model. Architecture, product scope, requirements, implementation
plan, deployment runbook, README and agent rules agree on one customer per installation
and multiple independently registered applications. Next DMS-001 implementation must
verify repeatable bootstrap, rejection of a second/different customer tenant, and application
isolation. No code, database schema, dependencies or deployment configuration changed;
runtime/build tests were not repeated. No blockers or remaining work for ARC-002.

Authentication research/planning handoff on 2026-10-31 (AUTH-PLAN-001, Codex): inspected
actual modules/manifests/contracts/bootstrap/proxy/Compose; no Better Auth or auth behavior
is installed. Reviewed official stable 1.7 docs, OAuth/OIDC standards and maintainer
session/client guidance; registry metadata reported Better Auth/OAuth/Drizzle-adapter/CLI
1.7.14 and the plan's candidate dependency versions. Inspected cookie/session artifacts:
both declare compatibility with the current Fastify 5.x line (resolved 5.12.7). These are
research/metadata checks, not installed dependency or runtime compatibility tests.
Documentation formatting, relative links/anchors and requirement consistency were checked;
all 189 FR statements and 14 NFR statements remain unchanged from the pre-task documents.
Email/password was confirmed by the owner. Concrete BFF/OIDC integration and new session
policies are recommendations. No application, dependency, lockfile, database or deployment
configuration changes, installs, auth tests, image builds or customer provisioning occurred.
The implementation plan covers remaining work; no blocker for completion of this planning task.


AUTH-01 handoff (2026-10-31, Codex): exact dependency pins and strict peer/frozen-lockfile
installation passed on Node 24.21.0 / pnpm 12.16.1 / TS 6.0.3. Installed Nest CLI generated
authority/readiness, product auth and DMS integration scaffolds. Both APIs validate their
owned settings; malformed URLs, insecure production URLs, missing/placeholder/reused
secrets, unsupported signing algorithms, shared client IDs and authority/DMS runtime-role
reuse are rejected. CLI/preflight diagnostics contain field names only. Browser import
rules accept Better Auth/OAuth client exports and reject server exports.

`pnpm check`, `pnpm build`, `pnpm test` (39 API tests plus Python entry-point check),
`pnpm test:integration` (10 checks) and `pnpm test:smoke` passed. Official `auth` 1.7.14
loaded the pure TS/ESM options and generated all core/admin/JWT/OAuth/rate-limit models
using disposable, unreachable DB URLs; temporary schema output was removed. Direct Node
ESM checks loaded compiled authority/product config, exercised jose RS256 and OIDC PKCE.
Fastify cookie/session round-trip passed with a test-only memory store; no runtime session
store is enabled. `dev:auth` rejects missing secrets before infrastructure startup.
PostgreSQL Compose start/wait was healthy. Turbo watch rebuilt shared contracts and
restarted a DMS consumer on a temporary port; temporary source changes were restored and
the process tree stopped. Existing development services were preserved.

The combined `dev:auth` launch with supplied credentials was not run because the default
application ports are already occupied; its PostgreSQL, preflight and watcher components
were checked separately. Container image builds, auth persistence, actual role grants,
real CLI schema checks, SMTP/recovery, login/token/session handlers, client registration,
real browser auth and deployed proxy/TLS behavior remain unverified/unimplemented under
AUTH-02–AUTH-07. No migrations, roles, accounts, clients, tenant/customer fixtures or
customer provisioning were applied. Auth readiness returns 503 for invalid configuration
or pending persistence, and identity/liveness still work. No blocker remains for AUTH-01.
The next increment is AUTH-02; review the real adapter namespace/transactions and generated
schema before retaining/applying SQL. The new dev command resolves DEV-001 for the auth
workflow; older `turbo run dev` commands still build shared packages once.


AUTH-02 handoff (2026-10-31, Codex): generated all 13 Better Auth core/admin/JWT/OAuth/
rate-limit tables with the installed 1.7.14 CLI and explicit `auth` namespace. Drizzle CLI
produced separate auth/DMS/product histories and tenant-policy declarations; reviewed
custom migrations grant only the required runtime privileges and force tenant policies.
Schemas live under owning `src` modules to preserve compilation roots/entry points; SQL
and histories remain in each application's reserved `database` folders. Migration helpers
use dedicated credentials, role checks and advisory locks. Initial role provisioning is an
explicit operator command; runtime startup never migrates or creates installation data.
Both database credentials and transaction-local tenant context are isolated; repeated
bootstrap preserves identity and mismatched tenant/customer/product IDs fail.

The native authority has an explicit public route allowlist outside `/v1`; signup,
standalone session-JWT and raw operator/client-management paths remain closed. Safe
sign-in/session projections omit credentials while preserving the official SDK and signed
OAuth continuation. JSON/form payloads, duplicate-parameter denial, statuses, redirects,
separate Set-Cookie headers and no-store behavior were checked. Canonical request URLs,
derived client IP, disabled sensitive logging and URL-free Nginx logs protect recovery
material. SMTP verifies availability before account lookup and uses request-local failure
tracking because the pinned library catches background callback errors. Verification,
reset expiry, successful delivery, offline/rejected delivery and reset-session revocation
were tested. The reset fault trigger proved reset-token consumption, session deletion and
password writes roll back together; retry succeeds exactly once. Signing keys and user
sessions survive restart. Product PostgreSQL sessions are encrypted with tenant/ID-bound
AES-GCM and hashed IDs, bounded expiry and atomic generation checks; no product BFF routes
or runtime memory store were added.

Verification passed: `pnpm install --frozen-lockfile`, `pnpm check`, `pnpm build`, `pnpm test`
(39 API unit tests plus Python entry-point check), `pnpm test:integration` (10 Fastify plus
14 real PostgreSQL tests and the role/DDL matrix), and `pnpm test:smoke`. Both APIs passed
`pnpm deploy --prod`, startup from those isolated runtime packages and migration artifact
presence checks. Both Compose files passed `config --quiet`. Pinned Nginx ran as its
unprivileged user in a temporary container: credential/SPA paths returned 200, no-referrer
was present, and fixture token/query values were absent from logs. All temporary
PostgreSQL/Nginx containers, volumes and package directories were removed; existing
local services and data were preserved. The SDK tests use the actual client/plugin against
HTTP injection with browser-location simulation, not a real browser UI or deployed client.

Compatibility finding: the pinned provider rejects HTTP redirect metadata marked `web`,
including localhost. The confidential local fixture uses loopback `native` metadata with
PKCE and exact registered URI matching; production clients remain HTTPS `web`. Record
this in AUTH-03's provisioning policy rather than weakening redirects or adding mobile.
Private operator/environment instructions are in the new authentication runbook. Migration
credentials use separate `.env.migrate`/`.env.provision` files and are absent from API
Compose mappings and development-task passthrough. No real roles, migrations, accounts,
OAuth clients or installations were applied outside disposable fixtures.

Remaining work is AUTH-03–AUTH-07: deployed distinct client policy, BFF/login/UI,
registration/enrollment/machine authorization, cross-service integration and final
operational evidence. Production domains/TLS, ingress log controls, a real SMTP relay,
full application image builds, remote CI/Dokploy, backup/key recovery and broader expiry
cleanup remain unverified or later operator work. No blocker remains for AUTH-02.

Presentation handoff on 2026-10-31 (DOC-AUTH-001, Codex): added
[the AUTH-01/AUTH-02 HTML deck](docs/presentations/auth-01-02.html), derived from the
accepted architecture, authentication plan and recorded implementation evidence. It
includes seven navigable slides, keyboard controls, a view-all mode, print styles and
an interactive account lifecycle. Preview checks at 728px and 390px passed navigation,
keyboard, lifecycle selection, view-all toggling and all-slide horizontal-overflow
assertions, with no console errors. Light/dark layouts were inspected. Biome and all
four required workspace commands (`pnpm check`, `pnpm build`, `pnpm test`,
`pnpm test:integration`) passed; build/unit results were reused from valid Turbo caches,
and disposable PostgreSQL authority/product tests ran successfully again. No application
behavior or architecture changed. No presentation blockers remain; AUTH-03–07 and
production verification retain their existing pending status.

Operational-guidance handoff on 2026-10-31 (DOC-AUTH-002, Codex): the authentication
runbook now distinguishes repository generation/review, per-environment role creation,
pending migrations, fixed installation bootstrap, per-account provisioning and ordinary
service startup. It records that persistent target environments were not provisioned by
the disposable verification suites. The owner clarified that “Mailbit” meant
[Mailpit](https://mailpit.axllent.org/). Architecture records Mailpit for development and
controlled pilot capture; the runbook documents host-loopback SMTP settings, inbox access,
container/pilot TLS requirements and the need for an upstream relay for external delivery.
Official Mailpit SMTP/configuration documentation was checked. No runtime/Compose change,
Mailpit deployment, real email, credentials or persistent customer database was created.
`pnpm check`, `pnpm build`, `pnpm test` and `pnpm test:integration` passed during the task;
final documentation Biome/whitespace checks and 71 relative file references passed after
the provider clarification. No documentation blocker remains; Mailpit deployment/capture
verification, real environment setup and AUTH-03–07 are still pending.

AUTH-03 handoff on 2026-10-31 (Codex): implemented the provider policy in
`platform-auth/oauth-policy.ts`, private process-local operator context and the compiled
`auth:manage-client` command. Updated the native handler/options, existing SDK fixture,
DMS scope contract export, application/package READMEs, architecture, plan and operator
runbook. The existing 13 generated auth tables already support this feature; no retained
schema or SQL migration changes were needed. Runtime startup creates no clients/resources.

Private issuance uses the supported provider APIs, fixed configured IDs by default,
verified admin authentication, tenant-owned client references and stable application UUID
metadata. Login clients require code/refresh, S256 PKCE, explicit first-party approval and
exact callback/logout destinations. Machine clients use only client credentials, an
operator-assigned catalog scope ceiling and the linked DMS resource. Access JWTs are
RS256 `at+jwt`; user access/ID and machine audiences are separate, user tokens carry the
parent session while machine tokens do not. Refresh renewal additionally requires a live
parent session. CLI secrets go only to a newly reserved mode-0600 file; stdout is a
projected nonsecret operator record. Public administration remains closed even to admin
cookies, and no HTTP header can enable the private operator context.

Actual verification: `pnpm check`, `pnpm build`, `pnpm test`, `pnpm test:integration` and
`pnpm test:smoke` passed. The 39 API unit/configuration tests and Python entry smoke passed.
Integration has 10 Fastify cases plus 22 DMS and 4 product PostgreSQL cases (36 total),
with additional runtime role/DDL checks. Twelve new OAuth database cases cover emitted
claims/signatures/lifetimes, grant/scope/resource/method separation, exact callback and
POST logout, unauthorized management, refresh/code replay, both client-secret rotations,
suspension/resumption, production HTTPS web registration metadata, restart persistence
and the actual compiled command's private file/no-secret-output behavior. Code replay
revokes its refresh family; secret rotation invalidates the old secret immediately while
preserving client/application identity. Existing signed machine JWTs remain valid until
expiry and still need AUTH-05's live registration checks for immediate DMS disconnection.
The provider's canonical JWKS fetch during logout is routed to the real native handler
through test injection; this is not deployed network/TLS or browser UI verification.
Offline pinned CLI generation/schema checking and 87 documentation file/anchor references
passed. Temporary PostgreSQL fixtures and credential files were removed; existing local
services/data and the user's staged changes were preserved. No real account/client/customer
or Mailpit deployment was provisioned. Production image builds, ingress/TLS/canonical
reachability, mail delivery and the complete user-to-DMS chain remain unverified/pending.
No AUTH-03 blocker remains. The next authorized implementation increment is AUTH-04 only
when requested; AUTH-05–07 remain later scope.

AUTH-04 handoff on 2026-10-31 (Codex): implemented FR-01.07/09, FR-02.07/09 and
FR-03.01/02/09's product boundary in
[browser auth](apps/turnstile-api/src/modules/auth/browser-auth/browser-auth.service.ts),
the OIDC HTTP client, persistent session integration, global `UserSessionGuard` and explicit
permission metadata. Added safe platform-independent DTOs and the OpenAPI contract.
Login/callback regenerate opaque cookies and atomically consume encrypted transactions;
live introspection/local access enforce revocation without a positive cache. Refresh
claims and encrypted revisions fence multiple instances without holding database locks
across HTTP. Expired/uncertain identity retains only a bounded unauthenticated logout
receipt for controlled cleanup; it cannot authorize product requests. Logout supports
direct API clients, partial authority failures and lost responses, including repeat
browser-cookie clearing. Successful empty native authority protocol responses are preserved.

Generated/reviewed [0003_user_permissions.sql](apps/turnstile-api/database/migrations/0003_user_permissions.sql)
adds one default-empty permission column to existing operator-owned user access; no
new table, schema or database role. The private compiled `auth:set-access` command was
verified with migrator credentials and rejects runtime credentials/unknown permissions.
Runtime services retain read-only grants for local access assignments. Authority admin
roles confer no product permission; no business roles or DMS operation were introduced.
Architecture, API/package/root READMEs, implementation plan and operator command timing
were updated. Existing historical handoffs and staged changes are preserved.

Verification: `pnpm check`, `pnpm build`, `pnpm test` and `pnpm test:integration` passed
after final source changes. Unit/configuration coverage remains 39 API cases plus the
Python entry-point smoke. Integration now has 13 Fastify cases and 42 PostgreSQL cases:
22 DMS and 20 product (16 BFF/command/security cases plus four persistence cases), in
addition to the separate runtime role/DDL matrix. The BFF suite runs a separate compiled
authority process over HTTP; it verifies browser transaction binding/replay, nonce/PKCE,
wrong identity claims, denied local access, parent logout/reset/suspension, restart,
concurrent refresh, delayed/lost/reused refresh responses, idle/absolute limits, CSRF,
Secure host-only cookies behind internal HTTP and logout retries. Compiled API entry-point
HTTP smoke also passed. OpenAPI YAML/security/local references and documentation links
were checked. Logs are in `/tmp/auth04-final-{check,build,test,integration,smoke}.log`.

Only disposable fixture accounts/clients/grants/databases were provisioned; test containers
and child services were removed. No real development/pilot/customer setup or Mailpit
deployment was performed. Deploy the committed product migration, issue/install the login
client and explicitly assign verified users local access in the target environment before
using the BFF. Full application image builds, Dokploy/TLS/canonical container reachability,
external mail delivery and deployed browser UI remain unverified. AUTH-05 machine
authorization/enrollment, AUTH-06 DMS client and AUTH-07 UI/final operational evidence
remain pending. No AUTH-04 blocker remains; later increments need their own authorization.

AUTH-05 handoff on 2026-10-31 (Codex): implemented FR-01.01/02/03/06,
FR-02.01–06/08/10–16 and the selected enrollment retry/error boundary. The global DMS
guard verifies canonical issuer/JWKS RS256 access JWTs and exact resource/client identity,
rejects cookie/user/ID/opaque/DPoP authority and caller tenant selectors, and reads current
consumer status/ceiling before each explicitly scoped normal operation. Unmapped and
pending clients cannot call capabilities. New publisher/scanner/extractor categories are
reserved only; no worker or document/resource-grant implementation was added.

The private application command verifies managed provider identity for pending registration,
issues/revokes digest-only bound keys, inspects/changes local policy and disables locally
before attempting issuer suspension. A partial issuer outcome retains local denial and
durable pending audit, exits 2 and supports explicit retry. Enrollment locks registration/key
and atomically commits activation, key consumption, 24-hour nonsecret receipt and audit.
Replay checks binding/body, expiry, revocation and current state; contention is retryable
409. Runtime grants now restrict registration writes and separate key consumption from
operator issuance/revocation. Three added tenant tables use forced RLS. Private authority
account/client commands record bounded cross-pool attempt/completion evidence; no public
audit reader or scheduled cleanup is introduced.

Installed Nest and Drizzle CLIs generated scaffolds/migrations; the reviewed generated
migration orders the referenced unique constraint before its foreign key. DMS migrations
`0003_machine_enrollment.sql` and `0004_machine_privileges.sql` were applied and repeated
only in disposable fixtures. Shared platform-independent Zod DTOs export JSON Schema;
`pnpm docs:dms-auth` generates the committed OpenAPI. The runbook records command timing,
private input/output handling, enrollment retries, scope coordination and emergency disablement.

Final `pnpm check`, `pnpm build`, `pnpm test`, `pnpm test:integration` and
`pnpm test:smoke` passed. There are 40 API unit cases plus the Python entry smoke, and
61 integration cases (13 Fastify + 28 DMS PostgreSQL + 20 product PostgreSQL), with the
runtime role/DDL matrix and repeatable migration/bootstrap checks. Seven added focused
tests cover cryptographic credential denial and six PostgreSQL enrollment/lifecycle risks:
unmapped/current policy, cross-client/deployment binding, replay/expiry/revocation,
concurrent locking, audit-failure rollback, partial disablement/retry and secret/role isolation.
The generated OpenAPI consistency check, configured documentation formatting and relative
link/anchor checks also passed. Existing staged/unstaged AUTH-01–04 work was preserved;
no commit or remote operation was performed.

No blocker remains for AUTH-05. No persistent development/pilot/customer database, account,
client or application was provisioned; Mailpit remains selected but undeployed. Apply the
committed DMS migrations and perform explicit provider/registration/key/enrollment steps
in the target environment. Full application images, Dokploy/TLS/routing, external email,
deployed browser screens and maintenance/retention execution remain unverified. AUTH-06
typed machine client/product adapter and AUTH-07 UI/final operational evidence remain
pending and need their own request. No next increment was started.

AUTH-06 handoff on 2026-10-31 (Codex): implemented FR-02.07/08/09 and the selected
FR-03.01/02/07/08/09 transport/retry boundary. The server-only DMS package exposes typed
capability and explicit enrollment operations over shared runtime-validated contracts.
Its injected client-credentials provider coalesces acquisition/early renewal for a fixed
issuer/client/resource/scope partition and prevents stale rejection from evicting a newer
token. Only `401 MACHINE_TOKEN_EXPIRED` on a capability GET permits one renewal/replay;
other 401s, 403s, outages and mutations never automatically retry. Canonical URLs,
redirect/cookie rejection, five-second HTTP/body deadlines, 16 KiB response bounds and
sanitized structured errors constrain transport. The expiry code is exported through
shared schemas and regenerated DMS OpenAPI.

Installed Nest CLI generated the product integration scaffolds. The real
`GET /api/dms/capabilities` handler requires live user/local access and the explicit
`turnstile:dms:capabilities:read` action, uses its separate machine token, verifies
tenant/application binding and projects only format/profile/language lists. Browser
credentials/tenant/actor headers are ignored; verified bounded user/correlation context
is attribution only. Product responses use `private, no-store`; the integration suite
caught and corrected the prior session hook overwriting this route's policy. DMS 403/503
errors preserve the user session. A shared-process outage fails the preceding live user
check with AUTH_UNAVAILABLE while retaining retryable local state. Logout/permission
denial stops requests before machine access. No schemas, roles, migrations, environment
keys, document CRUD, startup enrollment or UI were added. Node type definitions were
added only to the server package; existing staged/unstaged work was preserved.

Final `pnpm check`, `pnpm build`, `pnpm test`, `pnpm test:integration` and
`pnpm test:smoke` passed. There are 43 API unit cases (22 DMS + 21 product) plus Python
entry smoke, and 63 integration cases (13 Fastify + 28 DMS PostgreSQL + 22 product
PostgreSQL), with runtime role/DDL isolation and repeatable migration/bootstrap checks.
Three added transport cases cover coalescing/renewal, limited replay and real HTTP
redirect/deadline/body limits. Two added cases extend the separate-process DMS/authority
fixture for the real typed request, concurrent token reuse, permission/logout, spoofed
context, scope/disablement and DMS/issuer/shared-process outage separation. The existing
cryptographic case checks explicit expiry. Generated-contract consistency, product
OpenAPI references and documentation checks also passed.

No AUTH-06 blocker remains. Only disposable databases/accounts/clients/registration and
enrollment were provisioned and removed. Real environment configuration, Mailpit,
login/recovery UI, application images, Dokploy/TLS/routing and deployed operational
verification remain pending. Existing users need explicit action permission assignment;
install/enroll real machine credentials and restart/reload the backend using the runbook.
No commit or remote action occurred. AUTH-07 is next when requested; it was not started.

AUTH-07 handoff on 2026-10-31 (Codex): implemented the minimal auth UI using the pinned
Better Auth client and signed OAuth continuation. Passwords/reset tokens remain in memory;
reset URLs are cleaned before render. Session loading fails safely; logout retires local UI
before authority completion and provides explicit bounded retry. Authenticated users can
exercise the permission-gated DMS capability request. Browser callback errors now use explicit
302 redirects to fixed UI states; JSON clients keep their existing error contract.

Both APIs emit fixed-schema, fixed-label security events and saturating process counters,
with no user/IP/URL dimensions and a bounded stdout queue. Nginx adds a same-origin CSP,
no-referrer and nosniff, with sensitive-page log suppression. Development Mailpit is pinned
by digest with bounded disposable capture; the optional pilot overlay requires STARTTLS
and operator certificate/CA files. No schema, migration, role, signup, IAM or business feature
was added. Runbooks describe first install, recurring release steps, recovery and rollback.

Final `pnpm check`, `pnpm build`, `pnpm test`, `pnpm test:integration`, `pnpm test:smoke`
and generated DMS OpenAPI consistency passed. The existing suites contain 43 API unit cases,
63 integration cases and Python entry smoke. AUTH-07 adds only three focused real browser
journeys, all passing against built assets and again against the production Nginx image:
signed login/machine request/CSRF/outages/partial logout; verification and generic recovery/
reset/replay/session revocation; unauthorized/expired/tampered flow/mobile/event privacy.
They use production profile, HTTPS, trusted test CA and real Mailpit STARTTLS without disabling
backend TLS verification. All four images built; isolated image checks verified non-root API
liveness, expected unconfigured auth readiness, frontend security headers/query log privacy
and the installed Python entry point. Final documentation checks resolved 184 relative
file/heading references; Biome, generated-contract consistency and Git whitespace checks passed.

The application-container canonical discovery probe is **unavailable**, not passed: Docker
Desktop host-network routing cannot reach the WSL fixture. Browser journeys through production
Nginx succeeded with separate real API processes on the host. Actual Linux/Dokploy container
DNS/TLS, ingress/proxy policy, customer/client provisioning, persistent pilot Mailpit and a
real backup/restore drill still require target-environment execution. Disposable fixtures were
removed; preview tabs and our Vite process were closed. No real customer was onboarded,
no target deployment occurred, and no commit or remote action was performed. Existing
staged and unstaged work was preserved.

## Pending work and known gaps

These are recorded follow-ups, not active tasks or additional release commitments.

| ID         | Status      | Scope                                                                                    | Next step when authorized                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---------- | ----------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OPS-001    | Planned     | Remaining infrastructure/container validation                                            | All four application images and isolated startup checks pass. Verify broker/storage behavior, production stateful/processing services, persistence and actual Linux-container canonical issuer DNS/TLS; the Docker Desktop-to-WSL fixture probe was unavailable.                                                                                                                                                                                                                                                              |
| OPS-002    | Planned     | Dokploy deployment verification                                                          | Deploy the implemented services to the intended Linux environment and verify domains, TLS, API routing, and health checks.                                                                                                                                                                                                                                                                                                                                                                                                    |
| OPS-003    | In progress | Stable host/WSL time for reliable authentication verification                            | UM-VERIFY-02 now passes the 180-second preflight and 573-second runtime observation with no backward intervals/steps above 5 ms, plus complete integration and four browser suites. Prior enrollment failure did not recur; cause is not assigned. Windows latest resync still reports stale time data (error 2) despite leap 0/stratum 5: follow up source freshness and recheck time before cutover/after resume. No additional host setting, kernel clocksource change, WSL restart or target cutover was performed.       |
| UM-REL-001 | Planned     | Coordinated user-management installation cutover and target acceptance                   | Private bundle and complete UM-VERIFY-02 local suites now pass, including measured clock stability. Before cutover, recheck target time/source freshness and obtain separate target authorization; then follow the user-management runbook: coherent backup/rehearsal, stopped incompatible processes, credential retirement, owning migrations/import, distinct service provisioning, real first-administrator handover, exact-image startup/opening and target verification. No existing-installation cutover has occurred. |
| DMS-001    | Planned     | DMS requirement group 01: shared identity, one customer tenant, application provisioning | Owned tenant bootstrap and guarded application enrollment are implemented and fixture-tested in AUTH-02/05. Coordinate real client provisioning/enrollment and customer onboarding with the [authentication plan](docs/authentication/authentication_implementation_plan.md) and accepted [requirements](docs/dms/headless_dms_functionality_requirements_v1.md#01-shared-identity-tenant-bootstrap-and-application-provisioning); test the minimal single-tenant/client context before onboarding the real customer.         |
| AUTH-001   | Planned     | Target authentication rollout and customer provisioning                                  | AUTH-01–07 code/local verification is complete. Provision the intended installation through the tested runbook and verify canonical container DNS/TLS, actual Dokploy routing/proxy/cookies, pilot mail access and recovery/rollback evidence. No target deployment or real customer provisioning has occurred.                                                                                                                                                                                                               |
| APP-001    | Planned     | Turnstile product functionality                                                          | Agree on the business requirements before creating feature modules, screens, or schemas.                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| MIG-001    | Planned     | Source/data migration                                                                    | Identify the source application/data, scope, and migration requirements before implementation. No migration has started.                                                                                                                                                                                                                                                                                                                                                                                                      |
| MOB-001    | Deferred    | Expo/React Native application                                                            | Add the mobile client only when explicitly requested; preserve the shared backend and platform-independent contracts now.                                                                                                                                                                                                                                                                                                                                                                                                     |

Authentication contracts/OpenAPI, owned migrations, the BFF and machine enrollment are
implemented, including the typed cross-service capability request. Remaining feature contracts,
coordinator/publisher/worker execution, scanning, extraction, search, and document workflows
remain pending their respective DMS requirements. Empty modules and folders do not count
as implemented capabilities.

## Reference documents

- [Architecture](architecture.md): single technical reference for both products
- [Authentication implementation plan](docs/authentication/authentication_implementation_plan.md): source-backed proposal, execution order, and complete-chain acceptance
- [User-management specification](docs/turnstile/user-management/user_management_specification.md): accepted UM-R01–22 and D01–03 scope
- [User-management implementation plan](docs/turnstile/user-management/user_management_implementation_plan.md): UM-I01–11 delivery and acceptance gates
- [Workspace implementation plan](docs/workspace/workspace_implementation_plan.md)
- [Workspace standards](docs/standards/workspace.md)
- [DMS product blueprint](docs/dms/headless_dms_product_blueprint_v1.md)
- [Sequenced DMS functionality requirements](docs/dms/headless_dms_functionality_requirements_v1.md)
- [Dokploy runbook](docs/runbooks/dokploy.md)
- [Development commands](README.md#start-locally)
