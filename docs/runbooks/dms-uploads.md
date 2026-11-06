# Upload and batch lifecycle

The [architecture](../../architecture.md#upload-and-batch-lifecycle-foundation-i06)
owns the protocol, state machines, locking, limits and deployment topology. Apply DMS
migrations through 0012 using the existing private migration procedure. I06 installs
control routes and durable completion intent. Coordinator verification, security assessment
and publication are supplied by the owning later implementations. I08–I14 install their
security and extraction paths; capability discovery intersects that catalog with current
operator policy. Configuration cannot enable an uninstalled path.

Use an enrolled backend machine token with `dms:documents:write` for mutation and
`dms:documents:read` for status. Every call, including retries and refresh, checks current
registration, scopes and resource ownership. Cookie sessions and explorer access grant
no machine authority. The explorer remains read-only; authenticated upload and batch
status GETs are available there. Private operators can use `upload-inspect` plus `uploadId`
or `batch-inspect` plus `batchId`, optional `limit` (1–50) and `after` (the previous
`nextAfter` ordinal). They use the existing fresh-identity JSON-stdin command and the
operator role, never browser credentials, migration authority or upload signing keys.

Configure the [I04 private storage boundary](dms-storage.md) and [admission policy/capacity](dms-admission.md)
first. Only the upload-role staging signing key belongs in the DMS API. The credential-free
transfer ingress receives signer IDs and configuration; bootstrap, snapshot and cleanup
secrets stay in their private processes. The optional standalone network overlay uses:

```sh
docker compose -f deploy/compose.dms.yaml -f deploy/compose.storage.yaml \
  -f deploy/compose.dms-uploads.yaml config --quiet
```

Create protected `.env.dms-upload` from [the signer template](../../deploy/dms-upload.env.example).
The overlay joins the API to the private storage network while retaining its database
network. It starts no coordinator or processor and publishes no host ports. Apply it only
through the installation's explicit deployment procedure. Dokploy routes the control and
transfer hosts separately and owns TLS. No existing installation is adopted by this code.

## Single-file protocol

POST `/v1/uploads` with an `Idempotency-Key` (16–128 ASCII letters, digits, `_` or `-`),
JSON Content-Type, and a bounded descriptor:

```json
{
  "title": "Inspection report",
  "fileName": "report.txt",
  "size": 10,
  "contentType": "text/plain",
  "profile": "secure-only",
  "metadata": { "category": "inspection" }
}
```

Optional `sha256` is exactly 64 lowercase hexadecimal characters; it is a declared
expectation for later trusted verification. An S3 ETag is not that checksum. The API
rejects storage destinations, multipart/resume instructions and unknown fields.
Metadata is at most 16 KiB; the full upload JSON permits 32 KiB for envelope overhead.
No file bytes enter the control API.

A new session returns 201 with Location, stable `operationId` and `session`, plus a
temporary `transfer` object. Identical retries return 200 with the same IDs and current
state, after authorization. Changed descriptors conflict. Receipts last 24 hours;
expired receipts return 410. Only an eligible session gets a newly minted capability.
Responses are `Cache-Control: private, no-store`; never log or persist the capability URL
in consumer audit/analytics. Keep local response files mode 0600 and remove them promptly.

For command-line manual testing, put Authorization and a stable Idempotency-Key in a
mode-0600 curl configuration file, not arguments or shell history. A descriptor file has
the nonsecret JSON above. The configured control origin must be canonical HTTPS or an
explicit loopback fixture. Disable proxies and redirects for credential-bearing calls:

```sh
umask 077
curl --disable --noproxy '*' --silent --show-error --fail --max-time 15 --config /protected/dms-http.conf \
  --request POST --header 'Content-Type: application/json' \
  --data-binary @/protected/descriptor.json \
  --output /protected/session.json https://dms.example.test/v1/uploads
```

Check the HTTP status before consuming the response. A 403 policy denial, 429 admission
pressure or 503 unavailable capacity/catalog creates no hidden upload. Respect Retry-After
where present. The protected token configuration should use both document scopes and may
be reused only within the machine token's short lifetime.

Transfer exactly `transfer.size` bytes using `transfer.method` PUT, `Content-Type` and
`If-None-Match: *` from `transfer.headers`, with the exact Content-Length. Browsers must
use a known-size File/Blob and let the browser generate Content-Length:

```js
// The consumer backend authenticates its user, obtains the DMS session with its server
// machine token, and returns only this short-lived transfer object to that user.
const response = await fetch(transfer.url, {
  method: 'PUT',
  headers: transfer.headers,
  body: file,
  credentials: 'omit',
  redirect: 'error',
});
// A 412 may mean an earlier ambiguous PUT succeeded. Inspect and complete this same
// session through the consumer backend; do not overwrite or allocate another document.
```

The independent [Python transfer program](../../examples/dms/transfer.py) takes capability
JSON through stdin, never a URL argument, and sends the same exact known-size contract:

```sh
python -c 'import json,sys; print(json.dumps(json.load(sys.stdin)["transfer"]))' \
  < /protected/session.json | python examples/dms/transfer.py /protected/report.txt
```

Inspect GET `/v1/uploads/{uploadId}` after an ambiguous/repeated PUT. It returns current
session state, not a claim that an object has already been verified. POST
`/v1/uploads/{uploadId}/complete` with `{}` and an idempotency key records completion
intent and returns 202, Location and Retry-After 2. Poll that status location through the
backend. At the initial I06 boundary security stayed PENDING, availability CANDIDATE and
processing NOT_SCHEDULED in
I06; intent acceptance does not make the logical document downloadable/searchable.
The I07 coordinator observes the exact persisted staging reference without this callback
and can report OBJECT_VERIFIED from size/type metadata. Streamed checksum, candidate
assessment and publication are implemented by [I08](dms-assessment.md); see also
[private work](dms-work.md).

POST `/v1/uploads/{uploadId}/refresh` with `{}` rechecks current access and policy and
returns a new capability only for an eligible INITIATED session before completion intent.
Each PUT capability lasts at most 15 minutes and never beyond the session deadline.
DELETE `/v1/uploads/{uploadId}` cancels eligible pending work. Cancellation can supersede
completion intent until trusted processing advances the session; a completion after
cancellation returns the recorded terminal outcome. Expiry, cancellation and replay never
revive a session. No cancellation path deletes a document or releases live-capability/
retained-byte reservations. Trusted cleanup owns physical removal and reconciliation.

## Independent batch items

POST `/v1/upload-batches` with a new idempotency key and `items`, each containing immutable
`itemId`, `operation: "create"`, and the same file `descriptor` above. A manifest has
1–100 unique IDs and at most 256 KiB encoded JSON; the full control envelope permits
260 KiB. Creation returns a stable operation/batch identity, creates no document or upload,
reserves no physical bytes and grants no transfer authority. Limits are 4 open batches per
application, 16 per installation and a 24-hour start window.

Admit an item separately with ordinary POST `/v1/uploads`, adding its `batchId` and
`itemId` to the unchanged descriptor. Keep a stable upload idempotency key for that item.
The descriptor must match the manifest and an item binds to one session/candidate only;
another key cannot allocate a second session. New-version manifest intent can be recorded,
but starting it and the version-upload route remain gated by I11's versioning implementation.

GET `/v1/upload-batches/{batchId}?limit=20` reports whole-batch stage counts and at most
50 item outcomes. Follow its opaque `nextCursor`; it is bound to this owner and batch.
Unstarted items can show a bounded admission error and retry hint. Capacity errors affect
that item only; retry when eligible without restarting successful items. The listing is a
live view and each page reauthorizes.

POST `/v1/upload-batches/{batchId}/close` with `{}` and an idempotency key prevents new
sessions and settles unstarted items. Existing sessions keep their own deadlines.
DELETE `/v1/upload-batches/{batchId}` additionally cancels eligible pending sessions.
Expiry also closes the start window. These operations share the admission batch lock,
so a racing begin either binds visibly before closure or is refused. Neither batch
cancellation nor closure deletes published files or implies that every item succeeded.
Archive import, multipart and resumable transfer remain outside this protocol.

Current security and independent searchable processing outcomes follow the
[assessment](dms-assessment.md) and [I14 extraction](dms-extraction.md) runbooks.
