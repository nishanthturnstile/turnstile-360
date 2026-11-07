# DMS qualification and handover

This is the I20 local qualification and controlled target-acceptance procedure. The technical design, format limits, capacity and recovery policy are in [architecture.md](../../architecture.md). Product behavior remains in the [requirements](../dms/headless_dms_functionality_requirements_v1.md); no customer deployment, data migration or Turnstile business work is authorized by a local pass.

## Exact local candidate

Use pinned Node/pnpm/Python/uv and the supported Docker Engine/Compose versions. Keep private evidence outside `/tmp`, under an ignored mode-0700 directory. Use Mailpit for development/testing. Provision real customer SMTP only as a separately accepted target action.

1. Run `pnpm check`, `pnpm build`, `pnpm test`, and `pnpm test:integration`; retain command outcomes and source fingerprint. API e2e/static success does not replace a container pass. Native skips remain explicit.
2. Assemble the complete bundle with `pnpm release:dms --output <new-private-candidate> --syft <checksum-verified-pinned-syft> --structured`. The [distribution runbook](dms-distribution.md) describes the pinned tool, source contacts, SBOM/licenses and signature updates. A standard-only candidate cannot claim enabled structured processing.
3. Generate the owned printed OCR input with `pnpm --filter @thaarei/dms-processing exec uv run --locked python tests/make_ocr_fixture.py --output <absolute-private-path>/printed.png`. Use current official signed main/daily/bytecode CVDs from the supported importer. Do not waive signature freshness.
4. Run `pnpm qualify:dms --bundle <candidate>/bundle --signatures-dir <private-cvd-directory> --ocr-fixture <printed.png> --previous-image <exact-previous-api-tag> --output <new-private-evidence-directory>`. It checks the source and exact image/contract/dependency inventory, runs workspace and DMS-only lanes, then the real distribution/consumer/recovery/rollback journey.
5. Save the redacted requirement ledger and report. Raw logs, credentials, signed URLs, fixture documents, escrow keys and configuration stay private and never enter commits or a release archive. The wrapper rejects a source change or altered image inventory during qualification. `SHA256SUMS` must verify before transfer.

`docs/qualification/dms-i20-ledger.json` enumerates every current FR/NFR and links its owning evidence. An owning-suite reference is group coverage, not an invented one-test-per-requirement claim. Automated, manual, deployed and target-accepted states are separate. The generated exact-candidate report records actual executed commands, fixture outcomes, model/profile selection, measured mix and remaining acceptance work.

## Independent applications and manual journey

[The independent Node consumer](../../examples/dms/qualification.mjs) imports only Node standard libraries. Its container receives only two application credential/enrollment inputs, synthetic files, the public fixture CA and a result directory; it has no database, operator input, worker secrets, Docker socket or private work network. It renews audience-bound tokens and uses canonical HTTPS control/direct-transfer endpoints. Private queue/resource observation runs separately and cannot authorize consumer operations.

For a manual journey use the [explorer](dms-api-explorer.md) and independent [Python backend](../../examples/dms/backend.py), [transfer](../../examples/dms/transfer.py), [metadata](../../examples/dms/metadata.py), [results](../../examples/dms/results.py) and [discovery](../../examples/dms/discovery.py) recipes. Keep secrets in protected stdin/files and never Swagger or arguments. Record the operator, date, exact candidate hash and redacted outcome for each step:

- Follow [standalone bootstrap](dms-standalone.md), then provision distinct A/B machine identities and pending registrations. Enroll each with its own one-use bound key and remove the enrollment input after use.
- Obtain/renew a short-lived token; authorize `/docs` with that token only. Verify capabilities and one invalid token/scope request. Independent consumer-owned PKCE login/reset/logout is covered by the separate DMS-only authority fixture; no Turnstile app is required.
- Upload with exact-size create-only direct PUT, complete and poll. Confirm unavailable/rejected files never receive ordinary download authority. Use the [browser transfer example](../../examples/dms/secure_transfer.py) and existing storage browser fixture for CORS/header-bound behavior.
- Download and verify bytes/hash; edit metadata/tags/references with current revision. Add a version and restore history as a new revision; the original bytes remain immutable.
- Verify B is denied across metadata/history/content/search before sharing, READ permits those reads but no edit, EDIT_METADATA permits only that edit, and revocation immediately hides new capabilities/results.
- Read authorized audit, reprocess through an explicit bounded command, search accepted content, delete/restore within the logical window, and inspect processing readiness/queue age. Use [lifecycle](dms-lifecycle.md), [results](dms-results.md), [sharing](dms-sharing.md) and [work](dms-work.md) runbooks.
- Rotate/revoke credentials and work grants; demonstrate real worker/broker restart and a coherent isolated recovery. Keep the requested/completed disposal proof and quota outcomes; never substitute volume/bucket deletion for [controlled disposal](dms-recovery.md).

