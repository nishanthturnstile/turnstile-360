# Project progress

Last updated: 2026-10-31

This is the shared implementation status and handoff record for Turnstile 360 and the
Thaarei DMS. All agents must read it before starting work and update it as work progresses.
Technical design is maintained in [architecture.md](architecture.md); product scope and
requirements remain in their linked specifications. This file records what has actually
been completed, verified, or left pending.

## Current position

The workspace foundation is complete. Application identity/liveness endpoints and the
Turnstile web application entry point run locally. DMS capabilities, Turnstile business
features, authentication, database schemas, and source/data migration are not implemented.
The complete technical design is consolidated in [architecture.md](architecture.md). No
implementation task is currently active; the next business feature remains unassigned.

## Updating this file

1. Read this file and the relevant specifications before changing code. Confirm current
   implementation details rather than assuming an old verification still applies.
2. Add or update a work item when a task starts: stable ID, status, owner, scope, and next
   action. Reference existing requirement IDs when applicable.
3. Update the item after meaningful milestones and before handing work back. Record files
   changed, checks actually run, results, and remaining work. Include dated verification.
4. Mark work completed only when its agreed scope and required checks are satisfied.
   Distinguish configured, implemented, tested, and deployed states.
5. For blocked work, record the specific blocker and what resolves it. Planned work is
   not authorization to implement it; deferred features stay outside current scope.
6. Preserve other agents' entries. Read the latest file before editing and do not mark
   another agent's task completed without evidence. Keep completed milestones available.
7. Never record credentials, tokens, signed URLs, customer data, or sensitive logs here.

Statuses: **Planned**, **In progress**, **Blocked**, **Completed**, **Deferred**.

## Active work

No active work at the latest handoff. Add the next authorized task here before starting it.

| ID  | Status | Owner | Scope / requirement | Next action | Verification / remaining work | Updated |
| --- | ------ | ----- | ------------------- | ----------- | ----------------------------- | ------- |

## Completed milestones

