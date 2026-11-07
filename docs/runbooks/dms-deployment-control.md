# DMS deployment approval and reporting

This is the TCP-I05 integration workflow. Use the [architecture](../../architecture.md#dms-deployment-control-integration-tcp-i05)
for ownership, contracts and configured limits, and [IN_PROGRESS](../../IN_PROGRESS.md) for
actual qualification. Target rollout, customer DNS/TLS/SMTP, release inventories and restore
acceptance remain TCP-I08 work. No existing installation is updated by building this branch.

## Profiles and authority

`deploy/compose.dms-activated.yaml` composes the complete DMS-only distribution with central
approval. `deploy/compose.customer-complete.yaml` additionally composes Turnstile, its private
identity integration and a private product-maintenance service. The old three-app Compose
and the I18 DMS-only manifest are not substitutes for that complete customer entry.
The TCP overlay selects the newly built `thaarei-dms-api:tcp-i05` candidate, not an older
0.20.0 image. Rebuild/qualify it from the same source as its migrations and public packages.
The remaining bundled workers/storage/broker retain their owning distribution versions.
These entries publish no host ports; Dokploy owns ingress and TLS.

Keep the customer authority local. Combined mode uses the customer's Turnstile origin,
`AUTH_MODE=combined`, issuer `<customer-origin>/identity` and exact login callback
`<customer-origin>/api/auth/callback`. Register separate login, DMS consumer and identity-service
clients, with separate secrets, exact audiences/scopes and current local registration. Route
customer `/` to Turnstile web, `/api` to Turnstile API, `/identity` and metadata aliases to DMS;
keep private `/internal/identity/v1/*` reachable from Turnstile's backend but off public ingress.
The DMS domain exposes only the approved DMS/transfer surfaces. Control-plane origins are
never OAuth issuers, login callbacks or customer cookie settings. DMS-only use has no
Turnstile dependency; deliberate standalone login clients require explicit screen/client
policy and actual provisioning, not a JSON policy alone.

Use the owning distribution's private provisioning/migration/bootstrap commands for DMS and
auth. Provision and migrate Turnstile's own database using its separate private maintenance
service and protected `.env.turnstile.migrate`; never give its migrator to a running API.
Install the full identity-service transport configuration, not only a browser login callback.
Customer APIs/coordinator/workers must resolve and trust their canonical customer issuer;
coordinator/setup also need outbound central HTTPS. The combined entry pins worker issuer
settings to that same customer issuer. CA delivery uses `CUSTOMER_EXTRA_CA_HOST_FILE`
(default: the Linux host CA bundle) read-only at `/run/customer-ca.pem`, with Node/Python
trust settings. A private CA bundle must include all required customer/central roots.
Do not repair issuer routing by substituting localhost or the central staff origin.

## Private files and configuration

The API receives only `CONTROL_PLANE_ORIGIN`, optional registered
`CONTROL_PLANE_INSTALLATION_ID` / `CONTROL_PLANE_PRODUCT_ID`, the public trust bundle and an
independent recovery marker. The owning DB binding remains authoritative; configured IDs,
when supplied, must agree. Missing configuration/proof closes business access. Liveness,
local identity, safe diagnostics and bootstrap remain available. `/health/deployment` returns
only a no-store derived access/state summary, never a token, credential or customer record.

Set `CONTROL_PLANE_TRUST_HOST_FILE` and `CONTROL_PLANE_RECOVERY_HOST_FILE` to protected
absolute host files. The marker contains at least 32 random bytes encoded base64url and lives
outside all DB/private-state restore sets. Public trust is delivered through an independently
authenticated operator/release channel. Files must be readable by image UID 1000, with
integrity protected from other users. The credential directory, selected by
`CONTROL_PLANE_PRIVATE_HOST_DIRECTORY`, is mode 0700, owner UID 1000. Its `product.json` is
mode 0600 and contains the private current/candidate/operation journal. The coordinator mounts
this directory read-only; only private maintenance mounts it writable. APIs have no credential
directory or central machine-secret setting. Never put those credentials in application
rows, ordinary Compose text, images or browser configuration.

The coordinator/private tool sees:

- `CONTROL_PLANE_MACHINE_SECRET_FILE=/run/deployment-private/product.json`;
- `CONTROL_PLANE_VERIFICATION_KEYS_FILE=/run/deployment-trust.json`;
- `CONTROL_PLANE_RECOVERY_MARKER_FILE=/run/deployment-marker`;
- canonical HTTPS `CONTROL_PLANE_ORIGIN`, plus its own `DMS_COORDINATOR_DATABASE_URL` and
  fixed `INSTALLATION_TENANT_ID` / `INSTALLATION_CUSTOMER_KEY` from `.env.coordinator`.

Private tools receive that coordinator role only for deployment operations; no auth/DMS
migrator is needed by pairing, sync or rotation. Linux `flock` is required by the writable
private-file adapter. Atomic renames in the mounted directory are visible to reporter
replicas. After replacing an individually bind-mounted trust/CA/marker file, recreate its
containers so they see the new inode; restart Node/Python after changing process CA trust.

## Export, pairing and approval

Apply owning DMS migrations through 0057 and bootstrap the installation. Bootstrap persists
its deployment UUID once; it never comes from a container ID and never rewrites the tenant
or OAuth application identity. Run the compiled private command
`dist/modules/deployment/operator.js`, or workspace `pnpm --filter @thaarei/dms-api dms:deployment`.
In the tools container, the Node entrypoint accepts that script path and private JSON stdin.
For example, supply `{"action":"manifest","outputFile":"/configuration/deployment-manifest.json",
"environment":"production","buildVersion":"<exact candidate version>"}`. Output paths must
be new absolute files. This nonsecret export works before central approval and needs no
central credential. It contains only the owning durable identity/environment/version.

Keep private delivery files outside the build context; when using `/configuration` from
the owning checkout, use a mode-0700 `.dms-*` directory, excluded from Git and image builds.
Staff registers the exact client/installation/product binding and issues a protected pairing
file through the central Clients workspace. Keep that file mode 0600. Supply private JSON
stdin `{"action":"setup","pairingFile":"/configuration/.dms-deployment/private-pairing.json"}` to the same
command with the protected files configured. It durably saves the generated candidate/request
before HTTPS, consumes the real pairing code centrally, confirms the candidate and persists
verified pending policy. No approval is implied, and no local DMS consumer is enrolled.

Staff must explicitly approve the paired DMS. `{"action":"sync"}` applies/acknowledges the
signed decision; the elected coordinator normally does this periodically. Local DMS consumer
registration/enrollment remains separate: central approval cannot activate a pending consumer,
restore its scopes or re-enable a disabled consumer. Central credentials never authenticate
DMS APIs. API business denials use `DEPLOYMENT_RESTRICTED`, while local authority/resource
errors retain their separate existing codes.

## Retry, rotation and restriction

Keep all journal files after uncertain results. `{"action":"sync"}` resumes the same durable
candidate after a lost pairing/rotation response, even when the pairing receipt has expired.
`{"action":"rotate"}` stages one candidate under the shared product lock, centrally compares
credential generation, confirms it over HTTPS, then promotes/reloads atomically. A database
commit before local promotion is recoverable: the DB holds only verified decision/nonsecret
metadata, and the still-durable candidate can finish file promotion. An unrecognized candidate
requires reviewed replacement, not deletion of the journal and a guessed new secret.

Only the existing coordinator reports. A product-wide PostgreSQL operation lock fences
replicas and private commands without an open transaction across HTTPS; persisted cadence
prevents idle peers from each sending a normal report. Current/candidate secrets stay in the
protected file. The safe report UUID/payload, decision high water, clock/quarantine and public
binding are DMS-owned SQL state. DMS reports filter the existing operational snapshot;
per-application details/customer content are stripped and stale capacity is unavailable,
not fabricated zero. Central report history/status dashboards remain TCP-I07.

API requests make no central network call. A current valid approval permits operations under
all existing local policies. Qualified expiry/suspension permits existing authorized reads
and downloads only. New uploads/versions, mutation, reprocessing, new attempt claims and new
dispatch are blocked. Existing admitted leases can complete under their existing fences;
additional processing stages are durably held without dispatch until approval returns.
Never-approved, unverifiable, revoked-trust, backward-clock and restore-quarantined states
permit no business reads/publication. Private diagnostics, key/identity repair, backup and
safety containment remain separately authorized. Failed incoming decisions cannot replace
usable retained proof; persisted denial never expires back into an older grant.

## Restore and trust repair

Before supported restore, stop business/reporters and rotate the independent marker outside
the restore set. Restoring DB rows, private journals or documents cannot reopen access.
Reestablish the owning DMS recovery barrier using its private verified administrator flow,
then obtain Admin-reviewed central replacement pairing and run
`{"action":"rebind","pairingFile":"/configuration/.dms-deployment/new-private-pairing.json"}`. The old approval
stays quarantined while the new journal/network operation is pending. Only a verified fresh
online epoch reconciles that quarantine, clears old activation evidence and retains the
trust-revision floor. A lost response resumes that exact durable intent with `sync`; it does
not need another candidate. New pending/suspended policy still needs explicit staff approval.
A changed registry tuple is reviewed repair, not a silent tenant/product rebinding.

Deliver emergency trust revocation independently, including disconnected installations.
Tokens cannot install trust keys or clear quarantine. Arbitrary rollback of host/root-owned
markers and files together is outside the supported guarantee. Restore drills, backup
retention, current release inventories and actual customer acceptance remain owning release
qualification; see the I19 recovery runbook and TCP-I08 gates.

Reporting uses the owning operational snapshot, active-document/original-byte gauges and
committed publication/processing counters; see the
[reporting design](../../architecture.md#reporting-and-central-storage). Source metrics
failure leaves usage unknown/overdue and does not prevent policy synchronization when local
persistence is available. Counter/sequence epochs reset only through reviewed recovery;
retries preserve one journaled report and cumulative values never wrap.
