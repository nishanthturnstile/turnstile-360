# Documentation

Thaarei confidential and proprietary. Start with the root [architecture](../architecture.md)
for accepted technical decisions and [progress tracker](../IN_PROGRESS.md) for actual
completion, verification and handoffs. Plans describe delivery; their existence does not
mean a feature is implemented.

## Product and delivery documents

| Area                      | Reading order                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DMS                       | [Product blueprint](dms/headless_dms_product_blueprint_v1.md), [requirements](dms/headless_dms_functionality_requirements_v1.md), [standalone implementation plan](dms/dms_implementation_plan.md)                                                                                                                                                                                                                                                 |
| Thaarei control plane     | [Overview](thaarei/control-plane-plan.md), [adopted specification](thaarei/control-plane-specification.md), [detailed implementation plan](thaarei/control-plane-implementation-plan.md), [review corrections](thaarei/control-plane-review.md), [staff operations](deployment/thaarei_ecosystem_guide.md#central), [UI redesign research and plan](thaarei/control-plane-ui-redesign.md) — central deployment approval and health/usage reporting |
| Shared authentication     | [Implementation plan](authentication/authentication_implementation_plan.md), [operator runbook](runbooks/authentication.md)                                                                                                                                                                                                                                                                                                                        |
| Installation automation   | [Proposed specification](deployment/installation_specification.md), [implementation plan](deployment/installation_implementation_plan.md) — bounded module-POC installer implemented; complete customer releases and guided proof exchange retain separate acceptance gates                                                                                                                                                                        |
| Turnstile onboarding      | [Specification](turnstile/onboarding/onboarding_specification.md), [implementation plan](turnstile/onboarding/onboarding_implementation_plan.md), [redesign plan](turnstile/onboarding/onboarding_redesign_implementation_plan.md)                                                                                                                                                                                                                 |
| Turnstile user management | [Specification](turnstile/user-management/user_management_specification.md), [implementation plan](turnstile/user-management/user_management_implementation_plan.md)                                                                                                                                                                                                                                                                               |
| Turnstile design system   | [Designer/developer guide](turnstile/design-system.md)                                                                                                                                                                                                                                                                                                                                                                                             |
| Workspace                 | [Implementation plan](workspace/workspace_implementation_plan.md), [engineering standards](standards/workspace.md)                                                                                                                                                                                                                                                                                                                                 |

Turnstile module delivery: [specification](turnstile/modules/module_delivery_specification.md)
and [implementation plan](turnstile/modules/module_delivery_implementation_plan.md) —
central staff catalogue/assignment, dependency visualization, selected customer images
and signed module activation; [Astra review and dispositions](turnstile/modules/module_delivery_review.md)
precede implementation.

[Module contracts and ownership](turnstile/modules/module_contracts.md) records the MOD-I01
shared-package conventions, fixed foundation inventory and retry/compatibility handoff.
The [catalogue operations runbook](deployment/thaarei_ecosystem_guide.md#catalogue) covers MOD-I02 staff
classification/publication and independently provisioned public release trust.
The [assignment runbook](deployment/thaarei_ecosystem_guide.md#assignment) covers MOD-I03 per-product
selection, dependency confirmation, desired-state approval and current-state recovery.

Discovery and design proposals remain beside their feature's specification and plans.
They preserve rationale and earlier decisions; the accepted specification, architecture
and current progress take precedence over historical descriptions.

## Deployment: two authoritative guides

1. [Thaarei ecosystem](deployment/thaarei_ecosystem_guide.md): central infrastructure,
   staff/MFA, customer registration/reservation, catalogue and selected release pipeline,
   pairing, approval and activation.
2. [Customer installation](deployment/customer_deployment_guide.md): combined module POC,
   separate customer Docker project, company/user onboarding, full standalone DMS,
   complete-profile boundaries, validation and recovery.

The older control-plane, catalogue, assignment, delivery, installation-handover/intents,
Dokploy, standalone/distribution and fresh-manual-testing setup documents were consolidated
and removed. The guides retain their commands and link to unique feature operations below.
[Titan results](deployment/titan_acceptance_results.md) and the
[acceptance matrix](deployment/titan_fresh_install_validation_plan.md) are evidence/planning,
not alternative installation instructions. Historical qualification inventories preserve
original file paths and hashes; they do not describe the current working tree.

- [Feature runbooks](runbooks/): authentication, processing/storage, recovery and coordinated releases.
- [API artifacts](api/): generated contracts; regenerate with owning scripts.
- [Presentations](presentations/): explanatory snapshots, not current setup authority.

Keep new documents in the owning area, use relative links and update references when
moving a file. Keep `architecture.md`, `IN_PROGRESS.md`, `AGENTS.md`, `README.md`, LICENSE
and third-party notices at their established root locations. Technical design stays in
architecture; requirement IDs stay in specifications and completed work stays in progress.

DMS contract/explorer operations: [manual testing runbook](runbooks/dms-api-explorer.md).

DMS owning audit/private inspection: [audit runbook](runbooks/dms-audit.md).

Secured DMS storage boundary: [storage runbook](runbooks/dms-storage.md).

DMS document registry/admission: [admission runbook](runbooks/dms-admission.md).

Document upload/batch lifecycle and direct transfer: [runbook](runbooks/dms-uploads.md).

Authoritative work, private roles and broker recovery: [runbook](runbooks/dms-work.md).
Native assessment, isolation and publication: [runbook](runbooks/dms-assessment.md).
First usable secure document transfer: [runbook](runbooks/dms-secure-transfer.md).
Version history and reassessed binary restoration: [runbook](runbooks/dms-versions.md).

- [Document metadata, tags and references](runbooks/dms-metadata.md)

- [Explicit application sharing](runbooks/dms-sharing.md)

- [Soft deletion and logical restoration](runbooks/dms-lifecycle.md)

I14 native/Office/tabular/email runtime and manual qualification: [extraction runbook](runbooks/dms-extraction.md).

I15 English OCR, mixed pages and qualification: [OCR runbook](runbooks/dms-ocr.md).
I20 synthetic qualification, independent consumers, upgrade/rollback and controlled target acceptance: [handover runbook](runbooks/dms-handover.md).

I16 results, reprocessing and optional offline structure: [results runbook](runbooks/dms-results.md).

Permission-aware discovery: [runbook](runbooks/dms-discovery.md).

- [DMS coherent backup, recovery and disposal](runbooks/dms-recovery.md)

DMS deployment approval/setup and combined customer profiles: [deployment control](runbooks/dms-deployment-control.md).

- [Turnstile deployment approval and reporter operations](runbooks/turnstile-deployment-control.md)

- [Signed module decisions](runbooks/module-decisions.md): enforcement and installed-release context.
- [Module access](runbooks/module-access.md): local permissions and guarded entries.
- [Module transitions](runbooks/module-transitions.md): later profile cutovers and recovery.

[Local module qualification](turnstile/modules/module_installation_qualification.md) records
historical evidence separately from the two current deployment guides.
