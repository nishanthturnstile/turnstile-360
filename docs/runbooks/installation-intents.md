# Central fresh installation reservation and intents

MOD-I05 implements central reservation/issuance, staff controls and verified combined
private configuration preparation. This runbook covers its source/local qualification;
actual target rollout remains a separate operator action. Existing installations use the
supported owning-export/adoption workflow. Central never runs customer database/setup work.

The accepted boundaries are in
[architecture.md](../../architecture.md#central-first-fresh-setup-and-artifact-delivery).

## Reserve identities

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

## Issue an intent after package preparation

Save/review/approve the Turnstile module assignment, then publish a matching verified
package reference using the [module delivery runbook](module-delivery.md). POST to
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

## Private verification boundary

`scripts/installation-intent.mjs` exports `verifyInstallationIntent`. The owning initializer
must supply independently retained expected binding, DMS product ID, profile/release and
assignment/intent revisions. It uses the provisioned central deployment public trust
bundle, never the release signing key or a token-selected URL. It rejects unknown/revoked
keys, late retired-key issuance, unexpected signing headers, expiry/future validity and
identity/package/revision mismatches. Do not treat decoding a JWT as verification.

The combined coordinator below uses this verifier and rechecks central freshness before
private preparation. It preserves owning credentials across retries and refuses replacement
of initialized configuration. Signed setup metadata never bypasses the owning bootstrap,
pairing, approval or customer authorization boundaries.

## Combined private preparation

Run the coordinator from Thaarei's trusted, pinned Linux/WSL workspace. Customers receive
selected images and private configuration; they do not need a repository checkout. The
coordinator requires Node 24.21.0, pnpm 12.16.1, Docker and locally loaded, verified images
containing the MOD-I05 owning initializer commands. Existing older DMS images do not
implement the new reserved-ID/validation interface. Keep the independently approved DMS
image pinned by its content identity, separately from the signed selected API/web bundle.

Create an operator JSON file in a private directory outside the repository (mode 0600;
parent mode 0700). The values below describe the schema; replace paths, image identity and
SMTP settings with the actual provisioned values. `intentFile` is the downloaded object
containing `intent`; central and release public trust use their separate existing formats.

```json
{
  "directory": "/home/dev/private/customer-region-one",
  "bundleDirectory": "/home/dev/private/bundles/<profile-digest>",
  "centralTrustFile": "/home/dev/private/central-trust.json",
  "releaseTrustFile": "/home/dev/private/release-trust.json",
  "intentFile": "/home/dev/private/installation-intent.json",
  "dmsImage": "sha256:<verified-independent-DMS-image-identity>",
  "authorityOrigin": "https://turnstile.customer.example",
  "resourceOrigin": "https://dms.customer.example",
  "transferOrigin": "https://files.customer.example",
  "ingressNetwork": "customer-ingress",
  "smtp": {
    "host": "smtp.customer.example",
    "port": 587,
    "mode": "starttls",
    "from": "identity@customer.example"
  },
  "turnstileSmtp": {
    "host": "mailpit",
    "port": 1025,
    "mode": "starttls",
    "from": "turnstile@customer.example"
  },
  "structured": false
}
```

DMS SMTP supports its existing TLS/STARTTLS and optional `user`/`password` fields. Turnstile
consumes its existing controlled private relay contract: `localhost`, `127.0.0.1`, `::1`
or `mailpit`, a port, STARTTLS and a sender. Provision that relay/CA before enabling mail;
external authenticated SMTP is not added to Turnstile by this initializer. The two settings
are independent. No SMTP traffic or account/client issuance runs during preparation.

If central uses a private CA, start Node with its public CA provisioned through the normal
`NODE_EXTRA_CA_CERTS` setting. That TLS CA is separate from central's JWT verification
trust. Do not disable certificate verification.

```bash
pnpm installation:prepare '/home/dev/private/operator-region-one.json'
```

The coordinator checks the signed intent, selected bundle and actual local image identities,
then performs an authenticated-metadata freshness check over central HTTPS. The public
`POST /api/installation-intents/status` accepts only a valid, unexpired, current-key-signed
intent and returns a single `current` boolean. It supplies no credential, renewal, artifact
or business authority. Recovery quarantine and changed/archived desired state close this
check. Pairing-related product revision increases can preserve the same desired context;
a changed assignment revision cannot.

Both owning Docker initializers validate their inputs on a read-only filesystem with no
network and no configuration mount before preparation commits anything. Invalid SMTP or
other owning inputs therefore do not poison an installation journal. Actual generation
also runs nonprivileged with no network, capabilities or extra privileges and writes only
the private configuration mount. Use an operator UID compatible with the target private
secret mounts; do not make files world/group readable to compensate for ownership.

The coordinator rechecks central freshness before recording completion. If central or
release verification is unavailable, stop and retry the retained operation. A JWT decoded
without verification, a journal, or a completion receipt cannot replace these checks.

## Generated state and recovery

The installation plan persists the exact reserved binding, settings/image context and two
independent recovery markers. DMS and Turnstile each commit their own private generated
plan before publishing individual files. Synced temporary files and exclusive links make
plan/file publication atomic; retries write missing files from the retained plan and
compare existing files byte-for-byte. They never rotate committed role passwords, product
keys, IDs or machine credentials. Existing files without the matching owning plan, unsafe
permissions, symlinks or changed settings are rejected.

Generated files include:

| Owner           | Outputs                                                                                                                                                                      |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DMS             | Existing `.env.dms*`, `.env.provision`, storage/processing profiles and `.dms-profile`; combined authority mode and reserved local installation/tenant IDs.                  |
| Turnstile       | `.env.turnstile`, `.env.turnstile.migrate`, `.env.turnstile.reporter`, `.env.turnstile-provision`; reserved application ID and separate runtime/migrator/reporter passwords. |
| Installation    | `.env.dms.deployment`, `.env.turnstile.deployment`, `central-trust.json`, `dms-marker`, `turnstile-marker`, `installation-binding.json` and `preparation-receipt.json`.      |
| Owning journals | `.installation-preparation.json`, `.dms-preparation.json`, `.turnstile-preparation.json`; these contain private generated material and must remain protected.                |

The product state directories `dms/` and `turnstile/` start empty. Deployment settings refer
to `/run/thaarei/<product>/product.json`, separate markers in `/run/thaarei/` and public
central trust. Mount the private directory there for the owning runtime/operator, and load
only the applicable private environment files. DMS uses `CONTROL_PLANE_*`; Turnstile uses
`TURNSTILE_CONTROL_PLANE_*`. Do not combine reporter/migrator credentials into the API or
expose any generated file to Vite, Nginx or a public download.

OAuth login, DMS machine and identity-service client secret fields start empty. An intent
does not create a user, OAuth client, application enrollment key or action permission.
Complete the existing private authority/client registration workflow with the real verified
customer administrator; approval and user grants remain independent.

On an interrupted write, rerun the same operator file and intent. On expiry, obtain a new
central intent operation for the unchanged approved context and rerun; the same IDs and
committed secrets are retained. A prior successful preparation is never reset by expiry.
A changed installation, assignment/package, settings or image context stops for explicit
operator reconciliation/new affected work. Keep the prior directory and owning credentials;
do not delete it, regenerate secrets, or use the fresh initializer as an upgrade/reset tool.
Module cutover and the broader installer reconciliation workflow belong to MOD-I08/IA work.

## Owning bootstrap and pairing

Preparation creates files only. Follow the existing DMS/Turnstile private provisioning,
TLS/ingress, storage and account/client runbooks for an actual target. The supported owning
sequence uses the prepared files:

1. Provision DMS roles with `.env.provision` through `maintenance/provision-auth-database.mjs`
   in the DMS image. Provision Turnstile roles separately with `.env.turnstile-provision`
   using that same workspace-owned maintenance tool. Existing-role refusal preserves
   credentials; inspect/reconcile a lost provisioning response instead of rotating roles.
2. Run DMS `dist/infrastructure/database/migrate.js auth`, `dms`, then `bootstrap` with
   `.env.dms-maintenance`. Run Turnstile's corresponding `turnstile` and `bootstrap` commands
   with `.env.turnstile.migrate`. The owning bootstrap transactions persist the reserved
   identities once and reject replacement, including a mismatched DMS local installation ID.
3. Initialize Turnstile configuration/access using its owning
   `dist/modules/organization/configuration-operator.js initialize` and
   `dist/modules/access/access-operator.js initialize`, with the normal private operator
   input. Do not manufacture a customer administrator or bypass verified-email login.
4. Export each actual owning manifest through `dist/modules/deployment/operator.js` and
   compare it to the reserved intent/central registry. For existing adoption, use these real
   exports with the existing **Register an installation/product** workflow. The fresh
   coordinator refuses existing configuration or an adoption intent.
5. Obtain protected one-use pairing files separately and run each owning deployment operator
   `setup` command with its private file. The coordinator never reads a pairing file.
   DMS uses its coordinator connection; Turnstile uses its dedicated reporter connection.
   Retain each product's `product.json` and pending operation if an acknowledgement is lost.
   Rerunning preparation preserves these files, including when only one product is paired.
6. Obtain independent current-MFA product approvals and use the normal sync/reporting
   commands. Public intent metadata and successful preparation leave business access closed.
   Complete the [signed-decision](module-decisions.md), [staff activation](module-transitions.md)
   and [explicit customer permission](module-access.md) steps before opening module access.

Recheck preparation freshness before affected setup/cutover after a delay or interruption.
These are explicit local operator commands; central performs no customer remote shell,
Docker operation, migration or deployment. Production host rollout and installer-wide
journals/acceptance remain their owning IA increments.

## Windows and WSL

Run the coordinator inside WSL. Keep private operator/configuration directories on WSL's
Linux filesystem so mode 0700/0600 is enforced. Use `/home/dev/...` paths, not
`\\wsl.localhost\Ubuntu-24.04\home\dev\...` strings. A public downloaded intent on Windows
can be read using `/mnt/c/Users/<user>/Downloads/installation-intent.json`, or copied to the
private WSL directory. Use the real downloaded file name rather than example placeholders.
The existing separate Windows browser CA trust/hosts setup is unchanged.

## Qualification

Build the workspace first and run qualification after builds have finished; the central
fixture serves the compiled Next output and must not share it with a concurrent rebuild.

```bash
pnpm build
pnpm test:installation:preparation '/absolute/new/private/qualification-directory'
```

This builds actual DMS and selected API/web images, publishes their source-backed catalogue
and signed package into an isolated central HTTPS/PostgreSQL fixture, reserves identities
and issues a real central intent. It exercises the actual Docker validation/generation
commands, failed private-file replay and recovery, completed retries, expiry/renewal,
wrong/existing installations, private permissions, owning database bootstrap guards and
independent partial/duplicate pairing. A changed centrally approved assignment fences
further work and preserves the prior configuration. Owning bootstrap/pairing commands also
run as compiled Node commands against a separate disposable customer PostgreSQL and the
real central machine handlers. No fixture replaces these handlers. The production CLI
entrypoint is checked as well as the coordinator function.

The fixture writes a private qualification summary and disposable release signing material
outside the repository. Keep fixture signing keys separate from real release/central trust.
Run the four workspace gates as well. No live customer migration, credential or deployment
is changed by this qualification.
