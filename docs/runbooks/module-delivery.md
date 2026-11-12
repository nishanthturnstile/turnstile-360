# Selected Turnstile module delivery

MOD-I04 supplies a local private-bundle POC. The technical contract and boundaries are in
[architecture.md](../../architecture.md#mod-i04-selected-artifacts-and-local-bundle-delivery).
This does not install a customer, activate a module, or replace independent DMS approval.
Fresh initialization and signed runtime enforcement belong to MOD-I05–07.

## Pipeline inputs and trust

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

## Publish the code catalogue, then select a profile

Build the contracts and export actual source-supported code metadata:

```bash
pnpm exec turbo run build --filter=@thaarei/module-catalog...
node scripts/module-delivery.mjs code '/absolute/private/new-code-catalogue.json'
```

Have the configured trusted pipeline sign this code catalogue and the reviewed
classification build plan using the separate MOD-I02
[catalogue evidence protocol](module-catalogues.md). The `code` command exports metadata;
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

## Build, verify and transfer

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
module-specific third-party dependencies. There are no placeholder HTTP routes, sidebar
links or user permission grants in this increment.

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
legacy machines still require an upgrade. Observed/effective module authority remains
unknown and product/user access is not changed. This is provisioned POC reference storage,
not a staff-upload endpoint, database delivery ledger or production artifact service.

## Expiry and recovery

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

## Qualification

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
