# Development tooling

This directory holds repository-wide development configuration. It is not included in
the application runtime as a service.

## TypeScript

`typescript/base.json` defines common compiler checks inherited by applications and
libraries. `typescript/library.json` adds NodeNext module resolution, declaration files,
and source maps for shared packages. Each project selects its own inputs and outputs.
The React application uses Vite/bundler resolution; the backends use NodeNext and Nest
decorator metadata.

The pnpm catalog pins TypeScript 6.0.3 consistently. The installed Nest generators depend
on the TypeScript compiler API, so moving to TypeScript 7 requires a compatible Nest
toolchain. An ES2023 target controls emitted JavaScript compatibility; it is separate
from the compiler's TypeScript version.

The common checks include strict null/type/property initialization checks, exact optional
properties, checked indexed access, explicit overrides, return-path checks, and switch
fallthrough checks. `verbatimModuleSyntax` preserves explicit runtime/type import intent.
Third-party declaration checking is skipped to keep package compatibility checks bounded;
our application source still receives the full configured checks.

## Dependency rules

`dependency-rules/config.cjs` configures dependency-cruiser, run by `pnpm check:boundaries`
and CI. It rejects unresolved imports, circular dependencies, direct imports between
applications, framework/database dependencies in contracts, and backend imports in the
browser application. These are source-level architecture checks, separate from runtime
authentication and authorization.

`.cjs` explicitly selects Node's CommonJS loader for this tool configuration, even though
application packages use ESM. It does not change the application module system.
