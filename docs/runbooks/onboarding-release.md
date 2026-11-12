# Onboarding upgrade and release

Use this procedure for ONB-I08 with the [authentication operations](authentication.md)
and [Dokploy deployment](../deployment/customer_deployment_guide.md#ingress) runbooks. The owning roles, fixed installation,
command contracts and recovery boundaries are defined in
[architecture.md](../../architecture.md#onboarding-operations-and-upgrade).
Actual verification and remaining target acceptance belong in [IN_PROGRESS.md](../../IN_PROGRESS.md).

For an access-aware user-management release, use the [user-management procedure](user-management-release.md)
for coordinated authority/API/web cutover, credential retirement and invitation recovery.
This onboarding-only procedure does not establish compatibility with those feature writers.

This procedure covers the v2 first-unit/move release and preserved completed v1.
The [redesign plan](../turnstile/onboarding/onboarding_redesign_implementation_plan.md#onb-rd08-verification-and-coordinated-release)
defines its release evidence. Build matching API/web candidates, verify their exact
migration payloads, and rehearse the protected archive before changing the selected target.
A completed v1 installation stays activated with the same version, revision, profile,
zone, units and completion metadata. An incomplete v1 installation upgrades only its
requirement metadata; an installation without setup starts incomplete at v2.

## Prepare a recoverable release

1. Identify the canonical URL, deployment access and intended verified administrator.
   Validate that account’s real login before pausing services; keep its password only in
   the protected secret file for this invocation and delete it after verification.
   Record the installed tenant/customer/application identities, current immutable image
   IDs and proposed compatible API/web images. Keep the authority, client registrations,
   machine enrollment and encryption/signing keys unchanged.
2. Pause affected access and application writers. Capture a coherent full installation
   database archive with ownership/ACLs, private configuration and keys, migration journals
   and role inventory. Protect the archive and configuration outside the checkout with
   directory mode 0700 and file mode 0600, plus the deployment's protected backup storage.
   A database dump does not contain role passwords, external secrets or document storage;
   retain those through the existing protected backup policy too.
3. Restore to an isolated database using the same PostgreSQL version and owning roles.
   Compare existing data before and after the proposed migration. Rehearse repeat-safe
   initialization/grant and runtime denial across schemas. Retain both the recoverable
   archive and the compatible image set. Never rehearse restoration over the live database.
4. Build/check the complete candidate. On an existing installation apply only pending
   owning migrations; do not provision replacement roles, tenants, accounts or clients.
   An incompatible identity, role, schema or restore result stops the release while access
   remains paused. A successful build alone is insufficient.

## Existing local development installation

The selected local target is `http://localhost:23600`, using the existing Compose project,
private environment files and reserved ports. The approved profile for this installation
is **Turnstile local development / UTC**. The following helpers deliberately reject
non-local profiles, origins and database ports, and require every connection to address
the same installation database. They are not production deployment tools.

Build with the pinned toolchain before pausing services:

```bash
pnpm install --frozen-lockfile
pnpm build
# Use reviewed release-specific tags; record the resolved immutable image IDs.
docker build -f apps/turnstile-api/Dockerfile -t turnstile360-api:release .
docker build -f apps/turnstile-web/Dockerfile -t turnstile360-web:release .
pnpm test:images:onboarding turnstile360-api:release turnstile360-web:release
docker compose stop turnstile-web turnstile-api dms-api
```

Prepare `/private/manager-access.json` as a protected file using the existing
`auth:set-access` input: `{operatorId,userId,enabled:true,permissions:[...]}`. Select an
existing verified eligible account; include `turnstile:access`,
`turnstile:configuration:manage` and **all** its other intended permissions. The helper
checks eligibility and rejects permission removal. It does not create an account.
Choose a new absolute backup directory outside the checkout for each attempt:

```bash
pnpm release:backup:onboarding:local /private/onboarding-release turnstile360-api:release turnstile360-web:release < /private/manager-access.json
pnpm release:rehearse:onboarding:local /private/onboarding-release
```

The backup requires all three application containers stopped, retains their image IDs,
records the proposed API/web pair, installed product migration rows and nonsecret role
inventory, copies the six private environment files, takes a complete custom-format database dump,
and records a SHA-256 archive checksum plus table counts/digests. It verifies that data
did not change during capture. Failure leaves services paused; an incomplete archive is
not a recovery point. The rehearsal creates only a disposable PostgreSQL container,
restores ownership/ACLs with generated clone credentials, verifies old data, runs the
compiled preflight/migration/bootstrap/initialization/grant commands, and checks
idempotency and runtime isolation. It allows only the metadata-only incomplete v1 upgrade;
all other saved configuration remains identical. It also runs six real synthetic v1
archive round trips (empty, partial, saved Calcutta/Kolkata, completed root-only and
completed structure) through the actual pending migrations. Synthetic cases use their
own disposable database, never reset the restored installation, and retain revisions,
receipts, audit and completion. Its temporary port belongs only to that test fixture.
It removes the clone, never the selected installation or archive.

Apply to the original installation only after rehearsal succeeds:

```bash
pnpm --filter @thaarei/turnstile-api setup:verify-installation < /private/onboarding-release/operator.json
pnpm --filter @thaarei/turnstile-api db:migrate:turnstile
pnpm --filter @thaarei/turnstile-api setup:initialize < /private/onboarding-release/operator.json
pnpm --filter @thaarei/turnstile-api configuration:inspect < /private/onboarding-release/operator.json
```

The preflight works before onboarding tables exist. It checks the already installed
identity and dedicated migrator without creating setup state. The candidate includes the original additive onboarding migrations and RD03/RD04
migrations 0007–0010. Initialization creates only an absent empty incomplete v2 context;
its repeat preserves either supported version, revision and completion. Compare the backup's original table digests
before admitting browser traffic; auth/session/client/enrollment data must be unchanged.
Do not re-run fresh role provisioning or replace fixed bootstrap identities.

Start the matching local source/images together using the normal development entry point:

```bash
docker compose up --build --watch
```

On an incomplete installation the runner can observe the selected ordinary account's
**Waiting for setup** and the backend's 409 gate, then explicitly assign manage through
the private command while preserving every permission in the protected input. An already
completed installation instead proves direct Home/Settings entry and preserved canonical
state; never remove manage or reset completion to manufacture a waiting/setup journey.
This controlled loopback ordering does not authorize exposing unconfigured production
access. Fresh Site and Department journeys run in isolated HTTPS fixtures.

Provide the existing account password through a private secret file, never command-line
text or a repository file. The runner reads that file without logging its contents:

```bash
pnpm release:verify:onboarding:local /private/onboarding-release /private/existing-password 'Turnstile local development' UTC
```

Delete the private password file after the invocation (including failure).
For incomplete v2 only, supply an additional protected JSON file containing the explicitly
approved first unit, for example `{"type":"site","name":"Approved site"}` (type is
`site` or `department`). Pass its absolute path as the fifth argument after UTC. No unit
is invented or inferred. A missing approval stops before profile changes. Supply an
existing saved zone exactly; changing it is a separate deliberate Settings edit.

The runner uses supported login and UI. For incomplete setup it saves a partial profile,
restarts the product API, resumes saved data, explicitly submits the approved zone,
creates the approved first unit only when missing, and selects **Finish setup**.
It checks Settings, existing machine connectivity, local cookie attributes and same-account
logout/relogin. It writes a protected `local-verification.json`, without password or signed
URL diagnostics. Failed writes may have committed: inspect current saved state before
retrying, retain receipts, and do not reset setup. A run on completed state verifies
exact version/revision/profile/zone/units/completion readback without configuration writes;
it also checks the optional-unit prompt for root-only v1. It cannot claim it re-ran the
earlier partial journey. The protected report distinguishes these paths.

Keep local HTTP cookie evidence separate from production TLS evidence. A real customer
administrator and external mail delivery are not established by this local account or
Mailpit. Retain the backup according to the installation's protected retention policy.

## Dokploy or another intended production target

Use the same reviewed immutable API/web release pair and existing private network. Dokploy
owns ingress/TLS; no new public service or host port is needed. Keep access paused while
migrating and assigning the intended verified manager. Back up/rehearse as above using
the target's backup tooling; the local-only helpers intentionally cannot operate there.

Prepare protected `operator.json`, `manager-access.json` and a **one-off** product migrator
environment file on the operator host. Retain the exact installed identity and private
connection settings. Set `ONB_NETWORK`, `ONB_PRIVATE` and `ONB_API_IMAGE` to the actual
network, absolute private directory and reviewed immutable image reference. Run:

```bash
docker run --rm --network "$ONB_NETWORK" --env-file "$ONB_PRIVATE/product-migrator.env" -i "$ONB_API_IMAGE" node dist/modules/organization/configuration-operator.js verify-installation < "$ONB_PRIVATE/operator.json"
docker run --rm --network "$ONB_NETWORK" --env-file "$ONB_PRIVATE/product-migrator.env" "$ONB_API_IMAGE" node dist/infrastructure/database/migrate.js turnstile
docker run --rm --network "$ONB_NETWORK" --env-file "$ONB_PRIVATE/product-migrator.env" -i "$ONB_API_IMAGE" node dist/modules/organization/configuration-operator.js initialize < "$ONB_PRIVATE/operator.json"
docker run --rm --network "$ONB_NETWORK" --env-file "$ONB_PRIVATE/product-migrator.env" -i "$ONB_API_IMAGE" node dist/modules/auth/set-user-access.js < "$ONB_PRIVATE/manager-access.json"
docker run --rm --network "$ONB_NETWORK" --env-file "$ONB_PRIVATE/product-migrator.env" -i "$ONB_API_IMAGE" node dist/modules/organization/configuration-operator.js inspect < "$ONB_PRIVATE/operator.json"
```

Do not mount migrator secrets into persistent API/web containers or Vite. Exit 0 is
success; grant conflict exits 2 without changing assignments. Other failures exit 1.
Deploy the compatible API/web together, then verify canonical discovery/token connectivity,
DNS/TLS, Secure host-only HttpOnly SameSite cookies, readiness and database privilege
boundaries on that target. Prove manager setup, an ordinary user's waiting experience,
partial save/restart/resume, activation, Settings and the permitted integration check.
Have the intended administrator log out and back in with their own verified account
before removing unnecessary staff access. If external recipients are involved, verify
actual external mail delivery rather than Mailpit capture.

Record release/image/schema identifiers, protected backup location/checksum, target URL,
nonsecret verification results, named operator responsibility, handover and any remaining
exceptions in the release record. Local fixture/image success cannot satisfy production
acceptance. The existing local installation is the only target authorized for this task.

## Recovery and maintenance

If preflight, migration or initialization fails, keep writers paused. Check the selected
identity, migration journal and owning role; fix forward with the compatible candidate.
Repeat initialization is supported and preserves committed data. A failed/refused grant
leaves assignments intact; inspect and explicitly supply the complete intended array.
After an uncertain browser write, reload saved state before another deliberate mutation.
Do not infer completion from login/enrollment, edit completion in SQL, reset accounts or
set a readiness bypass.

The pre-redesign I08 API/web set is **not an approved rollback** for this release: its
strict v1 projections do not establish support for v2, `structure` next-step, Kolkata or
move conflicts, and its parent-update assumptions predate the new privileges/guards.
No prior candidate has been verified as a compatible v2/move rollback pair. Record
`approvedPriorPair: null` until a specific immutable pair passes the current schema,
readiness and contract checks. Keep maintenance active and fix forward with the matching
candidate if release verification fails. Do not undo the parent guard/privilege migrations.

A coordinated application rollback is allowed only to a schema-compatible API/web set
that enforces readiness. An older API alone can reopen incomplete access. Retain additive
schema and committed configuration with their original keys. If no compatible pair is
available, remain in maintenance. Restoring the original database is a separate explicit
recovery decision: stop all writers, use the coherent whole-installation recovery point
and matching protected keys/identities, account for post-backup changes and external
credential rotation, and verify access before reopening. The clone rehearsal proves
archive readability and preservation; it does not automatically roll back live data.

For an externally suspended sole manager, use the supported authority recovery/provisioning
commands in the [authentication runbook](authentication.md) to obtain a named verified
eligible account. Grant local manage with preserved intended permissions, prove actual
login, then remove obsolete access. There is no universal bootstrap account or public
recovery endpoint. Local last-manager protection cannot prove authority eligibility.

For explicit bounded retention maintenance, inspect before pruning through the same
private migrator environment:

```bash
pnpm --filter @thaarei/turnstile-api configuration:inspect < /private/operator.json
pnpm --filter @thaarei/turnstile-api configuration:prune < /private/operator.json
```

Repeat bounded batches only when deliberately required by retention policy. Pruning keeps
canonical state, completion and live recovery receipts; it is not a rollback mechanism.
