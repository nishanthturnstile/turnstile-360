# Workspace standards

## Ownership and structure

Component ownership, repository layout, package dependencies, and data boundaries are
maintained in [architecture.md](../../architecture.md#repository-and-package-dependencies).
Keep feature controllers, services, policies, and repositories within their owning modules.
Use `workspace:*` for internal packages. Do not import other applications' implementations
or introduce a shared business database package.

## Web and future mobile clients

Follow [the Turnstile application architecture](../../architecture.md#turnstile-application-architecture)
for backend authority, client responsibilities, platform-independent contracts, and future
mobile compatibility. Do not add a mobile application without an explicit request.

## Toolchain and formatting

Use the pinned [toolchain and library inventory](../../architecture.md#installed-toolchain-and-libraries),
pnpm catalog, and lockfiles. Upgrade TypeScript only with compatible Nest generators/builds.

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
