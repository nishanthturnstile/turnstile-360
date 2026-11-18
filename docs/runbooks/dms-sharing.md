# Explicit application sharing

I12 implements FR-13.01–06. [Architecture](../../architecture.md#explicit-application-sharing-i12)
owns the authorization, accounting and locking design. Apply DMS migrations through 0034
using the existing private migration procedure before enabling this code. No auth migration,
new customer tenant, ownership transfer or implicit product permission is introduced.

The owner always retains document authority. Other applications need an explicit grant
and the API scope for each operation. Browser sessions and explorer Basic credentials
supply neither. All participants must be registered consumers in this installation;
new grant targets must be active. A disabled caller or disabled owner cannot use shared
reads/mutations. Existing grants remain stored while an application is disabled.

| Right         | Permitted surfaces                                                                                                       | Additional ceiling                                                      |
| ------------- | ------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| READ          | Document detail/list, explicit history/version status, upload status, current/historical original download               | `dms:documents:read`                                                    |
| EDIT_METADATA | PATCH title/metadata/tags; link references in the caller's source namespace, unlink its own references                   | `dms:documents:write` and current If-Match                              |
| ADD_VERSION   | Admit/replay a new binary candidate; complete/refresh/cancel its submitted uploads; new-version items in its own batches | `dms:documents:write`, current If-Match and applicable idempotency keys |

Rights are independent. An editor or contributor without READ cannot list/read/download
that document. The owner must supply the current revision and logical title/metadata to
an ADD_VERSION-only integration. Mutation receipts describe the accepted operation but
do not issue read authority. Owners can control all their document's sessions; a shared
contributor cannot control another application's sessions. READ does not grant audit,
permission management, binary restoration, lifecycle changes or reprocessing. The latter
surfaces remain owner/operator-only as they are implemented. Future content/search must
use the same resource evaluator rather than infer rights from common tenant membership.

Owner management:

- GET `/v1/documents/{documentId}/permissions` requires document read scope and ownership.
  It returns `{documentId,revision,grants}` and a strong ETag.
- PUT the same path requires document write scope, ownership and `If-Match` from the
  latest document/permissions read. Supply `{grants:[{applicationId,rights}]}`. This is a
  complete replacement, bounded to 64 distinct target applications with nonempty distinct
  rights from READ/EDIT_METADATA/ADD_VERSION. An empty array revokes all grants. Self,
  unknown, pending, disabled, worker and foreign-installation targets are rejected.
- Missing/malformed If-Match is 400; a stale logical revision is 412. Refetch and review
  before retrying. Each accepted replacement increments the logical revision and records
  an attributed `document.permissions-changed` audit/outbox event atomically.

For a backend request, keep token-bearing headers in a 0600 curl configuration file;
never put tokens/passwords in arguments or shell history. Put the nonsecret grant body
in a separate JSON file, for example:

```json
{
  "grants": [
    { "applicationId": "11111111-1111-4111-8111-111111111111", "rights": ["READ", "ADD_VERSION"] }
  ]
}
```

```sh
curl --config /private/dms-machine.curl --noproxy '*' --max-redirs 0 --fail-with-body \
  --request PUT --header 'Content-Type: application/json' --header 'If-Match: "7"' \
  --data-binary @/private/document-grants.json \
  https://dms.example.test/v1/documents/22222222-2222-4222-8222-222222222222/permissions
```

Fresh private operator management uses `dms:manage-operator`, protected JSON stdin and
the dedicated operator database role. Actions are `document-permissions-read` with
`documentId`, and `document-permissions-set` with `documentId`, `expectedRevision` and
`permissions` (the same replacement body). Both require `operatorEmail` and
`operatorPassword`. Authority administration alone is insufficient: the current tenant-bound
DMS operator grant is checked on every invocation. The bounded target validator holds
registration locks without granting the operator registration-update privilege. No HTTP
operator route or migration-role fallback exists for these actions. See the
[private operator procedure](dms-audit.md).

Ownership, object namespace and physical/work quota charges remain with the document
owner. Admission records separately retain the submitting application for idempotency
and controls. Batch identities stay with the submitter. Completion receipts are scoped to the actual caller and reference the upload by tenant/ID; current control rights are independently enforced, allowing both owner and contributor completion without sharing their receipts. A grant does not transfer ownership,
clone storage or expose another application's batch. All document events remain in the
owner's audit stream, attributed to the actual caller client or private operator subject.

References now include the creating `applicationId`; existing references are backfilled
to their owner. Shared editors may add their own tuples and remove only their own tuples;
the owner may remove any. Exact reference filters use the caller's application namespace.
Authorized document detail includes each reference's explicit source application identity.
A reference never grants access.

Grant writes serialize with public transactions before registration, document and batch
locks. Revocation stops subsequent live projections, new signed URLs, admission replays
and upload controls, including already issued machine tokens. Retrying a cursor still
runs current SQL authorization before selecting rows. Already issued storage capabilities
remain usable for their disclosed bounded expiry; delivered bytes cannot be recalled.
Accepted upload/assessment work remains owned by the owner and may finish after grant
revocation; the owner can cancel eligible sessions. A former contributor's manifest retains
its own descriptors, while live session projections require current document rights.
