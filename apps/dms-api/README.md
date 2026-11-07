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
`GET /v1/capabilities` advertises implemented auth operations and policy-enabled
secure-only plain-text assessment from I08; enrichment capabilities remain empty. `POST /v1/application-enrollments` is the only
pending-consumer exception. The private `dms:manage-application` command registers approved
machine clients and manages enrollment keys/status/ceilings. See the
[enrollment runbook](../../docs/runbooks/authentication.md#register-and-enroll-a-dms-machine-application),
[machine boundary](../../architecture.md#dms-machine-authorization-and-guarded-enrollment)
and [OpenAPI contract](../../docs/api/dms-auth.openapi.json). Apply the committed DMS
migrations before starting the updated runtime. No real installation is provisioned by tests.

Local host testing uses fixed port 23601. Browser authentication uses
http://localhost:23600. See the [reserved ports](../../architecture.md#reserved-local-ports).

Standalone foundation installation and private operators: [runbook](../../docs/runbooks/dms-standalone.md).

Protected consumer explorer and external-backend examples: [manual testing](../../docs/runbooks/dms-api-explorer.md).

DMS-I03 adds owning transaction/principal context, immutable application audit and atomic
outbox intent. GET /v1/audit requires dms:audit:read and remains owner-scoped; private
dms:manage-operator audit-read uses fresh identity and a current DMS operator grant.
Provision the two private roles before DMS migrations 0006–0007; see the
[audit runbook](../../docs/runbooks/dms-audit.md). Document audit extends this boundary
when document persistence ships; no dispatcher or document endpoint is added here.

DMS-I04 internal S3 primitives and restricted transfer ingress: [storage runbook](../../docs/runbooks/dms-storage.md). Admission and document capability issuance remain later increments.

DMS-I05 registry reads and internal transactional admission: [admission runbook](../../docs/runbooks/dms-admission.md). Public lifecycle routes are described in the I06 runbook below.

DMS-I06 adds upload/batch lifecycle control and durable completion intent: [runbook](../../docs/runbooks/dms-uploads.md). Effective formats stay closed until the owning security implementations are installed.

DMS-I07 private coordinator, work grants and fenced execution: [work runbook](../../docs/runbooks/dms-work.md). Public bootstrap has no work endpoints. DMS-I08 assessment/publication: [runbook](../../docs/runbooks/dms-assessment.md).

DMS-I09 implements the first usable secure document transfer increment for text/plain +
secure-only: current-original download capabilities with live authorization, exact
security evidence, short expiry and safe signed range responses. See the
[secure transfer runbook](../../docs/runbooks/dms-secure-transfer.md). This does not
claim full DMS v1, historical content selection or production acceptance.

DMS-I10 adds guarded replacement uploads, current version history/status, explicit historical
downloads and restoration as a new reassessed revision referencing protected bytes. See the
[version runbook](../../docs/runbooks/dms-versions.md); new-version batch items share the
normal admission/PUT path. Metadata editing, application sharing and physical purge remain
separate increments.

I11 adds revision-checked logical metadata/tags and application-namespaced references.
See the [metadata runbook](../../docs/runbooks/dms-metadata.md).

I12 adds explicit owner/operator-managed application grants. See the
[sharing runbook](../../docs/runbooks/dms-sharing.md) for rights, scopes and revocation.

I13 adds owner/operator soft deletion, lifecycle inspection and bounded logical restore.
See the [lifecycle runbook](../../docs/runbooks/dms-lifecycle.md).

I14 native/Office/tabular/email runtime and manual qualification: [extraction runbook](../../docs/runbooks/dms-extraction.md).

I15 English OCR, mixed pages and qualification: [OCR runbook](../../docs/runbooks/dms-ocr.md).

I16 results, reprocessing and optional offline structure: [results runbook](../../docs/runbooks/dms-results.md).

Permission-aware discovery: [runbook](../../docs/runbooks/dms-discovery.md).

I18 versioned standalone installation, separate API/processing readiness and private operational commands: [distribution runbook](../../docs/runbooks/dms-distribution.md).

Deployment pairing, private setup/rotation, restriction and combined customer profiles: [DMS deployment control](../../docs/runbooks/dms-deployment-control.md).
