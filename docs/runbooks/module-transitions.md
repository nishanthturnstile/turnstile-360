# Module activation, changes and private profile cutover

Use the [accepted architecture](../../architecture.md#mod-i08-reviewed-transitions-and-private-cutover)
and [module access rules](module-access.md). Actual qualification belongs in
[IN_PROGRESS](../../IN_PROGRESS.md). The combined customer installer remains MOD-I09.

## Staff changes

In a product's Modules page, save and review the complete desired selection, then approve.
When there is active authority, the command includes its current active basis and the
explicit Individual removal/dependant closure computed from that active catalogue.
Approval atomically narrows the existing allowed set before staging additions, including
across catalogues. It never grants an addition or moves installed code. Current Core
cannot be individually removed; classification changes require deliberate profile cutover.
A draft changes no active rights. A stale basis/revision requires reload and review.

Current Admin/Operator MFA can separately review **Activate installed modules**. The server
requires approved product policy, current pairing epoch, current desired assignment,
current active basis, a fresh authenticated installed claim (15-minute maximum), and an
independently verified matching delivery reference. Reported inventory alone grants nothing.
`POST /api/registry/products/{id}/modules/activate` uses the strict
[activation contract](../api/module-transitions.openapi.json). Signed customer sync/application
still follows staff approval; user roles and permissions remain independent.

Keep exact operation IDs after a lost response. Retrying a receipt reports historical
success without replaying its mutation, including after a later removal, role change or
replacement epoch. Changed requests need a new ID and current review. Competing operators
cannot activate two profiles from the same revision. The module version floor is permanent;
replacement pairing needs fresh activation rather than transferring old-epoch authority.

## Private Linux/Docker POC cutover

The operator command is `pnpm module:cutover`, with one protected JSON object on stdin.
This explicit owner workflow runs from the owning tools checkout; MOD-I09 owns distributing
and integrating the customer launcher. It never takes a Docker socket into an application.
Prepare and test a coherent recovery point before a target rollout.

Input fields are `action` (`prepare`, `verify`, or `reconcile`), a retained `requestId` UUID,
absolute `planDirectory`, `sourceBundleDirectory`, `targetBundleDirectory`, `releaseTrustFile`,
`ownerEnvironmentFile` and `privateDirectory`, the private Docker `network`, exact `mounts`,
`containers`, `desiredRevision`, `policyRevision`, `operatorId` and `expectedAccessRevision`.
The plan/backup directory must be outside the checkout and disjoint from every live
private/configuration/bundle input.
Files must be operator-owned and private; directories are 0700 and private files 0600.
Keep this input, owner configuration, archives and logs out of Git and browser storage.

`containers` contains immutable 64-hex Docker IDs and roles `api`, `reporter`, `web`; declare
all old processes, including replicas. The helper verifies their exact source images,
customer network and API/reporter tenant/application identity.
The private owner environment supplies the existing fixed identity and owning runtime,
migrator and reporter configuration; the normal API receives only its runtime credential.
`mounts` names exact public release/central trusts, recovery marker and CA files already
configured there. The reporter credential state directory is mounted only to private
maintenance operations. Never include a Docker socket or unrelated secrets in mounts.

Sync the old installation first. Its current signed decision must name the exact target
desired catalogue/profile/assignment and the supplied policy revision. The helper verifies
both full bundles and their exact image inventories, refusing changed artifacts under a
retained plan. Source installed evidence may be historical; the target delivery must be
current and independently trusted.
The target must also verify against the installation's separately provisioned release
trust, including revoked/retired key status. The helper preserves that trust file exactly;
delivery trust never adds installed keys or resets their status. Provision reviewed key
changes through the independent operator channel before cutover.

`prepare` then:

1. Closes the existing feature release under its current access revision/receipt.
2. Stops the declared old containers and commits deployment quarantine through the real
   owning store. Pending credential/report journals must be reconciled first.
3. Captures fixed identity, setup and local access fingerprints, protected configuration,
   private deployment state and a checksummed owning product schema archive. Dump uses the
   fixed tenant's RLS policy with explicit row-security/inserts and a consistent snapshot.
4. Atomically stages the target public release descriptor, loads/verifies the exact API/web images,
   applies owning forward migrations and checks that identity/setup/local grants are intact.
5. Leaves a prepared, closed installation. It does not delete data, reset completion,
   restore old secrets, start a legacy image, or open business access.

The private plan records forward-only checkpoints. After interruption, keep old processes
stopped and resubmit the exact input/request ID. An incomplete staging directory bearing
that plan's input digest can be regenerated; unknown staging data is preserved. A complete
archive is verified before reuse. A changed owner environment,
artifact, desired context or receipt conflict stops for reconciliation. Existing receipt
retention/expiry limits still apply; an expired ambiguous receipt needs renewed owner review.
Do not treat a partial archive or an unverified plan marker as a recovery point.

Start the verified target API/web/reporter configuration through the deployment owner.
Use the existing central **replacement pairing**, private `rebind`, current-MFA product
reapproval and signed sync, followed by staff module activation for the newly observed
profile and another private sync. Each existing owning command retains its exact pending
operation after transport failure. Rebind changes the machine epoch/credential while retaining
the fixed installation/tenant/application IDs, data and local grants. Decision and independent
release-trust revision floors survive it; no v1 or lower-trust fallback is supported.

Resubmit the original input with `action: "verify"`. It requires all old container IDs to
remain stopped, a fresh epoch, current approved target context with the retained desired
revision, complete target authority, exact verified artifacts and unchanged local fingerprints.
Only then use the existing protected feature-release `open` operation with a current normal
administrator session and current access revision. Opening remains a separate verified act;
staff module activation cannot grant a customer role.

If an authorized private access change occurred during the closed interval, verification
stops and preserves the changed data. After reviewing it, use `action: "reconcile"` with a
`review` containing a new `reviewId`, the current `expectedAccessRevision`,
`administratorUserId` and `administratorCookie`. The cookie goes only through protected
operator input. The real private normal-login verifier must validate a current protected
administrator; the target signed authority and closed state are checked again. This records
a new local baseline without changing any grants or central authority. Old review receipts
cannot overwrite a later baseline. Then verify and open using current normal administration.
A changed central assignment requires a new staff review, never local inference.

## Restore and removal

Removal denies module reads/writes on sync and bounds an unseen offline removal by grant
expiry. Existing user grants and data remain, so later reapproval still checks current user
rights. Already admitted work has only its feature's explicit safety/cleanup allowance;
this placeholder adds no dispatch/workflow engine.

Preserve the complete central database, customer product database, private deployment state,
independent public trusts, catalogue/assignment/active context and archive inventory as a
coherent recovery set. Rotate the independent recovery marker before supported restore.
A backup never authorizes copying an old marker or credential over newer independent evidence.
Use existing central recovery reconciliation to suspend/revoke restored authority and pair
fresh epochs; the selected customer store also requires fresh online rebind after quarantine.
Missing independent evidence stays closed until current reviewed product/module approval.
Never reopen from restored success receipts, stale module grants, old epochs or unsigned
inventory. Keep DMS identity/enrollment/approval and its own coherent recovery procedure separate.

## Isolated qualification

`pnpm test:module:cutover /absolute/new/private/fixture-directory` builds selected artifacts
and runs real central HTTPS/PostgreSQL plus ordinary-login customer Docker/browser cutovers.
The selected customer API, web and reporter run from their verified images. The separate
legacy v1 compatibility fixture runs from source; the wider control-plane image qualifier
owns legacy candidate-image/reporter coverage. No selected installation is downgraded.
The fixture tests use private custody and disposable databases; they do not modify live
customer installations. `--resume` reuses only independently verified exact artifacts and
retained fixture signing material, then reruns qualification. Keep fixture signing keys local.
