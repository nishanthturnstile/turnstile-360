# Coherent DMS backup, recovery and disposal

The selected small-profile procedure is defined in [architecture.md](../../architecture.md#backups-recovery-and-controlled-disposal).
Run these commands from a private Linux Docker operator host against the versioned standalone bundle. The short-lived recovery tool controls Docker through its socket and therefore has host Docker-administrator authority. Never mount that socket, root database credentials, backup repository credentials or the encryption key into the API/workers.

## Configure independent storage and key custody

Create a private `.dms-backup.json` in the installation root, mode 0600:

```json
{
  "repository": {
    "id": "customer-recovery",
    "endpoint": "https://backup.example.invalid",
    "bucket": "customer-dms-recovery",
    "prefix": "cohorts",
    "region": "us-east-1",
    "accessKeyId": "REPLACE_WITH_BACKUP_ONLY_ACCESS_KEY",
    "secretAccessKey": "REPLACE_WITH_BACKUP_ONLY_SECRET_KEY",
    "keyFile": "/run/recovery-key",
    "offHostAttested": true,
    "fixtureOnly": false
  },
  "retentionDays": 7
}
```

Provision the bucket separately on infrastructure that survives loss of the DMS host. A different DNS name alone is insufficient: the operator must verify independent failure domains, capacity, TLS trust and restoration access. Restrict its principal to listing this prefix, creating/reading its objects, and multipart creation/completion/abort. Runtime disposal has no backup-repository access. Disable automatic live-bucket expiry and versioning: this implementation deliberately refuses physical cleanup in Enabled or Suspended buckets because it does not persist S3 version IDs.

Generate a 32-byte random key into a mode-0600 file **outside the installation directory**, escrow it independently, and protect the installation/configuration backup as confidential. On the private Linux host, this creates a new key without overwriting an existing one:

```sh
(umask 077; set -C; head -c 32 /dev/urandom > /private/independent-dms-recovery.key)
```

Set `DMS_BACKUP_KEY_FILE` to that file's absolute path; the wrapper mounts it read-only at `/run/recovery-key`. Neither the key nor `.dms-backup.json` enters the cohort. Keep a separate copy of repository configuration and credentials. Losing the key makes the encrypted backup unrecoverable. File contents, passwords and keys must never enter command arguments or shell history. Use private JSON stdin files and remove them after use. A trusted private CA may require the operator to install its trust into the pinned tool image before producing the release inventory; do not bypass TLS verification.

## Capture and verify a recovery point

Schedule capture often enough to keep a successfully verified recovery point within 24 hours; a 12-hour cadence leaves retry/capture headroom. For each capture supply fresh verified authority-administrator **and** current DMS-operator credentials on stdin:

```sh
./dms backup < /private/backup-proof.json
```

The proof file contains `operatorEmail` and `operatorPassword`. The tool authenticates, drains mutators, records a durable source fence, disables the six application/maintenance logins and terminates their existing backends. PostgreSQL root and the temporary dedicated physical-replication identity remain private. It verifies every required object's size/hash, takes a PostgreSQL 18 plain base backup with streamed WAL, runs `pg_verifybackup`, and archives the stopped SeaweedFS **entire** data volume (master/filer metadata and chunks), scanner signatures and private installation configuration. It resumes the source before exporting exact pinned images and encrypting/uploading the six components. A pending catalog horizon is reserved before capture and blocks disposal even if the process fails or final authorization is lost. It can be sealed once after verification; failed captures retain the conservative horizon until its declared expiry. The encrypted manifest is uploaded last, after full remote ciphertext readback verification. It is the completion marker; a partial upload is never a recoverable point or disposal proof. The private catalog records completed cohorts and their retention horizons.

Capture is a maintenance outage proportional to the dataset. Run one maintenance operation at a time; do not run migrations, edit private configuration, rotate keys or import signatures concurrently. Reserve local temporary capacity for plaintext plus encrypted DB/storage/signatures/configuration/image archives; reserve remote space for the complete retained cohorts. Local temporary directories are private. Successful remote registration removes captured plaintext components; encrypted retry files remain under `.dms-backups/<id>`. Remove obsolete local retry files only after confirming the remote marker and independent restore access. Never make the captured configuration world-readable.

A transport failure after capture does not require recapturing data. Retry exactly that cohort with `./dms backup-upload` and stdin containing `operatorEmail`, `operatorPassword` and `backupId`. The same ciphertext is reused. Unknown acknowledgements are reconciled by remote hashes; existing conflicting keys are rejected.

A host/process crash during capture leaves `.dms-backup-fence.json`. Inspect the source and run `./dms backup-release` with `{}` on stdin (no backup key or repository access required) to restore its recorded role-login flags and previously running services. This is a trusted Docker recovery operation, not an HTTP endpoint. A conflicting CLOSED recovery identity is never opened. Inspect and remove stale command/backup lock directories only after proving no recovery controller remains active. Do not delete the fence file to bypass a failed release. A failed/partial capture must be discarded; only a completed local manifest supports upload retry.

Monitor backup lag using private operations evidence and the catalog. A successful legacy `operations-backup-report` is only an attestation; it does not authorize disposal. Investigate any recovery point older than 24 hours or failed remote verification. Keep all completed cohorts for at least seven days from their recovery point; use a repository lifecycle policy that expires **entire cohorts** no earlier than each manifest's `expiresAt`. Longer retention must be selected before capture. Do not extend an old cohort across a disposal decision or restore it beyond its declared expiry. Backups expire independently; live-object deletion does not mean immediate erasure from retained backups.

## Restore to an empty installation

Use an uninitialized copy of the **exact matching** sealed release, with its `images.lock`, independent repository configuration and key. Choose a new project name and an existing ingress network. Never restore into live/source volumes or over initialized environment files.

```sh
./dms recovery-restore < /private/restore-request.json
```

Input has `backupId`, `targetProject` (`thaarei-dms-...`) and `ingressNetwork`. All six encrypted components are authenticated before import. The tool requires empty new volumes, verifies the physical PostgreSQL base/WAL, restores DB role state and complete storage metadata/chunks, and fences the recovered database CLOSED. Sessions, outstanding verification/reset transactions, OAuth tokens and signing keys are invalidated; users, password hashes, clients, enrollment state, policies, grants and non-token encryption material are recovered. Credentials may have been revoked after the recovery point: review and rotate them before opening. A recovered signing epoch rejects old JWTs immediately. Every S3 signing role receives a new key pair, coherently written to private role configuration and IAM, so pre-recovery presigned URLs also stop working. The source must be isolated before assigning its canonical issuer/transfer origins to recovery ingress.

Broker data is deliberately not restored. Pending work receives new PostgreSQL generations under its existing execution/recovery/deadline budgets; inactive sources are cancelled, terminal work stays terminal, old dispatch authority is discarded, and only eligible queued work gets new dispatches. Reinitialize the broker configuration with the private `broker-init` tool. Do not replay a broker snapshot into the recovered project.

```sh
./dms recovery-verify < /private/verify-request.json
```

Input is `{ "backupId": "..." }`. This independently reads and hashes every restored object, checks exact inventory and PostgreSQL system identity, imports retained recovery horizons from authenticated remote manifests, and records verification while keeping recovery CLOSED. Verification is replayable. Corrupt/missing/extra objects fail closed; investigate or start another new empty restore project rather than opening it manually.

Use private `operator`, `authority-client`, `authority-keys`, `application` and `provision-user` commands to inspect/reestablish intended access. Review current administrators, DMS/work grants, consumer registrations/scopes, revoked credentials and disabled/deleted documents against independent operational records. Keep development/testing mail in Mailpit. Supply fresh administrator/operator proof, `backupId` and `accessReviewed: true` (the encryption key is no longer required after verification) to `./dms recovery-open`. The wrapper then permits `./dms up`. Recovered scanner databases may be stale; import current signed CVDs or run the supported updater before accepting new processing. Verify original/history downloads, extraction artifact hashes, grants, security state and a fresh pending-work execution before handing ingress over. A healthy PostgreSQL process alone is not recovery acceptance. After accepted handover and saved evidence, remove decrypted component archives and the unpacked configuration copy under the private `.dms-restore/<id>` directory when no longer needed. Retain its protected manifest and object inventory for verification/open replay, and keep independent repository/key custody intact.

Record capture age, bytes/object count, complete restore duration, hardware/CPU/memory/storage/network, and application acceptance. Compare with RPO ≤24 hours / RTO ≤4 hours for the declared operating dataset. A local fixture vault is explicitly `fixtureOnly: true`, never off-host evidence and cannot authorize production disposal. Target hardware, realistic retained volume and physical host-loss survival require I20 acceptance; do not extrapolate a tiny fixture result into a capacity guarantee.

## Controlled physical cleanup and retained history

Private `./dms recovery` accepts fresh operator proof plus:

- `disposal-request` with `documentId`: request disposal of a logically deleted document after its restore/recovery horizon. The document enters PURGING and no longer permits logical restore.
- `cleanup-request`: request bounded cleanup of expired terminal staging and abandoned extraction outputs; it cannot select live originals.
- `backup-inspect`: inspect the last 100 reserved/sealed recovery horizons and proof timestamps.
- `disposal-inspect`: inspect the last 100 durable object intents, retries and completion timestamps.

With the defaults, earliest original/accepted-artifact disposal is 39 days after soft deletion: 30-day restore plus seven-day DB recovery, one-day object lag and one-day margin. A current verified off-host recovery point within 24 hours is mandatory; any retained older cohort extending across the restore deadline blocks disposal. Every shared historical/restore reference must independently qualify. New original references are fenced once a durable deletion decision exists. Each invocation selects at most 100 objects; repeat requests to make bounded progress on large histories.

The coordinator handles at most five intents per tick, using a 120-second lease and 60-second retry delay. It checks bucket versioning, deletes only the persisted exact canonical key, and independently authenticates HEAD to confirm absence before atomically completing the intent and releasing bytes. Lost DELETE acknowledgements, unavailable HEAD, storage denial and retries never release quota early. Originals shared by versions remain charged once until their final physical removal. Requested/completed decisions are attributed; documents become PURGED only after every referenced physical intent completes. Minimal identity/version/security/artifact provenance and disposal tombstones remain; indexed text is removed for purged documents.

`operations-prune` has separate bounded retention: expired upload/lifecycle/enrollment receipts after their disclosed expiry plus one day, successful unreferenced attempts after 30 days, unreferenced successful/cancelled jobs and identifier-only audit/security history after 90 days, and unreferenced terminal batch details after 30 days. Expired enrollment keys are pruned after 90 days only when no receipt depends on them; active application identity mappings remain. It retains failed/unsupported work and all referenced security/artifact/version provenance. Batch bindings required by sessions survive as provenance. There is no implicit failure acknowledgement, legal-hold feature or immediate backup erasure. Do not manually delete database rows or configure storage lifecycle rules to substitute for these decisions.

For upgrades from I18, apply owned migrations and regenerate the cleanup storage IAM policy; copy the installation's **existing distinct cleanup key pair** into private `.env.coordinator` before starting the I19 coordinator. Never copy bootstrap-admin storage credentials into runtime. Run the upgrade/restore drill against an isolated copy before target rollout.
