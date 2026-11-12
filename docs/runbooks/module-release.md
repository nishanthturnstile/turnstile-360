# Module release evidence and support

Use the [handoff and requirement trace](../turnstile/modules/module_release_handover.md)
with the accepted [architecture](../../architecture.md). Local placeholder qualification
does not authorize customer distribution or production deployment.

## Repeat the local qualification

Retain the full exact checkout, Node 24.21.0, pnpm 12.16.1, pinned Python/uv, Linux/amd64
Docker and Playwright Chromium. Keep the protected fixture directories, their public
trust separately from private signers, exact image archives, logs and legal sidecars under
the operator's retention policy. Public JSON contains only safe projections/log hashes;
losing private evidence or artifacts makes a hash insufficient for replay. Do not commit
signers, JWTs, credentials, email URLs, cookies or private journals. Never share ca.key.

Run the four workspace gates and the focused container suites sequentially:

```sh
pnpm check
pnpm build
pnpm test
pnpm test:integration
AUTH_BROWSER_PRIVATE_SUBNET=10.240.92.0/24 pnpm test:browser:modules /absolute/new-private-module-images
AUTH_BROWSER_PRIVATE_SUBNET=10.240.92.0/24 pnpm test:module:cutover /absolute/new-private-module-cutover
pnpm test:installation:engine /absolute/new-private-module-installation
node --test scripts/module-release-evidence.test.mjs
```

The fixed /24 above is the serial local browser fixture network, not an application host
port. Review it against actual routing first; overlap/conflict fails without choosing a
fallback. Omit the environment setting when Docker's default address pools are available.
The installer fixture separately uses 10.240.90.0/24 and 10.240.91.0/24. Container tests
must not run concurrently on these networks. Preserve existing networks and database
volumes; browser cleanup removes its own containers before its own network. A synthetic
central fixture is not a selected-image acceptance substitute.

`--resume` explicitly reuses verified artifact caches; it creates another disposable
execution, not a reset/adoption of customer state. Verify that the selected build digest
has not changed. Changes to runtime/build inputs require new profiles/images. Changes to
launcher, instructions, notices or source offer require a new combined package. Public
record verification is read-only:

```sh
node scripts/module-release-evidence.mjs verify docs/qualification/module-release-20261111.json
```

This compares exact current source/document bytes and executable flags with the frozen
record and detects checksum drift. It does not fetch artifacts, trust a release signer,
query current business access or inspect private customer state. A legitimate source/doc
change creates a new qualification record rather than editing frozen checksums to pass.
The maintained mutable progress log is intentionally excluded.

## Freeze a reviewed local record

Use the external pipeline's checksum-verified Syft 1.57.0 binary, pinned in
`deploy/distribution/release.json`, and a new private output directory:

```sh
node scripts/collect-module-release-materials.mjs /private/installation/fixture.json /private/tools/syft /private/new-materials
```

This reads only credential-free image IDs from the verified candidate, scans actual
images and extracts retained notices using the existing DMS collector. No running customer
container/state is inspected. Keep the SPDX/Syft/source records and legal archives for
all five IDs. Review unresolved declarations and retain actual corresponding source and
build materials before distribution. The source offer is not a completeness certificate.

The freeze tool consumes a mode-0600 JSON configuration with `fixtureFile`,
`selectedDirectory`, `cutoverDirectory`, `freshReceipt`, `legalDirectory`, exact
`centralImage` and `runs`. Runs contain unique IDs `check`, `build`, `test`, `integration`,
`selected`, `cutover`, `installer`, `evidence`, `inventories`; each has the actual `command`,
`log`, `exitCode: 0`, `kind` and explicit `limitations`. Container runs also record exact
`images` entries with `role` and immutable `id`; separately rebuilt DMS images are not
conflated with the transferred candidate. The fresh receipt is the safe
`qualification.json` from the successful artifact-only operator run, not a product secret
file. Freeze rechecks actual signed bundles, source/profile identity, receipt revision,
image inventories and legal sidecar hashes. It emits no signing proof/private input data.

```sh
node scripts/module-release-evidence.mjs freeze /private/evidence-input.json docs/qualification/module-release-20261111.json
```

Output is exclusive; an existing frozen record is never overwritten. This invocation is
the dated MOD-I10 record location. Future releases need their own reviewed record location
and source snapshot exclusion, not replacement of this historical record. Retain execution
exit receipts with logs; logs alone are not proof that a failing command later passed.
The freeze tool checks recorded exit codes, not a reexecution of every command.

## Support and reconciliation

Follow [fresh handover](installation-handover.md) for the supported launcher commands and
private input schema; [assignments](module-assignments.md), [decisions](module-decisions.md),
[access](module-access.md) and [transitions](module-transitions.md) own their respective
operations. Always compare actual binding, desired revision, installed profile, active
authority, acknowledgement, independent product approval and report freshness separately.

| Symptom                                         | Supported response                                                                                                                                                         |
| ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Awaiting package / upgrade required             | Publish the exact external profile or use reviewed cutover; changing assignment cannot install code.                                                                       |
| Paired but closed                               | Staff independently approves each product with current MFA, then reviews/activates the exact reported module profile; operator syncs and confirms acknowledgement.         |
| Module absent or denied after login             | Check installed selection/current signed authority, local enablement, workspace readiness and explicit live user permission; do not grant from navigation/reporting alone. |
| Expired intent                                  | Renew through current staff revision and desired selection; preserve retained state/secrets. An old setup receipt cannot bypass current checks.                            |
| Expired module authority / disconnected removal | Restore authenticated sync/current approval. Every module business read requires current module authority; no product-level read exception overrides it.                   |
| Key absent/revoked/late-retired                 | Provision reviewed independent release trust through its owning procedure; never reconstruct every delivered key as active.                                                |
| Conflict / uncertain fresh-only outcome         | Stop at exit 20 and reconcile through the owning command/protocol. Keep state, databases and receipts. Never delete volume/journal or rerun credential issuance blindly.   |
| Retryable unavailable                           | Exit 30 permits the documented retained-payload retry. Only confirmed pre-effect role connection failure is retryable; unknown DDL outcomes need reconciliation.           |
| Restore / epoch mismatch                        | Follow coherent recovery/quarantine and exact epoch/order reconciliation; preserve grants/setup/data and permanent v2 floor.                                               |
| Windows path / browser CA failure               | Pass actual Linux absolute paths inside WSL, not UNC strings; trust only the public test CA in the Windows browser/OS.                                                     |

Support evidence may contain only product/release/profile/catalogue IDs, safe historical
revisions, nonsecret status/exit conditions and redacted diagnostic categories. Use
protected channels for any owning proof input. Do not send raw environment/product files,
unredacted service logs, verification tokens or the private signer/CA key.

Before any target release, an accountable operator must record separate production
acceptance of host/TLS/mail, authenticated distribution, off-host restore, real-document
processing/capacity, independent replay and corresponding-source/license completeness.
No local green result substitutes for these gates.
