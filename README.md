# Turnstile 360

Thaarei monorepo for the Turnstile 360 React application/backend and the reusable,
self-hostable document management platform it consumes.

Development environments, application entry points, package boundaries, build/test
pipelines, and deployment configuration are in place. The APIs expose application
identity/liveness, the persisted shared authority and the Turnstile BFF/user access boundary. DMS authorization,
document workflows, processing jobs and business functionality remain later increments.

See [architecture.md](architecture.md) for the complete system design, component boundaries,
installed and selected stack, DMS flows, deployment picture, and shared web/future-mobile
backend architecture.

Each customer receives an installation with one tenant and multiple registered applications.
See the [customer deployment model](architecture.md#customer-deployment-and-application-model).

## Start locally

Prerequisites: Node 24.21.0, pnpm 12.16.1, uv 0.13.6. uv can install the pinned Python
3.13.18 interpreter. Docker Engine with Compose is required for local infrastructure, database integration
tests and image builds. Identity/liveness run without auth configuration; the working
authority requires prepared PostgreSQL ownership and controlled SMTP.

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
AUTH-02 connects the APIs to separately owned PostgreSQL schemas after explicit operator
setup. RabbitMQ and SeaweedFS application integration remains pending. Follow the
[authentication operations runbook](docs/runbooks/authentication.md) for separate runtime
and migration credentials, reviewed migrations, installation bootstrap and account verification.

`pnpm dev:auth` starts PostgreSQL and Mailpit plus both APIs and web, with shared-package rebuilds
and API restarts. Copy each API's `.env.example` to its `.env` and supply independent
secrets and owned database URLs first; blank examples intentionally fail preflight.
See [authentication configuration](architecture.md#authentication-configuration-foundations)
for local/test/production profiles and the full configuration contract. The command
prepares development processes; authority readiness requires valid owned roles, migrations
and installation bootstrap. Turnstile BFF readiness also requires its issued login client;
successful product login requires separately assigned local access. See the runbook's
[product access steps](docs/runbooks/authentication.md#configure-turnstile-login-and-local-access).
`pnpm check:auth:cli` verifies the pinned official generator offline without retaining tables.

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
and authentication-configuration tests and a Python CLI packaging
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
