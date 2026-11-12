# Fresh module installation and staff handover

This runbook covers the supported local `module-poc` release and engine 0.1.0.
Its scope is selected Turnstile API/web, independent DMS authority/API, PostgreSQL,
private owning commands and independent reporters. Processing workers, document
acceptance, production HTTPS artifact retrieval, Linux/Dokploy target acceptance and
off-host recovery remain separate wider installer gates. Follow the accepted boundaries
and retry rules in [architecture.md](../../architecture.md#mod-i09-artifact-only-local-installation-and-staff-handover).
Existing installations use the reviewed upgrade/cutover runbooks; this fresh launcher
refuses adoption/reset. Never remove database volumes to get past a conflict.

## Responsibilities and staff sequence

A central Admin publishes the verified code/classification catalogue and requires v2
enforcement for the selected Turnstile product. Admin/Operator with current MFA reserves
one installation and its two independent products, reviews/approves the module selection,
and downloads the signed fresh installation intent when a matching verified package is
available. Awaiting package means the external pipeline has not supplied that exact
profile. Core classification is a release/staff decision, never a customer setup option.

An independent customer operator receives the actual matching bundle, central public
trust, independent release public trust, an independently verified engine image SHA and
the intent through protected delivery. Release signers and CA private keys stay with
their owners. Central staff receive no customer database, Docker, SMTP or provider keys.
Deliver each one-use pairing file separately using the protected staff download. Pairing
leaves business access closed. Approve DMS and Turnstile independently with current MFA.
After the operator syncs and central shows the exact installed inventory, review and
activate the module profile. Wait for both current approvals to be acknowledged and for
both products to report independently. Inventory, central authority, acknowledged grant,
report freshness and local customer permission are distinct facts in the staff view.

## External pipeline

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

## Customer operator preparation

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

## Pairing, approval and module activation

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

## Real customer identity and private administrator handover

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

## Recovery and evidence

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