| ID            | Completed  | Result                                                                                                                                                                                                                                                        | Evidence                                                                                                                                                                                                                                            |
| ------------- | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| WSP-001       | 2026-10-31 | Git repository, pnpm workspace, Turborepo tasks, runtime pins, and lockfiles established                                                                                                                                                                      | [Root manifest](package.json), [workspace](pnpm-workspace.yaml), [task graph](turbo.json)                                                                                                                                                           |
| WSP-002       | 2026-10-31 | DMS API and separate Turnstile API created with the Nest CLI and configured with Fastify                                                                                                                                                                      | [DMS API](apps/dms-api/README.md), [Turnstile API](apps/turnstile-api/README.md)                                                                                                                                                                    |
| WSP-003       | 2026-10-31 | Turnstile Vite/React/TypeScript frontend created; local API proxy configured                                                                                                                                                                                  | [Web application](apps/turnstile-web/README.md), [Vite configuration](apps/turnstile-web/vite.config.ts)                                                                                                                                            |
| WSP-004       | 2026-10-31 | Python package created with uv; processing folders, Ruff, mypy, pytest, and packaging configured                                                                                                                                                              | [Processing project](apps/dms-processing/README.md), [Python configuration](apps/dms-processing/pyproject.toml)                                                                                                                                     |
| WSP-005       | 2026-10-31 | DMS/Turnstile contracts and internal DMS client package boundaries established                                                                                                                                                                                | [DMS contracts](packages/dms-contracts/README.md), [DMS client](packages/dms-client/README.md), [Turnstile contracts](packages/turnstile-contracts/README.md)                                                                                       |
| WSP-006       | 2026-10-31 | Biome, TypeScript 6.0.3 strict checks, Nest decorator metadata support, and dependency rules configured and validated                                                                                                                                         | [Tooling](tooling/README.md), [standards](docs/standards/workspace.md)                                                                                                                                                                              |
| WSP-007       | 2026-10-31 | Dockerfiles, local infrastructure Compose, Dokploy application Compose, Nginx frontend serving, and CI workflow added                                                                                                                                         | [Deployment runbook](docs/runbooks/dokploy.md), [workflow](.github/workflows/workspace.yml); image builds/deployment remain unverified                                                                                                              |
| WSP-008       | 2026-10-31 | Application-specific identities replaced generated demo responses; proprietary Thaarei ownership recorded                                                                                                                                                     | [License](LICENSE), private package metadata, Python wheel license verified                                                                                                                                                                         |
| ARC-001       | 2026-10-31 | Future web/mobile clients share the Turnstile backend; authoritative business logic stays server-side                                                                                                                                                         | [Client architecture](architecture.md#turnstile-application-architecture); no mobile project added                                                                                                                                                  |
| ARC-002       | 2026-10-31 | Codex clarified one customer tenant per installation with multiple independent applications; separate installations per customer, shared Turnstile web/mobile backend registration, no SaaS tenant provisioning                                               | [Customer deployment model](architecture.md#customer-deployment-and-application-model), blueprint v1.6, requirements v1.3 (FR-01.01/03/06, FR-06.06), DMS-001 bootstrap acceptance, README/runbook/agent rules; design only                         |
| DOC-001       | 2026-10-31 | Shared progress record and required agent handoff/update workflow established                                                                                                                                                                                 | [Agent instructions](AGENTS.md), this file                                                                                                                                                                                                          |
| DOC-002       | 2026-10-31 | Codex consolidated complete DMS/Turnstile architecture, component ownership, installed/selected stack, diagrams, deployment, and future-mobile boundaries; redirected overlapping docs and required agent reference                                           | [Architecture](architecture.md), blueprint v1.5, requirements v1.2, README/standards/runbook/app/package/tooling links, [agent instructions](AGENTS.md); documentation-only change                                                                  |
| AUTH-PLAN-001 | 2026-10-31 | Codex audited absent auth implementation, researched official stable Better Auth/OAuth/Fastify/PostgreSQL/BFF guidance, recorded email/password-first decision and proposed the complete web/user/machine chain with seven work packages and acceptance tests | [Authentication plan](docs/authentication_implementation_plan.md), [architecture proposal](architecture.md#authentication-chain-implementation-proposal), blueprint v1.7, requirements v1.4; planning only, no auth/customer provisioning performed |

## Latest recorded verification

The following results were observed on 2026-10-31. They describe the workspace foundation,
not completed business functionality. Re-run affected checks when implementation changes.

| Check                                           | Recorded result                                                                                 |
| ----------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Locked pnpm installation and uv synchronization | Passed                                                                                          |
| `pnpm check`                                    | Passed: Biome, dependency boundaries, TypeScript, Ruff/mypy, deployment YAML/build paths        |
| `pnpm build`                                    | Passed for all seven application/library projects, including Python distributions               |
| `pnpm test`                                     | Passed: two API identity tests and the installed Python entry point                             |
| `pnpm test:integration`                         | Passed: four Fastify HTTP injection checks                                                      |
| `pnpm test:smoke`                               | Passed: both compiled APIs started and responded over HTTP                                      |
| Dependency-rule enforcement                     | Temporary forbidden browser/server and cross-app imports were rejected; temporary files removed |
| Python distribution ownership                   | Proprietary metadata and matching Thaarei LICENSE confirmed in the wheel                        |
| Running local Turnstile development services    | Frontend, API identity, API liveness, and Vite `/api` proxy returned HTTP 200                   |
| Docker availability                             | Docker Engine 29.9.2 responds; it became available after initial workspace validation           |
| Both Compose files                              | Passed `docker compose config --quiet`                                                          |
| DMS production dependency packaging             | `pnpm deploy --prod` passed                                                                     |
| Container image builds / infrastructure startup | Not verified                                                                                    |
| Remote CI / Dokploy deployment and routing      | Workflow/configuration added; execution not verified                                            |

Documentation consolidation verified on 2026-10-31 (DOC-002, Codex): configured Biome
checks passed for 17 Markdown files (the two DMS specifications are excluded by the
existing Biome configuration); Git whitespace checks passed. All 130 relative file links
and heading targets resolved across 19 documentation files; all 120 technical blocks moved from blueprint sections 3–17 and
the distribution policy were preserved; original numbered blueprint heading targets remain.
All 189 FR statements and 14 NFR statements are unchanged. Documented direct dependency
versions were checked against manifests and Python tools against `uv.lock`. No application,
manifest, lockfile, schema, or deployment configuration changed. Runtime/build tests were
not repeated for this documentation-only task; prior runtime results above remain historical.
No blockers or remaining work for DOC-002.

Customer tenancy clarification verified on 2026-10-31 (ARC-002, Codex): affected Markdown
passed configured Biome and whitespace checks; relative links/anchors resolved. All 189
FR IDs and 14 NFR IDs remain stable; only FR-01.01, FR-01.03, FR-01.06 and FR-06.06 changed
to reflect the owner's model. Architecture, product scope, requirements, implementation
plan, deployment runbook, README and agent rules agree on one customer per installation
and multiple independently registered applications. Next DMS-001 implementation must
verify repeatable bootstrap, rejection of a second/different customer tenant, and application
isolation. No code, database schema, dependencies or deployment configuration changed;
runtime/build tests were not repeated. No blockers or remaining work for ARC-002.

Authentication research/planning handoff on 2026-10-31 (AUTH-PLAN-001, Codex): inspected
actual modules/manifests/contracts/bootstrap/proxy/Compose; no Better Auth or auth behavior
is installed. Reviewed official stable 1.7 docs, OAuth/OIDC standards and maintainer
session/client guidance; registry metadata reported Better Auth/OAuth/Drizzle-adapter/CLI
1.7.14 and the plan's candidate dependency versions. Inspected cookie/session artifacts:
both declare compatibility with the current Fastify 5.x line (resolved 5.12.7). These are
research/metadata checks, not installed dependency or runtime compatibility tests.
Documentation formatting, relative links/anchors and requirement consistency were checked;
all 189 FR statements and 14 NFR statements remain unchanged from the pre-task documents.
Email/password was confirmed by the owner. Concrete BFF/OIDC integration and new session
policies are recommendations. No application, dependency, lockfile, database or deployment
configuration changes, installs, auth tests, image builds or customer provisioning occurred.
The implementation plan covers remaining work; no blocker for completion of this planning task.

## Pending work and known gaps

These are recorded follow-ups, not active tasks or additional release commitments.

| ID       | Status   | Scope                                                                                    | Next step when authorized                                                                                                                                                                                                                                                                                                                               |
| -------- | -------- | ---------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DEV-001  | Planned  | Shared package development watching                                                      | Shared packages build at startup; add automatic rebuilds and affected API restart behavior. For now rebuild packages and restart affected apps after shared-code changes.                                                                                                                                                                               |
| OPS-001  | Planned  | Container validation                                                                     | Build application images and verify container startup, local infrastructure behavior, persistence, and resource/configuration requirements. Docker is now available.                                                                                                                                                                                    |
| OPS-002  | Planned  | Dokploy deployment verification                                                          | Deploy the implemented services to the intended Linux environment and verify domains, TLS, API routing, and health checks.                                                                                                                                                                                                                              |
| DMS-001  | Planned  | DMS requirement group 01: shared identity, one customer tenant, application provisioning | Coordinate shared identity/provisioning with the [authentication plan](docs/authentication_implementation_plan.md) and accepted [requirements](docs/headless_dms_functionality_requirements_v1.md#01-shared-identity-tenant-bootstrap-and-application-provisioning); test the minimal single-tenant/client context before onboarding the real customer. |
| AUTH-001 | Planned  | Implement the complete authentication chain from AUTH-01–AUTH-07                         | Begin with exact dependencies, validated authority config and generated/reviewed auth persistence per the [authentication plan](docs/authentication_implementation_plan.md); include isolated single-tenant/client fixtures before real customer provisioning. No implementation is authorized by this status row.                                      |
| APP-001  | Planned  | Turnstile product functionality                                                          | Agree on the business requirements before creating feature modules, screens, or schemas.                                                                                                                                                                                                                                                                |
| MIG-001  | Planned  | Source/data migration                                                                    | Identify the source application/data, scope, and migration requirements before implementation. No migration has started.                                                                                                                                                                                                                                |
| MOB-001  | Deferred | Expo/React Native application                                                            | Add the mobile client only when explicitly requested; preserve the shared backend and platform-independent contracts now.                                                                                                                                                                                                                               |

Contract payloads, schema/OpenAPI generation, database migrations, auth integration,
coordinator/publisher/worker execution, scanning, extraction, search, and document workflows
remain pending their respective DMS requirements. Empty modules and folders do not count
as implemented capabilities.

## Reference documents

- [Architecture](architecture.md): single technical reference for both products
- [Authentication implementation plan](docs/authentication_implementation_plan.md): source-backed proposal, execution order, and complete-chain acceptance
- [Workspace implementation plan](docs/workspace_implementation_plan.md)
- [Workspace standards](docs/standards/workspace.md)
- [DMS product blueprint](docs/headless_dms_product_blueprint_v1.md)
- [Sequenced DMS functionality requirements](docs/headless_dms_functionality_requirements_v1.md)
- [Dokploy runbook](docs/runbooks/dokploy.md)
- [Development commands](README.md#start-locally)
