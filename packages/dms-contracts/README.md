# Thaarei DMS contracts

Architecture and component boundaries: [architecture.md](../../architecture.md).

Private package for language-independent DMS payload definitions: public requests and
responses, private job messages, durable events, processing artifacts, statuses, and
error codes. Define Zod schemas here and infer TypeScript types from those schemas.
Generate JSON Schema for Python and OpenAPI for API consumers from those definitions.

The DMS API validates payloads against these contracts. The DMS client uses the same
types, and Python validates exported schemas. Contracts must not import NestJS services,
database models, or Turnstile business code. Domain decisions remain in DMS modules.

AUTH-05 exports Zod enrollment request/receipt, minimal capabilities and stable error
schemas, their inferred types and JSON Schema exports, plus the machine-scope and
reserved-principal catalogs. Run `pnpm docs:dms-auth` after contract changes to regenerate
the committed [OpenAPI artifact](../../docs/api/dms-auth.openapi.json). After building,
`node scripts/generate-dms-auth-openapi.mjs --check` verifies it is current.
Scope membership does not replace live registration or operation/resource authorization.
The policy is maintained in [architecture.md](../../architecture.md#dms-machine-authorization-and-guarded-enrollment).
