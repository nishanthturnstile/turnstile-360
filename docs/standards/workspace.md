# Workspace standards

## Branch workflow

Work on `development` or create a new work branch from up-to-date `development`.
Fetch the latest remote state before choosing the branch base. Feature, fix, documentation,
and other work branches must always start from `development`, never `main`.
Target `development` when opening pull requests for these changes. Never commit, push
changes, or merge directly into `main`. Check the current branch before making changes;
if it is `main`, move to an allowed branch while preserving existing uncommitted work.

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

Web presentation follows the [shared design-system guide](../turnstile/design-system.md) and
its architecture reference. Reuse configured primitives/tokens and review changes in
the development gallery; keep designer/developer handoffs consistent with those sources.

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
own package files and lockfile as task inputs. Live tests are not cached. Development
watching belongs to [Docker Compose](../../architecture.md#local-development); host
toolchains remain for CI, checks, builds and explicit operator commands.

## Configuration and runtime

Each API validates its host/port at startup with Zod. Auth configuration, profiles, secret
requirements and readiness behavior follow the
[authentication foundations](../../architecture.md#authentication-configuration-foundations).
API `.env` files are loaded from the application's working directory. `.env.example` files contain nonsecret examples;
the root `.env.example` is only for local infrastructure. Private `.env.migrate` files
are for one-off operator commands; `.env.provision` is for initial database roles. Neither
belongs in a persistent API environment. Future feature settings must be
validated by the owning process and supplied only to that process.

User-management private operators follow the [access command and cutover
contract](../../architecture.md#user-management-release-compatibility). Run
`pnpm --filter @thaarei/turnstile-api access:operator <operation>` with protected JSON
stdin and the owning migration environment. `initialize` explicitly imports legacy access;
it is separate from schema migration and is not part of application startup. UM-I04's API
and replacement command require initialized canonical access and never fall back to flat
grants. Public feature writers remain gated for coordinated release. Use isolated fixtures for verification; do not initialize
the persistent installation as part of workspace checks. Operator input definitions live
in the owning `access-operator.ts`; credentials never go in command arguments or work logs.
`access:release` owns explicit verified administrator handover, versioned opening,
closing and restore-epoch quarantine. Follow the [user-management release
runbook](../runbooks/user-management-release.md); workspace checks use disposable
fixtures, and never retire credentials or open the persistent installation.

The browser uses same-origin API requests and needs no API-base environment variable.
Any future VITE_* values are public build-time configuration. Keep machine credentials,
enrollment keys, signing secrets, and storage credentials on trusted backends. Validate
user/business authority in Turnstile's backend before requesting DMS capabilities.

Fastify plugins must match the selected adapter's major version. Preserve public, auth,
operator, and internal worker route boundaries as capabilities are implemented. Proxy
trust and cookie/origin settings must match the deployed ingress; neither is opened
globally by the application configuration.

## Verification

`pnpm check` runs Biome, dependency rules, TypeScript checks, Python checks, and deployment
YAML/path checks and offline Better Auth CLI generation. `pnpm check:contracts`, included
in `pnpm check`, verifies the pinned shared time-zone list and generated onboarding
OpenAPI/examples/references against the
executable contracts, including the existing auth permission enumeration. UM-I02 also
checks generated People/scoped-access and reusable authority-invitation OpenAPI, examples,
route/security classification and local references; regenerate those with
`pnpm docs:user-management`. New contract routes are not delivered handlers. Regenerate with
`pnpm generate:turnstile-time-zones` and `pnpm docs:turnstile-onboarding` after deliberate
contract changes; generated feature contracts do not imply implemented HTTP handlers.
`pnpm build` builds all seven workspace projects. `pnpm test` runs shared contract/API
identity/auth configuration tests, focused web structure-model regressions and the Python
entry-point smoke check. `pnpm test:integration` runs
Fastify injection tests using the same application factory as production entry points.
Auth foundation coverage includes unavailable readiness and Fastify cookie/session plugin
compatibility. The root command also runs `test:database`, using a disposable pinned
PostgreSQL container for real authority, recovery, transaction, role and product-store
checks. Docker Engine is required and unavailability fails explicitly. Storage and
processing integration remain pending.

Focused web model tests use the pinned Node TypeScript support. The disposable HTTPS
Playwright fixtures run through `pnpm test:browser:auth`,
`pnpm test:browser:onboarding:structured` and `pnpm test:browser:structure`; they cover
real owning HTTP and auth/permissions rather than a second browser-only state model.
`pnpm test:browser:people` covers real private handover/opening, independent People
permissions, scoped structure and recipient mail/acceptance through production entrypoints.
`pnpm test:upgrade:user-management` exercises the owning archive/recipient release cases;
`node scripts/test-auth-database.mjs --scoped-structure` selects its owning PostgreSQL cases.
`pnpm test:images:user-management` binds the exact authority/API/web candidate and private
commands. Source/isolated verification and actual target release are separate evidence.
See [architecture.md](../../architecture.md#web-design-system) for component boundaries.
Vitest/React Testing Library remains a possible later frontend addition when needed.
Broaden checks when implemented behavior or a failure requires it, rather than creating
tests for empty placeholder folders.

## Ownership

Thaarei-owned software and documentation are confidential and proprietary under the
root LICENSE. Do not replace this with an open-source license or publish private
packages. Preserve the licensing and attribution of third-party components.
