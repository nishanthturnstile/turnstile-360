# Customer installation: DMS, Turnstile and onboarding

This is the authoritative customer-host guide. The
[Thaarei ecosystem guide](thaarei_ecosystem_guide.md) owns central setup, customer registration,
catalogue publication, artifact building and staff approval. Read the relevant path below;
do not run multiple fresh initializers against the same database/state directory.

## Choose the installation path

| Path                                              | What it installs                                                                                                          | Starting section                               |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| Fresh combined module POC, as rehearsed for Titan | PostgreSQL, independent DMS authority/API, selected Turnstile API/web and two reporters; optional separate gateway        | [Prepare and install](#customer)               |
| Full independent DMS                              | Bundled authority, storage, broker, scanner, coordinator and selected workers, without Turnstile                          | [Full DMS distribution](#standalone-dms)       |
| Complete combined storage/processing deployment   | Owning complete DMS/customer overlays, separate provisioning and identity setup; not installed by the module-POC launcher | [Complete combined profile](#complete-profile) |
| Existing installation                             | Compatible upgrade/cutover with retained data and credentials                                                             | [Recovery and upgrades](#recovery)             |

The first path was rehearsed locally with Titan. Incident/Risk expose guarded entry pages;
Turnstile has a DMS connection check, not a full upload/OCR UI. The full DMS and complete
combined paths require their own exact-image and target acceptance. See
[Titan evidence](titan_acceptance_results.md), [architecture](../../architecture.md) and
[progress](../../IN_PROGRESS.md). Never infer production readiness from an older fixture.

Reading order for Titan: [installation](#customer), [pairing](#pairing), [administrator](#identity),
[company and users](#onboarding), [separate Compose](#customer-compose),
[Dokploy routing](#ingress), [validation](#validation), [handover](#handover).
Private operator commands are necessary where no UI exists. Company/user/module acceptance
uses normal browser screens, email verification and MFA; do not edit database authority.

### Private working directories and cleanup

The leading dot in `.dms-*` makes a directory hidden on Linux. This repository excludes
those directories from Git and Docker build contexts because local rehearsals can contain
credentials, signing inputs, release archives, database fixtures and test logs. Their names
are operator-chosen working locations, not a required directory created for every customer.

Historical `.dms-i19-verification`, `.dms-i20-verification` and
`.dms-i20-final-20261107` held old DMS recovery/release qualification artifacts. They were
removed on 2026-11-12 after checking container mounts, Compose references and current Titan
dependencies. Tracked qualification summaries remain historical records; their references
to those deleted local artifacts no longer provide retrievable logs or backup bundles.

Retain any directory holding a current installation's Compose files, private configuration,
credentials, trust/signing material, receipts or recovery backups. The local Titan rehearsal
uses `.dms-titan-20261112` for central support and `/home/dev/titan-local-20261112` for its
separate customer deployment. These remain required. Before removing other old workspaces,
check both running and stopped containers and installation references. Folder cleanup and
Docker database/storage volume deletion are separate operations; do not prune volumes as
part of routine artifact cleanup. New customer installations use the protected directories
outside Git described below.

<a id="customer"></a>

## 1. Prepare the customer host and install

<a id="customer-customer-operator-preparation"></a>

### Customer operator preparation

Use a nonroot Linux operator and Linux/amd64 Docker with API 1.52 compatibility, at least 4 GiB RAM and two CPUs.
Prepare production-like DNS/TLS and a controlled TLS/STARTTLS relay. Dokploy/operator
owns ingress. For WSL/Windows testing, trust only the public local CA in the Windows
browser, map the chosen local names to loopback if necessary, and keep private keys in
WSL. Local ports remain in 23600–23608 and fail on conflict.

Use three disjoint canonical absolute directories outside any Git checkout: transferred
bundle, private input directory and empty installation state. Inputs/state must be owned
by the invoking Linux user with mode 0700; all private input files must be mode 0600.
Do not use Windows UNC paths or symlinks. For example, `/home/dev/private-install/inputs`,
`/home/dev/private-install/state` and `/home/dev/releases/customer/bundle` are separate.
Keep the signed intent and both provisioned trust JSON files in the input directory.
The runtime release trust format is version/revision/issuer/keys with `pem`, key status
and nullable `lastIssuedAt`; do not reconstruct all keys as active from a delivery token.

Create a protected `input.json` using actual canonical origins and paths:

```json
{
  "version": 1,
  "directory": "/home/dev/private-install/state",
  "bundleDirectory": "/home/dev/releases/customer/bundle",
  "intentFile": "/home/dev/private-install/inputs/intent.json",
  "centralTrustFile": "/home/dev/private-install/inputs/central-trust.json",
  "releaseTrustFile": "/home/dev/private-install/inputs/release-trust.json",
  "caFile": "/home/dev/private-install/inputs/ca.pem",
  "ingressNetwork": "customer-ingress",
  "authorityOrigin": "https://turnstile.localhost:23600",
  "resourceOrigin": "https://dms.localhost:23600",
  "transferOrigin": "https://files.localhost:23600",
  "smtp": { "host": "mailpit", "port": 1025, "mode": "starttls", "from": "setup@customer.test" },
  "turnstileSmtp": {
    "host": "mailpit",
    "port": 1025,
    "mode": "starttls",
    "from": "setup@customer.test"
  },
  "operatorId": "customer-installation-operator"
}
```

`caFile` is optional for ordinarily trusted certificates. SMTP credentials, if required,
belong only in this protected input. The current Turnstile profile uses its existing
controlled local STARTTLS relay; provision that relay on the selected ingress network.
This is not a general production SMTP/provider provisioning tool. If Docker default
address pools are exhausted, explicitly review a free RFC1918 /24 and supply
`privateSubnet` in input.json (for example `10.240.91.0/24`). The engine never guesses
a replacement subnet; Docker still rejects overlap. Select this before installation;
changing retained settings requires explicit reconciliation, not an automatic reset.

Load `bundle/images.tar` using `docker load --input /absolute/bundle/images.tar`.
Set `THAAREI_INSTALLER_IMAGE` to the independently supplied exact engine `sha256:...`,
`THAAREI_INSTALLER_NETWORK` to the prepared ingress network, and
`THAAREI_INSTALLATION_DIRECTORY` to the exact state directory. For a local test CA set
`THAAREI_INSTALLER_CA_FILE` to its public PEM in the input directory.
The host needs Docker and ordinary Linux utilities; it needs no source checkout or
host Node/Python. Use the absolute bundled executable:

```sh
/absolute/bundle/installer plan /absolute/private/inputs/input.json
/absolute/bundle/installer install /absolute/private/inputs/input.json
/absolute/bundle/installer status /absolute/private/inputs/input.json
```

Exit 10 is expected while another actor must act; inspect the safe JSON conditions.
Exit 20 requires reconciliation; exit 30 permits resuming after service recovery.
`resume` keeps committed secret plans, command receipts, identities and volumes.
The generated `ingress-routing.json` and `ingress.nginx.conf` use actual container
names without UUID transcription. Apply reviewed routing to the operator-owned ingress;
the snippet assumes its TLS files are mounted at `/tls/tls.crt` and `/tls/tls.key`.
It does not deploy or replace Dokploy. No application container receives Docker authority.

<a id="pairing"></a>

## 2. Pair products and request central activation

<a id="pairing-pairing-approval-and-module-activation"></a>

### Pairing, approval and module activation

Put the real downloaded JSON in the private input directory. Create a separate protected
command file for each product, e.g. `pair-dms.json`:

```json
{ "product": "dms", "file": "/absolute/private/inputs/dms-pairing.json", "mode": "setup" }
```

Invoke `installer pair /absolute/private/inputs/input.json /absolute/private/inputs/pair-dms.json`.
Repeat with `product: "turnstile"` and its own pairing file. Staff then independently
approve both products and review v2 enforcement/installed profile activation.
Invoke `installer sync /absolute/private/inputs/input.json`; it performs both owning
syncs and acknowledgements, while independently scoped reporters run privately.
Central status is read-only and cannot approve a product or grant a module.

For expired/explicitly replaced pairing, staff issues the correct replacement file and
the operator explicitly selects `mode: "rebind"`. This invokes the owning recovery
protocol and preserves anti-replay floors. A successful historical pairing receipt is
not permission to reuse a consumed code. Do not edit the journal or erase credentials.
Changed desired revision/profile or another installation stops before further effects.
Release signatures remain durable content evidence under current key policy; publication
expiry cannot reset committed setup or require rebuilding identical binaries. Fresh setup
authority always comes from the current unexpired intent and central desired check.
Renew an expired intent through central staff for the same retained context; this does
not create a new installation. Changed context needs the reviewed reconciliation/upgrade
workflow, including package availability and current approval.

<a id="identity"></a>

## 3. Create the real administrator and open the release

<a id="identity-real-customer-identity-and-private-administrator-handover"></a>

### Real customer identity and private administrator handover

All `owner` inputs are protected command JSON files, never shell secrets. For the initial
selected administrator use:

```json
{
  "operation": "provision-user",
  "input": {
    "email": "admin@customer.test",
    "name": "Customer administrator",
    "role": "admin",
    "password": "<private strong password>"
  }
}
```

Run `installer owner <input.json> <command.json>`. The real authority sends verification
mail to its exact allowlisted setup-preparation page; the user follows the actual mail.
No SQL verification bypass or fake OAuth client is used. For expired mail, a new protected
command with `operation: "resend-verification"` and `input: {"email":"admin@customer.test"}`
requests a real new message without creating another account. The preparation page grants
no session or business access.

After verification, `installer identity <input.json> <identity.json>` accepts:

```json
{
  "operatorEmail": "admin@customer.test",
  "operatorPassword": "<private verified administrator password>",
  "initialPermissions": ["turnstile:access", "turnstile:dms:capabilities:read"]
}
```

It issues distinct owning login/machine/identity-service clients, registers/enrolls the
reserved application, probes DMS capabilities and records explicit initial permissions.
It checks current client metadata on rerun and cannot treat a historical success as
permission to re-enable a later disabled client. These probes do not qualify processing.

The customer signs in normally. Until the proposed IA-I06 scoped proof exchange is
reviewed and implemented, use the existing protected private handover fallback: obtain
the current normal `__Host-turnstile` session cookie privately on the customer machine.
Never paste it into chat, central, a URL, a ticket or a general log. Private `owner`
commands for `operation: "release"`, first `subcommand: "bootstrap-administrator"` and
then `subcommand: "open"`, each take:

```json
{
  "operation": "release",
  "subcommand": "bootstrap-administrator",
  "input": {
    "administratorUserId": "@prepared-user",
    "administratorCookie": "__Host-turnstile=<private current cookie>"
  }
}
```

Use a new file for the open command. The engine resolves the prepared user, current
revision, durable operation key and exact release automatically. Owning commands still
verify live session/identity, operator fences and schemas. The customer completes company,
time zone and first-unit setup through the normal UI. Administrator status does not imply
Incident/Risk permission. An explicit private grant, using a current normal login, is:

```json
{
  "operation": "module-access",
  "input": {
    "action": "grant",
    "userId": "@prepared-user",
    "moduleId": "incident-management",
    "reason": "Approved Incident reader",
    "userCookie": "__Host-turnstile=<private current cookie>"
  }
}
```

The engine resolves the current revision, role/key and user. The owning command still
requires current module entitlement and live local identity. Never change the content of
a retained command file and reuse its identity; new authority/payload needs a new file.
Remove original transient password/proof command files after successful settlement.
For current release inspection use a new `owner` command with `operation: "release"`,
`subcommand: "verify"`, `input: {}`; inspect protected `.installer/last-owner-result.json`.
`status` reports current central facts and explicitly leaves current private/workspace/
processing/target verification with their owners; it never infers universal readiness.

<a id="identity-fresh-proof-after-administrator-changes"></a>

### Fresh proof after administrator changes

Bootstrap/module grants change the access context and regenerate the browser cookie.
Refresh the normal browser session and obtain its current private proof separately for
each later command. An earlier successful proof can already be stale; do not disable
HttpOnly protection or change database sessions to reuse it.

New launcher builds expose `retry-open <input.json> <retry.json>` for a retained failed
`release.open`. The protected retry JSON is:

```json
{
  "stage": "owner-<actual-retained-operation-uuid>",
  "administratorCookie": "__Host-turnstile=<private-current-normal-cookie>"
}
```

Find the exact stage in the private journal/error evidence. The tool replaces only the
proof and invokes the unchanged owning operation. Existing successful receipts do not
reopen a subsequently closed release. Changed revision without a matching receipt still
requires owning reconciliation. Other uncertain fresh-only commands remain blocked.
This command is part of newly built releases; do not patch signed old bundle files.
The Titan rehearsal exercised the reviewed working-tree recovery engine against its
original signed customer image and retained operation. Packaged upgrades of older
installer engines still require a reviewed release-tool delivery.

For the independent customer Compose handoff follow the
[customer guide](#customer-compose).

<a id="onboarding"></a>

## 4. Complete company and user onboarding in the browser

1. Sign in at the canonical Turnstile origin as the verified, explicitly bootstrapped
   administrator. Enter company **Titan**, choose **Asia/Kolkata** explicitly, create the
   required first site **Titan Headquarters**, review and finish setup. Use real customer
   values outside this rehearsal. Refresh Settings/Structure and confirm persistence.
2. Grant explicit Incident/Risk reader access through the private command above, refreshing
   normal-session proof between commands. Administrator status alone grants no module access.
   Confirm both guarded module pages. Changes in central desired assignment invalidate the
   original fresh-install intent; later maintenance uses owning module operations, not an
   edited journal or a rerun with fabricated intent. See [module access](../runbooks/module-access.md).
3. In **People → Invitations**, enter the recipient's email, add the intended role and its
   coverage, review the current impact, then confirm. Wait for delivery status; refresh the
   Mailpit inbox during local tests. The recipient reviews the real invitation, creates an
   account, verifies email, signs in and explicitly accepts. Sending an invitation does not
   itself grant membership. Separate browser profiles keep administrator and recipient apart.
4. Confirm the recipient sees only permitted modules and cannot open another module by URL.
   Test reviewed membership suspension against both the current session and a fresh login,
   then reactivate and confirm retained access. Do not confuse membership suspension with
   identity-wide session revocation. Password reset/session tests use normal recovery screens.
5. Verify company setup survives a service restart. In Settings/Structure exercise intended
   unit edits and permitted coverage; run scope-specific negative cases for the customer's roles.
6. Use **Document connection → Check connection** with a user explicitly granted
   `turnstile:dms:capabilities:read`. Connected proves the capability path, not upload/OCR.

The [authentication reference](../runbooks/authentication.md) contains lower-level owning
account/client operations and development setup. The [user-management release procedure](../runbooks/user-management-release.md)
contains coordinated upgrades/recovery, not an alternative fresh installation checklist.

<a id="customer-compose"></a>

## 5. Transfer to the separate customer Compose project

The six installer-provisioned services can be exported without recreating identities/data.
The repository contains a separate customer gateway Dockerfile and Compose entry point;
application build logic stays in each application's existing Dockerfile.

Current customer-operator tooling commands (not customer business tests):
The exporter presently runs from a reviewed tooling checkout with Node/pnpm and access
to that customer's Docker daemon and private state. Packaging it for a Docker-only target
is a follow-up; never send customer environment exports to central staff.

```sh
pnpm --filter @thaarei/installation-engine build
node scripts/export-customer-compose.mjs /absolute/customer/inputs/input.json /absolute/customer/new-compose customer-name
docker build -f deploy/customer/Dockerfile -t customer-gateway:review .
```

Choose a new export directory beneath a private mode-0700 parent outside Git. The exporter
checks exact installation-labelled services, copies environments into protected raw files,
and retains external volume/network references, image IDs and security limits. It performs
no stop, deletion or activation. Do not publish its output or `docker compose config` output.

Deliver the reviewed gateway image and `deploy/customer/compose.yaml` separately. Populate a
protected project environment file with these nonsecret bindings:

```dotenv
CUSTOMER_PROJECT=customer-name
CUSTOMER_RUNTIME_COMPOSE=/absolute/customer/new-compose/compose.yaml
CUSTOMER_GATEWAY_IMAGE=sha256:<independently-verified-gateway-image-id>
CUSTOMER_INSTALLATION_ID=<actual-local-installation-uuid>
CUSTOMER_GATEWAY_ALIAS=customer-name-gateway
CUSTOMER_INGRESS_NETWORK=<existing-customer-ingress-network>
```

Validate with `docker compose --env-file <project.env> -f <customer.yaml> config --quiet`.
For the first lifecycle transfer, inspect the saved `container-ids.json`, stop and remove
only those exact six containers during a maintenance window, then run:

```sh
docker compose --env-file /absolute/customer/project.env -f /absolute/customer/customer.yaml up -d --no-build
docker compose --env-file /absolute/customer/project.env -f /absolute/customer/customer.yaml ps
```

Retain all volumes, private files and networks. The new project runs the six application
services plus the customer gateway. Route the customer Turnstile HTTPS origin to the unique
gateway alias on port 8080. Ingress must overwrite forwarding headers. The gateway publishes
no host port, resolves actual installation-specific container names and blocks `/internal/`.
Route the distinct DMS resource origin directly to its public API as before. The gateway is
outside the installation's private database network. Declare the ingress and controlled
SMTP relay attachments to this external network in their owning Compose project, including
required DNS aliases. A manual `docker network connect` is lost when its container is
recreated. Do not let two supervisors concurrently
replace containers; serialize installer maintenance and Compose lifecycle operations.

<a id="ingress"></a>

## 6. Configure Dokploy, DNS and TLS

Use Docker Compose mode with repository-root build contexts for source builds; customer
release bundles use exact prebuilt images. Select the intended manifest explicitly: the
root Compose is development only, and `deploy/compose.dokploy.yaml` is the source-based
three-app topology, not the complete DMS distribution or the exported customer project.

For the exported customer project, route the Turnstile HTTPS domain to the unique gateway
alias on port 8080. For a topology without this gateway, configure these routes at ingress:

| Public origin/path                       | Private destination                             |
| ---------------------------------------- | ----------------------------------------------- |
| Turnstile `/`                            | selected Turnstile web, port 8080               |
| Turnstile `/api` (preserve prefix)       | Turnstile API, port 3002                        |
| Turnstile `/identity` and `/.well-known` | DMS authority/API, port 3001                    |
| Independent DMS resource origin          | DMS API, port 3001, approved public routes only |
| Full-DMS transfer origin                 | DMS transfer gateway, port 8333                 |
| Thaarei central origin, on its own host  | control-plane, port 3000                        |

API/identity routes take priority over the SPA. Block `/internal/` at public ingress.
Keep database, broker, workers, parser, scanner and maintenance interfaces private.
Dokploy owns TLS; the app Compose files publish no fallback host ports. Local tests use
only reserved ports 23600–23608 with fixed bindings. Install only the public local CA into
browser/runtime trust; never disable certificate verification or distribute private CA keys.

Declare network attachments and DNS aliases in owning Compose files so recreation retains
them. Ingress overwrites forwarding headers; configure proxy trust only for that exclusive
path. Exclude auth queries, cookies, request bodies and credentials from logs. Frontend
code uses same-origin API requests and receives no service credentials. Recreate containers
after replacing individually bind-mounted trust files; process CA changes require restart.

Validate private Compose configuration with `config --quiet` (do not print resolved secrets).
After deployment check backend readiness, frontend SPA/assets, canonical issuer discovery,
verification links, normal login/callback/logout and both module entries through the actual
public origin. [Frontend HTTP details](../../deploy/nginx/README.md) and
[coordinated onboarding upgrades](../runbooks/onboarding-release.md) remain specialist references.

<a id="validation"></a>

## 7. Validate the installation

Use normal browser actions and record the actual outcome for each scenario in the
[Titan matrix](titan_fresh_install_validation_plan.md#phase-6--entitlement-and-enforcement-matrix).
At minimum: both modules; one removed centrally; both removed; restored selection awaiting
activation; restored activation; denied direct URL; no implicit administrator rights;
independent DMS/Turnstile suspension; outage before expiry; expiry; recovery; retained company
setup after restart; normal logout/login; permission removal and suspended-user denial.

For a short local expiry rehearsal, use the bounded central `CONTROL_PLANE_DECISION_SECONDS`
setting, sync a new signed decision, confirm access before expiry, stop central, and test
again after the signed expiry. Restore the default and central service, sync and confirm
recovery. This setting cannot extend the seven-day maximum, and changing it does not erase
an already issued grant: sync must apply the new decision. Use a disposable local environment;
a lifetime below the normal reporter interval deliberately expires between renewals.

The full DMS processing/storage profile requires the separate
[DMS distribution](#standalone-dms), [work](../runbooks/dms-work.md) and
[handover](../runbooks/dms-handover.md) procedures. Today's Turnstile UI can check the DMS
connection; it cannot prove full upload/OCR/download lifecycle behavior. Record that scope
as unavailable through the current UI, not passed. Physical clean-host/Dokploy rollout,
restore drills and customer acceptance also need their own evidence.

### Full DMS document and application-isolation checks

Turnstile currently provides a connection/status adapter, not document business screens.
Test DMS documents through its independent backend examples and controlled API explorer.
The explorer accepts short-lived bearer tokens only; machine secrets remain outside it.
Some write operations intentionally cannot be executed in the browser explorer.

1. Follow [independent enrollment and explorer](../runbooks/dms-api-explorer.md) to create distinct
   consumer A/B clients, register/enroll them, obtain resource-bound tokens and read
   capabilities. Check one invalid-token request and one scope denial.
2. Use [secure transfer](../runbooks/dms-secure-transfer.md) and [uploads](../runbooks/dms-uploads.md) to upload a
   small text file, native PDF and clean English scanned image with the Python examples.
   Complete and poll each upload. Download the accepted originals and compare bytes/hash.
3. Read extraction/OCR results and search for distinctive text. Record failures and partial
   extraction exactly; optional structured processing requires its enabled profile.
4. Edit metadata/tags/references, create a second binary version and restore an earlier
   version as a new version. Reload history and verify immutable earlier originals.
5. Verify B cannot access A's document. Grant READ, verify permitted reads and denied
   writes, grant metadata-only editing, then revoke access and retry reads/search.
6. Soft-delete and restore a document, inspect authorized audit and verify current state
   after reload. Use [sharing](../runbooks/dms-sharing.md), [versions](../runbooks/dms-versions.md),
   [results](../runbooks/dms-results.md), [discovery](../runbooks/dms-discovery.md) and
   [lifecycle](../runbooks/dms-lifecycle.md) for exact protected inputs and expected outcomes.

<a id="handover"></a>

## 8. Handover and cleanup

Restore normal decision lifetime, services and intended module approvals after faults.
Remove transient proof/password input files; retain encrypted operational credentials,
independent recovery markers/trust, receipts and a coherent tested recovery set. Supply the
customer their origins, accountable administrators, selected release/inventory, actual
validation report, backup/restore procedure and support escalation. Do not distribute test
CA/signing private keys, fixture credentials or unqualified production claims.

<a id="recovery"></a>

## 9. Recover interrupted setup and plan upgrades

<a id="recovery-recovery-and-evidence"></a>

### Recovery and evidence

Private `.installer/last-error.log`, command outputs and failed-attempt logs support local
reconciliation. Do not publish them. Lost Docker create/start responses resume the same
named container; successful exited tasks are recorded before cleanup. Replayable owning
commands retry their retained payload. Role provisioning waits for the final TCP server;
its owning private exit 75 permits retry only for a confirmed connection failure before
role DDL. Unknown provisioning outcomes still require reconciliation. Uncertain fresh-only account/client/key/role or
proof-bearing mutation outcomes require their owning inspect/reconciliation procedure;
do not automatically repeat issuance or repair via SQL. Original private input files are
operator-owned; retain only what the owning recovery protocol needs and protect backups.

Run `pnpm test:installation:engine /tmp/new-private-qualification-directory` from the
pipeline checkout to build/inspect the actual signed Incident-only release and run the
disposable central/customer artifact-only HTTPS/browser qualification. `--resume` reuses
verified build caches; each customer execution gets its own fresh installation. This test
is distinct from production target acceptance. Database test volumes are retained.
Actual results and outstanding target gates are tracked in `IN_PROGRESS.md`.

For an existing module installation use [module transitions](../runbooks/module-transitions.md)
and [user-management release recovery](../runbooks/user-management-release.md). For full DMS,
use [coherent recovery](../runbooks/dms-recovery.md). Stop/drain writes, retain a coherent
backup, apply compatible owning migrations, verify the matching image set and reopen only
after authoritative checks. Never use a fresh initializer or `down -v` as an upgrade.

<a id="standalone-dms"></a>

## 10. Full independent DMS distribution

### Central approval is required before document business access

The base `./dms` wrapper selects `compose.dms-complete*.yaml`; it does **not** install
central pairing/trust configuration. Current DMS code rejects an unpaired installation.
The distribution fixture supplies a test policy explicitly; its success does not make the
base wrapper an activated customer release. Complete the following additional target steps
before consumer enrollment, admission, uploads or work processing:

1. Prepare the private central binding environment and files described in
   [DMS deployment operations](../runbooks/dms-deployment-control.md#private-files-and-configuration):
   canonical central origin, independently delivered public trust, a fresh recovery marker,
   private product directory and the required CA bundle. Keep the directory 0700/files 0600.
2. Use `deploy/compose.dms-activated.yaml` with the **same project name** and environment
   as the already initialized DMS. The default is `thaarei-dms`; inspect the existing project
   before changing anything. Preserve its volumes, network aliases and generated files.
   The source activation overlay has a milestone image tag. Override `dms-api`, `coordinator`
   and `dms-maintenance` to the independently verified DMS image ID from `images.lock`;
   do not pull that historical tag or rebuild an unreviewed candidate on the customer host.
3. For example, a protected `/private/dms-pinned.yaml` contains `services` entries for those
   three service names, each with `image: sha256:<verified-id>` and `pull_policy: never`.
   With values in `/private/central-binding.env`, use this file set for lifecycle operations:

```sh
docker compose -p thaarei-dms --project-directory "$PWD/deploy" \
  --env-file .env.dms.compose --env-file /private/central-binding.env \
  -f deploy/compose.dms-activated.yaml -f /private/dms-pinned.yaml config --quiet
```

4. Run the actual DMS `dist/modules/deployment/operator.js` via this file set's private
   `dms-maintenance` service. Supply JSON through protected stdin: first `manifest` with
   environment/build version/output path. Register its exported binding through central's
   existing-installation workflow, download its own pairing file, then invoke `setup` with
   that file. Central staff approves the DMS; `sync` must apply and acknowledge the decision.
   The deployment runbook gives the exact command inputs and independent restore rules.
5. Use the same reviewed file set with `up -d --no-build --pull never` and verify
   `/health/deployment` reports permitted current authority. Use it for later operator/work
   commands too, with each operation's designated private environment, not a migrator in
   the running API. The base wrapper's `up` must not replace this activated topology.
6. For optional structured processing, preserve the selected structured overlay and exact
   optional image as well; qualify that combined file set separately. For Turnstile, use
   the complete combined profile section rather than adding another tenant to this DMS.

The commands below document the underlying distribution's bootstrap, scanner and lifecycle
operations. After activation, execute their equivalents through the reviewed activated file
set. A packaged activation-aware full-DMS wrapper and full combined clean-target acceptance
remain release work; the module-POC path at the start of this guide is the automated Titan path.

<a id="standalone-dms-assemble-and-transfer-a-candidate"></a>

### Assemble and transfer a candidate

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

<a id="standalone-dms-initialize-a-fresh-installation"></a>

### Initialize a fresh installation

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
policies and consumer-owned screens: see the [authority runbook](../runbooks/authentication.md).

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
`admission-policy-set` before accepting uploads; see the [admission runbook](../runbooks/dms-admission.md).
Initialization deliberately leaves admission unconfigured until the operator selects its limits.

Consumer issuance/enrollment uses the existing
[consumer enrollment](#dms-consumers) and [explorer](../runbooks/dms-api-explorer.md) procedures and separate
credentials. In the bundle, `./dms authority-client` and `./dms application` invoke the
same private commands through their dedicated environment files, replacing repository
pnpm invocations. Enrollment never grants internal-work authority.

<a id="standalone-dms-scanner-data-and-startup"></a>

### Scanner data and startup

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

<a id="standalone-dms-observe-recover-and-rotate"></a>

### Observe, recover and rotate

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
because a broker delivery was acknowledged. See [work recovery](../runbooks/dms-work.md).

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

<a id="standalone-dms-upgrade-and-verification"></a>

### Upgrade and verification

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

Coherent backup, empty-target recovery, key custody and recovery-aware physical disposal are described in the [recovery runbook](../runbooks/dms-recovery.md). The legacy backup report is not a completed recovery cohort.

<a id="dms-consumers"></a>

## 11. Independent DMS consumers and operator access

<a id="dms-consumers-independent-machine-backend"></a>

### Independent machine backend

Use the existing private `auth:manage-client` command with fresh verified administrator
credentials in stdin. Issue `kind: "machine"`, an explicit distinct `clientId`, stable
`applicationId` UUID, `scopes: ["dms:capabilities:read"]` and `credentialFile`. Then use
`dms:manage-application` to `register` with the same IDs, name and scope ceiling, followed
by `issue-key` with a new private `credentialFile`. See the precise JSON contracts in
[authentication operations](../runbooks/authentication.md). Arbitrary valid machine names are supported;
no Turnstile identity, role, setup or application ID is required.

The consumer backend uses Basic authentication at `${issuer}/oauth2/token` with grant
`client_credentials`, exact `resource` equal to the configured DMS `/v1` resource and
scope `dms:capabilities:read`. POST `/v1/application-enrollments` with the bearer,
`X-Thaarei-Enrollment-Key`, a UUID `Idempotency-Key` and `{ "name": "<registered name>" }`.
Then GET `/v1/capabilities` with the bearer. Different applications enroll independently.
A login session never substitutes for this bearer. Publisher/scanner/extractor work principals require their separate work-client scopes
and operator grants; consumer enrollment cannot create those privileges.

Rotation immediately invalidates the old client secret; use a new credential file and
update the backend before resuming issuance. Existing JWTs expire within five minutes.
Disable through the DMS private command for immediate local denial and issuer suspension;
issuer-only suspension does not replace the live DMS registration check.

<a id="dms-consumers-independent-shared-user-consumer"></a>

### Independent shared-user consumer

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

<a id="dms-consumers-operator-authorization-and-recovery"></a>

### Operator authorization and recovery

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
Document operations check current operator authorization; no public maintenance endpoint
is enabled by operator bootstrap. In particular,
consumer OpenAPI must never include private commands or their input credentials.

<a id="dms-consumers-verification"></a>

### Verification

Run `pnpm test:dms:standalone` for disposable auth/DMS-only roles/migrations/bootstrap,
independent consumers, private operator checks, discovery/token/JWKS, PKCE continuation,
Chromium screens, recovery and client rotation/disablement. It uses the existing isolated
fixture runner and removes its own containers; it never changes the local installation.
Set `DMS_STANDALONE_IMAGE` to a locally built DMS image tag when running this lane
to additionally verify packaged readiness/direct discovery against the isolated auth/DMS
database, without publishing a container port. Run the four required workspace checks as well to preserve combined/recipient behavior.
Runtime/image/Dokploy/customer TLS acceptance must be reported separately from source checks.

For current-grant private audit inspection with the dedicated operator database role, see
[the audit runbook](../runbooks/dms-audit.md). Inspection does not require migration credentials.

Complete versioned installation and operations: [distribution runbook](#standalone-dms).

<a id="complete-profile"></a>

## 12. Complete combined DMS and Turnstile profile

This is an advanced deployment path, not an extra `installer install` flag. Do not initialize
standalone DMS and then point the fresh combined coordinator at its existing directory.
Use `deploy/compose.customer-complete.yaml` for the combined storage/processing topology,
with the independently selected current DMS/Turnstile images and their own exact-image tests.
`deploy/compose.dms-activated.yaml` is the DMS-only central-approval overlay.

Follow [DMS deployment operations](../runbooks/dms-deployment-control.md) for exact private
files, owning deployment commands, independent pairing, reporting and restore fences, and
[Turnstile deployment operations](../runbooks/turnstile-deployment-control.md) for its distinct
reporter. These feature runbooks supply product recovery contracts. Use the fresh preparation
reference below only for an empty combined target. Provision/migrate/bootstrap both owners,
configure full DMS storage/work clients/scanner/admission as in the DMS sections above, then
complete customer identity/company/user steps and separately validate document processing.

The module-POC installer does not automate this full path. No full combined production or
clean Dokploy acceptance is claimed by the Titan rehearsal. Keep that as an explicit target
gate, rather than silently substituting a foundation-only Compose file.

<a id="advanced-preparation"></a>

## 13. Advanced combined preparation and owning commands

<a id="advanced-preparation-private-verification-boundary"></a>

### Private verification boundary

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

<a id="advanced-preparation-combined-private-preparation"></a>

### Combined private preparation

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

<a id="advanced-preparation-generated-state-and-recovery"></a>

### Generated state and recovery

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
Use the current module transition and installer recovery workflows for those changes.

<a id="advanced-preparation-owning-bootstrap-and-pairing"></a>

### Owning bootstrap and pairing

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
   Complete the [signed-decision](../runbooks/module-decisions.md), [staff activation](../runbooks/module-transitions.md)
   and [explicit customer permission](../runbooks/module-access.md) steps before opening module access.

Recheck preparation freshness before affected setup/cutover after a delay or interruption.
These are explicit local operator commands; central performs no customer remote shell,
Docker operation, migration or deployment. Production host rollout and installer-wide
journals/acceptance remain their owning IA increments.

<a id="advanced-preparation-windows-and-wsl"></a>

### Windows and WSL

Run the coordinator inside WSL. Keep private operator/configuration directories on WSL's
Linux filesystem so mode 0700/0600 is enforced. Use `/home/dev/...` paths, not
`\\wsl.localhost\Ubuntu-24.04\home\dev\...` strings. A public downloaded intent on Windows
can be read using `/mnt/c/Users/<user>/Downloads/installation-intent.json`, or copied to the
private WSL directory. Use the real downloaded file name rather than example placeholders.
The existing separate Windows browser CA trust/hosts setup is unchanged.

<a id="advanced-preparation-qualification"></a>

### Qualification

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
