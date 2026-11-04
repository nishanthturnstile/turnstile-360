# Turnstile 360 user-management specification

**Status:** Accepted first-release baseline, adopted in UM-I01. **Updated:** 2026-11-03.

This specification adopts the [reviewed proposal](user_management_design_proposal.md)
and preserves UM-R01–22 and confirmed D01–03. It defines product acceptance; technical
identifiers, contracts, limits, module boundaries and release policy are centralized in
[architecture.md](../architecture.md#user-management-implementation-target). The
[implementation plan](user_management_implementation_plan.md) sequences UM-I01–11;
[IN_PROGRESS.md](../IN_PROGRESS.md) alone records actual completion and verification.
Acceptance of this baseline does not claim that roles, invitations, migrations or UI exist.

## Release boundary

After company setup, an explicitly authorized company administrator manages People &
access in the installed workspace. The administrator chooses a read-only starter or a
custom named role, chooses company or canonical Site/Department scopes, reviews access
and invites one colleague by email. The recipient establishes or uses a verified authority
identity and explicitly accepts into the existing workspace. Invitations never activate
company setup, grant identity-administrator powers or change another application's access.

The release includes independent Members, Invitations, Roles and scoped Structure
destinations, role/scope replacement, explicit legacy-grant retirement, suspension and
reactivation, reviewed hierarchy effects, durable delivery and recipient recovery.
Configuration authority remains separate from people and role administration. Existing
configuration/capability users keep their exact grants and status without automatic
promotion. The initial protected administrator is selected explicitly through private
operator recovery and verified by real login before public administration opens.

The owner-confirmed choices remain:

| Decision | Accepted behavior                                                                                                                            |
| -------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| D01      | Offer Include child units, enabled by default. Coverage follows the current hierarchy; affected moves require access-impact review.          |
| D02      | Permit several assignments per person. Combine matching action/scope grants additively; membership suspension overrides all sources.         |
| D03      | People, invitation and role administration require explicit company-wide authority. Unit management does not delegate people administration. |

Use existing Mailpit for development invitation, verification and password-setup/recovery
mail. Captured messages prove development delivery only. Initial real administrator
selection and production email/domain/TLS remain rollout inputs, not unresolved role-model
questions. Web and future mobile share backend policy and platform-independent contracts;
a mobile application is outside this release.

Exclude bulk invitations/import, employee records, reporting lines, responsible people,
workflow/document permissions, role inheritance, explicit deny, delegated unit people
administration, public signup, a second organization tree, tenant selection/provisioning,
source/data migration and global identity administration.

## Product requirements

The following requirements retain their reviewed IDs and wording. Technical elaboration
below and in architecture makes their acceptance concrete without renumbering them.

| ID     | Required behavior                                                                                                                                                                                                                                |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| UM-R01 | Operate only within the existing installed organization/application; preserve authority/product/DMS ownership and isolation from other applications.                                                                                             |
| UM-R02 | Use canonical membership status and one effective-access evaluator across every reader/writer. Preserve imported legacy permissions/status explicitly, with reviewed retirement and no automatic administrator promotion.                        |
| UM-R03 | Allow predefined and administrator-created named roles from a finite versioned implemented-permission catalog; stable identity survives rename, and unknown/future actions grant nothing.                                                        |
| UM-R04 | Bind every granted permission to its assignment's company/unit scope. Shell entry is scope-neutral; company-only actions cannot be granted through unit assignments or independent permission/scope unions.                                      |
| UM-R05 | Provide exact-unit or current-subtree coverage with Include child units enabled by default. Preserve stable anchors on rename/move; treat hierarchy changes as access changes where coverage changes.                                            |
| UM-R06 | Allow several explicit assignments per person, combining matching grants additively. Global membership suspension overrides every source; role inheritance and explicit-deny composition are outside scope.                                      |
| UM-R07 | Restrict people/role administration to explicit company-wide powers and enforce the actor's permission-and-scope grant ceiling on direct and indirect grants, role edits, reapproval and reactivation.                                           |
| UM-R08 | Protect the stable Workspace administrator role and the last distinct enabled local administrator, plus the existing effective configuration-manager invariant, under concurrent public/private changes.                                         |
| UM-R09 | Bind access-impact reviews to current access/record/hierarchy versions. Recheck authorization/references inside one ordered transaction and commit effective state plus attributable audit atomically.                                           |
| UM-R10 | Enforce scope for detail/list/search/count/write and success/conflict/error projections. Scoped operation responses and minimal breadcrumbs must not reveal unrelated company configuration.                                                     |
| UM-R11 | Apply an explicit unit create/rename/delete/move matrix and all existing hierarchy/setup protections. Access-affecting moves also require company people authority; referenced roles/units cannot be removed while actionable references remain. |
| UM-R12 | Show product-linked member identity, grants, scopes and status without exposing the shared identity directory. Keep immutable subject binding through display/email changes, identity deletion and recycled addresses.                           |
| UM-R13 | Persist invitation approval, role/scope payload and credential generation; changes or approver revocation require durable invalidation/reapproval and fresh recipient review.                                                                    |
| UM-R14 | Support new/existing/unverified/passwordless/mismatched recipients through purpose-bound authentication and explicit verified acceptance, without pre-existing product access or normal-route access from restricted state.                      |
| UM-R15 | Use narrowly authenticated, idempotent authority account preparation/projection; never expose general identity administration or change existing credentials, roles, bans or other application membership.                                       |
| UM-R16 | Separate durable invitation state from generation-aware delivery outcomes. Explicit resend rotates first; timeout/partial account/mail success can be reconciled without duplicate accounts, implicit resend or revived credentials.             |
| UM-R17 | Make acceptance/cancel/resend/reapproval/expiry atomic per current generation. Lost responses and repeat acceptance return the current subject-bound result, never duplicate grants or overwrite later suspension/changes.                       |
| UM-R18 | Apply bounded inputs/results/rates/retention, protected single-use credentials, no-store/no-referrer, server-only secrets and redacted logs/traces; scanners and GET previews perform no mutations.                                              |
| UM-R19 | Provide independently gated Members/Invitations/Roles/scoped-structure destinations, accessible responsive editors, explicit impact confirmation, transient drafts, uncertain-write readback and restricted account switching/logout.            |
| UM-R20 | Preserve fixed installation/identity/client/enrollment/setup state through a rehearsed compatible upgrade. Retire old readers/writers before exposing new grants; recovery prevents restored credentials/email work reviving old approvals.      |
| UM-R21 | Keep company completion, DMS feature availability and identity availability separate. Invitations do not replay onboarding; unavailable identity fails closed with recoverable state.                                                            |
| UM-R22 | Use the existing Mailpit installation for development invitation plus authority verification/password-setup mail; distinguish captured development messages from real external delivery.                                                         |

## Roles, permissions and protected people

A role has stable identity, normalized unique name, optional description, version and an
explicit set of supported actions. A title supplies no permission. Unknown/future actions
grant nothing and cannot be saved. Supported company-only versus scope-aware actions,
reserved system keys/names and starter permission sets are fixed by the
[permission catalog](../architecture.md#user-management-permission-and-starter-catalog).
DMS connection capability-read remains a separate explicit permission in every role;
Workspace administrator does not acquire it implicitly.

Four read-only system definitions are available: Workspace administrator, Configuration
manager, Unit manager and Member. Custom definitions are created from scratch or copied
from a starter. Copying the Workspace administrator's permissions creates an ordinary
custom role and never copies its protected identity. System definitions cannot be renamed,
modified or deleted. Custom names cannot impersonate reserved system names; rename retains
stable identity and assignments. Names compare using the existing organization name-key
rules; whitespace/case-equivalent duplicates conflict. No alias merging of email addresses
is performed; the pinned authority's exact comparison rules govern invitations.

A role-only administrator can independently list definitions, create/copy within their
ceiling, rename custom definitions and edit/delete unreferenced custom definitions. It
cannot enumerate member identities through role impact. A people-only administrator can
inspect members/invitations and select eligible existing roles without editing definitions.
Changing the permission set of a referenced custom role, including removing permissions,
requires both powers and current coverage of every affected assignment/approval. Added
reusable actions require company-wide coverage. An incompatible company-only action
cannot be added to a definition still assigned at a unit.

Assignment, retirement, reactivation and indirect role changes use the same grant-ceiling
predicate, detailed in architecture. A company people/role-management action alone does
not confer the operational actions being granted. All changed access must fit the actor's
current action-and-scope coverage. Assigning/removing the protected role requires a current
protected administrator as well as people authority. Existing imported grants appear as
an explicit source; replacing roles does not remove that source. Its retirement requires
separate explicit confirmation in the reviewed command.

Count distinct enabled local subjects holding the protected role, never assignments,
pending invitations or suspended people. Protect the last such administrator and the last
effective company configuration manager across all sources, including concurrent changes
and private commands. Once established, neither count can fall to zero. Initial empty
installations use private verified bootstrap. External authority bans/deletion are handled
through private recovery; the product cannot make remote identity state transactional.
Verify a replacement's actual login before retiring known external administrator access.

## Assignment and unit operation acceptance

An assignment binds one role to either company coverage or one or more saved Site/Department
anchors with an explicit Include child units flag. Reject duplicate assignments/anchors;
overlapping different assignments are allowed. Shell entry is scope-neutral and never
opens unit records. Company-only actions reject a unit assignment as a whole. An enabled
membership and an explicit shell-entry grant are required for ordinary workspace entry.

For each action and requested resource, evaluate only assignments containing that action.
Company grants cover that action everywhere; exact anchors cover the selected unit;
subtree anchors also cover its current descendants. Do not combine an action at Site A
with another role's scope at Site B. Suspension blocks every source. Renames preserve
anchors. New children follow existing subtree coverage. Retained assignments on suspended
members still prevent unsafe role/unit deletion.

Structure has a separate safe projection and loader. Authorized units are actionable;
minimal ancestor labels/IDs exist only to explain paths. Breadcrumb visibility does not
grant read/detail/manage permission on that ancestor. Filter before search, counts and
pagination; conceal out-of-scope existence in detail, errors and conflicts. Never return
company profile, completion actor, unrelated units, hidden counts or a full configuration
snapshot to a scoped reader. Full configuration/setup remains configuration-manager-only.

| Operation              | Required outcome                                                                                                                                                                                                                                   |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Read/list/search/count | Company configuration authority or matching unit read/manage coverage; ancestor context is display-only.                                                                                                                                           |
| Rename                 | Matching manage coverage of the unit. Exact-only management permits rename without parent management. Root rename remains company profile work.                                                                                                    |
| Create child           | Manage coverage of parent and new child. Exact-only access to the parent cannot create an inaccessible child. Creating at the organization root requires company configuration authority.                                                          |
| Delete                 | Manage coverage of leaf and parent relationship; no live role-assignment or actionable-invitation anchor; all existing leaf/root/type/depth/first-unit rules. An inherited policy does not permanently pin every descendant.                       |
| Move                   | Manage source, source parent, destination, resulting subtree and changed links. Cross-coverage-boundary moves require company structure authority; changed inherited access also requires company people authority, ceilings and confirmed impact. |
| Same-parent move       | Recheck identity, scope and versions, then report unchanged without revision/audit changes.                                                                                                                                                        |

Company structure authority means existing company configuration management or company
unit management. Company unit management still cannot edit profile, zone, root or setup.
Root parent context for top-level mutations is authorized only by configuration management.
A scoped subtree manager can move within fully managed relationships when effective
coverage is unchanged. Existing Site-at-root, Department parent, cycle, depth, sibling-name,
stable-root and versioned first-unit protections apply to every route, including legacy
company routes. Access-affecting moves must preview current memberships and actionable
invitations; an approver cannot authorize new coverage beyond their current ceiling.

## Invitation and delivery acceptance

Sending an invitation persists normalized contact, assignments, approval and a credential
generation. It creates no account or membership. One actionable invitation is allowed per
normalized address/application. A transport retry reuses the original result and never
silently sends another message. Explicit resend rotates the credential before queuing mail;
delivery failure never revives the previous link. Invitations and email delivery have
separate lifecycle/status, as frozen in the
[transition tables](../architecture.md#user-management-state-transitions).

Recipients review the currently approved permissions and scopes, not only role names.
Permission, selected-scope/contact, or inherited-coverage changes invalidate prior approval
and link. Loss of approver authority is durably invalidating even if later restored.
Harmless display renames refresh labels without changing permission consent. Reapproval
requires a current eligible company people administrator, a fresh credential and fresh
recipient review. Cancel, resend, reapproval, expiry and acceptance serialize; the first
committed valid transition wins using database time. Cancellation after acceptance cannot
remove membership.

New recipients enter their own name/password at the authority's purpose-bound setup
surface, verify the authority email and return to explicit acceptance. Passwords never
pass through the product API or an inviter. An account may survive failed/cancelled setup,
but it gains no product membership. Existing accounts retain their name, credentials,
verification policy, bans and access to other applications. Unverified/passwordless records
use guided verification/recovery with resume rather than credential replacement by an
administrator. A creation race resolves to the existing identity safely. Public responses
do not disclose whether an address exists in the shared authority.

An invitation does not verify identity. Acceptance requires current live verified authority
identity whose normalized email matches the invitation, current generation/expiry/approval,
valid roles/units and an eligible membership state. Before acceptance that identity is
restricted: it cannot call ordinary sessions, configuration/setup, DMS, people or unit APIs.
GET previews/scanners never provision, consume or accept. Credentials are removed from URL
history after explicit protected exchange and never enter browser storage or retained logs.

| Recipient/state                                | Required outcome                                                                                                                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New account                                    | Recipient-owned name/password submission, ordinary unverified authority account, verification, restricted login, explicit acceptance, ordinary workspace. No manual Forgot password detour. |
| Existing verified account                      | Sign in through existing exact callback and review matching invitation before acceptance; retain credentials/profile/other application membership.                                          |
| Existing unverified/passwordless account       | Guided owning-authority verification/recovery and resume from server purpose or current invitation; no implicit verification or password overwrite.                                         |
| Wrong signed-in account                        | Explain mismatch without directory information; explicit account switch/cancel and consented exact-parent logout. Another tab's identity change invalidates acceptance.                     |
| Authority banned/deleted/unavailable           | Never unban or grant; deny or show recoverable unavailable state. A deleted identity's contact text never identifies its replacement.                                                       |
| Already active member of same subject          | Show current membership; invitation cannot replace assignments. Administrator reviews ordinary access changes instead.                                                                      |
| Suspended same subject                         | Require explicit administrator reactivation; resend, acceptance or replay cannot reactivate.                                                                                                |
| Same email now verified for a new subject      | Administrator must resolve/suspend deleted old identity and explicitly approve a fresh invitation. Keep distinct history; copy no old grants.                                               |
| Membership created while invitation pending    | Conflict with current membership and require administrator review, without overwriting it.                                                                                                  |
| Decline                                        | Explicit protected cancellation of the pending generation; no membership. Does not sign out another authority parent automatically.                                                         |
| Cancel recipient flow                          | Clear applicable restricted continuation only; invitation remains actionable unless explicitly declined/cancelled.                                                                          |
| Lost continuation after reset/verification     | Reopen current invitation and authenticate again; no duplicate identity or arbitrary callback/returnTo.                                                                                     |
| Acceptance committed; response/cookie lost     | Read current subject-bound acceptance result and recover ordinary login. No duplicate assignment and no replay of original grants.                                                          |
| Repeat acceptance after suspension/access edit | Read current membership/status, preserving later suspension/changes. Never restore the accepted payload.                                                                                    |

Acceptance atomically commits canonical membership, assignments, subject-bound outcome
and audit. Establish ordinary session afterward. Identity creation and SMTP are separate
owning-service outcomes and are reconciled, never claimed as a cross-service transaction.
Mail status distinguishes queued/sending, SMTP acceptance, definite failure and unknown
outcome. Bounded lease recovery survives restarts/replicas; a stale worker cannot change a
new generation's status. Unknown delivery is visible and an authorized resend is explicit.
No mail link or secret is retained in progress/audit/test artifacts.

## Navigation, editing and recovery

Members and Invitations require company people management. Roles requires company role
management. Structure requires matching unit read/manage or company configuration authority.
Organization, regional defaults and Setup overview retain company configuration authority.
Only independently permitted loaders run; people-only/role-only/scoped users never fetch
full configuration. People administrators get bounded eligible-role choices for assignments
without role-definition edit authority. Member lists show current identity freshness,
suspension, every assignment and retained legacy sources.

Require explicit Save/Cancel and impact review for access changes. Drafts remain in memory
with dirty-navigation protection. After a stale review or uncertain response, fetch current
safe state; do not automatically replay a command or report success optimistically. A
changed actor session refreshes its access/CSRF context, retains drafts and requires explicit
resubmission; revoked permission denies the write. Unrelated actors' access changes do not
rotate an unchanged session. Keep localized loading/error states, narrow layouts, keyboard/
touch access, full paths for duplicate names, reduced motion and expired-session recovery.

The workspace opens only with an accepted ordinary session and current completion policy.
Incomplete installations retain configuration-manager setup or ordinary waiting. Recipient
paths can finish authentication/acceptance before setup completes, but cannot bypass setup
or turn invitations into a second onboarding flow. DMS unavailability does not block local
people/structure administration; unavailable identity fails closed with recoverable state.

## Compatibility and verification acceptance

Fresh and upgraded access must use one canonical evaluator. Import legacy enabled/disabled
rows exactly once as explicit sources; role-only users need no legacy row. Old rows are
retained for inventory/recovery and stop authorizing independently. Upgrade every login,
session, guard, readiness, configuration transaction and private access writer/inspection
before public feature writers open. Count protections and audit rollback apply equally to
operators. Forced RLS and least runtime privilege checks include every new feature table.

Preserve fixed tenant/application/identity/client/enrollment IDs, setup v1/v2 completion,
root/unit identity, stored zones and existing grants/suspensions. Coordinate authority/API/
web/migrations/private commands and prove old readers/writers cannot remain active. A
pre-feature image is not a valid rollback after new writers open. Restore rehearsals rotate
the external invitation epoch, quarantine restored mail and require explicit reapproval/
resend so restored credentials cannot undo cancellation or suspension. The
[release barrier](../architecture.md#user-management-release-compatibility) owns the exact
technical policy; production/customer rollout remains separately recorded.

The plan's [J01–16 journeys](user_management_implementation_plan.md#complete-user-journeys-and-failure-acceptance)
are required acceptance, covering existing-grant handover; reusable/custom roles; additive
scope isolation; new/existing recipients; restricted state/scanners; duplicate membership;
role/approver changes; transition races; delivery/restart; legacy retirement and protection;
scoped structure and moves; independent navigation; operational failure; restore/rollback.
Each package carries focused contract/PostgreSQL/HTTP/browser tests for its owning risks;
required workspace checks and final exact-image/upgrade/Mailpit evidence remain in the
[verification package](user_management_implementation_plan.md#um-i11-complete-chain-verification-and-coordinated-release).

UM-I01 establishes acceptance and architecture only. UM-I02 owns strict runtime
contracts and generated API documentation; persistence and public handlers follow their
dependency gates. No schema, invitation/account/access mutation or deployment is delivered
by adoption of this specification.
