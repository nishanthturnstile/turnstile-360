# DMS assessment and publication

The authoritative design and limits are in [architecture.md](../../architecture.md).
I08 initially staged only `text/plain` with the `secure-only` profile. I14 now adds
[format-routed structural assessment and extraction](dms-extraction.md). At the initial
I08 boundary other families remained
unavailable, including PDF, Office, spreadsheet, image, email and archive formats.
UTF-8 validation does not execute markup or follow embedded links. Security checks
are mandatory even when no enrichment is requested; enrichment remains independent.

The coordinator reserves one candidate destination in PostgreSQL before source-conditional
copying. That exact reference is immutable. Copies with ambiguous outcomes and crashed
copy intents remain unavailable and retain capacity; their keys remain recorded for
later recovery-aware cleanup. No automatic copy overwrite or physical purge occurs.
The scanner receives a two-minute read capability only after claiming its current job.
Streamed bytes determine SHA-256 and measured size; S3 ETags are concurrency tokens.
The dedicated ClamAV daemon must have signatures no more than 48 hours old, with explicit
limit/encryption alerts. A clean response alone cannot bypass isolated format inspection.

Plain text runs in a fresh Bubblewrap user/mount/PID/network namespace, with no inherited
environment, no application mounts and only bounded stdin. The supervisor applies
256 MiB address-space, ten CPU seconds, 15 seconds wall time and bounded output/file
limits. Missing namespaces, scanner outage, stale signatures or incomplete coverage
produce an inconclusive result. No ordinary subprocess fallback exists.

Add `deploy/compose.dms-assessment.yaml` to the explicit existing DMS/storage/uploads/work
Compose file list while preserving the installation project/volume bindings. This adds
an isolated scanner network and a separate signature updater with outbound access.
The scanner mounts only read-only signatures; it has no application credentials or
stored document mounts. Wait for official databases and ClamAV readiness before uploads.
Do not place credentials in command arguments. Existing credentials and installations
are not initialized or changed by this repository work.

The scanner overlay uses the vendored Moby default seccomp filter with only namespace/
mount setup calls additionally allowed; the non-root supervisor still has no capabilities.
The kernel must support unprivileged user namespaces. Qualify the exact
non-root worker image and host confinement before enabling uploads; an unavailable
sandbox must remain a closed security gate. Do not replace it with unrestricted parsing.

For explicit disposable native qualification (current official signatures require internet):

```sh
pnpm --filter @thaarei/dms-processing exec uv run --locked python tests/assessment_native.py
pnpm --filter @thaarei/dms-processing exec uv run --locked pytest tests/test_assessment.py -q
```

To qualify native evidence acceptance over real storage/private HTTP/PostgreSQL as well:

```sh
DMS_TEST_NATIVE_ASSESSMENT=true node scripts/test-auth-database.mjs --dms-admission
```

This opt-in lane uses actual fresh ClamAV evidence for the protected S3 candidate and
keeps the attempt alive during native setup; ordinary database tests use bounded contract
fixtures for the policy/fencing rejection matrix.

The first command uses a temporary signature directory and a pinned, network-isolated
ClamAV daemon. It checks native EICAR detection, clean text, streamed hashes, malformed
UTF-8, hash mismatch and outage. PostgreSQL/private HTTP integration separately checks
lease fencing, immutable selection, signature-freshness rejection, duplicate acceptance,
atomic audit/publication, accounting and explicit invalidation. Neither replaces exact
installed-image/host qualification or customer rollout acceptance.

Security evidence and publication are scanner-role-only. Extractor results cannot assert
security approval. Publication exposes the protected candidate without another copy,
advancing the current pointer only for a higher binary revision. A later invalidation
makes the original unavailable without silently selecting an older version. Public
content capabilities are supplied by [I09](dms-secure-transfer.md); a current pointer
alone does not authorize download.
