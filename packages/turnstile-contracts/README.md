# Turnstile 360 contracts

Private package for requests, responses, validation schemas, error codes, and pagination
shared between `turnstile-web`, `turnstile-api`, and a future Expo/React Native client.
Clients and backend consume the same contract definitions. Clients own presentation and
interaction; the backend owns authoritative business logic and validation.

The package must remain platform-independent and free of DOM, Node-only, NestJS, database
dependencies, server credentials, and the DMS's internal processing contracts. Turnstile's backend translates
between its product API and the DMS API where needed.

Business payloads will be defined after Turnstile functionality is specified. The current
package establishes that ownership without inventing product features.
