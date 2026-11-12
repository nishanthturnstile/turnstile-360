# Installation automation implementation plan

**Date:** 2026-11-07. **Owner:** Thaarei. Confidential and proprietary.

**Status:** Proposed delivery sequence; planning creation is authorized. No increment
below is implemented by creating this plan. Record future authorized work and actual
checks in [progress](../../IN_PROGRESS.md). Follow the
[specification](installation_specification.md) for IA-R01–18 and
[proposed architecture](../../architecture.md#proposed-installation-automation) for design.

Deliver a fresh combined customer installation first, then qualify repeatability and the
Dokploy adapter. Reuse the existing DMS distribution/private commands and central protocol.
Keep runtime authorization in the owning applications. Do not promote the dated local
helpers unchanged or add deployment execution to the central application.

**Module delivery extension, 2026-11-09:** The owner requested central selection,
dependency visualization, selected images and signed module activation. Follow the
[module plan](../turnstile/modules/module_delivery_implementation_plan.md): MOD-I01
contracts extend IA-I01; MOD-I04 artifact exclusion/inventory gates IA-I02; MOD-I05/06
intent/activation contracts gate the module-specific IA-I03 adapter. Generic journal,
host/TLS and private provisioning work may proceed without all business modules.
The module POC now includes real central assignment/enforcement, superseding the earlier
suggestion to defer it. No application implementation is claimed by this planning update.

## Existing primitives and delivery gaps

| Area                  | Reuse                                                                                                                                                                       | New work                                                                                                                                       |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Distribution          | DMS release builder, exact image/checksum inventory, Docker-only wrapper, notices/source offers and image verifiers.                                                        | Complete compatible Turnstile/DMS customer bundle, including product maintenance commands, web/API images, reporter and selected dependencies. |
| Configuration         | Combined signed-intent private preparation (MOD-I05), the DMS fresh-only initializer, explicit provisioning/migrations/storage init and processing broker-config CLI.       | Versioned installation intent/inventory, secret references, typed composition for all owners and safe partial-init reconciliation.             |
| Central integration   | Nonsecret manifests, registry/revision controls, protected pairing artifacts, durable deployment-client candidate/receipt recovery, signed approval and separate reporters. | Guided inventory import, file validation/delivery and operator status/resume across both products.                                             |
| Customer identity     | Verification/recovery, managed OAuth clients, local enrollment, distinct identity adapter and protected release commands.                                                   | Readiness-aware verification/sign-in sequence and a separately reviewed proof handoff preserving private grant authority.                      |
| Processing/operations | Worker authorization, admission policy, signature importer, readiness/capabilities, coherent recovery and release barriers.                                                 | Selected-profile orchestration, consolidated evidence and a qualified complete customer recovery handoff.                                      |
| Test evidence         | DMS-I20, control-plane qualification and existing real-HTTP/browser/release suites.                                                                                         | Installer-specific rerun/interruption/replay tests, a fresh-install real-document journey and independent Linux/Dokploy acceptance.            |

The existing DMS `init` refuses existing files; it is not a generic repair command.
The combined Compose overlay supplies integration wiring, not a complete immutable
customer release. Existing local user-management release helpers are deliberately
local-bound and must not be presented as portable customer tooling without adaptation.

## Delivery sequence

### IA I01 Freeze the baseline and review installer contracts

**Requirements:** IA-R02, IA-R04, IA-R09, IA-R15, IA-R16, IA-R18.

Record the reviewed source/release baseline and inventory existing private commands,
their privileges, inputs, authoritative inspect operations and retry guarantees. Preserve
the accepted central enforcement/recovery behavior and current installation. For every
mutating adapter classify whether it is replayable, inspectable or fresh-only; identify
missing owner-provided inspect/receipt capabilities before promising automated recovery.

Resolve the proposed engine/manifest/journal/action contracts in architecture. Review the
administrator proof trust/transport and the verification-before-client ordering before
adding endpoints or storage. Specify the exact supported platform matrix from the pinned
release/runtime checks; do not guess target architecture or Compose support.

Include MOD-I01's catalogue, dependency resolver, reserved fresh-registration identities,
assignment/profile digests, signed intent and v1/v2 compatibility. Existing/local-first
adoption keeps exported actual IDs; central-first reservation is not remote provisioning.

Complete the still-pending current local real-file DMS journey only with an authorized
test scope, or perform it in a disposable reproduction. Record actual scan, extraction,
OCR, retrieval and original hashes independently from I20 fixture results. Do not invent
a Turnstile upload screen or grant its machine extra write scopes to run this check.

**Gate:** reviewed command/authority/retry matrix and versioned contract decisions;
document verification has attributable evidence or remains an explicit unpassed release
gate. No test is allowed to silently modify the owner's organization/users/documents.

### IA I02 Assemble a complete customer release

**Requirements:** IA-R01, IA-R05, IA-R14, IA-R17.

Extend supported release assembly to include the exact Turnstile API/web images and
private tools alongside the existing DMS/dependency images. Package production entrypoints,
combined-mode routes, reporter configuration, migration inventory and locked deployment
files. Add the engine artifact and reissue the inventory in IA-I03 when it exists.
Keep the standalone DMS product independently usable. Build from
the monorepo root with the pinned workspace toolchain; the target consumes artifacts.

Bind bundle metadata to source, installer version, image IDs/digests, schemas, profiles
and the user-management release inventory. Include inventories/notices/source material
for all added images and a supported compatibility boundary. Install with no target
build or mutable image substitution. Test missing archives, wrong images and incompatible
profile/version refusal before database/configuration mutation.

MOD-I04 must demonstrate actual module exclusion and profile-bound inventories before
this complete customer release is frozen; a runtime feature flag alone cannot pass it.

**Gate:** clean artifact-only Linux environment verifies/starts the actual packaged
entrypoints and private commands without a checkout or host Node/Python. Ordinary
application containers never receive migrator credentials or the Docker socket.

### IA I03 Build validated intent and the durable stage engine

**Requirements:** IA-R02, IA-R03, IA-R04, IA-R12, IA-R13, IA-R18.

Implement strict manifest/inventory validation, protected secret handles, typed atomic
writers, a durable journal and one mutating owner per installation. Separate desired
configuration, observed state and transient authorization. Make proposed plan/install/
status/resume/verify actions real with documented finite statuses/exit codes; until this
increment ships, those names are design labels, not runnable commands.

Plan shows intended effects and prerequisite failures without issuing credentials or
writing target configuration. Status/verify reconcile through supported reads. Install
accepts a fresh binding; resume accepts only the retained binding/release and safe input
changes classified by the owning stage. Record the original operation before calling a
mutator, including protected candidate material where required; never use a success file
alone as proof. Preserve the exact operation after a lost response.

**Gate:** strict validation, interrupted atomic writes, no-op rerun, concurrent invocation
and secret-redaction checks. Exercise journal loss/corruption, stale-lock reconciliation,
changed installation/release and uninspectable outcomes; they stop safely without
regenerating secrets, deleting volumes or replaying an unknown security mutation.

### IA I04 Orchestrate private base provisioning

**Requirements:** IA-R03, IA-R04, IA-R05, IA-R13, IA-R14.

Implement local isolated Docker deployment using the distributed artifacts and engine.
Generate and retain distinct owner configuration/IDs, validate canonical encodings and
render each supported format separately. Wrap owning role provisioning, auth/DMS/product
migrations/bootstrap, storage and broker-definition generation. Inspect partial setup
instead of rerunning fresh init. Keep identity/recovery paths usable while business gates
stay closed. Verify canonical TLS/discovery from actual application containers.

Export the nonsecret installation/product inventory and stop at the next explicit actor.
Do not create fictional business configuration or mark email verified. Preserve every
existing volume and fail when a fresh installation conflicts with existing state.

**Gate:** two independently initialized disposable installations have distinct identities/
secrets and one tenant each. Restart/resume between config creation, provisioning,
migrations, broker/storage setup and receipt persistence. Existing data remains intact;
public ingress cannot reach operator/job/database/broker/scan/storage administration.

### IA I05 Guide central registration and independent activation

**Requirements:** IA-R04, IA-R06, IA-R12, IA-R13, IA-R15.

Add reviewed nonsecret inventory import/prefill using existing authenticated central
registry commands and revision checks, retaining staff review. Preserve canonical IDs
from receipts instead of duplicate customer/installation/product creation. Guide protected
pairing file selection, type/binding validation, private delivery and per-product setup.
Reuse deployment-client durable candidate recovery; do not create a parallel pairing
protocol or persist pairing secrets in public installer evidence.

Show recent-MFA expiry, the pending operation and how to reauthenticate/resume it.
Separate paired/pending, staff-approved, locally validated, activation-acknowledged and
reporting states. Start/sync the owning DMS and Turnstile reporters independently and
use the accepted cadence/freshness policy rather than expecting an immediate periodic
report. Staff approves each real product; test fixtures use actual staff/MFA handlers.

**Gate:** lost pairing/download/sync acknowledgements, retryable transport errors,
expired receipt/code/MFA, wrong-file/product/binding and intervening suspension or
credential replacement. Exercise the real handlers with actual HTTPS ingress headers;
replay must not reactivate obsolete authority. Never-approved business access stays closed.

### IA I06 Guide customer identity and protected handover

**Requirements:** IA-R04, IA-R07, IA-R08, IA-R09, IA-R11, IA-R13.

Prepare the selected first account through supported private authority commands. Guide
real email verification/password setup; use an explicitly allowed preparation destination
until verified-admin authority can issue the real login/machine/identity-service clients.
Provision their distinct scopes, enroll the DMS application and initialize only explicitly
approved product access. Validate actual token/callback/audience integration before
offering normal sign-in. Clarify readiness and recovery without account enumeration.

Implement the reviewed scoped proof handoff after ordinary login. The private owning
release command revalidates current user/session, operator selection, installation,
release, revision and recovery epoch before bootstrap/open. Refresh ordinary proof and
current revision between transitions. A public route can produce scoped proof only;
it cannot execute private grants. Keep a documented protected fallback under the existing
runbook until the new path is qualified; routine copy/paste of cookies is not the final UX.

Leave company setup to the selected administrator's normal resumable product flow.
Keep DMS capability permission explicit and distinct from protected administrator status.
Remove transient proof/password inputs promptly after their last required use.

**Gate:** real email/HTTPS/browser journeys with unverified/expired/reset states, missing
client preparation, wrong callback, denied private-service scope, stale or replayed proof,
changed user/session/grant/epoch/revision and competing bootstrap attempts. Test a lost
bootstrap/open response with current readback; do not replace the failing handler with
a permissive fixture. No new admin or role appears from a public proof call alone.

### IA I07 Configure processing and produce complete readiness evidence

**Requirements:** IA-R08, IA-R10, IA-R11, IA-R12, IA-R16, IA-R18.

Provision/authorize four separate work clients, install their secrets only in their
owning services, configure the operator-selected admission limits/profile, and import
valid fresh scanner data. Start the required services and reconcile actual grants,
broker/storage readiness and capabilities. Reuse current readiness semantics and limits.

Produce separate technical/workspace/functional results. Default verify is read-only:
check normal-login readiness, permission-protected Turnstile connection, real installed
machine service, canonical TLS, both approval acknowledgements and independent fresh
reports. An authorized disposable acceptance run adds upload/scan/extract/OCR/download
and application-isolation journeys. Never expand the installed capabilities-read machine
credential into a write consumer merely for the test.

**Gate:** API ready with processing unavailable remains a partial result; omitted worker
authority, stale/invalid CVDs, disabled admission, inaccessible issuer, token-scope denial
and optional-profile absence all report accurately. Then pass the actual selected-profile
document pipeline and hashes. Preserve concurrent organization edits and saved onboarding.

### IA I08 Add the Dokploy adapter and recovery handover

**Requirements:** IA-R01, IA-R03, IA-R14, IA-R15, IA-R17.

Use the same engine with an explicitly selected customer Dokploy project/application.
Validate existing ownership/network/domains before creating or updating configuration.
Use supported Compose configuration/deployment APIs or an operator-applied equivalent;
qualify the target Dokploy API/version before relying on a capability. Dokploy owns TLS
and ingress. Keep provider access narrowly scoped to the operator context, preserve
volumes, and never invoke destructive fresh-volume deployment options.

Define the combined backup cohort and verify coverage of auth, DMS, product state,
storage, keys and external recovery markers with the owning recovery tools. Generalize
local-only tooling where necessary; do not claim DMS-only recovery covers Turnstile.
Deliver protected backup/key custody and a supported maintenance/recovery procedure.
Restores stay quarantined until independent current central decisions, live administrator
proof and private release opening are reconciled. No automated software update/rollback
or generic restore command is introduced by this increment.

**Gate:** second independent Linux/Dokploy installation from the same bundle and a
separate off-host recovery rehearsal with a coherent cohort, interruption and denial
checks. Verify production DNS/TLS/mail separately from local CA/Mailpit. Demonstrate
that a region test install has new identities while recovery preserves the original
binding without creating a second active primary. Missing target access leaves this
gate pending; simulated adapters alone cannot pass it.

### IA I09 Freeze qualification and hand over the supported workflow

**Requirements:** IA-R01–18.

Freeze the exact reviewed installer/bundle and run the acceptance matrix below through
the packaged production entrypoints. Produce a ledger distinguishing static, direct
service, deployed HTTP, browser, local synthetic, independent-host and target evidence.
Review all failures and preserve request IDs, expectations and safe results; an interrupted
run without final evidence does not pass. Complete legal/source-offer review and operator
documentation with supported platform/profile limits and troubleshooting/resume actions.

Run the workspace gates and focused affected browser/image/distribution tests for
implementation changes. Complete accountable target acceptance only after all required
target evidence and agreed test-data handling. Do not deploy real customers merely
because the local installer qualification passes.

**Gate:** a second operator can follow the release runbook without dated private helpers,
manual UUID transcription, routine cookie copying or undocumented SQL repair. Repeating
the same install after success changes no identity/secret/account/grant/business data.
Record remaining unsupported adoption/update/restore/HA features explicitly.

## Acceptance evidence

| Evidence                       | Required observation                                                                                                                                                                                                 | Owning increments      |
| ------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------- |
| Artifact integrity             | Exact images/engine/profile/migration inventory; missing or substituted artifact refused before effects; full notices/source material.                                                                               | IA-I01–02, IA-I09      |
| Fresh install and no-op rerun  | Actual packaged tools configure one tenant with distinct identities; a second identical run preserves secrets, data and grants.                                                                                      | IA-I03–04, IA-I09      |
| Resume and unknown outcomes    | Crash around each mutation/receipt boundary, transport retry, lost acknowledgement, concurrent invocation and replay after intervening state change. Use authoritative readback or stop for explicit reconciliation. | IA-I03–07, IA-I09      |
| Central activation             | Both real products independently paired, approved, signed decisions validated, activation acknowledged and reports received within configured freshness. Denial/suspension survives stale replay.                    | IA-I05, IA-I09         |
| Customer identity and access   | Real mail verification, reset/expiry recovery, configured ordinary login, protected proof/handover, scoped grants, private identity integration and denied unauthorized access.                                      | IA-I06–07, IA-I09      |
| Complete processing            | Actual storage/broker/scanner/workers/admission; API and processing health distinguished; nonempty selected capabilities; authentic document/OCR results and original hashes.                                        | IA-I01, IA-I07, IA-I09 |
| Deployment paths and privacy   | Canonical browser/container DNS/TLS, configured proxy headers, private-route denial and secret-safe files/output. Local Windows/WSL behavior and Linux/Dokploy target evidence are separate.                         | IA-I03–08, IA-I09      |
| Recovery and target acceptance | Restart and interrupted coherent restore, current approval reconciliation, protected administrator and business preservation, off-host custody and accountable sign-off.                                             | IA-I08–09              |

For implementation changes run `pnpm check`, `pnpm build`, `pnpm test` and
`pnpm test:integration`, then relevant focused existing/installer suites. Add tests at
the real failure boundary; avoid tests that merely mirror stage implementation. Preserve
all non-fixture Docker volumes. If Docker, target infrastructure or production mail is
unavailable, record precisely which evidence remains unverified.

## First implementation handoff

Start IA-I01 when implementation is authorized. Its concrete deliverables are the command/
retry matrix, reviewed input/journal/proof contracts and a resolved real-document evidence
gate. IA-I02 then supplies the complete artifact; IA-I03/04 make the first repeatable
installation reach an honest waiting-for-staff state. This gives a usable vertical slice
before adding guided customer identity, complete verification and Dokploy qualification.

Deployment-specific values are inputs, not unresolved product policy: actual domains,
mail relay, backup destination/key custodian, customer administrator and admission budget
must be supplied for that target. Keep any changed security policy or new topology as
an explicit architecture decision, never an installer default.

## Owning implementation references

- [DMS distribution](../runbooks/dms-distribution.md) and its
  [Docker-only wrapper](../../deploy/distribution/dms): artifact/init/private command boundary.
- [DMS activation](../runbooks/dms-deployment-control.md),
  [Turnstile activation](../runbooks/turnstile-deployment-control.md) and the
  [deployment client](../../packages/deployment-control/src/client.ts): separate product
  bindings, signed decisions and durable pairing/rotation recovery.
- [Authentication operations](../runbooks/authentication.md) and
  [user-management release](../runbooks/user-management-release.md): owning client/grant
  administration, ordinary-login proof and private release opening.
- [Work authority](../runbooks/dms-work.md), [admission](../runbooks/dms-admission.md) and
  [recovery](../runbooks/dms-recovery.md): selected-profile processing and coherent custody.
- [Dokploy operations](../runbooks/dokploy.md) and
  [manual qualification](../runbooks/fresh-manual-testing.md): target routing and human journeys.
