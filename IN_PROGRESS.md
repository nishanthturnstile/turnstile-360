# Project progress

Last updated: 2026-11-01

This is the shared implementation status and handoff record for Turnstile 360 and the
Thaarei DMS. All agents must read it before starting work and update it as work progresses.
Technical design is maintained in [architecture.md](architecture.md); product scope and
requirements remain in their linked specifications. This file records what has actually
been completed, verified, or left pending.

## Current position

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
The owner-prioritized onboarding discovery and design proposal is complete for review;
see [the proposal](docs/onboarding_design_proposal.md) and its Version 1 inventory.
The [implementation plan](docs/onboarding_implementation_plan.md) now defines eight
proposed delivery packages with acceptance, verification and upgrade sequencing.
Onboarding and Document Approval implementation remain pending product agreement.
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

ONB-PLAN-001 planning is completed (owner: Codex, 2026-11-01): audited current
auth/provider composition, private access grants, runtime privileges, shared contracts,
web route/request handling and test harness. Created the
[onboarding implementation plan](docs/onboarding_implementation_plan.md) with ONB-I01–08:
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
[inventory](docs/onboarding_v1_discovery.md) records functionality, overlaps and evidence
limits. The [proposal](docs/onboarding_design_proposal.md) covers configuration
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
account/API access. docs/design-system.md provides one designer/developer handoff and
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
| AUTH-PLAN-001 | 2026-10-31 | Codex audited absent auth implementation, researched official stable Better Auth/OAuth/Fastify/PostgreSQL/BFF guidance, recorded email/password-first decision and proposed the complete web/user/machine chain with seven work packages and acceptance tests | [Authentication plan](docs/authentication_implementation_plan.md), [architecture proposal](architecture.md#authentication-chain-implementation-proposal), blueprint v1.7, requirements v1.4; planning only, no auth/customer provisioning performed                                                                                                                              |
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

| ID       | Status   | Scope                                                                                    | Next step when authorized                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------- | -------- | ---------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OPS-001  | Planned  | Remaining infrastructure/container validation                                            | All four application images and isolated startup checks pass. Verify broker/storage behavior, production stateful/processing services, persistence and actual Linux-container canonical issuer DNS/TLS; the Docker Desktop-to-WSL fixture probe was unavailable.                                                                                                                                                                                                                                   |
| OPS-002  | Planned  | Dokploy deployment verification                                                          | Deploy the implemented services to the intended Linux environment and verify domains, TLS, API routing, and health checks.                                                                                                                                                                                                                                                                                                                                                                         |
| DMS-001  | Planned  | DMS requirement group 01: shared identity, one customer tenant, application provisioning | Owned tenant bootstrap and guarded application enrollment are implemented and fixture-tested in AUTH-02/05. Coordinate real client provisioning/enrollment and customer onboarding with the [authentication plan](docs/authentication_implementation_plan.md) and accepted [requirements](docs/headless_dms_functionality_requirements_v1.md#01-shared-identity-tenant-bootstrap-and-application-provisioning); test the minimal single-tenant/client context before onboarding the real customer. |
| AUTH-001 | Planned  | Target authentication rollout and customer provisioning                                  | AUTH-01–07 code/local verification is complete. Provision the intended installation through the tested runbook and verify canonical container DNS/TLS, actual Dokploy routing/proxy/cookies, pilot mail access and recovery/rollback evidence. No target deployment or real customer provisioning has occurred.                                                                                                                                                                                    |
| APP-001  | Planned  | Turnstile product functionality                                                          | Agree on the business requirements before creating feature modules, screens, or schemas.                                                                                                                                                                                                                                                                                                                                                                                                           |
| MIG-001  | Planned  | Source/data migration                                                                    | Identify the source application/data, scope, and migration requirements before implementation. No migration has started.                                                                                                                                                                                                                                                                                                                                                                           |
| MOB-001  | Deferred | Expo/React Native application                                                            | Add the mobile client only when explicitly requested; preserve the shared backend and platform-independent contracts now.                                                                                                                                                                                                                                                                                                                                                                          |

Authentication contracts/OpenAPI, owned migrations, the BFF and machine enrollment are
implemented, including the typed cross-service capability request. Remaining feature contracts,
coordinator/publisher/worker execution, scanning, extraction, search, and document workflows
remain pending their respective DMS requirements. Empty modules and folders do not count
as implemented capabilities.

## Reference documents

- [Architecture](architecture.md): single technical reference for both products
- [Authentication implementation plan](docs/authentication_implementation_plan.md): source-backed proposal, execution order, and complete-chain acceptance
- [Workspace implementation plan](docs/workspace_implementation_plan.md)
- [Workspace standards](docs/standards/workspace.md)
- [DMS product blueprint](docs/headless_dms_product_blueprint_v1.md)
- [Sequenced DMS functionality requirements](docs/headless_dms_functionality_requirements_v1.md)
- [Dokploy runbook](docs/runbooks/dokploy.md)
- [Development commands](README.md#start-locally)
