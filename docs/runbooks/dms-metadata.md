# Document metadata, tags and external references

I11 implements FR-12.01–07. [Architecture](../../architecture.md#metadata-tags-and-references-i11)
owns limits and policy. Migrate the owning DMS schema through 0031 before enabling this code.
No auth migration is required. Use the same private migration procedure as the
[standalone runbook](../deployment/customer_deployment_guide.md#standalone-dms); this work does not migrate an installed service.

Every operation requires a current active machine registration and existing document
ownership or the operation-specific explicit grant. Reads require `dms:documents:read`; mutations require `dms:documents:write`.
References do not grant access. I12 adds explicit sharing under the [sharing policy](dms-sharing.md).

| Method | Path under `/v1`                                   | Body / result                                                                                                    |
| ------ | -------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| PATCH  | `/documents/{documentId}`                          | Optional `title`, `metadata`, `tags`; at least one field. Returns document with new ETag.                        |
| POST   | `/documents/{documentId}/references`               | `{namespace,type,externalId}`; returns document, including generated reference IDs and creating application IDs. |
| DELETE | `/documents/{documentId}/references/{referenceId}` | No body; returns updated document.                                                                               |
| GET    | `/documents/{documentId}`                          | Current title, tags, metadata, references, logical revision and binary availability.                             |
| GET    | `/documents`                                       | Bounded summaries; optional exact filters described below.                                                       |

Mutations require strong `If-Match: "<revision>"` from the latest read. Missing/malformed
headers return 400; stale revisions return 412. Refetch and review before retrying a
conflict. PATCH replaces only supplied fields; metadata and tags are replaced as whole
values, not merged. `{metadata:{}}` and `{tags:[]}` clear those fields. Original filename
is immutable presentation data; PATCH cannot edit it. Accepted mutations increment only
the logical revision and atomically append identifier-only audit/outbox events. They
never change original bytes, allocate a binary revision or schedule processing.

A duplicate reference tuple on the same document returns the current document without
a revision/audit change, after the expected-revision check. A missing unlink target
returns 404. A reference tuple may link multiple documents. The tuple is scoped to the
fixed installation and registered owner application, with `namespace` as its source-system
label. Identical labels/types/IDs in unrelated applications remain independent. Business
record existence and business rights are the consumer's responsibility. IDs are opaque;
the DMS does not dereference URLs or contact source systems.

List supports exact case-sensitive `title`, `fileName`, `tag` and a complete triple of
`referenceNamespace`, `referenceType`, `referenceId`. Combine supplied filters with AND;
a tag matches any document containing that exact tag, and a reference triple matches one
reference object. Partial reference triples and arbitrary metadata filters return 400.
Results use created-time/UUID descending order, limit 1–50, and signed cursors bound to
installation, application and all filters. Keep filters unchanged across pages. This is
live pagination, not a snapshot of mutable filter values.

The independent stdlib example links and unlinks multiple references over authenticated
HTTP without importing product contracts. Obtain a short-lived machine token using the
[backend guide](dms-api-explorer.md). Put the following input, including the token, in a
0600 file; use stdin so credentials never enter arguments or shell history:

```json
{
  "resource": "https://dms.example.test/v1",
  "accessToken": "<short-lived machine JWT>",
  "documentId": "11111111-1111-4111-8111-111111111111",
  "edit": {
    "title": "Invoice",
    "tags": ["finance"],
    "metadata": { "amount": 42, "approved": true }
  },
  "references": [
    { "namespace": "erp", "type": "invoice", "externalId": "INV-42" },
    { "namespace": "crm", "type": "account", "externalId": "ACCOUNT-7" }
  ]
}
```

```sh
pnpm --filter @thaarei/dms-processing exec uv run --locked python ../../examples/dms/metadata.py < /private/metadata-input.json
```

The example intentionally changes title/tags/metadata and removes the references it links;
use a disposable document for this round trip. Use previously unlinked tuples. It bypasses
environment proxies, rejects redirects, bounds responses and prints only a nonsecret
receipt. On a partial failure, read the document to reconcile before a new command.
