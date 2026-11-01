# Turnstile 360 API

Architecture and component boundaries: [architecture.md](../../architecture.md).

NestJS/Fastify backend for the Turnstile 360 application. It owns product business rules,
user authorization, and business data. It integrates with the reusable DMS through the
server-side DMS client and authenticated HTTP calls. Business functionality follows a
separate specification; document/business operations remain pending.

The [Turnstile architecture](../../architecture.md#turnstile-application-architecture)
defines the shared web/future-mobile API, backend authority, and DMS integration.

`GET /api` returns application identity. `GET /health/live` reports process liveness.
Run `docker compose up --build --watch` from the repository root; the private container API port is 3002.
See the root README for setup and checks.

This is proprietary Thaarei software under the root LICENSE.

AUTH-04 adds the OIDC BFF routes `/api/auth/login`, `/api/auth/callback`,
`/api/auth/session` and POST `/api/auth/logout`, using the owned encrypted PostgreSQL
session store. The global user guard checks live authority activity and explicit local
permissions; authority administrator privileges do not grant product access. There is
no runtime memory store. `GET /health/ready/auth` requires valid configuration, the owned
installation/migrations and a reachable authority accepting the configured login client.
Identity/liveness remain separate. AUTH-07 supplies the login/recovery UI and fixed browser failure destinations; API callers retain JSON errors. Follow the
[operator runbook](../../docs/runbooks/authentication.md) and
[architecture](../../architecture.md#turnstile-bff-and-user-authorization-boundary) and
[OpenAPI contract](../../docs/api/turnstile-auth.openapi.yaml).

Deploy the committed `0003_user_permissions.sql` migration before using AUTH-04.
After provisioning/verifying an authority account and issuing the confidential login
client, use the private `auth:set-access` command with `.env.migrate` to assign local
access. It accepts a private JSON stdin object containing `userId`, `enabled` and
`permissions`. It never runs during startup or login.

AUTH-06 adds `GET /api/dms/capabilities`, requiring both `turnstile:access` and
`turnstile:dms:capabilities:read` after live identity/local checks. The backend uses its
separate machine token through `@thaarei/dms-client`, verifies the installation/application
binding and returns only product capability lists. Machine/DMS failure preserves the user
session. Configure and enroll the machine client explicitly using the
[runbook](../../docs/runbooks/authentication.md#verify-the-typed-cross-service-capability-request).
No new migration is required for AUTH-06; existing users need explicit assignment of the
new action permission. No browser credentials, actor headers or tenant selectors are forwarded.

Local host testing uses fixed port 23602. Browser authentication uses
http://localhost:23600. See the [reserved ports](../../architecture.md#reserved-local-ports).
