# Repository checks

These Node.js commands support development and CI. They are not deployed as application
services. `.mjs` explicitly selects ECMAScript modules, allowing Node to run them directly
without a separate TypeScript build or runtime loader.

See [architecture.md](../architecture.md#engineering-and-verification-architecture) for
how these checks fit the workspace build and verification design.

- `check-deploy.mjs`, invoked by `pnpm check:deploy`, validates Compose YAML and confirms
  that declared build contexts contain their Dockerfiles. Full Compose semantics are
  checked separately with `docker compose config`; container execution needs Docker Engine.
- `smoke-runtime.mjs`, invoked by `pnpm test:smoke` after a build, starts both compiled API
  entry points on temporary local ports, checks application identity and liveness over
  HTTP, then stops the processes. It catches startup/module-resolution errors that a
  TypeScript check or an in-process HTTP test can miss.

- `check-auth-cli.mjs`, included in `pnpm check`, loads the authority's pure TS/ESM
  options through the pinned official CLI, generates PostgreSQL plugin metadata offline
  and removes the temporary output. It also checks the committed Drizzle schema. It does not connect to PostgreSQL or apply migrations.
- `dev-auth.mjs`, invoked by `pnpm dev:auth`, checks local API configuration, starts/waits
  for PostgreSQL, then runs both APIs and web with dependency-aware Turbo watching.
  See [configuration profiles](../architecture.md#authentication-configuration-foundations).

- `provision-auth-database.mjs`, invoked by `pnpm db:provision`, is an explicit private
  operator command for fresh dedicated database roles. It never runs during API startup.
- `test-auth-database.mjs`, invoked by `pnpm test:database` and included in root
  `test:integration`, provisions a disposable PostgreSQL container with random fixture
  credentials, runs reviewed owned migrations/bootstrap and both APIs' database suites,
  then removes its container/volume. It does not touch the running development database.
  See the [operator runbook](../docs/runbooks/authentication.md).
- `generate-dms-auth-openapi.mjs`, invoked by `pnpm docs:dms-auth`, generates the DMS
  enrollment/capability OpenAPI contract from the built shared JSON Schemas. Regenerate
  after contract changes; use `node scripts/generate-dms-auth-openapi.mjs --check` after
  building to check the committed artifact without modifying it.
- `test-auth-browser.mjs`, invoked only through `pnpm test:browser:auth`, reuses the
  disposable database harness and drives three focused Chromium journeys against real
  APIs and Mailpit. It uses production-profile HTTPS/STARTTLS, an ephemeral CA and
  process-local test DNS. It neither edits global hosts nor disables backend TLS checks.
  Optional `AUTH_BROWSER_WEB_IMAGE` / `AUTH_BROWSER_API_IMAGE` values enable production
  Nginx assets and a canonical-container probe. Network unavailability is reported
  separately; TLS/metadata failures still fail. Reports omit raw URL-bearing exceptions
  and browser traces. See the [release runbook](../docs/runbooks/authentication.md#browser-operation-and-release-verification).
