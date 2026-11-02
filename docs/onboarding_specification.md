# Turnstile 360 onboarding specification

**Status:** Accepted ONB-I01 implementation baseline. **Updated:** 2026-11-01.

This specification adopts ONB-R01–12 from the
[design proposal](onboarding_design_proposal.md). It defines the first onboarding
release; actual implementation and verification remain in [progress](../IN_PROGRESS.md).
The [implementation plan](onboarding_implementation_plan.md) supplies ONB-I02–08 delivery
and evidence sequencing. DMS FR/NFR requirements keep their existing IDs and ownership.

## Release boundary

An explicitly authorized, verified administrator configures the installation's existing
organization, optionally adds real sites/departments, reviews saved data and activates
the workspace. Name and confirmed time zone are the only required business inputs.
The system creates one stable organization root; an organization with no other units
is valid. Staff and customer administrators use the same shared progress and explicit
local permission. Initial accounts and access assignment remain private operator work.

The release includes Organization → Structure (optional) → Review, explicit save/exit
and resume, an ordinary-user waiting screen, backend readiness enforcement and ongoing
Settings for Setup overview, Organization profile/structure and Workspace regional
defaults. Site/Department terminology is fixed for this release; label overrides are
deferred. Units have fixed type and parent; supported editing is rename and unused-leaf
deletion. Skipping structure retains saved units. No fictional default plant is created.

Activation enables the delivered workspace and separately permitted DMS connection
check. It does not assert document upload, processing or approval readiness. Invitations,
people/access UI, custom roles, memberships, responsible people, moves, advanced taxonomy,
imports, recurring setup reminders, branding uploads, SSO and risk/safety/approval policy
remain separate scope. There is no public signup, tenant selector, new mobile application,
customer provisioning control plane or Version 1 source/data migration.

## Product requirements

| ID      | Accepted requirement and release acceptance                                                                                                                                                                                                                                                                           |
| ------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ONB-R01 | Configure only the existing installed customer. Neither forms nor API inputs can select, create or replace tenant/customer/application identity. Repeat private initialization preserves the same installation; mismatches fail.                                                                                      |
| ONB-R02 | Require verified live identity, enabled local `turnstile:access` and explicit `turnstile:configuration:manage` to read/edit configuration or complete setup. Identity administrator status, staff identity and email domain grant no product authority. Ordinary users receive only minimal readiness.                |
| ONB-R03 | Activate with a valid saved name, explicitly confirmed time zone, one stable root and a currently authorized configuration manager. Zero sites/departments is valid. The root is created automatically on the first saved name and keeps its identity through renames.                                                |
| ONB-R04 | Persist canonical organization progress across reload, logout, restart, devices and authorized administrators. Resume Organization while required profile values are missing; otherwise resume Review. Optional Structure stays accessible. Unsent edits are never reported saved.                                    |
| ONB-R05 | Enforce workspace readiness on protected business HTTP routes, including direct calls and future clients. Preserve explicitly classified setup/account/operational surfaces. Early ordinary users wait with Retry and Sign out; users without product access receive the existing denial.                             |
| ONB-R06 | Require the current organization revision for mutations; reject stale saves without overwrite. Commit changes and attributable audit atomically. Concurrent activation produces one completion and audit outcome; lost-response creation/completion retries cannot duplicate units or activation.                     |
| ONB-R07 | Onboarding and Settings use the same records, contracts, validation and backend operations. Later changes to profile, time zone and units appear on reload and in setup overview without replaying onboarding.                                                                                                        |
| ONB-R08 | Keep feature readiness separate from global completion. Activation never calls DMS or requires nonempty capabilities. DMS failure does not undo completion; authority failure retains established fail-closed login behavior. Future approval requires its own agreed policy and security boundary.                   |
| ONB-R09 | Preserve installation, authority, product and DMS ownership. No GET/startup bootstrap, cross-schema account lookup, runtime access-grant writer, service credential in browser code or implied machine enrollment. Missing schema/initialization is an operator availability fault.                                   |
| ONB-R10 | Provide keyboard-accessible responsive steps, associated field errors and announced save/status changes using the design system. Support explicit save/cancel, optional skip, in-memory error recovery, deep links and Back without workspace flashes or redirect loops. Never show activation before server success. |
| ONB-R11 | Settings cannot clear required values after activation or replace root identity. Product-controlled grants cannot remove/disable the last enabled local configuration manager, including concurrent writes. External identity suspension uses private recovery and verified replacement login.                        |
| ONB-R12 | Optional tasks, units, modules and temporary feature outages do not reset completed setup or block unrelated work. Any future mandatory transition requires an explicit versioned upgrade decision. Existing installations enter this feature incomplete through a coordinated, recoverable release.                  |

## Contract and technical references

The adopted implementation decisions live in architecture.md and are normative for
ONB-I02 onward. They are accepted targets here, not claims that routes, limits or
commands are already installed:

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

## Acceptance journeys

1. A freshly initialized, verified configuration manager saves name and time zone,
   skips Structure and activates. Exactly one root/completion exists. The permitted
   workspace/DMS check becomes available; no approval or file capability is implied.
2. A manager saves a partial profile, exits and signs out. Another authorized manager
   resumes the committed values after restart, completes missing values and reviews.
   Clearing a previously saved required value and exiting preserves the saved value.
   An early ordinary user sees waiting, cannot read configuration or bypass the HTTP
   gate, and gains workspace access on a subsequent readiness check after activation.
3. Two administrators edit the same revision. One commits; the stale save receives a
   recoverable conflict. Replaying a lost unit-create response yields the same unit
   identity, and two completion requests yield one lifecycle outcome and audit entry.
4. A completed organization changes name, zone and optional units in Settings. Root
   identity and completion metadata remain stable. Invalid clearing, root edits,
   forged parents, duplicate siblings and non-leaf/referenced deletion fail.
5. Missing setup persistence returns an availability state without logging out a valid
   user or assuming completion. Live permission removal is respected. Competing private
   grants cannot remove the last local manager; an externally suspended administrator
   is recovered through private provisioning and a replacement's actual login.
6. An existing installation preserves identities, sessions, unrelated permissions and
   DMS enrollment through backup, additive migration, explicit initialization/grant and
   compatible API/web release. Setup is not inferred from prior login. Failure remains
   in maintenance until a compatible release/recovery is verified.

The plan assigns PostgreSQL, Fastify, browser, image and target-environment evidence to
the corresponding packages. ONB-I01 creates no schema, migration, executable contract,
operator command or runtime gate. No Document Approval decision is needed to test this
release boundary.
