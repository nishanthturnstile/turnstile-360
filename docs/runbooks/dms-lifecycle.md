# Soft deletion and logical restoration

I13 implements FR-14.01–08. [Architecture](../../architecture.md#soft-deletion-and-logical-restore-i13)
owns limits, states and authority. Migrate the owning DMS schema through 0036 before
running this code. Follow the private migration procedure in the
[standalone runbook](dms-standalone.md). No auth migration is required; this implementation
has not migrated or deployed an installed service.

Only the owning application or a freshly authenticated currently authorized DMS operator
can administer lifecycle. Shared READ/EDIT_METADATA/ADD_VERSION rights never confer this
authority. Owner inspection requires `dms:documents:read`; mutations additionally require
`dms:documents:write` as the relevant API ceiling. Public requests cannot select a tenant,
transfer ownership, choose a generation, supply worker results or invoke physical purge.

| Method | Path under `/v1`                    | Behavior                                                                                                             |
| ------ | ----------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| GET    | `/documents/{documentId}/lifecycle` | Owner-only state, generation, revision/ETag, deadline and restoration counts.                                        |
| DELETE | `/documents/{documentId}`           | Strong If-Match; soft-delete ACTIVE identity, fence and cancel former work; 200 lifecycle. No body or `{}`.          |
| POST   | `/documents/{documentId}/restore`   | `{}`, strong If-Match and Idempotency-Key; accept before the SOFT_DELETED deadline; 202 lifecycle and poll Location. |

Deletion immediately withdraws normal document/list/history/status/read eligibility and
new transfer authority, including for the owner. Lifecycle and owner audit inspection
remain available. The server records the deletion time, a 30-day restore deadline and a
new lifecycle generation; it cancels pending sessions/attempts/jobs and obsoletes dispatches.
Versions, metadata, references, sharing grants and byte-accounting records remain retained.
Repeated deletion cannot silently extend the deadline: stale revisions return 412 and
an already deleted identity is unavailable for another delete.

Restore reactivates the same logical identity under a new generation, preserving its
versions and grants. Metadata can become visible under the retained live grants while
originals remain unavailable. It queues retained versions that have previously passed
security; it does not allocate binary revisions or revive unfinished uploads. The private
coordinator verifies exact protected object ETag/size and streaming SHA-256, checks the
current installed format/profile policy and capacity, archives prior security evidence,
and starts fresh assessment under the new lifecycle/job generation. Work still uses the
fixed production scanner path. An expired original upload window is not reopened: new
assessment authority has a separate bounded deadline and cannot issue another PUT or
extend the original admission replay window.

Poll the returned lifecycle Location. `restoration.state` is NOT_REQUESTED, PENDING,
COMPLETE, FAILED or PARTIAL, with pending/scanning/completed/failed version counts.
`downloadable` is authoritative for the current original. A completion count records
restoration work, not an unconditional future security guarantee. Current policy/capacity
outages leave pending work for bounded retry. Missing or changed originals fail their
version without releasing retained-byte usage. Negative/inconclusive fresh assessment
leaves it unavailable. There is no automatic fallback to an older current version;
explicit historical downloads remain subject to successful current-generation assessment.

Delete during verification/reassessment obsoletes that generation. Former leases,
results, dispatch messages and late uploads cannot publish or resurrect visibility, even
after a later logical restore. Previously issued public/internal storage capabilities can
remain usable until their disclosed expiry; delivered bytes cannot be recalled.

Logical restore is idempotent within the disclosed 24-hour receipt window. Same actor,
document, key and original expected revision return the current lifecycle (200), without
reactivating a subsequently deleted document or creating more work. Changed inputs conflict;
expired receipts return 410. A fresh stale expected revision returns 412. Refetch lifecycle
and review before retrying. Restore after its deadline returns RESTORE_WINDOW_EXPIRED
(410); PURGING/PURGED and other ineligible states return 409.

Private administration uses protected JSON stdin to `dms:manage-operator`:

- `document-lifecycle-read`: documentId and fresh operatorEmail/operatorPassword.
- `document-delete`: the same fields plus expectedRevision.
- `document-restore`: the same fields plus expectedRevision and idempotencyKey.

Every invocation requires the current tenant-bound DMS operator grant. An authority admin
without that grant is rejected. The operator database role receives a purpose-limited
lifecycle function, not arbitrary publication/candidate mutation privileges. Commands are
private processes, never HTTP endpoints. See [private operator procedures](dms-audit.md).

For public backend testing, keep bearer headers in a 0600 curl configuration file and
never enter tokens/passwords in arguments or shell history. Use an explicitly selected
disposable document and read its current lifecycle/ETag first:

```sh
curl --config /private/dms-machine.curl --noproxy '*' --max-redirs 0 --fail-with-body \
  --request DELETE --header 'If-Match: "7"' \
  https://dms.example.test/v1/documents/11111111-1111-4111-8111-111111111111

curl --config /private/dms-machine.curl --noproxy '*' --max-redirs 0 --fail-with-body \
  --request POST --header 'Content-Type: application/json' --header 'If-Match: "8"' \
  --header 'Idempotency-Key: lifecycle-restore-unique-001' --data '{}' \
  https://dms.example.test/v1/documents/11111111-1111-4111-8111-111111111111/restore
```

Logical deletion never calls storage deletion or releases retained physical-byte usage.
Fresh assessment reserves only work/scratch capacity and releases it through owning
settlement; physical bytes are not charged twice. Existing unfinished reservations stay
conservative until their owning cleanup/reconciliation can safely settle them. Physical
purge requires the private [recovery-aware disposal gate](dms-recovery.md); elapsed restore time
alone does not authorize byte deletion or quota release. Only an authorized recovery-aware disposal request enters PURGING; the coordinator enters PURGED after every physical reference is confirmed removed.
