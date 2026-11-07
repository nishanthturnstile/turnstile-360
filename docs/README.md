# Documentation

Thaarei confidential and proprietary. Start with the root [architecture](../architecture.md)
for accepted technical decisions and [progress tracker](../IN_PROGRESS.md) for actual
completion, verification and handoffs. Plans describe delivery; their existence does not
mean a feature is implemented.

## Product and delivery documents

| Area                      | Reading order                                                                                                                                                                                                                                                                                                                                           |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DMS                       | [Product blueprint](dms/headless_dms_product_blueprint_v1.md), [requirements](dms/headless_dms_functionality_requirements_v1.md), [standalone implementation plan](dms/dms_implementation_plan.md)                                                                                                                                                      |
| Thaarei control plane     | [Overview](thaarei/control-plane-plan.md), [adopted specification](thaarei/control-plane-specification.md), [detailed implementation plan](thaarei/control-plane-implementation-plan.md), [review corrections](thaarei/control-plane-review.md), [staff operations](runbooks/control-plane.md) — central deployment approval and health/usage reporting |
| Shared authentication     | [Implementation plan](authentication/authentication_implementation_plan.md), [operator runbook](runbooks/authentication.md)                                                                                                                                                                                                                             |
| Turnstile onboarding      | [Specification](turnstile/onboarding/onboarding_specification.md), [implementation plan](turnstile/onboarding/onboarding_implementation_plan.md), [redesign plan](turnstile/onboarding/onboarding_redesign_implementation_plan.md)                                                                                                                      |
| Turnstile user management | [Specification](turnstile/user-management/user_management_specification.md), [implementation plan](turnstile/user-management/user_management_implementation_plan.md)                                                                                                                                                                                    |
| Turnstile design system   | [Designer/developer guide](turnstile/design-system.md)                                                                                                                                                                                                                                                                                                  |
| Workspace                 | [Implementation plan](workspace/workspace_implementation_plan.md), [engineering standards](standards/workspace.md)                                                                                                                                                                                                                                      |

Discovery and design proposals remain beside their feature's specification and plans.
They preserve rationale and earlier decisions; the accepted specification, architecture
and current progress take precedence over historical descriptions.

## Operations and reference material

- [Fresh manual testing](runbooks/fresh-manual-testing.md): operator preparation and the central/customer/DMS test sequence; running status remains in progress.
- [Runbooks](runbooks/): authentication, Dokploy and coordinated onboarding/user-management releases.
- [API artifacts](api/): generated OpenAPI documents; regenerate using their owning scripts.
- [Presentations](presentations/): explanatory HTML snapshots, not implementation status.

Keep new documents in the owning area, use relative links and update references when
moving a file. Keep `architecture.md`, `IN_PROGRESS.md`, `AGENTS.md`, `README.md`, LICENSE
and third-party notices at their established root locations. Technical design stays in
architecture; requirement IDs stay in specifications and completed work stays in progress.

Standalone foundation operations: [DMS runbook](runbooks/dms-standalone.md).

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

- [Standalone distribution and operations](runbooks/dms-distribution.md)

- [DMS coherent backup, recovery and disposal](runbooks/dms-recovery.md)

DMS deployment approval/setup and combined customer profiles: [deployment control](runbooks/dms-deployment-control.md).

- [Turnstile deployment approval and reporter operations](runbooks/turnstile-deployment-control.md)
