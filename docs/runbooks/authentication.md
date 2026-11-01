# Authentication persistence and authority operations

AUTH-01–07 implement the authority, owned persistence, managed clients, product BFF,
guarded DMS enrollment, typed cross-service capability request and login/recovery UI. The configuration contract,
role boundaries, limits and remaining feature boundaries are in
[architecture.md](../../architecture.md#owned-persistence-and-authority-handler).
This runbook describes operator commands; it does not onboard a customer automatically.

Use Node 24.21.0 and pnpm 12.16.1. Run commands from the repository root after
`pnpm install --frozen-lockfile` and `pnpm build`. Production ingress and TLS remain
Dokploy responsibilities; see the [deployment runbook](dokploy.md).

## When to run these commands

Schema generation is developer work; migration and bootstrap prepare a particular
environment. Normal logins, email verification, password resets and document requests
use the running APIs and existing tables. They do not run any setup commands.

| Operation                            | When to execute                                                                                                                                          | What it changes                                                                                                           |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `auth:generate`                      | When selected Better Auth plugins/models change, or a dependency upgrade requires regenerated definitions                                                | Generated TypeScript schema in the repository; does not create live database tables                                       |
| `auth:check` / `pnpm check:auth:cli` | During development/CI to verify generated definitions remain consistent                                                                                  | Validation only; the root check uses temporary generation output and no database                                          |
| `drizzle-kit generate`               | After a schema change, for each affected owner                                                                                                           | New reviewed SQL migration files/snapshots in the repository; does not apply them                                         |
| Review                               | Before committing/applying a new migration                                                                                                               | Human inspection of SQL, ownership, privileges and tenant policies; this is not a separate command                        |
| `pnpm db:provision`                  | Once for a fresh dedicated installation database                                                                                                         | Creates the six database login roles/permissions; existing roles are rejected                                             |
| `db:migrate:*`                       | On a fresh environment, then when deploying a release containing new migrations for that owner                                                           | Applies pending committed migrations to that target database; its journal skips already applied migrations                |
| `db:bootstrap`                       | Once per fresh installation, after migrations; repeat only to verify the same identity if needed                                                         | Records the fixed tenant/customer identity, plus the product application identity; does not create users or OAuth clients |
| `auth:provision-user`                | For each new operator-approved account                                                                                                                   | Creates an unverified authority account and sends verification mail; does not grant product/DMS access by itself          |
| `auth:manage-client`                 | After installation/account setup to issue clients; later for explicit inspection, rotation, suspension or machine scope changes                          | Uses supported provider APIs; never runs automatically during startup or user requests                                    |
| `auth:set-access`                    | After account verification and login-client setup; later when explicitly granting, disabling or changing a user's product access                         | Assigns Turnstile-owned permissions using the private product migrator; no automatic role mapping from identity           |
| `dms:manage-application`             | Once to register each approved machine application and issue its enrollment key; later for explicit inspection, scope changes, revocation or disablement | Changes DMS-owned registration/key policy; never runs during ordinary requests or startup                                 |
| Enrollment HTTP request              | Once per pending consumer, after registration/key issuance; repeat the identical request only to recover an uncertain response                           | Atomically activates that application; ordinary DMS calls need only the machine token                                     |
| `pnpm docs:dms-auth`                 | After shared DMS auth DTOs or the implemented HTTP contract change                                                                                       | Regenerates committed OpenAPI from shared JSON Schemas; does not configure an environment                                 |
| `docker compose up --build --watch`  | To start an ordinary development session after environment setup                                                                                         | Starts/watches services; does not provision roles, migrate or bootstrap the installation                                  |

For a **new development or pilot environment**, prepare the dedicated database and
private configuration, provision roles once, apply the existing committed migrations,
bootstrap both APIs' installation records and configure/verify mail delivery before
provisioning accounts. Skip schema generation when the committed schema is unchanged.
Newly generated migrations must be reviewed and included in the build/release artifact
before they are applied. Subsequent development sessions only need service startup;
later releases apply any new migrations before the affected services restart.

AUTH-04 adds the generated/reviewed product migration `0003_user_permissions.sql`.
Apply it once to each target environment as part of that release; existing users receive
an empty permission set and remain denied until explicitly assigned access. No new
authority tables, schemas or database roles are needed. Schema generation and SQL review
are complete in the repository.
AUTH-05 adds DMS migrations `0003_machine_enrollment.sql` and `0004_machine_privileges.sql`.
Apply both through `db:migrate:dms` before running the updated API or private commands.
They add enrollment keys/receipts and bounded security events, reserve principal categories,
and restrict runtime registration writes. The same six database roles and three owned
schemas remain; do not rerun role provisioning for this release.
Role provisioning, migrations, bootstrap and fixture account/email flows have been
executed against disposable test databases and a test SMTP fixture. Those databases
and their data were removed by the test harness. No real customer installation,
persistent development/pilot auth database, OAuth client or external mail provider has
been provisioned by that verification. Passing tests does not prepare the target database.
Actual verification is tracked in [IN_PROGRESS.md](../../IN_PROGRESS.md).

### Switching branches during development

Start the configured installation with `docker compose up --build --watch` from the
repository root; `pnpm dev` invokes the same command. Leave it running while editing or
switching compatible branches. Source edits synchronize into the affected containers;
API/shared code rebuilds before restart and dependency changes rebuild the images.
See [development routing, behavior and limits](../../architecture.md#local-development).

The application reserves host ports 23600–23608; see the
[service/port table](../../architecture.md#reserved-local-ports). Browser auth/product
requests use `http://localhost:23600`; direct DMS/product probes use host ports 23601/23602.
Private database URLs for host operator commands and the container forwarders use
`127.0.0.1:23603`. All published services bind host loopback and fail on a port conflict.

Inspect `docker compose ps`: both APIs should become healthy before signing in. A checkout
can briefly interrupt requests. If the page already shows `/auth-unavailable`, use
**Try again** after readiness or start a fresh `/api/auth/login` at `http://localhost:23600`.
Expired/superseded signed login forms require a fresh transaction.

The same private runtime files and persistent local volumes are preserved. When adopting
the reserved ports on an existing installation, update private database/SMTP URLs and
registered OAuth redirect/logout/resource/issuer/enrollment bindings together. Preserve
credentials and active registration state; take a private backup and begin a fresh login.
Runtime startup does not perform this one-time address change automatically. Editing a
private API `.env` requires `docker compose restart dms-api` or `turnstile-api`; secrets
are never part of the images/watch sync. Restart the Compose command after changing
service topology. Fix reported code, configuration or dependency errors, and apply reviewed
migrations explicitly when the target branch requires them. Do not re-provision roles,
reset passwords or re-enroll for ordinary branch changes. Stop with Ctrl+C or
`docker compose stop`; do not remove volumes as part of normal development.

## Separate credentials and prepare the database

Use a dedicated installation database/cluster. Runtime logins must be
`thaarei_auth_runtime`, `thaarei_dms_runtime` and `thaarei_turnstile_runtime`;
migration logins must be `thaarei_auth_migrator`, `thaarei_dms_migrator` and
`thaarei_turnstile_migrator`. Supply independent generated passwords through private
operator files or a secret manager. Keep real files outside version control with
permissions restricted to the relevant operator/service account.

For local first-time setup, prepare the root infrastructure `.env` from `.env.example`,
then run `docker compose up -d postgres mailpit` to start the prerequisites in the same
local project. This does not start application services before their runtime files exist.

1. Prepare a private root `.env.provision` from [.env.provision.example](../../.env.provision.example).
   Set the administrator connection to the dedicated database and the six role URLs,
   all targeting that database. The administrative connection is used only by provisioning.
2. Run `pnpm db:provision`. It creates the six login roles and their database permissions.
   Existing roles cause failure; this command does not rotate passwords or alter account data.
3. Prepare each API's private `.env.migrate` using its `.env.migrate.example`. Include only
   that application's migration URLs and configured installation identity. Keep the
   authority, DMS and product migrator credentials distinct. These files belong to one-off
   operator processes and must never be mounted or loaded into persistent API containers.
4. Prepare runtime `.env` files from the API examples. Supply the corresponding runtime
   URLs, the same installation identity, the canonical public URLs, independent secrets,
   and the authority's SMTP settings. Client names are configuration identifiers; they
   are not provisioned OAuth client registrations. Leave migration URLs out of runtime files.

The root `.env` remains local infrastructure configuration. Vite receives no server
credentials. Production Compose maps only each API's owned runtime variables. The
provisioning command is for a fresh dedicated installation; existing databases require
an explicit operator review rather than rerunning it to change role credentials.

## Generate, review, migrate and bootstrap

The committed authority definitions were generated by `auth` 1.7.14 with all selected
plugins and the `auth` namespace. Retain Better Auth's model, relationship and column
semantics. After a configuration/plugin/schema change, use the installed commands:

```bash
pnpm --filter @thaarei/dms-api auth:generate
pnpm --filter @thaarei/dms-api auth:check
pnpm --filter @thaarei/dms-api exec drizzle-kit generate --config drizzle.auth.config.ts
pnpm --filter @thaarei/dms-api exec drizzle-kit generate --config drizzle.dms.config.ts
pnpm --filter @thaarei/turnstile-api exec drizzle-kit generate --config drizzle.turnstile.config.ts
```

Run only the relevant generation commands for the change. These commands are not
prerequisites for installing an unchanged release into a new environment.

Review generated SQL, privilege changes and snapshots before applying them. Preserve
the separate histories and explicit grants/forced tenant policies. Do not use `push`
or Better Auth's direct `migrate` command with this Drizzle deployment. The schema check
validates the Drizzle definitions; it does not prove the live database is migrated.

Apply reviewed migrations and bootstrap the configured installation:

```bash
pnpm --filter @thaarei/dms-api db:migrate:auth
pnpm --filter @thaarei/dms-api db:migrate:dms
pnpm --filter @thaarei/turnstile-api db:migrate:turnstile
pnpm --filter @thaarei/dms-api db:bootstrap
pnpm --filter @thaarei/turnstile-api db:bootstrap
```

Each command reads only its owning `.env.migrate` and uses the corresponding migrator.
Repeat migration/bootstrap is safe for the same installation. A different tenant UUID,
customer key or product application UUID fails rather than replacing existing identity.
Bootstrap creates no accounts, OAuth clients or application registrations.

The built API images include the compiled database command and reviewed migrations.
For deployment, run the same compiled command as a one-off job with the required
migrator URL and installation settings. Do not add migration credentials or migration
execution to the persistent API service. Migrate explicitly before restarting services.

## Provision an account and verify recovery

The selected development/pilot mail provider is recorded in
[architecture.md](../../architecture.md#owned-persistence-and-authority-handler).
The owner selected [Mailpit](https://mailpit.axllent.org/) for development and controlled
pilot email capture. Its default [SMTP listener](https://mailpit.axllent.org/docs/configuration/smtp/)
uses port 1025; its [web inbox](https://mailpit.axllent.org/docs/configuration/) uses port
8025. Mailpit captures messages for inspection. It does not deliver to real recipient
inboxes unless an upstream relay/forwarding setup is explicitly configured. AUTH-07 adds
pinned development Compose and a pilot STARTTLS overlay. Disposable browser verification
uses real Mailpit SMTP; no persistent customer/development/pilot inbox was provisioned.

Local Compose publishes Mailpit SMTP on reserved port 23604 and its inbox on 23605.
The DMS development container forwards its own loopback port 23604 to Mailpit's private
1025 listener, so the same nonsecret local settings work for host operator commands:

```dotenv
AUTH_SMTP_HOST=localhost
AUTH_SMTP_PORT=23604
AUTH_SMTP_MODE=plain
AUTH_MAIL_FROM=identity@example.test
```

Leave `AUTH_SMTP_USER` and `AUTH_SMTP_PASSWORD` unset for an unauthenticated local
Mailpit listener. `docker compose up --build --watch` starts and waits for PostgreSQL and Mailpit; inspect mail
at `http://localhost:23605`. Capture is disposable, limited to 200 messages/24 hours, with
no upstream relay. The development entry point provides the documented loopback forwarding inside the
API container. Other container deployments use the actual Mailpit service hostname and
TLS/STARTTLS as required by the existing SMTP validation. A production-profile pilot
also requires TLS/STARTTLS, even on loopback. Configure Mailpit's certificate/key and use
a certificate trusted by the API; do not disable certificate checks. Mail credentials,
if enabled, belong only in the DMS API's private runtime environment. Keep access to the
captured-mail inbox controlled because it contains verification/recovery links.

Pilot testers must retrieve messages from the controlled Mailpit inbox. If the pilot
requires users to receive messages in their own mailboxes, configure and verify an
upstream delivery relay before that workflow is used. Production delivery remains a
separate provider decision.

For a production-profile **pilot**, use the optional
[Mailpit overlay](../../deploy/compose.mailpit.yaml) alongside the application Compose.
Supply private operator environment paths `MAILPIT_TLS_CERT_FILE`, `MAILPIT_TLS_KEY_FILE`
and `MAILPIT_CA_CERT_FILE` outside the repository. The SMTP certificate must match the
`mailpit` service hostname and chain to that CA. The overlay mounts files read-only,
requires STARTTLS and supplies Node's trusted CA file to DMS. No SMTP host port is
published; its inbox uses the reserved host loopback port 23605 for controlled operator/SSH
access. Keep the private key readable only by the responsible operator/container account.

```sh
docker compose --env-file /secure/pilot.env \
  -f deploy/compose.dokploy.yaml -f deploy/compose.mailpit.yaml config --quiet
docker compose --env-file /secure/pilot.env \
  -f deploy/compose.dokploy.yaml -f deploy/compose.mailpit.yaml up -d
```

Run this for the intended pilot installation after its database/configuration preparation;
it is not a per-login operation. Do not disable certificate verification. Inspect a
captured verification/reset message and complete its flow before admitting pilot users.

Configure a controlled SMTP relay before provisioning accounts. Plain SMTP is available
only on local/test loopback; production requires TLS or STARTTLS. No emails are logged
as a development substitute. Use an administrator-provisioned address that can receive
the verification/recovery messages.

Run `pnpm --filter @thaarei/dms-api auth:provision-user` with a private JSON input stream
containing `email`, `name`, `role` (`admin` or `user`) and an optional `password`.
Passwords, when supplied, must meet the authority's policy. The command does not accept
passwords in arguments and prints no password, token or account data. Do not embed an
actual password in shell history. A password can be omitted: after verifying the address,
the account holder uses the supported recovery flow to set the initial password.

Account creation sends verification mail and preserves the unverified state until the
link succeeds. A delivery failure can leave an unverified account; resend verification
through the supported authority endpoint rather than changing `email_verified` manually
or recreating the account. Public signup and raw administrator/client-management HTTP
routes remain unavailable even to a signed-in administrator. First-admin access is a
private operator operation, never a public bootstrap endpoint.

After runtime configuration, migration and bootstrap, DMS `/health/ready/auth` should
return 200. `/identity/ok`, the two issuer-local discovery paths, the root OAuth metadata
alias and JWKS should respond through the authority ingress. Invalid configuration,
unsafe roles, missing tables, an unavailable database or mismatched installation leaves
auth unavailable while process liveness remains separate. Turnstile auth readiness requires
its owned installation/migrations and a live authenticated probe using the issued login
client. It returns 503 `authority_unavailable` when that dependency cannot be verified.
Readiness does not grant users product access or establish DMS machine authorization.

Before exposing the authority, route only the selected public surfaces and metadata
through Dokploy, preserve every Set-Cookie header, and keep token-bearing recovery URLs,
cookies and credentials out of ingress/access logs. Application request/debug logging is
disabled for that reason. Canonical issuer reachability, deployed HTTPS/cookies and
production relay delivery still require verification in the target environment.

## Issue and manage distinct OAuth clients

AUTH-03's policies, audiences, lifetimes, scope catalog and private administration boundary
are defined in [architecture.md](../../architecture.md#managed-oauth-provider-and-distinct-clients).
No additional database migration is needed for this increment: AUTH-02 already generated
the selected OAuth models. Apply the existing migrations and bootstrap first, configure
runtime settings, provision an administrator and complete its email verification.
Mailpit capture can support verification during development/pilot as described above.

Run the compiled command with a **private JSON input file or secret-manager input stream**:

```bash
pnpm --filter @thaarei/dms-api auth:manage-client < /secure/operator-input.json > /secure/client-record.json
```

The input accepts `action`, `kind` (`login` or `machine`), `operatorEmail`,
`operatorPassword`, optional `clientId` and action-specific fields below. Passwords and
credentials must never appear in command arguments or shell history. The default client ID
comes from the corresponding `AUTH_LOGIN_CLIENT_ID` or `DMS_MACHINE_CLIENT_ID`; keep both
backend configurations consistent. An explicit ID can provision another independent machine
application. The login policy currently uses the configured Turnstile callback/logout URLs.

| Action               | Additional fields                                                              | When to use                                                                                                 |
| -------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------- |
| `issue`              | `applicationId`; machine also requires explicit `scopes`; new `credentialFile` | Once for each new client identity; issue login and machine separately                                       |
| `inspect`            | None                                                                           | Before/after changes or when investigating an uncertain result                                              |
| `rotate`             | New `credentialFile`                                                           | Replace a client secret while retaining its client/application identity                                     |
| `suspend` / `resume` | None                                                                           | Stop/re-enable new token issuance; use DMS `disable` below for immediate local denial and issuer suspension |
| `set-scopes`         | Machine only, explicit `scopes`                                                | Change the operator-assigned machine ceiling within the implemented catalog                                 |

For example, a private machine-issuance input has this shape. Replace the sample UUID
with the intended application's fixed installation UUID and supply the private account
credentials through the protected input source:

```json
{
  "action": "issue",
  "kind": "machine",
  "applicationId": "11111111-1111-4111-8111-111111111111",
  "scopes": ["dms:capabilities:read"],
  "operatorEmail": "operator@example.test",
  "operatorPassword": "<private administrator password>",
  "credentialFile": "/secure/new-machine-credential.json"
}
```

For login issuance, use `kind: "login"`, omit `scopes` and use a different new credential
file. `applicationId` is stable across both operations for the same application. It must
match the Turnstile installation identity when provisioning Turnstile. It does not create
a DMS application registration; perform the separate registration/enrollment steps below.

The provider generates the secret. The command reserves the credential output exclusively
with mode 0600 before changing anything and never overwrites an existing file. That file
contains only `clientId` and `clientSecret`; store it outside the repository, then install
the credential in the relevant backend's private runtime environment. Stdout is a
whitelisted **nonsecret** record of action/time/operator ID, issuer, tenant/application/client
identity, resource, grants, scopes, redirects and disabled state. Preserve that record in
the operator's installation records. The temporary operator login is signed out on exit.

Issuance fails for an existing client ID; it does not reset credentials. A failed operation
may leave an empty reserved credential file or a resource/client already created. Inspect
the client state before retrying; never delete/recreate an application identity merely to
recover its credential. Use a controlled rotation if a secret was lost.

Secret rotation has **immediate cutover**, with no old-secret grace period:

1. Pause new token/refresh requests for that client in its consuming backend.
2. Run `rotate` once with a fresh private output path. The old secret stops authenticating
   immediately; the client/application IDs remain unchanged.
3. Install the newly written credential in that backend, restart/reload it as appropriate,
   verify token issuance, then resume requests. Login rotation concerns user code/refresh
   exchanges; machine rotation concerns DMS token acquisition.
4. If mutation succeeded but storing/installing the new secret failed, inspect state and
   repeat a controlled rotation to another fresh output path. Existing output files are
   deliberately not overwritten.

Rotation does not retract previously signed JWTs. Emergency DMS disconnection must also
disable the live application registration through `dms:manage-application` with `action: "disable"`. Issuer suspension
alone is not a claim that an offline JWT verifier immediately forgets an issued token.
Product logout must not suspend or rotate the machine client.

## Configure Turnstile login and local access

The [BFF architecture](../../architecture.md#turnstile-bff-and-user-authorization-boundary)
defines cookie, token, refresh, expiry, permission and logout policy. The
[OpenAPI contract](../api/turnstile-auth.openapi.yaml) lists requests and safe responses.

1. Apply pending committed product migrations with
   `pnpm --filter @thaarei/turnstile-api db:migrate:turnstile` using the private
   `.env.migrate`; verify the fixed product installation with `db:bootstrap` as needed.
   These remain deployment/operator steps, never per-user request steps.
2. Issue the distinct confidential login client using `auth:manage-client` above and
   install its returned secret only in Turnstile API runtime configuration. Keep the
   configured issuer/callback public origin canonical and reachable from both API
   containers. Restart/reload the API after changing credentials. Readiness now verifies
   that this login client can authenticate to the authority.
3. Provision/verify each authority account through the existing private command. Record
   its authority user ID from a supported operator response or verified public session
   projection. An email address or authority `admin` role does not grant Turnstile access.
4. Prepare a private JSON input file, for example:

   ```json
   { "userId": "verified-authority-user-id", "enabled": true, "permissions": ["turnstile:access"] }
   ```

   Run `pnpm --filter @thaarei/turnstile-api auth:set-access < /private/product-access.json`
   with Turnstile's private `.env.migrate`. The command validates the installation and
   dedicated operator role, upserts only that user's local assignment and prints a
   nonsecret change record. Preserve that record through the operator's controlled audit
   process. Set `enabled` to false to remove access; changes take effect at the next
   protected request. An empty permission list also denies access. Runtime APIs cannot
   write these assignments. This initial permission is an application entry gate;
   business administrator roles and business permissions are not introduced here.
5. Navigate to `/api/auth/login` (optional literal local `returnTo` path). The frontend
   credential/recovery screens are implemented by AUTH-07; the fixture flow establishes an
   authority login through the existing authority API before following the OIDC redirect.
   The callback verifies the matching authority/browser transaction and returns an opaque
   product cookie. `GET /api/auth/session` returns only the safe DTO and CSRF token.

Normal requests need none of these commands. A valid cookie alone is insufficient:
protected requests check the current parent identity and local permissions each time.
Return 503 to the UI when current authority/persistence cannot be verified; preserve the
cookie for a safe retry. Return 401/restart login when identity is revoked/expired or
refresh ownership/response is uncertain. The server handles refresh; the browser must
never obtain or persist OAuth tokens. Key changes intentionally make old encrypted/signed
sessions unusable unless a separately reviewed rotation procedure provides overlap.

For logout, POST `/api/auth/logout` with the current `X-CSRF-Token`, exact public `Origin`
and same-origin Fetch Metadata when sent by the browser. Local access ends before remote
calls. Check both DTO fields: `local: complete` plus `authority: pending` means local
logout succeeded but remote sign-out has not been confirmed. Explicitly retry the same
POST using the HttpOnly logout retry cookie and original CSRF token before `retryUntil`.
An API caller that lost the response may retry with its original product cookie/CSRF.
A completed retry also clears a stale authority browser cookie without ending a different
new parent login. The retry bound is five minutes; after it expires, use the authority's
own supported sign-out through the login UI when available. Do not claim authority logout
completed during an outage. No ID token goes into frontend URLs, and no machine client
is disabled by user logout. Direct API callers must also supply Origin and CSRF.

No persistent customer/development/pilot account, client or local-access assignment has
been created by this implementation. These steps remain required in the target environment.
Mailpit is configured for development/pilot capture; target deployment remains explicit.

## Register and enroll a DMS machine application

Run this after database migration/bootstrap and managed machine-client issuance. Keep the
same fixed application UUID and actual machine `clientId` from the nonsecret provider
record. The login client is a separate identity. Configure the private DMS migrator file
from [the example](../../apps/dms-api/.env.migrate.example), including the canonical
`AUTH_ISSUER_URL` and `DMS_RESOURCE_URL`; the latter is the enrollment deployment identity.
Registration and issuer suspension also load the authority's validated private runtime
configuration and require a verified administrator's credentials on stdin.

The compiled private command accepts a bounded JSON object through stdin:

```sh
pnpm --filter @thaarei/dms-api dms:manage-application < /secure/application-operation.json
```

Protect this input file and keep it outside the repository. For initial registration:

```json
{
  "action": "register",
  "applicationId": "11111111-1111-4111-8111-111111111111",
  "clientId": "<issued machine client ID>",
  "name": "Turnstile 360",
  "scopes": ["dms:capabilities:read"],
  "operatorEmail": "operator@example.test",
  "operatorPassword": "<private administrator password>"
}
```

This checks the supported provider record's tenant, issuer, resource, grant, application
and scopes, then creates a **pending** consumer registration. Repeating the same input
preserves its status; mismatched bindings or policy fail. Successful user login or machine
token issuance alone does not activate it. Reserved `publisher`, `scanner` and `extractor`
categories have no implemented worker access and cannot use consumer enrollment.

Next issue a key using a fresh, protected output path:

```json
{
  "action": "issue-key",
  "applicationId": "11111111-1111-4111-8111-111111111111",
  "credentialFile": "/secure/new-enrollment-key.json",
  "hours": 24
}
```

Stdout contains only nonsecret application/key IDs and expiry. The exclusive mode-0600
file contains `enrollmentKey`; it is not overwritten. The unused key expires within 24
hours and is bound to this deployment, tenant, application and machine identity. A failed
file write attempts key revocation; inspect the nonsecret state and revoke that key ID
explicitly if the outcome is uncertain. Never copy the key into browser configuration,
command arguments, URLs or ordinary logs.

From a trusted backend/operator HTTP client with request logging disabled, acquire the
machine token through the existing client-credentials flow for the exact DMS resource
and scope. Send HTTPS `POST <DMS_RESOURCE_URL>/application-enrollments` with:

- `Authorization: Bearer <machine access token>`
- `X-Thaarei-Enrollment-Key: <private enrollment key>`
- `Idempotency-Key: <new UUID retained for retries>`
- `Content-Type: application/json`, body `{"name":"Turnstile 360"}` matching the approved name.

The [OpenAPI contract](../api/dms-auth.openapi.json) defines the exact payloads and errors.
`DMS_RESOURCE_URL` already includes `/v1`; do not append that segment again. A successful activation returns 201
with a nonsecret receipt. A lost response can be recovered with the same key, body and
idempotency key; a renewed valid token for the same client is allowed. Identical replay
returns 200 with the same receipt until `replayUntil`, 24 hours after activation. A changed
body/key conflicts; `ENROLLMENT_IN_PROGRESS` is a retryable 409 with `Retry-After: 1`.
An expired unused key, explicit revocation or disabled registration denies enrollment;
a receipt never reactivates an application. Retain private retry material only as needed
for that recovery window, then remove it according to installation secret-handling policy.

After activation, `GET <DMS_RESOURCE_URL>/capabilities` requires the machine bearer
token and `dms:capabilities:read`; omit the enrollment key. Only currently implemented
operations are advertised, with empty format/profile/language lists. The typed Turnstile
adapter is implemented in AUTH-06 below; document operations remain separate feature work.

Other private inputs use the same command:

| `action`     | Additional fields beyond `applicationId`                  | When to use                                                                                                         |
| ------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `inspect`    | None                                                      | Read nonsecret registration/status/ceiling before or after an uncertain operation                                   |
| `revoke-key` | `keyId`                                                   | Revoke an issued key, including its matching enrollment replay permission; does not disable an active registration  |
| `set-scopes` | Explicit `scopes` array                                   | Change the live DMS ceiling; token scopes must also fit it. Coordinate the separate provider `set-scopes` operation |
| `disable`    | `operatorEmail`, `operatorPassword` for issuer suspension | Immediately disable local access, then suspend new token issuance at the authority                                  |

For emergency disablement, local denial commits before issuer configuration, availability
or credentials are checked. Even with missing/invalid issuer credentials, the result is
`local: disabled`, `issuer: pending` and process exit code 2. Preserve the result, correct
the issuer configuration/credentials and explicitly retry **the same disable action**.
Exit code 0 with `issuer: disabled` confirms both stages. A generic failure uses exit
code 1 and requires inspection before assuming the local commit happened. Existing JWTs
and enrollment replays are denied while local status is disabled. Provider `resume`
alone cannot undo this; no local re-enable command is supplied. Secret rotation uses
`auth:manage-client rotate` and preserves the application/registration identity.

Bounded security events are written for private account/client/bootstrap and DMS lifecycle
operations. There is no public audit browser. The dedicated operator can inspect these
records under the installation tenant when resolving a pending authority outcome; never
add secrets or raw request bodies to audit records. Follow the
[architecture retention policy](../../architecture.md#dms-machine-authorization-and-guarded-enrollment)
for maintenance planning; scheduled cleanup is not implemented.

## Verify the typed cross-service capability request

AUTH-06 adds no database migration, role or environment key. Use the previously committed
AUTH-04/05 migrations and explicit account/login-client/machine-client/access/enrollment
steps above. Starting either API does not perform registration or enrollment.

1. Install the issued machine `clientId` and secret only in Turnstile API's private
   `DMS_MACHINE_CLIENT_ID` and `DMS_MACHINE_CLIENT_SECRET`. Keep it distinct from the
   login client. Set `DMS_RESOURCE_URL` to the exact public DMS audience ending in `/v1`;
   `DMS_API_URL` is the fixed transport base and may use the internal installation network.
   The pending registration must use `TURNSTILE_APPLICATION_ID` and the configured
   installation tenant. Enroll it once through the guarded operation above.
2. Explicitly assign the verified user's permissions through the private `auth:set-access`
   command. The input must include both `turnstile:access` and
   `turnstile:dms:capabilities:read`. Existing assignments are replaced by the supplied
   complete array, so retain any other intended permissions. Existing users gain no new
   permission automatically. No business role is inferred from an authority administrator.
3. Restart/reload the backend after installing changed credentials/configuration. The
   machine token cache is local to that process. A secret rotation preserves application
   identity; use the immediate-cutover procedure above. Never install the secret or
   enrollment key in Vite/browser configuration.
4. With a valid product session from the OIDC login flow, request
   `GET /api/dms/capabilities` on the product API. Current output is
   `{"formats":[],"profiles":[],"languages":[]}` with `private, no-store`. The backend
   verifies the user/action, obtains its own short-lived machine token, reaches live DMS
   authorization and verifies the returned tenant/application binding before projection.
   No browser bearer/actor/tenant header is forwarded. AUTH-07 supplies the login UI;
   disposable browser fixtures exercise this flow without claiming deployed readiness.

`/health/ready/auth` verifies configuration, product persistence and the login authority;
it does not prove machine registration/enrollment. Use the protected capability request
for that evidence. The [product OpenAPI](../api/turnstile-auth.openapi.yaml) records the
route and product-safe error/result DTOs; the shared
[DMS client](../../packages/dms-client/README.md) supports other trusted backends.

| Result                                            | Meaning and next action                                                                                                                               |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| `401` identity/login error                        | Re-establish the user's valid product/parent login; no machine call should occur                                                                      |
| `403 PERMISSION_DENIED` / `PRODUCT_ACCESS_DENIED` | Inspect current enabled local access and explicit product permissions                                                                                 |
| `403 DMS_ACCESS_DENIED`                           | Inspect the active consumer registration, provider scopes and live DMS ceiling; do not repeatedly renew tokens                                        |
| `503 DMS_UNAVAILABLE`                             | Inspect machine credentials, canonical URLs, DMS reachability and installation binding; retain the user session and retry after the cause is resolved |
| `503 AUTH_UNAVAILABLE`                            | The preceding live identity check cannot reach/verify the shared authority; retain retryable local state and restore that dependency                  |

Only an explicit expired-machine-token response permits one automatic renewal/replay of
the capability GET. Other authentication/policy failures, issuer outages and enrollment
mutations are not automatically retried. DMS-domain errors do not log the user out; user
logout or revoked product/parent access still prevents subsequent machine calls. If the
shared DMS/authority process is down, both identity verification and machine access depend
on its recovery; session inspection cannot claim independence from it.

## Browser operation and release verification

Open the application origin and choose **Sign in**, or open `/api/auth/login` directly.
The BFF creates the transaction and the authority redirects to the signed login page.
Enter the approved account credentials there. An unverified account can request a new
verification email; successful verification starts a fresh sign-in. Recovery uses
`/forgot-password`; known and unknown addresses receive the same inbox message state.
Open the captured email's link, choose a password of 15–128 characters and sign in again.
Reset revokes existing parent sessions; the UI exposes expiry on the next checked action.
No signup or account/role management screen is included.

Use **Sign out** in the application entry. A pending or lost response exposes **Retry
sign-out** while the bounded receipt remains valid; it does not claim account completion.
Keep that page open to retain its in-memory CSRF retry context. After reload or expiry,
use the supported account sign-in/sign-out flow to resolve an uncertain authority login.
The UI distinguishes expired/denied sessions from temporary verification outages. The
document connection check never requires a browser machine credential.

Run the following during development/CI after relevant auth changes:

```sh
pnpm check
pnpm build
pnpm test
pnpm test:integration
pnpm test:smoke
pnpm exec playwright install chromium
pnpm test:browser:auth
```

The browser command provisions a disposable database and Mailpit container, uses the
production auth profile with a temporary HTTPS certificate/isolated test DNS, and drives
three focused Chromium journeys through the real APIs. It leaves running development
data untouched. Chromium trusts the fixture certificate only within its test context;
backend TLS verification remains enabled using that CA. No raw browser traces, token
URLs or credentials are written to the report. Repeat browser checks for changes to the
credential, session, recovery or ingress boundary; routine low-risk documentation changes
do not need another browser run.

Build all four images when validating release packaging, using monorepo-root contexts:

```sh
docker build -t thaarei-auth07-dms -f apps/dms-api/Dockerfile .
docker build -t thaarei-auth07-api -f apps/turnstile-api/Dockerfile .
docker build -t thaarei-auth07-web -f apps/turnstile-web/Dockerfile .
docker build -t thaarei-auth07-processing -f apps/dms-processing/Dockerfile .
AUTH_BROWSER_WEB_IMAGE=thaarei-auth07-web AUTH_BROWSER_API_IMAGE=thaarei-auth07-api pnpm test:browser:auth
```

Image mode serves the browser from the actual Nginx container and probes canonical HTTPS
discovery from an application container, using a temporary CA and host network. It does
not simulate an actual Dokploy network or establish customer DNS/TLS readiness. Processing
still runs its identification entry point; no worker is implemented.

Before admitting users to a **real installation**, record its version/environment and:

1. Apply pending committed migrations/bootstrap and explicitly provision distinct clients,
   user access and guarded application enrollment using the earlier steps. AUTH-07 adds
   no schema migration; do not recreate roles or tenant identity for a UI release.
2. Verify frontend asset/SPA paths and route priorities: `/api` to Turnstile API,
   `/identity` and the root OAuth metadata path to DMS, login/recovery/UI routes to Nginx.
   Keep canonical HTTPS names in issuer/callback/audience and validate TLS from the actual
   backend containers. Never replace issuer identity with a Docker hostname.
3. Check liveness and auth readiness separately on each API's internal listener. From
   Turnstile's container, fetch the canonical discovery/JWKS through the real ingress,
   with redirect rejection and a five-second timeout; confirm the returned issuer matches
   `AUTH_ISSUER_URL`. Do not print response credentials or resolved private environments.
   DMS connectivity is proved separately by the permission-protected connection request.
4. Complete login, verification, recovery/reset, expiry and local/authority logout using
   the actual configured email capture/delivery and intended browser origin. Check Secure,
   HttpOnly, host-only cookies and validate intended request-IP/rate-limit behavior at the
   real proxy hop. Socket-peer IP is authoritative by default; forwarded headers are not
   broadly trusted. No wildcard origin/proxy trust is enabled by this implementation.
5. Inspect redacted security JSON events for login/denial/rate limiting, recovery, token/key
   fetch, session inactivity and machine requests. Fields are only event/outcome/status,
   server request UUID and a cumulative bounded process counter. Counters reset on restart;
   existing installation logging may aggregate them. No public metrics reader is added.
6. Disable auth/callback/router access logging or remove request targets/query strings and
   credential headers from ingress logs. Verify that passwords, cookies, codes, signed
   authorization context and reset/capability URLs are absent. Nginx already suppresses
   sensitive-page logging and uses a URL-free format; apply equivalent policy to Dokploy.

These are installation/release checks, not setup work for each ordinary login or request.
Record unavailable target-server checks as pending; local fixture success is separate evidence.

## Recovery and rollback

AUTH-07 changes no schema. For a failed UI/runtime release, pause new user entry, preserve
the current database and matching signing/cookie/token-encryption key configuration, and
roll back to a compatible previous application image set. Keep reviewed migrations and
the fixed tenant/client/application mapping intact; runtime startup never re-bootstrap/reset
them. Recheck canonical discovery, readiness and the supported login/enrollment path before
resuming requests. If secrets were rotated, the old secret is already invalid: inspect state
and perform another controlled rotation rather than restoring an obsolete credential file.
Emergency application denial uses local-first `disable` and its explicit issuer retry.

Database/key restoration requires the coordinated backup/recovery procedure in
[architecture.md](../../architecture.md#backups-recovery-and-controlled-disposal), including
session/token revocation implications. No real installation backup restore or remote rollback
has been performed by the disposable verification. Retention/maintenance scheduling remains
an explicit operational follow-up.

## Verification and remaining work

`pnpm check:auth:cli` runs generation and the official schema check offline.
`pnpm test:database` creates a disposable PostgreSQL container using the pinned image,
generates test-only credentials, applies migrations, bootstraps one fixture installation,
tests both APIs, and removes the container and its volume. Docker Engine is required;
the command fails explicitly if the environment cannot run it. `pnpm test:integration`
includes this suite as well as Fastify injection checks. It does not use the running
development database or provision a real customer.

Coverage includes role/DDL isolation, tenant policies, repeated/mismatched bootstrap,
verified accounts, safe public session responses, SMTP success/failure and bounded
recovery, persistent sessions/keys/rate limits, reset rollback, the official SDK's signed
OAuth continuation, form token exchange and encrypted product session persistence.
The SDK fixture is not a deployed client registration or a real browser UI test.

AUTH-04 verifies the product BFF against a separate authority process over HTTP, using
the same disposable PostgreSQL harness. Coverage includes one-time browser transactions,
PKCE/nonce/issuer validation, current local access, authority admin separation, parent
logout/reset/suspension, restart persistence, concurrent refresh, lost/reused refresh,
bounded expiry, secure cookies, CSRF and partial/lost-response logout retries. Separate
Fastify injection cases verify default-deny permission metadata and the mutation boundary.
These AUTH-04 checks verify the protocol/API boundary; AUTH-07 browser evidence is recorded below. Target ingress remains unverified.

AUTH-05 adds focused real-PostgreSQL cases for machine/local policy denial, cross-client
and deployment key binding, replay/expiry/revocation, lock contention, atomic audit rollback,
partial disablement/retry and secret/role isolation. JWT trust-boundary checks verify
signature and credential-profile denial with real cryptographic keys.

AUTH-06 adds three focused transport tests for coalesced caching/renewal, bounded retry
semantics and real HTTP redirect/deadline/body limits. Two cross-service cases extend the
existing persisted BFF suite against the separate real DMS/authority process, verifying
machine issuance, authorization, product permission/logout, spoofed context, live scope/
disablement and outage/session separation. It does not add document operations or schemas.

AUTH-07 adds the UI and three focused real browser journeys with Mailpit, production-profile
HTTPS/STARTTLS and optional production Nginx/container discovery checks. Dated actual results
and target-server gaps are recorded in [progress](../../IN_PROGRESS.md).

Only disposable fixtures have been provisioned. Actual Dokploy/customer readiness remains
unverified until the installation-specific checks above. Periodic expired-product-session cleanup, credential/key recovery
and deployment-specific backup/retention work remain explicit operator follow-ups.
