# Module implementation release handoff

Date: 2026-11-11. Confidential and proprietary. Scope: local Linux/amd64 module POC.
Actual execution status belongs in [progress](../../../IN_PROGRESS.md). This document
describes the evidence boundary and review route, not production release approval.

The machine-readable [frozen record](../../qualification/module-release-20261111.json)
pins all workspace source/test/tool/document bytes and executable flags, the narrower
selected-build digest, engine/contracts, exact catalogue/profile/releases, image IDs,
historical assignment/epoch/acknowledgement, execution log hashes and notice inventories.
Git HEAD is context only: the implementation is an accumulated uncommitted working tree.
The source inventory excludes ignored private state, generated build output, this generated
record and the mutable progress log. File hashes are evidence checksums, not signatures,
runtime attestation or authority. Retain the complete checkout and independently trusted
artifacts; a Git HEAD alone cannot reproduce this candidate.

## Evidence categories

| ID          | Execution and scope                                                                                                                                                                                                                                                                                   | Important limit                                                                                                                                                                                            |
| ----------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| check       | Workspace lint, type checks, ownership boundaries, generated contracts, Python and deployment checks                                                                                                                                                                                                  | Static checks are not target execution.                                                                                                                                                                    |
| build       | Production workspace builds                                                                                                                                                                                                                                                                           | Selected image composition is separately qualified.                                                                                                                                                        |
| test        | Package/service regressions, dependency resolver, signature/protected-file/installer contracts                                                                                                                                                                                                        | Direct service/fixture checks do not prove browser wiring.                                                                                                                                                 |
| integration | Real central HTTPS/PostgreSQL/Chromium catalogue, dependency selection, assignment, MFA, receipt/audit and protocol failure paths; owning customer SQL/auth and storage                                                                                                                               | Some central inventories are explicitly synthetic signed metadata. Six conditional non-module database cases are skipped: two OCR, one native assessment, two standalone-profile and one standalone-image. |
| selected    | All four actual Core/Incident/Risk/both API/web profiles: physical exclusion/inventories/archive/signature/substitution/reuse, nonroot production startup, actual assets/CSP and normal-login browser/API/service/permission denial                                                                   | Initial fixture identities and signed authority are seeded; the customer login/guards are real.                                                                                                            |
| cutover     | Actual central handlers and selected images/reporters through additions, removals, mixed replacement, Core promotion, interruption/resume, lost acknowledgement, role change, restore/quarantine and independent trust rejection                                                                      | Initial compatibility bridge is a fixture; auxiliary legacy v1 checks use source mode. Local archive recovery is not off-host target recovery.                                                             |
| installer   | Fresh signed bundle through Docker-only launcher/owning initializers, independent pairing/approval/activation/acknowledgement/reporting, real email/client issuance/login, workspace setup, explicit Incident grant and DMS capabilities; rerun/negative/reconciliation and actual Docker fault paths | Separate automated customer actor, not an independent human. No customer source mount, SQL seed, UUID transcription or accepting replacement handler.                                                      |
| evidence    | Frozen record detects byte/executable drift, record substitution and symlinks                                                                                                                                                                                                                         | Checksums do not establish trusted publication.                                                                                                                                                            |
| inventories | Checksum-verified pinned Syft scan and actual legal-file collection from all five transferred image IDs                                                                                                                                                                                               | License declarations/retained notices are evidence, not complete corresponding-source or redistribution acceptance.                                                                                        |

The selected suite deliberately rejects changed signatures/profile, missing/substituted
archives, excluded direct URLs/API routes, absent explicit permission, SQL scope abuse,
local disablement, revoked grants, replay, module removal, expiry and suspension. The
cutover suite exercises the production lost-acknowledgement/retry/restore paths rather
than substituting an accepting handler. The installer suite keeps fresh setup, retained
rerun, recoverable transport/role failure and changed-context reconciliation distinct.
The retained receipt captures a historical approved assignment; later intentional removal
must not be interpreted as current access. No expired record authorizes a module read.

