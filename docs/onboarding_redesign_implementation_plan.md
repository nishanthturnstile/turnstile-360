# Turnstile 360 onboarding redesign implementation plan

**Date:** 2026-11-02. **Status:** Implementation plan ready; no delivery package
below is implemented by this document. **Owner:** Thaarei.

Deliver the owner's requested onboarding redesign through the packages below. Keep this
plan separate from the [original v1 implementation plan](onboarding_implementation_plan.md),
whose ONB-I01–08 history remains intact. Package IDs here are delivery milestones, not new
product requirement IDs. Actual ownership, completion, verification and blockers belong
in [IN_PROGRESS.md](../IN_PROGRESS.md).

## Read first and document ownership

- [Dated redesign decisions](onboarding_design_proposal.md#redesign-recommendation-2026-11-02)
  and [interactive concept](presentations/onboarding-redesign-concept.html): intended
  experience and rationale. The concept is illustrative, with no production persistence
  or drag/move implementation.
- [Onboarding specification](onboarding_specification.md): accepted product requirements.
  RD01 updates this baseline for the redesign; do not treat its current optional-structure
  acceptance journey as the new target.
- [Architecture](../architecture.md#onboarding-implementation-baseline): authoritative
  technical boundaries, contracts, limits, persistence and deployment. Record adopted
  redesign decisions there during RD01; this plan identifies delivery work rather than
  creating a second architecture reference.
- [Design-system guide](design-system.md), root/app AGENTS.md, and
  [workspace standards](standards/workspace.md): implementation conventions.
- [Release runbook](runbooks/onboarding-release.md): backup, existing-installation
  preparation, verification and recovery. Extend it for the redesign instead of
  repeating the original installation release on an already completed customer.

## Intended result and scope

An authorized administrator signs in to a prepared customer installation and sees a
dedicated **Organization → First unit → Review** setup experience. The dashboard and
application sidebar appear only after the backend confirms completion. Other permitted
users wait until setup is complete; accounts without product access remain denied.

Collect organization name, explicitly confirmed organization time zone, first-unit type
and first-unit name. The owner confirmed that either **Site/Plant or Department** is
valid. The first unit must be a direct child of the stable organization root. Deeper units
are optional. Infer parents from context rather than asking for a numeric hierarchy level.
Show account identity and saved summaries as read-only context.

Use one organization identity and one installed Turnstile environment. Do not ask for a
separate workspace name. This is authenticated product setup, not public account/tenant
registration. Existing migrations, installation identity, verified account, product access
and explicit configuration-management permission are prerequisites.

The release also includes a visual structure editor shared by onboarding and Settings,
safe drag-to-move with a Move to… alternative, and the completed application's collapsible
left navigation. Preserve the existing delivered Home/Settings destinations and permitted
DMS connection check. New business modules, employee nodes, invitations, IAM screens,
RACI/approval policy, advanced unit types, custom level labels, branding, arbitrary sibling
ordering, Version 1 source/data migration and a mobile application are outside this plan.

## Implementation defaults

The first-unit choice is owner confirmed. The following are the recommended implementation
defaults from the design discussion; record them in the specification/architecture in RD01
before writing feature code. They need no additional discovery of the old source app.

| Decision                        | Implementation direction                                                                                                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| India time zone                 | Suggest Indian Standard Time · Kolkata · UTC+05:30 only when there is no saved zone. An explicit save confirms it. Preserve saved UTC and every other supported selection.                                    |
| Timestamp meaning               | Keep event/audit instants in UTC and date-only business values as dates. The organization zone supplies business-day/display defaults; no historical timestamp rewriting.                                     |
| Kolkata compatibility           | Add Asia/Kolkata to the generated shared allowlist with documented provenance while retaining Asia/Calcutta. Preserve stored identifiers; do not silently normalize or bulk-rewrite them.                     |
| Setup policy                    | Use requirement version 2 for newly initialized and upgraded incomplete configurations. Version 2 requires a saved direct-child Site or Department before completion.                                         |
| Already completed installations | Preserve their requirement version, revision, completion actor/time, identity, units and saved zone. Root-only v1 completion stays valid; offer a non-blocking structure prompt.                              |
| Deleting the first unit         | In incomplete v2 setup, removing the last unused unit returns readiness to First unit. In completed v2 setup, reject removing the last qualifying unit. Completed v1 retains its legacy optional-unit policy. |
| Routes                          | Retain /onboarding/organization, /onboarding/structure, /onboarding/review and /onboarding/paused. Label the structure step First unit without breaking existing links. Keep / as the dashboard destination.  |
| Structure semantics             | Keep current Site/Department types and permitted relationships. A move changes parent, not identity/type, user grants, sibling sort order or stored canvas coordinates.                                       |
| Delivery                        | Release compatible migrations, API and web together after the entire journey works. Package completion is not permission to activate an incomplete release on the existing installation.                      |

## Existing foundations to retain

| Current implementation                                                                 | Consequence for this work                                                                                             |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| App.tsx loads session/readiness before business content; the API enforces readiness.   | Refactor layout selection around this boundary; do not replace it with browser-only completion or a second auth flow. |
| OrganizationService/Repository own canonical configuration, revision and transactions. | Extend them for v2 and moves; do not introduce another setup store or database pool.                                  |
| Setup contracts have a version-1 literal, four-item tuple and no structure nextStep.   | Update executable validation and snapshot cross-field invariants, not just labels or TypeScript interfaces.           |
| Database version constraint and update trigger fix requirement_version at 1.           | A reviewed owning migration is necessary for v2; runtime must not receive permission to change requirement versions.  |
| Unit parents are immutable in a trigger; runtime can update name/name_key only.        | Moves require database privilege/trigger changes as well as service/controller code.                                  |
| Configuration HTTP protection uses explicit route classification.                      | Add the move route to body/media/response-limit and no-store handling; preserve auth, CSRF and manage permission.     |
| React Router, NavigationGuard, ScrollRegion and loading compositions already exist.    | Preserve client navigation, dirty-form protection, revision fencing, localized skeletons and independent scrolling.   |
| Existing PostgreSQL, Fastify, HTTPS-browser and image harnesses cover onboarding.      | Extend these fixtures and targeted regressions instead of building another provisioning/test framework.               |

## Delivery sequence

| Package  | Outcome                                                             | Dependencies                              |
| -------- | ------------------------------------------------------------------- | ----------------------------------------- |
| ONB-RD01 | Adopt redesign requirements and technical decisions                 | This plan and the dated design discussion |
| ONB-RD02 | Versioned executable contracts and India time-zone compatibility    | RD01                                      |
| ONB-RD03 | Persistence upgrade, first-unit readiness and completion invariants | RD02                                      |
| ONB-RD04 | Audited transactional unit-move API                                 | RD03                                      |
| ONB-RD05 | Dedicated resumable onboarding and waiting layouts                  | RD03                                      |
| ONB-RD06 | Shared visual editor with contextual CRUD and accessible moves      | RD04, RD05                                |
| ONB-RD07 | Completed dashboard/sidebar and ongoing Settings integration        | RD05, RD06                                |
| ONB-RD08 | Complete-chain verification, upgrade rehearsal and release handoff  | RD01–07                                   |

Keep increments buildable and testable with disposable fixtures. RD04 and RD05 can be
implemented independently after RD03 if work is explicitly divided, but their release is
coordinated. Do not add planned packages as completed work or start other feature scopes.

## ONB-RD01 Adopt the redesign baseline

Update `docs/onboarding_specification.md` for required first units, version-aware legacy
completion, the new resume order, accessible moves and the dedicated/completed layouts.
Review ONB-R03/04/06/07/10/11/12 and affected acceptance journeys. Preserve stable IDs;
define any additional move-specific requirement IDs in that specification only.

Update `architecture.md` with the adopted setup projections, versioned policy, time-zone
generation, proposed move operation, ownership/locking, migration/upgrade behavior and
layout/scroll responsibilities. Retain the existing configured limits unless a real
implementation requirement justifies changing one. Mark the prior proposal as historical
rationale where its optional-unit recommendation differs. Link this delivery plan from
the relevant documents without replacing ONB-I01–08 history.

Exit criteria: implementation has one consistent target. The spec explains legacy v1
completion, incomplete upgrades, direct-child qualification, deletion policy and the
difference between confirmed product decisions and implementation evidence. No schema or
runtime behavior changes belong to RD01.

## ONB-RD02 Executable contracts and time zones

Primary files: `packages/turnstile-contracts/src/onboarding.ts`, its exports/tests,
`scripts/generate-turnstile-time-zones.mjs`, generated `src/time-zones.ts`,
`scripts/generate-turnstile-onboarding-openapi.mjs` and `docs/api/turnstile-onboarding.openapi.json`.

1. Model v1/v2 setup and completion explicitly. A completed v1 projection must remain
   valid without first_unit. Add the required first_unit check for v2 and the structure
   nextStep. Preserve the minimal ordinary-user workspace-status projection.
2. Validate setup/snapshot agreement, including qualifying direct-child units. Update
   the current refinement that assumes the first three checks alone determine Review.
   Do not force legacy completion through a v2 requirement tuple.
3. Add Kolkata without dropping Calcutta/UTC or relaxing validation to arbitrary offsets
   and unknown aliases. Distinguish time-zone-list provenance from setup requirement
   version; regenerate with the pinned Node runtime.
4. Define a strict move request with expectedRevision and parentId, a canonical snapshot
   response, and finite errors for invalid relationships, missing units, stale revision,
   name conflict and required-unit removal. Keep payloads platform independent.
5. Document the proposed `PATCH /api/organization/units/:id/parent` route, then use that
   same adopted route throughout API, web, classification, generated docs and tests.

Exit criteria: focused contract tests prove legacy completed snapshots, v2 missing/saved
first units, nextStep consistency, both India identifiers and strict move payloads.
Generated documentation and allowlist drift checks pass. Old strict browser contracts
must not be assumed to understand v2: deployment requires the compatible web bundle.

## ONB-RD03 Persistence and required first-unit readiness

Primary files: organization schema/repository/service and private configuration operator,
`apps/turnstile-api/src/modules/onboarding`, the owning migration runner/journal,
`apps/turnstile-api/database/migrations`, and configuration PostgreSQL/Fastify fixtures.

Generate the schema change with the installed tooling and review the required custom
guard/grant migration. Allocate the next available migration IDs when implementing;
never edit or reuse applied 0004–0006 migrations. No migration is created by this plan.

Allow the supported policy versions and default new setup initialization to v2. During
the coordinated upgrade, convert only incomplete v1 configurations to v2 through the
owning migrator, preserving saved profile/units and business revision. An empty revision-0
context remains not_started. This is a requirement-metadata upgrade, not a customer save;
keep runtime version updates forbidden and specify the controlled migrator-only guard
path in architecture. Completed configurations are not converted or reactivated.

Return Organization while required profile data is missing, Structure while v2 lacks a
qualifying direct child, otherwise Review. Derive readiness from canonical records.
Validate the first-unit requirement inside the existing locked completion transaction,
with the current actor's live configuration permission. Keep completion repeat safe and
audit atomic. Update private inspection and initialization to understand both versions.

Protect completed v2 from deletion of its last qualifying unit. Before completion a
permitted deletion may return setup to Structure. Retain unused-leaf/reference checks;
do not introduce recursive deletion. Preserve forced RLS, fixed installation integrity,
runtime/migrator separation and the shared configuration/access lock order.

Exit criteria: real PostgreSQL tests cover fresh v2, upgrade of empty/partial v1,
preserved completed v1 and saved zones, repeat initialization, activation with either
unit type, direct root-only activation rejection, last-unit deletion, and contending
activation/delete/grant writes. Missing persistence remains an availability fault.

## ONB-RD04 Safe unit-move operation

Primary files: OrganizationController/Service/Repository, organization persistence guards,
configuration audit schema, `src/infrastructure/configuration-http.ts`, shared contracts
and existing configuration HTTP/database tests.

Implement the adopted parent-change route with the same product access, live manage
permission, CSRF, tenant binding and configuration HTTP protections as other mutations.
Do not accept tenant/actor selectors or reuse the rename endpoint ambiguously.

Acquire the existing configuration lock before reading/checking the move and updating
the parent. Check expected revision, source/destination existence and type rules, root
immutability, self/descendant cycles, the depth of the entire moved subtree, duplicate
sibling names and currently implemented references. Preserve stable IDs/types, descendant
relationships and completion. Derive updated ancestry from canonical parent references.

Grant only the additional parent-column update needed by runtime. Replace the immutable
parent guard with validated moves while retaining immutable tenant/ID/type and root
protections. Extend the finite audit action constraint and write an attributable move
event plus one revision increment atomically. Same-parent requests at the current
revision are no-ops. Do not disable RLS, use SECURITY DEFINER or add a new privileged pool.

For a lost response, read the latest snapshot and compare the current parent before an
explicit retry. No automatic write replay or duplicate success audit. A stale retry is a
recoverable conflict; canonical destination readback can establish the current outcome.

Exit criteria: integration evidence proves valid subtree movement, updated descendant
ancestry, rollback on audit failure, cycle/depth/name rejection, live permission removal,
tenant/reference protection, no-op behavior and contention. HTTP tests cover route
classification, media/body limits, response headers and permission/CSRF rejection.

## ONB-RD05 Dedicated onboarding and waiting layouts

Primary files: `apps/turnstile-web/src/App.tsx`, existing navigation/scroll/loading
compositions, `features/onboarding/OnboardingJourney.tsx`, configuration routes/API/shared
hooks and organization forms; add a focused setup layout composition as needed.

Separate verified session/readiness orchestration from layout selection. Incomplete
managers use the dedicated setup layout; ordinary users use the waiting experience;
completed users use the application layout. Do not mount dashboard/sidebar/Settings
content while initial status is unresolved. Preserve Sign out and the current auth flow.

Implement Organization with the shared name validation and India suggestion, First unit
with implicit root parent and a required real unit, and Review with Edit actions plus
Finish setup. Keep read-only metadata contextual and internal permission/root checks
off the customer checklist. Enable completion only from a fresh saved ready snapshot;
the server remains authoritative. Do not replace saved values with unsent suggestions.

Extend resumePath and route guards for structure nextStep, including direct review URLs,
Back/Forward, save/exit, restart/relogin and waiting-user transitions. Keep draft/error
recovery, exact create retry receipts, shared dirty-editor blocking, revision fencing,
localized loading and reduced motion. Use transient browser state only.

Exit criteria: fresh Site and Department journeys work; root-only setup cannot bypass
First unit; partial profile and unit saves resume correctly. No business-layout flash,
redirect loop, duplicate root/create or unsaved-data loss occurs. Distinguish unavailable
configuration from expired identity and from a DMS feature outage.

## ONB-RD06 Shared visual structure editor

Primary files: `features/configuration/ConfigurationEditors.tsx`, `UnitEditor.tsx`, typed
API helpers and new focused editor compositions, shared tokens/primitives, design gallery,
`docs/design-system.md` and browser fixtures.

Replace the flat administrative list with connected, expandable cards and a compact
outline mode. Add contextual Add first unit/Add below, inline rename with Save/Cancel,
selected-node details, search with ancestry and explicit unused-leaf removal. Root naming
continues to derive from the organization profile. Default the first parent to the root;
offer only valid child types for subsequent additions.

Implement Move to… first against RD04, then pointer/touch drag using the same command,
destination validation, old/new-path preview and confirmation. Highlight valid drop
targets, support cancelling a gesture, and keep click/tap and keyboard operation complete.
Search must preserve ancestor context; dragging while filtered must not imply reordering
unrelated or hidden nodes. Do not implement sibling sorting or persist card coordinates.

On failure, restore the canonical tree, retain the intended destination for explicit
reconciliation and announce the outcome. Do not label a move Saved before confirmation.
Retain name/depth/unit limits and bounded reads from architecture. Avoid introducing a
heavy diagram editor just for card layout. If an interaction dependency is required,
check current compatibility/licensing and document the chosen boundary before adding it.

Use the existing shadcn/Base UI preset, Hugeicons, fonts and semantic tokens. Read current
component docs through the pinned CLI before composition; generate missing primitives
with that CLI and review adaptations. Add gallery examples for empty, populated, loading,
selected, invalid-move, conflict and narrow-screen states. Respect reduced motion.

Exit criteria: one editor serves onboarding and Settings; valid/invalid moves behave
consistently by drag and Move to…; touch/keyboard users can add/edit/move without precision
dragging. Duplicate names under different parents remain distinguishable.

## ONB-RD07 Dashboard layout and ongoing Settings

Primary files: `App.tsx`, `components/workspace-layout.tsx`, navigation/scroll primitives,
`features/settings/Settings.tsx`, shared CSS/tokens and the design gallery.

Add persistent collapsible left navigation after confirmed completion. Use the design
proposal's desktop width guidance, a compact icon rail with accessible names/tooltips,
and accessible overlay navigation on narrow screens. Keep collapse preference transient
unless persisting it is explicitly added to the architecture; store no account/configuration
data in browser storage. Keep focus/expanded state correct and close overlays on navigation.

Retain router links, active destinations, independent content/navigation scrolling,
content-only loading and unsaved-edit protection. Avoid keying the whole layout by URL.
Keep nested Settings navigation compact so two wide sidebars do not consume the page.
Reuse canonical profile/time-zone/structure operations; do not create a second data model.

Start the dashboard with real available actions and honest empty states. Show a small
optional first-unit prompt only for completed legacy organizations that have none.
Do not display fictitious business metrics or inactive module links. Later edits must
preserve activation and follow their version-specific required-unit protection.

Exit criteria: completed onboarding opens the dashboard once after server success;
legacy root-only completion still opens it directly. Home/Settings links preserve the
layout, scrolling, forms and permission restrictions across desktop and narrow widths.

## ONB-RD08 Verification and coordinated release

Extend existing tests only for critical behavior, boundary failures and meaningful
regressions. Do not create implementation-mirroring tests for cosmetic details.

| Boundary             | Required release evidence                                                                                                                                                                             |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contracts            | v1/v2 projections, first-unit/nextStep agreement, Kolkata/Calcutta support, strict move schemas and generated-document drift.                                                                         |
| PostgreSQL           | Empty/partial/completed upgrade cases, tenant/runtime isolation, first-unit completion/deletion, subtree integrity, audit rollback and relevant contention.                                           |
| Fastify              | Direct activation/business-route gating, route permissions/CSRF, move classification/limits, stale revisions and safe errors.                                                                         |
| Browser              | Fresh Site and Department setup, resume/waiting/deep links, no layout flash, canonical Settings, conflict/lost-response recovery, drag and click/keyboard movement, responsive sidebar and scrolling. |
| Authentication       | Existing recovery, refresh overlap, revocation and full/partial logout journeys continue passing.                                                                                                     |
| Images/local runtime | Compatible API/web images, migration packaging, non-root runtime and the existing Compose Watch/reserved-port topology.                                                                               |
| Upgrade/target       | Disposable restore rehearsal preserves identities, accounts, sessions, grants, enrollment, saved zones and completed setup. Actual target evidence is recorded separately.                            |

Run the workspace-required commands on the final candidate:

```sh
pnpm check
pnpm build
pnpm test
pnpm test:integration
pnpm test:browser:auth
pnpm test:browser:onboarding:structured
```

Adapt the structured-browser fixture for the required-first-unit journeys; add a fresh
Department path while retaining a deliberately completed legacy root-only fixture.
Update the existing local-release verifier's headings/actions and first-unit handling.
Do not reset the persistent local installation to manufacture a fresh setup journey.
Use `pnpm test:images:onboarding <api-image-tag> <web-image-tag>` after building the real
candidate images through the documented monorepo-root contexts.

Extend `scripts/rehearse-local-onboarding-upgrade.mjs`,
`scripts/verify-local-onboarding-release.mjs` and the release runbook for these upgrade
cases. Back up and pause affected writers before the selected target's migration. Ship
the compatible API/web together, confirm preserved legacy completion and verify fresh
v2 in an isolated installation. Check the intended customer administrator's actual access.

The parent-column privilege and guard changes affect rollback compatibility. Document
which prior API understands the upgraded schema/policy; never assume reverting only web
or only API is safe. Keep maintenance active and fix forward or use a reviewed compatible
rollback. Database restoration remains a separate explicit operator action. Do not
re-bootstrap tenants/accounts, overwrite credentials, invent a unit, reset completion or
silently change a saved zone during release.

Exit criteria: final required suites and relevant browser/image checks pass, the upgrade
is rehearsed, and current handoff lists real evidence and limitations. Unavailable Docker,
runtime or target checks are reported separately from static successes. Local fixtures
do not establish production DNS/TLS, customer rollout or external email delivery.

## Starting implementation

Start with **ONB-RD01**, then follow the dependency table. Before editing, read the latest
IN_PROGRESS.md, AGENTS.md and architecture, inspect the worktree and record the active
package and owner. Preserve all existing local changes, root LICENSE and third-party
notices. Use pnpm 12.16.1, Node 24.21.0 and the repository's pinned Python/uv versions.

Apply the NestJS skill for backend work, PostgreSQL skill before schema/migration/SQL
changes, OpenAPI skill for API documentation, and shadcn/design skills for presentation.
Use installed generators where applicable. Keep Nest injected-class value imports,
Fastify integrations, platform-independent contracts and authenticated HTTP application
boundaries. No cross-application source/database imports or browser service credentials.

The implementation handoff can be stated as:

> Implement the onboarding redesign using this plan, starting with ONB-RD01. Require a
> saved Site/Plant or Department directly below the organization before fresh v2 setup
> completes; preserve completed v1 installations and saved time zones. Deliver dedicated
> setup, the shared visual editor with safe accessible moves, and the completed dashboard
> sidebar. Preserve existing authentication/navigation/recovery behavior, verify through
> the existing harnesses, and keep IN_PROGRESS.md current. Local development verification
> does not by itself authorize a customer or production rollout.

This file creates the implementation plan only. Planned packages are not claims of
delivered features or execution of migrations, runtime changes or deployments.
