# Thaarei DMS contracts

Private package for language-independent DMS payload definitions: public requests and
responses, private job messages, durable events, processing artifacts, statuses, and
error codes. Define Zod schemas here and infer TypeScript types from those schemas.
Generate JSON Schema for Python and OpenAPI for API consumers from those definitions.

The DMS API validates payloads against these contracts. The DMS client uses the same
types, and Python validates exported schemas. Contracts must not import NestJS services,
database models, or Turnstile business code. Domain decisions remain in DMS modules.

The package currently has no payload schemas. Definitions and generated artifacts are
introduced with implemented capabilities, rather than advertising unavailable endpoints.
