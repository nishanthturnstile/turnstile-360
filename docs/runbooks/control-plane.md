# Central staff access and operation

The central app supplies staff access and the TCP-I03 client/deployment registry and
policy records, plus TCP-I04 machine pairing, signed decisions and recoverable credential
rotation, plus TCP-I07 usage/health reporting. Customer enforcement is owned by each product.
The selected design and limits live in [architecture](../../architecture.md#thaarei-central-control-plane-proposal);
actual verification and handoff live in [IN_PROGRESS.md](../../IN_PROGRESS.md).

## Host and configuration

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

## Private provisioning and migrations

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
4. Start Next with runtime credentials and verify readiness through the intended ingress.
   No account is automatically created by build, migration or startup.

## First administrator and employee admission

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

## Recovery and sessions

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

## Client and deployment registry

Use Clients from the signed-in workspace. All admitted roles can search/read the fleet;
Admin and Operator can register/edit/archive clients and register installations/products.
Client codes are permanent, canonical uppercase identifiers. Optional business contact
fields stay central and are never customer-report payloads. Archive status is administrative:
existing product policy is unchanged. An archived client can be read and its products can
still be explicitly suspended/reapproved, but adding deployments requires unarchiving first.
There is no hard-delete endpoint for registry identities or history.

Register installations with their environment code, display label and the local installation/
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

| Method/path                             | Contract and authority                                                                                                  |
| --------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| GET `/api/registry/clients`             | Current staff/MFA; `q` (literal code/name substring), `archived=active                                                  | archived | all`, optional `after` code cursor; bounded page |
| GET `/api/registry/clients/:id`         | Current staff/MFA; canonical client, bounded installations/products and latest activity in one consistent read snapshot |
| POST `/api/registry`                    | Exact-origin JSON command with `type`, `requestId`, `reason`; writer role checked live in the owning transaction        |
| GET `/api/registry/receipts/:requestId` | Current staff/MFA and original actor; immutable historical receipt, never current business permission                   |

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

## Private machine authority and pairing

Follow the architecture's protocol, timing and trust rules. Apply migrations through
`0007_productive_living_lightning.sql` before opening this increment. Runtime cannot modify the
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

## Verification

Run the four required workspace checks. `pnpm test:integration` includes
`node scripts/test-control-plane.mjs` after the central production build. It uses pinned,
disposable PostgreSQL and Mailpit containers, private role separation, actual Next HTTP
behind an HTTPS proxy, and production auth/cookie policy. Its temporary plain SMTP is an
explicit test profile; production relay STARTTLS/DNS/TLS requires target verification.
No persistent customer/central installation is touched. `check:auth:cli` regenerates and
checks the central MFA schema offline using the installed pinned CLI. TCP-I04 adds its owning
machine schema, production verifier and protocol/client regressions; reporting remains later work. Registry HTTP regressions are in
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

## Usage and health reporting

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
