# Turnstile 360 contracts

Architecture and component boundaries: [architecture.md](../../architecture.md).

Private package for requests, responses, validation schemas, error codes, and pagination
shared between `turnstile-web`, `turnstile-api`, and a future Expo/React Native client.
Clients and backend consume the same contract definitions. Clients own presentation and
interaction; the backend owns authoritative business logic and validation.

The package must remain platform-independent and free of DOM, Node-only, NestJS, database
dependencies, server credentials, and the DMS's internal processing contracts. Turnstile's backend translates
between its product API and the DMS API where needed.

The package exports the explicit local permission catalog and safe user-session, logout
and authentication-error DTOs, plus product-safe DMS capability/integration-error DTOs.
`turnstile:dms:capabilities:read` is a separate action permission alongside baseline
`turnstile:access`; it does not grant document operations or authority administration. The corresponding
[OpenAPI contract](../../docs/api/turnstile-auth.openapi.yaml) describes the browser boundary.
ONB-I02 adds executable Zod configuration requests/responses, bounded validation/errors,
name normalization/comparison keys, revisions, minimal workspace status, detailed setup
and a shared versioned time-zone allowlist. `turnstile:configuration:manage` is present
in the catalog; ONB-I04 implements strict accessAssignmentSchema for private operator
grants, the access/manage dependency and last-manager policy. Existing session/auth DTOs
are unchanged.

ONB-RD02 adds versioned v1/v2 setup/completion validation, a v2 `first_unit` requirement
derived from saved direct-child Site/Department units, the `structure` resume step and
strict revision-bound `UnitMove` contracts. Completed v1 root-only snapshots retain their
four requirements and original completion. `SETUP_REQUIREMENT_VERSION` identifies the
adopted v2 policy; constants alone never migrate saved configuration. RD03 implements
v2 initialization, incomplete-only upgrades, canonical readiness and first-unit
activation/deletion protection after the owning migrations. RD04 implements guarded
parent changes with atomic `unit_moved` audit and one revision per effective move.

The [onboarding OpenAPI 3.1 contract](../../docs/api/turnstile-onboarding.openapi.json)
is generated from the schemas. ONB-I03 now implements organization/setup persistence and
authenticated HTTP handlers; ONB-I04 implements private configuration grants and business
readiness enforcement, extended for v2 by RD03. The generated document includes both
setup versions and RD04's parent-change handler with its permission, validation and
lost-response reconciliation rules. RD05 consumes saved readiness in dedicated setup/waiting layouts and required first-unit forms. RD06 consumes the move contracts in a shared visual editor with confirmed keyboard/pointer/touch moves. RD07 delivers completed navigation and RD08 verifies the coordinated local release.
Compatible migrations/API/web must ship together after the dependent packages and
complete-chain verification. See the
[architecture baseline](../../architecture.md#onboarding-implementation-baseline) and
[product specification](../../docs/onboarding_specification.md) for the accepted scope.

Run from the repository root:

```sh
pnpm generate:turnstile-time-zones
pnpm docs:turnstile-onboarding
pnpm check:contracts
pnpm --filter @thaarei/turnstile-contracts test
```

Time-zone generation requires the pinned Node runtime and records ICU/Unicode/tz data
provenance. Clients validate against the committed list, independent of their local Intl
implementation. Regeneration is an explicit compatibility decision, not runtime discovery.
Allowlist provenance version 2 records explicit UTC/Kolkata/Calcutta compatibility
additions; it is independent of setup policy version. Saved identifiers are not normalized
or rewritten, and arbitrary aliases/offsets remain rejected.
`pnpm check` includes read-only drift checks for the list/provenance, generated schemas,
OpenAPI references/examples and the existing auth document's permission enumeration.

Submitted names normalize before display-length checks; normalized response names must
already be canonical. JSON Schema describes structural constraints and records semantic
normalization/cross-field rules in descriptions; executable schemas enforce those rules.
The backend still owns current authorization, graph/reference/sibling invariants, revision
locking, durable writes and repeat-safe activation. Byte limits are exported for future
HTTP adapters, which must enforce them before parsing. Header schemas validate an explicit
projection, not the entire transport header collection. No-store/session/CSRF boundaries
remain backend responsibilities.
