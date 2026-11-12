# Control-plane UI redesign

Owner: Codex · 2026-11-12 · TCP-UX-01

## Purpose and evidence

Make central administration understandable from first registration through ongoing
operation. This is a presentation and navigation redesign of implemented TCP-R01–15
and MOD-R01–20 behavior. Scope and authorization remain in their specifications;
[architecture](../../architecture.md#thaarei-central-control-plane-proposal) owns
technical boundaries. Actual delivery/checks remain in IN_PROGRESS.md.

Source audit: all App Router pages, AccessForm, AccountActions, ClientRegistry,
ClientWorkspace, PairingControls, CatalogueEditor, ModuleAssignment,
ModuleDependencyGraph, report Status/history; corresponding registry, assignment,
transition, intent, handover and access contracts/services; existing real
HTTPS/PostgreSQL/browser qualification fixtures. No usability interviews were performed.
Problems below are heuristic findings and source-backed workflow observations.

Research consulted on 2026-11-12:

- [GOV.UK complete multiple tasks](https://design-system.service.gov.uk/patterns/complete-multiple-tasks/):
  group related tasks, explain ordering and show incomplete/unavailable states. Applied
  to resumable installation workflows rather than a compulsory linear wizard.
- [GOV.UK check answers](https://design-system.service.gov.uk/patterns/check-answers/):
  make review/change paths explicit and preserve entered values before confirmation.
- [W3C status messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html)
  and [focus order](https://www.w3.org/WAI/WCAG22/Understanding/focus-order.html):
  announce asynchronous outcomes and move focus deliberately into reviews.
- Installed Next.js 16.4.5 server/client component and CSS guides; Emil design
  engineering skill: restrained motion, responsive press/focus feedback, reduced motion.

## Audit and design direction

| Before                                                               | After                                                                                           | Why                                                |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Home is a list of links and account controls                         | Overview with primary entry points and a short launch guide                                     | Give users a useful starting point                 |
| No persistent navigation or location indicator                       | Responsive sidebar, active location, breadcrumbs and account destination                        | Keep orientation between screens                   |
| New and existing installation forms have equal weight at page bottom | Explain two paths; put fresh reservation first and retain explicit existing-registration path   | Avoid requesting IDs the fresh path creates itself |
| Approval/installation facts interspersed with IDs and dates          | Product status, next action, stage progress, then expandable evidence                           | Make the next step visible without losing detail   |
| Conditional operations disappear silently                            | A visible workflow explains missing prerequisites and role restrictions                         | Unavailable operations remain understandable       |
| All access/recovery modes compete at once                            | Contextual login, enrollment, MFA and recovery actions                                          | Reduce choices at each step                        |
| Generic styling with narrow forms and long text                      | Neutral canvas, white surfaces, teal accent, consistent spacing/type and semantic status labels | Improve hierarchy and scanning                     |
| Global disabled cursor suggests loading for every lock               | Separate busy, prerequisite, permission and review explanations                                 | Explain why work cannot continue                   |

## Screen and state inventory

| Screen                    | Required behavior and conditional states                                                                                                                                                                                                                                                                                             |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Overview `/`              | Authenticated identity, current role, client/installation launch guide, real client-directory records; no fabricated fleet totals or availability claims                                                                                                                                                                             |
| Clients `/clients`        | Search name/code, active/archived/all filters, empty initial list vs no search matches, explicit pagination, Admin/Operator registration, Viewer read-only, validation, busy, lost-response retry and edit draft                                                                                                                     |
| Client `/clients/[id]`    | Active/archived, optional contacts, empty installations, fresh reservation, existing installation registration, manual product registration with conditional application ID, permanent identifiers, editable client/contact/archive, recent activity                                                                                 |
| Product within client     | DMS vs Turnstile, unpaired, pending/approved/rejected/suspended, verified pairing required before approval, reapproval, current vs historic acknowledgement, first/latest dates, manifest and module links                                                                                                                           |
| Pairing                   | Viewer manifest only; Operator issue/revoke unused code; Admin replace/revoke machine; pairing ID required only for unused-code revocation; reason, confirmation, 24-hour private transient download, redownload, current MFA, failure/retry                                                                                         |
| Catalogues `/modules`     | Separate verified code and classification versions, both pagination cursors, empty lists, Admin signed metadata import, create draft only with verified source; Operator/Viewer browse                                                                                                                                               |
| Catalogue `/modules/[id]` | Draft vs immutable released; foundation fixed Core; dependency-invalid classification, change impact, saved revision, signed publication evidence, build-plan export, new version; Admin mutation review/MFA/retry                                                                                                                   |
| Product modules           | No published catalogue, retained selection from saved version, paginated published sources, Core fixed, Individual selection, required vs optional links, dependency additions/removal closure, full-set confirmation, saved draft matching current revision before approval                                                         |
| Module lifecycle          | Every server status: unassigned, awaiting-package, ready-for-setup, awaiting-activation, awaiting-acknowledgement, active, restricted, upgrade-required, inventory-mismatch. Several may coexist; do not collapse them into a misleading green status                                                                                |
| Module setup              | Desired profile -> matching verified package -> signed intent/private customer setup -> independent pairing/product approval -> permanent v2 enforcement -> fresh exact inventory -> explicit module activation -> signed acknowledgement. Customer operator work is explained, never represented as a central remote install button |
| Module exceptions         | Archived read-only, Viewer read-only, Admin-only enforcement, legacy upgrade, stale revision, recovery not ready, missing/stale/mismatched inventory, independent DMS product, expired grant, lost reply with same operation identity, refresh/readback                                                                              |
| Reports `/reports`        | Client/environment/product filters, invalid filter recovery, no deployments, current/stale/never reporting, independent policy/local state/version/health, missing values unknown, pagination                                                                                                                                        |
| History `/reports/[id]`   | Current report and policy facts, exact UTC dates, gaps/epoch changes break gauge line, exact table with independent totals and reset markers, unknown/empty history, older reports                                                                                                                                                   |
| Staff `/staff`            | Admin only, admit employee, verification and MFA enrollment states, fixed role explanations, active/disabled, reason and current MFA, session revocation feedback, protected admin rules remain server-owned                                                                                                                         |
| Account `/account`        | Identity/role, recent MFA indication, reverify in a separate tab, sign out and failure state                                                                                                                                                                                                                                         |
| Access `/access`          | Login, initial authenticator enrollment, setup URI/recovery codes, TOTP, backup code, email verification, forgot/reset password including invalid reset entry, busy/error/success; no credential persistence                                                                                                                         |
| Shared boundaries         | Invalid/missing resource, runtime error with retry, keyboard focus, skip link, narrow-screen navigation, reduced motion, long names/UUIDs/digests, validation feedback                                                                                                                                                               |

## Plan, reviewed before implementation

1. Establish semantic tokens and shared shell, page headers, icon/status treatment,
   next-action callouts and workflow rows. Keep existing dependencies and native HTML.
2. Redesign overview and client search/registration. Restructure client setup into
   clear entry paths, installation/application cards and expandable technical evidence.
   Show stage-specific guidance and preserve every existing form, reason and receipt.
3. Redesign catalogue list/classification and module lifecycle. Keep all conditional
   operations, give each a stable section target, expose prerequisites alongside
   actions, and retain dependency graph plus readable text. Hide secondary evidence
   with native disclosures; keep primary task controls discoverable.
4. Redesign reports/history, staff, account and every access mode. Add resource/error
   boundaries and responsive keyboard-accessible navigation.
5. Add focused workflow guidance regression checks and expand existing real-browser
   journeys for navigation, registration/review, conditional controls and narrow layouts.
   Run pnpm check, pnpm build, pnpm test, pnpm test:integration. Record unavailable
   runtime verification separately. Use disposable integration fixtures only.

### Plan review and corrections

| Potential issue                                                         | Resolution adopted before implementation                                                                                                               |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| A single wizard could force an incorrect order or block returning users | Use a resumable task map, independent per-product progress and anchored sections; preserve both fresh and existing paths                               |
| Green product approval could imply module/customer access               | Label product policy, module authority, local acknowledgement and report freshness separately                                                          |
| Inferring completion from historic acknowledgement                      | Only current pairing/policy/module acknowledgement evidence determines guidance; retain historic dates as evidence                                     |
| Hidden controls could remain undiscoverable                             | Show stage/prerequisite explanations even when mutation forms are absent; distinguish role/archived restrictions                                       |
| Activating before matching inventory/enforcement                        | Guide from service-owned statuses and exact prerequisites; server remains authoritative and rechecks all state                                         |
| Archive could be mistaken for suspension                                | Explicitly explain archive semantics; retain existing permitted product-policy and credential incident controls while keeping module changes read-only |
| Cosmetic reorganization could destroy pending retry state               | Preserve operation IDs and payloads in memory until readback/recovery; lock competing module operations while a review is pending                      |
| Catalogue switching could discard a selection                           | Retain saved source lookup and existing locking; review uses the exact resolved set                                                                    |
| Silent polling could clear pairing files or unsaved input               | Use explicit refresh and keep protected downloads in page memory; do not introduce background reloads                                                  |
| Counts could look like fleet-wide totals                                | Identify bounded directory records; do not invent aggregate APIs or totals                                                                             |
| Authentication redesign could weaken access checks                      | Change presentation and contextual links only; retain every server session/MFA/role check and no-store behavior                                        |
| Browser verification could start a conflicting central stack            | Use the existing isolated ephemeral HTTPS/PostgreSQL fixture, never a central dev server on customer reserved ports                                    |

Review outcome: proceed with implementation. No unresolved scope decision requires
owner input. This review is a self-review, not an independent external usability study.
