# Thaarei DMS client

Architecture and component boundaries: [architecture.md](../../architecture.md).

Private server-side HTTP integration package for trusted applications, including
`turnstile-api`, to call the reusable DMS without importing its NestJS implementation.

AUTH-06 implements typed `DmsClient.capabilities()` and explicit `enroll()` over shared
runtime-validated contracts, plus `ClientCredentialsTokenProvider`. The client accepts
an injected `MachineTokenProvider` and fixed backend configuration; it has no DMS business
rules, database access or Turnstile user authorization. Browser imports are forbidden.

```ts
import { ClientCredentialsTokenProvider, DmsClient } from '@thaarei/dms-client';

// Values come from validated private backend configuration, never a request or browser.
const tokens = new ClientCredentialsTokenProvider({
  issuerUrl,
  clientId,
  clientSecret,
  resource,
  scopes: ['dms:capabilities:read'],
});
const dms = new DmsClient({ baseUrl: apiUrl, tokenProvider: tokens });
const capabilities = await dms.capabilities();
```

Issuer/resource use canonical HTTPS by default. Local HTTP and private-network DMS HTTP
require explicit `allowInsecureHttp` configuration. URLs cannot carry credentials/query/
fragment, and DMS transport must end in `/v1`. Redirects are rejected; cookies and arbitrary
browser headers are never forwarded. Defaults are five seconds per request and 16 KiB per
response. Optional bounded actor context is attribution only and must follow the consuming
backend's own user/permission check.

The provider coalesces acquisition/early renewal for its fixed issuer/client/resource/scope
partition. Rotation/configuration changes require replacing the provider. No machine refresh
tokens or authorization-state cache are used. Only a capability read with explicit
`MACHINE_TOKEN_EXPIRED` gets one automatic renewal/replay. Other 401s, all 403s, outages
and enrollment failures are returned immediately. `DmsClientError` exposes safe `code`,
`status`, `domainCode` and `retryable` fields; never log request credentials or raw payloads.

`enroll({ request: { name }, enrollmentKey, idempotencyKey })` is operator provisioning,
never routine startup. An explicit retry must preserve its key, body and idempotency key
within the receipt window. A retryable conflict does not cause an automatic mutation retry.
See the [runbook](../../docs/runbooks/authentication.md#register-and-enroll-a-dms-machine-application)
and [architecture](../../architecture.md#typed-machine-client-and-cross-service-capability-request).
Document/upload/processing operations are added only with their corresponding capabilities.
