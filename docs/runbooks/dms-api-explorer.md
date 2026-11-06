# Consumer API explorer and independent manual testing

DMS-I02 exposes only implemented consumer operations. Use the
[standalone foundation runbook](dms-standalone.md) first for database migration/bootstrap,
verified operator setup and independent client provisioning. The accepted technical
contract is maintained in [architecture](../../architecture.md#consumer-api-contract-and-explorer-dms-i02).
The explorer includes implemented registry, upload and batch status reads. Use the
[lifecycle runbook](dms-uploads.md) for backend-only mutations and direct transfer;
completion intent is not processing approval or publication. Effective formats remain
closed until their owning security implementations are installed. Swagger does not
replace business authorization in a consumer backend or its machine authorization at DMS.

## Enable controlled access

The explorer is **off by default**, including production. Supply `DMS_DOCS_MODE=loopback`
only with a loopback listener (`HOST=127.0.0.1`, `localhost` or `::1`). A container listener
or remote installation requires the explicit `controlled` mode and operator-controlled
ingress. Both enabled modes require an independently generated `DMS_DOCS_ACCESS_KEY`
(32–256 characters, at least 16 distinct characters, no colon/newline). Use a different
value from every machine credential, account password and authority secret. Production
requires the configured HTTPS authority origin and Dokploy TLS; configure ingress to
restrict operator access as well. Never expose this key through Vite or browser build
configuration. Invalid enabled configuration fails startup rather than exposing docs.

Open `/docs` on the DMS listener (23601 for the reserved local application binding).
Authenticate with Basic username `operator` and the docs access key. This separate gate
protects UI, schema, configuration, YAML aliases and all bundled assets. It confers no
DMS operator grant or machine authority. Disable docs by setting mode back to `off`.
The profile does not allocate another host port or create an account/client at startup.

The authoritative consumer schema is `/docs/openapi.json`. The bundled UI uses the same
document through `/docs/json`; `/docs/yaml` is an authenticated rendering of it. All use
private/no-store caching. No private identity-service, operator or future job schema is
served here. Assets and their third-party notices come from the pinned local Swagger UI
distribution. URL query overrides are discarded at the UI entry; no remote validator,
CDN, telemetry, OAuth client-secret flow or external schema is enabled.

## From new client to an enrolled token

1. Follow foundation setup through verified private operator bootstrap. Privately issue
   a machine client with explicit `clientId`, a stable `applicationId` UUID and
   `scopes: ["dms:capabilities:read"]` using `auth:manage-client`. Use an exclusive private
   credential file, then `dms:manage-application` to register the exact same identity,
   name and scope ceiling. Use `issue-key` to a new protected file. Precise command JSON
   contracts are in [authentication operations](authentication.md#issue-and-manage-distinct-oauth-clients).
2. Use the independent Python example below to obtain a short-lived DMS-audience token
   outside the browser. It writes an exclusive mode-0600 token file without printing it.
3. Enroll using that token, the bound one-time enrollment key, registered name and a
   stable idempotency key. Retain that operation key for uncertain-response readback;
   identical retries replay the same nonsecret receipt for 24 hours after reauthorization.
   A different body conflicts; concurrent work returns `ENROLLMENT_IN_PROGRESS` with
   `Retry-After: 1`. Do not rotate/reissue keys as an automatic retry strategy.
4. Read capabilities through the backend example. Then read the **access token only**
   from its protected file in a private editor and paste it into Swagger's `MachineBearer`
   field. Never paste the client secret or enrollment key. The bearer lives in page memory;
   reload clears it. Avoid screenshots, copied request snippets and saved release evidence
   containing tokens. A token expires within five minutes; obtain another privately.
5. Expand GET capabilities and select “Try it out”, then Execute. Normal registration,
   audience, issuer, expiry and scope checks still apply; docs credentials/cookies do not
   satisfy them. Enrollment is documented but browser execution and its authorization
   input are disabled. Use CLI/backend enrollment instead.

## Standard-library Python backend

[backend.py](../../examples/dms/backend.py) imports no workspace or third-party module.
It ignores ambient proxy settings, refuses noncanonical destinations, nonloopback plaintext
HTTP and redirects, bounds
input/response size and request deadlines, and does not automatically retry mutations.
Run with the pinned Python interpreter (for example through `uv run --project
apps/dms-processing --locked python`). Keep each input under 8192 bytes in a private file:

| Operation      | Protected stdin fields                                |
| -------------- | ----------------------------------------------------- |
| `token`        | `issuer`, `resource`, `clientId`, `clientSecret`      |
| `enroll`       | `resource`, `enrollmentKey`, `name`, `idempotencyKey` |
| `capabilities` | `resource`                                            |

The resource is the canonical DMS `/v1` URL, which the example also uses as its API base;
the issuer is its configured `/identity` URL. Credential input stays on the backend.
The consumer must check its own user's business rights before calling DMS in a real app.

```bash
python examples/dms/backend.py token --token-file /secure/new-access-token.json < /secure/token-input.json
python examples/dms/backend.py enroll --token-file /secure/new-access-token.json < /secure/enrollment-input.json
python examples/dms/backend.py capabilities --token-file /secure/new-access-token.json < /secure/capabilities-input.json
```

Use a new token-file path for each issuance. Enrollment/capabilities reuse it only while
valid for that exact resource. The example reports controlled HTTP status failures and
never prints error bodies, machine secrets or the token. It is an integration aid, not
a published SDK, session UI or client-side authorization implementation.

## curl alternative

Copy [token](../../examples/dms/token.curl.example),
[enrollment](../../examples/dms/enroll.curl.example) and
[capabilities](../../examples/dms/capabilities.curl.example) configuration templates to
fresh files in a private 0700 directory, chmod them to 0600, and replace placeholders in
a private editor. These contain secrets; never commit them. Use protected config files
so Authorization/client credentials do not appear in process arguments. Do not enable
redirect following, verbose tracing or shell tracing. `--disable` must be the first curl
option so ambient `.curlrc` settings cannot enable those behaviors. The examples use
direct connections: Python disables environment proxies and curl uses `--noproxy '*'`.
A consumer that requires a proxy must configure it explicitly in its deployment;
these examples never inherit one silently.

```bash
umask 077
curl --disable --noproxy '*' --silent --show-error --fail --max-time 10 --config /secure/token.curl --output /secure/token-response.json
curl --disable --noproxy '*' --silent --show-error --fail --max-time 10 --config /secure/enroll.curl --output /secure/enrollment-result.json
curl --disable --noproxy '*' --silent --show-error --fail --max-time 10 --config /secure/capabilities.curl --output /secure/capabilities.json
```

Copy only the returned access token into the subsequent protected curl header files or
Swagger. The raw curl token response uses `access_token`; the Python file uses
`accessToken`. Never put either in a URL. DMS responses disclose a fresh server-generated
`X-Request-Id`, a finite error code/retryable flag and normal HTTP status. Retryable 503s
include `Retry-After: 1`; a 409 idempotency conflict requires reconciliation rather than
blind retry. The configured consumer API publishes no ETag or 202 operation today; future
owning features adopt the reserved revision and polling conventions when implemented.

## Contract and image verification

`pnpm docs:dms` regenerates `docs/api/dms.openapi.json`; `pnpm check:contracts` checks its
drift, examples, local references, unique operations, security/header catalog and shared
positive/negative JSON fixtures in Zod, Ajv 2020 and Python. The legacy
`dms-auth.openapi.json` remains compatible and drift-checked. Runtime tests compare every
real versioned Nest handler with the public route/policy catalog and assert docs access
cannot replace machine authorization. Schema validators are development-only dependencies.

`pnpm test:dms:standalone` exercises the independent Python/curl backend and real Chromium
explorer in addition to foundation regressions. Set `DMS_STANDALONE_IMAGE` to a freshly
built DMS image tag to verify its UI/assets/spec and a real machine capability call.
On Docker Desktop, browser requests travel over private fixture IPC to real HTTP in the
container; neither responses nor authorization are mocked, and no host port is published.
No tokens, client secrets or enrollment keys are saved as evidence. Existing installation
state is preserved. Customer ingress/TLS/SMTP acceptance remains separate.

GET `/v1/audit` is available to explicitly provisioned `dms:audit:read` consumers. It
returns only their own bounded application audit with keyset pagination; see the
[audit runbook](dms-audit.md). Existing capability-only clients are not silently widened.
Private operator inspection is a process command and is absent from this explorer.
