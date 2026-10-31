# Turnstile 360 contracts

Architecture and component boundaries: [architecture.md](../../architecture.md).

Private package for requests, responses, validation schemas, error codes, and pagination
shared between `turnstile-web`, `turnstile-api`, and a future Expo/React Native client.
Clients and backend consume the same contract definitions. Clients own presentation and
interaction; the backend owns authoritative business logic and validation.

The package must remain platform-independent and free of DOM, Node-only, NestJS, database
dependencies, server credentials, and the DMS's internal processing contracts. Turnstile's backend translates
between its product API and the DMS API where needed.

The package exports the explicit local permission catalog and safe user-session, logout
and authentication-error DTOs, plus product-safe DMS capability/integration-error DTOs.
`turnstile:dms:capabilities:read` is a separate action permission alongside baseline
`turnstile:access`; it does not grant document operations or authority administration. The corresponding
[OpenAPI contract](../../docs/api/turnstile-auth.openapi.yaml) describes the browser boundary.
Business payloads and permissions will be defined when those features are implemented.
