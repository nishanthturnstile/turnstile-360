# Customer module capabilities and placeholder access

Follow [the accepted architecture](../../architecture.md#mod-i07-customer-module-access)
and [the implementation plan](../turnstile/modules/module_delivery_implementation_plan.md).
Actual qualification and remaining work are recorded in [IN_PROGRESS](../../IN_PROGRESS.md).

A selected package includes only its chosen implementations. A current signed v2 decision
allows the installed modules; ordinary user permissions independently allow each user to
read them. Complete normal setup, administrator handover and the versioned release opening
before module use. Staff assignment, product approval and administrator status do not grant
user module permissions. Staff activation/cutover follows the [transition runbook](module-transitions.md).

## Explicit permissions

The private owning command is `pnpm --filter @thaarei/turnstile-api modules:operator`.
It uses the existing protected runtime/migrator configuration, fixed installation identity,
current access revision and normal subject verification. Supply a protected, bounded JSON
object on stdin; never pass a token in argv, URLs, shell history or browser storage.

Fields for both actions are `action` (`grant` or `revoke`), `operatorId`, `key` (UUID),
`expectedRevision`, `userId`, `moduleId`, `roleId` (UUID) and a nonempty `reason` (300 chars
maximum). A grant additionally requires that user's current `identityAccessToken`, obtained
through the existing owning identity/operator flow. It must be a live, verified normal
product-login identity; machine/staff credentials are insufficient. The private
`operatorSession` helper can recover it from a current signed product session entirely
inside the operator process. The token is excluded from receipts and output.

Use module IDs `incident-management` or `risk-management`. The command creates or reuses
an exact custom `<Module title> reader` role containing shell access and the corresponding
read permission, then assigns it at company scope. Choose one retained role UUID per module
and installation. An existing different/system role is rejected. No protected templates,
legacy sources, setup, deployment policy or other assignments are changed. The placeholder
has no resource/unit model, so these two permissions require company scope. Existing normal
role administration can delegate only rights within the administrator's actual authority.

Keep the original key and full nonsecret command after a lost response. An exact replay
returns its receipt/current revision and does not restore an assignment revoked since the
original success. A changed action/payload requires a new key and current revision. Revoke
removes only the specified module-reader assignment; another role may still grant that
permission. Inspect the current normal session/capability projection to confirm effective
access. Audit and receipts commit with access changes.

## Local reduction and reads

Set protected `TURNSTILE_DISABLED_MODULES` to a JSON array, for example
`["incident-management"]`, and restart the API through the deployment owner. Default is
`[]`. Invalid/unknown/duplicate values fail module admission closed. Disablement also removes
required dependants and can never add to signed authority. The database and central desired
selection are retained. Removing a local disablement still requires current central authority
and user rights.

Normal authenticated `GET /api/modules` returns bounded links and signed active context.
Selected landing routes `/modules/incident-management` and `/modules/risk-management` request
`GET /api/modules/<id>/entry`; their messages come from the guarded backend. Excluded routes
are unregistered (404), while installed-but-denied entries return 403. Responses and errors
are private/no-store with no-referrer. Empty capability lists may mean no local rights,
closed feature release, local disablement or absent/currently invalid module authority.
Missing or invalid selected release proof closes product access rather than authorizing a
legacy fallback. Recheck current session/setup/deployment state before changing grants.

An expired or suspended module decision grants no module reads even when whole-product
foundation reads remain available. User suspension/revocation and central removal also
apply on the next backend admission. DMS remains separately enrolled and approved; module
access cannot grant machine scopes or enable a DMS deployment. Its capability response can
report restricted deployment status without authorizing business operations.

## Disposable acceptance

Run `pnpm test:browser:modules /absolute/new/private/fixture-directory` with Docker running.
This builds and verifies all four actual API/web profiles and one DMS image, then uses fresh
isolated databases, private signed fixtures, real HTTPS ingress and ordinary browser login.
It checks setup/release barriers, absent implicit rights, explicit grants, direct URLs/API,
excluded 404s, service-level admission, deferred SQL company scope, local disablement,
revocation/receipt replay, current signed removal/expiry/suspension and independent DMS
approval/scopes. Only fixture databases and containers are removed. No live customer
installation is modified. The fixture directory is private; keep its test signing key local.

For an interrupted fixture run, retain its private directory and rerun the same command
with `--resume`. The fixture reuses only verified exact-profile bundles and retained test
signing material, and reruns all four browser journeys; it does not resume a live customer
installation or trust a previous success marker. Keep its locally built DMS fixture image.
