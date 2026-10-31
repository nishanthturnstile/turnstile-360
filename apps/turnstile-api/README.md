# Turnstile 360 API

NestJS/Fastify backend for the Turnstile 360 application. It owns product business rules,
user authorization, and business data. It integrates with the reusable DMS through the
server-side DMS client and authenticated HTTP calls. Business functionality follows a
separate specification; no business modules or DMS operations are implemented yet.

This API will serve both the web application and a future Expo/React Native application.
Business rules, authorization, domain calculations, and persistence belong in backend
services. Both clients use the same versioned contracts and submit changes for the
backend to validate and apply; no separate mobile backend is planned.

`GET /api` returns application identity. `GET /health/live` reports process liveness.
Run `pnpm dev:turnstile` from the repository root; the default API port is 3002.
See the root README for setup and checks.

This is proprietary Thaarei software under the root LICENSE.
