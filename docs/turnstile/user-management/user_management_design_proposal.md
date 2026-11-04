# Turnstile 360 user-management proposal

**Status:** Reviewed proposal, adopted by the [UM-I01 specification](user_management_specification.md); runtime implementation pending.
**Updated:** 2026-11-03. The owner confirmed support for both company-wide and
Site/Department-scoped access, replacing the earlier company-wide-only first release,
and selected the existing Mailpit installation for development email. The proposal includes
administrator-created custom roles. The owner also approved the child-unit option,
multiple assignments and company-wide administration policy recorded below. The product
choices in this proposal are resolved. The final review adds explicit acceptance rules
and a [detailed implementation plan](user_management_implementation_plan.md); it does not
implement the feature or run any migration.

## Purpose and sequence

After authentication, company setup and organization structure, the next useful product
capability is allowing an authorized customer administrator to bring colleagues into the
existing organization and manage what they can do and where their access applies.
Administrators can use predefined roles or create roles in their own terminology, then
assign company-wide access or limit access to selected Sites and Departments from the
existing organization structure. Organization and workspace refer to the same installed
customer context, as defined by the
[deployment model](../../../architecture.md#customer-deployment-and-application-model).

The proposed journey is company setup complete → Settings → People & access → Choose
or create a role → Select company-wide or Site/Department scope → Invite person →
recipient establishes or uses a verified account → explicitly accepts → enters
the existing workspace with the assigned access. Invitations are ongoing administration,
not another mandatory onboarding step. Existing completion remains valid.

Both scope options apply to predefined and custom roles wherever their permissions support
unit-level enforcement. Roles define permitted actions; assignments bind those actions to
the whole company or selected units. The organization chart supplies canonical units, but
placement alone never grants access. Employee records, reporting lines and responsible-
person assignments remain separate business capabilities.

## What exists today

- Verified email/password identity, sign-in, recovery and live product sessions exist.
- Account provisioning and local product access changes are private operator commands.
  Password omission in the account command supports verification/recovery; this is not
  an implemented workspace invitation/acceptance lifecycle.
- Product authorization uses explicit local permissions, not named product roles. The
  current catalog covers workspace entry, configuration management and DMS capability read.
- Configuration management is explicitly separate from account/access administration.
  Identity-authority administrator status grants no Turnstile business authority.
- In-app member management, invitation delivery/status/acceptance, product role assignment
  and member-to-unit relationships are not implemented.

These findings follow the current
[authorization boundary](../../../architecture.md#turnstile-bff-and-user-authorization-boundary),
[configuration access policy](../../../architecture.md#access-provisioning-and-backend-readiness)
and [onboarding release boundary](../onboarding/onboarding_specification.md#release-boundary).

## Proposed first release

People & access belongs in Settings. Members and Invitations require people-management
permission; Roles requires role-management permission. A role-only administrator can
reach Roles, and a people-only administrator can choose eligible roles without editing
definitions. A scoped unit manager can reach permitted structure operations without
reading company configuration. Each destination has its own loader and access gate;
the current Settings component's eager full-configuration fetch cannot be reused for all.

Provide a searchable, paginated Members list with name, email, role assignments, scope
and access status, and an Invitations view with email, proposed assignments/scopes,
inviter, expiry and delivery outcome. Invite one person at a time by email, role and scope.
Require a display name during account setup
when needed, without requiring the inviter to supply the recipient's password.

Provide starter roles rather than limiting the customer to three fixed role names:

Starter definitions are read-only system templates. Administrators can copy one into a
custom role and change its name/allowed actions; they cannot mutate the system definitions
or copy the protected Workspace administrator identity itself.

| Proposed role           | Workspace entry | Company profile, regional settings and structure | Invitations, members and role changes |
| ----------------------- | --------------- | ------------------------------------------------ | ------------------------------------- |
| Workspace administrator | Yes             | Yes                                              | Yes                                   |
| Configuration manager   | Yes             | Yes                                              | No                                    |
| Member                  | Yes             | No                                               | No                                    |
| Unit manager            | Yes             | Unit structure only; no company profile/defaults | No                                    |

Configuration manager preserves the existing distinction between company setup and people
administration. Add a scope-compatible Unit manager starter for the proposed unit
view/manage capabilities, so scoped predefined roles are useful alongside custom roles.
The table describes role capabilities; it does not imply every listed action can be
limited to a unit. Workspace administrator and the existing
Configuration manager contain company-level powers and are company-wide. A role whose
actions are scope-aware can be assigned company-wide or to selected Sites/Departments.
An attempted unit assignment of a company-only permission is rejected clearly, never
silently widened or partially applied. These roles cover the stated capabilities only;
people administration is proposed rather than delivered. Member does not imply
document read, upload or approval rights; future capabilities add explicit permissions
with their own requirements. Existing DMS capability-read grants must remain explicit.
An authorized role administrator can also create custom roles and select their permissions
from the supported product catalog, as described below. Business permissions such as
approval enter that catalog only with their implemented and agreed feature.

## Custom roles and access configuration

The recommended first release includes a Roles section alongside Members and Invitations.
An authorized role administrator can create a role from a starter template or a minimal
workspace-entry baseline, name it using the organization's terminology, describe its
purpose and select permitted product actions. For example, Operations lead might include
workspace entry and the proposed scope-aware unit-structure management actions, while HR
coordinator might include workspace entry and company-wide invitations/member administration.
Neither name supplies any authority by itself.

Role names and permission combinations are customer-configurable. The product defines
which actions exist and enforces them on the backend. Customers cannot invent an action
such as Approve documents before that feature and its authorization are implemented.
Existing configuration management remains one company-wide permission covering profile,
regional settings and structure. Unit-scoped structure viewing/management requires new
explicit permissions and guarded operations as part of this feature; it cannot be achieved
by relabelling the existing permission or filtering only the browser. Whole-company
profile/time-zone/setup management and DMS capability checks remain company-level actions.

The editor groups delivered workspace/configuration/connection capabilities and the
proposed people-management and role-management capabilities. Show clear human labels
and their supported scope. Assignments use stable role identities so renaming never breaks
access. Allow several explicit role/scope assignments per person, such as
Operations lead at Site A and Member at Department B, with additive grants and no explicit
deny rules or role inheritance. This replaces the earlier one-role-per-member proposal
and is confirmed under D02 below. Global membership suspension overrides all assignments.
Workspace entry is scope-neutral: it permits entering the shell, not reading every unit.

The user journey is Roles → Create role → Choose a name and permissions → Review →
Create → Select the role and scope when inviting or updating a member. A shared role
edit previews added/removed permissions and affected members/scopes before confirmation.
Adding company-only actions to a role with unit-scoped assignments must be rejected until
those assignments are explicitly resolved; it cannot broaden them automatically.
After commit, subsequent protected requests use the current permissions; browser state
or old role labels cannot preserve removed access. Renames preserve member assignments.
An assigned or actionable pending-invitation role cannot be deleted until references are explicitly
resolved; role removal cannot bypass protected administrator/configuration boundaries.
Permission changes affecting pending invitations require current administrator reapproval
and fresh recipient review. An invitation cannot become more powerful because its named
role changed between issuance and acceptance. A harmless role rename preserves its identity.

Keep a protected Workspace administrator role with the required recovery/administration
capabilities. Customers can use their own custom role names alongside it. Only explicitly
authorized users manage role definitions, and grant/assignment limits must prevent them
from increasing their own authority or granting capabilities beyond their allowed ceiling.
Separate permission to manage members from permission to define roles. Editing a shared
role is a grant change and receives the same live authorization, concurrency protections,
impact confirmation and attributable audit as an individual assignment change.
Changing permissions on a role referenced by members or actionable invitations requires
both role-management and people-management authority. A role-only administrator can edit
unassigned custom definitions and harmless custom display details, without changing live
member access. Creating/adding reusable role permissions requires company-wide possession
of those actions; assignments additionally enforce their per-action/scope grant ceiling.
Grant ceilings compare each action and its coverage with the actor's current grantable
coverage, including every existing/pending assignment a shared edit affects. Holding an
action at Site A does not permit adding it to a role assigned at Site B. The last protected
administrator means a distinct enabled local person, not a count of their assignments;
pending invitations and suspended memberships never count as a replacement administrator.

## Company-wide and Site/Department assignments

Keep the role definition reusable. For each member or invitation, choose the role and
where that assignment applies: the whole company, or one or more existing Sites and/or
Departments. The role editor should show supported scope and may offer a default for the
subsequent assignment form; creating a role never grants membership by itself. A unit
selection is an access restriction, not just an organizational label.

For example, Operations lead can be assigned to one person company-wide and to another
at Site A, provided that role contains only actions supported at both scopes. A custom
role named Plant manager still needs an explicit Site selection; its name is not a boundary.
Different responsibilities at different units use separate assignments rather than
duplicating the role for every unit. Show the chosen units and effective scope before
invitation, acceptance and later changes.

Provide a visible Include child units option for Site/Department assignments, enabled
by default, as confirmed in D01. Exact-unit access excludes child units; subtree access
covers the selected unit and its current descendants, never siblings or ancestors. Minimal
ancestor labels needed to show a path do not authorize reading or editing ancestor data.
When adding several units to one assignment, use the same explicit child-unit policy;
use separate assignments if different coverage is required.

Scope applies to successful writes and their responses as well as ordinary reads. Scoped
rename/create/conflict responses must not return the existing full company snapshot.
Exact-unit management allows read/rename of that unit; child creation requires authority
over the parent and the resulting child. Leaf deletion needs coverage of affected parent
links and the existing reference/setup protections. Moves need coverage of all affected
units/relationships; breadcrumbs are not authority to manage an ancestor. The complete
operation matrix and restricted projections live in the
[technical target](../../../architecture.md#user-management-consistency-and-scoped-structure).

Each backend operation must match its required permission and target resource against the
same current assignment. Never flatten a person's roles and unit lists independently:
that could apply a powerful role from Site A at a second Site where they have only Member
access. Overlapping permitted assignments are additive; an explicit company-wide grant
is broader than unit grants. Workspace entry permits the shell, not unrestricted records.
Enforce scope for direct HTTP calls, detail reads, lists, search, counts, writes and future
clients; data with no trustworthy unit mapping stays unavailable to unit-only grants.
Future business features must define unit ownership and enforce this boundary before
exposing scoped actions. Selecting a scope does not create unimplemented document or
approval capabilities.

Use stable canonical unit identities. Renaming preserves assignments. Under the approved
subtree policy, moving units changes inherited coverage according to their current ancestry:
moved-out units lose the old parent's inherited access and moved-in units gain the new
parent's coverage. Explicit assignments to the moved unit stay attached to it. Structure
moves therefore need an access-impact preview, authorization for the affected boundaries
and explicit confirmation; do not silently reuse today's move behavior. Unit deletion is
refused while member or pending-invitation scopes reference it, until those references
are explicitly resolved. Creation of descendants also follows the approved subtree policy.
Acceptance revalidates referenced units and current assignment policy, including a unit
deleted or moved after the invitation was issued.
An access-affecting move also requires company people-management permission alongside
structure-management permission. Otherwise a structure manager could gain grant powers by
reparenting units. Review and commit must agree on both access and organization revisions;
a role, assignment or invitation change after the preview requires a fresh review.

Keep invitation/member administration and role-definition management
company-wide in the first release. A unit manager can exercise approved operational
actions in their scope, but cannot create roles or invite/change members merely because
they manage a Site. D03 defers delegated unit-level people administration, which would
require additional scoped grant/assignment rules. The protected administrator
and last-configuration-manager protections remain company-wide.

The [earlier interactive concept](../../presentations/user-management-concept.html) illustrates
the company-wide journey, role creation and simulated invitation/acceptance/suspension.
It predates this scope expansion and does not yet show scoped assignment controls; the
proposal above supersedes its company-wide-only text. Its data is fictional, held only in
page memory and never sent to a service. Shared-role edit impact is explanatory rather
than an implemented editor. This request updates the proposal, not that earlier visual.

Existing configuration managers must not automatically become people administrators.
Establish the first Workspace administrator through an explicit private operator action
and preserve existing users' effective grants during upgrade. Define how existing explicit
grants and the new configurable-role assignments coexist before implementing either writer.

## Invitation and acceptance journey

1. An authorized administrator opens People & access, selects Invite person, enters the
   email, chooses role/scope assignments, reviews effective access and confirms. Show an
   existing member or pending invitation
   clearly rather than creating duplicate invitations.
2. Save a pending invitation and attempt delivery. Report invitation state separately
   from mail delivery: a saved invitation with failed delivery is not shown as sent.
   The administrator can explicitly resend or cancel; resend invalidates the old link.
   SMTP acceptance is not proof of inbox delivery; a lost acknowledgement is an unknown
   delivery outcome. Creation retries return the saved invitation without sending again.
3. The recipient opens the invitation and sees the company and offered role. Opening a
   link does not accept it or activate membership. Display the offered unit coverage as
   well as the role. Expired/cancelled links offer a clear
   explanation and a route to request a new invitation.
4. A new recipient completes account setup, establishes a password and verifies email
   through the authority-owned flow. An existing account signs in normally without
   having its password or other application access changed. A session for a different
   email must switch accounts; it cannot accept for the addressed recipient.
5. The recipient explicitly accepts while authenticated as the verified invited identity.
   The backend rechecks invitation validity and current administration policy, binds the
   identity to this product and activates the approved role/scope assignments exactly once.
6. The recipient enters the workspace through existing session/readiness checks. They
   never repeat company onboarding. An unexpectedly incomplete installation retains
   the existing setup/waiting behavior rather than being activated by acceptance.

Pending invitations grant no product access. Repeated acceptance or a lost response reads
the current subject-bound membership result without replaying grants. Cancellation,
expiry, role changes, suspension and concurrent acceptance follow the reviewed outcomes
below. Inviter revocation durably invalidates approval; a current eligible administrator
must explicitly reapprove it before the recipient can continue.

The normal product login callback already requires local workspace access. A new invitee
therefore cannot use that callback unchanged to obtain the session needed for acceptance.
The dedicated invitation acceptance path verifies authority identity before
membership exists, permits only invitation completion, and establishes ordinary product
access only after successful acceptance. Preserve invitation continuation across verification,
password setup and login without treating an invitation link as a normal product session.

## Reviewed lifecycle and recovery rules

The final review closes the following outcomes as part of this release. Detailed state
versions, wire errors, secret handling, limits and delivery ownership are maintained in the
[architecture target](../../../architecture.md#invitation-approval-identity-and-delivery).

| Trigger or situation                                         | Required user-visible result and access outcome                                                                                                                                                                        |
| ------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| New recipient with no identity                               | Collect name/password through authority-owned recipient setup, create an ordinary unverified account only on explicit submission, verify email, then authenticate and explicitly accept. Public signup stays disabled. |
| Existing verified account without Turnstile access           | Sign in through invitation-purpose authentication and accept without needing a pre-existing product grant or changing the existing password/profile/other applications.                                                |
| Existing unverified/passwordless account                     | Resume the authority-supported verification/password-setup path. Do not create a second account or mark it verified from an invitation alone.                                                                          |
| Wrong account, banned identity, unavailable authority        | Offer explicit account switching for a mismatch; never silently accept for another email or unban identity. Outage is retryable without granting access or destroying valid saved state.                               |
| Active member invited again                                  | Link the administrator to current membership and an explicit access-change review; do not let invitation acceptance replace current assignments.                                                                       |
| Suspended member invited again                               | Require explicit authorized reactivation and protected-member checks. A new invitation or old acceptance receipt never bypasses suspension.                                                                            |
| Existing membership created while an invitation is pending   | Refuse stale assignment replacement and require current administration review. Bind any resulting acceptance receipt to the immutable subject.                                                                         |
| Invitation is pending while its role, scope or email changes | Invalidate the old approval/link for access-affecting changes; require current administrator reapproval and fresh recipient review. Harmless name changes preserve stable assignment identity.                         |
| Inviter loses granting/people-management authority           | Mark the approval invalid durably. Reinstatement of the inviter does not revive it; a current eligible administrator reapproves and issues a fresh link.                                                               |
| Recipient declines or cancels account setup                  | Decline explicitly cancels the pending invitation; leaving setup grants nothing and can resume from the current link. Neither action deletes a prepared identity or changes existing applications.                     |
| Link scanner or recipient opens a link                       | Show only bounded invitation context; a GET never accepts, consumes, provisions an account or grants membership. Mutations require explicit protected actions.                                                         |
| Delivery fails after an invitation/account was saved         | Keep durable saved state distinct from delivery. Inspect/retry the same operation without duplicate accounts or implicit resend; show failed/unknown delivery accurately.                                              |
| Resend races a delayed sender or fails itself                | Rotate/invalidate first. The old link stays invalid, even if an old email arrives late or the replacement send fails. Generation-specific delivery results cannot overwrite the current one.                           |
| Accept races cancel, resend, reapproval or expiry            | One current transition commits; losing operations return current state. Expiry uses server/database time, and no stale generation can grant access.                                                                    |
| Acceptance commits but response/session save is lost         | Read back the existing subject-bound result and recover login. Repeated acceptance never duplicates assignments or restores later-revoked access.                                                                      |
| Workspace incomplete, DMS unavailable or unit changed        | Retain setup/waiting policy and DMS independence. Recheck current referenced units, approval and scope at acceptance; a stale/deleted scope cannot be accepted silently.                                               |
| Capacity limit, stale review or a revoked administrator      | Return a finite actionable failure without partial grants/audit success. Retain safe drafts and require a fresh read/review rather than blindly replaying a write.                                                     |

The Members list shows only product-linked identities through a bounded verified display
projection, never a search of everyone in the shared authority. Missing/deleted/stale
identity display is explicit; membership stays bound to subject, not a reassigned email.
Email-change/account-deletion administration remains outside this release.

For a genuinely new account, the guided path is invitation → enter name/password at the
owning authority → verify the authority email → explicitly accept. Creation waits for
the recipient's submission; no placeholder identity is created when the administrator
sends the invitation. The recipient does not have to discover Forgot password to finish
normal new-account setup. Existing passwordless/unverified records use supported guided
recovery instead of overwriting an existing credential. Passwords go only to the authority;
an invitation alone never marks the identity verified.

Membership/role/approval state and review receipts survive reload/restart; unsaved form
drafts stay transient and receive navigation protection. Show canonical readback after
uncertain writes. Restricted invite state has explicit cancel, sign-out and account-switch
actions distinct from ordinary product authentication. The registered OIDC callback remains
exact; purpose and continuation are kept on the server, not arbitrary callback URLs.
The existing sign-in/reset entry must resume that server purpose rather than defaulting
an invitee to normal access-gated login. A deliberate account switch preserves valid invite
continuation and checks the current browser identity across tabs; it does not silently log
out a different parent session.

When a shared-role/scope change fences a member's current session, a submitted write can
return an explicit access-context-changed conflict. Refresh the session and show current
access while retaining the draft; require a deliberate resubmit, never silently replay the
write or weaken CSRF protection. If the required permission was removed, the write is denied.

Protected public writes recheck current actor permissions and affected role/scope coverage
inside their transaction, not just at the initial HTTP guard. Changes to membership,
roles, units, invitations and operator grants share a consistent concurrency policy.
Audit failure rolls back the grant/state change. External authority creation/SMTP is
reconciled separately and cannot be falsely described as a cross-service atomic commit.

## Ongoing administration

Administrators can change a member's roles/scopes and suspend/reactivate Turnstile access with
clear confirmation and an attributable audit entry. Show suspended users separately from
pending invitations. Suspension must affect subsequent protected requests through the
existing live-access enforcement. Reactivation is an explicit administration action;
resending or accepting an invitation cannot bypass suspension.

Protect the last active local Workspace administrator and the existing last configuration
manager boundary, including simultaneous changes and self-demotion/suspension. Preserve
the private operator recovery path for externally suspended identity accounts.

Turnstile suspension affects this application's membership. Global identity bans, identity
deletion, password administration, impersonation and access to other registered applications
remain outside customer people administration. Keep historical actor attribution.

## Existing installations and release safety

Use one effective-access evaluator for normal/restricted session entry, all route guards,
readiness, configuration/scoped services and private commands. Explicitly preserve each
existing enabled/disabled state and permission set as an imported legacy source. Existing
configuration/capability holders receive no people-administrator role automatically.
New role-only members do not need an old-style grant row. Suspension denies every source.

Show retained legacy grants in access reviews. Removing a role is not represented as a
complete revocation if an imported source still grants the same action. Provide an explicit
reviewed replacement/retirement operation, respecting current grant ceilings and both
last-administrator invariants. Upgrade the private grant commands to the canonical source;
do not leave old permission-array writers independently authoritative.

Release authority policy, API/web, owning migrations and private commands together. Stop
incompatible old readers/writers before exposing role/scope/invitation changes, rehearse
fresh and existing-installation upgrades and verify the chosen first administrator's real
login. Preserve setup v1/v2 completion, identity/client/enrollment IDs, stored zones, grants
and session security. A pre-feature API is not a safe rollback after new writers open.
An explicit restore must invalidate restored invitation credentials and quarantine queued
email before reapproval/resend; cancelled/suspended access must not reappear from backups.
No customer/prod rollout or restore is performed by this review/planning task.

## Development email

Confirmed by the owner: use the existing Mailpit setup for development invitation,
verification and password-setup/recovery messages. Reuse the configured transport and
inbox rather than introducing another mail service, relay or host port. The
[architecture](../../../architecture.md#loginrecovery-ui-and-operational-boundary) owns Mailpit
configuration, capture limits and deployment differences; the
[reserved ports table](../../../architecture.md#reserved-local-ports) owns its SMTP/UI addresses.
Captured mail is development delivery evidence, not delivery to a real recipient inbox.
Test the actual captured invitation and authority messages together when implementing
the feature. Production SMTP/provider/domain configuration remains a rollout task; it
does not block development with Mailpit and has not been selected here.

## Confirmed decisions and remaining work

Confirmed scope is configurable role names/access, company-wide plus Site/Department
assignment options for scope-compatible predefined/custom roles, and existing Mailpit
for development email. The owner explicitly approved all three policy recommendations
below on 2026-11-03; they are no longer pending questions:

| Decision                               | Accepted policy                                                                                                                                      |
| -------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| D01 — Child-unit coverage              | Offer an explicit Include child units option, enabled by default; evaluate the current hierarchy with access-impact review on moves.                 |
| D02 — Several assignments per person   | Allow different role/scope assignments per person; each assignment grants its actions only within its scope, and matching grants combine additively. |
| D03 — Who administers people and roles | Keep these powers company-wide for explicitly authorized administrators; unit managers exercise scoped operational permissions only.                 |

Defaults adopted by UM-I01: retain the original three starter
templates, add a scope-compatible Unit manager starter and protect the company-wide
administrator; make custom roles available without code
changes; require review/audit for access changes; reject company-only permissions on unit
assignments; use expiring single-use invitations, explicit resend invalidating the old
link and cancellation/reapproval when the inviter loses authority. These do not require
additional approval questions unless the owner wants different behavior. Expiry,
rate/resource limits and API/error/concurrency targets now live in the
[adopted architecture target](../../../architecture.md#user-management-implementation-target);
UM-I01 adopts them in the [specification](user_management_specification.md) and linked
architecture rather than leaving implementation policy undecided.
Select the initial administrator through an explicit private operator grant to the intended
verified account during rollout, preserving existing grants without automatic promotion.
That account selection is a rollout prerequisite, not another unresolved role-model choice.

No further owner product approval is pending for this proposal. Remaining engineering
work follows the [accepted specification](user_management_specification.md) and adopted
architecture/defaults: executable contracts, runtime implementation and verification.
Initial verified-admin selection and real production mail/domain configuration remain environment-specific
rollout prerequisites; neither changes the confirmed development Mailpit decision.

## Reviewed requirements and acceptance traceability

These IDs identify the reviewed first-release requirements, carried unchanged into
UM-I01's accepted specification; the [delivery plan](user_management_implementation_plan.md)
maps them to packages and acceptance evidence. The accepted
[specification](user_management_specification.md#product-requirements) carries these IDs
and wording unchanged and now owns product acceptance. Their presence is not runtime
implementation status.

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

## Delivery order

The [accepted user-management specification](user_management_specification.md) carries
confirmed D01–D03 and UM-R01–22. UM-I01 freezes the role/scope catalog and invitation
lifecycle in the linked architecture before executable contracts or migrations.
Technical decisions, configured limits and API/security contracts belong in
[architecture.md](../../../architecture.md), not a duplicate design in this proposal.

The [detailed delivery plan](user_management_implementation_plan.md#dependency-order)
sequences UM-I01–11: specification/contracts; canonical access and legacy compatibility;
all session/readiness consumers; scoped structure; narrow authority integration; durable
invitations; restricted recipient authentication/acceptance; administration HTTP; complete
UI; and exact-image/upgrade/recovery verification. No public feature writer opens against
older flat-permission readers or unsafe whole-configuration response paths.

The existing backend boundary remains authoritative for web and future mobile. Identity
stays in the shared authority; Turnstile owns product membership, invitations, roles and
permission enforcement. New cross-service operations require authenticated HTTP and
deliberately scoped authority; existing DMS machine scope must not implicitly authorize
account administration. No cross-application source imports or database access are needed.

Better Auth's [Admin plugin](https://better-auth.com/docs/plugins/admin) supplies authority
account operations, and its [email/password flow](https://better-auth.com/docs/authentication/email-password)
supplies authentication/recovery primitives. The documentation index identifies the
1.7 line matching installed 1.7.14. These primitives do not establish this product's
membership policy or a complete invitation flow. Verify the pinned APIs when implementing;
do not expose general authority admin endpoints to customer administrators.

Better Auth also documents [runtime roles](https://better-auth.com/docs/plugins/organization#dynamic-access-control)
for its organization plugin, selected from an application-defined action catalog. That
establishes a library capability, not a decision to introduce a second organization model.
This product already owns its canonical organization and local product authorization.
Keep the configurable-role design within that ownership unless a separately reviewed
architecture change adopts a compatible alternative; no plugin or new schema is installed
by this proposal.

Verification should focus on new/existing recipient journeys, wrong-account acceptance,
expired/cancelled/superseded links, duplicate/lost-response acceptance, mail failure,
revoked inviter authority, last-admin races, existing-grant preservation and denial after
role removal/suspension. For custom roles, verify grant ceilings on creation, assignment
and shared edits; name changes preserving assignments; current permission enforcement;
deletion with member/invitation references; and simultaneous last-admin changes. For scope,
verify company/exact-unit/subtree rules according to approved policy, mixed assignments
without cross-scope privilege leakage, sibling/ancestor denial, direct HTTP and query/count
enforcement, move/delete/new-descendant effects, company-only permission rejection and
invitation acceptance after unit changes. Verify development mail through Mailpit. Include
real HTTP across the authority/product boundary and
prove that other registered applications retain their independent access.

Bulk invites, imports, role inheritance/explicit-deny policies, staff records and workflow
authorization and delegated unit-level people administration remain separate scope.
There is no implementation or deployment in this
discovery task. Actual work and verification are recorded in [IN_PROGRESS.md](../../../IN_PROGRESS.md).
