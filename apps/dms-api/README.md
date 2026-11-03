# Thaarei DMS API

Architecture and component boundaries: [architecture.md](../../architecture.md).

NestJS/Fastify control API for the Thaarei Document Management System. Feature modules
follow the accepted DMS requirements. The shared identity authority, document operations,
and processing coordination are implemented in their respective modules as work proceeds.

`GET /v1` returns application identity. `GET /health/live` reports process liveness;
it does not imply database, storage, scanner, or processing readiness.

Run `docker compose up --build --watch` from the repository root. The private container port is 3001. See the root
README and workspace implementation plan for setup, checks, and capability status.

This is proprietary Thaarei software under the root LICENSE.

AUTH-02 mounts the native authority under `/identity`, with owned auth/DMS migrations,
private verified-account provisioning and controlled SMTP recovery. `GET /health/ready/auth`
returns 200 after validated configuration, owned database roles and installation bootstrap;
invalid configuration or unavailable/mismatched persistence returns 503.
Identity/liveness remain separate. Follow the
[operator runbook](../../docs/runbooks/authentication.md) and
[architecture](../../architecture.md#owned-persistence-and-authority-handler).

AUTH-03 adds distinct confidential login/machine client policy and the private
`auth:manage-client` command for issuance, inspection, immediate secret rotation,
suspension and machine scope assignment. Follow the [OAuth operations runbook](../../docs/runbooks/authentication.md#issue-and-manage-distinct-oauth-clients).
No client is created at startup; real installation provisioning remains an operator action.

AUTH-05 adds default-deny machine JWT authorization, live registration/scope checks,
transactional enrollment and replay, local-first disablement and bounded security audit.
`GET /v1/capabilities` advertises the implemented auth operations; document formats and
processing capabilities remain empty. `POST /v1/application-enrollments` is the only
pending-consumer exception. The private `dms:manage-application` command registers approved
machine clients and manages enrollment keys/status/ceilings. See the
[enrollment runbook](../../docs/runbooks/authentication.md#register-and-enroll-a-dms-machine-application),
[machine boundary](../../architecture.md#dms-machine-authorization-and-guarded-enrollment)
and [OpenAPI contract](../../docs/api/dms-auth.openapi.json). Apply the committed DMS
migrations before starting the updated runtime. No real installation is provisioned by tests.

Local host testing uses fixed port 23601. Browser authentication uses
http://localhost:23600. See the [reserved ports](../../architecture.md#reserved-local-ports).
