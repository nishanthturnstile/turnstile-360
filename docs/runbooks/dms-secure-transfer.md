# Secure document transfer — first usable DMS increment

This increment implements secure transfer of `text/plain` originals with `secure-only`
assessment. It is not full DMS v1 or production acceptance. I14 adds [format-routed extraction](dms-extraction.md); this
runbook retains the initial text/secure-only transfer recipe; [I10](dms-versions.md) adds guarded version/history operations. The accepted boundaries and limits
are in [architecture.md](../../architecture.md); do not infer readiness from liveness.

Use the existing standalone foundation, authenticated storage, uploads, private work and
[assessment](dms-assessment.md) configuration. Add `deploy/compose.dms-downloads.yaml`
last in that explicit Compose list, preserving the installation's project/volume bindings.
Supply `.env.dms-download` from the checked-in read-signer template: only the existing
original-read identity's credential is needed. Never give the API snapshot, cleanup or
bootstrap storage credentials. Transfer ingress has public key IDs, never signing secrets.
Dokploy owns TLS. Keep private S3 and work/scanner/database interfaces off public ingress.
Apply owning DMS migrations through 0024 with the private migrator; no auth migration,
registration or policy initialization occurs automatically. No existing installation is
migrated by repository tests.

Configure the installed policy explicitly through the current DMS operator command, with
`text/plain` and `secure-only` enabled and the intended bounded budgets. Require current
scanner signatures and qualify unprivileged namespaces under the dedicated worker syscall
filter. Follow [admission](dms-admission.md), [uploads](dms-uploads.md) and
[work](dms-work.md) for separate identity/role setup and safe diagnostic commands.

The enrolled owning backend needs `dms:documents:write` for upload control and
`dms:documents:read` for status and `GET /v1/documents/{documentId}/download`.
Optional `dms:audit:read` permits its document audit. `GET /v1/capabilities` now projects
the configured installed type/profile and token's implemented operations; it does not
promise that each dependency is currently healthy.

Download returns JSON containing a GET capability, document/version IDs, size, measured
SHA-256, safe display filename and expiry. It never redirects to storage. It selects the current version by default; I10 also permits explicit available history.
Both require an active owned document and the exact protected candidate with a still-valid
accepted security assessment. Unknown/unowned IDs return 404;
unavailable owned originals return 409. I10 permits explicit `versionId` selection for available history under the same live
policy; other unsupported query parameters return 400. A disabled application,
insufficient current scope or unrelated application cannot obtain new authority.

GET capabilities last at most 120 seconds. Signed responses force attachment disposition,
a sanitized ASCII/UTF-8 filename, `application/octet-stream`, `nosniff`, no-store and
no-referrer. A single `Range` is supported (`bytes=0-99`, `bytes=100-`, `bytes=-100`);
multiple ranges are rejected. Transfers go directly through the signed ingress, without
application cookies or service credentials. Treat the capability itself as a secret:
keep it out of arguments, logs, analytics, browser storage and persistent receipts.

Disablement, access revocation or explicit security invalidation stops new issuance.
A URL issued beforehand can remain usable until its disclosed expiry, including after
invalidation. No immediate revocation of delivered bytes or unexpired URLs is promised.
Signature freshness gates new publication, not previously accepted originals; enrichment
outages do not invalidate an available original. Every issuance records
`document.download-authorized` plus identifier-only outbox intent. This records authorization,
not an assertion that the bytes were actually fetched. Transfer bodies/URLs are not audited.

For an independent Python-stdlib backend, create a fresh protected token file using
`examples/dms/backend.py token --token-file /protected/token.json`. Its protected stdin
configuration may request these current machine scopes:

```json
{
  "issuer": "https://dms.example.invalid/identity",
  "resource": "https://dms.example.invalid/v1",
  "clientId": "backend-client",
  "clientSecret": "REPLACE_IN_PROTECTED_FILE",
  "scopes": ["dms:capabilities:read", "dms:documents:read", "dms:documents:write"]
}
```

Then prepare a protected transfer configuration (no credential in arguments):

```json
{
  "resource": "https://dms.example.invalid/v1",
  "transferOrigin": "https://files.example.invalid",
  "tokenFile": "/protected/token.json",
  "idempotencyKey": "secure-transfer-example-0001"
}
```

```sh
python examples/dms/secure_transfer.py /protected/report.txt < /protected/transfer.json
```

The example calls begin, sends an exact create-only PUT, records completion intent,
polls for authoritative assessment/publication, obtains the current download capability,
and checks the complete downloaded size and SHA-256 against both original input and
server evidence. Keep the same operation key and unchanged input when retrying; a repeated
create-only PUT may return 412 and the example resumes that session. It prints only IDs, measured size/hash and the verified outcome. It rejects
redirects, ambient proxies, a different transfer origin and oversized/incomplete bytes.
Use a fresh short-lived token if a long or failed operation exhausts its lifetime; inspect
existing session state before creating another operation.

Disposable qualification:

```sh
DMS_TEST_NATIVE_ASSESSMENT=true node scripts/test-auth-database.mjs --dms-admission
```

The opt-in lane downloads current official signatures to disposable storage and runs a
real independent backend over HTTP, pinned S3 storage, confirmed RabbitMQ publication,
the production Celery scanner task, native ClamAV, isolated text validation, fenced
publication and the returned GET capability. Default integration covers current access,
quarantine/invalidation, signing rollback, race fencing and the bounded expiry of a URL
after disablement. Exact production-image and target acceptance remain separate.
