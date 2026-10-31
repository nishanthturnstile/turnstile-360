# Project progress

Last updated: 2026-10-31

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
Only disposable fixture provisioning was performed; no real customer was onboarded.
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

AUTH-FIX-001 implementation and local verification are complete (owner: Codex).
Protected requests overlapping an in-progress or committed refresh now return retryable
503 while logout and idle/absolute expiry retain their 401 fences. The final session
check, real-HTTP/PostgreSQL regression coverage, and architecture reference are updated.
The owner explicitly authorized publication to the configured public GitHub repository
on 2026-10-31. Next action: push `fix/auth-refresh-session-race`, open the PR targeting
`main`, and inspect CI. Local verification is complete; remote CI remains pending.
AUTH-07 code and its earlier local verification are complete.
Real customer/client provisioning, target Mailpit deployment and Dokploy ingress/container
DNS/TLS verification remain pending; local evidence does not establish deployed readiness.

| ID      | Status    | Owner | Scope / requirement                                 | Next action                                    | Verification / remaining work                                                                                                                                                                                                         | Updated    |
| ------- | --------- | ----- | --------------------------------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| AUTH-05 | Completed | Codex | DMS machine authorization and guarded enrollment    | Handoff recorded below                         | Required workspace checks, 40 API unit cases, 61 integration cases, role/DDL matrix, compiled smoke and contract consistency passed; fixture provisioning only                                                                        | 2026-10-31 |
| AUTH-06 | Completed | Codex | Typed machine client and real cross-service request | Handoff recorded below                         | Required workspace checks, 43 API unit cases, 63 integration cases, role/DDL matrix, compiled smoke and generated-contract consistency passed; fixture provisioning only                                                              | 2026-10-31 |
| AUTH-07 | Completed | Codex | Login/recovery UI and operational verification      | Handoff recorded below; target rollout pending | Required checks, 43 API unit cases, 63 integration cases, three production-profile HTTPS/STARTTLS browser journeys, four image builds and isolated runtime checks passed; canonical-container probe unavailable on Docker Desktop/WSL | 2026-10-31 |

## Completed milestones

| ID            | Completed  | Result                                                                                                                                                                                                                                                        | Evidence                                                                                                                                                                                                                                                                                                                                                                         |
| ------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
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

AUTH-FIX-001 local verification (2026-10-31, Codex): both new overlap regressions failed
against the original code with 401 instead of 503, then passed after the fix.
`pnpm check`, `pnpm build`, `pnpm test` (43 API cases plus the Python entry point),
`pnpm test:integration` (13 Fastify plus 52 PostgreSQL cases, 65 total, including role/DDL
isolation), `pnpm test:smoke`, and Git whitespace checks passed. Unchanged tasks used
Turbo cache; affected product type checking, build, unit tests and integration tests ran.
No new image builds, deployed checks or real customer provisioning were performed.
Publication is now owner-authorized; GitHub CI remains unverified until the PR runs.

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
| Remote CI / Dokploy deployment and routing      | Workflow/configuration added; execution not verified                                                                                                                                                                |

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
