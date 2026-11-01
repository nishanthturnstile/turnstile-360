# Turnstile 360

Thaarei monorepo for the Turnstile 360 React application/backend and the reusable,
self-hostable document management platform it consumes.

Development environments, application entry points, package boundaries, build/test
pipelines, and deployment configuration are in place. The APIs expose application
identity/liveness, the persisted shared authority and the Turnstile BFF/user access boundary.
Document workflows, processing jobs and business functionality remain later increments.

See [architecture.md](architecture.md) for the complete system design, component boundaries,
installed and selected stack, DMS flows, deployment picture, and shared web/future-mobile
backend architecture.

Each customer receives an installation with one tenant and multiple registered applications.
See the [customer deployment model](architecture.md#customer-deployment-and-application-model).

## Start locally

Development startup requires Docker Engine with Compose 5.6.1 or later. Host checks and
explicit operator commands use Node 24.21.0, pnpm 12.16.1 and uv 0.13.6; uv can install
the pinned Python 3.13.18 interpreter. The working authority requires prepared PostgreSQL
ownership and controlled SMTP. Docker is also required for database integration tests
and image builds.

For an already provisioned local installation:

```bash
docker compose up --build --watch
```

`pnpm dev` is an alias for that command.
Web: http://localhost:23600. DMS API: http://localhost:23601/v1; product API: http://localhost:23602/api.
Mailpit: http://localhost:23605. Use `localhost:23600` consistently for sign-in.

**Ports 23600–23608 are reserved for this application.** All host bindings use loopback
and fail on conflict; no automatic fallback is allowed. See the complete
[service/port table](architecture.md#reserved-local-ports) before assigning ports to other projects.

Source edits and compatible branch checkouts sync into the relevant containers. API/shared
code rebuilds and restarts; frontend changes use Vite hot reload. Dependency changes
rebuild images automatically. Compose owns the development processes.
See [development behavior and limits](architecture.md#local-development).

Inspect services with `docker compose ps` and `docker compose logs -f <service>`.
Use Ctrl+C or `docker compose stop` to stop; existing database/storage volumes are preserved.
Private API `.env` edits require `docker compose restart <service>`. Do not use `down -v`
unless you intend to delete local data.

For a fresh environment, prepare the root infrastructure `.env`, each API's separate
private runtime/migration configuration and the installation through the
[authentication runbook](docs/runbooks/authentication.md) first. Blank examples intentionally
do not establish a working auth installation. Development starts the existing PostgreSQL,
Mailpit, RabbitMQ and SeaweedFS services; document/broker integration remains pending.
No credentials are copied into development images or supplied to Vite. Production uses
its own Dockerfiles and Dokploy Compose; this does not change deployment.

Host tools remain useful for checks and explicit operator commands:

```bash
pnpm install --frozen-lockfile
uv sync --locked --project apps/dms-processing
```

## Verify

```bash
pnpm check
pnpm build
pnpm test
pnpm test:integration
pnpm test:smoke
```

`check` includes Biome, TypeScript, dependency boundaries, Ruff/mypy, and deployment
YAML/build-path checks plus offline Better Auth generation. `test` includes API identity
and authentication-configuration tests, development container routing checks and a Python CLI packaging
smoke check. `test:integration` exercises both Fastify application factories through
injection, then starts a disposable PostgreSQL container for real authority/persistence tests.
Docker Engine is required for `test:integration` and `test:database`. `test:smoke` starts the built API entry points
and checks their HTTP responses. `check:fix` applies Biome fixes. `pnpm test:browser:auth` runs three focused real-API/Mailpit
journeys with production-profile HTTPS/STARTTLS; install the pinned Playwright Chromium
first with `pnpm exec playwright install chromium`. See the runbook for optional Nginx image mode.

Builds cover seven projects: four application projects and three shared packages.
TypeScript 6.0.3 is pinned for Nest generator/compiler compatibility. Three focused browser authentication journeys use real APIs and Mailpit through HTTPS.
Processor and business end-to-end tests remain future feature work. The database suite
verifies AUTH-01–07 authority, isolation, persistence, product BFF, machine enrollment and
the real typed cross-service capability request over HTTP without
onboarding a real customer.


## Repository ownership

The [repository layout and package dependencies](architecture.md#repository-and-package-dependencies)
define application, contract/client, tooling, and deployment ownership.

## Documentation

- [Web design system](docs/design-system.md): shared component gallery, semantic tokens and designer/developer maintenance workflow.
- [Architecture](architecture.md): single technical reference for DMS and Turnstile components, data/work flows, stack, security, configured defaults, and deployment/recovery design.
- [Authentication implementation plan](docs/authentication_implementation_plan.md): original audit, official-source research, ordered tasks and acceptance tests. Email/password is the confirmed first login method; AUTH-01–07 implement the authority, BFF, machine enrollment/client, login/recovery UI and local operational checks; actual customer/Dokploy verification remains pending.
- [Project progress](IN_PROGRESS.md): shared agent handoff, completed milestones, current work, verification, and pending items. Read and update this when working on the repository.
- [Workspace implementation plan](docs/workspace_implementation_plan.md): ordered workspace tasks, CLI provenance, scope, and verification limits.
- [Workspace standards](docs/standards/workspace.md): ownership, toolchain, code, configuration, and testing rules.
- [Authentication operations](docs/runbooks/authentication.md): private role/migration/bootstrap/account/client commands, immediate credential cutover and fixture verification.
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
