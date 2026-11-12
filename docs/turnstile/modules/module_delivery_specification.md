# Centrally managed Turnstile module delivery specification

**Date:** 2026-11-09. **Owner:** Thaarei. Confidential and proprietary.

**Status:** Reviewed owner-requested implementation proposal; Astra findings corrected by
the parent as recorded in the [review record](module_delivery_review.md). This extends
the requested POC to real central assignment and signed customer enforcement. Earlier
suggestions to leave central entitlements outside the POC are superseded. Application
implementation follows the reviewed increments. Actual completion and deployment limits belong in
[progress](../../../IN_PROGRESS.md).

Thaarei staff chooses the modules for a customer's specific Turnstile installation in
the control plane, sees dependencies and confirms the complete selection. The customer
operator receives a matching verified release and installation intent. After private
setup, pairing, staff activation approval and ordinary customer login, only installed,
approved and locally permitted modules are usable. Registration supplies authorization
and a delivery plan; it cannot make missing code appear on the customer host.

[Architecture](../../../architecture.md#proposed-centrally-managed-turnstile-modules) owns
components, trust, contract and transition details. The
[implementation plan](module_delivery_implementation_plan.md) owns MOD-I01–10. This
specification owns MOD-R01–20 and the POC acceptance below. The
[installer plan](../../deployment/installation_implementation_plan.md) retains its wider
installation scope, with explicit module prerequisites.

## Two central responsibilities

**Catalogue administration** defines the versioned product offering. Admin staff can
propose Core/Individual classification changes for code-supported modules and inspect
dependencies. Publication requires a matching verified release catalogue. No staff form
can create executable functionality by naming a module or uploading a plugin.

**Customer assignment** selects from a released catalogue for one registered Turnstile
product under a customer installation. Core is always included and shown as required.
Authorized staff selects Individual modules, reviews additional required dependencies
and confirms the resolved set. Selecting dependencies does not assign any customer user's
roles or permissions. Different test/production installations can have different selections.

Core classification is shared by that catalogue version, not changed separately per
customer. A customer's preferred bundle is an assignment, not a new definition of Core.
Future classification changes preserve module identity but require a new verified
catalogue/release and deliberate installed-customer update.

## POC scope

Retain the current foundation: authentication/session handling, canonical access,
organization/setup, existing People/admin, deployment control and current integration
boundaries. It is a fixed base for this POC, not a request to redesign those features.

Add two Individual modules, initially dependent only on this foundation:

- `incident-management`, displayed as Incident Management, with a landing endpoint/page
  saying “You are in Incident Management.”
- `risk-management`, displayed as Risk Management, with a landing endpoint/page saying
  “You are in Risk Management.”

These are real selected backend/frontend components behind normal authentication and
explicit read permissions. There are no incident records, risk scoring, workflows,
document operations, domain tables or business migrations in this POC. DMS remains a
separate product with its own independent approval and local consumer security.

Prove Core only, Core+Incident, Core+Risk and Core+both as actual immutable artifact
profiles. A fixture catalogue can demonstrate Risk requiring Incident; this is a validator
test, not an adopted Incident/Risk business dependency. A visual-only selector or hidden
menu cannot pass the POC.

## Requirements and acceptance

| ID      | Requirement                               | Acceptance                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MOD-R01 | One trusted versioned catalogue           | Stable module IDs, exact code-supported versions, category, required dependencies and optional integrations. Core/Individual lists derive from it. Released catalogues are immutable and bound to verified source/release evidence.                                                                                                                                                                                               |
| MOD-R02 | Controlled classification changes         | Admin can draft a promotion/demotion centrally. Publish only after compatible release verification; reject unknown modules, cycles, inconsistent versions and Core depending on Individual. Existing catalogue versions/installed customers do not change in place.                                                                                                                                                               |
| MOD-R03 | Installation-specific assignment          | Admin/Operator selects modules for exactly one Turnstile product; Viewer can read only. Core entries are required, not removable checkboxes. A client-level default never grants rights to every installation. No new tenants, applications or OAuth clients per business module.                                                                                                                                                 |
| MOD-R04 | Visible complete dependencies             | The staff checklist and accessible graph identify required versus optional edges, missing dependencies and affected dependants. Automatically proposed dependencies require explicit review/confirmation before assignment; never silently grant an unselected business module. Keyboard/list operation works without dragging.                                                                                                   |
| MOD-R05 | Safe audited assignment commands          | Recent MFA, reason, current revision and stable operation identity protect committed assignment changes. Receipt/state reconciliation handles lost responses and competing staff changes without duplicate approval or stale policy resurrection. Success and audit commit atomically.                                                                                                                                            |
| MOD-R06 | Central-first fresh registration          | Staff can reserve fresh nonsecret installation/tenant/application identities and prepare the selected profile before the customer host exists. A verified intent drives fresh-only local initialization once. Existing-installation adoption preserves exported real identities and cannot use this path to replace them.                                                                                                         |
| MOD-R07 | Immutable selected release                | Build only validated supported module sets from one source baseline. API/web images, dependencies, private commands, docs/assets and migration inventory match the profile. Excluded implementation code is absent, not merely unregistered. Reuse the same generic profile across customers; never embed their secrets or identities in images.                                                                                  |
| MOD-R08 | External build and protected distribution | Central records a bounded declarative request/result, not shell commands. An authorized release pipeline builds/verifies and publishes artifacts through existing release facilities. The operator retrieves a digest-pinned authorized bundle with local protected credentials; central has no customer Docker/migration credentials or inbound deployment agent.                                                                |
| MOD-R09 | Desired versus installed versus effective | Show approved assignment, target package availability, reported installed profile, applied signed policy and mismatch/upgrade status separately. An approved selection is not evidence of installation or activation. Unsupported additions show Upgrade required until a compatible artifact is installed and acknowledged.                                                                                                      |
| MOD-R10 | Explicit signed module policy             | Extend Turnstile's strict machine decision contract with catalogue/profile/module authority under a fenced protocol version. Bind it to the existing product/installation/tenant/application/epoch and monotonic decision order. Unknown, malformed, wrong-profile, downgraded or restored proof never grants all modules. DMS v1 behavior stays independent.                                                                     |
| MOD-R11 | Complete runtime enforcement              | Backend HTTP, module application services and future jobs/integrations require installed code, current module authority, local enablement, actor/resource permission, product approval and readiness as applicable. Internal calls cannot bypass the called module's policy. Dependency inclusion creates no user permissions.                                                                                                    |
| MOD-R12 | Backend-derived customer navigation       | The current user's backend capability projection supplies permitted installed entries. Web composition excludes unshipped routes/chunks; direct URLs or browser flag changes cannot open unavailable APIs. Preserve the existing identity/setup/recovery exceptions.                                                                                                                                                              |
| MOD-R13 | Real placeholder vertical slice           | Actual Incident/Risk endpoints and pages return their simple messages using ordinary user login and explicit read grants. Test both allowed and denied access against the actual composed backend and packaged entrypoints. No synthetic target administrator or changed verification flag.                                                                                                                                       |
| MOD-R14 | Controlled additions and removals         | Apply explicit removals and affected-dependant restrictions first in mixed/cross-catalogue changes; stage additions until compatible delivery/activation. Old grants cannot authorize a new profile. Removal stops all removed-module business access on receipt of the newer policy, while preserving data and private recovery. Restoring the module needs explicit newer approval and current local rights.                    |
| MOD-R15 | Bounded offline operation                 | Retain product timing/renewal and durable denial, but require current signed authority for every catalogue-managed business operation, including reads; foundation exceptions cannot override this. Valid cached module decisions support bounded outages; unavailable central cannot grant a new module. Applied removal stays a denial after envelope expiry. Explain that disconnected removal waits for sync or grant expiry. |
| MOD-R16 | Restart and recovery safety               | Retain coherent release inventory, external recovery markers, epochs, credential retirement and current-decision reconciliation. Restore cannot revive stale assignments or removed modules. Supported image rollback never crosses the module-enforcement barrier. No automatic module-data deletion.                                                                                                                            |
| MOD-R17 | Separate trust and private inputs         | Verify release artifacts with provisioned release trust and decisions/intents with provisioned central trust, each with fixed issuer/type/audience rules. A public intent grants no pairing or registry access. Private pairing files/service/provider credentials stay in protected files and owning processes, never URLs/browser storage/logs.                                                                                 |
| MOD-R18 | Minimal attributed reporting              | Send only bounded module IDs, catalogue/profile/release identifiers, applied decision/revision and finite status. Treat installed inventory as self-reported, not attestation or externally verified uptime. No user lists, business records, document data or module activity telemetry is added.                                                                                                                                |
| MOD-R19 | Installer compatibility                   | The installer validates retained identity, intent revision, exact artifact/catalogue/profile and protocol compatibility before the affected stage. Resume reconciles changed assignment/outcomes without regenerating secrets, overwriting business data, silently choosing another bundle or bypassing staff activation.                                                                                                         |
| MOD-R20 | Proven acceptance and handover            | Freeze source/contract/catalogue/assignment/profile/image identifiers and test fresh setup, exclusion, dependencies, actual central/customer HTTPS, lost acknowledgements, revocation, mismatch, upgrade-required and recovery. Keep POC/local evidence separate from independent-host and production acceptance.                                                                                                                 |

## Staff and customer journey

1. Staff registers the client and intended installation/products. Fresh registration
   reserves identities centrally; existing adoption uses the owning local export instead.
2. On the Turnstile product's Modules tab, staff chooses a released catalogue, sees Core
   locked as required, checks Individual modules and reviews the dependency graph/list.
3. Review shows the complete requested/resolved set and impact. Current MFA plus an
   explicit reason commits an immutable assignment revision. This is not activation.
4. Central identifies an existing verified profile or records Awaiting package. The
   trusted external release pipeline supplies the matching verified artifact inventory.
5. Staff downloads the installation intent and separately protected pairing material.
   The customer operator's supported launcher retrieves/verifies the correct bundle,
   preserves local secrets and initializes the reserved identities through owning commands.
6. Both products pair independently. Staff reviews actual reported bindings/inventory and
   explicitly approves activation with current MFA. A matching signed Turnstile decision
   is applied and acknowledged; DMS maintains its separate approval/acknowledgement.
7. The customer administrator completes normal identity, protected handover and workspace
   setup. After login, entries reflect the actual installed/approved modules and their
   explicit permissions. Registration never marks a customer email verified or grants roles.

For module additions, step 4 is an explicit package/update prerequisite. Changing a
checkbox cannot deliver missing binaries. Removing authority can restrict an already
installed module without waiting to remove its files; physical exclusion is re-established
when the operator installs a narrower verified profile. The control plane shows this
difference rather than claiming immediate code removal.

## Policy defaults for implementation

Use the existing Admin/Operator/Viewer staff roles. Admin owns catalogue administration;
Admin/Operator owns assignment/approval under the current recent-MFA rule. Prefer
checkboxes plus a dependency graph and equivalent text list; drag-and-drop is unnecessary
for the first delivery and does not define module execution order.

Explicit module unassignment denies all of that module's business operations, including
its reads. Combined changes apply confirmed removals/affected dependants against the
active profile before staging additions, including when the target catalogue changes.
Maintain both desired and active catalogue/revision context. Classification-only migration
does not silently unassign an existing module; an explicit unassignment is not postponed
by an unrelated addition or delayed package.

All catalogue-managed business module operations, including reads and modules later
promoted to Core, require a current approved signed grant. Expiry, signed suspension and
unseen remote removal after the cached grant expires deny those operations. The existing
fixed foundation's whole-product prior-activation read exception remains unchanged and
cannot override module gates. The architecture decision matrix is normative.
Private identity/recovery/export and safe
completion/cleanup of previously admitted work remain under owning policy. Future
business modules must classify those operations before implementation.

Do not turn off Core modules individually or make Core an implicit user-role grant.
Promoting a module requires its mandatory dependencies to be Core in the new catalogue.
Demoting requires reviewing dependants; a new default classification does not revoke or
erase an installed customer's existing selection/data. New/incompatible catalogues never
auto-apply to existing installations.

Billing, per-seat metering, automatic customer deployment, runtime plugin upload, a new
microservice per module, active-active regional hosting and complete Incident/Risk domain
features remain outside this delivery. Catalogue administration is product policy, not
an arbitrary code execution or customer impersonation mechanism.

## Acceptance boundary

The final reviewed plan must resolve the central-first bootstrap, code-delivery dependency,
strict v1/v2 coexistence, assignment-change races and restore/removal behavior before
implementation begins. The POC must use real central assignment and signed enforcement,
not a permissive replacement handler or unsigned browser selection. Independent host,
production mail/TLS, legal release and coherent recovery acceptance retain their owning
installer/release gates; completing the placeholder POC does not authorize rollout.
