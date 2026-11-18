# Centrally managed Turnstile module implementation plan

**Date:** 2026-11-09. **Owner:** Thaarei. Confidential and proprietary.

**Status:** Final reviewed implementation sequence with the parent's Astra corrections
recorded in the [review record](module_delivery_review.md). Scope is requested; actual
MOD-I01's shared package, MOD-I02's central catalogue administration, MOD-I03's per-product
desired assignments, MOD-I04's selected artifacts/local-bundle POC and MOD-I05's central-first
intent/private preparation, MOD-I06 signed customer module decisions and MOD-I07 guarded
customer capabilities and MOD-I08 change/removal/recovery are implemented and locally
verified. MOD-I09 installer/staff handover integration is implemented and locally verified
with the bounded artifact-only module POC. MOD-I10 owns the evidence/release handoff;
production target rollout remains pending.
Actual evidence and limits are recorded in IN_PROGRESS.md.
Follow the [specification](module_delivery_specification.md)
for MOD-R01–20 and [architecture](../../../architecture.md#proposed-centrally-managed-turnstile-modules)
for normative component, contract, sequencing and policy choices. Track actual delivery
in [progress](../../../IN_PROGRESS.md). The earlier HTML selector is explanatory only.

## Result and first delivery

Deliver one complete vertical slice: staff chooses Incident in central, the correct
Incident-only release is available, a fresh customer setup consumes its verified intent,
both real products pair/activate, and an ordinary authorized customer sees the Incident
message with no Risk code or routes in the delivered artifacts. Then prove Risk-only,
both, dependency rejection and assignment-change behavior. No Incident/Risk business
tables or workflows are needed.

Central is the staff policy authority. A trusted external release pipeline builds; the
customer operator installs. This preserves TCP-R13's prohibition on central remote shell,
automatic deployment and arbitrary customer commands. New protocol/persistence fields
are implemented in their owning increments, not by creating migrations during planning.

## Delivery order and installer dependencies

MOD-I01–03 establish the central catalogue/assignment contract. MOD-I04 supplies selected
artifacts. MOD-I05/06 establish central-first bootstrap and signed module-aware activation.
MOD-I07 completes the actual customer placeholder slice. MOD-I08/09 cover changes,
recovery and installer integration; MOD-I10 freezes qualification.

IA-I01 must include MOD-I01 contract decisions. IA-I02 cannot freeze a combined module
release before MOD-I04's exclusion/inventory gate. IA-I03 may implement generic journals
early, but its module intent/state adapter waits for MOD-I05/06. General host/TLS/private
provisioning checks can proceed independently. Full Incident/Risk functionality and all
future modules are not prerequisites. Independent-host/production rollout still follows
the wider installer acceptance gates.

MOD-I02/03 can be developed with signed disposable catalogue fixtures through the real
intake/resolver/assignment handlers. Actual Incident/Risk customer publication and usable
delivery remain blocked on MOD-I04's real code/artifact evidence. Catalogue attestation
does not require a customer assignment; selected-profile build inventory is a separate
output. This keeps the draft/publish/assign/build sequence free of a circular prerequisite.

### MOD I01 Freeze contracts and the dependency resolver

**Requirements:** MOD-R01–04, MOD-R06, MOD-R09–10, MOD-R17, MOD-R19.

The shared implementation and frozen conventions are documented in
[contracts and ownership](module_contracts.md). Actual verification/status is in progress;
this increment does not deliver the central UI or selected customer images.

Adopt the requested scope/defaults and finalize the exact code-supported foundation
inventory from current source. Implement platform-independent catalogue/profile/intent/
assignment/result schemas and one deterministic resolver shared by central and release
tooling. Keep executable server/web entry maps out of browser/shared contract exports.
Generate scaffolds with installed CLIs where available and retain pinned toolchains.

Freeze stable module IDs, category/version rules, canonical profile digest, dependency
closure, compatibility matrix, finite errors and exact v2 decision/intention shapes from
architecture. Confirm central-reserved fresh identities versus existing local adoption.
Define the ownership matrix for every metadata field and mutating operation's revision/
receipt/reconciliation behavior. No implicit missing-dependency approval or default-all.

**Gate:** real resolver tests for independent profiles, unknown/duplicate modules, cycles,
missing dependencies, Core closure, optional integrations, incompatible catalogues, stable
canonical digests and declaration-order independence. Contract fixtures cover strict
v1/v2 separation, bounded payloads and no executable paths from staff input.

### MOD I02 Implement catalogue administration and release intake

**Requirements:** MOD-R01–02, MOD-R05, MOD-R07–08, MOD-R17–18.

Add central-owned persistence/services and owning migrations when implementing this
increment. Admin imports a code-supported release catalogue, drafts category changes and
exports a bounded immutable release/build plan. Accept publication only with verified
matching release-pipeline evidence; do not mutate a released catalogue or run code in
central. Pipeline trust/public-key provisioning is separate from central decision signing.
Persist operation receipts and audit atomically. No customer DB/migrator connection exists.

Add Admin catalogue screens and Viewer/Operator read views. Show dependencies and impacts
of promotions/demotions; reclassification applies to the new catalogue only. Unknown
source modules cannot be made assignable from a form. Enforce the graph/closed-Core rules
server-side even if the submitted draft bypasses UI validation.

**Gate:** real central HTTP/PostgreSQL tests for role/current-MFA checks, immutable versions,
publication without matching release evidence, invalid core promotion, stale revisions,
lost responses and duplicate/reordered intake. Verify no new operator/shell callback or
secret-bearing evidence is accepted. No source/code upload feature is introduced.

### MOD I03 Implement per-product assignment and dependency UI

**Requirements:** MOD-R03–05, MOD-R09, MOD-R18.

Add Modules to the Turnstile product detail. Core entries are locked; Individual entries
use checkboxes with a live graph and keyboard-equivalent text list. Selecting a module
proposes additional requirements, shows why, and requires confirmation of the complete
resolved set. Reuse current staff admission/roles/recent MFA, review-and-confirm patterns,
operation identity and current-revision controls. Do not create a role or tenant selector.

Persist an immutable approved desired assignment plus separate draft/observed/effective
states. Show Awaiting package, Ready for setup, Awaiting activation, Active, Restricted,
Upgrade required and inventory mismatch as derived facts, without overloading the existing
signed product states. A client-wide default does not mutate product assignments.

**Gate:** actual central browser/API/PostgreSQL journeys for selection, dependency review,
unauthorized mutation, concurrent staff edits, MFA expiry, lost approval response and
replay after intervening removal/suspension. Confirm catalogue changes do not rewrite
another installation's assignments and Viewer has no mutation or secret delivery.

### MOD I04 Build and verify selected customer artifacts

**Requirements:** MOD-R01, MOD-R07–09, MOD-R12, MOD-R17, MOD-R20.

Add Incident/Risk backend/web placeholder packages or feature entrypoints and selected
composition generation. Initially each requires only the fixed existing foundation.
Extend the release builder and owning Docker-only tools to use the resolver and exact
profile. Existing `nest build`/`pnpm deploy` of every source file is insufficient: assemble
an allowlisted output/dependency tree and derive public docs/assets/tools from the same
selected graph. Preserve monorepo-root build contexts, runtime security and notices.

Create a trusted pipeline request/result adapter bound to source/catalogue/profile and
platform. Reuse already verified artifacts for an identical profile across customers.
Publish/transfer through a configured private artifact location; central stores references
and verified inventory only. POC can use a verified local bundle adapter; production uses
the explicitly configured private distribution path with local scoped pull credentials.
Never derive arbitrary commands, URLs or build source from customer/staff free text.

**Gate:** build the four actual profiles, start packaged entrypoints and inspect final
image/archive contents, dependency inventories, chunks/source maps/docs/private tools.
Use a module ownership/import map plus artifact inventory, not substring matching alone,
to prove excluded implementation absence. Reject missing/substituted images and forged,
stale or mismatched pipeline results. No customer secrets/identity enters an image.

### MOD I05 Add central-first installation intent and private preparation

**Requirements:** MOD-R05–06, MOD-R08–09, MOD-R17, MOD-R19.

Add the explicit fresh-registration mode: central reserves nonsecret installation/tenant/
application IDs through retry-safe commands, with one immutable installation binding.
Issue a bounded signed intent referencing the approved assignment and verified package.
Keep pairing secrets separate and protected. Public metadata/intent alone cannot pair,
claim an existing product, fetch private artifacts or create a second live credential.

Implement a complete combined initializer/adapter from the existing DMS-only initializer
and Turnstile owning commands; do not assume that combined tooling exists. Accept verified
assigned IDs, persist them once and preserve locally generated distinct secrets. Existing standalone/local
initialization remains compatible. Existing adoption imports the actual owning export;
reject replacement of any initialized identity. Bind installer journal and artifact
verification to the intent. Expired intent renewal keeps IDs/committed operation results;
changed assignment requires explicit reconciliation/new affected operation, not reset.

**Gate:** real private initializer and central handlers for reservation retry, partially
paired products, interrupted config creation, expired/changed intent, wrong installation,
reuse/duplicate pairing, existing-state refusal and independent environment identities.
Ordinary pairing and mandatory staff activation remain closed before approval. Test
private file permissions, Windows/WSL input guidance and no credentials in output.

### MOD I06 Implement v2 signed Turnstile module decisions

**Requirements:** MOD-R05, MOD-R09–11, MOD-R14–18.

Implement strict versioned sync/decision verification and persistence in public contracts,
server-only deployment client and owning central/Turnstile adapters. Bind the installed
release/profile, immutable catalogue and allowed module set to the full existing identity/
epoch/revision/sequence. Preserve exact candidate/receipt recovery and durable denial.
No unsigned profile/status/report grants authority. Do not change DMS module semantics.

Fence module-managed products to v2 centrally and in verified local release state;
request negotiation cannot downgrade them. Stage central support first, then customer
enforcing artifacts, then explicit activation. Legacy v1 Turnstile products retain their
existing foundation policy only; they cannot receive new module assignments until the
reviewed upgrade. DMS products can remain on v1. Matrix-test mixed versions.

**Gate:** real signed HTTPS/PostgreSQL and installed adapter checks for exact binding,
wrong catalogue/profile/module set, malformed/unknown version, v1 downgrade, same-revision
content conflict, lost sync/ack, removal followed by stale replay, replacement, epoch
change, expiry/offline restart and restore quarantine. No permissive replacement handler
may stand in for the failing production handler. Existing product restriction tests pass.

Exercise every architecture decision-matrix row, including expired approved module reads,
signed suspension, prior-activated foundation reads and an unseen removal during outage.
Business modules must deny reads after expiry; foundation exceptions cannot override it.

### MOD I07 Complete the customer placeholder and capability slice

**Requirements:** MOD-R10–13, MOD-R18, MOD-R20.

Add module-aware backend capability projection and normal guarded landing endpoints.
Proposed read permissions are `turnstile:incidents:read` and `turnstile:risks:read`;
extend the owning catalogues/persistence constraints/migrations only in this increment.
Private normal administration assigns explicit demo grants; installation assignment and
protected administrator status grant none implicitly. Keep public contracts independent
of Nest and persistence. Use installed Nest scaffolds and existing web design components.

Selected web routes fetch the corresponding backend message. Derive visible entries from
the actual user's permitted installed modules. Enforce module policy in services as well
as controllers; an internal integration cannot bypass another module's local rights.
Retain ordinary login, setup, private handover, current release barrier and API-first
future-mobile boundary. No Incident/Risk domain schema, scoring or document writes.

**Gate:** full ordinary-login customer journeys against real selected production images:
Incident-only, Risk-only, both, core-only, missing user permission, local disablement,
direct URL/API bypass and unregistered excluded routes. Confirm separate DMS enrollment/
approval still governs its capability check. The graph-only design preview is not evidence.

### MOD I08 Implement change, removal and recovery transitions

**Requirements:** MOD-R02, MOD-R05, MOD-R09–11, MOD-R14–16, MOD-R19.

Implement the addition/removal transition table in architecture. Keep installed and desired
profiles separate: a new selection never activates missing code, and removing entitlement
does not pretend to erase files. Reapproval must use current staff authority and a newer
decision revision. During supported profile cutover stop/fence incompatible processes,
verify the complete matching inventory and preserve identities, local grants and data.

Record active and desired catalogue/profile/assignment context plus explicit removals.
For a mixed change, commit restrictions for those IDs and confirmed active dependants
first; additions remain pending package/activation. Apply explicit Individual unassignment
across catalogues too. Classification-only movement retains unchanged authority, but
cannot override explicit removal. Reject stale active-basis revisions and unsupported
individual removal of current Core.

Carry catalogue/assignment/effective decision evidence through supported coherent backup/
restore. Reconcile current central evidence under external quarantine/epoch rules before
private reopening. Do not downgrade to v1/non-enforcing images, restore retired secrets,
reset completion or auto-delete module data. Future jobs may finish only owning safety/
cleanup of previously admitted work; no new removed-module dispatch or user operation.

**Gate:** add Risk to an Incident-only host (Upgrade required), approved current cutover,
remove/reapprove with lost acknowledgements, intervening role/assignment change, stale
receipt replay, interrupted update, retained grants/data, classification change across
catalogues and both central/customer restore with missing independent evidence. Prove
two operators cannot activate conflicting profiles through overlapping operations.

Include Incident-only to Risk-only with delayed delivery and lost acknowledgement,
both within one catalogue and across a new target catalogue. Incident must lose effective
authority before Risk arrives, stale replay must not restore it, and both active/desired
contexts remain attributable. Separately prove pure reclassification does not revoke
unchanged rights or move existing Core implicitly.

### MOD I09 Integrate the installer and central staff handover

**Requirements:** MOD-R06–09, MOD-R17–20.

Wire the reviewed intent/profile adapter into IA-I01/02/03/05/06/07/08 at their owned
delivery points. The customer launcher resolves the verified assigned artifact, verifies
trust/digests/compatibility, prepares owning state and performs existing private pairing/
sync/handover. No host source checkout or customer-facing module classification control.
Current desired revision/profile is rechecked before affected mutation/opening; a mismatch
stops for reconciliation while preserving completed state/secrets. Use no invented command
names as instructions until the supported launcher exists.

Document central roles, package availability, protected setup delivery, independent product
approval/acknowledgement, customer identity/explicit grants and upgrade-required handling.
Production distribution checks use configured HTTPS/authentication and no arbitrary remote
fetch/redirect. Keep customer PostgreSQL/Docker/provider credentials local. No remote
deployment action is added to central. Dokploy keeps ingress/TLS ownership.

**Gate:** a second operator executes central-first fresh local setup from the actual
verified bundle without UUID transcription or ad hoc SQL. Then qualify a separate Linux/
Dokploy target and off-host recovery under the wider installer gates. POC can pass locally
while those actual production/target gates remain explicitly pending.

### MOD I10 Freeze evidence and release the implementation handoff

**Requirements:** MOD-R01–20.

Freeze exact source, installer/contract version, catalogue, assignment revision, profile,
images and target evidence. Run all workspace gates plus focused central/browser/module
build/image/integration failure-path suites. Keep fresh/rerun/recovery and negative access
evidence separate; record intentional skips and unavailable targets precisely. Finish
release inventories/notices/source-offer review and support/runbook material.

**Gate:** independent reviewer can trace every requirement to actual handler/artifact/
browser evidence and repeat the supported local POC. Production release requires its
separate accountable target acceptance; no passing placeholder test is a rollout approval.
Module source/business workflows, billing and automated deployment remain out of scope.

## Acceptance evidence matrix

| Evidence                 | Required result                                                                                                                                 | Main increments             |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| Catalogue/classification | Immutable code-supported versions, stable identities, closed Core, valid dependency graph and explicit promotion impact.                        | MOD-I01–02, MOD-I08         |
| Staff assignment         | Real admission/roles/MFA, reviewed closure, revision/receipt/audit behavior, independent installation bindings.                                 | MOD-I02–03                  |
| Physical exclusion       | Four real selected profiles; excluded implementation absent from final API/web images, dependencies, assets, docs and tools.                    | MOD-I04, MOD-I07            |
| Central-first setup      | Stable reserved IDs, signed intent, trusted artifact, private distinct secrets, independent pairing and actual acknowledgement.                 | MOD-I05–06, MOD-I09         |
| Runtime rights           | Installed/approved/enabled/user/resource gates, real login/permissions and denied internal/direct-route bypass.                                 | MOD-I06–07                  |
| Change/replay/offline    | Upgrade-required additions, effective removals, newer reapproval, stale replay denial, exact receipt reconciliation and bounded outage.         | MOD-I03, MOD-I06, MOD-I08   |
| Recovery/compatibility   | v1/v2 coexistence without downgrade; coherent quarantine/epoch reconciliation and preserved identities/data/grants.                             | MOD-I05–06, MOD-I08–09      |
| Target readiness         | Pinned verified release, source/notice material, canonical TLS/mail/private distribution, independent host/recovery and accountable acceptance. | MOD-I09–10, owning IA gates |

For implementation changes run `pnpm check`, `pnpm build`, `pnpm test` and
`pnpm test:integration`, plus the affected focused suites. Never use test actors or a
mock entitlement handler to certify production policy. Preserve non-fixture Docker data.

## First implementation task

Start MOD-I01: source-backed foundation inventory, shared strict catalogue/profile/
assignment/intent/decision contracts, deterministic dependency resolver and the operation/
trust/compatibility matrix. The first useful milestone is MOD-I03's real staff selection
and dependency review; the first complete delivery is MOD-I07's actual customer slice.
This sequence avoids building fifteen domain modules or a remote deployer first.