| Scenario                   | Separate evidence and checkpoint                                                                                                                                                                                                                                                                                                                              |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fresh                      | `installer` / `fresh-handover`: [actual operator fixture](../../../scripts/fixtures/installation-handover.mjs), from signed central reservation through owning configuration, pairing, approval, email/client/login/setup, explicit module grant and DMS capabilities. The frozen safe receipt preserves its exact historical assignment and acknowledgement. |
| Retained rerun             | `installer` / `fresh-handover`: the same fixture invokes concurrent `resume`, checks retained completed state and accepts historically valid package publication after its issuance window. No configuration/credential reset or duplicate fresh identity issuance is used.                                                                                   |
| Recovery                   | `installer` / `docker-jobs`: [real Docker fault fixture](../../../scripts/test-installation-jobs.mjs) drops committed create/start responses, obstructs the post-effect checkpoint and retries a confirmed pre-effect role connection failure. `cutover` separately interrupts/resumes the selected archive and exercises customer/central restore fences.    |
| Negative access / conflict | `selected`: excluded routes, permission denial, local disablement, removal/expiry/suspension and replay. `installer` / `fresh-handover`: altered bundle, revoked trust, unsafe file mode and changed-assignment exit 20 preserve retained secrets. `cutover`: absent/revoked/late-retired independent release keys fail before closure.                       |

## Requirement trace

Each row identifies an owning implementation and executable evidence. Full exact path
hashes and per-requirement text hashes are in the frozen record. Group evidence does not
claim a separate assertion for every sentence; production-dependent limits remain open.

| Requirement                          | Owning implementation                                                                                                                                                        | Execution evidence                                                                                                                         |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| MOD-R01 trusted catalogue            | [catalogue service](../../../apps/thaarei-control-plane/src/server/module-service.ts), [release evidence](../../../apps/thaarei-control-plane/src/server/module-evidence.ts) | integration: signed import/publication, immutable source and rejected unsupported metadata                                                 |
| MOD-R02 classification               | [shared resolver/contracts](../../../packages/module-catalog/src/contracts.ts), catalogue service                                                                            | test, integration, cutover: Core closure, unsupported demotion and promoted Risk profile                                                   |
| MOD-R03 per-product assignment       | [assignment service](../../../apps/thaarei-control-plane/src/server/module-assignment-service.ts)                                                                            | integration: one installation binding, revision/receipt and independent products                                                           |
| MOD-R04 dependency review            | [selection UI](../../../apps/thaarei-control-plane/src/app/clients/ModuleAssignment.tsx), [resolver](../../../packages/module-catalog/src/contracts.ts)                      | integration: keyboard selection, graph/text dependencies and full closure confirmation                                                     |
| MOD-R05 transactional staff commands | assignment service and [transitions](../../../apps/thaarei-control-plane/src/server/module-transition-service.ts)                                                            | integration: admission/current MFA, stale/replayed commands, receipt/audit rollback                                                        |
| MOD-R06 reserved fresh identities    | [intent service](../../../apps/thaarei-control-plane/src/server/installation-intent-service.ts), [engine](../../../packages/installation-engine/src/engine.ts)               | installer: real central reservation, owning init, no transcription/reset; existing-state refusal                                           |
| MOD-R07 physical packaging           | [allowlisted assembly](../../../scripts/assemble-module-runtime.mjs), [artifact inventory](../../../scripts/module-artifacts.mjs)                                            | selected: all four actual image profiles and excluded implementation/assets/dependencies                                                   |
| MOD-R08 external delivery            | [delivery adapter](../../../scripts/module-delivery.mjs), [release assembly](../../../scripts/installation-release.mjs)                                                      | test, selected, installer: exact local signed artifacts; production HTTPS adapter pending                                                  |
| MOD-R09 independent status           | [handover projection](../../../apps/thaarei-control-plane/src/server/module-handover-service.ts)                                                                             | integration, installer: desired/package/installed/central/acknowledged/reporting; upgrade required                                         |
| MOD-R10 signed protocol              | [decision policy](../../../apps/thaarei-control-plane/src/server/module-decision-policy.ts), [strict verifier](../../../packages/deployment-control/src/verifier.ts)         | integration: v2 binding/profile/epoch/order and independent DMS v1; installer: actual acknowledgement                                      |
| MOD-R11 server guards                | [module service](../../../apps/turnstile-api/src/modules/module-access/module-access.service.ts)                                                                             | test, selected: internal/service/controller gates, live user permission/resource readiness; future jobs out of scope                       |
| MOD-R12 navigation and direct access | [controller](../../../apps/turnstile-api/src/modules/module-access/module-access.controller.ts), [composition](../../../apps/turnstile-web/src/module-composition.ts)        | selected: backend-derived navigation and denied URLs/API; base setup/recovery preserved                                                    |
| MOD-R13 real placeholder slice       | [Incident](../../../apps/turnstile-web/src/features/incident-management/entry.tsx), [Risk](../../../apps/turnstile-web/src/features/risk-management/entry.tsx)               | selected, installer: real login, explicit grants and displayed module messages                                                             |
| MOD-R14 restrictive transitions      | transitions and [cutover](../../../scripts/module-cutover.mjs)                                                                                                               | integration, cutover: immediate explicit removals/dependants, delayed addition and mixed/catalogue replacement                             |
| MOD-R15 offline expiry               | strict verifier and [access evaluator](../../../apps/turnstile-api/src/modules/deployment/access.ts)                                                                         | integration, selected: expiry/outage/suspension/removal/replay; product read exception cannot authorize module reads                       |
| MOD-R16 recovery floors              | [deployment store](../../../apps/turnstile-api/src/modules/deployment/store.ts), cutover                                                                                     | integration, cutover: retained floors/trust/setup/grants, archive resume, central/customer restore/quarantine                              |
| MOD-R17 trust separation             | [release verifier](../../../packages/deployment-control/src/module-release.ts), [protected artifacts](../../../packages/installation-engine/src/artifacts.ts)                | cutover: absent/revoked/late-retired independent key; installer: tamper, private mode, expired publication and log privacy                 |
| MOD-R18 minimal reporting            | handover projection and [reporter](../../../apps/turnstile-api/src/modules/deployment/reporter.ts)                                                                           | integration, installer: authenticated product-specific claims, current epoch/order and independent reporters                               |
| MOD-R19 reconciliation               | [durable jobs](../../../packages/installation-engine/src/jobs.ts), engine                                                                                                    | installer: lost create/start responses, post-effect checkpoint failure, retryable pre-effect role failure, concurrent/changed-context stop |
| MOD-R20 handoff                      | [evidence tool](../../../scripts/module-release-evidence.mjs), [support runbook](../../runbooks/module-release.md)                                                           | evidence, inventories and this cross-requirement record; separate accountable target acceptance pending                                    |

