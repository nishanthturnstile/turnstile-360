# Document registry and admission

See [architecture](../../architecture.md#document-registry-and-admission-foundation-i05)
for the owning persistence, quotas, locking, freshness and availability boundaries.
I05 supplies the internal upload-begin admission use case and authenticated registry
reads. Public begin/status/complete/refresh/cancel and batch lifecycle routes are I06;
processing and publication are subsequent features. No installed format/profile or
upload route is claimed merely because a file extension or policy value is recognized.

Apply the DMS owning migrations through 0009 using the existing private migration
procedure. These migrations create no customer, grant, document, configured policy or
capacity observation. Preserve the installation tenant/customer identity. Existing I04
storage configuration and role separation remain independent of document authorization.

Registry APIs require enrolled consumer machine tokens with `dms:documents:read`:

- GET `/v1/documents` returns only that application's logical records. Use `limit`
  (1–50, default 20) and the returned opaque `cursor`. Each page reauthorizes; listings
  are live views, not frozen snapshots.
- GET `/v1/documents/{documentId}` returns bounded metadata and a strong quoted ETag
  for the current logical revision. Another application gets the same 404 as a missing ID.
- GET `/v1/documents/{documentId}/audit` additionally requires `dms:audit:read` and
  returns bounded owner-only resource audit. Document audit is not implied by sharing.
- GET `/v1/admission-policy` returns a versioned effective policy projection. It hides
  private budgets, filesystem roots, observations and other applications' usage.

A logical record and pending candidate are not an available file. I05 responses always
have `currentVersionId: null`, `downloadable: false` and `searchable: false`. Binary
availability can change only with its owning security/publication implementation.
The existing capability response shape stays compatible for existing scoped clients;
explicit new document scopes add the corresponding read operation identifiers.

Use the existing protected `dms:manage-operator` JSON-stdin interface with fresh verified
identity and a current explicit DMS operator grant. Neither authority-admin status nor
consumer scopes substitute for that grant. Policy/inspection commands use the separate
DMS operator database role, without migration credentials:

```sh
node --env-file=/protected/authority.env --env-file=/protected/operator.env \
  apps/dms-api/dist/modules/access/manage-operator.js < /protected/admission-policy.json
```

Read with `action: "admission-policy-read"`. A missing configuration has revision `"0"`.
To set it, the protected input contains credentials and these operation fields:

```json
{
  "action": "admission-policy-set",
  "operatorEmail": "operator@example.test",
  "operatorPassword": "replace-in-protected-file",
  "expectedRevision": "0",
  "policy": {
    "enabled": false,
    "storageBudgetBytes": 1073741824,
    "applicationBudgetBytes": 536870912,
    "scratchBudgetBytes": 4294967296,
    "maxFileBytes": 52428800,
    "activePerApplication": 4,
    "activePerTenant": 16,
    "queuedWork": 100,
    "profiles": ["secure-only"],
    "contentTypes": ["text/plain"]
  }
}
```

These budget numbers are an example, not a capacity recommendation. Choose them for
the actual installation and retained data. Policy updates require the current revision;
an identical retry after a successful update returns unchanged current state instead of
a second policy change. Lower limits block new admissions rather than deleting existing
state. Configuration cannot install scanners/parsers or enable missing upload routes:
I05 still projects `not-installed` (or `paused` when disabled), with no enabled formats.
Use `action: "document-inspect"` plus `documentId` for an attributed private registry read.
The existing private `audit-read` also accepts an optional `documentId`. Private commands
remain outside consumer OpenAPI; see [their generated contract](../api/dms-operator.contract.json).

Capacity is a separate trusted observation, not a consumer-supplied claim. Create a
protected file from [the observer template](../../apps/dms-api/.env.capacity.example).
Use the private coordinator DB role, fixed installation binding and actual storage/
scratch roots. A one-off container must mount those filesystems read-only and reach
the private database. Never sample an unrelated API overlay filesystem as S3 capacity.

```sh
node --env-file=/protected/capacity.env \
  apps/dms-api/dist/modules/uploads/admission-maintenance.js
```

The command samples native filesystem availability under the accounting lock. A missing
root or database failure does not renew the observation. The shared-capacity default is
conservative; opt into independent pools only after checking the physical topology.
I05 starts no scheduler; the I07 [coordinator](dms-work.md) owns recurring observations;
admission fails closed when the observation expires. A capability/policy read is not a
promise of reserved capacity: each new admission rechecks current policy and resources.

The internal upload-begin use case requires `dms:documents:write`, current consumer access,
a policy-allowed and installed profile/type, bounded metadata/control JSON and a fresh
capacity observation. It reserves space for staging plus the original candidate, scratch
and mandatory work before allocating stable IDs. Identical retries preserve those IDs;
changed bodies conflict. New-version allocation requires the current document revision
and preserves logical metadata. Declared or asserted human context never grants authority.

Measured usage reconciliation is coordinator-only, with byte observations supplied by
trusted owning storage operations, never HTTP input or a private operator's byte count.
Actual retained bytes stay charged. Settled admission releases upload slots but retains
mandatory-work/scratch budgets until work release. Both transitions are idempotent and
audited. Cancellation accounting cannot release capacity while a transfer capability can
still be used. Completion/physical observation, leases, cleanup and publication wire these
kernels into their owning subsequent lifecycle features.
