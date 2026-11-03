# Turnstile 360 onboarding specification

**Status:** Accepted redesign baseline, adopted in ONB-RD01. **Updated:** 2026-11-02.

This specification retains ONB-R01–12 from the
[design proposal](onboarding_design_proposal.md), amends their acceptance for the
[dated redesign](onboarding_design_proposal.md#redesign-recommendation-2026-11-02), and
adds ONB-R13 for unit moves. The owner confirmed that either Site/Plant or Department
satisfies the required first operational level. The compatibility, regional and interaction
decisions below adopt the implementation defaults in the
[redesign plan](onboarding_redesign_implementation_plan.md); they are the implementation
target, not evidence of delivered behavior. Actual implementation and verification remain
in [progress](../IN_PROGRESS.md). The [original plan](onboarding_implementation_plan.md)
preserves ONB-I01–08 delivery history; ONB-RD02–08 deliver this redesign. DMS FR/NFR
requirements keep their existing IDs and ownership.

## Release boundary

An explicitly authorized, verified administrator configures the installation's existing
organization, saves a real first operational unit, reviews saved data and finishes setup.
Required business inputs are organization name, explicitly confirmed time zone, first-unit
type and first-unit name. Either Site/Plant or Department qualifies when saved directly
below the stable organization root; the automatically created root and deeper units do
not satisfy this requirement. Deeper structure is optional. Staff and customer administrators
use the same shared progress and explicit local permission. Initial accounts and access
assignment remain private operator work. Organization and workspace describe one installed
customer context; there is no separate workspace name or registration entity.

The release includes dedicated Organization → First unit → Review screens, explicit
save/exit and resume, ordinary-user waiting, backend readiness enforcement and ongoing
Settings for Setup overview, Organization profile/structure and Workspace regional defaults.
Suggest Indian Standard Time · Kolkata · UTC+05:30 only when no zone is saved; an explicit
save confirms it. Retain saved UTC, Asia/Calcutta and all other supported selections.
The business zone supplies business-day/display defaults; events/audit remain UTC instants
and date-only business values remain dates. No historical instant is rewritten.

One visual structure editor serves onboarding and Settings with contextual creation,
rename, explicit unused-leaf removal and safe moves through both drag and Move to….
Site/Department types remain fixed; Site/Plant is a customer-facing description of Site,
not a third type. Labels cannot be customized. Moves change parent while preserving
unit identity/type, descendants and referenced records. No fictional default plant,
arbitrary sibling ordering or persisted canvas coordinates are introduced.

Only confirmed completion opens the dashboard and collapsible application navigation.
Keep the existing delivered Home/Settings actions and permitted DMS connection check,
with honest empty states. Account identity and saved summaries are read-only context;
root/installation IDs and internal permission checks are not customer checklist tasks.

### Versioned setup and existing installations

Newly initialized configurations use requirement version 2. During the coordinated
upgrade, incomplete v1 configurations adopt v2 while retaining saved profile, units,
revision and zone; empty revision-0 setup stays not started. Resume Organization for
missing required profile values/root, First unit for missing qualifying structure, then
Review. There is no skip or direct activation that bypasses the v2 first-unit requirement.
An incomplete v2 configuration may remove its last unused qualifying unit and return to
First unit. After v2 completion, reject deletion or movement that would remove the last
qualifying direct child, while retaining normal leaf/reference restrictions.

Already completed v1 installations retain their requirement version, completion actor/time,
revision, installed identity, units and saved zone. Root-only v1 completion stays valid and
opens the dashboard directly; offer only a non-blocking first-unit prompt. Do not replay
activation, invent a unit or reset completion. A future retroactive mandatory transition
requires a separately adopted product decision. This redesign does not perform Version 1
source/data migration; v1/v2 here describe this product's setup requirement policy.

Activation enables the delivered workspace and separately permitted DMS connection
check. It does not assert document upload, processing or approval readiness. Invitations,
people/access UI, custom roles, memberships, responsible people, advanced taxonomy,
imports, recurring setup reminders, branding uploads, SSO and risk/safety/approval policy
remain separate scope. There is no public signup, tenant selector, new mobile application,
customer provisioning control plane or Version 1 source/data migration.

## Product requirements

| ID      | Accepted requirement and release acceptance                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ONB-R01 | Configure only the existing installed customer. Neither forms nor API inputs can select, create or replace tenant/customer/application identity. Repeat private initialization preserves the same installation; mismatches fail.                                                                                                                                                                                                                                                   |
| ONB-R02 | Require verified live identity, enabled local `turnstile:access` and explicit `turnstile:configuration:manage` to read/edit configuration or complete setup. Identity administrator status, staff identity and email domain grant no product authority. Ordinary users receive only minimal readiness.                                                                                                                                                                             |
| ONB-R03 | Activate v2 only with a valid saved name, explicitly confirmed time zone, one stable automatic root, at least one saved direct-child Site/Plant or Department and a currently authorized configuration manager. Deeper units are optional. Completed v1 remains valid with zero operational units; root identity survives renames.                                                                                                                                                 |
| ONB-R04 | Persist canonical progress across reload, logout, restart, devices and authorized administrators. Resume Organization while required profile/root is missing, First unit while v2 lacks a qualifying saved direct child, otherwise Review. Preserve valid partial saves; unsent suggestions/edits are never reported saved.                                                                                                                                                        |
| ONB-R05 | Enforce workspace readiness on protected business HTTP routes, including direct calls and future clients. Preserve explicitly classified setup/account/operational surfaces. Early ordinary users wait with Retry and Sign out; users without product access receive the existing denial.                                                                                                                                                                                          |
| ONB-R06 | Require the current organization revision for ordinary mutations, including moves; reject stale saves without overwrite. Commit effective changes and attributable audit atomically. Concurrent activation produces one completion/audit outcome; lost-response creation/completion retries cannot duplicate units or activation. Uncertain moves require canonical readback before an explicit retry.                                                                             |
| ONB-R07 | Onboarding and Settings use the same records, contracts, validation, backend operations and visual structure editor. Later profile, time-zone and unit changes appear on reload and in setup overview without replaying onboarding. Search retains ancestry; contextual actions infer parents and valid types.                                                                                                                                                                     |
| ONB-R08 | Keep feature readiness separate from global completion. Activation never calls DMS or requires nonempty capabilities. DMS failure does not undo completion; authority failure retains established fail-closed login behavior. Future approval requires its own agreed policy and security boundary.                                                                                                                                                                                |
| ONB-R09 | Preserve installation, authority, product and DMS ownership. No GET/startup bootstrap, cross-schema account lookup, runtime access-grant writer, service credential in browser code or implied machine enrollment. Missing schema/initialization is an operator availability fault.                                                                                                                                                                                                |
| ONB-R10 | Provide dedicated responsive setup/waiting layouts and accessible progress, errors and save announcements. Preserve explicit save/exit/cancel, in-memory recovery, deep links, Back/Forward, localized loading and reduced motion. Mount dashboard/sidebar/Settings only after confirmed completion; preserve drafts and prevent layout flashes/redirect loops. Completed navigation is collapsible with an accessible narrow-screen overlay and independent scrolling.            |
| ONB-R11 | Settings cannot clear required values, replace root identity or remove the last qualifying unit after v2 activation; completed v1 retains optional-unit policy. Product-controlled grants cannot remove/disable the last enabled local manager, including concurrent writes. External identity suspension uses private recovery and verified replacement login.                                                                                                                    |
| ONB-R12 | New/incomplete setup adopts v2 through the coordinated, recoverable upgrade; completed v1 preserves version/revision/completion and opens the dashboard with only a non-blocking unit prompt. Saved zones never change implicitly. Optional tasks/deeper units, unrelated edits and feature outages never reset completion or block unrelated work. Future mandatory transitions require an explicit versioned decision.                                                           |
| ONB-R13 | Authorized managers can move non-root units through drag and a complete click/tap/keyboard Move to… alternative, with old/new-path preview and confirmation. Preserve IDs, types, descendants, references, grants and completion. Reject cycles, invalid parents/depth, name conflicts and required-unit removal; a stale/failed move restores canonical structure and retains the intended destination for explicit reconciliation. No sibling sorting or coordinate persistence. |

## Contract and technical references

The adopted implementation decisions live in architecture.md. Its redesign targets are
normative for ONB-RD02 onward; existing v1 delivery remains identified separately. Accepted
targets are not claims that new routes, schemas, migrations or layouts are installed:

- [Composition and ownership](../architecture.md#onboarding-composition-and-ownership):
  one product pool, organization/setup services and application-level access orchestration.
- [Validation and bounds](../architecture.md#onboarding-validation-and-bounds): exact
  name/time-zone rules, bounded bodies, units/depth, revisions and retry retention.
- [HTTP and access contracts](../architecture.md#onboarding-http-and-access-contracts):
  request/response shapes, route permissions, public versus readiness exemptions,
  safe domain errors and browser destinations.
- [Consistency and audit](../architecture.md#onboarding-consistency-and-audit): shared
  mutation/grant locking, repeat completion, create receipts and operator retention.
- [Operations and upgrade](../architecture.md#onboarding-operations-and-upgrade): private
  command contracts and coordinated fresh/existing-installation behavior.

The [redesign plan](onboarding_redesign_implementation_plan.md) sequences delivery;
configured limits and deployment topology remain owned by architecture.md.

## Acceptance journeys

1. A freshly initialized v2 manager sees dedicated setup with no application sidebar.
   Saving the name creates exactly one root. The India suggestion is saved only through
   explicit confirmation, while a saved zone takes precedence. After profile save, Review
   links and direct activation cannot bypass First unit. Saving a direct-child Site/Plant
   enables Review/Finish setup; confirmed completion opens the dashboard exactly once.
   Repeat with a direct-child Department and no Site. The permitted workspace/DMS check
   becomes available; no approval or file capability is implied.
2. A manager saves a partial profile, exits and signs out. Another authorized manager
   resumes committed values after restart, completes profile and resumes First unit until
   a qualifying saved unit exists, then Review. A saved first unit survives save/exit,
   relogin and Back/Forward. Optional deeper structure never blocks completion.
   Clearing a previously saved required value and exiting preserves the saved value.
   An early ordinary user sees waiting, cannot read configuration or bypass the HTTP
   gate, and gains workspace access on a subsequent readiness check after activation.
3. Two administrators edit the same revision. One commits; the stale save receives a
   recoverable conflict. Replaying a lost unit-create response yields the same unit
   identity, and two completion requests yield one lifecycle outcome and audit entry.
4. A completed organization changes name, zone and units through canonical Settings and
   the same visual editor. Root/completion metadata stay stable. Invalid clearing, root
   edits, forged parents, duplicate siblings and non-leaf/referenced deletion fail. Removing
   the last qualifying unit is refused for completed v2; before completion, permitted
   removal resumes First unit. Completed v1 retains its optional-unit deletion policy.
5. Missing setup persistence returns an availability state without logging out a valid
   user or assuming completion. Live permission removal is respected. Competing private
   grants cannot remove the last local manager; an externally suspended administrator
   is recovered through private provisioning and a replacement's actual login.
6. A coordinated upgrade preserves identities, sessions, grants, enrollment, profile,
   units and saved zones. Empty/partial incomplete v1 becomes v2 without a business
   revision increment, resuming the earliest unmet requirement. Completed root-only v1
   preserves version, revision and completion actor/time and opens the dashboard directly.
   Repeat initialization changes none of that state. Setup is never inferred from login.
   Failure stays in maintenance until compatible release/recovery is verified.
7. A manager moves a subtree by Move to… and by pointer/touch drag. Both preview the
   old/new paths and confirm through the same backend operation. Descendant ancestry
   updates while identities, references and grants survive. Cycles, invalid types/depth,
   duplicate siblings, stale revisions and live permission removal fail safely; failed
   audit rolls back the entire move. Same-parent/current-revision moves are no-ops.
   Lost responses use canonical readback and explicit reconciliation without auto replay.
   Search preserves ancestor context; duplicate names under different parents are clear.
8. Keyboard and touch users can add, rename, remove and move without precision dragging.
   Completed Home/Settings navigation keeps the layout mounted, protects unsaved drafts
   and scrolls content/navigation independently at desktop and narrow widths. Collapse
   and narrow-screen overlay states retain correct focus/names/expanded state. Waiting,
   unavailable configuration, expired identity and DMS outage remain distinct states.

The plans assign PostgreSQL, Fastify, browser, image and target-environment evidence to
the corresponding packages. RD01 adopts requirements/technical decisions only; new
contracts, migrations, runtime operations and layouts remain RD02–08. ONB-I01–08 evidence
does not establish redesign acceptance. No Document Approval decision is needed to test
this release boundary.
