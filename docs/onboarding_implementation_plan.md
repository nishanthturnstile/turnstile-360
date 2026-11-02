# Turnstile 360 onboarding implementation plan

**Status:** ONB-I01 baseline accepted; ONB-I02–06 backend/onboarding/Settings foundations implemented; ONB-I07 verification implemented; ONB-I08 upgrade/recovery procedures and the selected existing local release are implemented and verified. Production target acceptance remains separate. **Updated:** 2026-11-02.

**Historical v1 delivery plan:** ONB-RD01 adopts the redesigned requirement baseline in
the [current specification](onboarding_specification.md) and
[architecture](../architecture.md#onboarding-implementation-baseline). The
[separate redesign plan](onboarding_redesign_implementation_plan.md) sequences new work.
Optional structure/root-only activation and immutable parents below describe the original
v1 release; they do not override the adopted v2 first-unit/move policy. Preserve ONB-I01–08
history and evidence in this plan and IN_PROGRESS.md.

Deliver onboarding and its matching settings experience as one complete release,
built through eight reviewable work packages. An authorized administrator must be
able to configure the existing organization's name and time zone, optionally add
sites or departments, activate the workspace, and maintain those same settings
afterward. Other users must wait until activation without losing access to sign-out
and account recovery.

The [onboarding specification](onboarding_specification.md) now owns accepted ONB-R01–12
and the first-release scope. ONB-I01 adopts the root-only activation, private provisioning
and narrow administration baseline from the [design proposal](onboarding_design_proposal.md),
informed by the [Version 1 inventory](onboarding_v1_discovery.md). Exact technical contracts
and bounds are recorded in [architecture.md](../architecture.md#onboarding-implementation-baseline).
This plan sequences delivery; it does not imply authorization or completion of later
packages. Actual implementation and checks are recorded in [progress](../IN_PROGRESS.md).

## Scope of the first release

The release includes the three-step setup journey, explicit save/resume, a waiting
screen, server-enforced workspace readiness, minimal organization structure,
activation audit, private configuration-administrator provisioning, and working
Settings editors for the delivered configuration.

The organization root is automatic and stable. Sites and departments are optional;
there is no synthetic default plant. Initial types are Organization, Site and
Department, with departments permitted beneath the root, sites or other departments.
People are not hierarchy nodes. Standard Site/Department terminology is available
without asking a first-time administrator to design a taxonomy.

Keep account creation and access assignment in supported private operator tools.
Ordinary invitations, a user-management UI, custom roles, membership assignments,
bulk import, delegation, branding uploads, external SSO, risk/safety settings and
Document Approval execution are separate follow-on capabilities. No new mobile app,
public signup, tenant switcher, provisioning control plane or Version 1 data import
belongs to this release.

The resulting workspace will support configuration and the existing permitted DMS
connection check. Activation will not imply that document upload, processing or
approval is implemented. A full IAM interface is not a prerequisite for subsequent
approval development: named participants can initially be provisioned through the
existing controlled account/access tools.

## Current implementation and integration work

| Existing capability                                                                                  | Implementation consequence                                                                                                                                                                                                      |
| ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fixed installation identity in auth/DMS/product provisioning                                         | Reuse that identity. Add product configuration without replacing tenant, customer or application identity.                                                                                                                      |
| `UserSessionGuard` verifies live identity, local permissions and mutation CSRF                       | Extend the access boundary with workspace readiness; setup exemptions must preserve authentication, permissions and CSRF.                                                                                                       |
| `auth:set-access` writes local grants with the product migrator                                      | Add the configuration permission and last-local-administrator protection here; do not give runtime APIs grant-writing privileges.                                                                                               |
| `ProductDatabaseService` creates the pool/session store inside AuthModule                            | Extract the shared runtime pool into a small product persistence module, retaining auth's session store and existing readiness guarantees. Organization/setup must not create duplicate pools or cause circular module imports. |
| Product contracts currently contain interfaces and two permission names                              | Add executable validation schemas for new requests/responses, typed domain errors and documentation consistency checks. Preserve the existing auth contract.                                                                    |
| Web routing currently switches on `window.location.pathname`                                         | Add an explicit small route map and guarded application entry. Native links/full reloads are sufficient initially; a new router is not a prerequisite.                                                                          |
| Web request helper currently handles GET or empty POST and maps unknown errors to `AUTH_UNAVAILABLE` | Support the new methods/bodies and distinct setup/configuration failures without signing a valid user out for a revision conflict or validation error.                                                                          |
| PostgreSQL, Fastify and real HTTPS auth-browser fixture tooling already exist                        | Extend those harnesses. Keep dedicated incomplete-setup journeys; update unrelated auth fixtures explicitly rather than bypassing the new gate.                                                                                 |
| Shared web primitives and a development gallery exist                                                | Compose the delivered screens from existing components; extend the gallery only for new reusable patterns.                                                                                                                      |

The governing component, security and deployment decisions remain in
[architecture.md](../architecture.md). Preserve its
[single-customer model](../architecture.md#customer-deployment-and-application-model),
[product ownership](../architecture.md#backend-composition-and-data-ownership),
[BFF authorization](../architecture.md#turnstile-bff-and-user-authorization-boundary)
and [design system](../architecture.md#web-design-system).

## Delivery order

| Package | Deliverable                                                            | Depends on               | Review outcome                                                                     |
| ------- | ---------------------------------------------------------------------- | ------------------------ | ---------------------------------------------------------------------------------- |
| ONB-I01 | Implementation baseline and requirement agreement                      | ONB-001 discovery/design | Scope, validation limits, routes, permissions and upgrade behavior recorded        |
| ONB-I02 | Contracts and shared product persistence boundary                      | I01                      | Typed configuration API foundation; existing auth behavior preserved               |
| ONB-I03 | Canonical organization/setup persistence and audited domain operations | I02                      | Real PostgreSQL save, initialization, revision and activation invariants           |
| ONB-I04 | Private access provisioning and server readiness enforcement           | I03                      | Direct HTTP access is correctly gated and administrators can be provisioned safely |
| ONB-I05 | Resumable onboarding and waiting-user web experience                   | I04                      | A fresh administrator completes the real journey; an ordinary user waits           |
| ONB-I06 | Ongoing Settings and optional structure editing                        | I05                      | The same data remains editable after activation without replaying setup            |
| ONB-I07 | Complete-chain regression and operational evidence                     | I06                      | Auth, API, database and browser acceptance passes together                         |
| ONB-I08 | Existing-installation upgrade and target release handoff               | I07                      | Documented, recoverable release with target-environment evidence                   |

Packages are implementation milestones, not individual requirements or automatic
production deployments. Keep each increment buildable and tested. Ship the release
only when its backend, onboarding UI, settings and recovery paths work together;
do not deploy a blocking readiness gate ahead of a usable setup route.

## ONB-I01 Implementation baseline

The [specification](onboarding_specification.md) carries ONB-R01–12 without renumbering
DMS FR requirements. It accepts root-only activation, controlled provisioning and narrow
configuration administration. Custom Site/Department labels are deferred.

The [accepted architecture baseline](../architecture.md#onboarding-implementation-baseline)
defines field/body/name/time-zone/unit/depth bounds, routes/projections/errors, revisions,
bounded create retries, audit retention, initialization/grant/maintenance operations and
upgrade behavior. These are targets for subsequent code, not newly configured runtime
limits. The new configuration-management permission and its access prerequisite are
defined there; no Version 1 roles or broad IAM are imported. Runbooks link to those
decisions and distinguish future command contracts from commands currently available.

Acceptance: the first release can be described and tested without filling in
Document Approval policy, complete staff directories or advanced structure. The
new permission, public-versus-authenticated exemptions, error contract and upgrade
sequence are explicit. No schema is added in this package.

## ONB-I02 Contracts and persistence composition

Shared schemas in `packages/turnstile-contracts/src` now use the repository's
explicit pinned Zod dependency. Keep contracts independent
of Nest, PostgreSQL, Node-only APIs and React. Define field validation, mutation
requests, normalized responses, revisions, setup requirements and errors once.

Implement the finalized [HTTP and access contracts](../architecture.md#onboarding-http-and-access-contracts).
The status, detailed setup, completion, canonical profile and unit endpoints avoid
separate wizard copies of organization data. Status is minimal for every permitted user;
managers use the separate detailed projection. Shared schemas also implement the adopted
[validation bounds and versioned time-zone list](../architecture.md#onboarding-validation-and-bounds).

All configuration mutations carry the expected organization revision. A saved
response returns the authoritative revision and data. Setup progress is derived
from canonical configuration and completion metadata; no second set of wizard
profile fields or client-controlled “step complete” flags is stored.

Distinguish invalid input, stale revision, setup required, permission denial,
configuration unavailable and existing auth/DMS errors using the finalized architecture
envelopes/statuses and bounded field errors.
For an otherwise permitted business operation, incomplete setup should yield an
actionable conflict response, not an authentication failure. Missing route permissions
still produce the existing denial before revealing readiness details.

Generate the new feature's OpenAPI 3.1 schemas/examples from the executable contracts
and add a consistency check. Preserve the existing authentication description and
its protocol behavior. Document minimal status and separate manager-only detail projections,
CSRF headers, revision conflicts, no-store responses and repeat completion behavior.

Move runtime pool ownership into a small module under the product's own database
infrastructure. Auth continues to own encrypted sessions and their lifecycle; its
store consumes the shared pool. Organization and setup import the persistence module,
and setup consumes organization services. Register access/readiness orchestration
once at application composition, with exported auth and setup services, so AuthModule
does not need to import a feature that imports AuthModule. Avoid `forwardRef`, global
service lookup and a second database pool merely to resolve this dependency.

Acceptance: packages compile, new schemas validate representative requests and
errors, generated documentation agrees with them, and existing auth integration
checks pass after the bounded persistence refactor. Session encryption, shutdown,
pool limits and runtime-role validation remain intact.

The implemented foundation exports schemas/DTOs and the configuration permission catalog,
generates the [OpenAPI contract](api/turnstile-onboarding.openapi.json), and verifies
drift through `pnpm check:contracts`. Auth consumes the shared product pool and the existing
guard is registered once by AppModule. I03 now supplies feature modules/tables/HTTP handlers;
I04 implements the readiness gate and private configuration grants/last-manager protection.
Actual verification and remaining target-release evidence stay in [progress](../IN_PROGRESS.md).

## ONB-I03 Canonical configuration and domain operations

Generate the owning modules/controllers/providers with the installed Nest CLI when
implementation starts. Use an Organization feature for profile and units, and a small
Onboarding feature for readiness and completion. Controllers handle HTTP validation
and responses; services own rules and transactions; repositories use only product
persistence. Do not build a general settings framework or onboarding workflow engine.

Introduce only the implemented product records: organization profile/regional values,
unit relationships, setup lifecycle/revision/completion metadata and append-only
configuration audit. Exact tables/columns and reviewed migrations are produced here,
not by this plan. Keep one profile, root and setup context per installed tenant.

Provide a private, repeat-safe initialization operation after the existing fixed
installation bootstrap. It creates the empty feature setup context without completing
onboarding, making a user, or registering an application. Repeating it preserves
existing profile, units and completion. A mismatched installation is rejected.
Neither startup nor GET requests perform migrations or implicit operator bootstrap.
Implement the private inspection and bounded retention commands from the same
[operator contracts](../architecture.md#onboarding-operations-and-upgrade); maintenance
does not remove canonical configuration or durable completion metadata.

The first valid organization save creates or reuses the root in the same transaction.
Renaming the organization updates its canonical display and root presentation while
preserving identity. A time-zone suggestion becomes confirmed through explicit
profile submission; deployment location is not an authoritative default.

Serialize organization-changing operations against the same revision boundary:

1. Establish the configured tenant context and acquire the canonical configuration
   lock in a consistent order.
2. Check current local actor access and the expected revision for the mutation.
3. Validate the intended resulting profile or unit changes.
4. Commit configuration, revision and its audit entry together.

Activation follows that boundary and verifies the persisted name, confirmed zone,
root and current configuration-manager access. The live authority check remains
outside the product transaction; recheck local grants inside it and coordinate with
the private grant writer. Do not hold database locks across authority or DMS HTTP.
The current actor's verified login establishes one live administrator at completion;
no cross-schema account query is required.

Concurrent completion creates one lifecycle outcome and audit entry. A retry after
a lost response returns the existing completion metadata after current authorization,
without another activation. Revision conflicts on ordinary saves never overwrite
another administrator's work. Root/unit creation also needs repeat-safe request
identity or equivalent documented retry handling; a lost response must not create
duplicate units. Implement the [accepted receipt and reconciliation rules](../architecture.md#onboarding-consistency-and-audit)
in I02/I03; the browser never retries POST automatically.

Initial units have immutable type and parent after creation; edits rename them.
This deliberately defers move/reparent, arbitrary taxonomy, effective dates and
responsible-person assignment. Enforce supported parent/type relationships and
tenant integrity; reject forged reparent/root edits, duplicates under the agreed
sibling-name rules and deletion of a non-leaf or referenced unit. The future
membership/document features must extend reference protection when they arrive.

Use explicit grants, forced RLS, transaction-local tenant context, tenant-aware
references and the indexes needed by actual lookups. Product runtime may change
delivered business configuration and insert audit, but cannot rewrite installation
identity, grant product access, modify audit history, run DDL or read auth/DMS schemas.
Do not add blanket privileges for future tables. Audit is attributable operational
evidence, not a claim of tamper-proof regulated storage. Retention/inspection belongs
in supported operator guidance initially; a general audit UI is not required here.

Acceptance: real PostgreSQL tests demonstrate initialization/retry, one root, durable
save/resume, revision contention, repeat completion, atomic audit rollback, unit
integrity and runtime-role/RLS enforcement. Missing initialization/schema is an
operator availability problem, not evidence of a new tenant or completed setup.

The implementation uses the [canonical persistence boundary](../architecture.md#canonical-configuration-persistence)
and documented [private commands](runbooks/authentication.md#initialize-inspect-and-maintain-product-configuration).
Root display derives from the profile; all effective changes and activation share the
same revision/audit transaction. Owning HTTP adapters preserve existing auth, permissions
and CSRF, and the legacy grant writer now coordinates its lock. I04 supplies the
configuration grant/last-manager policy and business gate. Verification and remaining
release work are recorded in [progress](../IN_PROGRESS.md).

## ONB-I04 Access provisioning and backend gate

Extend the private `auth:set-access` path to accept the new permission through shared
contracts. Keep its operator credentials private and runtime grants read-only.
Protect the last enabled local configuration manager from product-controlled
disablement or permission removal, including concurrent operator commands. Use a
shared locking protocol with configuration completion; preserve ordinary non-admin
grant operations and allow the initial manager to be assigned.

This local invariant cannot prevent an external authority administrator from
suspending an account. Document operator recovery and verify the replacement
administrator's actual login before removing staff access. Do not invent an API for
looking up authority users through SQL or treat an authority `admin` role as a local
grant. A grant to an unverified identity is not successful administrator handover.

Compose the existing auth/permission guard with readiness in a single explicit
order: live identity and local access → mutation CSRF → route permissions → workspace
readiness where required. Default to requiring completed setup for protected business
routes. Explicit setup exemptions bypass only readiness. An unannotated route stays
denied; a public marker must never be added to make setup work.

Session, login/callback, logout, verification/recovery, health and development-only
gallery keep their established boundaries. Session checks remain usable to determine
identity during setup; logout retains its existing special expiry/CSRF handling.
Setup/status and core configuration APIs have explicit readiness exemptions with
the permissions in I02. Classify `/api/dms/capabilities` as a workspace operation:
it requires completion and its existing DMS permission. Activation itself does not
call DMS or depend on capability lists being nonempty.

Read current readiness on the backend; no browser value, persisted session snapshot
or positive long-lived cache can authorize an incomplete workspace. A configuration
outage produces a controlled retryable error. A DMS-domain outage after activation
does not undo completion; authority unavailability still preserves the existing
fail-closed authentication behavior.

Acceptance: real Fastify/API tests show ordinary direct calls blocked before setup,
configuration manager access to setup only with explicit rights, ordinary-user minimal
status, CSRF enforcement, last-manager contention, and successful workspace access
only after committed activation. Existing refresh/logout/local-access regressions pass.

I04 implementation uses the [application guard/private grant composition](../architecture.md#access-provisioning-and-backend-readiness).
The strict operator command and supported recovery are documented in the
[runbook](runbooks/authentication.md#provision-local-configuration-access). The default
business gate and explicit setup/session exemptions are delivered; target rollout waits
for the matching UI. Actual verification and remaining work are in [progress](../IN_PROGRESS.md).

## ONB-I05 Onboarding web journey

Add a guarded entry layer after successful session verification. Hold the neutral
loading shell until current setup status is known, preserving existing fencing of
stale session responses and logout. Route incomplete managers to the first required
gap; route other permitted users to Waiting for setup. Preserve saved progress across
reload, logout, backend restart and different administrator sessions.

Use explicit routes for Organization, optional Structure, Review, paused setup and
waiting. A small route map with native links is sufficient; do not introduce a form,
state-management or routing dependency solely for this flow. Validate safe return
paths using the existing login boundary. Unknown routes must not silently display
an apparently active workspace. Browser Back and deep links revalidate access.

Organization collects only name and confirmed time zone, with signed-in identity
shown read-only. Save and continue commits and advances; Save and exit commits
valid progress and offers Resume/Sign out. If the profile is already valid when
returning, Review is the next required step; optional Structure remains accessible
without pretending it is mandatory.

Structure defaults to the existing root and offers Set up later or simple unit
creation. Saved units remain when skipped. Review displays the actual saved profile,
scope and readiness checklist with edit links. Activate workspace uses the real API
and presents saving, validation, revision-conflict, lost-response and outage states
without claiming success early.

Extend or isolate the typed browser transport to support configuration JSON methods,
headers and domain errors while retaining existing deadlines, same-origin credentials,
CSRF and no-store behavior. Do not map every 403 to expired access or every domain
error to `AUTH_UNAVAILABLE`; refresh live session data when needed and separate
setup validation/conflicts from authentication failures. Preserve in-memory form
input for a recoverable retry. Do not store authoritative completion or sensitive
drafts in local storage.

Acceptance: a real administrator completes root-only setup and an ordinary user
waits; saved progress survives interrupted sessions; refreshing does not flash the
main workspace; denied/unavailable states remain recoverable and sign-out works.
Use the existing Base UI/shadcn controls, semantic tokens, keyboard focus and reduced
motion conventions. Verify narrow layouts and associated field/status announcements.

The I05 implementation follows the [web journey composition](../architecture.md#onboarding-web-journey)
and existing [design system](design-system.md). Current verification and review findings
are recorded in [progress](../IN_PROGRESS.md); no target rollout is implied.

## ONB-I06 Ongoing Settings and basic structure

Provide Home and one Settings destination after activation. Settings initially
contains Setup overview, Organization profile/structure and Workspace regional
defaults. Reuse the same editors, services, contracts and database records used
during setup. The root's name is maintained through the organization profile;
regional defaults update that profile's canonical time zone rather than a copied
workspace setting.

Configuration managers can create/rename supported units and remove only unused
leaves, with ancestry, revision conflict handling and explicit save/cancel. I01 keeps
standard Site/Department labels fixed; label overrides and advanced taxonomy are deferred.

Setup overview shows completion actor/time and links to current settings. Later
profile/unit edits preserve completion and required invariants. No Reset onboarding
control is needed. Add a nonblocking link to organization structure when only the
root exists. Persistent optional-task tracking, recurring reminders and a generic
setup-checklist engine are deferred; do not ship repeated administrative nags.

Do not add empty People, Approval, Risk or integration configuration pages. Preserve
the existing permission-gated document connection check after activation. Future
business routes/settings appear when delivered, and their readiness rules must
remain separate from global completion. Personal account controls stay outside
organization administration; do not advertise passkeys or preferences the current
authority/UI has not implemented.

Acceptance: changing name, zone or units in Settings is reflected on reload and in
setup overview; root identity/completion remain stable; ordinary users cannot call
configuration APIs; invalid/stale changes are rejected with recoverable UI feedback.

I06 follows the [shared Settings composition](../architecture.md#ongoing-settings-and-basic-structure).
Actual verification and requested review/fixes are recorded in [progress](../IN_PROGRESS.md).

## ONB-I07 Complete-chain verification

Add focused tests where the failure risk crosses a boundary. Reuse existing harnesses
and avoid a separate parallel auth implementation for onboarding fixtures.

| Boundary                       | Required evidence                                                                                                                                                               |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fresh provisioning             | Explicit migration, fixed bootstrap, setup initialization, verified account and local grant; second-tenant/mismatch rejection remains intact                                    |
| Database integrity             | Repeat initialization/root creation; supported units; absent/wrong tenant context; runtime privileges; save/activation audit rollback; real contention                          |
| Authorization                  | Authority admin without local configuration permission denied; early ordinary user waits; direct business API blocked; exempt setup still enforces CSRF and permissions         |
| Lost responses and concurrency | Stale profile/unit write cannot overwrite; create retry cannot duplicate units; two activations yield one completion; grant removal cannot race the last-manager check          |
| Browser journey                | Minimal root-only and optional-structure paths, save/exit/resume, return after logout/restart, waiting → available after another admin completes, deep link and back navigation |
| Failure recovery               | Configuration versus auth failure distinguished; permission revocation respected; DMS failure does not reset completed setup; unsaved edits never labeled Saved                 |
| Existing auth                  | Refresh overlap, session generation, recovery/reset, access denial and complete/partial logout continue passing                                                                 |
| Settings                       | Canonical values shared with onboarding; rename preserves identity; required values cannot be cleared; completion is not replayed                                               |

Extend `scripts/test-auth-database.mjs`, the product database/Fastify tests and the
real HTTPS browser harness as needed. For unrelated auth cases that expect an active
workspace, explicitly initialize and complete fixture setup through supported
operations. Keep dedicated incomplete fixtures so the suite does not seed every
organization completed and accidentally skip gate verification.

Run `pnpm check`, `pnpm build`, `pnpm test`, `pnpm test:integration` and the applicable
real auth/onboarding browser journeys. Validate generated contract consistency,
production images and non-root runtime behavior for changed applications. Run local
services through Compose Watch at the reserved ports in architecture.md, preserving
existing installation data and credentials. A browser fixture is not evidence of a
customer deployment; record unavailable Docker/runtime checks separately.

Acceptance: required suites, meaningful browser journeys and local image/runtime
checks pass on the final release candidate. Record exact commands, fresh versus
cached results, limitations and handoff in IN_PROGRESS.md rather than copying
historical test counts into the release claim.

The implemented verification composition is described in
[architecture.md](../architecture.md#engineering-and-verification-architecture).
Run the existing full auth browser journey and `pnpm test:browser:onboarding:structured`
for a separate fresh optional-structure installation. Use production Nginx image mode
for both and `pnpm test:images:onboarding <api-tag> <web-tag>` for isolated packaging/
non-root checks; commands are in the [runbook](runbooks/authentication.md#browser-operation-and-release-verification).
Actual I07 evidence and remaining target-release work are recorded in [progress](../IN_PROGRESS.md).

## ONB-I08 Upgrade and release

Update the authentication/deployment runbooks with the exact supported initialization,
configuration grant, verification, customer handover and recovery commands. Keep
migrator credentials out of persistent containers and browser configuration. No new
ingress service or local host port is needed.

For an existing installation, use this release sequence:

1. Preserve a coherent backup and the current installation/client identities;
   confirm target release and schema compatibility before changing the environment.
2. Pause affected product access during the coordinated API/web change. Prepare
   and apply the reviewed additive product migrations through the owning migrator.
3. Initialize empty setup once for the existing tenant. Preserve all accounts,
   sessions, access assignments, machine enrollment and unrelated data. Do not infer
   completion from an existing login, application-registration state or row count.
4. Assign the new local permission to the intended verified administrator using
   the updated private command. Preserve unrelated permissions. Have a named
   operator recovery path; no universal bootstrap account or bypass flag.
5. Release the compatible backend and frontend together. Verify that the manager
   reaches setup, an early ordinary user waits, saves survive restart, and activation
   opens the workspace. Confirm Settings and the existing permitted integration check.
6. Verify the customer administrator's real access before removing unnecessary staff
   grants. Record completion and operational evidence without passwords or tokens.

A fresh installation follows existing platform provisioning → fixed tenant bootstrap
→ product setup initialization and administrator provisioning → first login/onboarding.
Account/OAuth provisioning and DMS machine enrollment remain independent operations.

If a release step fails, keep the application in a controlled maintenance/retry state;
do not temporarily treat everyone as configured. Rolling back only the API to a
version without the gate may reopen an incomplete workspace, so require a coordinated
compatible rollback or continued maintenance. Preserve committed configuration;
destructive down-migrations and live data restoration are separate operator actions
with an explicit recovery decision. Document what the release can and cannot roll back.

Acceptance: target DNS/TLS, cookies, canonical identity connectivity, production
database privileges, save/resume and administrator handover are verified on the
intended deployment. Local success alone completes development verification, not
this target-release milestone. External mail delivery is verified if the handover
uses external recipients; Mailpit capture is not evidence of that delivery.

## Requirement traceability and ownership

ONB-R requirements are defined in the accepted [specification](onboarding_specification.md#product-requirements).
This mapping assigns implementation and evidence responsibility rather than duplicating
requirement definitions.

| Accepted requirement                           | Main packages                                 |
| ---------------------------------------------- | --------------------------------------------- |
| ONB-R01 fixed customer                         | I01, I03, I04, I08                            |
| ONB-R02 explicit setup authority               | I02, I04, I07                                 |
| ONB-R03 minimum activation                     | I03, I05, I07                                 |
| ONB-R04 durable shared progress                | I03, I05, I07                                 |
| ONB-R05 backend gate and waiting               | I04, I05, I07                                 |
| ONB-R06 revisions and audited completion       | I02, I03, I07                                 |
| ONB-R07 canonical ongoing settings             | I03, I05, I06                                 |
| ONB-R08 separate feature readiness             | I01, I04, I06; module-specific follow-on work |
| ONB-R09 ownership and secrets                  | I02, I03, I04, I08                            |
| ONB-R10 accessible recovery                    | I05, I06, I07                                 |
| ONB-R11 core invariants and last administrator | I03, I04, I06, I07                            |
| ONB-R12 stable completion on optional changes  | I03, I06, I08                                 |

Backend/contract work belongs in `turnstile-api` and `turnstile-contracts`; UI work
belongs in `turnstile-web`. Auth integration changes preserve the existing trust
boundary. The DMS needs no Turnstile organization tables, business approval policy
or new tenant registration for this release. Use `workspace:*` for internal packages,
the pinned toolchain and installed generators; preserve Nest value imports for
injected classes and use Fastify-compatible integrations.

## Subsequent capabilities

After the first release, prioritize capabilities against the next real workflow:

- People/access administration and controlled invitations, if operator tooling is
  insufficient for day-to-day onboarding. Add scoped memberships and enforce the
  existing last-administrator boundary through every new mutation path.
- Document Approval requirements, roles/states/routing and feature setup, together
  with the applicable DMS contract/audit/registry/admission/upload/security/retrieval
  foundations. No onboarding completion flag can substitute for these capabilities.
- Import, delegation, advanced organization types/dates, branding, SSO or safety
  configuration only when separately requested and specified.

ONB-I08 executable upgrade/recovery commands are in the [release runbook](runbooks/onboarding-release.md); actual selected-local and production acceptance status is tracked in IN_PROGRESS.md.
No need to repeat
Version 1 discovery or build all of its settings before delivering this release.
