# Repository checks

These Node.js commands support development and CI. They are not deployed as application
services. `.mjs` explicitly selects ECMAScript modules, allowing Node to run them directly
without a separate TypeScript build or runtime loader.

See [architecture.md](../architecture.md#engineering-and-verification-architecture) for
how these checks fit the workspace build and verification design.

- `check-deploy.mjs`, invoked by `pnpm check:deploy`, validates Compose YAML and confirms
  that declared build contexts contain their Dockerfiles. Full Compose semantics are
  checked separately with `docker compose config`; container execution needs Docker Engine.
- `smoke-runtime.mjs`, invoked by `pnpm test:smoke` after a build, starts both compiled API
  entry points on temporary local ports, checks application identity and liveness over
  HTTP, then stops the processes. It catches startup/module-resolution errors that a
  TypeScript check or an in-process HTTP test can miss.
