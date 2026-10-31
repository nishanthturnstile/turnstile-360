# Workspace standards

## Ownership and structure

`apps/dms-api` owns the DMS control plane and initially hosts the shared identity authority.
`apps/dms-processing` owns Python processing. `apps/turnstile-api` owns Turnstile business
rules and data; `apps/turnstile-web` owns the Vite/React interface. Turnstile business
modules follow its separate functionality specification.

`packages/dms-contracts` and `packages/turnstile-contracts` contain independent public
payload definitions. `packages/dms-client` is a server-side HTTP integration package.
These currently export empty module boundaries; they do not advertise implemented APIs
or a public SDK. Internal dependencies use `workspace:*`.

Feature modules contain their own controllers, services, policies, and repositories.
Do not import another application's implementation. Do not create a shared business
database package or allow consumers to read DMS tables. Database folders reserve the
separate auth/DMS and Turnstile migration ownership; no schema or migration is applied.

## Web and future mobile clients

The Turnstile backend is the shared product API for the Vite/React web application and
a future Expo/React Native application. When mobile work is authorized, its application
can live at `apps/turnstile-mobile` and consume the same backend and Turnstile contracts.
No mobile project, dependencies, or runtime are introduced now.

Backend services own authoritative business rules, permissions, domain calculations,
workflow transitions, validation, and persistence. Clients submit intended changes; the
backend checks and applies them and returns the resulting data. The backend must enforce
these rules regardless of which client made the request.

Clients own presentation, navigation, form interaction, display formatting, and transient
UI state. They may repeat validation for immediate feedback and show optimistic updates,
but the backend remains authoritative. API responses contain domain data and outcomes;
they must not depend on browser rendering or React component structures.

`packages/turnstile-contracts` must work across backend, browser, and native clients,
without DOM, Node-only, framework UI, or database dependencies. Maintain API compatibility
for deployed client versions, including mobile versions that may update independently.
Client-specific login/session handling belongs at the authentication boundary; both
clients receive the same server-side authorization checks. Keep DMS machine credentials
and other service secrets on the backend. Turnstile's backend remains the consumer of
the DMS for both clients.

## Toolchain and formatting

Node 24.21.0, pnpm 12.16.1, Python 3.13.18, and uv 0.13.6 are the pinned toolchain.
TypeScript 6.0.3 is shared through the pnpm catalog. TypeScript 7's compiler API does not
support the installed Nest schematics; upgrade only with compatible generators/builds.

TypeScript enables strict mode, checked indexed access, exact optional properties,
explicit override checks, return-path checks, and switch fallthrough checks. Strict
property initialization is enabled in both Nest applications. Node packages use ESM/NodeNext
and explicit `.js` relative imports. Browser code uses Vite's bundler resolution. Package
consumers resolve exported `dist` files; Turborepo builds dependencies first.

Biome owns JavaScript/TypeScript formatting, import organization, and linting. Use two
spaces, single quotes, semicolons, and a 100-column line width. Use kebab-case directories
and service/controller filenames; React component names and component files may use
PascalCase. Biome's type-import rule is disabled only for Nest apps: injected classes
need runtime value imports for decorator metadata. Type-only imports remain appropriate
for interfaces and types with no runtime identity.

Python uses four spaces, Ruff, strict mypy, and a uv lockfile. Add pytest coverage as
actual processing behavior is introduced. Build/test/typecheck tasks include Python's
own package files and lockfile as task inputs. Live tests and dev tasks are not cached.

## Configuration and runtime

Each API validates its host/port at startup with Zod. API `.env` files are loaded from
the application's working directory. `.env.example` files contain nonsecret examples;
the root example is only for local infrastructure. Future feature settings must be
validated by the owning process and supplied only to that process.

The browser's VITE_* values are public build-time configuration. Keep machine credentials,
enrollment keys, signing secrets, and storage credentials on trusted backends. Validate
user/business authority in Turnstile's backend before requesting DMS capabilities.

Fastify plugins must match the selected adapter's major version. Preserve public, auth,
operator, and internal worker route boundaries as capabilities are implemented. Proxy
trust and cookie/origin settings must match the deployed ingress; neither is opened
globally by the application configuration.

## Verification

`pnpm check` runs Biome, dependency rules, TypeScript checks, Python checks, and deployment
YAML/path checks. `pnpm build` builds all seven workspace projects. `pnpm test` runs the
API identity tests and Python entry-point smoke check. `pnpm test:integration` runs
Fastify injection tests using the same application factory as production entry points.
It does not exercise database/storage/processing services yet.

Frontend interaction and browser tests will use Vitest/React Testing Library and
Playwright when real screens are introduced. Broaden checks when implemented behavior
or a failure requires it, rather than creating tests for empty placeholder folders.

## Ownership

Thaarei-owned software and documentation are confidential and proprietary under the
root LICENSE. Do not replace this with an open-source license or publish private
packages. Preserve the licensing and attribution of third-party components.
