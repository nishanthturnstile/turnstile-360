# Turnstile 360 onboarding and workspace configuration proposal

**Status:** Proposed for product review. **Date:** 2026-11-01.

Recommend a short, resumable setup for the installation's existing organization:
confirm its name and time zone, optionally add operating units, then review and
activate the workspace. Create the organization root automatically. Require
detailed structure, people assignments and approval rules only when a feature
needs them. Keep deployment and identity provisioning in the existing private
operator workflow.

This proposal covers the nine requested discovery/design deliverables. The
[Version 1 inventory](onboarding_v1_discovery.md) contains the field-level findings
and inspection limits. The [interactive design illustration](presentations/onboarding-concept.html)
shows the proposed grouping and conditional screens with fictional data; it has
no application connection or persistence. No application implementation, schema,
migration, customer provisioning or Version 1 data migration is included.

The [implementation plan](onboarding_implementation_plan.md) translates this proposal
into ordered work packages, contract/persistence integration, acceptance checks and
an existing-installation rollout. It does not begin implementation or change this
proposal's review status.

## Product context and scope

The accepted [customer deployment model](../architecture.md#customer-deployment-and-application-model)
has exactly one customer tenant per installation. Turnstile and other systems are
independently registered applications under it. There is no public tenant signup,
tenant switcher or multi-customer control plane. In the proposed scenario,
“Turnstile staff signs up for a client” therefore means an authorized operator
provisions that client's installation and account through private tooling.

The repository's [workspace plan](workspace_implementation_plan.md#subsequent-implementation)
requires a Turnstile business specification before its domain implementation.
The committed product requirements currently describe the reusable DMS, rather
than a complete Turnstile organization or Document Approval product specification.
The owner's request establishes onboarding as the next design priority; it does
not supply the detailed approval requirements. Document Approval remains a product
workflow to specify, not a capability declared complete by authentication or DMS
versioning.

| Source                                                                                                                                       | Established constraint or evidence                                                                                                                     | Effect on this proposal                                                                                  |
| -------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| [DMS FR-01.01, 01.06, 01.08](headless_dms_functionality_requirements_v1.md#01-shared-identity-tenant-bootstrap-and-application-provisioning) | One fixed tenant, repeat-safe private bootstrap, controlled provisioning                                                                               | Configure an existing installation; never create another tenant from onboarding                          |
| [DMS FR-02.07–09](headless_dms_functionality_requirements_v1.md#02-machine-authentication-thaarei-enrollment-and-access-boundaries)          | Product permissions are separate from machine authority                                                                                                | Setup rights do not confer DMS operator privileges or expose machine secrets                             |
| [Current authentication boundary](../architecture.md#turnstile-bff-and-user-authorization-boundary)                                          | Live identity/local access, explicit permissions and CSRF; authority admin does not imply product admin                                                | Bootstrap a local setup administrator explicitly; preserve the current checks                            |
| [Authentication scope](authentication_implementation_plan.md#scope-and-bootstrap-dependency)                                                 | Administrator-provisioned accounts; broad IAM and external company SSO were outside that slice                                                         | Use existing operator provisioning first; invitations and user-administration UI are separate increments |
| [Product ownership](../architecture.md#backend-composition-and-data-ownership)                                                               | Turnstile owns business state and authorization; DMS is accessed through authenticated HTTP                                                            | Onboarding is a Turnstile capability, with platform-independent contracts for future clients             |
| [DMS publication boundary](../architecture.md#independent-state-machines-and-security-coverage)                                              | Security publication and document/processing states are distinct                                                                                       | Business approval must not override the DMS security gate                                                |
| [Current progress](../IN_PROGRESS.md) and inspected contracts/source                                                                         | Auth and design system exist; product contracts expose access and DMS capability-read permissions; no organization/setup state or business roles exist | This is new product design, not a small frontend redirect over existing setup data                       |

## Findings and gap analysis

| Version 1 capability                                                          | Disposition                                 | Recommended treatment and reason                                                                                                                                                                                                                          |
| ----------------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Company name and system organization ID                                       | Retain and clarify                          | Name is editable organization profile; installation identity is fixed operator-owned metadata. Do not ask the admin to invent another tenant ID.                                                                                                          |
| Five admin hierarchy labels and nine tenant labels                            | Consolidate                                 | One organization structure editor and terminology source. Display labels do not determine permissions or fixed depth.                                                                                                                                     |
| Twenty-three unit types and fixed five-level tree                             | Improve progressively                       | Begin with Organization, Site and Department. Permit departments beneath the root for office-only organizations and optional child departments. Add specialized units when a real module requires them. Preserve stable unit identity and prevent cycles. |
| Employee as tree level, user department/location strings and employee mapping | Consolidate concepts                        | People remain people; units remain units. User memberships reference units. A contact is distinct from a unit's responsible user. No duplicate employee nodes or unrelated free-text departments.                                                         |
| Owner name/email/phone copied onto units                                      | Improve                                     | Prefer a referenced responsible person when people management exists; optional external contact details have a separate purpose. Do not require ownership on every new unit.                                                                              |
| Risk size/threshold/axis labels versus risk bands/colors                      | Consolidate and defer                       | One coherent, versioned risk configuration under the future risk feature. Require it before using risk assessment, not before opening the workspace.                                                                                                      |
| Business ID templates                                                         | Retain when needed                          | Place next to the owning module, with preview, valid tokens and collision-safe allocation. Keep internal UUIDs independent. Do not require plant codes for organization-wide documents.                                                                   |
| Manpower categories                                                           | Refine and defer                            | Employment arrangement and internal/external affiliation are separate dimensions if workforce reporting needs both. No initial questionnaire.                                                                                                             |
| Safety metric visibility                                                      | Defer to feature                            | Configure when safety reporting exists, alongside definitions and reporting inputs. A visibility switch alone is insufficient reporting policy.                                                                                                           |
| Users, role management and CSV import                                         | Stage                                       | Start with privately provisioned administrator plus narrow setup rights. Add ordinary invitations, access management and then previewable import when separately authorized. No 106-permission exercise in onboarding.                                    |
| Fixed-position RACI matrices                                                  | Retain business questions, redesign routing | Approval responsibilities should resolve against real users/groups and scope. RACI can explain responsibilities; it is not executable authorization or approval policy. Define those separately with Document Approval.                                   |
| Delegation                                                                    | Defer to feature                            | Add after workflow identity, authorization and separation-of-duties rules exist. Never grant more than the delegator's current effective rights.                                                                                                          |
| Personal preferences mixed with tenant/provider settings                      | Separate by responsibility                  | Account menu for personal preferences/security; Settings for organization policy; private operations for mail/identity provider credentials.                                                                                                              |
| White label and custom domains                                                | Defer or omit from initial scope            | Existing design system supplies usable branding. Customer logos can be a later enhancement. Enterprise plans and arbitrary custom domains are not established current requirements; Dokploy owns ingress/TLS.                                             |
| WorkOS-based SSO                                                              | Exclude from first onboarding release       | Current controlled email/password works. Any external authority/SSO increment must follow the accepted identity boundary; do not add a mandatory paid service from the reference UI.                                                                      |
| Demo credentials and sales lifecycle                                          | Remove from customer onboarding             | Not a business prerequisite. Any future demo environment should have explicit isolation and authorization scope rather than a shortcut to customer business data.                                                                                         |
| Blockchain, predictive AI, ESG and other wider-suite settings                 | Exclude from this scope                     | Version 1 labels do not establish current product requirements or verified implementations.                                                                                                                                                               |
| Setup progress, review, activation and waiting-user handling                  | Introduce                                   | Persist organization-level setup, enforce workspace readiness server-side, resume safely and show non-admins a clear waiting state.                                                                                                                       |
| Time zone and accountable setup access                                        | Introduce minimally                         | Confirm a time zone for shared dates/deadlines and ensure an explicitly authorized administrator can finish setup. Do not request extra contact/tax/industry data without a feature need.                                                                 |

The main missing foundation is a coherent relationship between organization
identity, configuration readiness, local administration rights and operational
feature readiness. No inspected screen establishes that relationship. Fresh-install
behavior and unexecuted Version 1 writes remain unverified, as detailed in the inventory.

## Configuration classification

“Mandatory onboarding” means a prerequisite for completing product setup. Some
prerequisites are already established by an operator and should never become
customer-facing form fields. “Optional onboarding” means offered briefly and
skippable. Deferring a feature's settings does not permit using that feature with
unsafe or incomplete policy.

| Configuration                                                                                         | Classification                                                                     | Minimum and rationale                                                                                     | Later home                                                           |
| ----------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Fixed tenant/customer/application identity                                                            | Mandatory prerequisite, operator supplied                                          | Same installed customer across product/DMS; not editable in wizard                                        | Private provisioning; sanitized installation summary                 |
| Verified account with active local product access and explicit setup authority                        | Mandatory prerequisite, operator supplied                                          | Someone can authorize setup and completion; identity admin alone is insufficient                          | Private access tooling initially; People and access when implemented |
| Organization display name                                                                             | Mandatory onboarding                                                               | Nonblank, meaningful name; provisioned name prefilled and confirmed                                       | Settings → Organization → Profile                                    |
| Organization time zone                                                                                | Mandatory onboarding                                                               | Valid IANA zone, prefilled from operator configuration or suggested from browser and explicitly confirmed | Settings → Workspace → Regional defaults                             |
| Organization root and default scope                                                                   | Mandatory system-created configuration                                             | One stable root permits organization-wide records without fictional plants                                | Settings → Organization → Structure                                  |
| Review and workspace activation                                                                       | Mandatory onboarding                                                               | Server validates persisted requirements and records who completed setup                                   | Settings → Setup overview, completion history                        |
| First sites, departments and their names                                                              | Optional onboarding                                                                | Add only real units known now; “Set up later” preserves the root-only organization                        | Settings → Organization → Structure                                  |
| Simple structure terminology                                                                          | Optional within structure                                                          | Default Site/Department labels; reveal rename only if needed                                              | Structure options, not another settings screen                       |
| Optional company logo                                                                                 | Post-onboarding                                                                    | No functional dependency; avoid building upload storage solely for onboarding                             | Organization → Profile, once supported                               |
| Legal name, address, country, website, tax IDs, industry, company size                                | Post-onboarding only if a confirmed use case needs them                            | No current requirement justifies collecting them; omit from the initial release                           | Profile or the relevant legal/reporting feature                      |
| Secondary administrators, team invitations                                                            | Post-onboarding; optionally suggested after activation                             | First admin is sufficient. Customer handover is an operational responsibility, not a full-team form       | People and access; private provisioning until UI exists              |
| Membership, supervisors, responsible people, job titles and contacts                                  | Post-onboarding; conditional for scoped workflows                                  | Do not block initial access on complete employee/HR data                                                  | People profile and organization membership                           |
| Custom roles, bulk import, history and delegation                                                     | Post-onboarding or feature-specific                                                | Use narrow delivered permissions first; import/delegation add separate risks                              | People and access; module workflow settings                          |
| Document categories, business numbering, reviewers, approvers, routing and separation of duties       | Feature-specific                                                                   | Validate before the corresponding approval action is enabled                                              | Module settings → Document Approval                                  |
| Risk matrix, workforce categories, safety metrics                                                     | Feature-specific                                                                   | Request only when their modules are implemented and enabled                                               | Respective module settings                                           |
| Notification event templates, reminders and escalation                                                | Feature-specific                                                                   | Require a safe default and available delivery route before relying on a workflow's notifications          | Owning module; account preferences for personal choices              |
| Locale and date presentation                                                                          | Post-onboarding with shipped defaults                                              | Ship English and a clearly labeled date format initially; time zone covers authoritative day boundaries   | Workspace defaults; personal overrides when supported                |
| Personal security and preferences                                                                     | Post-onboarding account settings; authentication policy can impose a separate gate | Preserve current authority policy. MFA is not silently introduced by this proposal                        | Account → Security / Preferences                                     |
| SMTP, issuer, OAuth clients, DMS enrollment, domains/TLS, storage/processing policies, backup/restore | Operator configuration; feature readiness where applicable                         | Never ask customer admins for backend secrets or imply a setup checkbox deploys infrastructure            | Private runbooks/operator interfaces; sanitized feature status       |
| White-label enterprise licensing, SaaS billing and multi-customer provisioning                        | Outside current scope                                                              | No established requirement for these in this installation model                                           | No new navigation item                                               |

An enabled feature cannot add an unlimited list of mandatory wizard pages. If a
future product edition requires a real site before any business operation, add that
edition's explicit readiness requirement and explain it in review. For the present
proposal, organization-wide use is valid and sites remain optional.

## Provisioning and administrator journey

Keep four processes distinct. Their records and authorization have different owners.

| Process                 | Actor and outcome                                                                                                                                                                                                    | Relationship to existing implementation                                                                                                                |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Platform provisioning   | Authorized installation operator prepares infrastructure, runtime configuration, roles/migrations and canonical origins                                                                                              | Existing deployment/auth runbooks; a fresh database cannot be repaired by a public web setup form                                                      |
| Tenant initialization   | Operator records the one fixed customer identity in DMS and product installation records                                                                                                                             | Existing explicit bootstrap; repeating the same identity is safe, another tenant/customer identity fails                                               |
| Administrator bootstrap | Operator provisions the authority account, completes supported verification, explicitly grants product access and future setup authority; provisions distinct login/machine clients and DMS enrollment as applicable | Account creation, access grants and enrollment are separate supported operations. Database bootstrap itself creates no users, clients or registrations |
| Product onboarding      | Authenticated, locally authorized setup admin confirms business profile, optionally adds units, reviews and activates                                                                                                | New Turnstile capability proposed here; independent of DMS application enrollment status                                                               |

### Fresh installation

1. Staff prepares a separate customer installation using the
   [existing runbook](runbooks/authentication.md#generate-review-migrate-and-bootstrap).
   Runtime startup does not auto-migrate, reset identity, create a default admin or
   enable public registration.
2. Staff runs the fixed tenant and product bootstrap, then provisions the initial
   named administrator through the supported authority/account workflow. The person
   chooses or receives credentials through that controlled process and verifies
   their account. Never use a universal password or “first visitor becomes admin.”
3. Staff grants that identity explicit local access plus the new setup permission
   once implemented. Distinct user-login and DMS machine clients remain separate;
   normal DMS operations require the existing enrollment boundary.
4. The admin signs in through the current authority/BFF flow. Authentication,
   current account status and local access checks complete first. The product then
   reads current setup readiness before rendering a business workspace.
5. An incomplete setup sends an authorized admin to the first unmet required step.
   Other permitted users see “Your organization is being set up” with Retry,
   account/security access and Sign out. An identity with no product access gets
   the existing access-denied experience instead of learning tenant setup details.
6. The admin confirms organization name/time zone. A single root is created or
   reused with stable identity. Optional structure changes save through the same
   organization capability used later in Settings.
7. Review shows required checks and optional work separately. “Activate workspace”
   rechecks persisted configuration and current authority in a transaction; it
   records completion once. The response opens the workspace with optional setup
   cards. It does not claim document processing/approval is operational.

If staff is the first administrator, their access must be an explicit local grant.
They can prepare and complete the same setup. Provision a customer administrator,
verify access and remove unnecessary staff rights through the operational handover
before customer production release. Temporary support expiry is a future access
capability; the first increment must not claim it exists or copy Version 1 demo access.

### Incomplete setup and returning users

Setup belongs to the organization, not the browser or the first admin's session.
Any currently authorized setup admin can resume. Sign out ends authentication and
preserves successfully saved configuration. The next login resumes the first unmet
required item, even from another device. Unsent field edits are not promised saved.
Browser Back can revisit prior steps; editing does not create another company/root.

Prefer not to offer team invitations until activation. If an operator provisions
additional users early, their account verification/recovery can proceed normally,
but business access remains gated. Grant setup rights explicitly to a second admin
only if they should help finish configuration. A later invitation feature follows
the same rule: accepting an invitation does not activate the organization or grant
setup permission. Pending invitations never count as active administrators.

## Screens and interactions

Use a focused setup shell with organization identity, account menu and Sign out.
Keep the full business sidebar out of this short flow. A visible three-item step
list reads Organization, Structure (optional), Review. On small screens show the
current step and compact progress. Progress reports requirements met and explicitly
labels the optional step; skipping it is not an incomplete mandatory task.

### Entry and organization details

Start with “Let's set up your organization” and one sentence explaining that only
essential details are needed. The form contains Organization name and Organization
time zone. Prefill a real provisioned name and configured zone where available;
show a browser-derived zone as a suggestion that the admin must confirm. Do not
silently assume a region from IP, staff device, phone or deployment location.

The administrator/account is shown as a read-only signed-in identity. Installation
IDs are not editable. A collapsed “Installation details” summary can show safe
identifiers for support without exposing credentials or backend URLs. Contact,
legal, branding and industry sections are absent unless requirements later justify
them. “Save and continue” acknowledges a committed save; “Save and exit” saves valid
progress and returns to a setup-paused page with Resume and Sign out.

### Optional organization structure

Ask “Do you want to add sites or departments now?” with two clear paths: “Set up
later” and “Add structure.” Default to a preview of the organization root, with
plain guidance that organization-wide work can start now. Do not create a fake
“Default Plant” or force the administrator to choose between industry templates.

“Add structure” reveals a compact list/tree and “Add site” / “Add department.”
Office-only organizations may add departments directly beneath the root; multiple
sites may each contain departments. Reuse the same unit editor in Settings. In
the initial editor, require type, name and a valid parent; select parent by context.
Names can be edited inline with visible Save/Cancel. Add one row at a time; no
drag-only dependency. Show ancestry when duplicate names exist under different parents.

Codes are generated or requested only when a feature needs human-readable site
references. Advanced effective dates, specialized unit types and responsible-person
assignments belong in later structure settings. Labels can be renamed through a
small terminology option without changing unit identity/type or creating new levels.
If the administrator switches back to “later,” retain saved units; offer deletion
explicitly rather than silently erasing them.

### Review and activation

Show organization name, time zone with an example local date/time, administrator
identity, and “Organization-wide scope” or a short unit summary. Each section has
an Edit link. A required checklist describes profile validity, root availability
and current setup authority. Optional missing units or teammates are separate
suggestions. Enabled feature status is a separate list with reasons and settings
links, not an inflated onboarding completion percentage.

“Activate workspace” is the one primary action. While pending, retain the review,
disable duplicate submission and announce “Activating…” without replacing the page
with an empty spinner. On success open Home and show a brief confirmation. A
retry after a lost response returns the same completed outcome. A validation
failure links to the affected field; a conflict reloads the current revision and
preserves recoverable user input; an outage shows Retry without false completion.

### Common interaction rules

- Save server-side at explicit step/section boundaries. Show Saving, Saved and
  Couldn't save states. Do not label an unsaved blur or browser draft “Saved.”
  Explicit saves are simpler for the first increment than per-keystroke autosave.
- Validate locally for prompt guidance and again on the server. Preserve entered
  values, associate errors with fields, and focus an error summary on failed submit.
  Required fields have visible labels and explanatory text only where it helps.
- A network failure preserves in-memory edits for retry. Refresh/logout warns about
  known unsaved edits where the browser permits; successfully saved progress always
  survives. Do not store sensitive profile drafts or authority in local storage.
- Reuse the current [design system](design-system.md) for fields, buttons, notices,
  dialogs, focus, typography and semantic colors. A shared editor uses the same
  validation in onboarding and Settings; layouts and surrounding guidance may differ.
- Support keyboard operation, visible focus, screen-reader step/status announcements,
  text plus icon for status, touch targets and narrow layouts. Basic structure
  editing must work without drag gestures. Respect reduced motion; no animation
  delays input or step navigation.
- Use conditional expansion for real decisions. Avoid chatbots, one question per
  field, a generic workflow-builder engine, or long animations for routine saves.

## Readiness and access rules

### Product setup state

Use a small server-owned lifecycle concept: Not started, In progress, Completed.
Completion has an actor, timestamp and completed requirement version. Step validity
is derived from persisted configuration; the current browser URL is not proof.
“Paused” can be presentation for a saved incomplete setup, without a fourth
persistent state. Activation is an atomic operation, not a long-running state machine.

| Situation                                | Admin experience                                                      | Other authorized users                         |
| ---------------------------------------- | --------------------------------------------------------------------- | ---------------------------------------------- |
| No setup started                         | Organization step                                                     | Waiting for setup                              |
| Partially saved                          | First unmet required item; saved optional units remain visible        | Waiting for setup                              |
| Completed                                | Workspace; edit through Settings                                      | Workspace within their permissions             |
| Setup status unavailable                 | Retryable availability state; do not guess incomplete/completed       | Same safe availability handling                |
| DMS or a feature unavailable after setup | Workspace remains available where safe; affected feature shows status | Same feature boundary within their permissions |

Workspace activation requires a valid organization name, confirmed time zone,
one organization root for the fixed installation and at least one current verified,
enabled product administrator able to maintain setup. It does not require every
user, site, role, risk setting or module to be configured.

Do not globally invalidate completion when a temporary service is down or a new
optional feature ships. New mandatory requirements need an explicit upgrade policy;
prefer a scoped feature gate or administrator action over suddenly blocking all
existing users. Removing a required core value should be rejected by Settings.

### Backend gate and permissions

Authentication and setup checks are separate. Session, logout, recovery and permitted
account-security surfaces remain reachable during incomplete setup. A minimal
authenticated setup-status operation may tell a locally permitted user “waiting”;
only a setup-authorized user can read/write configuration or complete setup.
Business routes enforce completion server-side, including direct API/deep-link
requests and future mobile callers. A client redirect alone is insufficient.

Add a narrow product setup-management permission with this feature. It is not
equivalent to the authority administrator role, DMS operator scope, or universal
business approval. Keep existing live local-access checks and CSRF/origin handling.
The current runtime cannot assign access grants; a future administration UI needs
an explicitly designed authorization boundary, not runtime migrator credentials or
cross-schema SQL. Do not expand database privileges merely to make a wizard work.

Setting administration does not automatically grant document review/approval rights.
Last-administrator protection covers removal, disablement and role changes within
the product; external authority suspension still requires supported operator recovery.
All state changes and permission-sensitive attempts need attributable, bounded audit.

### Feature readiness

Give each delivered module its own clear prerequisites and status. For Document
Approval, later requirements should define categories/numbering as needed, eligible
reviewers/approvers, routing scope, self-approval rules, revisions, rejection/change
loops and publication authority. Allow configuration exploration and any safe draft
work explicitly supported by that feature, while blocking submit/approve/publish
actions whose prerequisites are missing. Name the missing requirement and link
the authorized admin directly to the relevant settings.

DMS registration/enrollment, upload policy, security assessment and business approval
remain separate. Current capability lists are empty and do not establish working
document transfer/processing. Building Document Approval will need the applicable
DMS contract/audit/registry/admission/upload/security/retrieval foundations. A business
“approved” label cannot make an unassessed file publishable or retrievable.

## Dependencies and validation

| Configuration or action                   | Prerequisites                                                                          | Proposed validation and failure behavior                                                                                                                                                  |
| ----------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Setup access                              | Installed identity, verified login, current local access and explicit setup permission | Reject caller-selected tenant IDs; retain default-deny route permissions; distinguish denied from unavailable                                                                             |
| Organization profile                      | Fixed installation exists                                                              | Trim name; reject blank/control-character-only text; validate supported text bounds through shared contracts; don't use name as identity                                                  |
| Time zone                                 | Supported zone list                                                                    | Store a recognized IANA zone, with explicit confirmation; use it for business day boundaries and explain future effects of changes; timestamps retain absolute meaning                    |
| Root creation                             | Profile save and fixed installation                                                    | Exactly one stable organization root; retry reuses it; rename changes presentation, not identity                                                                                          |
| Site/department                           | Existing root and permitted parent                                                     | Nonblank name, tenant-bound parent, allowed parent/type relation, no self/descendant parent, defined sibling-name normalization; same names under different parents allowed with ancestry |
| Unit edits/removal                        | Current configuration revision                                                         | Reject stale writes; prevent orphaning children/references; archive or reassign used units explicitly; don't change historic approval scope silently                                      |
| Effective dates when introduced           | Valid unit/person and reference policy                                                 | Start no later than end; reject impossible ranges; specify date inclusivity and overlap rules before implementation                                                                       |
| Membership when introduced                | Existing eligible person and unit                                                      | Referenced identities, explicit membership role, valid effective dates; no automatic permission grant from membership or a supervisor title                                               |
| Business numbering when introduced        | Owning module and optional real site code                                              | Validate allowed tokens and length, show sample, allocate uniquely under concurrency, define counter/year scope, preserve issued IDs on template edits; no site token without a site      |
| Risk policy when introduced               | Risk module and selected matrix                                                        | Axis-label count matches size; score bands cover reachable scores without overlap; threshold is valid; version policy for existing assessments; never silently recompute history          |
| Approval route when introduced            | Scoped feature, valid users/groups and required business policy                        | Every required stage resolves eligible actors; no disabled/pending account; enforce separation of duties/quorum and revision locking as specified; never infer permission from RACI alone |
| Activation                                | Current required configuration and actor authorization                                 | Validate one authoritative revision and commit completion plus audit atomically; retries return existing completion; race cannot activate invalid data                                    |
| Profile/settings changes after activation | Section permission and current revision                                                | Reuse the same validation; retain required invariants; record actor, scope, change and time without secrets                                                                               |

The order is private provisioning → fixed installation → verified local setup admin
→ organization profile/root → optional units → activation. People membership depends
on both people and units; scoped approval depends on membership and explicit workflow
authorization. Those latter dependencies belong to their feature phases.

No database definitions or migration files accompany this proposal. On acceptance,
record adopted state/contract/security decisions in
[architecture.md](../architecture.md), which remains the technical source of truth.
The implementation should expose a safe setup read model with status, missing
requirements, current revision and permitted actions, plus separate save and complete
operations through the owning Turnstile API. Contracts stay platform-independent.
Configuration uses one canonical source shared by onboarding and Settings rather
than copied wizard fields and separate administration tables. A partial profile can
be saved during setup; each saved unit must be valid. Do not hold a product transaction
open across authority/DMS HTTP calls; preserve the established cross-service boundary.

## Workspace navigation and ongoing settings

Keep operational work in the main sidebar. Put configuration in one Settings
destination with clear local navigation; avoid separate Admin Settings and Tenant
Settings entries that both edit organization policy.

| Main destination       | Audience and content                                                                   | Availability                                                                          |
| ---------------------- | -------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Home                   | Authorized users; useful empty states and their available actions                      | Initial workspace shell                                                               |
| Documents and My work  | Users with corresponding rights; document operations and assigned review/approval work | Add only when those features are delivered                                            |
| Other business modules | Users with module rights                                                               | Only implemented/enabled modules; no Version 1 menu import                            |
| Settings               | Current administrators or users with explicit section permissions                      | Contains the administration structure below                                           |
| Account menu           | Everyone with valid account access; profile, personal preferences, security, sign out  | Preserve existing auth surfaces; add preferences/security capabilities when supported |

| Settings section                | Contents                                                                                          | Access                                                                                                      |
| ------------------------------- | ------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| Setup overview                  | Completed essential setup, remaining optional work, links and completion history                  | Setup admins; limited “waiting” status for other permitted users before activation                          |
| Organization                    | Profile; structure; terminology within structure; memberships/responsible people when implemented | Explicit organization permissions; member views can be read-only if a product requirement justifies them    |
| People and access               | Users, invitations, access/roles, import; product access audit                                    | Separate people/access administration permissions; private tools remain until these screens are implemented |
| Workspace                       | Regional defaults; supported shared preferences and notification policies                         | Workspace/settings permissions; personal preferences remain in account menu                                 |
| Module settings                 | Document Approval first when delivered; later Risk/Safety settings only with their modules        | Module-specific settings permission; no automatic authority from a job title                                |
| Integrations and service status | Sanitized readiness of supported integrations; safe next action for operator support              | Explicit administrator read access; secrets/client provisioning remain private                              |
| Audit and activity              | Product setup/configuration/access changes and applicable business history                        | Explicit audit-read permission; no access to unrelated DMS application audit                                |

The first onboarding increment only needs Setup overview, Organization profile,
basic Structure and regional defaults, together with existing account/session
surfaces. The rest describes the intended grouping as capabilities arrive, not
empty navigation entries to build immediately. Roll-up analytics belongs with
reporting, rather than the structure editor's administrative navigation.

Users return to completed onboarding data through these settings sections. Setup
overview deep-links to the same editors; the wizard does not become a second
place to edit competing data. After activation it is a historical/readiness view,
not an obligatory replay on each login.

For optional work, show an administrator-only “Next steps” card on Home with a
few relevant tasks, such as Add your sites, Add a colleague, or Configure Document
Approval when supported. Each has a benefit, link and Dismiss/Remind later option.
An ordinary user sees their permitted work, not administrative nags. Never display
“setup incomplete” after successful mandatory activation merely because optional
tasks were skipped. Feature blockers remain visible at the relevant action.

## Edge cases and recovery

| Scenario                                                      | Expected behavior                                                                                                                                                                    |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Empty/unmigrated database or missing installation identity    | Controlled unavailable/not provisioned state for the operator; no public tenant/admin creation or silent fixture bootstrap                                                           |
| Incomplete/mismatched identity bootstrap                      | Operator corrects supported configuration; never replace existing tenant/customer/application identity                                                                               |
| Admin closes tab, logs out, session expires or changes device | Preserve committed progress; reauthenticate and resume first required gap; warn about unsent edits without promising they survived                                                   |
| Two admins or tabs edit at once                               | Expected-revision checks; reject stale save with a clear reload/reconcile action; no silent last-write-wins                                                                          |
| Two activation requests or lost success response              | Atomic, repeat-safe completion and one lifecycle audit outcome; subsequent status confirms completion                                                                                |
| Permission revoked during setup                               | Live authorization blocks the next operation; retain committed setup for another authorized administrator                                                                            |
| Last product administrator would be removed                   | Reject product action and explain how to appoint another eligible admin; external suspension uses operator recovery                                                                  |
| Staff prepares setup, customer later logs in                  | Same shared progress; customer needs explicit setup access; do not treat email domain or staff role name as permission                                                               |
| Additional ordinary user is provisioned/invited early         | Verification allowed; business routes remain gated; waiting screen avoids wizard access and redirect loops                                                                           |
| Deep link or direct API call before activation                | Server enforces setup requirement and gives a stable actionable response; client sends admin to setup and others to waiting                                                          |
| Setup status service/database failure                         | Retryable availability message; preserve session where safe; never assume completion or reset progress                                                                               |
| Mail unavailable                                              | Preserve account/configuration state; retry controlled verification/invitation separately; do not report sent or add an unverified account as an active administrator                |
| DMS registration pending or DMS unavailable                   | Separate feature status and operator remediation; no enrollment secret field, repeated bootstrap or automatic re-enrollment in wizard                                                |
| Existing local installation gains onboarding feature          | Controlled upgrade explicitly grants setup authority; absent business setup means incomplete, while auth identities/data remain intact; no “existing login means complete” heuristic |
| Company rename or later new site                              | Same tenant/root identity; update canonical profile or add unit through Settings; do not restart global onboarding                                                                   |
| Unit has records, members or running approvals                | Block destructive deletion or require explicit archival/reassignment; preserve historical identities and in-flight approval policy                                                   |
| New feature or new requirement ships                          | Feature-specific setup or explicit upgrade transition; completed global setup stays complete for ordinary optional additions                                                         |
| Multi-company request under one customer                      | Clarify legal/business-unit need in a separate product decision; do not create another customer tenant or tenant switcher implicitly                                                 |
| Future import/migration is partially complete                 | Dedicated reconciliation/validation workflow when migration is authorized; never use row counts to auto-complete onboarding                                                          |

## Phased implementation roadmap

These are proposed phases, not authorization to begin implementation. Avoid a generic
onboarding engine, broad IAM platform or all-module configuration store in the first
increment. Add only the persistence and policies required by implemented behavior.

| Phase                         | Scope                                                                                                                                                                                                                                                                     | Completion evidence                                                                                                                                      |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 0 Product agreement           | Accept minimum fields/root-only organization, setup authority, administrator handover, settings grouping and approval boundaries. Establish a Turnstile product specification with proposed requirements below. Record accepted technical decisions in architecture.md.   | Reviewed requirements and design; no code/schema yet                                                                                                     |
| 1 Minimal organization setup  | Explicit operator grant for setup admin; canonical organization profile/root; server-owned setup lifecycle and revision; backend business gate; three-step accessible UI with skippable basic units; resume/waiting states; review/activation; editors in Settings; audit | Fresh installation completes with name/time zone and no sites; direct-route gate, denied admin, interruption, concurrency and repeat activation verified |
| 2 Operational administration  | Extend structure only as required; named people/access management and controlled invitations; last-admin protection; optional next steps; coherent section permissions. Retain private authority provisioning boundary until a supported UI integration is designed.      | Ordinary user and second-admin journeys; early-invite waiting and post-activation access; live revocation; invite failure/retry; no privilege escalation |
| 3 Document Approval readiness | Agree and implement approval roles/states, routing, categories/numbering where needed, separation of duties, publication/revision rules and feature setup. Complete applicable DMS dependencies before real file workflows.                                               | A real authorized document draft/review/approve/change/publish flow; missing route and ineligible approver blocked; DMS security still enforced          |
| 4 Progressive extensions      | Import with preview/results, scoped delegation, additional unit types/effective dating, reporting, branding, external SSO or safety settings only when requested                                                                                                          | Feature-specific acceptance and appropriate cross-boundary tests; no growth of global mandatory onboarding without a product decision                    |

Focused future tests should cover the actual failure boundaries: private repeat
bootstrap/mismatch, verified account versus product permission, server gate including
direct API calls, save/resume after logout/restart, root uniqueness, cycle/cross-tenant
rejection, concurrent edits and activation, lost-response retry, early-user waiting,
permission revocation and later Settings edits. Reuse existing auth/CSRF tests and
add end-to-end browser coverage for the real setup journey rather than duplicating
every field's implementation. Include keyboard/narrow-layout/reduced-motion and
honest save/error states in UI acceptance. Follow the workspace-required commands;
report container/deployed verification separately.

### Proposed product acceptance requirements

These proposed ONB-R IDs belong to this design proposal pending product agreement;
they do not change existing DMS FR IDs or imply implementation.

| ID      | Proposed acceptance requirement                                                                                                       |
| ------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| ONB-R01 | Configure only the installation's existing customer; reject tenant selection or mutation                                              |
| ONB-R02 | Require verified identity, current local access and explicit setup permission to edit/complete setup                                  |
| ONB-R03 | Activate from valid name, confirmed time zone and one stable organization root; sites and departments are optional                    |
| ONB-R04 | Persist shared progress across sessions/devices and show the first unmet required item                                                |
| ONB-R05 | Enforce incomplete-setup restrictions in the backend with explicit setup/account exemptions and a waiting-user experience             |
| ONB-R06 | Save changes against a current revision; complete setup atomically with repeat-safe outcomes and attributable audit                   |
| ONB-R07 | Use the same canonical configuration and validation for onboarding and ongoing Settings                                               |
| ONB-R08 | Keep module readiness separate from global setup; missing feature policy blocks only the applicable operations                        |
| ONB-R09 | Preserve installation/authority/DMS ownership and service-secret boundaries; no runtime bootstrap or implicit administrator           |
| ONB-R10 | Provide accessible responsive steps, explicit save/error states, optional-step skip and recovery from interruptions                   |
| ONB-R11 | Preserve required core settings after activation and protect against removing the last eligible product administrator                 |
| ONB-R12 | Keep completed organizations usable when optional tasks or modules are introduced; define any mandatory upgrade transition explicitly |

## Decisions for product review

The recommended defaults are concrete enough to review without further discovery:
organization-wide operation is valid; name/time zone are the only mandatory business
inputs; root creation is automatic; units are optional; initial accounts remain
controlled; team invitations follow activation; and Document Approval has its own
readiness gate. Confirm these choices before implementation.

Document Approval still needs decisions on reviewer versus approver roles, allowed
self-approval, single/multiple stages and quorum, site/department scope, rejection
and changes, replacement/delegation, effective publication, retention and the
relationship between approved business revisions and DMS binary versions. The
Version 1 RACI display does not settle those choices. Neither a complete staff
directory nor every Version 1 configuration should become a prerequisite while
those feature requirements are being agreed.
