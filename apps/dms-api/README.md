# Thaarei DMS API

NestJS/Fastify control API for the Thaarei Document Management System. Feature modules
follow the accepted DMS requirements. The shared identity authority, document operations,
and processing coordination are implemented in their respective modules as work proceeds.

`GET /v1` returns application identity. `GET /health/live` reports process liveness;
it does not imply database, storage, scanner, or processing readiness.

Run `pnpm dev:dms` from the repository root. The default port is 3001. See the root
README and workspace implementation plan for setup, checks, and capability status.

This is proprietary Thaarei software under the root LICENSE.
