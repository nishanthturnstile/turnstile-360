# Workspace implementation plan

Prepare the monorepo for subsequent application implementation and migration. This scope
establishes folders, application projects, package boundaries, build tooling,
basic checks, and deployment configuration. It does not implement DMS capabilities,
Turnstile business features, identity, database tables, document processing, or migration
of existing source/data. Turnstile functionality will be specified separately.

## Accepted decisions

- pnpm workspaces and Turborepo for TypeScript packages and task orchestration.
- NestJS with Fastify for both APIs; Vite/React/TypeScript for Turnstile's frontend.
- Biome for JavaScript/TypeScript; uv, Ruff, mypy, and pytest for Python.
- Linux with Dokploy-managed Compose and Traefik ingress/TLS.
- Separate Turnstile and DMS application/data ownership. Turnstile's backend consumes
  the DMS over HTTP with its own machine identity.
- The same Turnstile API will serve web and future Expo/React Native clients. Business
  logic and authoritative validation stay in the backend; shared Turnstile contracts
  remain platform-independent. Mobile implementation is future scope.
- Preserve the selected DMS stack: Better Auth/OAuth Provider, PostgreSQL/Drizzle,
  SeaweedFS, Celery/RabbitMQ, ClamAV, and the approved isolated processors. Their
  feature-specific dependencies and configuration are introduced with implementation.

## Ordered workspace tasks

| Order | Task                                  | Completion criterion                                                                                |
| ----- | ------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 1     | Initialize the workspace              | One Git repository, private manifests, runtime pins, pnpm workspace and lockfile                    |
| 2     | Generate application shells           | Nest CLI for both APIs; create-vite for the frontend; uv init for Python                            |
| 3     | Generate package/configuration shells | pnpm init and tsc --init for internal TS libraries; biome init for root configuration               |
| 4     | Apply repository standards            | Fastify, strict TS, Biome, Python checks, dependency boundaries, per-app examples                   |
| 5     | Establish the agreed structure        | CLI-generated empty DMS modules and reserved product/integration/database/processor folders         |
| 6     | Configure delivery foundations        | Dockerfiles, local and Dokploy Compose, static frontend serving, CI                                 |
| 7     | Validate the workspace                | Locked installs, all package builds, lint/type/boundary checks, API identity tests and API liveness |
| 8     | Hand off for feature planning         | Record verification limits; keep functionality and migration work out of workspace setup            |

## CLI provenance

Commands were run against the existing repository without replacing its product documentation:

```bash
pnpm init --bare --init-type module --no-init-package-manager

pnpm dlx @nestjs/cli@12.0.11 new dms-api \
  --directory apps/dms-api --skip-git --skip-install \
  --package-manager pnpm --strict --no-observe
pnpm dlx @nestjs/cli@12.0.11 new turnstile-api \
  --directory apps/turnstile-api --skip-git --skip-install \
  --package-manager pnpm --strict --no-observe

pnpm dlx create-vite@9.3.3 apps/turnstile-web --template react-ts --no-interactive
uv init apps/dms-processing --name turnstile-processing \
  --package --python 3.13 --no-workspace --vcs none --author-from none

pnpm exec biome init
```

Each internal TS package was initialized with `pnpm init` and `tsc --init` before adapting
the generated configuration. DMS module shells and health controllers were generated
with installed `nest generate module` / `nest generate controller` commands. Python
dependencies were added using `uv add --dev`; TypeScript dependencies using `pnpm add`.
Git was initialized on `main`, without a remote or an initial commit.

Framework templates were adapted to the selected standards: Express, Oxlint, Prettier,
hosted-observability guidance, demo assets, and generated deployment suggestions were
removed. The installed Nest CLI supplies Vitest, which is retained for API identity tests.
SWC preserves Nest decorator metadata in Vitest; application builds use TypeScript.

## Verification and limits

Run the commands in the README. The seven application/library projects have build tasks.
Backend tests cover application identity and the actual Fastify application wiring.
Python's current test task is a packaging/entry-point smoke check; processor tests and
frontend interaction tests begin when corresponding behavior exists.

`GET /health/live` proves only that the API process responds. No dependency readiness,
authentication, document, or processing capability is advertised by the current application entry points.

Compose files can be validated with the Docker Compose CLI without a Docker daemon.
Container image builds, service startup, storage/broker compatibility, and Dokploy routing
must additionally be verified on a machine with Docker Engine. CI includes image build
jobs; adding the workflow does not mean it has run remotely.

Workspace verification completed locally on 2026-10-31:

- Locked pnpm installation and uv sync/lock checks passed.
- `pnpm check` passed: Biome, dependency boundaries, all type checks, Ruff/mypy, and deployment YAML/build paths.
- `pnpm build` passed for all seven projects, including Python source and wheel distributions.
- `pnpm test` passed: two backend identity tests and the Python entry-point smoke check.
- `pnpm test:integration` passed: four Fastify HTTP injection checks.
- `pnpm test:smoke` passed for both compiled API entry points over HTTP.
- Both Compose files passed `config --quiet` using the official Compose v5.6.1 standalone CLI, downloaded with its official checksum verified.
- Dependency-rule verification rejected temporary forbidden browser/server and cross-app imports; temporary files were removed.
- DMS production dependency packaging with `pnpm deploy --prod` passed.

Docker Engine is unavailable in this WSL environment. Container image builds, actual
infrastructure startup, and Dokploy deployment/routing were not executed locally.

## Subsequent implementation

Define Turnstile's business functionality and migration source before creating its domain
modules or data migrations. Implement the DMS in the accepted requirement dependency
order, beginning with shared identity/provisioning. Add real contract schemas, JSON Schema/
OpenAPI generation, and cross-language fixtures with those capabilities. Add coordinator,
publisher, scanner, extraction, and heavy-worker runtime roles as their functionality is
implemented; reserved folders do not imply those roles run today.
