# Standalone DMS foundation

DMS-I01 delivers authority, operator authorization and machine enrollment/capabilities.
It does not deliver document storage/processing or the full v1 service set. DMS-I02 adds
the optional [protected consumer explorer and manual HTTP recipes](dms-api-explorer.md).
Design, limits and trust boundaries live in [architecture](../../architecture.md#standalone-dms-delivery-target).

## Fresh installation

Use a **new dedicated database/volume**. Preserve existing issuers, signing secrets,
installation IDs and credentials. These steps do not migrate a combined installation.

1. Copy `deploy/dms.compose.env.example` to private root `.env.dms.compose` and set
   a new PostgreSQL bootstrap password there. Keep it separate from runtime credentials.
   Copy `deploy/dms.env.example` to private root `.env.dms`; supply independently generated
   secrets, a tenant UUID/customer key, canonical HTTPS origins and a TLS SMTP relay.
   Do not include any Turnstile variable, login callback or default machine client.
   Build with `docker compose --env-file .env.dms.compose -f deploy/compose.dms.yaml build dms-api`.
2. Start PostgreSQL with `docker compose --env-file .env.dms.compose -f deploy/compose.dms.yaml up -d --wait postgres`.
   Supply its new `POSTGRES_PASSWORD` through a protected environment file. The profile
   publishes no database/host ports. Run provisioning from a trusted host with private
   database access (or the installation's private network).
3. Prepare a mode-0600 provisioning environment with `DATABASE_PROFILE=dms`,
   `PROVISION_DATABASE_URL`, and the four required URLs `AUTH_DATABASE_URL`, `DMS_DATABASE_URL`,
   `AUTH_MIGRATION_DATABASE_URL`, `DMS_MIGRATION_DATABASE_URL`. Use the exact role names
   in `.env.provision.example` and a different password for every role. To enable private
   audit inspection, also supply `DMS_OPERATOR_DATABASE_URL` at provisioning; optionally
   supply `DMS_COORDINATOR_DATABASE_URL` for private outbox inspection. Omitted private
   URLs create NOLOGIN roles. Keep both URLs outside the API runtime environment; see
   the [audit runbook](dms-audit.md). Run
   `node --env-file=<protected-provision-file> scripts/provision-auth-database.mjs`.
   This refuses existing roles; it never silently rotates them.
4. Run the compiled DMS image as a private one-off with migration credentials:
   `node dist/infrastructure/database/migrate.js auth`, then the same command with
   `dms`, then `bootstrap`. An installed checkout can use the corresponding
   `pnpm --filter @thaarei/dms-api db:migrate:auth`, `db:migrate:dms`, `db:bootstrap`.
   The bootstrap requires the fixed installation tenant/customer key and is repeat-safe;
   another tenant/customer identity fails. No product migration is involved.
5. Route `/identity/*`, `/.well-known/oauth-authorization-server/identity`, `/v1/*`
   and health checks directly to DMS port 3001 with Dokploy TLS. Runtime environment
   contains only runtime roles. Start `dms-api` from this profile; readiness remains
   unavailable until its owned migrations/bootstrap are complete. No startup seeds run.
6. Privately provision an administrator using `auth:provision-user` (or compiled
   `dist/modules/platform-auth/provision-user.js`) with bounded JSON stdin containing
   `email`, `name`, `role: "admin"`, `password`. Verify the emailed link. In machine-only
   mode it returns to the fixed `/identity/ok`; a login UI/callback is unnecessary.
   Optional `verificationUrl` must exactly match a registered consumer screen policy.
7. Privately invoke `dms:manage-operator` with the separately held DMS migration
   connection and runtime authority connection. Supply JSON stdin with `action:
   "bootstrap"`, `operatorEmail`, `operatorPassword`. The administrator must be verified,
   active and freshly authenticated. Bootstrap self only, repeat-safe for the initial
   active operator; it cannot replace the first operator with another identity. Every
   operator action requires an already bootstrapped installation and validates it read-only;
   only the separate `db:bootstrap` command creates the installation.

Never put secrets into arguments, logs, examples or browser configuration. Use protected
stdin files with redirection, and exclusive mode-0600 credential destinations. The root
LICENSE and third-party notices remain part of distribution. SMTP and Dokploy are external
configuration dependencies, not services silently installed by the foundation profile.

### One-off commands on the private Compose network

For the profile's default project name, the network is `thaarei-dms_default` and database
URLs inside it use `postgres:5432/dms`. Prepare mode-0600 `/secure/dms.provision.env`
with the provisioning variables from step 3 and `/secure/dms.migration.env` with only
installation identity plus the two migration URLs. The former contains the superuser
connection; neither file is a runtime `env_file`. Obtain the locally built image ID and
run provisioning with the repository's provisioning script mounted read-only:

```bash
dms_foundation_image="$(docker image inspect --format '{{.Id}}' thaarei-dms-foundation:local)"
docker run --rm --network thaarei-dms_default --env-file /secure/dms.provision.env --mount "type=bind,source=${PWD}/scripts/provision-auth-database.mjs,target=/app/provision-auth-database.mjs,readonly" "$dms_foundation_image" node provision-auth-database.mjs
docker run --rm --network thaarei-dms_default --env-file /secure/dms.migration.env "$dms_foundation_image" node dist/infrastructure/database/migrate.js auth
docker run --rm --network thaarei-dms_default --env-file /secure/dms.migration.env "$dms_foundation_image" node dist/infrastructure/database/migrate.js dms
docker run --rm --network thaarei-dms_default --env-file /secure/dms.migration.env "$dms_foundation_image" node dist/infrastructure/database/migrate.js bootstrap
```

Stop on any failure. These commands publish no database port and place only environment
file paths in arguments. For subsequent private account/client/operator commands use the
same image/network with a separate protected environment file containing the necessary
runtime configuration and the operation's maintenance connection, and `docker run --rm
--interactive …` to pass protected JSON stdin. Do not attach the superuser provisioning
file to those commands or to a running API. Restrict Docker access: private one-off
container environments are visible to Docker administrators while running.

## Independent machine backend

Use the existing private `auth:manage-client` command with fresh verified administrator
credentials in stdin. Issue `kind: "machine"`, an explicit distinct `clientId`, stable
`applicationId` UUID, `scopes: ["dms:capabilities:read"]` and `credentialFile`. Then use
`dms:manage-application` to `register` with the same IDs, name and scope ceiling, followed
by `issue-key` with a new private `credentialFile`. See the precise JSON contracts in
[authentication operations](authentication.md). Arbitrary valid machine names are supported;
no Turnstile identity, role, setup or application ID is required.

The consumer backend uses Basic authentication at `${issuer}/oauth2/token` with grant
`client_credentials`, exact `resource` equal to the configured DMS `/v1` resource and
scope `dms:capabilities:read`. POST `/v1/application-enrollments` with the bearer,
`X-Thaarei-Enrollment-Key`, a UUID `Idempotency-Key` and `{ "name": "<registered name>" }`.
Then GET `/v1/capabilities` with the bearer. Different applications enroll independently.
A login session never substitutes for this bearer. Publisher/scanner/extractor principals
remain reserved and acquire no new implemented scope through this increment.

Rotation immediately invalidates the old client secret; use a new credential file and
update the backend before resuming issuance. Existing JWTs expire within five minutes.
Disable through the DMS private command for immediate local denial and issuer suspension;
issuer-only suspension does not replace the live DMS registration check.

## Independent shared-user consumer

Set `AUTH_LOGIN_CLIENTS` to a JSON array, at most 32 entries. Each entry requires
`clientId`, `loginUrl`, `consentUrl`, `callbackUrl`, `logoutUrl`, `verificationUrl`,
`resetUrl`. URLs are exact canonical HTTP(S) strings without credentials, wildcard,
query or fragment; production requires HTTPS. Login/consent/verification/reset screens
must share the authority origin. The consumer owns those static screens and routes them
at that origin through ingress; credentials post directly to `/identity`, never through
the consumer backend or a document endpoint. Callback/logout can belong to the consumer
backend's other approved origin. CORS and cross-origin cookies are not opened.

Adding configuration does not create a client. Explicitly issue the configured ID with
private `auth:manage-client`, `kind: "login"`, a stable application UUID and an exclusive
credential file. Login clients require S256 PKCE and the exact callback/logout destinations;
the private managed policy explicitly skips consent for these approved first-party clients.
The consent URL remains registered for the provider interaction boundary. Configuration
changes that disagree with persisted redirect policy fail closed. To move callback/logout
origins, keep the old entry unchanged and add a new client ID with the new destinations;
explicitly issue that login client with the same stable application UUID and a new private
credential file. Switch the consumer backend to that ID/credential and policy, complete
old-session logout while the old policy remains, then suspend the old ID with
`auth:manage-client`. Remove its configuration entry only after retirement. Secret rotation
alone does not change destinations. In-place redirect updates are not supported; never
hand-edit authority tables. An invalid logout destination fails without ending the session;
use its registered destination or the direct authority `/identity/sign-out` to clear it.
Dynamic registration and raw provider management routes remain closed.

The consumer backend retains state, nonce and the PKCE verifier. It initiates code login
with the exact UserInfo resource and receives only a short-lived opaque `transaction` on
its login screen. The authority stores the provider-signed query with a five-minute expiry in its
existing verification store and sets a browser-bound HttpOnly cookie. Each independent
interaction capture removes up to 100 expired continuation records with locked rows
skipped; active continuations and provider verification/reset records remain untouched.
Without new interactions, expired records remain inert until the next capture. After successful
direct authority sign-in, navigate to `/identity/continue?transaction=<opaque-reference>`.
Consumption is atomic and single use, checks browser binding/expiry/current client policy,
and resumes the provider internally. It never accepts a caller's continuation URL.
A new flow in the same browser replaces the previous binding; restart an interrupted flow.

The callback backend verifies state and issuer, exchanges code with client credentials
and the retained verifier, verifies ID-token signature/audience/issuer/expiry/nonce and
keeps refresh tokens server-side. Logout uses POST end-session with its ID-token hint and
exact registered destination; refresh requires a live parent session. Recovery requests
supply an exact approved `callbackURL` (verification) or `redirectTo` (reset); the emailed
authority link preserves that exact screen. Machine-only recovery defaults to fixed
`/identity/ok`, where the operator can read the reset token privately and submit it to
`/identity/reset-password`; reset invalidates authority sessions.

[The independent screen fixture](../../apps/dms-api/test/independent-consumer.html) is
verification/example infrastructure, not a production frontend or a generic identity UI.

## Operator authorization and recovery

The private command authenticates email/password anew and closes the resulting session.
A browser cookie, consumer bearer or authority administrator role alone confers no DMS
operator power. The DMS migrator connection is separately held maintenance authority;
ordinary runtime roles cannot read or mutate the operator registry. All grants are bound
to the bootstrapped installation, forced RLS and an attributed atomic security event.

After bootstrap, `assign`/`revoke` require active DMS authorization plus fresh verified
identity and an explicit `subjectId`; targets must be verified active authority users.
Revoking the last active operator fails. Explicit `recover` uses separately held maintenance
authority and fresh verified administrator proof to restore that administrator's own grant.
Recovery does not infer grants from authority roles or accept an arbitrary subject.
No document-administration operation or HTTP operator endpoint ships in I01. I03 and owning
features must check live operator authorization when executing their attributed use cases;
consumer OpenAPI must never include private commands or their input credentials.

## Verification

Run `pnpm test:dms:standalone` for disposable auth/DMS-only roles/migrations/bootstrap,
independent consumers, private operator checks, discovery/token/JWKS, PKCE continuation,
Chromium screens, recovery and client rotation/disablement. It uses the existing isolated
fixture runner and removes its own containers; it never changes the local installation.
Set `DMS_STANDALONE_IMAGE` to a locally built DMS image tag when running this lane
to additionally verify packaged readiness/direct discovery against the isolated auth/DMS
database, without publishing a container port. Run the four required workspace checks as well to preserve combined/recipient behavior.
Runtime/image/Dokploy/customer TLS acceptance must be reported separately from source checks.

For current-grant private audit inspection with the dedicated operator database role, see
[the audit runbook](dms-audit.md). Inspection does not require migration credentials.

Complete versioned installation and operations: [distribution runbook](dms-distribution.md).