## Inventory and source-offer review

The transferred candidate has five exact images and twelve files (the signed descriptor
plus eleven covered files). Its selected inner source/artifact inventories are not a
distribution-wide SBOM. The external evidence collector now records five-image SPDX/Syft
inventories, dependency/source declarations and hashes of actual per-image upstream legal
archives. These operator-retained sidecars are not silently added to the fixed signed
customer bundle. Missing license declarations and restricted declarations, if any, remain
visible in the frozen inventory and require owning review.

The module-poc now uses its [own source-offer text](../../../deploy/installation/COVERED_SOURCE_OFFER.txt).
It identifies the actual signed image/module inventories, preserves the owner's existing
contacts/offer and accurately states which sidecars are separately supplied. The earlier
complete-DMS offer incorrectly described SPDX/source-access/legal archives as bundled with
this limited candidate. Correcting this packaging text requires a new combined manifest;
the selected application images/profile remain identical. Packaging cache identity includes
offer, notices and proprietary license bytes. No license obligation is waived by this change.
Exact corresponding-source availability/completeness and accountable distribution approval
remain release gates; an upstream URL, scan or offered contact is not proof of fulfillment.

## Production boundary

No production release is approved. Separate clean Linux/Dokploy DNS/TLS/mail, protected
production HTTPS distribution, off-host recovery, real-document processing/capacity,
independent human replay, corresponding-source/distribution review and accountable target
acceptance remain pending under the [installer plan](../../deployment/installation_implementation_plan.md).
The current private proof-bearing handover is supported; proposed public scoped proof UX
remains IA-I06. No billing, domain workflows, automated hosting or mobile app is added.
See the [historical independent MOD-I01–08 review](module_implementation_review.md),
[MOD-I09 qualification](module_installation_qualification.md) and operational runbooks.
