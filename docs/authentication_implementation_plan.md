# Authentication chain: research and implementation plan

**Updated:** 2026-10-31

**Status:** AUTH-01–07 code and local verification cover authority/BFF, machine enrollment/client,
login/recovery UI and operational checks; see [IN_PROGRESS.md](../IN_PROGRESS.md) for actual evidence.
Real customer provisioning, Dokploy deployment and target container DNS/TLS verification remain pending.
The original audit/research below describes the pre-implementation state.

**Confirmed first release:** Administrator-provisioned email/password accounts, controlled
recovery, one customer tenant per installation, multiple independent applications. Company
directory SSO and mobile implementation remain later scope.

## Outcome and document ownership

Complete the real authentication path from Turnstile web to Turnstile API and then to the
DMS API, including expiry, revocation, failure handling and deployment. Better Auth remains
the shared identity authority inside DMS `platform-auth`; it does not replace Turnstile
business authorization or DMS resource authorization.

The [architecture proposal](../architecture.md#authentication-chain-implementation-proposal)
owns the technical design, credential boundaries, sequence diagram and proposed routes.
This file owns the research findings, implementation work packages and acceptance criteria.
The [requirements](headless_dms_functionality_requirements_v1.md) retain their stable IDs;
[IN_PROGRESS.md](../IN_PROGRESS.md) records actual execution. Recommended details below are
not evidence that a feature is configured or that the implementation is authorized to start.

## Repository audit

Audit performed on 2026-10-31; the existing workspace build/test results establish its
foundation, not an authentication implementation.

| Area              | Evidence                                                                                                                                              | Result                                                                                                                         |
| ----------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| DMS authority     | [PlatformAuthModule](../apps/dms-api/src/modules/platform-auth/platform-auth.module.ts), [manifest](../apps/dms-api/package.json)                     | Empty module; no Better Auth instance, adapter, plugins, auth routes, accounts or signing keys                                 |
| DMS authorization | [AccessModule](../apps/dms-api/src/modules/access/access.module.ts), [enrollment module](../apps/dms-api/src/modules/enrollment/enrollment.module.ts) | Empty modules; no bearer guard, registered application lookup, scope enforcement or enrollment                                 |
| Product backend   | [Bootstrap](../apps/turnstile-api/src/bootstrap.ts), [manifest](../apps/turnstile-api/package.json)                                                   | Fastify and `/api` prefix only; no login/callback, session store, guards or user access mappings                               |
| Browser           | [Manifest](../apps/turnstile-web/package.json), [Vite proxy](../apps/turnstile-web/vite.config.ts)                                                    | Application entry point; `/api` proxy only; no login/recovery or authority routing                                             |
| DMS client        | [Package entry point](../packages/dms-client/src/index.ts)                                                                                            | Empty export; no token acquisition/cache or authenticated HTTP operations                                                      |
| Contracts         | [DMS](../packages/dms-contracts/src/index.ts), [Turnstile](../packages/turnstile-contracts/src/index.ts)                                              | Empty exports; no auth/integration DTOs or generated contract evidence                                                         |
| Database          | Reserved auth/DMS/Turnstile schema and migration folders                                                                                              | No tables, migrations, roles or application database connections                                                               |
| Deployment        | [Compose](../deploy/compose.dokploy.yaml), [runbook](runbooks/dokploy.md)                                                                             | Three application containers; identity discovery, cookies, secrets, production persistence and auth routing are not configured |

Consequently, **Better Auth configuration and the complete authentication mechanism do
not exist yet**. Both APIs currently expose identity and liveness only.

## Research findings and design recommendation

There is no installed Better Auth version to preserve. The official version index identifies
1.7 as stable and 1.8 as beta; the npm registry reported 1.7.14 for Better Auth, the OAuth
Provider, Drizzle adapter and CLI during this review. Use the stable line for this work,
with exact compatible pins and a lockfile; do not mix in beta examples.
[Version index](https://better-auth.com/llms.txt), [Better Auth registry metadata](https://registry.npmjs.org/better-auth/1.7.14),
[OAuth Provider metadata](https://registry.npmjs.org/@better-auth%2foauth-provider/1.7.14).

| Finding                                                                                                              | Implication for this repository                                                                                                           | Primary source                                                                                                                                                                     |
| -------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Better Auth has a native Fastify handler integration                                                                 | Mount the authority directly in its owning Nest application's Fastify instance; a community Nest wrapper is unnecessary                   | [Fastify integration](https://better-auth.com/docs/integrations/fastify)                                                                                                           |
| OAuth Provider supports user code/PKCE and machine credentials; machine scope ceilings require administrator control | Register separate login and DMS machine clients; enforce client-management permissions rather than treating user scopes as machine scopes | [OAuth Provider](https://better-auth.com/docs/plugins/oauth-provider)                                                                                                              |
| Provider mode has distinct OAuth token and ordinary session-JWT paths                                                | Disable `/token` and automatic `set-auth-jwt` output while retaining JWKS                                                                 | [JWT provider mode](https://better-auth.com/docs/plugins/jwt#oauth-provider-mode)                                                                                                  |
| The standalone Drizzle adapter supports an `auth` namespace and CLI schema generation                                | Generate plugin-aware auth tables; use reviewed Drizzle migrations rather than a hand-written copy or runtime schema sync                 | [Drizzle adapter](https://better-auth.com/docs/adapters/drizzle), [CLI](https://better-auth.com/docs/concepts/cli), [Drizzle migrations](https://orm.drizzle.team/docs/migrations) |
| Password-reset session revocation is opt-in, and transactional adapter configuration matters                         | Enable reset revocation and adapter transactions; verify reset-token/session/password atomicity                                           | [Email/password](https://better-auth.com/docs/authentication/email-password)                                                                                                       |
| The authority session and JWT plugin output are different credentials                                                | Do not use an arbitrary signed token, cookie cache or ID token as DMS machine authority                                                   | [Sessions](https://better-auth.com/docs/concepts/session-management), [Cookies](https://better-auth.com/docs/concepts/cookies)                                                     |
| Browser BFF architecture keeps OAuth responsibilities and tokens in the backend                                      | Use the existing Turnstile API as the confidential login client and browser session boundary                                              | [IETF browser application guidance, section 6.1](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-browser-based-apps#section-6.1)                                            |
| JWT validation establishes signed claims, not current application permissions                                        | Verify issuer/audience/type/client identity, then apply live registration, scope and resource checks                                      | [JWT access-token profile](https://www.rfc-editor.org/rfc/rfc9068.html), [Token introspection](https://www.rfc-editor.org/rfc/rfc7662.html)                                        |
| Proxy headers can affect client-IP and external-URL interpretation                                                   | Pin the public issuer and trust only the actual ingress; verify cookie/redirect behavior behind Dokploy                                   | [Better Auth security](https://better-auth.com/docs/reference/security), [Fastify proxy trust](https://fastify.dev/docs/latest/Reference/Server/#trustproxy)                       |

The BFF recommendation is our application design based on these capabilities. The IETF
browser guidance is an Internet-Draft, not a final RFC. Existing OAuth security guidance
supports code/PKCE and exact redirects; do not introduce implicit tokens or the OAuth
resource-owner-password grant. Email/password is handled by the authority's own login
mechanism, not that OAuth grant. [OAuth security BCP](https://www.rfc-editor.org/rfc/rfc9700.html).

### Options considered

| Option                                                                   | Assessment                                                                                                                                                |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Better Auth instance and password database in every application          | Duplicates identity ownership and account recovery; conflicts with the shared-authority boundary                                                          |
| Browser holds OAuth tokens and calls DMS                                 | Breaks the selected trusted-backend DMS model and exposes the wrong authority to a client                                                                 |
| Broad shared-domain authority cookie for every application               | Expands cookie trust across applications and does not establish product permissions                                                                       |
| Custom password/session HTTP relay from Turnstile to Better Auth         | Possible, but introduces a bespoke cookie/response/proxy contract for every consumer and couples application sessions to authority implementation details |
| Shared authority plus Turnstile BFF/OIDC and separate DMS machine access | Recommended: independent application boundaries, standard login handoff, server-held credentials and a reusable issuer                                    |

The recommended option adds a product session store and standard OAuth callback handling.
That work is deliberate; it does not introduce another auth service or another password
store. Company SSO is not needed to use OpenID Connect internally.

### Revocation behavior that must be proved

The provider documents different behavior for session-bound and machine JWTs. User
introspection can observe an ended authority session when its token carries `sid`.
Machine JWTs have no user session to terminate. Do not claim immediate JWT revocation
from a secret rotation or an OAuth revocation call. Use the DMS's live local application
registration to stop its access, and short expiry for remaining token validity.
[Provider revocation behavior](https://better-auth.com/docs/plugins/oauth-provider#revoke-endpoint).

For product requests, the recommendation is authenticated user-token introspection plus
current product access checks. The callback/token test must establish the pinned release's
session binding before relying on it. If that check fails, fix the integration or define
a supported authority-side session-status contract; do not silently accept stale identity.
Logout delivery/back-channel events may improve cleanup but do not replace the online
check in the initial release. [Introspection protocol](https://www.rfc-editor.org/rfc/rfc7662.html).

## Scope and bootstrap dependency

The authentication slice covers the relevant portions of FR-01, FR-02 and FR-03, with
minimal security audit capture from FR-04. It does not complete every requirement in
those groups or any document workflow merely by adding authentication.

We can implement configuration, schema generation, guards and integration tests before
onboarding the actual customer. A real end-to-end test requires isolated fixture data:

- One installation tenant, for example a test customer representing MRR.
- An operator account and a permitted ordinary user, created through supported authority APIs.
- Separate confidential web-login and DMS machine clients.
- A pending DMS application registration, then one-time enrollment/activation.
- A product-side user/application-access mapping and a protected read capability.

Production uses the same supported provisioning boundaries; it cannot authorize an
unregistered application because bootstrap was postponed. A mismatched/second tenant
must fail. Test fixtures are explicit test-only data, not a production startup bypass,
universal credential, auto-signup route or replacement customer-onboarding feature.

Document upload/storage, extraction, staff/kids business permissions and screens, mobile,
external company SSO, general IAM UI and broad customer onboarding remain outside this
slice. Minimal login/recovery/session UI is included because the user journey needs it.

## Proposed dependencies and ownership

These were **candidate exact versions observed on 2026-10-31** during planning. AUTH-01
installs these pins; the [architecture inventory](../architecture.md#installed-toolchain-and-libraries)
and manifests own the installed selection, and [progress](../IN_PROGRESS.md) records actual checks. AUTH-01 must resolve peers and verify the actual Node 24,
TypeScript 6, Nest/Fastify, ESM and CLI build before feature code depends on them. Refresh
security/release information if implementation starts later. Preserve current pins unless
an affected compatibility check justifies a change.

| Owner                     | Proposed package / version                                       | Purpose                                                                                                             |
| ------------------------- | ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| DMS API                   | `better-auth` 1.7.14                                             | Single authority, email/password, sessions, JWT/JWKS and administrator account operations                           |
| DMS API                   | `@better-auth/oauth-provider` 1.7.14                             | User code/refresh and dedicated machine clients                                                                     |
| DMS API                   | `@better-auth/drizzle-adapter` 1.7.14                            | PostgreSQL authority adapter with explicit `auth` namespace                                                         |
| DMS API development       | `auth` 1.7.14                                                    | Official CLI schema generation, checks and first-admin creation                                                     |
| DMS and Turnstile APIs    | `drizzle-orm` 0.45.4; `pg` 8.23.1                                | Separate owned data access/pools; no cross-application queries                                                      |
| API development           | `drizzle-kit` 0.31.11; matching `pg` declarations                | Generate/review/apply owned SQL migrations                                                                          |
| Turnstile API             | `openid-client` 6.8.8                                            | Discovery, code exchange, PKCE/nonce, refresh, introspection and logout protocol support                            |
| Turnstile API             | `@fastify/cookie` 11.1.5; `@fastify/session` 11.1.6              | Product cookie and persistent BFF session integration; verify installed adapter's Fastify-major compatibility       |
| DMS API                   | `jose` 6.2.14                                                    | One JWT/JWKS verification implementation for resource-server guards; no token-signing replacement for Better Auth   |
| Web                       | `better-auth` 1.7.14 client-only exports and OAuth client plugin | Credential/recovery UI and signed authorization-flow continuation on the authority origin; no server config imports |
| Integration/browser tests | `@playwright/test` 1.64.1                                        | Real redirect/cookie/CSRF flow, expiry and recovery coverage                                                        |

The existing Nest adapter resolves Fastify 5.12.7. The inspected cookie/session package
artifacts each declare Fastify 5.x support; this is metadata compatibility evidence, not
a passed adapter integration test.

Version evidence comes from the [npm registry](https://registry.npmjs.org/), including
[adapter peers](https://registry.npmjs.org/@better-auth%2fdrizzle-adapter/1.7.14),
[OIDC client](https://registry.npmjs.org/openid-client/6.8.8),
[session plugin](https://registry.npmjs.org/@fastify%2fsession/11.1.6), and
[JWT library](https://registry.npmjs.org/jose/6.2.14).
`openid-client` 6 is an ESM library; verify the exact pinned behavior in our build.
[Maintainer documentation](https://github.com/panva/openid-client).

Use Better Auth's `admin` plugin only for controlled authority account operations; its
roles do not define Turnstile business permissions. Expose supported operator commands,
not browser admin-client CRUD or impersonation. No organization/tenant-switching, bearer
session, device authorization, API-key, social-login or company-SSO plugin is required
for this slice. [Better Auth administrator plugin](https://better-auth.com/docs/plugins/admin).

Keep Zod contract definitions in their existing packages, adding the runtime dependency
where a schema is actually authored. Do not import the server's `auth.ts` into the browser
or contracts for type sharing. Use the browser-safe SDK's client/plugin exports only.
No additional broker, cache or Python processing dependency is needed.

## Ordered work packages

Implement these as reviewable increments of the selected feature. Each increment includes
its own meaningful tests; this is not a separate architecture experiment or an instruction
to implement all authentication code now.

### AUTH-01 — Dependency, configuration and generation foundations

**Requirements:** FR-01.06/09, FR-03.01; existing workspace standards.

- Resolve and pin the candidate dependency set and required peers with pnpm, using the
  current catalog/lockfile and strict peer checks. Do not run an unpinned generator.
- Generate Nest modules/controllers/providers through the installed Nest CLI. Extend the
  existing `platform-auth`, `access`, `enrollment` and product integration boundaries.
- Separate a side-effect-free authority configuration factory from Nest runtime wiring
  so the official CLI can load plugin options without starting an HTTP listener.
- Validate public issuer/origin, callback/resource URLs, DB connections, cookie policy,
  signing/cookie/encryption secrets and separate login/machine clients with Zod.
- Define local/test/production configuration profiles and nonsecret examples. Initial
  unset secrets/clients must fail startup/readiness for auth, not enable a permissive mode.
- Make the auth development command run both APIs, web and PostgreSQL. Resolve shared
  package rebuild/restart behavior as contracts are added; preserve separate DMS commands.

**Exit:** Official CLI and generated Nest code work with TS6/ESM, exact peers resolve,
configuration failures are explicit, and existing identity/liveness behavior still works.

### AUTH-02 — Owned persistence and authority handler

**Requirements:** FR-01.01/06/07/08/09, FR-02.09, FR-03.01/02.

- Add separate PostgreSQL pools, runtime roles, migration credentials and reviewed migration
  configurations for authority, DMS and Turnstile ownership. Application roles cannot DDL
  or bypass the selected tenant policies; Turnstile cannot query auth/DMS tables.
- Generate auth tables from the exact selected plugin config in the `auth` schema. Preserve
  Better Auth's table/column/relationship semantics; do not copy a schema from a blog.
  Set the Drizzle adapter namespace and enable its transaction option explicitly.
- Generate DMS installation/registration records and Turnstile session/access persistence
  only for this feature. Enforce the one configured customer identity, tenant-aware
  consistency and uniqueness; no document/business schema is introduced.
- Enable email/password, private account provisioning, persistent authority sessions,
  database-backed verification/rate limiting and persisted signing keys. Disable public
  signup and the authority's cookie session cache initially.
- Mount the native Fastify handler outside `/v1`. Handle JSON and URL-encoded bodies,
  duplicate `Set-Cookie`, redirects, no-store responses and exact discovery paths. Keep
  the protected operator path boundary explicit; a raw handler bypasses Nest guards.
- Inspect public sign-in/session payloads for credential fields and apply the architecture's
  protocol-aware safe response projection. Prove the actual browser SDK and signed OAuth
  continuation still work; do not strip the authenticated OAuth token endpoint responses.
- Add controlled SMTP recovery callbacks and enable reset-session revocation. Keep expiry
  and reset/callback destinations bounded; require verification of operator-provisioned
  addresses before enabling their normal login. Do not log reset tokens or bootstrap passwords.

**Exit:** A fixture operator/user can sign in, retrieve/revoke a real persisted authority
session, recover access and survive an API restart. Invalid credentials, signup, bad
origins and unauthorized account administration are denied. Password/reset/session state
is transactionally consistent during an injected persistence failure.

### AUTH-03 — OAuth provider and distinct clients

**Requirements:** FR-01.02/03/04/05/08/09, FR-02.08/09/14.

- Configure JWT/JWKS with a pinned supported asymmetric signing algorithm, then the OAuth
  Provider. Disable the standalone `/token` path and `set-auth-jwt` output.
- Register the confidential Turnstile login client for code/refresh only. Require S256
  PKCE, exact callback/logout URIs and explicit first-party trust for consent skipping;
  reject unapproved clients instead of exposing a general registration/consent product.
- Register a different machine client for client credentials only, with administrator
  assigned machine scopes and allowed DMS resource. Disable dynamic/public client creation
  and explicitly deny ordinary users' create/update/scope/rotation management paths.
- Configure issuer discovery, JWKS and distinct audience/resource identifiers. The login
  client's user tokens must never receive DMS machine authorization. Inspect actual
  emitted tokens to lock the access-token type, `client_id`, expiry and session binding.
- Provide supported private issuance/rotation/suspension commands and a nonsecret operator
  record. Preserve application identity through credential rotation. Test the pinned
  provider's immediate old-secret invalidation and define the operational cutover.

**Exit:** Exact clients/grants/scopes/resources work, wrong combinations fail, user client
management cannot elevate privilege, signing keys survive restart, and rotation behavior
is known from an executable integration test rather than an assumed grace period.

### AUTH-04 — Turnstile BFF and user authorization boundary

**Requirements:** FR-01.07/09, FR-02.07/09, FR-03.01/02/09.

- Implement the proposed login/callback/session/logout routes with `openid-client` and a
  persistent Fastify session store owned by Turnstile. Generate a one-time login transaction
  bound to the browser, exact issuer, redirect, state, nonce and verifier. Bound any return
  location to approved local paths and consume the transaction atomically.
- Exchange authorization codes server-side, validate identity with the library, then
  establish a regenerated opaque product session. Store recoverable OAuth tokens encrypted
  server-side; return only a safe user/permission/session DTO. Persist no password copy.
- Add `UserSessionGuard`, current product-access checks and an explicit permission boundary.
  No local permission means denial. A Better Auth administrator or DMS application token
  must not automatically become a Turnstile business administrator.
- Check parent authority activity for protected requests through authenticated introspection
  using the login client's own tokens; verify the response subject/client/audience. Never
  authorize from a long-lived local cookie alone. Return 503 for inability to verify and
  401 for expired/revoked identity; do not treat a service outage as a wrong password.
- Implement server-controlled token refresh with persisted concurrency/fencing appropriate
  to multiple API instances. Bound the session to idle/absolute expiry and the parent
  identity session; handle a lost refresh response/reused refresh token explicitly.
  Do not hold a database transaction open across a token-endpoint HTTP call. If a refresh
  cannot be recovered safely, end the product session and require login rather than retry
  indefinitely or accept an older unfenced result.
- Apply CSRF tokens and origin/Fetch Metadata controls to product cookie mutations,
  including logout. The OAuth callback is protected by its own one-time transaction.
- On logout, invalidate local access first and revoke the retained user refresh token;
  use the supported authority sign-out to end the current parent login and clear its
  browser cookie. No ID token goes into a frontend logout URL. Clearly handle local
  logout succeeding while authority sign-out fails, and allow its controlled retry.
  Cross-app sessions linked to the ended parent may also be invalidated; machine client
  credentials remain independent. Cover direct API logout and lost-response cases too.

**Exit:** Login redirects/callbacks work end to end, unprovisioned users are denied,
product sessions survive restart, no tokens enter browser storage/responses, and revoked
parent sessions cannot continue calling protected product endpoints.

### AUTH-05 — DMS machine authorization and guarded enrollment

**Requirements:** FR-01.01/02/03/06, FR-02.01–06/08/10–16, selected FR-03 retry/error rules.

- Establish the fixture/customer's single installation record through private provisioning;
  safely repeat the same bootstrap and reject another customer's identity. Create the
  Turnstile application as pending with its expected issuer/machine `client_id`.
- Add a DMS machine guard that verifies JWT signature, supported algorithm/access-token
  type, exact issuer/audience, expiry and verified client identity. Reject session cookies,
  ID/user tokens, unsupported opaque/DPoP modes, tenant headers and unmapped clients.
- Resolve registration to the installation tenant; require active status, current scope
  ceiling and operation-specific policy on every normal DMS request. Do not infer tenant
  authority from token metadata supplied by users or queried request parameters.
- Implement bound one-time Thaarei key issuance/revocation and transactional enrollment
  with the existing idempotency receipt contract. Normal routes deny pending clients;
  the enrollment exception still requires a valid bound machine token/key. No automatic
  activation on application startup or on successful token issuance.
- Disable the local application first, then the issuer client through supported operator action.
  Live local status stops access even with an already-issued valid JWT. Preserve separate
  publisher/scanner/extraction identity categories without implementing their workers.
  If issuer disablement fails, retain the local denial, audit the partial outcome and retry
  that operator action; do not assume atomicity across independently owned pools/services.
- Capture minimal bounded security/audit outcomes from account/client/bootstrap/enrollment
  actions; public audit browsing and document audit history remain later capabilities.

**Exit:** Registration/enrollment/retry/disablement tests pass against PostgreSQL, and all
wrong-client/tenant/scope/credential-type paths are denied. No second customer can be
provisioned and no auth/session account gains DMS access merely by signing in.

### AUTH-06 — Typed machine client and real cross-service request

**Requirements:** FR-02.07/08/09, FR-03.01/02/07/08/09.

- Implement `@thaarei/dms-client` as an HTTP client over public contracts. Inject a
  server-owned token provider; keep token endpoint credentials and registration setup
  outside browser-safe contracts and outside DMS business logic.
- Acquire client-credentials tokens for the exact DMS resource/scopes, cache by issuer,
  client, resource and scope set, renew before expiry and coalesce concurrent renewals.
  Do not request a refresh token for the machine grant. Each API instance may have its
  own short-lived cache; it does not supply authorization state to DMS.
- Use fixed allowlisted service URLs, bounded deadlines and stable error translation.
  On an expired-token 401, refresh at most once when replay is safe; never loop on 403,
  enrollment failure or issuer outage. Mutating retries require idempotency semantics.
- Implement the actual protected DMS `/v1/capabilities` subset, reporting only implemented
  functions. Add a session/access-protected product capability-read adapter for the
  proof request, with a product-facing contract and no credentials/admin diagnostics.
  AUTH-05 establishes the minimal guarded DMS endpoint and shared/generated contract;
  this increment connects the typed client and product adapter to it.
  Define its final route/scope names during contract work; do not add document CRUD.
- Require the user session and product action permission before every user-triggered
  DMS call. Strip spoofed actor headers and supply bounded verified audit context only
  after the product check. Never forward browser authorization as DMS machine authority.

**Exit:** A browser-authenticated request reaches the real Turnstile handler, obtains the
separate machine token, reaches real DMS authorization, and returns an authorized
capability result. User logout, app disablement, insufficient scope or missing product
permission each stops the correct link. A DMS-domain failure does not force a false
logged-out state. If the shared DMS/authority process itself is unavailable, product
verification fails closed with an availability error, without pretending the session
was revoked; session inspection cannot promise independence from that shared process.

### AUTH-07 — Login/recovery UI, operations and completion evidence

**Requirements:** FR-01.07/08, FR-03.09; auth-related FR-19 behavior.

- Add only login, recovery/reset, expired-session and unauthorized states plus an
  authenticated application entry. Use Better Auth's supported client and OAuth-flow
  continuation on the authority-origin login page; retain the signed authorization
  context. Do not replace that flow with a browser-crafted callback URL/code exchange.
- Add safe session loading, the local/authority logout sequence and CSRF-aware product
  requests. No signup, general IAM console, role-editor, staff/kids features or mobile
  project is included.
- Configure Vite and Dokploy routing from the architecture proposal, including root
  metadata paths, canonical public URLs, trusted proxies, secure cookie names and
  controlled SMTP. Verify backend reachability of canonical issuer URLs from containers.
- Update per-service environment examples and runbook steps for migrations, private
  provisioning, enrollment, key/secret rotation, recovery and rollback. Keep secrets out
  of Vite build arguments. Preserve separate liveness/auth readiness/DMS readiness.
- Add redacted structured auth/security events and bounded metrics for denied requests,
  login/rate-limit failures, token acquisition/verification, key refresh, session expiry
  and recovery; no cookies, codes, tokens, passwords or reset/capability URLs in logs.
- Run the acceptance matrix, ordinary workspace checks, real database/service HTTP tests,
  browser tests, container image builds and documented HTTPS/proxy checks. Record exactly
  which environments were exercised and leave real-server verification pending if absent.

**Exit:** The complete agreed journey and negative cases are demonstrated with real
components. The progress record distinguishes implementation, local/container evidence
and actual Dokploy deployment. Customer provisioning can then use the tested operator path.

## CLI and file-change plan

The commands below are planned examples after their packages/configurations exist. Use
installed exact-version CLIs with pnpm; no command below has been executed by this task.

```bash
pnpm --filter @thaarei/dms-api exec nest generate service modules/platform-auth/authority
pnpm --filter @thaarei/turnstile-api exec nest generate module modules/auth
pnpm --filter @thaarei/turnstile-api exec nest generate controller modules/auth

pnpm --filter @thaarei/dms-api exec auth generate \
  --config src/modules/platform-auth/auth.ts \
  --adapter drizzle --dialect postgresql \
  --output database/auth/schema/auth.generated.ts

pnpm --filter @thaarei/dms-api exec drizzle-kit generate --config drizzle.auth.config.ts
pnpm --filter @thaarei/dms-api exec drizzle-kit migrate --config drizzle.auth.config.ts
pnpm --filter @thaarei/dms-api exec auth check --config src/modules/platform-auth/auth.ts
```

Generate the schema with all selected plugins; then review the resulting SQL, role grants,
indexes/foreign keys and migration ownership before applying it. Separate auth, DMS and
Turnstile migration histories. Do not use production `push`, generate our own password
tables or apply auth migrations with DMS request credentials. The official CLI's
first-admin command can assist private provisioning after the admin plugin/schema exists;
never place its password in shell history, command arguments or logs.

| Path                                                          | Planned changes                                                                                                  |
| ------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `apps/dms-api/src/modules/platform-auth/`                     | Configuration factory, authority instance/provider, Fastify handler integration and supported operator adapter   |
| `apps/dms-api/src/modules/access/`                            | Machine guard, verified principal, issuer/key verification and current registration/scope checks                 |
| `apps/dms-api/src/modules/enrollment/`                        | Bound key lifecycle, atomic activation/replay receipts                                                           |
| `apps/dms-api/src/modules/audit/`                             | Minimal auth/security event capture; full document audit APIs later                                              |
| `apps/dms-api/database/auth/` and `database/dms/`             | Generated authority schema and reviewed, separately owned auth/installation/registration/enrollment migrations   |
| `apps/turnstile-api/src/modules/auth/`                        | Proposed new BFF module, controllers, user-session/access guards and OIDC transaction/session/refresh services   |
| `apps/turnstile-api/src/integrations/dms/`                    | Application-specific token provider and capability-contract adapter                                              |
| `apps/turnstile-api/database/`                                | Product-owned persistent sessions, transient login transactions and explicit application-access mappings         |
| `apps/turnstile-web/src/features/auth/`                       | Minimal credential/recovery UI, safe session access and authorization-flow continuation                          |
| `packages/dms-contracts/` and `packages/turnstile-contracts/` | Implemented auth/integration DTO schemas, stable errors, generated public documentation and fixtures             |
| `packages/dms-client/`                                        | Typed HTTP operations and bounded, injected server token handling                                                |
| `tests/system/` and application tests                         | Real database/authority/API/browser chain and isolation/regression coverage                                      |
| Workspace/dev/CI/deploy configuration                         | Exact dependencies, generation/migration commands, auth proxy/routing, environment validation and release checks |

## Acceptance matrix

| Category                         | Required evidence                                                                                                                                                                            |
| -------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Valid login and protected action | Administrator-provisioned user signs in, receives only opaque product cookie, passes current product access check and reaches real DMS with a distinct machine token                         |
| Identity without permission      | Valid authority account without Turnstile access fails; valid product user without the action permission causes no DMS request                                                               |
| Invalid/disabled user            | Invalid credentials, revoked parent session, password reset, suspension and missing/expired product session each deny protected actions                                                      |
| Protocol integrity               | Wrong state/nonce/issuer, missing verifier, callback replay, unregistered redirect, token audience/type/client mismatch and unsupported grants fail                                          |
| Request/handler transport        | JSON and form-encoded requests, exact route prefixes, discovery locations, redirects, all cookies and cookie clearing work through the actual adapter and proxy                              |
| Browser boundary                 | No credentials in storage, HTML, public config or logs; hostile origins, missing CSRF, logout CSRF, login fixation and spoofed forwarding headers fail                                       |
| Tenant and registration          | Repeat same bootstrap safely; reject second/different tenant, wrong-installation registration and unrelated client; pending app remains denied outside enrollment                            |
| Enrollment                       | Expired/revoked/wrong-client/reused key, changed-body retry and concurrent activation behave per the existing contract; receipt replay never re-enables a disabled app                       |
| Machine access                   | Bad signature/algorithm/key, expired/wrong audience/scope/client, cookies/user/ID tokens and disabled app fail; scopes remain a ceiling rather than a grant to every resource                |
| Rotation and concurrency         | Signing keys and sessions survive restart; key overlap, immediately rotated client secret, parallel refresh/token fetch and stale cached tokens behave as documented                         |
| Outage and recovery              | Auth DB/authority/DMS/key-fetch outage fails closed with appropriate status; known permitted cached signing keys follow bounded policy; dependency recovery does not resurrect revoked state |
| Persistence and rollback         | Partial migration/reset/enrollment failure, test DB reset and restored session/signing state preserve required invariants; logs remain redacted                                              |

Cookie attributes, expiry and rotation follow [OWASP session guidance](https://cheatsheetseries.owasp.org/cheatsheets/Session_Management_Cheat_Sheet.html).
Product mutation defenses must follow [OWASP CSRF guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html),
not just the existence of SameSite cookies. Use the Fastify session plugin's store and
regeneration hooks, replacing its default memory store with owned PostgreSQL persistence.
[Session plugin documentation](https://github.com/fastify/session), [Cookie plugin](https://github.com/fastify/fastify-cookie).

The exact commands for new integration/browser tasks are added with implementation.
The existing required checks remain:

```bash
pnpm check
pnpm build
pnpm test
pnpm test:integration
pnpm test:smoke
```

Passing today's identity/liveness tests does not satisfy this matrix. No browser tests,
auth integration tests, image builds or HTTPS/Dokploy checks were run in this planning task.

## Operator inputs and remaining decisions

Email/password is confirmed; no further clarification is needed to finish this plan.
Before production configuration, supply the customer's public application/issuer and
DMS URLs, operator account/address-verification policy, SMTP/recovery delivery, actual
secret delivery/rotation and backup arrangements. These are configuration inputs, not
reasons to reopen the selected tenant model or add company SSO.

The BFF/OIDC detail, persistent product sessions and candidate dependencies are
recommendations for the implementation task. Confirm actual emitted token/session binding,
plugin peer compatibility, CLI schema output, atomic adapter behavior, cookie limits and
refresh concurrency as ordinary feature verification. Any material deviation updates the
architecture reference before being represented as supported behavior.

**After AUTH-07:** prepare and verify the target installation through the supported private
operator path. Local tests do not onboard a real customer or establish deployed DNS/TLS readiness.
Other product/document capabilities remain separate authorized work. See [progress](../IN_PROGRESS.md) for actual completed checks
and the [operator runbook](runbooks/authentication.md) for persistence and OAuth operator commands.
