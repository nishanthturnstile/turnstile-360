# Thaarei deployment control plane implementation plan

**Date:** 2026-11-06. **Owner:** Thaarei. Confidential and proprietary.

**Status:** Owner-authorized delivery baseline; TCP-I01 adopts policy/architecture on
2026-11-06. Runtime delivery follows the sequence below; actual completion is tracked in IN_PROGRESS.md. Follow the
[specification](control-plane-specification.md) for TCP-R01–15 and
[adopted architecture](../../architecture.md#thaarei-central-control-plane-proposal)
for technical choices, protocol, timing and limits. Actual work and dated verification
belong in [IN_PROGRESS.md](../../IN_PROGRESS.md). The earlier five-increment registry-only
draft is superseded by the sequence below; its increments were never implemented.

Deliver a single central Next.js application first, then integrate the two customer
backends. Central approval must work end to end before it is advertised as enforcement.
No preliminary scaffold or dashboard counts as a functioning control plane.

## Existing foundation and missing capability

| Area                  | Already planned or present                                                                     | Added work                                                                                 |
| --------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| Deployment model      | One tenant per customer installation; multiple independent DMS consumers                       | Central client/installation/product inventory, preserving that local model                 |
| User authentication   | Customer-local Better Auth authority and Turnstile BFF                                         | Separate staff identity, sessions, MFA and fixed staff roles in Next.js                    |
| Machine authorization | Local client-credentials tokens, scopes, active registrations and resource policy              | Per-product central credential and signed deployment decision; existing checks stay        |
| Enrollment            | Local operator issues a bound one-time key; DMS activates pending consumer                     | Central pairing, employee approval and renewable product activation                        |
| Visibility            | Local health/security telemetry; DMS-I18 operational projections under construction separately | Disclosed outbound summaries and central status/usage history                              |
| Distribution          | Standalone DMS delivery in another branch                                                      | Coordinated activation/reporting integration after its contracts settle; no live patch now |

The separate DMS checkout was inspected read-only for the current I18 handoff and enrollment
boundary. This branch is based on development's earlier committed foundation. Reuse current
upstream APIs through development when integrating, rather than copying unfinished source
or treating older status tables as a complete current implementation inventory.

## TCP I01 scope and architecture adoption

**Requirements:** all TCP requirements; resolves cross-product policy before code.

**Adoption record, 2026-11-06:** The owner explicitly accepted the remaining defaults.
The selected version/configuration contract, staff policy, decision states and operation
classification are maintained in [architecture](../../architecture.md#operation-classification-and-decision-types).
DMS requirements, blueprint and standalone runbook reference the staged scope. This
record adopts design only; actual completion/verification is maintained in IN_PROGRESS.md.

- Preserve the owner-selected seven-day approval/daily-renewal policy. Settle the proposed
  read/recovery exception after restriction. Confirm staff identity, MFA, role
  visibility, reported fields, retention, supported environments and outbound connectivity.
- Adopt the selected architecture section and update DMS enrollment/operations/offline
  requirements, product blueprint and standalone install/recovery references coherently.
  Clearly separate local consumer enrollment from central product approval.
- Confirm the central application path, isolated environment/fixed ports, hostname/TLS,
  database, SMTP and backup/signing-key ownership. Use the explicit
  [two-host configuration contract](../../architecture.md#two-linux-hosts-and-customer-configuration):
  separate central/customer networks and persistence; customer auth, DMS and Turnstile roles;
  full DMS dependencies; combined-origin login and private identity-service audience/client/
  scopes/transport. Do not infer production routing from Vite proxies. Select compatible Next.js/CLI and
  Better Auth adapter/plugin versions; retain repository pins/patches and notices.
- Finalize typed decision states and operation classification: every Turnstile business
  route, DMS admission/download/private work path, recovery route and safety task needs a
  named policy for pending, rejected, never-approved suspension, active approval, natural
  expiry, prior-activated suspension, invalid stored proof, clock error and restore quarantine.
  Distinguish identity recovery/setup from invitation acceptance that grants new product
  access; recovery exceptions must not authorize new business grants while restricted.
  Ingress/process readiness must preserve initial pairing/reporting and recovery routes
  while business readiness is closed. Freeze supported restore/trust-recovery procedures.

**Gate:** owner-reviewed scope/policy and coherent architecture/contracts roadmap. No
runtime flag, schema or customer deployment changes are part of adoption alone.

## TCP I02 central foundation and employee access

**Requirements:** TCP-R01–03, R08, R14.

- Generate the Next.js application with its installed pinned CLI. Add workspace build,
  Biome, type/dependency checks and a production Node container; no separate API service.
- Introduce owned auth/staff persistence and migration/runtime separation. Generate the
  required Better Auth schema using the exact installed CLI; review plugin migrations.
- Implement private first-admin bootstrap/recovery, explicit employee admission, verified
  email/password, MFA, recovery, sign-in/logout and current role enforcement. Central
  staff auth is not an OAuth issuer for customer DMS calls.
- Implement server-only authorization helpers used by rendering and every mutation/API.
  Prevent last-admin lockout. Preserve exact-origin/CSRF checks, persistent rate limiting,
  secret redaction, safe session DTOs and audited staff changes.

**Gate:** real Next HTTP tests for public/customer denial, direct handler/action bypass,
stale staff sessions after role removal/disablement, MFA/recovery, logout and last-admin
protection. Verify secure cookies and origin policy through the intended proxy headers.

## TCP I03 clients and deployment approval records

**Requirements:** TCP-R04–06, R08, R13.

- Deliver client list/search/create/detail/edit/archive with stable code uniqueness,
  revision conflicts, idempotent create and saved readback. Keep archive separate from
  suspension and prevent hard deletion from erasing history.
- Add installation/environment and deployed-product records with immutable binding IDs.
  Use owned constraints to prevent mismatched client/installation/product references.
- Implement pending, approved, rejected and suspended policy transitions with revision,
  reason, actor/time and transactional audit. Do not allow approval before pairing verifies
  expected bindings. Reapproval is explicit. Keep observed health out of policy state.
- Present exact dates separately. Record “approved but not yet acknowledged” until a
  product reports applying its grant. Admin/Operator/Viewer controls work in UI and backend.

**Gate:** PostgreSQL/HTTP tests for duplicate creation races, stale updates, cross-record
binding, denied roles, repeated approval and concurrent suspend/approve. A response lost
after commit must recover the same created record without a second audit mutation.

## TCP I04 machine pairing and signed decisions

**Requirements:** TCP-R06–08, R10–11, R13–14.

- Deliver strict versioned activation/sync/rotation contracts and generated OpenAPI from
  platform-independent schemas. Do not expose staff service functions as machine APIs.
- Implement the nonsecret setup-manifest export, staff pairing issuance/revocation and
  private per-product setup flow. Durably persist request ID, exact binding and candidate
  secret before transmission. Consume pairing and save its digest/receipt atomically;
  retain only safe metadata centrally. Candidate-authenticated sync recovers a committed
  pairing even after its receipt expires; an unrecognized candidate needs reviewed repair.
- Implement least-authority product-key authentication, approval signing, pinned public-key
  verification and monotonic local decision persistence in the server-only public package.
  Sign the discriminated decision state, full binding/epoch, policy revision and monotonic
  decision sequence. Initially validate denial envelopes, then persist denial beyond their
  expiry; only newer approved revisions clear them. Equal-revision renewal preserves state
  and orders by sequence. Outer unsigned statuses grant nothing. Signing keys are distinct
  from staff auth/customer authorities; adopt trust updates through a separate protected
  operator/release authority, not solely a token signed with the entitlement key.
- Sync can return pending or signed suspension as well as approval; authenticated contact
  is not sufficient authorization. Fence grant issuance against current policy revision.
- Implement credential rotation with a shared product operation lock, credential-generation
  compare-and-swap and durable current/candidate/operation journal. Fence operator commands
  as well as reporters. Confirm the candidate before atomic promotion/reload; do not hold
  a database transaction across HTTP. Define replacement, routine key overlap, emergency
  trust-key revocation and supported restore/rebind quarantine. Arbitrary root/VM snapshot
  rollback remains outside this mechanism's guarantee.

**Gate:** actual route-handler and client tests for wrong credential/binding/audience/type/
algorithm/key, expired/revoked/used pairing, concurrent pairing and lost pairing response.
Exercise delayed active responses after suspension, response loss during rotation, restart
with cached decision, malformed report, clock rollback, unknown verification key and replay
after intervening suspension/rebind. Include denial-envelope expiry without fallback,
equal-revision out-of-order renewal, unsigned outer-state changes, pairing recovery beyond
receipt expiry, simultaneous rotations and crashes before/after local secret promotion.
Assert customer tokens and staff cookies fail machine
APIs and central machine keys fail local DMS APIs. Use maintained crypto, not fixture-only
signers that skip the production verifier.

## TCP I05 DMS activation and reporting integration

**Requirements:** TCP-R07, R09–12, R14–15.

- Coordinate with DMS-I18 after its owning operational/packaging contracts are available.
  Add DMS-owned state/migrations for central credential metadata, applied decision and sync receipt;
  do not add product/Turnstile dependencies or expose private operator database access.
- Put the single DMS reporter in the existing coordinator process with an election/lease
  for replicas. API replicas read the same DMS-owned decision; reporter failure does not
  erase it. Feed only DMS-owned summary projections into outbound sync. Mount the protected
  central secret only into coordinator/setup processes; APIs need persisted verified
  decisions and public keys. Map every new config value into the owning Compose process,
  validate canonical central URL/issuer/trust and qualify DNS/TLS/proxy/CA egress. Preserve
  private broker/storage/parser isolation and read-only-container secret compatibility.
- Add explicit deployment-approval checks alongside existing machine and resource policy.
  Classify admission, file-transfer issuance, processing/reprocessing and ongoing private
  work under the adopted restriction policy. Pending installations allow only bootstrap,
  identity, diagnostics and recovery, not document use.
- Preserve existing consumer enrollment exactly: approval cannot activate a pending local
  consumer or re-enable a disabled one. Supply a complete combined customer release overlay
  for the existing Turnstile auth/identity integration; I18's DMS-only manifest and the old
  three-app Compose are not that overlay. Keep the DMS-only profile working independently
  with explicit screen/client policy if local user login is needed.

**Gate:** real DMS public/private handlers with local authority, PostgreSQL and storage/work
fixtures: never-approved denial, approved operation, expiry/suspension restriction, existing
authorized retrieval, permission denial in restricted mode, admitted-work completion and
no new dispatch after restriction. Test central network outage separately from local issuer
outage, restarts, revoked local consumer after central reapproval and approved DMS-only use.
Verify local schemas and actual report source; no cross-database fixture shortcut. Include
never-approved data-bearing restores, suspension before first activation, expired/unknown
proof and restore quarantine. Prove central-unreachable cold start cannot deadlock the
reporter, identity or health endpoints. Confirm the complete customer overlay, not only
isolated package code, supplies the process settings and trusted egress.

## TCP I06 Turnstile activation and reporting integration

**Requirements:** TCP-R07, R09–12, R14–15.

- Add Turnstile-owned state, replica-safe periodic reporter and approved aggregate provider.
  Use the same server-only protocol library with its own product credential; never reuse
  the DMS central credential or import DMS source/database code. Add owned environment
  validation, explicit production Compose mappings and durable read-only-mounted secret/
  public-key delivery. Keep central origin/config entirely out of Vite and customer OAuth
  settings; do not add browser CORS/CSP permissions for the reporting channel.
- Enforce local product approval alongside current session, permissions and readiness.
  Present an explicit installation activation/restriction page with safe status and retry
  guidance; keep approved local identity/recovery paths accessible as specified.
- Persist and acknowledge applied decisions. Continue local Turnstile-to-DMS HTTP machine
  access; show a distinct DMS restriction if Turnstile is approved but DMS is not.

**Gate:** real browser-to-Turnstile-to-DMS journeys: pending, approval, normal local login,
business denial on expiry/suspension, authorized existing reads, permission removal and
independent DMS restriction. Exercise actual invitation issuance, recipient identity setup/
acceptance and account projection: private token and `/internal/identity/v1/*` transport,
matching identity-service audience, distinct scopes/client and exact registered screen/
callback policy must all work. A passing sign-in case alone is insufficient.
Central credentials/decisions must not create a user session
or appear in web bundles, browser storage, customer logs or ordinary API responses.

## TCP I07 usage and health views

**Requirements:** TCP-R05, R08–09, R12–13.

- Implement bounded report snapshots, server receive times, latest-state projections,
  idempotent receipts and explicit report/counter epochs. Retain/reset/prune under the
  architecture policy without deleting active identities or approval evidence.
- Display approval state separately from reporting freshness and self-reported health.
  Support per-client/environment/product filtering, version review and simple usage history.
- Define each counter at an owning authoritative commit: distinguish active-document/storage
  gauges from cumulative published/upload/processing totals and active-member gauges.
  Retries, new versions and restores must not masquerade as new logical documents.
  Missing/not-yet-implemented metrics remain unavailable. No customer names/content/users
  appear in report payloads. Do not use report gaps to auto-suspend a deployment.
- Show stale, pending, rejected, suspended, expiration and configured version-policy notices
  in the app. Defer external notifications, billing calculations and autonomous remediation.

**Gate:** duplicate/lost-ack reports, out-of-order snapshots, stale reporter lease, resets,
counter rollover bounds, invalid metrics and missing intervals all preserve correct totals
and latest state. Derive reports from real product handlers, including duplicate requests;
assert schema/privacy boundaries and one source per displayed metric.

## TCP I08 release and recovery qualification

**Requirements:** TCP-R10–15 and the cross-product acceptance chain.

- Build and inventory exact central/DMS/Turnstile images. Validate central persistence,
  proxy headers/TLS, SMTP, signing-key delivery, outbound DNS/TLS/time and secret handling
  in the target-like isolated two-host topology. Check customer `/api`, `/identity`, exact
  metadata and controlled DMS/transfer routing; private identity/job routes remain private.
  Qualify customer canonical-issuer DNS/TLS from containers and both outbound central
  reporters. No reporter success is counted as frontend availability. Customer ingress
  requires no new central callback.
- Run a two-client fixture with separate customer stacks and distinct product registrations.
  Prove one client's credentials, grant or reports cannot bind/read/approve another.
- Rehearse supported restore with external quarantine markers before database replacement.
  Customer writes remain closed until online reconciliation/rebind; cached revision/time
  does not detect rollback. Central issuance stays closed until independent retained
  evidence establishes current decisions; if evidence is missing/incomplete, require
  explicit fresh approvals and rebind. Test a central backup older than a suspension,
  customer backup older than local denial, unavailable evidence and disconnected recovery.
- Exercise credential-file recovery, expired-grant reconciliation and normal key rollover.
  Separately exercise compromised signing-key revocation via authenticated out-of-band
  trust-bundle replacement on an offline installation. Never claim the approval lifetime
  alone bounds forged successive grants or arbitrary root-level snapshot rollback.
- Stage existing-installation inventory/pairing/approval before opening a new enforcement
  release. Review the currently running customer's cutover separately; no rollout against
  it is part of planning or ordinary fixture verification.
- Document upgrade/rollback compatibility and explicit operator handover. A planned rollback
  must not become an unsigned routine bypass or delete customer credentials/data. Publish
  only with the separately authorized deployment/release scope.

**Gate:** `pnpm check`, `pnpm build`, `pnpm test`, `pnpm test:integration`, focused browser
journeys and real-image/recovery checks pass for the exact release. Test a blocked central
connection until grant expiry using controlled clocks, not a multi-day sleep. Distinguish
static/source checks from actual container/target evidence; report unavailable checks.

## Dependency order and parallel work

TCP-I01 → I02 → I03 → I04 establishes central identity, records and protocol. I05 and I06
consume I04 and their owning product baselines; I07 consumes their actual report sources.
I08 qualifies the complete chain. An isolated central app can be built while standalone DMS
continues; customer enforcement changes must wait for coordinated integration. Use HTTP
contract fixtures before then, labeling them as contract tests rather than deployed proof.

Work stays on branches from current development and separate worktrees. Integrate shared
contracts/manifests/lockfiles and architecture via development, preserving DMS handoffs.
No copying or resetting the current DMS checkout, no fixture use of its runtime ports,
credentials or volumes, and no migration on the owner-test installation.

## Definition of complete

A staff member can register and pair two separate customer installations, approve each
product, and see acknowledged activation plus real disclosed reports. Each customer's
Turnstile and DMS refuse initial business operation without the correct approval; preserve
local auth/resource isolation; obey the selected outage/restriction policy across retries,
restarts and recovery; and expose actionable status without transmitting customer data.
Release qualification includes configured login and invitation/account identity flows,
protected settings/secret delivery on both hosts, supported restore quarantine and durable
denial/credential fencing. Pending decisions and unsupported root/VM rollback remain
explicit limitations, not missing mechanisms hidden behind a green source test.
The central UI alone, mocked reports or only a working signed-token helper do not satisfy
this use case. No work is marked implemented until its owning gate and evidence are recorded.
