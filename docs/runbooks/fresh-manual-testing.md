# Fresh manual testing of the three applications

This checklist covers a fresh local test installation after DMS-I20 qualification. It is
not evidence that a test installation has already been reset or is running. Actual URLs,
private credential-file locations and verification results belong in the active progress
handoff. Use the [architecture](../../architecture.md#thaarei-central-control-plane-proposal)
for topology, trust and host boundaries. Never reuse another project's database or ports.

## Preparation performed by the operator

1. Finish the exact-image DMS-I20 run and inspect its report. A local automated pass does
   not mark this manual checklist passed or authorize production rollout.
2. Stop this application's old test processes. Identify the owning central database and
   customer auth/DMS/Turnstile schemas, storage namespace and private registration state.
   Reset only the explicitly selected local test installation. Preserve other projects.
   Do not run an indiscriminate Docker prune or truncate a shared database.
3. Recreate owning schemas/roles through supported provision/migrate/bootstrap commands.
   A fresh installation still needs migration records, system policies and one installation
   tenant. Do not manually edit verification flags, approval rows or role tables.
4. Configure the current complete customer profile and an isolated central environment,
   canonical HTTPS routing, trusted certificates and Mailpit. Keep all database, signing,
   machine and migration credentials server-side in protected files.
5. Bootstrap exactly one Thaarei administrator through the private
   [staff procedure](control-plane.md). Deliver credentials privately. Leave the client,
   installation and product registries empty for the manual registration journey.
6. Export DMS and Turnstile nonsecret manifests through their owning commands. They must
   share the same local installation UUID and tenant; their product identities differ.
   See [DMS activation](dms-deployment-control.md) and
   [Turnstile activation](turnstile-deployment-control.md).

## Thaarei registration and activation

1. Open the supplied central URL. Set/reset the first administrator password through
   captured Mailpit mail, verify email, enroll TOTP and retain recovery codes privately.
2. Sign in and confirm Clients, Reports and Staff are available for the administrator.
3. Create one test customer in Clients. Add its test installation/environment, then
   separate DMS and Turnstile products using the exported manifest bindings.
4. Issue/download each product's protected pairing file. Deliver each file to its owning
   private operator command. The operator runs setup for each product. Pairing alone
   must leave ordinary business access closed; verify pending status.
5. Review both products' actual bindings, verify recent MFA and explicitly approve each.
   Have the operator run sync, or wait for its scheduled sync. Verify local activation
   and the central acknowledgement, rather than relying only on an Approved label.
6. Inspect Reports. DMS and Turnstile must report independently. Missing usage stays
   unknown; reporting success is not a claim that the web application is reachable.

## Customer identity and Turnstile

1. The operator provisions the first customer administrator locally, verifies email
   through Mailpit, provisions distinct login, DMS-machine and private identity-service
   clients, and enrolls the Turnstile machine with local DMS. Central approval supplies
   none of those local credentials or permissions.
2. Follow the [user-management release procedure](user-management-release.md) for fresh
   protected-administrator handover and feature opening using genuine normal-login proof.
   Leave company setup incomplete and create no sample users or organization units.
3. Open the supplied Turnstile URL, sign in and complete organization name, explicit time
   zone, first unit and review. Refresh or sign out midway and check saved-step resume.
4. Complete setup. Inspect Settings and Structure. Create, edit and move a test unit;
   confirm the intended hierarchy persists after reload.
5. In People create a scoped role, invite a second email, complete any required invitation
   approval, and use Mailpit to set up/verify/accept as that recipient in another browser
   profile. Verify permitted access and a denied operation outside its scope.
6. Suspend the second member. Their retained session must lose protected access. Restore
   access, then test sign out, login and password recovery.
7. Test Document connection using an account explicitly granted the separate
   `turnstile:dms:capabilities:read` permission. A protected administrator does not silently
   receive that permission. The connection check is not a document-upload workflow.

## DMS documents and application isolation

Turnstile currently provides a connection/status adapter, not document business screens.
Test DMS documents through its independent backend examples and controlled API explorer.
The explorer accepts short-lived bearer tokens only; machine secrets remain outside it.
Some write operations intentionally cannot be executed in the browser explorer.

1. Follow [independent enrollment and explorer](dms-api-explorer.md) to create distinct
   consumer A/B clients, register/enroll them, obtain resource-bound tokens and read
   capabilities. Check one invalid-token request and one scope denial.
2. Use [secure transfer](dms-secure-transfer.md) and [uploads](dms-uploads.md) to upload a
   small text file, native PDF and clean English scanned image with the Python examples.
   Complete and poll each upload. Download the accepted originals and compare bytes/hash.
3. Read extraction/OCR results and search for distinctive text. Record failures and partial
   extraction exactly; optional structured processing requires its enabled profile.
4. Edit metadata/tags/references, create a second binary version and restore an earlier
   version as a new version. Reload history and verify immutable earlier originals.
5. Verify B cannot access A's document. Grant READ, verify permitted reads and denied
   writes, grant metadata-only editing, then revoke access and retry reads/search.
6. Soft-delete and restore a document, inspect authorized audit and verify current state
   after reload. Use [sharing](dms-sharing.md), [versions](dms-versions.md),
   [results](dms-results.md), [discovery](dms-discovery.md) and
   [lifecycle](dms-lifecycle.md) for exact protected inputs and expected outcomes.

## Restriction and recovery

1. Centrally suspend Turnstile and sync. Previously activated installations retain
   authorized reads, but writes and invitation acceptance must fail. Local identity and
   recovery remain available. Reapprove/sync and verify changes become available again.
2. Suspend DMS independently. Verify its restriction does not impersonate customer logout
   or silently grant Turnstile document rights. Reapprove/sync and check recovery.
3. Briefly disconnect central transport. A still-valid cached approval permits normal
   locally authorized operations. Do not change the host clock to simulate expiry.
4. Run destructive backup/restore drills only in a separate disposable recovery target
   following [recovery](dms-recovery.md) and the activation runbooks. Restored or invalid
   approval state must not reopen business access without reviewed reconciliation.

Record the image/source identifiers, step, expected/actual result, timestamp and redacted
request ID for each finding. Never include passwords, tokens, signed URLs or customer data
in screenshots/issues. Manual and production acceptance stay pending until their actual
journeys have been completed and reviewed.
