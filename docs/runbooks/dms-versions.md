# Version history and binary restoration

The [architecture](../../architecture.md) owns version numbering, physical reference
accounting, current-pointer ordering and security policy. I10 extends the secure-transfer
increment; it does not add other format families, metadata editing, sharing or physical
purge. The installed matrix remains `text/plain` + `secure-only`.

Apply DMS migrations through 0029 with the private migrator and deploy matching API and
coordinator images. Existing installation/project/volume bindings and protected credentials
must be preserved. No auth migration, customer initialization or automatic deployment is
performed by repository verification. Keep the I09 original-read signer configured on
the API: restoration checks protected object integrity using that read-only identity.
The coordinator already uses its separate original-read/snapshot roles. Neither API nor
worker gains cleanup, general storage or publication privileges.

An enrolled owner backend uses `dms:documents:read` for history/status/download and
`dms:documents:write` for replacement uploads. Binary restoration requires both.
Same-tenant membership and external business references grant no authority. Application
sharing remains I12. Disabled registrations and reduced current scopes stop new operations.

- `GET /v1/documents/{id}/versions?limit=20&cursor=...` returns descending immutable binary
  revision numbers with current security/availability, upload status/ID, current-pointer
  flag, download eligibility and source-version provenance. Cursors are signed and bound
  to the current installation/application/document; each page reauthorizes.
- `GET /v1/documents/{id}/versions/{versionId}` returns that owned version's status.
- `GET /v1/documents/{id}/download` uses current; `?versionId={id}` explicitly selects
  available history under the same live policy and short signed-URL rules as I09.
- `POST /v1/documents/{id}/versions/uploads` admits a replacement and returns the normal
  upload/session/PUT contract. Send `If-Match` with the quoted current document revision
  and a stable `Idempotency-Key`. The body is the normal upload descriptor; retain the
  current logical title and metadata. A replacement cannot silently edit those fields.
- `POST /v1/documents/{id}/versions/{versionId}/restore` with body
  `{"profile":"secure-only"}`, `If-Match` and `Idempotency-Key` returns 202 for a new
  candidate/session, with no PUT capability. An identical retry preserves its identity
  and returns current status, even after the document revision advances.

Read the document's current ETag before a new guarded operation. A stale precondition
returns 412; changed input under the same operation key returns 409. Retry the exact
operation after an ambiguous response rather than allocating another revision. Failed
candidates remain visible and may leave gaps in available history. Neither metadata
inspection nor restoration changes the logical document identity or restores old metadata.

Current valid bytes remain available while a new candidate is uploaded or assessed.
Publication advances the pointer only for a higher binary number: if v3 passes before
v2, v2 can become available in history without replacing v3. No older version is selected
automatically when the current original becomes unavailable.

A binary restore creates a new highest-numbered candidate referencing the exact protected
historical object. It first checks existence/ETag/size and current admission policy, then
requires a new streamed hash/type/scanner/isolated-policy pass with current signatures.
Historical approval is never copied into the new assessment. Previously invalidated bytes
may be explicitly reassessed this way, but remain unavailable until the new candidate
passes. Never-published/rejected candidates cannot supply historical restoration authority.

A restore reserves normal bounded work/scratch capacity but no second staging/original
allocation. The original physical charge stays with the retained source; immutable source
references and foreign keys protect it before and after assessment begins. The coordinator
checks the captured invalidation generation before materializing work. A subsequent
invalidation or negative assessment closes every version sharing that object and prevents
stale attempts from publishing. The restore's own zero-byte accounting settles/releases
only its work reservation; it never frees a live historical original. Reference-aware
physical collection follows the private [reference/recovery-aware disposal policy](dms-recovery.md).

New-version batch items use the existing manifest's `operation:"new-version"`, with
`documentId` and `expectedRevision` in the descriptor. Start that item through the version
upload route, adding `batchId`/`itemId` to the body and matching its expected revision in
`If-Match`. A manifest allocates nothing; binding/admission is per file, and retries bind
at most one session. Other unstarted/failed items cannot undo an available replacement.

For independent HTTP testing, use fresh backend machine credentials from the
[secure transfer runbook](dms-secure-transfer.md). Keep curl authorization headers,
idempotency key, quoted If-Match and response output paths in a protected 0600 curl config;
never place credentials or signed URLs in arguments. Configure `noproxy="*"` and do not
follow redirects. Store capability-bearing responses only in temporary protected files.

```sh
curl --config /protected/read-request.conf \
  https://dms.example.invalid/v1/documents/DOCUMENT_ID/versions
curl --config /protected/version-request.conf \
  --data-binary @/protected/version-descriptor.json \
  https://dms.example.invalid/v1/documents/DOCUMENT_ID/versions/uploads
curl --config /protected/restore-request.conf \
  --data-binary @/protected/restore-profile.json \
  https://dms.example.invalid/v1/documents/DOCUMENT_ID/versions/VERSION_ID/restore
```

The replacement's PUT/completion/poll procedure is unchanged from I09; restoration needs
only polling for its returned session. Inspect historical/current SHA-256 after GET and
never treat job completion, an old signature timestamp, a HEAD or an admission receipt as
security approval. `document.version-restored` audits candidate creation; actual publication
and download issuance remain separate bounded events.

Explicit disposable native qualification (downloads current official signatures):

```sh
DMS_TEST_NATIVE_ASSESSMENT=true node scripts/test-auth-database.mjs --dms-admission
```

The native lane extends the independent backend chain with actual replacement/restored
assessment by the production Celery task and verified historical/current retrieval. The
owning database lane covers publication ordering, reference accounting, stale/conflicting
operations, invalidation races, missing historical objects, batch binding and isolation.
Source component qualification and offline image checks remain separate from target rollout.
