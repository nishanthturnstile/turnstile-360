# Standalone distribution

Use the topology, limits and authority decisions in
[architecture.md](../../architecture.md#operable-standalone-distribution-dms-i18).
This procedure is for a fresh private installation of the bundled authority. It does
not initialize or adopt the separate Turnstile installation. Customer release and
target acceptance remain DMS-I20. Coherent backup/restore and disposal use the [recovery workflow](dms-recovery.md).
A single Docker host is not highly available.

## Assemble and transfer a candidate

Use the pinned workspace toolchain and checksum-verified Syft binary described in
`deploy/distribution/release.json`. From the repository root:

```sh
node scripts/dms-release.mjs --output /private/dms-0.20.0 --syft /private/tools/syft --structured
```

Omit `--structured` to exclude the optional image. The builder produces a private
`bundle` with image archive, exact image IDs, SPDX and Syft inventories for every image,
actual image license/notice archives (including embedded JAR notices), source-access
inventory, covered-source offer, build recipes, lockfiles, deployment files and runbooks.
It rejects prohibited license families and preserves unknown license declarations for
release review. An unknown declaration is not an approved license conclusion. Review
the complete inventory, optional model agreements and source-offer fulfillment materials
before a customer release. The three source-request contacts are nishanth@thaarei.com,
technology@thaarei.com and muthurema@thaarei.com.

Transfer the complete bundle privately. A fresh Linux target needs Docker Engine and
Compose with include, raw env-file format and `run --env-from-file` support; it needs
neither the source checkout nor host Node/Python. Keep the bundle/configuration directory
mode 0700. On the target, verify the supplied checksums through a trusted channel:

```sh
cd /private/dms-0.20.0/bundle
sha256sum -c SHA256SUMS
docker load -i images.tar
./dms verify
```

`verify` compares every local image ID with `images.lock`. `up` also verifies and uses
`--no-build --pull never`. Keep the release evidence with that exact archive. Do not
rebuild on the target or substitute mutable tags without assembling a new candidate.

## Initialize a fresh installation

Have Dokploy provide the external ingress network, canonical authority/transfer hostnames
and TLS. Configure only `dms-api:3001` for the authority and API hostname, and
`dms-transfer:8333` for the transfer hostname. Never expose PostgreSQL, SeaweedFS, AMQP,
RabbitMQ management, ClamAV, coordinator or worker listeners. The parser namespaces
remain offline. Canonical HTTPS discovery/token/JWKS must resolve from the trusted
application, coordinator and supervisor containers. Normal certificate verification is
required. Install a private CA through read-only mounts and `NODE_EXTRA_CA_CERTS` /
`SSL_CERT_FILE` when appropriate; never disable TLS verification.

Create a mode-0600 JSON initialization file without putting credentials in command
arguments. Example nonsecret fields:

```json
{
  "authorityOrigin": "https://identity.example.test",
  "transferOrigin": "https://files.example.test",
  "customerKey": "customer-installation",
  "ingressNetwork": "dokploy-network",
  "structured": false,
  "browserOrigins": [],
  "smtp": {
    "host": "mail.example.test",
    "port": 587,
    "mode": "starttls",
    "from": "identity@example.test"
  }
}
```

SMTP `user`/`password` are optional paired fields. Development and testing use Mailpit;
keep its inbox private and disposable. Production-profile testing still requires Mailpit
STARTTLS with a trusted certificate. Use a real operator-managed relay for customer
delivery. No email goes to the covered-source contacts during testing.

```sh
./dms init < /private/initialize.json
./dms config
./dms provision
./dms migrate
./dms storage-init
```

Initialization refuses existing environment/profile files. It generates distinct database,
authority, S3 and AMQP secrets and one installation tenant. All generated environment
files use literal raw single-line values; preserve permissions and never source them in
a shell. The short-lived root initialization tools only set volume/configuration ownership;
long-running application/storage/broker/scanner processes run as their declared users.
`storage-init` is repeatable and preserves object data. Do not run `down -v` on an
installation.

Start the authority privately before provisioning identities, using the same project and
environment as the wrapper:

```sh
docker compose --project-directory "$PWD/deploy" --env-file .env.dms.compose \
  -f deploy/compose.dms-complete.yaml up -d --no-build dms-api dms-transfer
./dms provision-user < /private/first-operator.json
./dms bootstrap-operator < /private/operator-bootstrap.json
```

`first-operator.json` has `email`, `name`, `role:"admin"`, and a fresh password of at
least 15 characters. Complete the verification email before bootstrap. Bootstrap input
has `action:"bootstrap"`, `operatorEmail`, `operatorPassword`. There is no public signup
or automatic verified administrator. Shared user login also needs explicit per-client
policies and consumer-owned screens: see the [authority runbook](authentication.md).

Provision four distinct work clients with `./dms authority-client`, using private JSON
with `action:"issue"`, `kind:"work_publisher"` / `work_scanner` / `work_extractor` /
`work_heavy`, explicit `clientId`, fresh UUID `applicationId`, explicit one-element `scopes`
(`dms:work:publish`, `dms:work:scan`, `dms:work:extract`, `dms:work:heavy` respectively),
operator credentials and
`credentialFile:"/configuration/.credentials-publisher.json"` (distinct for each role).
Then `./dms operator` with `action:"work-authorize"`, the same clientId, role
`publisher` / `scanner` / `extractor` / `heavy`, and operator credentials. Transfer each
returned credential from its mode-0600 file into the matching `.env.work-<role>`
`DMS_WORK_CLIENT_SECRET` using a private file editor. These credentials never belong in
browser code, source control, shell arguments or shared logs. Blank credentials keep
processing unavailable; the authority/API can remain ready independently.

Configure the installation admission budget/formats/profiles explicitly through private
`admission-policy-set` before accepting uploads; see the [admission runbook](dms-admission.md).
Initialization deliberately leaves admission unconfigured until the operator selects its limits.

Consumer issuance/enrollment uses the existing
[standalone](dms-standalone.md) and [explorer](dms-api-explorer.md) procedures and separate
credentials. In the bundle, `./dms authority-client` and `./dms application` invoke the
same private commands through their dedicated environment files, replacing repository
pnpm invocations. Enrollment never grants internal-work authority.

## Scanner data and startup

For offline updates, transfer official `main.cvd`, `daily.cvd`, `bytecode.cvd` and a
`SHA256SUMS` file containing exactly those three lowercase SHA-256 entries into
`signatures-incoming`. The importer independently verifies each CVD signature with
`sigtool`, installs the complete set, switches the current set atomically and retains
the immediately previous set. Stale signatures keep processing unavailable.

```sh
./dms signatures-import
./dms up
./dms status
```

For permitted online updates, `./dms signatures-online` starts the separate updater.
Only that service needs signature egress. Stop the updater before an offline import to
avoid competing updates; do not edit an active set in place. Freshclam may be denied by
upstream CDN policy; obtain the official signed files through an approved connected
system. Neither local checksums nor a successful process start bypass signature freshness.

The structured profile is chosen in `.dms-profile` at initialization and needs its exact
optional image in `images.lock`. Changing `standard` to `structured` and running `up`
recreates the API/coordinator/heavy worker with the enabled feature; reverse it to stop
new structured work. Drain pending structured work first. Existing accepted results and
originals stay available. Models/data are pinned and prefetched; runtime model downloads
and unapproved remote inference are disabled.

## Observe, recover and rotate

Use `/health/live` for process liveness, `/health/ready/api` for authority/owning database
availability and `/health/ready/processing` for current processing dependencies. The latter
returns only availability, not private inventory. Keep API serving metadata/authorized
existing downloads during worker outages. Poll private `operations-inspect` through
`./dms operator` for bounded component evidence, pending/failed jobs, oldest job/outbox
ages, capacity and finite alerts. `./dms broker-metrics` gives only the three bounded
dead-queue counts. Counters reset with the process; no unbounded application/URL labels
are exported. Forward the bounded JSON logs to operator-managed retention/alerting.

`operations-backup-report` additionally requires `completedAt` and `manifestSha256`.
It is an attributed attestation from an external backup procedure, not proof of a valid
backup or an implementation of I19. Missing/old reports raise separate alerts without
blocking existing API reads.

On failure inspect the current job/policy with `work-inspect`. `work-redrive` takes a
failed enrichment `jobId` and stable new `idempotencyKey`; it requests a new processing
run under current permissions/quota/profile policy. It does not reset an old attempt
budget or replay an obsolete security decision. Mandatory scanner failures require the
authorized upload/lifecycle recovery path; this command cannot approve unsafe bytes.
`operations-prune` removes only bounded old unreferenced legacy terminal work/security
history. It preserves accepted provenance, processing-run history, artifacts, originals
and business audit. Physical disposal is outside this command.

SIGTERM stops new coordinator claims and publisher batches, then drains active work.
Workers have a bounded grace period for current tasks; interrupted leases/deliveries
recover through the authoritative database checks. Do not force a successful state
because a broker delivery was acknowledged. See [work recovery](dms-work.md).

Rotate an OAuth client through `authority-client` with `action:"rotate"` and a new
private credential file. Old secrets have no grace. Update the owning service's private
file and recreate it. Disable work grants with `work-disable` to reject even previously
issued JWTs. Disable a consumer through `./dms application` with `action:"disable"`,
`applicationId` and operator credentials: local registration denial commits before the
issuer suspension attempt. Issuer-only `authority-client suspend` prevents new token
issuance; existing JWTs can remain valid for their five-minute lifetime while the local
registration is active. Prefer a new work client ID
when replacing a compromised identity. Re-enabling the same identity can accept its
still-valid old token during the five-minute token lifetime.

Signing keys use `./dms authority-keys`: `inspect`, `stage`, then `activate` with the
returned `keyId`. These require both fresh verified authority-administrator credentials
and a current DMS operator grant. Verify the staged public key at canonical JWKS before
activation; wait at least 60 seconds and activate within 24 hours. Retired public keys
remain advertised for 24 hours, exceeding the five-minute JWT lifetime. Private signing
keys remain encrypted; the command never outputs them. Root `AUTH_SECRET` rotation is
a separate coordinated recovery procedure; changing it blindly invalidates encrypted
key material and cursors.

## Upgrade and verification

Stage the next verified bundle and image archive separately. Retain the existing private
configuration, tenant/customer identity, database roles/passwords, AUTH_SECRET, signing
keys, application registrations, object volumes and IAM config. Take a coherent backup
using the approved backup procedure. Stop/drain workers, publisher and coordinator;
place writes behind maintenance ingress, run the **new image's** `migrate`, and recreate
the services with the new verified bundle. Never run `init` or `provision` as an upgrade
step. Do not downgrade a changed schema by replacing only an image; use the compatible
backup/recovery procedure. Check API/processing readiness, canonical token/JWKS, live
revocation, original hashes/history/results and pending-work reconciliation before
reopening writes. The wrapper has no unattended migration on startup.

Repository-side isolated qualification (all email goes to Mailpit):

```sh
node scripts/test-dms-distribution.mjs /private/dms-0.20.0/bundle
```

Supply `--previous-image <approved-local-image>` to rehearse an actual previous owned
schema/authority installation followed by the new migrations. Supply `--signatures-dir`
with an existing protected directory of official CVD files to avoid repeated CDN downloads;
the offline importer still checks hashes, signatures and current runtime freshness.

It creates a new private project/network without published host ports and uses actual
image entry points, database roles, TLS ingress, signed scanner files and workers. Its
private evidence directory is printed; failures retain protected logs/configuration for
diagnosis while fixture containers/volumes are removed. Keep evidence private because
the fixture state contains disposable credentials. Run the complete workspace gates too.
Local qualification does not establish target Dokploy routing, real customer email,
backup RPO/RTO, high availability or release authorization.

Coherent backup, empty-target recovery, key custody and recovery-aware physical disposal are described in the [recovery runbook](dms-recovery.md). The legacy backup report is not a completed recovery cohort.
