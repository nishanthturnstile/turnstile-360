# Turnstile 360

Thaarei monorepo for the Turnstile 360 React application/backend and the reusable,
self-hostable document management platform it consumes.

Development environments, application entry points, package boundaries, build/test
pipelines, and deployment configuration are in place. The APIs expose application
identity and process liveness. Authentication, document workflows, processing jobs,
and Turnstile business functionality follow the implementation plans.

See [architecture.md](architecture.md) for the complete system design, component boundaries,
installed and selected stack, DMS flows, deployment picture, and shared web/future-mobile
backend architecture.

## Start locally

Prerequisites: Node 24.21.0, pnpm 12.16.1, uv 0.13.6. uv can install the pinned Python
3.13.18 interpreter. Docker Engine with Compose is needed only to run infrastructure
or container builds; the APIs do not depend on those services yet.

```bash
pnpm install --frozen-lockfile
uv sync --locked --project apps/dms-processing
pnpm dev:turnstile
```

Frontend: http://localhost:5173. Turnstile API: http://127.0.0.1:3002/api.
Run `pnpm dev:dms` for the DMS API at http://127.0.0.1:3001/v1, or `pnpm dev` for
all three application processes. Each API also exposes `/health/live` for process
liveness, without claiming dependency readiness.

API host/port defaults work without `.env` files. Copy an application's `.env.example`
to its own `.env` to override those values. Vite proxies `/api` to the default local
Turnstile backend port; update its proxy if that port changes.

Optional local infrastructure:

```bash
cp .env.example .env
pnpm infra:up
pnpm infra:down
```

`infra:down` preserves volumes. The root environment example is for development only.
Applications are not yet wired to PostgreSQL, RabbitMQ, or SeaweedFS.

## Verify

```bash
pnpm check
pnpm build
pnpm test
pnpm test:integration
pnpm test:smoke
```

`check` includes Biome, TypeScript, dependency boundaries, Ruff/mypy, and deployment
YAML/build-path checks. `test` includes API identity tests and a Python CLI packaging
smoke check. `test:integration` exercises both Fastify application factories through
injection, without external services. `test:smoke` starts the built API entry points
and checks their HTTP responses. `check:fix` applies Biome fixes.

Builds cover seven projects: four application projects and three shared packages.
TypeScript 6.0.3 is pinned for Nest generator/compiler compatibility. No frontend
interaction, processor, database, or end-to-end business tests exist yet.

## Repository ownership

The [repository layout and package dependencies](architecture.md#repository-and-package-dependencies)
define application, contract/client, tooling, and deployment ownership.

## Documentation

- [Architecture](architecture.md): single technical reference for DMS and Turnstile components, data/work flows, stack, security, configured defaults, and deployment/recovery design.
- [Project progress](IN_PROGRESS.md): shared agent handoff, completed milestones, current work, verification, and pending items. Read and update this when working on the repository.
- [Workspace implementation plan](docs/workspace_implementation_plan.md): ordered workspace tasks, CLI provenance, scope, and verification limits.
- [Workspace standards](docs/standards/workspace.md): ownership, toolchain, code, configuration, and testing rules.
- [Dokploy runbook](docs/runbooks/dokploy.md): container build contexts, ingress, environment, and installation boundaries.
- [DMS product blueprint](docs/headless_dms_product_blueprint_v1.md): product promise, included/deferred scope, correctness requirements, and decision history.
- [DMS functionality requirements](docs/headless_dms_functionality_requirements_v1.md): feature dependency order after workspace setup.

## Ownership

Copyright (c) 2026 Thaarei. All rights reserved. This repository contains confidential,
proprietary company software. Access and use require written authorization from Thaarei;
see [LICENSE](LICENSE). No open-source license is granted for Thaarei-owned code.

All JavaScript packages use `private: true` and `license: UNLICENSED`. The Python package
uses proprietary license metadata and a private-package classifier. Repository access
is controlled by the Git host; package metadata does not configure repository visibility.
Third-party components retain their own licenses and notices. Required product paths
retain the accepted no-mandatory-paid-license dependency policy.
