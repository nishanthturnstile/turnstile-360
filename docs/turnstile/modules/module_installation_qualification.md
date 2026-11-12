# MOD-I09 local installation qualification

Date: 2026-11-11. Owner: Codex. Scope: source/local automated module POC.
The complete fresh customer journey, final combined harness and sequential workspace
integration run passed. Production deployment and target acceptance remain pending.

The accepted design is maintained in [architecture.md](../../../architecture.md#mod-i09-artifact-only-local-installation-and-staff-handover).
Supported operator commands and private custody are in the
[installation handover runbook](../../deployment/customer_deployment_guide.md#customer).

## Frozen customer release

- Engine/contract: `0.1.0`; profile `module-poc`; platform `linux/amd64`.
- Source inventory digest: `eb9ea073ec2e75e729e9b146e2338529c499ebd31baed6fb286bd7812d9ee5d5`.
- Catalogue digest: `5b1d22fe0ed51b4376a7c99870ba588317ea4eb4dde16f31831ee35a2ba1e6ac`.
- Selected profile digest: `dd1f8f601dc103a27c3b50e7575074e784fe227341d8f6b5c4af83860ac491c7`.
- Selected module release ID: `a4c9f502482db47eef13a4afb055d85cedb61550ecc4243499bcaf7645afeef1`.
- Combined manifest digest: `bb095ef5a2cfe2d5f7553223bee5722364d7fed13672d07046727412496337d5`.
- Independent central candidate: `sha256:b9dcb9963f765c2ae0696794cbcacf878848e290a03150d41270869954cdeb17`.

| Role          | Exact image content identity                                              |
| ------------- | ------------------------------------------------------------------------- |
| engine        | `sha256:0927d9d55d2309bd5060a9648354700173876a6508d9ab4498ab706506d18b84` |
| dms-api       | `sha256:0dc9ffc126233ad68927a8e73fe5ab469f0f6e4e5bdbd568f8ae3c04595e770f` |
| postgres      | `sha256:5c4783a8cc3f0074912164f94dfa1be4e043438f0f707cf968d7af9a0d31a2c8` |
| turnstile-api | `sha256:be7e3529cecde87d12254466b30453eb5a18ca494eb403098126f021f60bdb22` |
| turnstile-web | `sha256:12583f057ef2868b9577541e7ced2e2a6bccf9cbce2b304fd9cb5d3287bbe7e8` |

The selected runtime contains Foundation and Incident Management. Actual image
inventory inspection excludes the Risk implementation. The full signed release binds
all five images, inner module files, launcher, standalone instructions, notices and
source offer. Public signing trust is provisioned independently. This source inventory
matched the workspace when qualification artifacts were assembled. No credentials,
user/session tokens, private signers or real customer records are stored here.

## Exercised ownership and failure paths

| Boundary               | Actual evidence                                                                                                                                                                                                                                                                                             |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Central staff          | Real HTTPS/MFA catalogue publication, selected assignment, reserved identities, fresh intent, v2 enforcement, independent DMS/Turnstile pairing and approvals, exact installed-profile activation.                                                                                                          |
| Artifact-only operator | Bundled POSIX launcher runs the packaged engine; customer containers mount artifact/private configuration only, with no source checkout or host Node/Python dependency. IDs come from signed reservation and owning outputs.                                                                                |
| Fresh owned state      | Actual private DMS/Turnstile configuration, role provision, TCP PostgreSQL readiness, owning migrations/bootstrap and closed business access before approval. No customer SQL seed or UUID transcription.                                                                                                   |
| Crypto and custody     | Tampered file/revoked release signer/unsafe state mode rejected before initialization; historical immutable publication evidence with current intent resumes without changed secrets. Unit cases also reject incompatible releases and late-retired signers.                                                |
| Durable jobs           | Actual Docker Unix proxy discards committed create/start responses. Output-publication failure resumes the same exited initializer, with no duplicate execution. Obstructed committed configuration resumes retained secrets. Only confirmed pre-effect role connection failures receive retry eligibility. |
| Coordination           | Concurrent retained resumes serialize through the kernel lock; reruns preserve generated credentials. Changed desired assignment rejects mutation and preserves state; status reports the mismatch.                                                                                                         |
| Acknowledgement        | Real central sync handlers persist validated exact issued decisions. Unknown/stale proofs cannot manufacture current effective access. Lost acknowledgement retry is idempotent. Own-binding machine status denies anonymous/cross-binding calls.                                                           |
| Reporting              | Separate limited DMS coordinator and Turnstile reporter processes publish current reports and acknowledge independently. Observed/central/acknowledged/reporting facts remain separate from user permission.                                                                                                |
| Customer identity      | Real captured STARTTLS email verification reaches the public preparation page before OAuth client creation. Wrong callback is rejected. Verified administrator issues three distinct purpose/scoped clients, registers/enrolls the reserved application and probes authenticated DMS capabilities.          |
| Private handover       | Normal browser login supplies the existing protected private proof for administrator bootstrap/open; normal UI completes company/time zone/first unit. No verification bypass or public granting endpoint.                                                                                                  |
| Module access          | Administrator receives no implicit module reader. Incident denies before explicit private grant, then its actual landing/API succeeds. Risk entry is absent. The normal Turnstile-to-DMS capability request succeeds.                                                                                       |
| Log privacy            | Actual general ingress/API/reporter/database logs are scanned for generated account, verification, cookie, enrollment and service secrets. Generated servers explicitly override inherited Nginx logging.                                                                                                   |

The customer actor is separate from central staff in the automated fixture. This is
not an independent human or production-host sign-off. Auxiliary legacy v1 compatibility
uses its existing source mode; the selected customer flow above uses actual images.
All mutating work is disposable/local; existing customer state and volumes are preserved.

## Verification and reproduction

The external qualification entry is:

```sh
pnpm test:installation:engine /tmp/new-private-mod-i09-qualification
```

An explicit `--resume` reuses verified artifact caches. Combined cache identity includes
the module proof, engine/DMS/PostgreSQL identities, launcher, instructions, source offer,
notices and proprietary license. The exact
artifact fixture can also run through `scripts/test-control-plane.mjs` with its
`MOD_I09_INSTALLATION_FIXTURE` and production central candidate configured. This driver
uses the same production handlers, private commands, real TLS and browser interaction.
No handler is replaced with an accepting fixture. Run the broad integration gate
sequentially on hosts with exhausted default Docker subnet pools; the customer fixture
uses explicit isolated /24 networks without removing preexisting networks.

Required workspace verification passed: `pnpm check`, `pnpm build`, `pnpm test` and
`pnpm test:integration`. The final exact-fixture central/customer driver exited 0,
including the complete selected-image/browser journey and source-mode legacy compatibility.
Real PostgreSQL migration/ownership/isolation/auth persistence and authenticated
SeaweedFS/browser/Node/Python transfers passed. Six existing conditional native OCR/
assessment/standalone profile cases remain skipped; the required module checks ran.
The image assembler and actual Docker failure/recovery script passed against the same
engine/DMS images. A preceding combined driver reached all MOD-I09 gates but exhausted
the daemon's default subnet pool in an unrelated legacy image helper; final compatibility
uses the same explicit source-mode separation already used by MOD-I08. No unowned
networks or database volumes were deleted.

## Limits and remaining ownership

Production Linux/Dokploy ingress/certificate validation, off-host recovery, production
HTTPS artifact retrieval with scoped local credentials, processing/workers/document
acceptance and accountable target sign-off remain wider IA/release gates. The existing
protected private cookie handover remains the supported fallback; the proposed scoped
public proof exchange is not implemented. Read-only status reports central evidence and
leaves current private release/workspace/processing/target verification with its owners;
it never infers universal readiness. MOD-I10 remains the next planned evidence/release
handoff increment.
