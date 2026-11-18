# Documents validation workspace

This runbook covers the Documents workspace, private first-validator handover,
secure-only text uploads, and document changes and versions. The [architecture](../../architecture.md#documents-validation-workspace-proposal)
owns permissions, compatibility, limits and deployment decisions. The
[implementation plan](../turnstile/documents/documents_validation_implementation_plan.md)
and [coverage register](../turnstile/documents/documents_validation_coverage.json)
record the implementation and qualification status.

## Coordinated rollout

1. Preserve the installation using its supported signed-release backup/upgrade procedure.
   Build and qualify the new API and web together, retaining the exact previous web bundle.
   Do not change the installed customer deployment merely to run disposable qualification.
2. Apply owning migrations 0039 and 0040 through the supported release process. They add
   company permission definitions, a private monotonic compatibility barrier and reviewed
   operator audit reasons. They create no role or assignment. Access release version 2
   prevents an older API from restarting against the upgraded access model, even before
   the first Documents grant. Existing roles, invitations, imports and receipt digests are
   preserved; the owning access revision advances for the model upgrade.
3. Start the dual-contract API and negotiating web. Before activation, clients without
   `X-Turnstile-Access-Contract: 3` retain exact catalogue-v2 responses. Run the actual old
   and new bundle matrix, including nested People/invitation/import/receipt paths and a
   legacy write racing activation. Record the exact images and old asset hashes.
4. Complete explicit machine provisioning below, then review a private validator command.
   Its owning transaction commits the v3 barrier, role/assignment, revision, receipt and
   audit together. Failed proof, stale revision or audit failure commits none of them.
5. Verify ordinary validator login, session-v3, scoped reads and revocation. After activation,
   legacy permission-bearing operations return the supported 401 `LOGIN_REQUIRED` response.
   Existing sign-in/full-navigation recovery fetches the current no-store entry document;
   no blanket session revocation is performed. A role write cannot erase unseen rights.

Revocation does not reopen legacy contracts. Keep the barrier and compatible API while
v3 roles, assignments or retained records remain. Do not downgrade the API or unset the
barrier. Coordinated recovery/restore must preserve the owning release and recovery fences.

## Explicit machine provisioning

The original `/api/dms/capabilities` reader keeps its separate capabilities-only token
partition and response. Documents uses a separately partitioned token request for the
same fixed, privately provisioned Turnstile application; no user or tenant selector exists.

Use the existing private `auth:manage-client` and `dms:manage-application` workflows in the
[authentication runbook](authentication.md#issue-and-manage-distinct-oauth-clients) to
review the issuer's machine policy and the DMS registration ceiling independently.
Retain issuer/resource/tenant/application bindings and existing enrollment; ordinary scope
changes do not justify replacing credentials or re-enrolling an active application.

Set the private API environment `DMS_DOCUMENTS_SCOPES` to the reviewed space-separated
scopes. DV-I02 needs `dms:documents:read`; capabilities read is included by the Documents
client. Add `dms:documents:write` for the owning write increment and `dms:audit:read` for
owner Activity only when those capabilities are reviewed. The disposable qualification
fixture explicitly provisions all four scopes to exercise the full future validator role.
Issuer, registration, deployment and document authority are checked independently of this request setting.
Missing/invalid configuration remains unavailable; denied machine/resource authority does
not sign the user out. No secret or machine token belongs in Vite, browser storage or UI.

## Private validator command

Run the compiled product-owned command using protected JSON stdin in the owning operator
context, for example:

```sh
pnpm --filter @thaarei/turnstile-api documents:operator < /protected/documents-command.json
```

The input is the executable `DocumentsValidatorCommand` in the
[generated contract](../api/turnstile-documents.contract.json). Keep session proofs in
protected ephemeral input, never in source control, command arguments, terminal output or
a browser form. The command verifies current signed product sessions against the identity
authority before acquiring installation/configuration/access locks.

All actions require an operation `key`, `expectedAccessRevision`, reviewed `reason`,
`operatorId`, actual `operatorUserId` and `operatorCookie`, `targetUserId`, custom `roleId`
and literal company `scope`. Audit identifies the verified administrator user, with the
reviewed reason appended at insertion. System roles and protected administrator counts
are unchanged. A role used by another unreviewed member or unit scope is rejected.

- `grant` additionally requires the active target's `targetCookie`, an explicit subset of
  Documents permissions plus `turnstile:access`, and `activateV3Barrier: true`.
- `revoke` removes the reviewed company assignment. It omits grant-only fields and needs
  no target session, so a suspended target can still be revoked.
- `handover` requires the grant fields and a distinct `fromUserId` with the existing
  reviewed assignment. Both subjects are audited under the same revision.

The target must already be an admitted member; the operator must currently hold the
protected administrator role. Provider roles alone grant no product authority. Same-input
retry uses the original key and expected revision, rechecks live proofs and reads the
existing receipt before checking revisions. Fresh proof cookies may replace expired
transport proofs without changing command identity. Changed reviewed input conflicts.
A replay never reapplies a grant removed later. Beyond the existing receipt window,
inspect current access and review a new command rather than retrying blindly.

## Read-only checks and limits

Documents has its own contextual navigation for All documents and Connection and policy.
The directory supports exact filters and opaque cursor paging; detail shows saved metadata,
references and independent original/search availability. Resource ownership is projected
by the backend. Connection shows advertised per-format capabilities and all admission
limits without inferring unadvertised support. DMS rights still decide each read. Current originals use the authorized storage capability described below.

Every backend call rechecks product access and fixed machine bindings; late remote results
recheck local permission before response. The scoped cache includes identity, access
fingerprint, revision and request URL, cancels retired requests and keeps stale refreshes
in place. Known IDs do not supply missing READ authority.

The production Fastify hook owns Documents parser/deadline/response errors. The customer
Nginx template admits the upload operation-creation envelope. Fastify checks actual
bytes against the command budget, and the DMS client checks the forwarded body. Gateway 413/415 responses use
the same finite error contract and correlation, with private no-store policy. Actual
upstream control bodies and artifacts retain their separate architecture limits.

Run qualification in disposable fixtures:

```sh
node scripts/test-auth-database.mjs --people
node scripts/test-auth-database.mjs --documents-upgrade
node scripts/test-auth-database.mjs --browser --documents
node scripts/test-documents-ingress.mjs
```

The compatibility-only browser command exercises v2/v3 and protected validator commands.
The upload qualification below includes native scanner and publication evidence.
The ingress fixture uses the actual customer Nginx image with a counter upstream; product
parser/authorization evidence is separate. Selected-profile builds and target acceptance
must be reported explicitly alongside the four required workspace gates. The DV-I02
[selected-profile record](../qualification/documents-readonly-20261118.json) pins the
source and eight locally qualified images; it does not claim exact-image Documents
browser or target rollout acceptance.


## Secure-only upload and original download

Apply the owning 0041 migration through the supported product upgrade. Provision
the Turnstile machine client for `dms:documents:read` and `dms:documents:write`
independently at the issuer and DMS registration. Use a custom company role with
`turnstile:documents:upload` for operations and `turnstile:documents:read` for
live status and originals. Configure text/plain and secure-only in DMS admission.
Check the DMS storage signer, transfer ingress, coordinator and current scanner
signatures as described in the DMS deployment runbook.

Set `DMS_DOCUMENTS_TRANSFER_ORIGIN` to the DMS storage transfer HTTPS origin in
the private product API environment and customer gateway environment. Match the
DMS signer's `DMS_STORAGE_PUBLIC_ORIGIN` exactly, including a nondefault port if
used. Add the product's exact public origin to `DMS_STORAGE_BROWSER_ORIGINS`.
Use the separate transfer ingress through Dokploy with the signed Host, path and query
intact and direct HTTPS routing for signed requests.
After checking Connection and policy, start a text upload from Documents → Uploads.
The transfer percentage shows bytes sent. After the storage reply, request completion,
wait for security and availability, then download the original. For a searchable upload,
keep the saved operation open to follow extraction and indexing through their final states.
The browser verifies the byte count and digest before saving.

If a reply is lost, reopen the saved operation and use its original operation ID.
For a file that still needs transfer, select the original file before refreshing.
If storage has already accepted a conditional PUT, request completion so DMS can
verify and assess the staged bytes. Completion acceptance and original availability
are shown separately. While policy is restricted, existing authorized status and
originals remain available according to both products' policy.

Private review uses `pnpm --filter @thaarei/turnstile-api documents:review`
with protected JSON stdin. Supply `operatorUserId` and `operatorCookie` for a
current verified protected administrator. For `action: "attach"`, the owning DMS
operator must first independently establish the original upstream key (the product
intent UUID), matching descriptor/digest and the upload, document and version IDs
from DMS evidence. Supply `intentId`, `digest`, `uploadId`, `documentId`,
`versionId` and a reviewed `reason`. The tool checks the live DMS ID tuple
through the fixed product machine registration and records the reviewed binding.
Use `action: "dispose"` with `intentId`, `digest`, `reason` and a verified
outcome of `no_effect` or `effect_already_accounted_for` once the owning DMS
evidence supports that conclusion. If the outcome remains uncertain, leave the
record in review. Use `action: "prune"` to apply retention against the owning
server clock after a supported restore and normal policy recovery. Keep proof
cookies and evidence containing secrets out of arguments, output and review reasons.

Run `pnpm test:browser:documents:upload` for the disposable native qualification.
It uses the pinned storage fixture and fresh official ClamAV signatures. The
test uses real private claim, candidate and result handlers around the production
assessor, with explicit coordinator calls to discover and settle the upload.

## Document details and versions

Apply owning migration 0042 to extend the existing operation ledger. For ordinary
owned-document changes, grant the explicit company action alongside Documents read.
Use Edit document details and Manage references in Overview. If a revision changes,
review the latest saved fields and select the new revision before resubmitting the
retained draft. Use Check saved operation after an unavailable reply. A case that
requires manual review stays under its original operation ID.

Open Versions to inspect the current and earlier versions, download an available
original, or add a text version. Use Restore this version and confirm to admit a new
security assessment from the selected original. The Versions tab shows publication
when DMS makes the assessed version current. The Uploads view can reopen the saved
restore receipt and track progress.

Run `pnpm test:browser:documents:versions` for disposable qualification of the
upload baseline and the version flows. It exercises stale drafts in two browser tabs,
the UTF-8 edit and request budgets, dropped DMS responses, historical download bytes,
native assessment, and publication order.

## Batches and saved operations

Apply owning migration 0043 and use the gateway with the current Documents control
budget. In Documents → Batches, select plain text files and review the manifest. Enter
an owned document ID alongside a file when adding a version. Review the title and
revision shown before creating the batch. Use Transfer selected files to admit and
transfer the selected items. If capacity pauses a run, keep the batch open and resume
the remaining items when capacity becomes available. Next page traverses the DMS item
list. The summary counts describe the entire batch.

Reopen a saved batch from Batches or enter a known batch ID with current Documents
read access. Select the original source again for a transfer that still needs bytes.
The browser verifies the name, byte count and SHA-256 before requesting transfer
authority. Close stops new admissions while started sessions keep their deadlines.
Cancel also stops eligible pending sessions. Published originals remain available.
Saved batch operations retain close and cancellation receipts after a reload.

For an expired uncertain batch, the protected review tool accepts `attach-batch` with
the common intent ID, digest, reason, administrator proof and verified `batchId`.
Use `attach-batch-item` with the batch ID, item ID and verified upload/document/version
tuple. Establish the binding and original operation key through the owning DMS evidence
before attaching. The tool verifies the live batch or item under the fixed registration.

Run `pnpm test:browser:documents:batches` for the disposable batch qualification. The
fixture sends a valid 100-item manifest through the customer Nginx template into the
real product API and tests pagination, capacity delay, transfer integrity, lost replies,
close/cancel races and replay expiry.

## Recovery, application access and Contribute

Apply owning migration 0044 to retain lifecycle bindings and operation mode. Recovery
accepts a known document ID and lists the submitting actor's recorded lifecycle
operations. Review the current revision before deletion or logical restore. Use the
restore deadline and reassessment status to track original availability. A pending
operation can be reopened and retried from its recorded receipt.

Use Application access on an owned document to replace its grant set. Enter the
provisioned DMS application ID and select each independent right explicitly. Remove
the row and confirm replacement to revoke that grant. Open Activity to inspect
application or document events and page through the DMS audit history.

In Validation → Contribute, use the document ID, expected revision and any descriptor
fields supplied by its owner. For a version, select the original text file and request
completion after staging. Reopen a saved contribution to recover its acknowledgement
or reselect the same file for a fresh transfer capability. The owner can independently
verify saved changes and publication. Protected review handles uncertain edits and
references whose replies were lost.

Run `pnpm test:browser:documents:lifecycle` for independent owner and contributor
verification, including logical restore and the native reassessment path.

## Processing, content and search

Apply owning migration 0045. For extracted content, use the DMS results profile with
its dedicated artifact-read signer. The processing profile needs the private worker
and the correct artifact-write authority. Configure the same validated storage transfer
origin and browser allowlist used for original downloads.

Upload a file using a format and profile the current installation admits. Use
Searchable for native text and English OCR. Structured is offered for compatible
formats when the optional layout runtime is installed. Open Processing for the
current version or use Versions to open an exact historical version. Browse run
history and inspect the active run, coverage, warnings and index status. Owners
with current access can request reprocessing from the selected version and retry
the saved operation after an ambiguous reply.

Open active content, a retained result, or a search match. The viewer checks the
artifact's size, SHA-256, schema and source identity before showing it. Page through
extracted source units and tabular or OCR details. Use Search from All documents for
exact filters or English text. Search matches link to their originating unit.

Run `pnpm test:browser:documents:processing` with the pinned OCR runtime available,
using `DMS_OCR_HOME` when it is installed outside its default location. The disposable
fixture uses Chromium, customer Nginx, PostgreSQL, ClamAV, SeaweedFS, RabbitMQ and
the production Python workers. The optional structured runtime has a separate
qualification lane.

## Coverage and release qualification

Open Documents → Validation using an explicitly reviewed validator role. Coverage
lists the finite operation inventory and the expected owning readback. Carry out
the action in its listed product screen, then return to the checklist during the
same Documents visit to inspect the HTTP status, outcome and request ID. Check
service identity and admission policy from the checklist. Compare acknowledgement,
publication and the owning readback independently when the operation is asynchronous.
The permission indicator evaluates the ordinary workflow's company permissions.
Contribute uses its own eligibility rules and the owning DMS resource checks.
Observations clear when leaving the workspace, reloading the application or changing
the verified access context.

Run the selected-image qualification with an exact DMS image ID and a private
outside-checkout fixture directory. The command builds and verifies the signed
selected product bundle. Pass `--modules=` for the Core pair alone.

```sh
AUTH_BROWSER_DMS_IMAGE=sha256:<exact-image-id> \
  pnpm test:release:documents /private/new-fixture-directory --modules=
```

Keep the legacy API/web images recorded by the frozen compatibility fixture available
locally. The rehearsal uses disposable PostgreSQL, real browser login, legacy assets,
and the packaged API's migrations and private validator command. A restored archive
is checked against the candidate and the legacy API. Fixture approval opens the
clone only after the recovery-marker denial has been observed. The report records
which product image profile took the ordinary-login journey.
[Exact Core release evidence after the audit corrections](../qualification/documents-audit-20261118.json).
The [original DV-I08 record](../qualification/documents-release-20261118.json) retains
the prior image and legacy compatibility references.

For a customer handoff, record the approved release and exact image inventory, capture
the coherent coordinated backup with the owning runbooks, and rehearse its restore in
an isolated target. Include the DMS database, object inventory and storage recovery
prescribed by the [DMS recovery runbook](dms-recovery.md). Record delegated application
provisioning, transfer origin and configured ingress, policy, optional runtime status,
and the same Documents readback matrix. Retain the v3 barrier for saved v3 rights,
grants and receipts. Use maintenance and a compatible fix-forward package if the
previous API fails against that state. Record customer acceptance against the reviewed
target only after its checks pass.
