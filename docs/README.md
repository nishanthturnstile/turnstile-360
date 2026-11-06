# Documentation

Thaarei confidential and proprietary. Start with the root [architecture](../architecture.md)
for accepted technical decisions and [progress tracker](../IN_PROGRESS.md) for actual
completion, verification and handoffs. Plans describe delivery; their existence does not
mean a feature is implemented.

## Product and delivery documents

| Area                      | Reading order                                                                                                                                                                                                                      |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DMS                       | [Product blueprint](dms/headless_dms_product_blueprint_v1.md), [requirements](dms/headless_dms_functionality_requirements_v1.md), [standalone implementation plan](dms/dms_implementation_plan.md)                                 |
| Thaarei control plane | [Overview](thaarei/control-plane-plan.md), [proposed specification](thaarei/control-plane-specification.md), [detailed implementation plan](thaarei/control-plane-implementation-plan.md), [review corrections](thaarei/control-plane-review.md) — central deployment approval and health/usage reporting |
| Shared authentication     | [Implementation plan](authentication/authentication_implementation_plan.md), [operator runbook](runbooks/authentication.md)                                                                                                        |
| Turnstile onboarding      | [Specification](turnstile/onboarding/onboarding_specification.md), [implementation plan](turnstile/onboarding/onboarding_implementation_plan.md), [redesign plan](turnstile/onboarding/onboarding_redesign_implementation_plan.md) |
| Turnstile user management | [Specification](turnstile/user-management/user_management_specification.md), [implementation plan](turnstile/user-management/user_management_implementation_plan.md)                                                               |
| Turnstile design system   | [Designer/developer guide](turnstile/design-system.md)                                                                                                                                                                             |
| Workspace                 | [Implementation plan](workspace/workspace_implementation_plan.md), [engineering standards](standards/workspace.md)                                                                                                                 |

Discovery and design proposals remain beside their feature's specification and plans.
They preserve rationale and earlier decisions; the accepted specification, architecture
and current progress take precedence over historical descriptions.

## Operations and reference material

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
