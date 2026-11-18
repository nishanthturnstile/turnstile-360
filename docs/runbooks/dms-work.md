# Authoritative work and private execution

The [architecture](../../architecture.md#authoritative-work-and-private-execution-foundation-i07)
owns role boundaries, state machines, limits, leases, recovery and deployment topology.
Apply DMS migrations through 0023 with the existing private migrator before starting the
coordinator. No installed data, identity, grant or broker configuration is created at startup.
I07 supplies durable coordination and fixed task transport. [I08 assessment](dms-assessment.md)
adds immutable selection and plain-text secure-only publication; other format/extraction
handlers remain unavailable. An unsupported handler never passes a file.

## Installation inputs

Build the matching API and processing images from the monorepo root. The processing image
installs the production environment from `uv.lock`; it includes Celery, its AMQP transport,
native dependency wheels and the generated private contract. It does not install dependencies
or download models when starting. The private coordinator runs `node dist/main.coordinator.js`
from the same DMS image as the public API; its controllers are absent from public bootstrap.

Create protected files from these templates:

- [coordinator](../../deploy/coordinator.env.example): dedicated coordinator database URL,
  installation binding, canonical authority issuer, trusted read-only capacity mounts and
  snapshot-role HEAD credentials. No auth database or consumer machine credentials.
- [work runtime](../../deploy/work-runtime.env.example): four separate files for publisher,
  scanner, extractor and heavy roles, each with its own OAuth and broker credentials.
- [broker installation](../../deploy/work-broker.env.example): private one-off input for
  generating explicit broker definitions. Do not load these other roles' passwords into workers.

The coordinator observes actual storage/scratch mounts. A missing mount or observation
failure closes new admission without stopping independent work recovery. Mounting an API
overlay filesystem does not measure storage capacity. Preserve existing installation IDs
and storage volumes; do not attach an unrelated customer installation.

## Authority and live work grants

Privately issue confidential clients with `auth:manage-client`, using fresh verified
administrator credentials via protected JSON stdin. Use distinct explicit `clientId` and
`applicationId` UUID for each service. The purpose/scope pairs are:

| Kind             | Scope              | Runtime role |
| ---------------- | ------------------ | ------------ |
| `work_publisher` | `dms:work:publish` | publisher    |
| `work_scanner`   | `dms:work:scan`    | scanner      |
| `work_extractor` | `dms:work:extract` | extractor    |
| `work_heavy`     | `dms:work:heavy`   | heavy        |

An issuance input has the same protected operator fields/`credentialFile` contract as
[ordinary client management](authentication.md#issue-and-manage-distinct-oauth-clients),
with one of these kinds and exactly its one scope. Never place secrets in arguments,
URLs, source control, browser bundles or logs. Work clients use the separate canonical
resource `{AUTH_ISSUER_URL}/services/work`, not the consumer `/v1` resource. Do not enroll
work clients as consumer applications. Public issuer discovery may name supported scopes;
scope names confer no authority.

A current explicit DMS operator then authorizes each approved work identity with
`dms:manage-operator`, fresh credentials and the separate operator DB role:

```json
{
  "action": "work-authorize",
  "operatorEmail": "operator@example.test",
  "operatorPassword": "replace-only-in-protected-input",
  "clientId": "dms-scanner-01",
  "role": "scanner"
}
```

Use the existing protected command invocation:

```sh
node --env-file=/protected/authority.env --env-file=/protected/operator.env \
  apps/dms-api/dist/modules/access/manage-operator.js < /protected/work-authorize.json
```

The command validates the issued client's purpose, tenant, resource and scope before
enabling its live DMS grant. It cannot replace an existing identity's role. Use
`action: "work-disable"` plus `clientId` to immediately deny its private API authority;
existing leases/results are still checked. OAuth suspension stops new token issuance,
while already-issued JWTs remain cryptographically valid until their bounded expiry.
An authority administrator without a DMS grant cannot authorize work. Bootstrap/recovery
uses the existing explicit procedure rather than implicit grant creation.

## Broker and isolated topology

Choose distinct independent broker credentials and write a new definitions file explicitly.
From the pinned checkout, the private one-off can load its protected environment without
putting passwords in arguments:

```sh
pnpm --filter @thaarei/dms-processing exec uv run --locked \
  --env-file /protected/work-broker.env turnstile-processing broker-config \
  --output /protected/new-work-broker-definitions.json
```

The output is exclusive mode 0600 and contains salted password hashes. Protect it as
installation material; the command refuses to overwrite existing output. It declares the
`dms` vhost, durable work/dead-letter queues and topic bindings, separate per-role users,
native queue permissions and role-specific topic keys. Publisher cannot consume or
configure queues; workers can consume/bind only their own queue and publish only their
own retry routing key. There is no shared/default application broker principal.

Install that file as `.env.work-broker-definitions.json` through the protected installation
procedure. The optional overlay loads it as a secret and keeps management bound to loopback.
The complete selected Compose reference uses all four files:

```sh
docker compose --project-name thaarei-dms --env-file /protected/compose.env \
  -f deploy/compose.dms.yaml -f deploy/compose.storage.yaml \
  -f deploy/compose.dms-uploads.yaml -f deploy/compose.dms-work.yaml config --quiet
```

The shown project name is for the foundation reference. An existing installation keeps
its recorded project name and volume mappings when adding overlays; changing that name
can select different volumes. Build/deploy through the installation's authorized procedure.
This profile publishes
no new host port and is not a Dokploy ingress target. Coordinator connects to private
database/storage/work networks. Publisher and workers receive only work/broker networks,
no DB credentials or general storage keys. The public DMS process supplies its existing
OAuth endpoint on the work network and does not mount job handlers. Public issuer/TLS
remain canonical; the template's explicit plaintext opt-in applies only to isolated private
HTTP/AMQP hops. Never route `/internal/work` or broker management through public ingress.

`turnstile-processing topology` is an explicit topology installer for a separately approved
private broker administrator. Ordinary publication does not silently recreate a missing
binding. A missing route returns an unroutable outcome and retains delivery for repair.

## Inspecting progress and failures

Private worker/publisher endpoints and schemas are in the generated
[work contract](../api/dms-work.contract.json), separate from consumer OpenAPI. Native tasks
carry only versioned job/dispatch IDs, generation and a fixed task name. They do not carry
credentials, lease tokens, bytes or caller-selected destinations. Worker claims receive
their own short-lived lease only after current private identity and source checks.

Use fresh `work-inspect` JSON stdin with `jobId` and operator credentials to inspect a
bounded job plus its dispatches/attempts. It reports execution/recovery counters, deadlines,
last routing error and claimants without lease tokens/hashes or broker credentials. Pending
publication, queue wait, execution, retry waiting and terminal failure remain distinct.
Generic domain outbox intentions with no installed subscriber do not become undeliverable
task deliveries. I07 enqueues work only through an owning internal use case; it exposes no
public job creation or redrive route.

Publisher delivery is acknowledged only after mandatory routing and broker confirmation.
If it crashes between confirmation and receipt, another publisher can resend that dispatch
after its delivery lease expires. PostgreSQL still permits only one active attempt.
Identical accepted results are idempotent; changed/stale results are rejected.

Celery owns ordinary transient retries after the private API records their eligibility.
The coordinator recovers a missing retry only after eligibility plus grace, and a dead
attempt only after lease expiry plus grace. Heartbeats cannot renew expired leases or
extend a hard deadline. Recovery preserves the existing three-execution/elapsed budget,
and exhaustion is an explicit failed outcome. Fix underlying routing or service failures;
do not reset execution counters or blindly republish stale generations by hand.

The coordinator discovers uploaded bytes by exact persisted staging reference even when
the client misses its completion callback. HEAD size/type metadata can yield OBJECT_VERIFIED
or a bounded failure reason. It is not streamed checksum verification, a malware pass or
publication. Cancellation/expiry/source disablement wins against later observation/results;
logical documents remain unavailable until the owning security feature succeeds. Trusted
physical cleanup/accounting release remains separate and waits beyond issued capabilities.
I07 starts no object inventory/purge, public job API, archive import or processor success claim.

## Verification

`pnpm test:integration` exercises real disposable PostgreSQL/SeaweedFS/RabbitMQ, private
JWT HTTP and Celery prefork workers. It covers confirmed durable routing, Basic.Return,
normal/lost retry publication, duplicate delivery receipts, worker loss, stale leases,
execution-budget retention, private-role revocation, native queue/topic ACLs, forbidden
non-JSON content and missed completion callbacks. These fixtures do not use installed
customer data, credentials, volumes or service ports. The processing `check` command
validates runtime imports/packaged contracts without starting a worker or broker connection.
