# Turnstile 360 user-management implementation plan

**Status:** Accepted delivery and acceptance sequence. **Updated:** 2026-11-04. Actual package verification is
tracked in IN_PROGRESS.md; final independent review provenance remains UM-REVIEW-04.

The accepted [specification](user_management_specification.md) owns unchanged UM-R01–22
and confirmed D01–03; the [reviewed proposal](user_management_design_proposal.md) preserves
discovery and independent-review provenance. The [architecture target](../../../architecture.md#user-management-implementation-target)
owns technical policy, component boundaries, contracts, planned bounds and release
compatibility. [IN_PROGRESS.md](../../../IN_PROGRESS.md) records actual implementation and checks.
This plan sequences the complete feature and names verifiable exit criteria; a planned
package does not authorize running its migrations or deploying it.

## Intended result and fixed scope

After company setup, an authorized administrator opens People & access, chooses/creates
a role, selects company-wide or Site/Department assignments, reviews access and invites
a colleague. A new or existing recipient verifies their authority identity, explicitly
accepts and enters the existing workspace. Administrators can inspect effective access,
change roles/scopes and suspend/reactivate membership without changing another application.

Keep all confirmed choices:

- Predefined and custom role names/actions from the implemented product permission catalog.
- Company and unit assignments, rejecting company-only actions on a scoped assignment.
- Include child units is explicit and enabled by default; subtree coverage follows the
  current hierarchy, with access-impact authorization and review before affected moves.
- Several assignments per person, with additive permission/scope pairs and membership
  suspension overriding every source.
- Only company-wide authorized administrators manage invitations, members and role
  definitions. Unit management alone is not people administration.
- The existing Mailpit installation captures development invitation and authority mail.
- Preserve current installation, legacy grants, setup v1/v2, session security and separate
  DMS machine trust. The future mobile client uses the same backend/contracts; no mobile
  app is part of this work.

The initial UM baseline excludes bulk import/invite; the later bounded invitation UI and
UE-08 sequence extend that scope explicitly. Employee records, workflow/document authorization,
role inheritance, explicit-deny rules, delegated unit people administration, public signup,
SaaS tenancy and a new organization model remain outside scope. The earlier HTML concept is a historical company-wide
illustration; it is not the scoped feature contract or evidence of implemented UI.

## Current implementation and mandatory transition points

| Existing boundary                                    | Evidence in the current workspace                                                                                             | Required transition                                                                                                                                                  |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Normal login requires flat local access              | `apps/turnstile-api/src/modules/auth/browser-auth/browser-auth.service.ts` reads `user_access` before creating a user session | Introduce one canonical evaluator, then a restricted invitation-purpose identity state; never grant access merely to permit authentication.                          |
| Permission guards use a flat enum/array              | `user-session.guard.ts`, `application-access.guard.ts`, `packages/turnstile-contracts/src/index.ts`                           | Separate shell/company route checks from resource permission/scope checks, and recheck current authority in transactional mutations.                                 |
| Readiness and organization independently read grants | `modules/organization/persistence/organization.repository.ts`, private `modules/auth/set-user-access.ts`                      | Replace every reader/writer consistently; role-only users, suspension and imported grants must have one meaning.                                                     |
| Runtime grant writes are intentionally absent        | `user_access` migrations/readiness and the migrator-only private grant command                                                | Introduce narrowly owned feature privileges/functions with forced RLS, not migrator credentials in the API. Upgrade private commands and canonical sources together. |
| Structure mutations return whole snapshots           | `modules/organization/organization.service.ts` and `organization.controller.ts`                                               | Build dedicated scoped projections and operation rules; never relax guards over the current unfiltered response contract.                                            |
| Unit moves alter only hierarchy today                | Organization service and the existing structure editor                                                                        | Add access-revision-bound impact for memberships/pending invitations and require people authority when coverage changes.                                             |
| Account creation is private and signup disabled      | DMS `platform-auth/provision-user.ts`, `authority-options.ts`, `authority-handler.ts`                                         | Implement narrow authenticated HTTP account preparation/reconciliation; preserve shared identity ownership.                                                          |
| Settings assumes configuration-management access     | Web `features/settings/Settings.tsx`, `App.tsx`, `components/workspace-navigation.tsx`                                        | Split independent destination gates/loaders for people, roles, configuration and scoped structure.                                                                   |
| Email and production security already exist          | Authority `recovery-delivery.ts`, Compose Mailpit and `deploy/nginx/nginx.conf`                                               | Reuse owned mail transports; add invitation delivery persistence and extend sensitive-route redaction without a new relay/host port.                                 |

These are design/implementation gaps for the new feature, not vulnerabilities claimed in
an invitation system that has not been built.

## Dependency order

| Package                                                         | Depends on    | Requirements primarily covered | Exit gate                                                                                                                                        |
| --------------------------------------------------------------- | ------------- | ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| UM-I01 Specification and architecture freeze                    | —             | UM-R01–22                      | Requirements, state transitions, scope matrix, compatibility and engineering defaults are concrete and consistent.                               |
| UM-I02 Executable contracts and generated API docs              | I01           | R03–11, R13–19                 | Strict browser-safe schemas, finite errors, route/security classification and generated contract drift checks pass.                              |
| UM-I03 Access persistence, legacy sources and operator recovery | I02           | R02–09, R20                    | Canonical access/legacy import, roles/assignments, audit and updated private commands work in isolated PostgreSQL; public writers remain closed. |
| UM-I04 Access consumers and session/readiness integration       | I03           | R02, R04–09, R18, R21          | Every access reader uses the evaluator; role-only login, scope changes and suspension are enforced without losing auth fencing.                  |
| UM-I05 Scoped organization and move-impact enforcement          | I04           | R04–11, R18–19, R21            | Scoped reads/writes/errors and every legacy structure path enforce current scope, references and access-changing move policy.                    |
| UM-I06 Narrow authority integration                             | I02           | R01, R12, R14–15, R18          | A distinct service registration and real HTTP preparation/projection prove identity ownership and safe partial-success recovery.                 |
| UM-I07 Invitation approval and durable mail                     | I03, I05, I06 | R07–09, R13, R15–18, R22       | Generation-bound lifecycle, approval invalidation, delivery work and Mailpit recovery work without activating membership.                        |
| UM-I08 Restricted recipient authentication and acceptance       | I04–07        | R13–18, R21–22                 | New/existing recipients reach atomic acceptance; restricted state never authorizes ordinary product operations.                                  |
| UM-I09 Guarded administration HTTP operations                   | I05, I07, I08 | R03–13, R16–18                 | Role/member/invitation commands expose current impact, grant ceilings and safe idempotency/readback over HTTP.                                   |
| UM-I10 People, roles, scoped structure and recipient UI         | I09           | R03–19, R21–22                 | Complete responsive/accessible administrator and recipient journeys use owning APIs with independent loaders and safe drafts.                    |
| UM-I11 Complete-chain verification and coordinated release      | I01–10        | UM-R01–22                      | Required suites, image verification and upgrade/recovery rehearsal pass; actual target rollout is separately recorded.                           |

I06 can be developed independently after I02. I07/I08 and all public grant writers remain
gated until the safe access/structure foundations exist. Independent implementation does
not permit deploying half of the access-reader/writer transition. Keep each package's
schema changes with the feature behavior it implements; do not create invitation/outbox
tables in the access-foundation package merely because a later package needs them.

## Users enhancement sequence (2026-11-14)

The owner requested implementation of the final-review corrections and a sequenced plan
for the remaining capabilities. Each phase must leave a usable increment and record
actual verification in IN_PROGRESS.md. Technical decisions belong in architecture.md.
Existing UM-R01–22 and UX-R01–07 remain in force.

1. **UE-01 — Recover interrupted bulk invitations.** Distinguish definite pre-save
   rejection from an unknown acknowledgement. Keep uncertain command payloads and keys
   unchanged. Offer receipt lookup and explicit re-review/retry of the same command;
   never infer failure from a missing receipt or automatically replay a write. Preserve
   partial successes, stop later recipients, and correct role-deletion blocker guidance.
   Validate: real HTTP failure before commit, lost response after commit, recovery after
   intervening cancellation, busy/uncertain dismissal, and no duplicate invitations.
2. **UE-02 — Expose product audit history.** Add an authorized, bounded, paged read of
   existing product access/invitation audit events, with time/action/subject filtering,
   attributable actors, retention information and an explicit bounded CSV export.
   Enforce tenant/People authority on every request and SQL read policy. Display only
   facts recorded by the source; historical field differences cannot be reconstructed
   from revision numbers. Validate: unauthorized/role-only/cross-tenant denial, ordering,
   cursor binding, retention boundary, export escaping, empty/error/loading states.
3. **UE-03 — Explain current access and offboarding.** Add a server-evaluated contextual
   access inspector for a selected member and company/unit context, including matching
   grant sources, suspension precedence and retained imported access. Add an offboarding
   checklist and clear consequences for suspension/reactivation using existing commands.
   Validate evaluator agreement, scoped-read restrictions, independent sources and last
   administrator protections. Account-wide deletion/security changes remain authority-owned.
4. **UE-04 — Make role references actionable.** Open members and actionable invitations
   using a role from its usage counts/detail view. Reuse server-side filters; show current
   blockers before deletion and preserve protected/in-use constraints. Validate role-only
   privacy, combined filters, zero references and references changed during a review.
5. **UE-05 — Improve invitation troubleshooting.** Add delivery-state filtering, full
   available lifecycle dates, recipient-specific preflight errors and an explicit copy
   action for unsent batch recipients. Saved invitations remain individually manageable.
   Validate mixed recipients, normalization, partial results, SMTP-accepted versus actual
   delivery wording and long values at phone/tablet/desktop widths.
6. **UE-06 — Improve large-directory navigation.** Make filters shareable in the URL,
   provide useful server-side sorting with stable cursors, and expose membership dates
   only where their provenance exists. Never invent historical join or last-active dates.
   Validate fresh navigation/back/forward, filter/sort cursor fencing and larger fixtures.
7. **UE-07 — Qualify and release the increment.** Run pnpm check, pnpm build, pnpm test
   and pnpm test:integration, then the expanded production-handler HTTPS browser journey.
   Verify task focus/dismissal, permission changes, empty/loading/failure/recovery and
   phone/tablet/desktop layouts. Publish through the supported signed local release flow;
   preserve installation data, grants, setup, licence and activation. Distinguish source,
   fixture, live-browser and deployed-image evidence in the handoff.

The following enterprise extensions follow the above foundations. Their prerequisites
are explicit delivery gates, not implied feature completion:

Owner confirmed existing identity authority first on 2026-11-14. Enterprise SSO/SCIM
integration is deferred; no customer provider is configured or implied by this increment.

8. **UE-08 — Durable imports and bulk operations.** Define CSV columns, validation,
   duplicate handling, permissible operations and job cancellation. Implement an owning
   backend job/row-receipt model with bounded workers, per-row current authorization,
   idempotent resume and downloadable errors. Preserve existing rate safeguards; qualify
   capacity before raising limits. Validate worker crashes, lost acknowledgements,
   permission changes during a job and replay after intervening membership changes.
9. **UE-09 — Enterprise identity integration.** Select the customer identity provider
   and authority-owned SSO/SCIM/group-mapping contracts, including source precedence,
   deprovisioning, group removal, recovery and application isolation. Implement/test in
   that boundary before exposing connection/status links in Users. Requires actual
   provider metadata and credentials; the product must not collect global credentials.
10. **UE-10 — Access governance.** Define review owners/frequency, temporary-access
    expiry, privileged-action verification and audit-retention/export policy. Implement
    explicit backend policy and durable expiry/review work only after those rules are
    adopted. Validate concurrent expiry, revocation, reactivation, administrator survival
    and unavailable identity verification. Define read-only support/auditor powers
    separately rather than weakening existing management authorization.

Later phases must be assessed against actual customer needs. No tenant switcher, mobile
application, role inheritance or document/workflow authorization is introduced by this plan.

## UE-08 implementation sequence — CSV invitation jobs

1. Freeze UE08-R01–07 and the technical limits/state model in architecture.md.
   Import email recipients only, with shared reviewed access. No membership mutation,
   automatic acceptance, role creation or identity-provider integration.
2. Add strict platform-independent create/action/list/detail/error contracts and checked
   OpenAPI examples. Parse CSV on the server; number nonblank records with the header as record 1, normalize
   email with the existing authority rules and report duplicate/invalid rows individually.
3. Add owning job/row persistence, tenant RLS, indexed due work and readiness assertions
   through generated migrations. Persist normalized rows, reviewed access and actor IDs;
   retain no raw uploaded file, browser session, credential or invitation secret in jobs.
4. Implement explicit draft/start/resume/cancel transitions and durable row command IDs.
   Freeze shared assignment/organization context and recheck live creator authority for
   each row. Save a successful row receipt in the invitation commit transaction.
5. Add one bounded worker per API process, durable leases, safe restart recovery,
   current deployment/release gates, existing rate-budget scheduling and finite retries.
   Cancellation serializes with invitation commit and leaves completed invitations intact.
6. Compose upload/template, server validation review, assignment summary, saved history,
   paged row progress, resume/cancel and escaped complete error CSV into Invitations.
   Closing a saved job never cancels it; unsaved entries retain draft-dismissal protection.
7. Exercise real PostgreSQL/identity/HTTP failure paths: duplicate uploads/start responses,
   crash before/after commit, lease takeover, permission/role changes, concurrent cancel,
   rate waits and unchanged saved invitations after retry. Check large/malformed CSV and
   formula-neutralized exports. Browser validation covers narrow layouts and navigation.
8. Run the four workspace gates, focused production browser journey, source-matched signed
   local build/cutover and retained-data checks. Record actual evidence in IN_PROGRESS.md.

## Final review reconciliation

Both owner-requested independent reviews completed: GPT 6.1 Sol at xhigh returned 16
findings and `opencode-go/gemini-4-argon` returned 15, substantially overlapping. These
are proposal/implementation gaps, not 31 separate vulnerabilities in a delivered feature.
The parent checked material findings against the actual code and reconciled them below.
Reviewer provenance and actual checks remain in UM-REVIEW-04 in progress.

| Finding family                                                                         | Final disposition and delivery gate                                                                                                                                                                                                         |
| -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pre-membership login deadlock, fixed verification callbacks and lost continuation      | Dedicated restricted identity state with the existing exact callback; sign-in/reset resolve server-held purpose; no ordinary user session with empty permissions masquerades as an invite candidate. I04/I08.                               |
| Narrow authority setup, missing recipient name/password and shared identity collisions | No account at invitation issuance. New recipients submit name/password only to a purpose-bound authority-owned setup surface, then verify email and accept; existing accounts keep credentials and use supported sign-in/recovery. I06/I08. |
| Identity-service trust and SMTP ownership                                              | Distinct authority-service registration/audience/scopes, separate from DMS enrollment; product invitation SMTP adapter and authority verification/reset adapter use the existing Mailpit instance. I06/I07.                                 |
| Email normalization, membership source and legacy/operator divergence                  | Match pinned authority normalization; one canonical membership/evaluator plus explicit imported source and upgraded private writers. Preserve exact old grants/status without implicit roles/promotion. I02–04.                             |
| Scope leaks, exact-unit child paradox and structure move effects                       | Dedicated scoped projections and operation matrix, access/hierarchy version-bound impact and company people authority for access-changing moves. I05.                                                                                       |
| Shared role grants, protected templates and last-manager races                         | Read-only system templates; permission-changing referenced roles require both management powers and ceilings; count distinct enabled protected members and effective configuration managers under ordered locks. I03/I09.                   |
| Pending role/scope/approver changes and acceptance races                               | Durable approval invalidation/reapproval, current-generation consent and subject-bound atomic outcomes; approval does not revive when the inviter regains authority. I07–09.                                                                |
| Delivery partial success, retry secrets and stale sender results                       | Durable generation-bound delivery with protected short-lived payloads; create retries reuse results and never rotate/resend implicitly. Unknown SMTP outcomes stay explicit. I07.                                                           |
| Flat session snapshots, payload growth and CSRF changes                                | Bounded actor-specific summary/revision; keep deliberate cookie/CSRF fencing and explicit stale-context refresh/resubmit, rather than removing the existing tested rotation policy. I04/I10.                                                |
| Audit constraints and new-table readiness                                              | Dedicated tenant-bound access audit for truthful user/operator events; include all feature tables in forced-RLS/runtime-privilege safety checks. Do not falsify existing operator-only configuration audit events. I03/I07.                 |
| Independent Settings, suspended/prior membership and incomplete setup                  | Separate destination loaders; explicit reactivation/current-membership review; admin routes stay readiness-gated while recipient-only paths retain setup/waiting behavior. I04/I08–10.                                                      |
| Old images/commands and restore replay                                                 | Coordinated access-aware cutover, existing-state rehearsal, external invitation epoch rotation/mail quarantine on restore; no pre-feature rollback after new writers open. I11.                                                             |

Some review alternatives were intentionally not adopted: trusting an invitation as identity
verification, using DMS machine scope for authority management, removing CSRF rotation,
implicitly resending a retried create, or letting a structure-only actor approve inherited
grant changes. The selected policies preserve accepted ownership, D03 and session fencing.
The plan retains 22 stable requirements and 11 packages rather than renumbering to each
reviewer's suggested package count. No further owner product decision is introduced.

## UM-I01 Specification and architecture freeze

Primary outputs: [accepted specification](user_management_specification.md), the reviewed
proposal references, this plan and the adopted
[architecture target](../../../architecture.md#user-management-implementation-target). UM-I01
freezes policy and inventories existing boundaries; executable contracts start in I02.
Actual completion/checks remain in IN_PROGRESS.md.

Carry UM-R01–22 unchanged into the specification, preserving D01–03 rather than asking
the owner again. Resolve the precise permission identifiers and applicability, starter
templates, stable protected-role rules, scope-neutral entry, grant-ceiling predicate and
unit operation matrix. Describe Members/Invitations/Roles/Structure destinations and which
permission enables each independently.

Adopt the engineering defaults already centralized in architecture: role/member/invitation
versions, access versus organization revision, impact receipts, invitation approval and
delivery states, expiry/rates/capacity/retention, resumable account preparation, current
subject binding and operator recovery. Freeze normalization and duplicate-name/address
behavior against the pinned authority; no provider-specific alias merging.

Define the exact public/private route catalog, mutation/readback DTO families, error/status
matrix and purpose-specific authentication policies. Specify recipient decline, account
switch/logout, already-active/suspended members and pre-existing membership races. Include
who may create/delete/move within exact versus subtree coverage and how company permission
implies scope-aware actions without widening an unrelated scoped role.

Freeze four read-only system starter definitions; custom roles are copies/new definitions,
not mutated system rows. Runtime system rows belong to I03. Freeze the rule that changing a referenced role's permission set
requires both role and people administration and applicable grant ceilings. Role-only
users can still reach independently permitted definition operations.

Draw an acyclic Nest module dependency map in the architecture: access cannot import auth;
the application layer coordinates access/organization operations and their transaction
policies. Identify every current `user_access` reader/private writer and every configuration
success/conflict projection. Record the coordinated rollout barrier and compatible rollback
policy before any replacement access writer is implemented.

Exit: a developer can determine the outcome of every acceptance case below without
inventing a product policy. No new owner decision is needed unless implementation discovers
a material requirement conflict; routine technical choices use the accepted boundaries.

## UM-I02 Executable contracts and generated API documentation

Primary owners: `packages/turnstile-contracts/src` (`people-common`, `access`, `people`,
`people-routes`), `packages/dms-contracts` only for reusable `identity-service` contracts, `scripts/generate-*.mjs`, `docs/api`, architecture
and existing contract-check commands (`pnpm docs:user-management`, `pnpm check:contracts`).
Do not put Nest, database objects or server config
in contracts, and do not imply a generated endpoint is already implemented.

Define strict schemas for catalog/version, role definitions, membership status and source
projection, assignments, exact/subtree scope, impact review/confirmation, admin commands,
invitation approval/state/delivery, restricted identity state, acceptance result and finite
errors. Encode unknown-key rejection, UUID/subject rules, name normalization, payload and
list limits and applicability refinements in runtime schemas rather than TypeScript alone.

Separate whole-configuration DTOs from scoped units and minimal ancestor context. Add an
access revision/version to the ordinary session projection; do not replace authority/CSRF
state or expose private service tokens. Model a restricted recipient projection separately
so it cannot satisfy `UserSessionDto` or the normal authenticated-user type.

Generate OpenAPI 3.1 from the owning executable contracts with examples covering company
and mixed unit assignments, current/expired/stale invitations, delivery unknown, scoped
conflicts and restricted recipient errors. Record exact authenticated authority-service
routes/scopes/resource audience and distinct provider client purpose. Add deterministic
generation/drift checking to the existing `pnpm check:contracts` path.

Exit: contract validation rejects invalid company-only unit grants and ambiguous assignment
payloads; examples distinguish recipient/pre-auth/normal/machine authority. Existing auth
and onboarding contract generation remains unchanged except deliberate additive references.

## UM-I03 Access persistence, imported grants and operator recovery

Primary owners: new Turnstile Access module, `ProductPersistenceModule`, owning Drizzle
schema/journal/migrations, private `auth:set-access`, configuration operator helpers and
focused database integration fixtures. Generate scaffolds through the installed Nest CLI;
generate/review migrations through the installed Drizzle tooling.

Implement canonical membership, explicit imported legacy-grant sources, stable roles,
permission entries and assignment/scope anchors, access revision, impact/idempotency
receipts and bounded attributable audit. Choose tenant-aware composite keys/references,
normalized unique role keys, assignment uniqueness, restricted enum/check constraints
and query indexes for the evaluator, reference checks and bounded lists. Migrate/import
each old grant exactly once; preserve disabled states, explicit capability-read and mixed
permission sets. Keep old rows as recovery inventory, not a second live grant source.

The current configuration audit accepts operator-only access changes and finite
onboarding actions. Implement a dedicated access-audit contract for user/operator feature
events, preserving old history and truthful actor kinds. Include every new owned table in
runtime forced-RLS/privilege readiness checks, not just the current onboarding safety list.

Use forced RLS, transaction-local fixed tenant context and least privileges. The runtime
must not acquire migrator credentials, DDL, cross-owner access or unrestricted history
mutation. Database functions/privileges, if needed for writes, must have narrow argument
and search-path contracts and the same safety tests as application transactions. Do not
add auth-schema references or foreign keys across applications.

Implement one evaluator over canonical status plus permission/scope pairs and legacy sources.
It supports transaction-bound reads, grant-ceiling coverage, distinct-person protected-admin
checks, effective configuration-manager checks and no implicit scope broadening. Unknown
catalog actions deny. There is no positive authorization cache across requests.

Upgrade private commands to write canonical sources under the same lock order, audit and
protected-member rules. Keep existing private input replacement semantics explicit; status
false suspends every source, and a private enabled change cannot bypass last-admin checks.
Provide private inspection, protected-admin grant/handover and bounded maintenance commands.
First administrator selection is explicit; configuration managers are never auto-promoted.
Public role/assignment writes remain closed until all old consumers are replaced.

Exit: real PostgreSQL tests prove legacy matrix preservation, repeat import/no promotion,
role-only membership, source retirement, scope-pair evaluation, forced-RLS/runtime privilege
isolation, last-manager races, audit rollback and bounded idempotent private operations.

## UM-I04 Login, guards, sessions and readiness

Primary owners: Auth module `browser-auth`, `bff-state`, `user-session`, application guard,
Onboarding/Organization repository policy readers and product-session contract/transport.

Replace every independent flat-grant read with the canonical evaluator, including ordinary
login, current session, readiness, setup/configuration transactions and private inspection.
An absent old grant row cannot reject a new role-only member. An old positive array cannot
authorize a suspended member. Record access revision/scope changes even when permission
names are unchanged, regenerate fenced cookie/CSRF state as required and preserve encrypted
session compare-and-set, refresh ownership, idle/absolute expiry and logout recovery.

Handle an actor's changed access context without weakening the existing generation/CSRF
fence. Validate the incoming request against its incoming token/generation; a changed
context refreshes/fences state and returns a typed conflict before mutation. Fetch current
session/CSRF, retain drafts and require deliberate resubmission. Test concurrent requests,
shared-role edits and scope-only changes; a global revision changing for someone else
does not rotate every session. Keep summaries bounded to anchors/revision rather than
expanded descendants or all role definitions.

Keep deny-by-default route metadata. Scope-aware routes declare action and resource policy,
not just that the action occurs somewhere in a flat array. Readiness exemption remains
separate from identity/CSRF/permission checks. Resource mutations recheck actor access in
the owning transaction to close revocation between guard and commit.

Exit: direct Fastify and real authority/product tests prove role-only entry, suspended denial,
unit-scope change enforcement, configuration/people separation, default denial, current
readiness and the existing login/refresh/logout failures without regressions. Inventory
search finds no remaining independently authoritative `user_access` reader.

## UM-I05 Scoped organization operations and access-changing moves

Primary owners: Organization module's public services/repositories/controllers, transaction
coordination with Access, existing configuration contracts/operations and structure tests.

Implement dedicated scoped list/detail and mutation projections, including safe stale-write
and not-found responses. Return only authorized units and minimal ancestor labels; count
and paginate after the scope predicate. Existing whole-company setup/profile snapshots
stay restricted. Do not introduce another organization tree or independent saved ancestry.

Implement the architecture's exact/subtree operation matrix for read/rename/create/delete/
move. Reuse current canonical root/type/depth/name/version/required-first-unit validation.
Check parent and resulting-child authority on creation, scope/reference restrictions on
deletion and whole affected boundaries on moves. Selected anchor references and actionable
invitation scopes count as unit use; terminal audit does not block deletion forever.

Add a bounded move-impact preview for affected memberships and pending approvals. Bind
confirmation to source/destination, subtree and current access/organization revisions.
Require structure authority and, when inherited access changes, company people authority
and grant coverage. Recompute under the shared lock order. A stale preview, a changed
assignment, unknown coverage or a referenced deleted unit cannot be silently accepted.
Invalidate affected pending approval generations and preserve explicit unit anchors.

Apply these protections to existing company-management routes/private paths too: a caller
must not bypass the access-impact rule by using the old move endpoint. Same-parent no-op
still checks authorization and versions. Keep scoped writers closed until all structure
read/mutation/conflict paths satisfy the privacy policy.

Exit: real PostgreSQL/Fastify tests prove mixed Site A/Site B isolation; exact/subtree and
ancestor/sibling boundaries; scoped write/conflict projections; child/new-descendant rules;
move review versus grant/hierarchy races; deletion references and unchanged setup v1/v2.

## UM-I06 Narrow authority service integration

Primary owners: DMS `platform-auth` and authority/operator policy, product server-only
integration adapter, owning contracts, environment validation and real HTTP fixtures.

Add a distinct privately managed authority-service client and resource/scope contract to
the existing OAuth policy/provisioning commands. Separate its client ID/secret/audience
from login and DMS-machine clients. Preserve default-deny policy, exact callbacks, client
revocation/scope ceilings, fixed installation mapping and short token lifetimes. It never
uses DMS enrollment or a user/administrator browser cookie as service authority.

Expose only authenticated bounded account preparation/reconciliation and product-linked
identity projection. Preparation accepts validated invitation operation context and recipient
email (the recipient owns their name at setup), forces the ordinary unverified authority role for new accounts and rejects
arbitrary password/verified/role/ban fields. Preserve existing identity credentials/profile/
verification/bans. Deduplicate create races and reconcile lost responses through authority-
owned receipts; do not repeat create blindly after mail failure.

Implement the separate authority-owned recipient setup operation: after a purpose-bound
setup receipt, a genuinely new recipient submits their own display name/password directly
to the authority, which creates an ordinary unverified account and sends verification.
Do not create a placeholder account when the invitation is issued, pass passwords through
the product BFF, mark email verified from invitation possession or reset an existing
credential. Verify the exact pinned server creation/verification APIs and receipt replay
behavior. Existing unverified/passwordless records use guided supported recovery. Preserve
fixed email callbacks and resume their server-held invitation purpose at sign-in/reset. Do not
enable public signup or general authority-admin HTTP. Lookup never becomes shared-directory
search; the product receives only linked/receipt-bound subject projections it may own.

Exit: separate-process HTTP tests cover new, existing verified, existing unverified/
passwordless, banned and duplicate accounts; wrong audience/client/scope, suspension,
subject visibility, create race, lost response and authority outage. No cross-app source/
database import, shared browser credential or unintended identity modification is present.

## UM-I07 Invitation approval, state and durable development mail

Primary owners: People invitation service/repository, owning feature migrations, mail adapter,
API lifecycle drain, environment/Compose examples, audit/maintenance and Mailpit fixtures.

Use the UM-I06 server-only identity adapter with persisted invitation eligibility. A lost setup-receipt exchange requires a fresh operation UUID after current eligibility recheck; never retry an already exchanged receipt or create blindly after uncertain mail/completion. Keep the product invitation purpose server-held for UM-I08 resume.

Replace the closed `StructureInvitationPolicy` adapter with the owning actionable-reference,
move-impact digest and transactional approval-invalidation implementation described in
architecture.md. Preserve its shared transaction and fail-closed release checks.

Create invitation/approval/generation records, bounded create-command receipts, generation-
bound delivery work and protected delivery payloads with relevant unique/reference/index
constraints. Enforce one actionable invitation per normalized email/product. Active members
use reviewed access-change operations; suspended members use explicit reactivation.

Implement pending/reapproval/cancel/resend/expiry transitions and immutable approval payloads.
Access-affecting role/scope/email changes or approver revocation invalidate approval and
the old generation durably. Restoration of an inviter's powers does not revive it.
Reapproval has a current actor/ceiling, new link and fresh recipient review. Deletion of
roles/units checks actionable invitation references atomically with other writes.

Persist delivery intent with invitation changes. Drain bounded batches using durable leases
across replicas and outside the access transaction. Add bounded startup/restart recovery,
generation-checked outcomes, capacity/rate limits and observable queued/failed/unknown/
SMTP-accepted state. Creation retries do not resend. Explicit resend rotates before SMTP;
an old sender completing later cannot overwrite current status or restore the old link.
Use authenticated encryption only for the temporary recoverable delivery payload and
digests for invitation validation; purge secret payloads on terminal outcomes.

Configure an owning Turnstile SMTP adapter to the existing Mailpit instance and reuse the
authority's existing recovery adapter within its owner only. Preserve reserved host ports,
Compose startup/readiness and Mailpit capture limits; no relay or actual external recipient
delivery is introduced. Failures after account creation/mail acceptance are represented as
partial or unknown outcomes, not false transaction rollback or exactly-once email delivery.

Exit: PostgreSQL plus SMTP/Mailpit integration proves durable create/retry, resend versus
old worker, cancelled/expired work, lease reclamation, failed/unknown delivery, normalized
duplicates, rate/capacity failures, secret redaction and current-generation message content.
No invitation activates membership in this package.

## UM-I08 Restricted recipient identity and atomic acceptance

Primary owners: product BFF/OIDC store/types/controllers, People acceptance policy and
receipts, authority completion adapter and restricted recipient contract.

Compose UM-I07's read-only credential lookup with strict restricted exchange/attempt budgets and current-epoch checks; use its immutable generations and shared transaction/receipt boundary for acceptance, never a parallel invitation writer.

Add a purpose-bound login transaction using the existing exact callback and encrypted
server-side invitation continuation. Separate restricted verified identity from normal
user sessions in types and guards. Bind state/nonce/PKCE, invitation generation, issuer/
subject/parent expiry and live authority checks. GET previews/link scanners perform no
provisioning/consumption. Initial explicit credential exchange removes secrets from URL/
history and binds a protected cookie continuation; browser storage is not used.

Implement recipient-owned name/password setup and verification without a manual Forgot
password detour for genuinely new accounts, preserving the dedicated authority boundary.
Update existing sign-in/reset entry to resolve server-held invitation purpose before normal
login; keep credentials out of returnTo. Implement authority verification/password recovery,
existing-account sign-in, unverified/passwordless completion, wrong-account switch, decline,
cancel and exact-parent logout. Bans stay banned and dependency failures are retryable.
Reopening the current invitation recovers lost continuation after verification/reset without
creating another identity or accepting for a different account.

Accept only through an explicit CSRF/Origin-protected mutation after matching verified
identity and current generation/expiry/approval/grant/scope/membership checks. Commit one
subject-bound acceptance result, canonical membership/assignments and audit atomically.
Acceptance versus cancellation/resend/reapproval uses one transition; database time decides
expiry. If membership already exists, do not overwrite it from the old invitation.

Establish the ordinary session only after acceptance. A failed cookie/session save or lost
response leaves accepted membership recoverable. Repeated acceptance reads current access,
including later suspension/assignment changes, instead of replaying the original grants.
Restricted state cannot call ordinary sessions, setup/profile, DMS, people administration
or scoped business APIs. Complete normal login uses the same canonical evaluator as I04.

Exit: real HTTP/HTTPS tests cover the recipient/account matrix, wrong sessions and shared-
authority account switching, token purpose/expiry, CSRF, double acceptance, cancel/resend/
reapproval races, stale unit approval, partial session success and no restored access on replay.

## UM-I09 Administration routes and impact-reviewed commands

Primary owners: People role/member/invitation controllers/services/repositories, Access
policy operations and typed DTO generation. Expose only the route catalog frozen in I02.

Implement bounded independently authorized list/detail/search and eligible-role choice
operations. Member identity display is product-linked and its freshness/deletion state is
explicit. Resolve same-subject reinvitation separately from a verified recycled address
with a new subject: suspend/resolve the deleted former identity and require fresh explicit
approval, never copy its roles or use stale contact text as proof of the new identity.
Show source grants and all assignments, not a single misleading role string.

Implement custom-role create/copy/rename/edit/delete with read-only system templates, assignment replacement and legacy-source
retirement, suspension/reactivation, invitation issue/reapprove/resend/cancel and impact
previews. Require appropriate company management permission and current per-action/scope
ceilings for every affected member/approval. Protect stable administrator role/core and
distinct people; a role-only administrator cannot bypass assignment rights, and a people-
only administrator cannot modify definitions. A future catalog permission is denied until
its feature is implemented and explicitly granted.

Require both people and role administration for permission-changing edits of referenced
custom roles, including reductions; role-only operations cannot change member grants or
expose member identities through impact results. Added reusable permissions require current
company-wide coverage. Enforce protected/cloneable system templates and assignment-specific
ceilings again under the transaction lock.

Use expected entity/access/hierarchy versions and command receipts. Under the shared lock
order, recheck actor and references, apply one effective change, advance the appropriate
revision and audit atomically. Idempotent unchanged commands are no-ops; unknown outcomes
have safe readback. Capacity, stale impact and unavailable dependency produce finite safe
errors. Map scoped errors without hidden existence/details; no controller owns business logic.

Exit: direct HTTP tests prove unauthenticated/default-denied/CSRF cases, role-only versus
people-only access, indirect/self escalation denial, last-admin mutual suspension, shared
role edits versus pending acceptance/assignment creation and no state/audit change on failure.

## UM-I10 Administrator, scoped-manager and recipient UI

Primary owners: web `features/people`, restricted recipient feature, navigation/Settings
composition, typed transport, shared gallery/design guide and browser fixtures.

Use the configured shadcn/Base UI/Hugeicons/tokens and installed generators; apply the
design and shadcn skills. Independent Members/Invitations/Roles/Structure routes/loaders
must not eagerly fetch full configuration. Use live session/access revision for navigation
and refresh permissions after changes without remounting the entire application layout.

Build searchable/paginated members with current identity/status, expandable assignments
and grant sources; invitation approval/delivery status; role creation/templates and shared-
edit impact. The scope picker selects company or canonical Sites/Departments and explicitly
shows Include child units, affected scope and no permission derived from a role's title.
Display company-only action constraints and eligible grant ceilings before submission.

For recipient flows provide invitation summary, new/existing identity completion, wrong-
account switch, verify/resume, acceptance/decline, expired/cancelled/reapproval/unknown
delivery and current-membership recovery. Do not display product internals or request an
inviter-supplied recipient password. Only accepted normal sessions mount the workspace;
company onboarding does not repeat and incomplete installations retain setup/waiting.

Retain drafts in memory, explicit Save/Cancel, dirty-navigation protection, localized loading,
conflict/readback, bounded errors and accessible feedback. Never optimistically report a
grant as saved before confirmation or replay an uncertain mutation without current state.
Cover keyboard/touch, narrow widths, long/duplicate unit names with full path context,
reduced motion and expired sessions. Add inert gallery fixtures without live account data.
Extend Nginx/app sensitive-route exclusions and trace redaction for invitation/continuation.

Exit: the browser journeys below pass through real owning HTTP, not a second browser-only
permission model. People-only/role-only/scoped managers never request company snapshots;
wrong-account, stale review and uncertain-response recovery remain understandable and safe.

## UM-I11 Complete-chain verification and coordinated release

Use focused tests for critical boundaries and meaningful regressions; do not add tests
that repeat every getter, type or visual class. Implement feature tests in their packages
rather than deferring all coverage to this last package.

| Layer                  | Required final evidence                                                                                                                                                                         |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Contracts              | Strict applicability/state/version validation, finite errors, safe scoped projections and deterministic generated API documentation.                                                            |
| Product PostgreSQL     | Tenant/runtime isolation, explicit legacy source preservation, paired scope evaluation, ordered grant/move/approval races, protected-person counts, idempotency and audit rollback.             |
| Authority/product HTTP | Distinct service audience/client, narrow preparation/projection, identity recipient matrix, live revocation, no other-application credential/membership changes.                                |
| Delivery/Mailpit       | Real captured invite/verify/setup chain, failed/unknown SMTP results, current-generation links, durable lease recovery and no secret-bearing retained logs/artifacts.                           |
| Fastify                | Same application factories as production; classified route/CSRF/readiness policy, scoped responses, restricted-state isolation and stable error outcomes.                                       |
| HTTPS/browser          | All administrator/recipient/scoped-manager journeys below, session/refresh/logout regressions, responsive/accessibility and no secret persistence.                                              |
| Images/operations      | Exact candidate API/web/authority images, migration/command packaging, least-privilege runtime and unchanged fixed-port/proxy topology; feature readiness/version barrier.                      |
| Upgrade/recovery       | Fresh plus existing v1/v2 fixture matrix, no promotion/data reset, first-admin login, no incompatible readers/writers, restore epoch rotation/mail quarantine and compatible rollback evidence. |

Run the repository-mandated candidate commands:

```sh
pnpm check
pnpm build
pnpm test
pnpm test:integration
```

Keep the existing `pnpm test:browser:auth`, `pnpm test:browser:onboarding:structured` and
`pnpm test:browser:structure` regressions when their owning code changes. Add the planned
`pnpm test:browser:people` and corresponding real-database/HTTP mode through the existing
harness. The owning commands and recorded execution evidence remain in the workspace and progress record.
Build the exact affected images and run their actual production entrypoints. Update the
private [release/recovery runbook](../../runbooks/user-management-release.md) and verifier alongside the feature instead of recycling
an onboarding-only success claim as user-management acceptance.

## Complete user journeys and failure acceptance

| Journey                                        | Critical acceptance and meaningful failure cases                                                                                                                                                                                 | Main packages    |
| ---------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------- |
| J01 Existing installation handover             | Access-only, configuration-only, capability, combined and disabled legacy users keep exact intended access; no automatic people admin; explicit verified first-admin handover preserves setup/client/enrollment/zone state.      | I03–04, I11      |
| J02 Create and reuse a custom role             | Names normalize/uniquely compare, protected identity cannot be forged by name, unsupported permissions deny; company versus unit applicability is clear; same stable role works at different allowed scopes.                     | I02–03, I09–10   |
| J03 Several roles across units                 | Powerful action at Site A plus Member at Site B cannot authorize that action at B; exact/subtree, overlap, company grant and suspension behave consistently for every HTTP/read/write/count projection.                          | I03–05, I09–10   |
| J04 New recipient                              | Invite from current approval, Mailpit link, recipient name, ordinary unverified identity, verify/password setup, restricted login, explicit acceptance, normal workspace without repeat company setup.                           | I06–10           |
| J05 Existing/unverified/passwordless recipient | Reuse subject and supported completion; preserve passwords/profile/bans/other application access; wrong-account switch and unavailable authority are explicit and recoverable.                                                   | I06, I08, I10    |
| J06 Restricted identity and scanners           | GET changes nothing; unknown/stale/expired credentials reveal no directory; restricted cookie cannot enter ordinary APIs; CSRF/Origin, state/nonce/PKCE and exact callback are enforced.                                         | I02, I06–08      |
| J07 Duplicate invitation or prior membership   | Active member gets reviewed access changes; suspended member needs reactivation; membership created during pending acceptance cannot be overwritten. Recycled email never transfers subject identity.                            | I03, I07–10      |
| J08 Shared role edits and approver revocation  | Site ceilings apply to every affected assignment/approval; pending changed permissions require reapproval/new recipient review. Restoring a revoked inviter does not restore old approvals.                                      | I03, I07–10      |
| J09 Resend/cancel/accept/expiry races          | Current generation and server time decide; first committed transition wins; double clicks/tabs/lost responses never duplicate grants or restore later suspension.                                                                | I07–10           |
| J10 Delivery partial success/restart           | Account created before mail failure, SMTP accepted before timeout, old sender after resend, lease expiry and API restart all retain truthful state and recover without implicit credential revival.                              | I06–08, I11      |
| J11 Role/scope/source change and reactivation  | Impact includes retained legacy grants; retirement is explicit. Shared edit/assignment/status changes fence current access; last distinct admin/configuration manager survives races and private commands.                       | I03–04, I09–10   |
| J12 Scoped structure editing                   | Safe read/rename/create/delete projections, inaccessible ancestors/siblings, exact-only parent child denial, live unit/role/invitation references, existing depth/type/cycle/name/first-unit rules.                              | I05, I09–10      |
| J13 Hierarchy changes                          | Move into/out of inherited coverage shows impact and needs appropriate company people/structure authority; preview versus new grant/approval/move conflicts. Rename preserves anchors; new descendants follow approved coverage. | I05, I07, I09–10 |
| J14 Independent navigation and recovery        | People-only, role-only, configuration-only and scoped managers reach only permitted loaders; retained drafts, changed session, stale conflicts, Back/Forward and uncertain saves recover on narrow/keyboard/touch clients.       | I04–05, I09–10   |
| J15 Environment/operational failures           | Empty/partial/completed setup and DMS outage remain independent; identity fails closed; capacity/rate/DB/audit failures leave no partial successful grant; no success from a blocked/old reader image.                           | I03–11           |
| J16 Restore and rollback                       | Compatible backup rehearsal preserves original state; restored invitation secrets and queued mail are invalid until explicit reapproval/current epoch; old CLI/API cannot silently resume flat authorization.                    | I07, I11         |

## Release and recovery sequence

1. Preflight the existing fixed installation and exact candidate image/migration/command
   inventory. Back up using protected paths and rehearse an isolated restore with the same
   identity/setup versions/grant matrix; do not reset the saved local installation.
2. Close people/invitation/scoped grant writers and stop incompatible old API/private
   processes. Prove old credentials/connections cannot remain authoritative; rotate/terminate
   as required by the architecture. Do not claim mixed-version rolling compatibility.
3. Apply only owning feature migrations with dedicated migrators and import legacy sources
   repeat-safely. Provision the distinct authority-service registration through the tested
   private command, never normal startup. Supply server secrets through the existing private
   environment mechanism, not command arguments, browser builds or logs.
4. Start the compatible authority/API/web and private command version with public feature
   writers still closed. Check readiness, privilege boundaries, old user preservation,
   role-only/current scope evaluation, session refresh/logout and legacy setup v1/v2.
5. Explicitly grant the intended verified initial protected administrator and verify actual
   login. Confirm role/people/configuration separation and last-member protections before
   enabling administration. Fresh/synthetic new accounts belong in isolated fixtures.
6. Open the coordinated feature and run the complete Mailpit-backed chain plus suspension,
   reapproval and scoped move checks against the selected local release. Retain bounded
   nonsecret evidence, immutable image references and exact command results in progress.
7. If rollout fails, keep writers closed and fix forward or select a rehearsed access-aware
   rollback. A database restore is a separate explicit operation: rotate the external
   invitation recovery epoch, quarantine stale delivery work and reapprove/resend eligible
   invitations. Do not reopen a pre-feature API or restore old link validity by accident.

Customer production deployment, real domains/TLS and external email acceptance remain
separate authorized rollout work. Mailpit proves captured development delivery only.
Unavailable container/runtime checks are recorded separately from successful static/tests.

## Implementation handoff

Follow the dependency table and latest progress for the active package and remaining acceptance.
Read the latest `IN_PROGRESS.md`, architecture, relevant AGENTS.md and skills; record the
active package/owner and actual outcomes. Work on development or a branch from freshly
updated development; never branch/commit/push/merge from or into main for feature work.
Preserve prior uncommitted changes, root LICENSE and third-party notices.

Use Node 24.21.0, pnpm 12.16.1 and pinned Python/uv versions. Apply NestJS guidance for
backend code, PostgreSQL guidance before any schema/SQL, Better Auth/security guidance
for identity changes, OpenAPI guidance for contracts and shadcn/design guidance for UI.
Use installed generators, Fastify-compatible integrations, injected-class value imports,
workspace public contracts and backend authority. No cross-application source/database
access, second organization tree, browser service secret or unrequested mobile app.

Package completion requires its agreed exit evidence and applicable required checks.
Update the plan/spec references when the implementation target changes; record what was
actually delivered, verified and deployed only in progress. The earlier visual and this
plan never substitute for runtime evidence.
