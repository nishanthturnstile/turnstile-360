# User-management release and recovery

Use this procedure for UM-I11 with the [authentication](authentication.md),
[onboarding recovery](onboarding-release.md) and [Dokploy](../deployment/customer_deployment_guide.md#ingress) runbooks.
[Architecture](../../architecture.md#user-management-release-compatibility) defines
the capability, role, credential and restore boundaries. Record actual evidence and
target acceptance in [IN_PROGRESS.md](../../IN_PROGRESS.md). This runbook does not
authorize changing an installation or deploying a customer environment.

## Prepare the candidate

Use the pinned toolchain and a stable host clock. OPS-003 records backward host/WSL
clock steps; a passing JWT test on that host does not establish reliable time. Keep
customer rollout paused until time and target canonical DNS/TLS are verified.

```bash
pnpm check
pnpm build
pnpm test
pnpm test:integration
pnpm test:browser:auth
pnpm test:browser:onboarding:structured
pnpm test:browser:structure
pnpm test:browser:people
docker build -f apps/dms-api/Dockerfile -t turnstile360-authority:release .
docker build -f apps/turnstile-api/Dockerfile -t turnstile360-api:release .
docker build -f apps/turnstile-web/Dockerfile -t turnstile360-web:release .
pnpm test:images:user-management turnstile360-authority:release turnstile360-api:release turnstile360-web:release /private/candidate.json
```

Create `/private` outside the checkout with mode 0700; use new mode-0600 output/input
files. Place no secrets in arguments, shell history, build variables or evidence. The
image check starts the actual immutable entrypoints without network access, host ports,
root privileges or a writable root filesystem. It compares deployed compiled files,
public packages, migration journals and SQL, checks closed readiness, packaged private
commands and web route/security policy. TypeScript build caches are not deployed artifacts.
The inventory binds these images, commands and assets to one SHA-256 `releaseId`.
Any code/helper change requires rebuilding affected images and generating a new inventory.

## Archive and rehearse the existing local installation

The helpers deliberately accept only the existing local profile at
`http://localhost:23600`, the fixed database port 23603 and unchanged installation IDs.
They do not provision customer installations. Stop Compose Watch, host API/private
processes, scheduled jobs and other incompatible readers/writers before stopping the
three application containers. Keep PostgreSQL and Mailpit available. On a release that
already has the feature, run private `close` first; on the pre-feature installation,
stopping every process is the initial maintenance boundary.

```bash
docker compose stop turnstile-web turnstile-api dms-api
pnpm release:backup:user-management:local /private/um-release /private/candidate.json < /private/manager-access.json
pnpm release:rehearse:user-management:local /private/um-release
```

`manager-access.json` uses the existing private access-assignment shape:
`{operatorId,userId,enabled:true,permissions:[...]}`. Select the intended existing,
verified, unbanned account; include shell/configuration access and every retained
permission. Backup validates the selection without granting administrator status.
It requires all three containers stopped, retains their prior image IDs, six private
environment files, ownership/ACL archive, migration state and nonsecret fingerprints.
An incomplete output directory is not a recovery point. Retain keys and external role
credentials under the protected backup policy; a database dump excludes role passwords.

The rehearsal restores into a disposable pinned PostgreSQL container with generated
clone credentials. It verifies original fingerprints, runs compiled owning migrations
twice, imports legacy sources repeat-safely, and checks preservation of accounts,
clients, enrollment, exact grants/status and saved setup. It exercises the same six-role
credential-retirement function used at cutover, including an established old connection
and rejected old passwords. It then rotates a clone-only external recovery epoch,
quarantines mail, verifies closed readiness and runs six synthetic fresh/partial/completed
v1/v2 archive cases. The source archive and live installation remain unchanged.

To rehearse an older protected completed-v1 onboarding archive without adding files to it, supply
the current inventory and a new private result path explicitly:

```bash
pnpm release:rehearse:user-management:local /private/older-archive /private/candidate.json /private/older-archive-rehearsal.json
```

## Cut over with writers closed

Proceed only for the selected authorized installation after successful rehearsal.
Record the operator, archive checksum, image IDs and expected retained state. There is
no mixed-version rolling release. Keep application processes stopped while retiring
all six dedicated runtime/migrator credentials and terminating their old connections:

```bash
pnpm release:retire:user-management:local /private/um-credential-retirement
pnpm --filter @thaarei/dms-api db:migrate:auth
pnpm --filter @thaarei/dms-api db:migrate:dms
pnpm --filter @thaarei/turnstile-api db:migrate:turnstile
pnpm --filter @thaarei/turnstile-api access:operator initialize < /private/operator.json
pnpm --filter @thaarei/turnstile-api access:operator inspect < /private/operator.json
pnpm --filter @thaarei/turnstile-api access:release verify < /private/operator.json
```

`operator.json` contains only `{operatorId}`. The retirement helper validates the fixed
installation and stopped containers, saves protected previous/replacement files, rotates
distinct credentials, terminates connections, rejects old passwords and verifies every
replacement before installing configuration. If any stage fails, leave all processes
stopped and reconcile the protected files; do not restore old passwords to retry. It
does not stop unrelated processes for you. Retire old automation/deployment secret
copies too. Do not rerun fresh database-role provisioning against the target.

The migrations preserve original legacy rows as frozen recovery inventory and remove
runtime SELECT on them. Canonical initialization creates no implicit administrator or
role assignment. Compare the recorded account/client/setup/enrollment and grant data
before admitting traffic; preserve exact completed-v1/v2 state and stored zones.

Configure the distinct authority identity-service client ID/resource on the authority
and product. Issue its separate credential through `auth:manage-client`, using protected
stdin and an exclusive protected `credentialFile` as described in the authentication
runbook. Its kind is `identity_service`, with exactly `identity:invitation:prepare` and
`identity:subjects:read`; it is separate from login and DMS-machine registration. Supply
the resulting client secret and private authority transport URL only to the product API.
Preserve existing login/machine registrations and encryption/signing keys.

Supply a dedicated invitation encryption key and independently generated external
recovery epoch through the private product environment, together with local Mailpit
SMTP settings. The epoch is 32 random bytes encoded as canonical base64url. Never copy
an epoch from a restored database/backup to make readiness pass. Persistent containers
receive runtime secrets only; private commands additionally receive the owning migrator
environment. Web/Vite never receives either.

Start the exact verified authority/API/web images together with writers still closed.
Use production commands (`node dist/main.api.js`, `node dist/main.js`, Nginx on 8080),
their `/app` working directory and runtime configuration. The normal development Compose
commands target `/workspace` and Vite on 5173: they are not an exact-image release.
For the local target, prepare a private Compose override that replaces development
build/command/working-directory/environment/volumes/watch/health settings, binds web
23600 to Nginx 8080, retains API ports 23601/23602, and routes the existing same-origin
identity/API paths through the established ingress. Set `COMPOSE_FILE` consistently
for startup and the verifier. Validate the merged configuration privately; it may
contain secrets. Do not add ingress, proxy trust, random service ports or fallback origins.
On Dokploy, use its existing private network and ingress/TLS configuration instead.

## Explicit administrator handover and opening

Have the selected existing verified user sign in through the ordinary product flow.
Do not reset the user's password/profile or create a synthetic target administrator.
Provide the current normal HttpOnly product cookie privately to the operator; the CLI
validates/decrypts its server-side session and verifies current identity with the authority.
No userinfo access token is exposed to the browser or operator output.

Prepare fresh strict JSON input for each operation:

| Operation                 | Private input fields                                                                               |
| ------------------------- | -------------------------------------------------------------------------------------------------- |
| `bootstrap-administrator` | `operatorId`, UUID `key`, current `expectedRevision`, `administratorUserId`, `administratorCookie` |
| `verify-login`            | `operatorId`, `administratorUserId`, `administratorCookie`                                         |
| `open`                    | Bootstrap fields plus inventory `releaseId` and `incompatibleProcessesStopped:true`                |
| `close`                   | `operatorId`, UUID `key`, current `expectedRevision`                                               |
| `recover`                 | Close fields plus `incompatibleProcessesStopped:true`; fresh epoch comes from environment          |

```bash
pnpm --filter @thaarei/turnstile-api access:release bootstrap-administrator < /private/bootstrap-administrator.json
pnpm --filter @thaarei/turnstile-api access:release verify-login < /private/verify-login.json
pnpm --filter @thaarei/turnstile-api access:release open < /private/open.json
pnpm release:verify:user-management:local /private/candidate.json /private/target-verification.json < /private/verify-login.json
```

Refresh the ordinary session/cookie and read the current access revision after bootstrap
and before open. Receipt retries use the same key and exact payload; changed intent uses
a new key and current revision. Expired/rotated cookies require current login proof.
The private probe authenticates the distinct identity-service registration against the
versioned authority route without creating an account/preparation. Open also requires
complete import, safe schema/ACLs, current protected administrator and manager counts,
full invitation configuration and the bound external epoch. Startup cannot open it.
The verifier requires the exact three running images, real protected login, compatible
open state, completed workspace and independent administration/structure reads. It
creates no account, role, invitation or grant. Its output is bounded nonsecret evidence.

Run the deliberately approved target Mailpit invitation/acceptance, suspension,
reapproval and scoped-move checks with suitable test participants. Do not manufacture
customer changes as part of a read-only verifier. Check normal login, refresh/logout,
role-only access and separate People/configuration/structure permissions. Retain the
archive, evidence, operator handover and compatible candidate; remove transient cookie
inputs promptly. Local Mailpit capture does not establish external email acceptance.

## Failure, restore and compatible rollback

Keep writers closed on uncertainty; inspect receipts/current state before retrying a
possibly committed operation. `close` does not require a live authority. A process
already inside SMTP can finish truthfully; closing is not a claim to unsend email.
Stop and fence processes before restore. Application rollback may use only a verified
access-aware image set enforcing this schema, canonical authorization, version barrier,
epoch and session fencing. No pre-feature image/flat-access CLI is compatible after
writers open. No earlier immutable set has been approved; fix forward with the candidate
while in maintenance if no tested alternative exists.

A database restore is a separate explicit recovery decision accounting for post-backup
data and external side effects. Restore the whole coherent installation with ownership,
ACLs, original identities and encryption/signing keys; preserve current retired-role
passwords and reconcile protected runtime configuration. Do not restore old credentials
or start application/delivery processes. Apply compatible owning migrations and explicit
canonical initialization if the archive predates them. Then generate a **new external
invitation recovery epoch**, supply it to the private command and future runtime, and run:

```bash
pnpm --filter @thaarei/turnstile-api access:release recover < /private/recover.json
pnpm --filter @thaarei/turnstile-api access:release verify < /private/operator.json
```

Recover closes writers, binds the new epoch, invalidates pending invitations, retires
queued/in-flight captured payloads and leases, and records operator audit/receipt in one
transaction. Accepted membership and grants remain unchanged. Reusing the current or
historically retained invitation epoch is rejected. Old runtime epochs fail readiness,
and old links/work cannot become authoritative after restart. Recreate the distinct
identity-service registration privately only if the restored archive predates it; retain
other registrations. Start only compatible processes, prove current administrator login,
then deliberately open the matching release. Eligible invitations need explicit new
approval/resend; historical accepted access is not re-created from a stale link.

Record unavailable container DNS/TLS, unstable-clock checks, actual target cutover and
customer deployment separately from source, isolated archive and image verification.
