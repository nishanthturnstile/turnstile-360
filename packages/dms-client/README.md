# Thaarei DMS client

Private server-side HTTP integration package for trusted applications, including
`turnstile-api`, to call the reusable DMS without importing its NestJS implementation.

As DMS capabilities are implemented, this package will contain typed calls for documents,
upload sessions/batches, retrieval, status, and processing results, plus bounded transport
configuration, machine-token attachment, and stable error handling. Retrying a call must
respect the operation's idempotency contract.

The package consumes `@thaarei/dms-contracts`. It does not contain document business rules,
database queries, or Turnstile user authorization. It must never be imported into the
browser application. The package currently defines the integration boundary; HTTP
operations are added with their corresponding DMS capabilities.
