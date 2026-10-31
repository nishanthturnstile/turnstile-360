# Turnstile 360 API

Architecture and component boundaries: [architecture.md](../../architecture.md).

NestJS/Fastify backend for the Turnstile 360 application. It owns product business rules,
user authorization, and business data. It integrates with the reusable DMS through the
server-side DMS client and authenticated HTTP calls. Business functionality follows a
separate specification; no business modules or DMS operations are implemented yet.

The [Turnstile architecture](../../architecture.md#turnstile-application-architecture)
defines the shared web/future-mobile API, backend authority, and DMS integration.

`GET /api` returns application identity. `GET /health/live` reports process liveness.
Run `pnpm dev:turnstile` from the repository root; the default API port is 3002.
See the root README for setup and checks.

This is proprietary Thaarei software under the root LICENSE.
