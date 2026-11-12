# Thaarei ecosystem: control plane, customer registration and releases

This is the authoritative guide for the Thaarei operator. Use the companion
[customer installation guide](customer_deployment_guide.md) on the customer host.
Together they replace the older setup runbooks; feature-specific references cover ongoing
operations, not a competing installation sequence. Accepted design and limits remain in
[architecture](../../architecture.md), and actual qualification in
[Titan results](titan_acceptance_results.md) and [progress](../../IN_PROGRESS.md).

## Start here

Use current `development` and record the exact source/image identities. Release engineering
requires Node 24.21.0, pnpm 12.16.1, the repository-pinned Python/uv versions and Docker.
Run `pnpm install --frozen-lockfile`, then `pnpm check`, `pnpm build`, `pnpm test` and
`pnpm test:integration`. Build first; do not rebuild Next while an integration fixture uses it.
A green fixture is not acceptance of customer DNS/TLS, SMTP, backups or Dokploy.

Follow this order, switching hosts only at the explicit handoff:

1. [Configure and bootstrap central](#central), including machine signing authority.
2. [Create and publish the code/classification catalogue](#catalogue) with independent
   release-pipeline trust. [Build tooling](#delivery) exports the source-backed code metadata.
3. [Register Titan and reserve a fresh installation](#registration).
4. [Review and approve its module selection](#assignment).
5. [Build/publish that exact selected profile](#delivery), then
   [assemble the combined installer bundle](#combined-release).
6. [Download the current signed installation intent](#reservation-contracts-issue-an-intent-after-package-preparation).
7. Hand the bundle, independently verified image identities, public trust and intent to
   the customer operator. Follow [customer installation](customer_deployment_guide.md).
8. [Pair, approve and activate](#activation) as the customer reaches each waiting state.
9. Review the customer's validation evidence before handover; use
   [central recovery/reporting](#central-recovery-and-sessions) for ongoing operations.

The current combined installer is the bounded **module POC**: DMS authority/API, PostgreSQL,
selected Turnstile API/web and two reporters. Incident/Risk currently expose guarded landing
pages. The separate full DMS distribution includes storage/processing; installing that does
not itself provide Turnstile document screens or qualify the complete combined production
profile. Choose the intended profile explicitly in the customer guide.

<a id="central"></a>

## 1. Configure, bootstrap and operate central

<a id="central-host-and-configuration"></a>

### Host and configuration

Use the separate Thaarei Linux host and a **new dedicated central database/volume**.
Customer authorities, databases, credentials, ports and the standalone DMS checkout are
not inputs. Dokploy routes the central HTTPS hostname to `control-plane:3000`; there are
no public SQL or maintenance routes. Keep Compose build context at the repository root.
Use `deploy/compose.control-plane.yaml`, with private environment values matching the
app's `.env.example`; the file requires actual production inputs and has no secret defaults.

Generate at least 32 random bytes for the staff-auth secret, independently of customer
auth and deployment signing keys. Save it as a protected regular file, mode 0600
or 0400, readable by the image's node UID 1000. Set the absolute host path in
`CONTROL_PLANE_AUTH_SECRET_HOST_FILE`; Compose mounts it read-only. This is a host-file
bind secret: arrange ownership on the host rather than relying on Compose's secret mode
or uid remapping. Back up the database and auth secret encrypted together; losing the
secret loses MFA encryption and session validity. Do not rotate it as an incidental release.
The app filesystem is read-only with disposable `/tmp`; there is no image startup seed.

Use production profile, canonical HTTPS origin and an authenticated trusted TLS SMTP
relay. SMTP uses implicit TLS for `smtps:` and mandatory STARTTLS for production `smtp:`.
Certificate verification stays enabled. Staff recovery delivery checks SMTP availability after persistent HTTP rate limiting
and before account lookup. Rejected requests do not probe SMTP, and relay failures still
consume the request budget. No customer login URLs, cookies or OAuth clients are reused.

Set `CONTROL_PLANE_TRUST_PROXY=true` only when exclusive ingress overwrites
`X-Forwarded-For` with **one validated client address** and clients cannot reach Next
except through that ingress. Otherwise leave it false: rate limiting uses a shared local
bucket rather than trusting caller IP headers. Scheme/origin, cookie security and redirect
policy come from the configured origin, never forwarded host/proto headers. Configure
proxy access logs to exclude auth query strings, cookies, POST bodies and credential fields.
`/health/live` works without configuration; `/health/ready` checks owned staff persistence.
Neither means a client product is approved. Staff pages and all APIs use no-store responses.

<a id="central-private-provisioning-and-migrations"></a>

### Private provisioning and migrations

All commands below are one-off private host/container commands, **never startup hooks**.
Use protected environment/stdin files rather than credentials in arguments. The central
runtime receives only `CONTROL_PLANE_DATABASE_URL` using `control_plane_runtime` and
staff mail/auth settings. The migration URL uses `control_plane_migrator`; neither that
URL nor the provisioning superuser URL belongs in the running app environment.

1. Start only central PostgreSQL with the separately protected bootstrap password and
   `POSTGRES_DB=thaarei_control_plane`. The Compose profile publishes no host port.
2. From a trusted owning network/host, set private `CONTROL_PLANE_PROVISION_DATABASE_URL`
   to that new database's provisioning connection. Run
   `node scripts/provision-control-plane.mjs < /secure/central-role-passwords.json`.
   JSON contains `migrationPassword` and `runtimePassword`, each a distinct random
   base64url value of 32–128 characters. Existing role names cause a failure; it does not
   replace credentials. This script is repository tooling, not a public app handler.
3. With the owning migration URL supplied privately, run the built image one-off as
   `node --conditions=react-server src/server/migrate.ts` (or workspace `db:migrate`).
   Its migrations are serialized, transactional and checksum-checked. The runtime cannot
   create schema, delete staff records or rewrite/delete audit. No customer schema changes.
4. Initialize machine signing authority and bootstrap staff using the sequence below,
   then start Next with runtime credentials and verify readiness through the intended ingress.
   No account is automatically created by build, migration or startup.

### Concrete private-container startup sequence

Create a private `/secure/central` directory outside the checkout, owned by the operator
and readable only by that owner (0700). The example image runs as UID 1000; arrange file
ownership accordingly. All environment/JSON/secret files below are 0600. Replace example
paths and origins consistently. Never reuse the Titan fixture credentials or private CA.

| Private file              | Required contents                                                                                                                                                                                                                                                                                                                                |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `compose.env`             | All required substitutions in `deploy/compose.control-plane.yaml`: runtime database URL, fresh PostgreSQL password, canonical origin, SMTP URL/from, three absolute host secret paths. Add release-trust/reference host paths before applying module overlays.                                                                                   |
| `provision.env`           | `CONTROL_PLANE_PROVISION_DATABASE_URL`, using the new database's bootstrap role; Docker hostname `postgres`, port 5432.                                                                                                                                                                                                                          |
| `roles.json`              | Distinct random `migrationPassword` and `runtimePassword`, matching the URLs below.                                                                                                                                                                                                                                                              |
| `maintenance.env`         | `CONTROL_PLANE_MIGRATION_DATABASE_URL` and full runtime/mail/auth configuration needed by the private staff command. Use container paths `/private/auth-secret`, `/private/signing.json`, `/private/recovery-marker` and `/private/public-trust.json` for the corresponding `*_FILE` settings. Do not mount this environment in the running app. |
| `initialize-machine.json` | `{"action":"initialize","reason":"Initial central machine authority"}`                                                                                                                                                                                                                                                                           |
| `bootstrap-admin.json`    | The strict bootstrap object in the next section, with the real administrator email and private password.                                                                                                                                                                                                                                         |

Generate `auth-secret` and `recovery-marker` independently from a cryptographic random
source (at least 32 random bytes each). Preserve the marker outside the database restore
set. Leave `signing.json` and `public-trust.json` absent; the owning initialize command
creates them exclusively. Supply `CONTROL_PLANE_PUBLIC_KEYS_OUTPUT_FILE=/private/public-trust.json`
in maintenance configuration. Build and start only the new database first:

```sh
docker build -f apps/thaarei-control-plane/Dockerfile -t thaarei-control-plane:review .
docker compose --env-file /secure/central/compose.env -f deploy/compose.control-plane.yaml up -d postgres
```

Wait for PostgreSQL readiness. With the default Compose project, the private network is
`thaarei-control-plane_default`. If you change the project name, inspect and use its actual
network throughout; do not publish the database as a workaround. Execute sequentially:

```sh
docker run --rm -i --network thaarei-control-plane_default \
  --env-file /secure/central/provision.env \
  --mount "type=bind,source=${PWD}/scripts/provision-control-plane.mjs,target=/app/provision-control-plane.mjs,readonly" \
  thaarei-control-plane:review node provision-control-plane.mjs < /secure/central/roles.json

docker run --rm --network thaarei-control-plane_default \
  --env-file /secure/central/maintenance.env \
  --mount type=bind,source=/secure/central,target=/private \
  thaarei-control-plane:review node --conditions=react-server src/server/migrate.ts

docker run --rm -i --network thaarei-control-plane_default \
  --env-file /secure/central/maintenance.env \
  --mount type=bind,source=/secure/central,target=/private \
  thaarei-control-plane:review node --conditions=react-server src/server/machine-operator.ts \
  < /secure/central/initialize-machine.json

docker run --rm -i --network thaarei-control-plane_default \
  --env-file /secure/central/maintenance.env \
  --mount type=bind,source=/secure/central,target=/private,readonly \
  thaarei-control-plane:review node --conditions=react-server src/server/operator.ts \
  < /secure/central/bootstrap-admin.json

docker compose --env-file /secure/central/compose.env -f deploy/compose.control-plane.yaml up -d --build control-plane
```

Stop on the first failure and inspect its owning receipt; do not rerun fresh-only creation
blindly. The built runtime receives only the base Compose runtime settings. Attach it to
Dokploy ingress declaratively and route the central HTTPS domain to port 3000. Check
`/health/ready`, then complete verification/login/MFA. Apply both module trust and reference
overlays when ready to publish module artifacts; they do not add another database:

```sh
docker compose --env-file /secure/central/compose.env \
  -f deploy/compose.control-plane.yaml \
  -f deploy/compose.control-plane-modules.yaml \
  -f deploy/compose.control-plane-module-deliveries.yaml config --quiet
```

Use that same reviewed file set for `up -d`. Keep signer, auth secret and marker custody
separate from the public trust delivered to customers. The [architecture](../../architecture.md)
defines backup/restore boundaries; the recovery sections below define the owning actions.

<a id="central-first-administrator-and-employee-admission"></a>

### First administrator and employee admission

Run `node --conditions=react-server src/server/operator.ts` (workspace `staff:operator`)
with private JSON stdin and the owning maintenance URL. Bootstrap input is:

```json
{
  "action": "bootstrap",
  "email": "administrator@example.test",
  "name": "Administrator",
  "password": "SUPPLY_A_PRIVATE_PASSWORD_OF_15_TO_128_CHARACTERS",
  "reason": "Initial central administrator handover"
}
```

The bootstrap is available only while the staff registry is empty; simultaneous/repeated
attempts cannot create another first admin. It records admission and safe metadata in one
transaction. Supply the runtime/mail/auth configuration as well for verification delivery.
If delivery or its runtime configuration fails after the account commits, it preserves
the structured administrator ID/verification-required receipt and reports delivery pending; use the public
verification screen to retry. Do not rerun bootstrap to create another account.

The administrator follows the verification email, signs in at `/access`, confirms the
password to obtain the authenticator setup URI and recovery codes, saves those codes
privately, then verifies TOTP. Enrollment alone grants no staff access. Every employee,
including Viewer, needs MFA. Codes and passwords stay in memory; reset token query strings
are removed from the browser URL on entry. No auth response exposes a session token.

An administrator with recent MFA uses `/staff` to explicitly admit an employee's email,
name and fixed role. Admission stores a random inaccessible initial password; it is never
shown or emailed. Give the employee the central `/access` address through the organization's
normal channel. They select Verify email, follow the email, then Reset password to choose
their own password and enroll MFA. Delivery is explicitly retryable; a failed mail delivery
does not undo admission or create a second account. There is no public signup or customer
identity import. The staff registry is bounded to 200 records including disabled accounts.

Staff role/access updates require the saved revision and recent MFA, serialize against
other updates/recovery, commit with attributed audit metadata and revoke the target's
sessions. A readback shows the saved role/revision. Last-admin removal requires another
active, email-verified, MFA-enrolled administrator, so an unverified newly admitted admin
cannot satisfy that safeguard. Current role/active state is checked on every server page
and API entry. This increment uses Route Handlers; it exposes no Server Actions.

<a id="central-recovery-and-sessions"></a>

### Recovery and sessions

Normal password reset revokes existing sessions and preserves MFA. One unused recovery
code can replace TOTP for a sign-in; it does not disable MFA. Authenticated staff can verify
TOTP again from Account options when sensitive changes require fresh MFA. Sessions expire
absolutely and after inactivity under the architecture policy; an expired idle session
must sign in again rather than reopening by factor verification alone. Logout deletes the
native session and its MFA proof. Browser cookies are HttpOnly, Secure on HTTPS, SameSite
Lax and host-only, with a central-specific prefix.

If the administrator loses all factors, run the private operator with `action: "recover"`,
the **existing verified admitted email and current password**, a nonempty name and reason,
and separate maintenance authority. It rechecks password proof under the owning lock,
restores that staff identity as active Admin, revokes all its sessions and resets MFA.
It never admits an unknown address or marks an unverified email verified. This explicit
maintenance action is an administrator recovery operation, not ordinary employee recovery;
keep that authority separately controlled. Sign in and enroll a fresh authenticator before
staff data reopens. No public MFA-disable or staff-recovery endpoint exists. Password loss
uses the verified mailbox reset first; mailbox/maintenance loss needs a separately reviewed
owning-host recovery, not a public bypass.

Database and secret restore must follow the supported quarantine/trust workflow in
architecture before future machine issuance or customer enforcement is enabled. TCP-I08
qualifies the complete recovery/release chain; TCP-I02's staff recovery test is not that
qualification. SMTP, target DNS/TLS/proxy policy, off-host backups and target operation
remain separately qualified deployment inputs.

<a id="central-client-and-deployment-registry"></a>

### Client and deployment registry

Use Clients from the signed-in workspace. All admitted roles can search/read the fleet;
Admin and Operator can register/edit/archive clients and register installations/products.
Client codes are permanent, canonical uppercase identifiers. Optional business contact
fields stay central and are never customer-report payloads. Archive status is administrative:
existing product policy is unchanged. An archived client can be read and its products can
still be explicitly suspended/reapproved, but adding deployments requires unarchiving first.
There is no hard-delete endpoint for registry identities or history.

For adoption of an existing installation, register its environment code, display label and the local installation/
tenant UUIDs supplied by the customer operator. Environment codes are stable lowercase slugs;
production/test use the same approval terms. An installation's client/environment/local/
tenant binding cannot be edited. Each installation has one DMS and optionally one Turnstile
record; Turnstile requires its local application UUID, and the DMS product itself has no
consumer application UUID. Product registration takes both client and installation IDs;
the owning composite foreign key rejects inconsistent combinations.

Review changes before confirming them. Policy decisions require MFA verified within the
architecture's recent-MFA window. Admin/Operator may approve/reapprove or reject; suspension
requires Admin. Rejection is available only for pending products. Previously approved
products must be suspended rather than reset to pending/rejected. Every real transition
requires the saved revision and a reason, advances the policy revision, records actor/time
and audit atomically, and conflicts on stale or repeated decisions. Registration/approval
and activation/contact/activity dates have separate meanings. Unavailable activation,
version, health and contact fields say so; registration or approval never invents go-live.

Approval requires server-owned verified pairing metadata. TCP-I04 supplies its authenticated
owning transaction; no UI checkbox, registry field or manual SQL bypass establishes it.
The registry fixture also uses actual pairing HTTP. Pairing never approves a product.

Every mutation carries a request UUID. Keep the same request and inputs when retrying after
an uncertain response. A committed request returns the same immutable receipt and cannot
repeat its audit/change. Changed inputs or another actor cannot reuse its UUID. The UI keeps
an uncertain request in memory, offers Retry same request, then reads the canonical saved
record. It does not treat an old receipt as current policy; an old approval receipt cannot
undo a later suspension. Reload discards a draft only after confirmation. Keep the registry
tab open while verifying MFA in another tab so a pending request remains available.

The staff HTTP surface is app-owned, with strict platform-independent schemas under
`src/contracts/registry.ts`; it is separate from TCP-I04's machine protocol:

| Method/path                             | Contract and authority                                                                                                           |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| GET `/api/registry/clients`             | Current staff/MFA; `q` (literal code/name substring), `archived=active/archived/all`, optional `after` code cursor; bounded page |
| GET `/api/registry/clients/:id`         | Current staff/MFA; canonical client, bounded installations/products and latest activity in one consistent read snapshot          |
| POST `/api/registry`                    | Exact-origin JSON command with `type`, `requestId`, `reason`; writer role checked live in the owning transaction                 |
| GET `/api/registry/receipts/:requestId` | Current staff/MFA and original actor; immutable historical receipt, never current business permission                            |

Command types are `client.create`, `client.update`, `installation.create`, `product.create`
and `product.policy`. Client update is a complete editable snapshot: send saved `revision`,
`name`, explicit nullable `contactName`/`contactEmail` and `archived`; omitting contacts is an
error rather than silently clearing them. Code and binding fields are not update inputs.
Product policy takes product `id`, saved policy `revision`, `decision=approve|reject|suspend`
and reason. Strict schemas reject client-asserted pairing, policy or unknown fields.
A policy retry still requires current writer authority/recent MFA; its owner can read the
historical receipt separately. The readback is authoritative after any receipt recovery.

See architecture for configured list/detail capacities and schema/privilege ownership.
Apply new owning migrations before opening a registry release. Readiness checks the registry
as well as staff persistence. Existing staff migration SQL/filenames remain unchanged;
the Drizzle journal now tracks the reviewed custom privilege steps so later CLI-generated
migrations have non-conflicting sequence numbers. No customer database migration is involved.

<a id="central-private-machine-authority-and-pairing"></a>

### Private machine authority and pairing

Follow the architecture's protocol, timing and trust rules. Apply all migrations shipped with the selected release before opening it. Runtime cannot modify the
independent authority digest or rewrite/delete machine receipts/issued-decision evidence.
The owning protocol can update pairing metadata; registry bindings remain immutable.

Create a protected host recovery marker with at least 32 random bytes, outside the database
restore set. Supply its absolute path in `CONTROL_PLANE_RECOVERY_MARKER_FILE`. Also set
`CONTROL_PLANE_SIGNING_KEY_FILE`, `CONTROL_PLANE_PUBLIC_KEYS_OUTPUT_FILE`, canonical
`CONTROL_PLANE_PUBLIC_ORIGIN` and the private migrator URL. With private JSON stdin
`{"action":"initialize","reason":"<reviewed setup reason>"}`, run
`pnpm --filter @thaarei/thaarei-control-plane machine:operator`. It exclusively creates
owner-only signing/public-output files and initializes the central authority digest.
It prints no keys. Existing files/authority conflict rather than being overwritten. If an
initialization failed after creating files, preserve them and inspect the migration/authority
outcome before choosing new unused output paths; never overwrite a working signer blindly.
The image contains the same private command under `src/server/machine-operator.ts`.

For Compose, map protected host files with `CONTROL_PLANE_SIGNING_KEY_HOST_FILE` and
`CONTROL_PLANE_RECOVERY_MARKER_HOST_FILE`; the app sees `/run/secrets/control-plane-signing`
and `/run/secrets/control-plane-recovery`. Files must be mode 0600/0400 and readable by UID
1000. Only the central process receives the private signer. Distribute the public trust
bundle through the separate authenticated operator/release channel. Runtime never receives
`CONTROL_PLANE_PUBLIC_KEYS_OUTPUT_FILE` or the migrator URL. Staff access can boot without
machine config outside Compose; machine issuance/approval fails closed until provisioned.

The private product operator exports a `LocalSetupManifest` from the product-owned durable
identity file, before central registration. Run the built Node-only package operator with
private JSON stdin: `{"action":"manifest","localIdentityFile":"<absolute durable identity JSON>",
"outputFile":"<new absolute manifest path>"}`. It validates version, installation/tenant,
product/application, environment and safe build version, and never changes identity or
includes service credentials. Product-specific commands obtaining this owned identity are
TCP-I05/I06 integration; do not infer it from a container ID or rewrite OAuth identity.
Staff registers the manifest's exact expected identity and downloads the nonsecret expected
manifest from the product's **Deployment setup and credentials** section.

Admin/Operator with recent MFA may issue a 24-hour one-use pairing file or revoke an unused
code by pairing ID. Review the reason/action before confirming. The browser creates a random
code in memory and downloads the file after the metadata commits; it does not store the code
in local/session storage, URLs, database receipts or audit. Keep the page open after uncertain
responses and retry the same request. A completed page can download the held file again;
reload clears it. If it is lost, revoke/reissue the unused code. Only Admin can replace/revoke
a registered machine. Replacing an approved machine suspends it, increments revision and
requires fresh pairing and explicit reapproval; it never restores prior approval implicitly.

The Node-only package `@thaarei/deployment-control` provides private
`node packages/deployment-control/dist/operator.js` with bounded JSON stdin. Supply
`action=setup|rebind|rotate|sync|quarantine`, absolute `directory`, independent `markerFile`,
`trustFile`, reviewed expected `manifestFile`, and `pairingFile` for setup/rebind. The state
directory is mode 0700, owned by the operator; the marker is an independent owner-only
high-entropy file outside that directory. Public trust must be an operator/root-owned regular
file without group/world write access. State/credentials and the downloaded pairing file are mode 0600; protect the pairing file
before running setup. Nonsecret manifest/identity inputs must be operator/root-owned and
not writable by group/others. The configured origin must match the saved paired origin
before an existing credential can be transmitted. Linux `flock` must be
installed. Keep this directory private to setup/reporter processes, never customer API mounts.
The package exports adapters for owning product integrations; it imports no app/schema code.

Setup durably records its generated secret/request/binding before transmission. After a lost
response, run `sync` against the same directory: the candidate can confirm a committed pairing
after the pairing receipt/code expiry. An unrecognized/revoked candidate requires reviewed
replacement; never delete its journal and generate another secret to guess at the outcome.
`rotate` shares the product operation lock, persists current/candidate/operation and confirms
the candidate before atomic promotion. A retry/restart resumes the existing operation. Do not
run independent credential writers or edit the journal. Signed state and valid-at-application
proof are persisted; unsigned outer status, successful HTTPS, files or documents cannot grant
business access. Central acknowledgement is explicitly product-reported valid application,
separate from first approval/issuance/contact and future first business activity.

For routine signing rotation, use new unused output paths with
`{"action":"prepare-signing-key","reason":"<reviewed rotation>"}`. Independently distribute a
higher-revision trust bundle combining the existing public keys and the new public output
**before** switching the central signing file. Preserve public overlap for outstanding proofs;
retire old keys with an issuance cutoff, and remove only once retained evidence no longer
requires them. Never copy a generated revision-1 output over an established trust bundle.
For compromise, independently deliver a newer trust revision marking that key revoked and
reconcile affected installations. A signed decision cannot authorize trust replacement.
Offline customers need that independent delivery too. Restart/reload verifiers after protected
file changes; atomic replacement of a Docker file bind mount requires container recreation.

Before supported customer restore, stop business/reporters and rotate the independent host
marker outside the restore set. The restored decision/journal cannot reopen access. Obtain
Admin-reviewed replacement pairing and run explicit `rebind`, which clears old activation and
adopts a fresh online epoch while retaining the trust-revision floor. Staff must approve again.
Before central restore, stop issuance and rotate its external marker; restore the database,
then run private `machine:operator` with `{"action":"reconcile","reason":"<restore evidence>"}`.
This quarantines restored authority until it suspends saved approvals, revokes old credentials
and codes and updates the independent marker digest atomically. Products then require fresh
pairing/approval. Never restore the external marker with the database. Arbitrary root/VM
snapshot rollback is outside this mechanism's guarantee. TCP-I08 owns release/recovery
qualification; these instructions are not a target restore acceptance claim.

<a id="central-verification"></a>

### Verification

Run the four required workspace checks. `pnpm test:integration` includes
`node scripts/test-control-plane.mjs` after the central production build. It uses pinned,
disposable PostgreSQL and Mailpit containers, private role separation, actual Next HTTP
behind an HTTPS proxy, and production auth/cookie policy. Its temporary plain SMTP is an
explicit test profile; production relay STARTTLS/DNS/TLS requires target verification.
No persistent customer/central installation is touched. `check:auth:cli` regenerates and
checks the central MFA schema offline using the installed pinned CLI. TCP-I04 adds its owning
machine schema, production verifier and protocol/client regressions; reporting has its own
HTTP/integration coverage. Registry HTTP regressions are in
`scripts/fixtures/control-plane-registry.mjs`, including actual response loss after commit,
creation/policy races, strict bindings, live roles, archive independence and audit/receipt
atomicity. If Docker is unavailable, the fixture fails explicitly; source checks alone do
not qualify database/image behavior.

For the same HTTP chain against a built production image, run
`CONTROL_PLANE_TEST_IMAGE=thaarei-control-plane:tcp-i04 node scripts/test-control-plane.mjs`
after building that candidate with
`docker build -f apps/thaarei-control-plane/Dockerfile -t thaarei-control-plane:tcp-i04 .`.
The image lane uses a private disposable Docker network, runs packaged migration tools,
mounts protected auth, signer and independent recovery-marker files, and starts the non-root app read-only. The Docker build
relocates emitted Next external-module aliases after pnpm deployment and checks their
production dependency versions. A source-only HTTP pass does not verify that packaging.

<a id="central-usage-and-health-reporting"></a>

### Usage and health reporting

All live MFA staff roles can open `/reports`, filter by client UUID/environment/product,
and follow a deployment to its bounded history. The client UUID is available on its registry
page/API. Gauges and cumulative counters have different meanings; follow the
[reporting design](../../architecture.md#reporting-and-central-storage) for baseline,
epoch, unknown-data and ordering rules. Dates are UTC. Customer-reported health is not an
independent central probe. A stale report does not suspend a product or revoke a grant.

Configure optional exact supported-version allowlists with the two `CONTROL_PLANE_*_SUPPORTED_VERSIONS`
JSON arrays in the central environment/Compose. Empty arrays display unconfigured. A version
notice is advisory and has no authorization effect. No alert delivery service is started.

Schedule the private owning command `pnpm --filter @thaarei/thaarei-control-plane reports:prune`
(or `node src/server/report-maintenance.ts` inside the built image) from trusted host
maintenance with `CONTROL_PLANE_MIGRATION_DATABASE_URL`. Do not add that URL to the running
Next environment. Run hourly; each invocation returns counts only and is bounded per table.
If any count reaches 1,000, arrange additional bounded invocations until the backlog clears.
It prunes historical metric payloads and central audit according to the architecture's
retention policy; it never deletes registration, approval, prior activation, decision,
receipt/deduplication or pending credential evidence. There is no HTTP prune endpoint.

Migrate the central database and DMS owned migrations before starting the new reporters.
Older unsequenced reports are compatible and labeled legacy; they cannot replace an ordered
latest sample. On a DMS upgrade, existing completed records seed only the deduplication ledger;
cumulative totals explicitly begin at the new baseline. Do not present them as lifetime usage.
A supported restore requires the existing reviewed rebind workflow, which starts new epochs.
Sequence exhaustion stops reports until reviewed rebind; missing reports remain unknown.

<a id="catalogue"></a>

## 2. Publish the module catalogue

<a id="catalogue-preparation-and-public-release-trust"></a>

### Preparation and public release trust

Apply the owning central migrations through the established private migration procedure
before starting the new central release. Migrations 0010/0011 create module storage,
append-only receipt/audit privileges and a released-catalogue immutability trigger. They
are not applied by application startup. Keep database volumes and existing staff/registry
records. Readiness now also checks the new catalogue storage.

Provision a separate release-pipeline PUBLIC trust document, for example:

```json
{
  "issuer": "https://releases.thaarei.example",
  "keys": [
    {
      "kid": "release-key-id",
      "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
    }
  ]
}
```

Use an absolute regular file, at most 32 KiB, containing one to eight unique key IDs and
SPKI RSA public keys. The private signing keys stay with trusted release tooling, never
in central or the browser. This trust is independently provisioned from central deployment
approval keys. No token-controlled URLs, embedded keys or network key retrieval are used.

Direct runtime uses `CONTROL_PLANE_MODULE_RELEASE_TRUST_FILE`. For Dokploy/Compose apply
`deploy/compose.control-plane-modules.yaml` as an additional `-f` overlay after the base
central Compose and supply `CONTROL_PLANE_MODULE_RELEASE_TRUST_HOST_FILE` with the absolute
host public-trust file. The overlay maps it read-only to `/run/module-release-trust.json`.
Keep the existing central ingress/TLS/secret configuration. No extra host port is added.
The base deployment can still run without module trust; imports/publication then fail
closed until trust is configured. Malformed/missing configured trust returns availability
failure; incorrect or expired token evidence returns invalid-evidence failure.

Key changes are loaded on new verification attempts. An exact committed receipt remains
recoverable without renewing its expired token, but only under current admitted Admin/MFA
authority. This historical receipt cannot make a draft or released version mutable.
Removing trust does not retroactively rewrite catalogue history. Future assignment/
activation must observe owning recovery and trust policy; this increment issues no module
grant. Publication is also blocked by existing central recovery quarantine.

<a id="catalogue-pipeline-attestation-contract"></a>

### Pipeline attestation contract

Use a compact RS256 JWT with a known `kid`, type `thaarei-module-catalogue+jwt`, configured
issuer, audience `urn:thaarei:module-catalogue`, and integer `iat`, `nbf`, `exp`. Admission
requires current validity and at most 24 hours between issuance and expiry. Claims outside
the registered fields and strict evidence body below are rejected. No private artifacts,
commands, customer credentials or executable import paths belong in an attestation.

Code attestation body is `{version:1, kind:"code", catalogue:<strict catalogue v1>}`.
It certifies code-supported IDs, exact versions, dependencies and source/platform bounds.
The release pipeline is responsible for its source evidence. Central verifies the
signature/schema and stores the immutable body, digest, proof digest and key ID; it does
not execute or independently inspect source code. No production Incident/Risk catalogue
is seeded from the synthetic test fixture.

Classification attestation body is
`{version:1, kind:"classification", catalogueId, catalogueDigest, codeCatalogueDigest, draftRevision}`.
The pipeline must verify the exported candidate against the original code evidence and
return this exact digest/source/revision tuple. A proof for an older draft revision cannot
publish a later revision, even if classification edits returned to the same categories.
Publication certifies a catalogue, not availability of all selected image combinations;
selected artifact inventory/building belongs to MOD-I04.

### Provision a new release signer once

For a new pipeline trust set only, create a private 0700 directory and run this from the
pinned workspace root. Replace the issuer with the approved stable HTTPS identifier.
The directory must contain no existing signer/trust files; exclusive writes refuse replacement.
The private signing file stays on the release host. Deliver only the corresponding public
trust files through an independently authenticated channel. Existing trust needs its normal
rotation/revocation procedure, not this revision-1 initialization.

```sh
node --input-type=module - /secure/pipeline https://releases.thaarei.example <<'NODE'
import { randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { generateKeyPair, exportPKCS8, exportSPKI } from 'jose';
const [directory, issuer] = process.argv.slice(2);
if (new URL(issuer).protocol !== 'https:') throw new Error('HTTPS issuer required');
const kid = randomUUID();
const { privateKey, publicKey } = await generateKeyPair('RS256', {
  modulusLength: 3072, extractable: true,
});
const pem = await exportSPKI(publicKey);
const save = (name, value) => writeFileSync(join(directory, name), JSON.stringify(value), {
  flag: 'wx', mode: 0o600,
});
save('signing.json', { issuer, kid, privateKey: await exportPKCS8(privateKey) });
save('catalogue-trust.json', { issuer, keys: [{ kid, publicKey: pem }] });
save('release-trust.json', { version: 1, revision: 1, issuer,
  keys: [{ kid, pem, status: 'active', lastIssuedAt: null }] });
NODE
```

Use `catalogue-trust.json` for central catalogue intake and `MODULE_RELEASE_TRUST_FILE`;
use `release-trust.json` for the combined installer/release verifier. Set
`MODULE_RELEASE_SIGNING_KEY_FILE` to the private signer. If interrupted after any output
appears, retain all files and reconcile that key set; do not overwrite or silently regenerate.

### Produce the catalogue attestation files

Use the separately provisioned release signer described in [pipeline inputs](#delivery-pipeline-inputs-and-trust).
The `code` command exports metadata, not a signature. The following private pipeline recipe
signs either the source-backed code JSON or the browser-downloaded classification plan.
Run it from the pinned repository root after building `@thaarei/module-catalog`.
Change `CATALOGUE_EVIDENCE_KIND=code` to `classification` and use the actual downloaded plan
and a new output path for the second invocation. Keep `code.json` from the source export.

```sh
CATALOGUE_EVIDENCE_KIND=code node --input-type=module - \
  /secure/pipeline/signing.json /secure/pipeline/code.json \
  /secure/pipeline/code.json /secure/pipeline/code-attestation.txt <<'NODE'
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { importPKCS8, SignJWT } from 'jose';
import { catalogue, catalogueDigest } from './packages/module-catalog/dist/index.js';
const [signerPath, codePath, inputPath, outputPath] = process.argv.slice(2);
const read = path => JSON.parse(readFileSync(path, 'utf8'));
const signer = read(signerPath), code = catalogue.parse(read(codePath));
const kind = process.env.CATALOGUE_EVIDENCE_KIND;
assert.ok(kind === 'code' || kind === 'classification');
let body = { version: 1, kind: 'code', catalogue: code };
if (kind === 'classification') {
  const plan = read(inputPath), candidate = catalogue.parse(plan.catalogue);
  assert.equal(plan.sourceId, code.id);
  assert.equal(candidate.sourceDigest, code.sourceDigest);
  assert.equal(candidate.platform, code.platform);
  assert.equal(candidate.contractVersion, code.contractVersion);
  assert.equal(candidate.migrationVersion, code.migrationVersion);
  const facts = value => value.modules.map(({ category, ...rest }) => rest)
    .sort((a, b) => a.id.localeCompare(b.id));
  assert.deepEqual(facts(candidate), facts(code));
  assert.equal(plan.codeCatalogueDigest, await catalogueDigest(code));
  assert.equal(plan.catalogueDigest, await catalogueDigest(candidate));
  body = { version: 1, kind, catalogueId: candidate.id,
    catalogueDigest: plan.catalogueDigest, codeCatalogueDigest: plan.codeCatalogueDigest,
    draftRevision: plan.draftRevision };
}
const now = Math.floor(Date.now() / 1000);
const token = await new SignJWT(body)
  .setProtectedHeader({ alg: 'RS256', kid: signer.kid, typ: 'thaarei-module-catalogue+jwt' })
  .setIssuer(signer.issuer).setAudience('urn:thaarei:module-catalogue')
  .setIssuedAt(now).setNotBefore(now).setExpirationTime(now + 86400)
  .sign(await importPKCS8(signer.privateKey, 'RS256'));
writeFileSync(outputPath, token, { flag: 'wx', mode: 0o600 });
NODE
```

Review the intended classification before signing; matching source facts do not replace
that review. Import/publish the resulting attestation through the central UI. The signer
format is `{issuer,kid,privateKey}`; central intake trust uses `{issuer,keys:[{kid,publicKey}]}`.
Customer runtime release trust is a different strict format:
`{version:1,revision:1,issuer,keys:[{kid,pem,status:"active",lastIssuedAt:null}]}` for a newly
provisioned trust set. `publicKey` and `pem` hold the same corresponding public SPKI PEM.
Preserve current status/revision/retirement policy when delivering existing trust; never
reset an established trust revision or derive trusted keys from an unverified token.

<a id="catalogue-staff-workflow-and-recovery"></a>

### Staff workflow and recovery

1. Open Module catalogues from the staff workspace. Import the signed code attestation
   using Review, then Confirm. No raw executable upload or custom command is accepted.
2. Choose the verified code catalogue and create a new classification draft with a reason.
   Only categories are editable; source facts, versions and dependencies remain unchanged.
3. Review required/optional links and proposed changes. Foundation stays Core. A Core
   module cannot require an Individual module; promote its mandatory dependency too or
   keep the original classification. Invalid changes are rejected by both UI and server.
4. Save the reviewed change, then export the exact release/build-plan JSON. It contains
   known source/catalogue IDs, digest, candidate and revision, without commands or secrets.
5. Obtain the matching signed classification evidence from the trusted external pipeline.
   Review and publish with current MFA. The released version cannot be edited/deleted.
   Create another version to propose a later promotion/demotion; installed customers keep
   their existing version. Cloning uses the saved source/classification, not unsaved edits.

Core means required in future resolved profiles for that catalogue; Individual means
separately selectable. Neither is a user permission. Customer selection is MOD-I03.

On an unknown outcome keep the pending review tab open and retry the same request.
Reauthenticate in a separate tab when MFA expires. A committed exact retry returns its
original receipt; navigation/readback loads the current catalogue, including an intervening
publication. A changed body under that request ID conflicts. For a stale revision reload
the current saved version, review its impact and start a new operation. No failed request
silently regenerates a catalogue identity, weakens dependencies or reruns a release build.

Lists are bounded to 50 code and 50 classification summaries with independent UUID cursors.
Catalogue metadata is limited to 64 modules/512 edges; incoming JSON is bounded to 256 KiB
and stored documents to 128 KiB. Signed input is never stored as a browser credential or
persisted token; central keeps only its digest and safe attestation metadata. Audit stores
actor/reason, before/after digest/revision/category summaries and commit time atomically.

<a id="catalogue-verification-boundary"></a>

### Verification boundary

The owning central integration suite uses real Next HTTPS/proxy handlers, PostgreSQL,
separate ephemeral release keys and normal admitted staff sessions. It exercises roles,
MFA/CSRF, signature/draft matching, concurrent revisions, lost acknowledgements, expiry-safe
receipts, immutable storage and audit rollback. A headless browser drives the production
classification review/confirm component using a disposable authenticated fixture session.
Its browser-only certificate exception is scoped to that private fixture; normal Node
HTTPS verifies the fixture CA and production TLS is unchanged.

No live central database migration/redeployment is implied by source tests. Exact container
rollout, production trust custody and selected customer-image verification remain their
own release/target gates. Continue with the [product assignment workflow](#assignment).

<a id="registration"></a>

## 3. Register a customer and reserve its installation

In **Clients & installations**, create Titan with its permanent client code. Choose the
fresh reservation workflow and supply an environment code and label. Central reserves
one tenant, one local installation, a Turnstile application and independent DMS/Turnstile
product records. Do not manufacture local UUIDs for this path. The older registration of
an exported manifest is for existing installations, not the fresh installer.

Continue to module selection and artifact building before requesting an intent. The
following contracts explain retries and identity custody; use the browser controls for
normal staff work.

<a id="reservation-contracts"></a>

## Reservation and intent contracts

<a id="reservation-contracts-reserve-identities"></a>

### Reserve identities

A signed-in Admin/Operator with current MFA can POST this strict command to `/api/registry`
over the configured staff origin, with the normal session/CSRF headers:

```json
{
  "type": "installation.reserve",
  "requestId": "11111111-1111-4111-8111-111111111111",
  "clientId": "22222222-2222-4222-8222-222222222222",
  "environment": "test-region-one",
  "label": "Regional test installation",
  "reason": "Prepare a fresh installation"
}
```

Use real client and fresh operation UUIDs. Central generates the local installation UUID,
tenant UUID, Turnstile application UUID and two independent product UUIDs. One transaction
commits the installation, both pending products, audit and receipt. No pairing code or
credential is created. Normal pairing and independent approval remain mandatory.

The receipt identifies the installation. Read `/api/registry/clients/<clientId>` for its
immutable IDs and products. Repeating the exact operation returns its receipt after a
lost response; changing an input under the same UUID conflicts. Reusing the environment
with a new operation conflicts. Other environments receive independent identities.
The existing `installation.create` adoption/local-export command remains available.

<a id="reservation-contracts-issue-an-intent-after-package-preparation"></a>

### Issue an intent after package preparation

Save/review/approve the Turnstile module assignment, then publish a matching verified
package reference using the [module delivery runbook](#delivery). POST to
`/api/registry/products/<turnstileProductId>/modules/installation-intent`:

```json
{
  "operationId": "33333333-3333-4333-8333-333333333333",
  "expectedRevision": 3,
  "reason": "Prepare the approved customer package"
}
```

Use the current product revision. Issuance requires live Admin/Operator MFA, active central
recovery authority, a fresh reservation, current approved desired assignment and matching
verified delivery. Archived clients, stale revisions and missing packages are rejected.
Existing local-export installations require the future owning adoption adapter; they
cannot be reclassified as a fresh reservation through this endpoint.

The response contains `intent`, an RS256 JWT with fixed installation-intent type/installer
audience and at most 24-hour validity. It binds both product identities, immutable tenant/
installation/application IDs, environment/customer key, assignment/profile and release.
It carries no pairing credential, OAuth secret, artifact pull credential or permission.

Receipts store the exact nonsecret payload with atomic audit; signing happens after commit.
Retry an operation after a lost response. An exact historical receipt preserves its
original expiry and context. Renew using a new operation UUID and current revision;
renewal preserves the reserved identities. A changed assignment requires reconciliation.

<a id="assignment"></a>

## 4. Select and approve customer modules

<a id="assignment-staff-workflow"></a>

### Staff workflow

1. Open Clients, choose the client and installation, then choose **Modules and dependencies**
   on its Turnstile product. DMS has no module assignment control.
2. Choose a published catalogue. A draft catalogue and unsigned metadata cannot be assigned.
   The list loads 50 published summaries at a time. Saved assignments keep their exact
   catalogue even when it is outside the current list page.
3. Core modules are fixed. Select Individual modules with checkboxes or the keyboard.
   Solid graph arrows and the equivalent text links identify mandatory dependencies;
   dashed arrows identify optional integrations. Required extra Individual modules are
   proposed visibly and are not silently approved. Deselecting a module still required
   by a selected dependant leaves it in the proposed closure and shows why.
4. Enter a reason and choose **Review and save draft**. Inspect the complete resolved set,
   including additional dependencies. Explicitly confirm it, then save the draft.
   Saving does not replace the approved desired assignment.
5. Enter the approval reason and choose **Review desired approval**. Confirm the same saved
   set again to approve it as the desired assignment. Unsaved edits disable approval.
   Product policy or assignment changes require a reload, a new reviewed draft and a
   current revision; a stale approval never substitutes a different selection.

Approval records immutable desired metadata. It grants no customer role or permission,
does not approve product activation and does not prove installation. Reclassification
creates a new catalogue; publication does not rewrite any installation's assignment.
There is no client-wide apply/default operation.

<a id="assignment-state-and-compatibility"></a>

### State and compatibility

The view separates the saved draft, approved desired assignment, verified delivery,
authenticated installed claim and central allowed IDs. Legacy v1 supplies no module rights;
selected installations use the [v2 decision protocol](../runbooks/module-decisions.md). The legacy
`observed`/`effective` projection fields remain null: the page separately exposes current
`inventory` and `authority`, without claiming customer application or user permissions.
The staff view includes authenticated inventory, authority and signed-grant acknowledgement; customer user access still requires local verification.

A desired selection shows **Awaiting package** without verified matching
artifact evidence. A product already paired with the existing v1 protocol also shows
**Upgrade required**. A suspended/rejected product shows **Restricted** independently of
the saved assignment. Preparing a legacy product's desired target does not activate it;
the reviewed upgrade and v2 compatibility floor follow the decision/transition runbooks.

The status projection also defines Ready for setup, Awaiting activation, Active and
Inventory mismatch from their owning verified adapters. Unit tests exercise these facts;
no staff endpoint accepts fabricated package/observation/effective input to reach them.
Current live handlers cannot show Active from assignment approval or ordinary product
approval alone. Current active-basis/removal commands are validated against persisted
authority; they cannot expand it. See the transition runbook for immediate restrictive
approval followed by separate package installation and staff activation.

<a id="assignment-operations-and-recovery"></a>

### Operations and recovery

Owning generated migration 0012 and privilege migration 0013 add immutable assignment
snapshots and product-bound draft/desired pointers. Apply them through the established
private central migration procedure before deploying the new release. Application startup
does not run migrations. Keep existing volumes, staff and registry records.

`GET/POST /api/registry/products/[id]/modules` admits staff. Mutations require canonical
origin/CSRF, live Admin/Operator/current MFA, the full registered binding, a reason and
the current registry product revision. Request JSON is bounded to 32 KiB. A strict
`{type:"assignment.draft"|"assignment.approve", command:<shared assignmentCommand>}`
envelope contains no executable input, credentials or observation writer.

`command.expectedRevision` is the registry product revision. Both saves and approvals
advance it once, so product policy/pairing and assignment changes conflict coherently.
The new snapshot's revision is that resulting product revision. Gaps between approved
assignment revisions are expected. Advancing it does not change product policy state,
approval history. Draft saves grant no module authority; desired approvals can restrict
existing module authority atomically. Existing v1 grants remain foundation policy only.

The operation ID identifies the immutable snapshot and receipt. Profile creation and
canonical hashing happen before the short staff/product transaction. Snapshot, current
pointer, registry revision, registry audit and module receipt commit together. Approval
checks the saved draft revision and exact requested/resolved/profile/basis facts and the
existing recovery authority. Runtime cannot update/delete snapshots or move pointers
across products/kinds; Viewer never receives pairing material from this API.

On a lost response retain the tab and retry the same operation/body. Reauthenticate in
another tab if MFA expires. Receipt recovery requires current write role/MFA but returns
only the historical outcome; the UI separately reloads canonical current state. A retry
after a later narrowing/suspension cannot reapply or resurrect the old assignment.
Changed inputs require a new operation after reload/review. Before abandoning an attempted
request, the UI explicitly warns that it may have committed.

<a id="assignment-verification-boundary"></a>

### Verification boundary

The central fixture runs the actual production Next handlers through HTTPS/proxy with
PostgreSQL and admitted sessions. It checks published-catalogue/closed-dependency
selection, full bindings, roles/MFA/CSRF, competing edits, atomic audit rollback, lost
approval/draft replies, immutable storage, cross-product pointer fences, later desired
removal/suspension replay and independent installations. Chromium drives keyboard
selection, dependency review, draft save and desired approval against those handlers.
Only that disposable browser context bypasses its test certificate; Node verifies the
fixture CA. No private customer environment is altered by these tests.

Exact production-image/live migration/target rollout remains a separate release check.
Selected customer image/access qualification follows the delivery, access and transition runbooks.

<a id="delivery"></a>

## 5. Build and publish selected module images

<a id="delivery-pipeline-inputs-and-trust"></a>

### Pipeline inputs and trust

Use Node 24.21.0, pnpm 12.16.1, Docker Engine/BuildKit and `tar`. Run from the repository
root, on the pinned source represented by the published catalogue. Source identity is a
sorted path/SHA-256 inventory of the owning app, package, compiler, dependency, ingress
and release-tool inputs. Restore those exact inputs before building or renewing evidence.
Uncommitted implementation inputs are supported for local qualification; do not substitute
a Git commit ID for this digest. A platform mismatch stops the build.

The trusted release operator provisions these ignored local environment variables (or
exports them in the pipeline). They are never customer/staff form fields:

- `MODULE_BUNDLE_STORE`: absolute private directory for generic reusable bundles.
- `MODULE_REFERENCE_STORE`: absolute directory for central's read-only reference index.
- `MODULE_RELEASE_SIGNING_KEY_FILE`: absolute protected regular JSON file, mode 0600,
  with exactly `issuer`, `kid`, `privateKey` (RS256 PKCS8 PEM). Keep it on the pipeline.
- `MODULE_RELEASE_TRUST_FILE`: bounded public JSON with HTTPS `issuer` and `keys`, each
  containing `kid` and RS256 SPKI `publicKey`. Provision matching public trust separately
  to central using the existing catalogue overlay; central never receives the private key.

Do not use the central deployment-decision signing key for release evidence. No key is
created, copied into an image, or printed by these commands. Fixture keys from the image
test are disposable and must never become release trust.

<a id="delivery-publish-the-code-catalogue-then-select-a-profile"></a>

### Publish the code catalogue, then select a profile

Build the contracts and export actual source-supported code metadata:

```bash
pnpm exec turbo run build --filter=@thaarei/module-catalog...
node scripts/module-delivery.mjs code '/absolute/private/new-code-catalogue.json'
```

Have the configured trusted pipeline sign this code catalogue and the reviewed
classification build plan using the separate MOD-I02
[catalogue evidence protocol](#catalogue). The `code` command exports metadata;
it does not sign or publish a catalogue. Initially Foundation is Core; Incident Management
and Risk Management are Individual and require Foundation only. A classification changes
categories, not code versions/dependencies. Publish the catalogue centrally, then save,
review and approve the product's desired assignment.

Use **Download approved profile build request** on that product's Modules page. The file
contains catalogue and exact resolved profile only. It contains no customer identity,
pairing material, credentials, commands or distribution URL. Reuse it for identical
profiles across customers. If the source has changed, obtain a matching catalogue and
assignment rather than editing the downloaded profile.

For isolated pipeline qualification only, an unsigned local catalogue can generate a
request directly. This does not make it a centrally published/approved selection:

```bash
node scripts/module-delivery.mjs request '/absolute/private/code.json' 'incident-management' '/absolute/private/new-request.json'
```

Use an empty quoted selection for Core-only, `risk-management` for Risk-only, or
`incident-management,risk-management` for both. Shared dependency confirmation is mandatory;
central's approved request is the normal delivery input.

<a id="delivery-build-verify-and-transfer"></a>

### Build, verify and transfer

With the private pipeline environment configured:

```bash
node scripts/module-delivery.mjs build '/absolute/private/approved-request.json'
node scripts/module-delivery.mjs verify '/absolute/private/approved-request.json'
node scripts/module-delivery.mjs publish '/absolute/private/approved-request.json'
```

A new profile builds actual API/web Dockerfiles, prunes unselected implementation before
compilation, starts production entrypoints without credentials/network and checks protected
access stays closed. It inventories the assembled runtime, dependencies, private foundation
tools, browser chunks and API maps. Public assets have an explicit foundation allowlist;
future module assets/packages need owning selection rules. Both placeholders have no
module-specific third-party dependencies. Selected Incident/Risk guarded routes and navigation ship with their matching profile;
unselected implementation is excluded. Image availability never creates user permissions.

`build` atomically commits a directory under the profile digest only after verification.
A retry rechecks the existing signature, archive and exact loaded images before reuse.
Incomplete staging directories do not establish delivery availability. Concurrent differing
results conflict; they never replace a committed profile silently.

Each profile directory contains exactly:

| File                      | Purpose                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------- |
| `images.tar`              | Docker/OCI archive containing the exact API and web content identities.                  |
| `source-inventory.json`   | Source paths/hashes, including excluded implementation hashes as metadata only.          |
| `artifact-inventory.json` | Output file hashes/links and dependency inventory for each image.                        |
| `NOTICES`                 | Proprietary license and required third-party notices.                                    |
| `README.md`               | Documentation generated from the selected profile.                                       |
| `delivery.json`           | Generic request plus separately signed result, never a private key or customer identity. |

Transfer this directory through an operator-controlled private channel to a configured
local bundle store. Do not extract arbitrary archive paths or select a download URL from
a staff form. On a recipient Docker host, verify signatures, validity, file digests and
archive image identities before loading:

```bash
node scripts/module-delivery.mjs load '/absolute/private/approved-request.json'
```

`load` then verifies the actual loaded image inventories. It does not start the customer
installation or perform migrations. Production registry/HTTPS retrieval, scoped local pull
credentials and target-host release acceptance remain a separate distribution adapter;
this POC neither fetches URLs nor operates central's Docker socket.

`publish` writes only `<profileDigest>.json` into the reference directory, atomically and
with no image bytes or credential. Repeating publication is safe; renewal can replace only
an independently verified identical release/inventory. Mount that index read-only using
`deploy/compose.control-plane-module-deliveries.yaml` alongside the existing catalogue
trust overlay. Ensure the central runtime UID can read the public descriptors; the builder
creates the index mode 0755/files 0644 while bundle/signing files remain private.

Central validates signature/type/audience/time, full resolver output and exact current
desired context on read. Missing, expired, forged or mismatched descriptors leave the
assignment at **Awaiting package**. A valid matching reference can show **Ready for setup**;
legacy machines still require an upgrade. Publishing the reference alone changes no runtime authority or user access; the staff
view separately tracks installed inventory, activation and acknowledgements. This is provisioned POC reference storage,
not a staff-upload endpoint, database delivery ledger or production artifact service.

<a id="delivery-expiry-and-recovery"></a>

### Expiry and recovery

Delivery evidence lasts at most 24 hours. Expired evidence cannot establish central
package availability or load an archive. Restore the exact pinned source and reverify
all retained artifacts before issuing renewed evidence:

```bash
node scripts/module-delivery.mjs renew '/absolute/private/approved-request.json'
node scripts/module-delivery.mjs publish '/absolute/private/approved-request.json'
```

Only the private release operator can renew. Historical signature verification in that
command permits expired original evidence solely to reverify the same immutable artifacts;
ordinary verification, recipient loading and central readback still require current
validity. A lost command response is handled by re-reading/re-verifying the committed
profile/reference. A changed source/profile, revoked key, missing image or altered file
requires explicit reconciliation; do not delete customer configuration, secrets or data.

<a id="delivery-qualification"></a>

### Qualification

```bash
pnpm test:images:modules '/absolute/new/private/qualification-directory'
```

The image test builds Core-only, Incident-only, Risk-only and both; starts the real packaged
Nest/Nginx commands non-root/read-only with no host ports or network, checks liveness and
closed business access, inventories images/chunks/maps/dependencies and archive identities,
then checks exact reuse and rejects forged/mismatched results, missing archives and
substituted documentation. It writes a private `qualification.json` and disposable signing
fixture outside the repository. No customer database or Docker volume is touched.

Run all four workspace gates as well. Actual centrally approved production catalogues,
private registry delivery, clean target rollout, activation/enforcement, installer recovery
and target acceptance are not established by fixture success.

<a id="combined-release"></a>

## 6. Assemble the combined customer installer

<a id="combined-release-external-pipeline"></a>

### External pipeline

Build with the pinned repository toolchain. `pnpm release:installation /absolute/private/release-input.json`
assembles the combined release from a verified selected module bundle and loaded exact
image content IDs. The strict private input is:

```json
{
  "moduleBundleDirectory": "/private/pipeline/selected-profile",
  "dmsImage": "sha256:<64 lowercase hex characters>",
  "postgresImage": "sha256:<64 lowercase hex characters>",
  "engineImage": "sha256:<64 lowercase hex characters>",
  "releaseTrustFile": "/private/pipeline/release-public-trust.json",
  "signingFile": "/private/pipeline/release-signing.json",
  "outputDirectory": "/private/pipeline/new-release"
}
```

The image ID fields above are placeholders; use actual independently verified IDs.
Build the engine with `docker build -f deploy/installation/Dockerfile -t thaarei-installer:review .`.
Keep the complete bundle including notices/source offer. Never include signing files,
customer state or input directories. Independent delivery must establish the launcher
and engine identities before running either. This POC performs no automatic remote
artifact fetch or mutable pull. Production distribution must qualify its configured
HTTPS origin, scoped local credential custody and redirect/digest policy separately.

<a id="activation"></a>

## 7. Pair, approve and activate the customer

1. Download an independent one-use pairing file for each product from **Deployment setup
   and credentials**, with current MFA. Deliver privately; the customer applies each through
   the corresponding owning command. Pairing itself leaves business access closed.
2. Explicitly select **Approve**, enter a reason and confirm for DMS and Turnstile separately.
   Do not rely on the form's previous action. Customer sync must apply and acknowledge each
   signed approval; check acknowledgement and report freshness separately.
3. Require permanent v2 enforcement for Turnstile. On its Modules page review the exact
   installed profile/release, current desired selection and dependencies. **Activate installed
   modules** requires current MFA and matching inventory. Confirm and have the customer sync.
4. Customer identity, company setup and user permissions remain local steps. Product approval,
   module activation, catalogue Core classification and user permission are distinct controls.
5. For later restrictions, approve the reviewed desired removal or suspend the product.
   New authority applies when the customer synchronizes. An offline customer's existing
   valid grant may last until its signed expiry. Desired restoration alone does not reactivate
   modules; perform the reviewed activation and sync again. See
   [module transitions](../runbooks/module-transitions.md) for package changes and recovery.

`CONTROL_PLANE_DECISION_SECONDS` defaults to 604800 (seven days), bounded to 60–604800.
Use a shorter value only for a deliberate isolated expiry rehearsal. Sync a newly signed
short decision before stopping central; do not change host clocks. Restore the default
and sync after testing. Lifetimes shorter than the normal reporter interval can expire
between renewals. A reporter restart does not reset its durable next-attempt election.
