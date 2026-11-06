# Thaarei deployment control plane specification

**Date:** 2026-11-06. **Owner:** Thaarei. Confidential and proprietary.

**Status:** Proposed requirements for owner review. The owner has requested a separate
central app, preferably Next.js with an integrated backend, approval before customer
Turnstile/DMS use, and health/usage visibility. The owner selected seven-day renewable
approval with daily renewal on 2026-11-06. Other timing, restriction exceptions and
staff-role policies remain recommendations. No implementation or rollout is authorized
by a planned requirement. [Architecture](../../architecture.md#thaarei-central-control-plane-proposal)
owns technical design; the [implementation plan](control-plane-implementation-plan.md)
owns delivery; [progress](../../IN_PROGRESS.md) owns actual completion.

## Product outcome and vocabulary

Thaarei staff registers a customer and its intended deployments. An authorized employee
approves the bound product installations; the customer backends obtain signed permission
to operate and report a small, disclosed summary of their health and usage. Thaarei can
see who was approved, which products/versions they report, when they first activated,
when actual activity was reported and when they last connected.

- **Client or customer:** the organization buying the software, for example MRR.
- **Installation:** that customer's deployment/environment, such as MRR production.
- **Deployed product:** a DMS or Turnstile instance in that installation. Each has a distinct
  central registration and credential. One client can have production/test installations.
- **Local DMS application registration:** Turnstile or another consumer backend permitted
  to use that customer's DMS. This already exists and stays local.
- **OAuth client:** a local login or machine-token integration, separate from all of the
  central records above. Central approval does not issue customer login or DMS tokens.

Example: MRR is one client; MRR production is one installation; its Turnstile and DMS are
two deployed products. Turnstile also has its existing local machine registration with
MRR's DMS. Another customer has separate infrastructure and credentials. A DMS-only
customer has no requirement to deploy Turnstile.

The owner confirmed a separate Thaarei Linux host and a separate Linux host for each
customer. The latter contains Turnstile web/API, DMS/local identity and their owned data,
plus the storage/processing dependencies of its selected DMS profile. Customer login and
application data stay there. The architecture
[configuration contract](../../architecture.md#two-linux-hosts-and-customer-configuration)
owns exact routing, private identity integration, secret delivery and host boundaries.

## Requirements and acceptance

| ID      | Proposed requirement                    | Acceptance                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------- | --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TCP-R01 | Separate staff access                   | Staff uses the central app's own identity/session store. Explicit admission, verification, login, logout, MFA and recovery work without customer identities. No public signup or customer access.                                                                                                                                                                                                                                     |
| TCP-R02 | Simple current authorization            | Fixed Admin, Operator and Viewer roles, with server checks at every entry. Admin controls staff/recovery/suspension, Operator maintains/approves deployments, Viewer reads. Staff disablement/role removal affects existing sessions; no custom roles or assigned-client hierarchy in v1.                                                                                                                                             |
| TCP-R03 | Controlled administration               | Explicit first-admin bootstrap and recoverable administrator policy; recent MFA for approval, suspension, pairing replacement and staff/credential administration. Secret delivery is restricted and audited without secret values.                                                                                                                                                                                                   |
| TCP-R04 | Client registry                         | Stable ID, unique bounded client code, display name and optional business contact. Create/read/search/edit/archive with revision checks and retry-safe create. Client archive is administrative and does not silently suspend products.                                                                                                                                                                                               |
| TCP-R05 | Deployment inventory and dates          | Client-bound environments and product records; show registration, approval, first activation acknowledged, first reported activity if known and latest contact separately. Show reported version and freshness. Unknown dates remain unknown.                                                                                                                                                                                         |
| TCP-R06 | Safe approved transitions               | Product registration starts pending. Pairing binds the intended local deployment; explicit staff approval enables signed activation. Reject/approve/suspend/reapprove are audited, revision-checked transitions. Approval never changes customer identity, local grants or data.                                                                                                                                                      |
| TCP-R07 | Separate product identities             | Each DMS and Turnstile deployment has its own restricted central credential. Wrong-client/installation/product submissions fail. Pairing and its recovery work after a lost response, including candidate-authenticated recovery after receipt expiry. Rotation uses durable candidate state and credential-generation fencing; replacement/revocation cannot reactivate a suspension.                                                |
| TCP-R08 | Atomic audit and evidence               | Staff changes, approval, suspension, pairing and credential events have immutable safe audit and request/receipt identity. Successful domain mutations and audit commit together. Report duplicates do not multiply usage/history. Audit and telemetry have separate retention.                                                                                                                                                       |
| TCP-R09 | Minimal disclosed reporting             | Only customer backends send approved summary fields outbound over HTTPS. No documents, filenames, OCR text, user lists, customer credentials, database access or arbitrary logs reach Thaarei. Staff sees source/time and limits of reports.                                                                                                                                                                                          |
| TCP-R10 | Approval with bounded offline operation | Before initial signed approval, normal business functions stay closed. Thereafter backends validate a cached signed approval locally. Decision state and ordering are signed; durable denial never expires into permission. Initial denial, corrupt/unknown proof, clock errors and supported restores are distinct from ordinary approval expiry. Restrictions follow the explicit policy below; no network lookup per user request. |
| TCP-R11 | Preserve local security                 | Central approval adds a product gate and cannot substitute for local login, permissions, DMS consumer enrollment, tenant integrity, application/resource checks or worker authority. No change to one customer tenant per installation. Preserve the configured login and identity-service audiences, dedicated clients and private invitation/account transport.                                                                     |
| TCP-R12 | Health and usage visibility             | Show first/last contact, recent versus stale reporting, self-reported health, product version, DMS document/storage/operation totals and Turnstile active-member/activity aggregates where implemented. Missing metrics are unavailable; missing reports mean unknown connectivity. No claim of externally verified uptime.                                                                                                           |
| TCP-R13 | Explicit remote controls                | Approve, reject, suspend, reapprove, revoke/replace a product credential and identify versions outside the configured support policy. Require reasons and show application/expiry status. No remote shell, automatic deployment, customer impersonation, data deletion or arbitrary commands.                                                                                                                                         |
| TCP-R14 | Independent hosting and recovery        | Separate central/customer Linux hosts and owning persistence; customer connections outbound only. Supported restores quarantine business/issuance until reconciliation; missing independent central evidence requires fresh approvals. Trust-key compromise requires separately authenticated trust replacement, including operator delivery offline. Arbitrary root snapshot rollback is outside this guarantee.                     |
| TCP-R15 | Coordinated introduction                | Existing installations get explicit inventory registration and approval before any enforcement guard opens. Test staged rollout/rollback without losing customer identity, grants or data. DMS integration waits for its owning branch/API contract; do not interrupt its current work.                                                                                                                                               |

TCP-R01–10 retain the IDs from the earlier registry-only draft. Their definitions above
supersede that draft, especially R07, R09 and R10: pairing, reporting and signed central
approval are now included. None of the earlier draft was adopted or implemented.

## Selected approval policy and proposed restriction behavior

**Owner selected on 2026-11-06:** initial online approval, a signed approval lasting seven
days and daily renewal. Ordinary requests continue during short central outages while
the approval is valid.

**Proposed additional behavior:** send a small report every 15 minutes. After expiry or a
received signed suspension, restrict new writes, uploads and new processing/workflows.
Retain existing authorized business reads/downloads only when verified prior activation
belongs to the current binding. Pending/rejected/never-approved products and restore or
invalid-proof states do not gain access simply because document data exists. Keep local
identity, operator recovery/backup, safety cleanup and admitted-work completion available
under their existing permissions.
Technical timing, limits, keys and protocol live only in the linked architecture section.

There is no second seven-day grace after expiration. A renewal normally leaves roughly
six to seven days of remaining operation during an outage. Suspension applies on the
next successful sync or at the existing grant's expiry if disconnected; immediate global
revocation and offline operation cannot both be guaranteed.

The selected renewable model introduces a bounded dependency on central availability.
It does not require continuous connectivity or permit indefinite offline operation.
Air-gapped/manual signed activation can be specified later if required; v1 assumes outbound
HTTPS is permitted and does not silently switch between enforcement modes.

A signed suspension already applied locally remains a denial after its envelope expires;
only an explicitly newer signed approval can clear it. Supported restores reconcile online
before reopening, because a snapshot's cached clock/revision cannot reveal later policy
changes. Central recovery requires independently preserved decision evidence or fresh
approvals rather than automatic renewal of restored active records. Trust-key compromise
is not bounded by a single grant's lifetime: disconnected verifiers need a separately
authenticated public-key trust update. The exact mechanism and limits live in architecture.

Self-hosted customers administer their infrastructure. Signed grants prevent ordinary
misbinding and forged approvals in the supported software; they do not make modified code
or customer-reported usage independently trustworthy. Billing-grade metering and hardware
attestation are outside scope.

## Staff and customer journeys

1. The customer operator exports nonsecret installation/tenant/product identities from
   local setup. Staff signs in, registers a client, adds an environment, then adds DMS and
   optionally Turnstile product records with those expected bindings.
2. Staff issues protected pairing files. The customer operator runs each product's setup
   command, which pairs it outbound. Pending status is visible both locally and centrally.
3. Staff reviews the actual bindings and approves each product. Customer backends sync,
   verify and persist signed decisions, acknowledge activation and open permitted functions.
4. Customer users continue normal local login and application use. Reports run independently
   of their requests. Thaarei staff sees summaries with separate reporting freshness.
5. Admin can suspend a deployed product with a reason. UI shows the decision time, latest
   acknowledgement and maximum outstanding approval lifetime. Reapproval is a new signed
   revision, never an incidental effect of archiving or editing a client.
6. A credential compromise or restored deployment uses a reviewed replacement/rebind process.
   Existing local consumer disablement and document rights are preserved.

Recommended navigation: Clients; client detail with Installations; product detail with
Approval, Status and Usage; Activity; Staff for administrators. Default status cards answer
“awaiting approval,” “suspended,” “not recently seen” and “version needs review.” No external
alerting service or configurable workflow engine is needed initially.

## Scope decisions still needed

1. Confirm the proposed read/recovery exception after restriction. Seven-day approval and
   daily renewal are already selected; do not ask for that decision again.
2. Confirm whether customer networks permit outbound HTTPS; identify any air-gapped need.
3. Confirm proposed local staff email/password plus MFA and three roles, or name an existing
   corporate identity provider to use instead. Assigned-client staff visibility is deferred.
4. Confirm required usage aggregates/retention and whether test environments need different
   approval terms. Billing, price plans, automatic upgrades, SMS/email alerting and remote
   support access remain separate future scope.

## Relationship to accepted DMS scope

The existing [DMS requirements](../dms/headless_dms_functionality_requirements_v1.md)
FR-02.10–14 implement local one-time enrollment and disablement. They do not establish
this central authority or its recurring reporting. The new requirement changes the prior
self-hosted/no-central-runtime-dependency expectation and needs a coordinated adoption
with FR-19, NFR-09 and DMS packaging/recovery. The DMS remains headless and independent of
Turnstile; full offline independence from Thaarei changes under renewable approvals.

This proposal does not retrospectively declare the running standalone DMS work incomplete
against its original scope, or authorize changes to that branch or customer installations.