Automated execution does not set `manualTested: true`. Complete and sign the target checklist only after the actual human/operator journey.

## Synthetic operating profile and capacity report

The local profile uses 24 files: eight small text, eight roughly 64-KiB text, four 512-row CSV, two one-page native PDFs, and two one-page clean printed English PNGs. OCR share is 2/24; structured share is zero in this timed mix. The optional offline structured adapter has its own on/off/result test. Office, spreadsheet, RTF and email families run separately after the timed mix and report genuine PARTIAL outcomes and attributable artifact hashes.

Arrivals begin with a four-file burst, then a nominal 200,000/(22×8×60) documents/minute arrival interval, bounded by four active documents. Backpressure is counted rather than hidden. The report records actual achieved documents/minute; a short sample does not prove a sustained 200,000-document month. It does not infer capacity for a different page count, OCR/structured share, size mix, burst or working window.

Metadata p50/p95/max, control latency, completion-to-original availability, accepted-result duration and index visibility lag are distinct. Private read-only queue observations measure oldest pending age and first-attempt queue wait; sampled container CPU/RSS and scratch are reported with sample cadence and gaps. These are sampled container values, not exact per-process high-water marks or CPU-seconds/page. A p95 miss is a failed latency objective for this declared local workload; record it and remediate or narrow an unsupported capacity claim explicitly.

The target capacity worksheet must declare actual days/hours, files/pages/sizes per class, peak arrivals, OCR/structured fraction, allowed queue/index delay, storage/version/backup growth and hardware/network. Use the architecture sizing formula; no cache, search cluster or larger-host purchase is inferred from a short benchmark.

## Compatible upgrades and rollback

Only exact reviewed image/schema pairs are supported. The current merged candidate includes central deployment enforcement and owning migrations through 0059. The isolated qualification upgrades an I19 API installation while closed to customer traffic, then installs a genuine fixture-signed approval through its owning migrator. APIs retain production verification and local authorization. Central pairing/approval/reporting is independently exercised by workspace HTTPS integration. A coherent restore first proves HTTP DEPLOYMENT_RESTRICTED under an independently replaced marker, then requires a fresh fixture-signed epoch before business checks resume. This fixture repair is not evidence of a manual central rebind journey. No prior published enforcing release is available for historical application downgrade qualification; the unenforced I19 upgrade source is explicitly not a rollback target. Candidate restart/forward and quarantined coherent recovery are the qualified local recovery boundaries. This is the recorded compatible application boundary, not a generic guarantee for future releases.

Before target upgrade: verify a fresh off-host coherent backup and matching old bundle/images/keys, isolate a restore and confirm access, freeze private operations, review forward SQL and the allowed rollback boundary, and record a handover owner and maintenance window. Run migrations explicitly with private maintenance authority; never synchronize schema on startup.

If the new application fails within the tested compatible boundary, stop new work, restore the exact prior application image set/configuration, retain compatible database/storage state and verify identity/originals/readiness before opening ingress. Never apply guessed down migrations or roll a database alone ahead of its object coverage. For incompatible schema/data changes, restore the complete old coherent cohort into a distinct empty CLOSED installation using its exact old release, perform integrity/access review, then hand ingress over. Retain the failed target for diagnosis under protected access; do not overwrite its live volumes during rehearsal.

## Controlled target acceptance

Copy [the acceptance template](../qualification/dms-target-acceptance.template.json) to protected target records. Local automation cannot fill customer approvals. Required evidence includes:

- Canonical identity/resource/transfer origins, Dokploy TLS/proxy/cookie behavior, private networks and no accidental host publishing; target clock stability and secret delivery.
- One installation tenant, verified intended administrator and explicit DMS/work grants, separate application credentials/scopes/namespaces, disabled/revoked access checks and signed human/operator review.
- Actual storage/scratch/backup capacity, independent off-host repository and key escrow, measured recoverable volume/hardware/network and RPO/RTO drill including hashes/history/grants/pending work.
- Declared operating mix and sustained/burst measurements meeting accepted latency/backlog/window objectives. A local synthetic sample is not this evidence.
- Fresh approved ClamAV signatures, offline languages/models for enabled profiles, documented updates and actual namespace/credential/network isolation.
- Exact image/dependency/model/contract inventory, frozen source revision, license/notices/covered-source review by the accountable owner, independent source-request contacts and retention obligation.
- Fresh install, current-client compatibility, preserved-data upgrade, supported rollback and monitored post-upgrade journey. Record incident ownership and restore/rollback decision authority.

Record separate implementation, automated test, manual test, deployed and target-accepted facts. Require named owner/security/operations acceptance, legal/distribution review and a dated final release decision. Do not put passwords, tokens, signed URLs or customer data in the template. The installed owner-test environment remains outside this qualification until an explicit target action is authorized.
