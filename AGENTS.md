# Workspace standards

This repository contains the reusable DMS and the separate Turnstile 360 product.
Thaarei owns this confidential, proprietary software. Preserve the root LICENSE and
third-party notices. Business functionality and source/data migration follow their
respective specifications and authorized scope.

Read `IN_PROGRESS.md` before starting any task. Record the active task and owner when
work begins, update it after meaningful milestones, and leave a current handoff before
ending the task. Track completed features/fixes, actual verification, blockers, and
remaining work; preserve other agents' entries. Planned entries do not authorize work.
Follow the maintenance rules in that file and keep it consistent with the implementation.

Read `architecture.md` for the accepted technical design and relevant component boundaries
before implementation. Maintain architecture decisions, stack, contracts, configured limits,
and deployment topology there; reference it from other docs rather than duplicating the
design. Keep product scope/requirement IDs in their specifications and actual completion
in `IN_PROGRESS.md`. Update affected references when the architecture changes.

- Use pnpm 12.16.1, Node 24.21.0, and the pinned Python/uv versions.
- Use the installed library/framework CLI to generate scaffolds when one exists.
- Both backends use NestJS with Fastify. Use Fastify-compatible integrations.
- Use Biome for TypeScript/JavaScript formatting and linting. Python uses Ruff and mypy.
- Preserve value imports for injected Nest classes; decorator metadata needs them.
- Applications must not import each other's source or database code. Use public packages
  and authenticated HTTP integration. Browser code must not import server packages.
- Keep contracts independent of NestJS and databases. Use workspace:* for internal packages.
- Design turnstile-api for both the web client and a future Expo/React Native client.
  Keep authoritative business logic, authorization, validation, and state changes in
  backend services. Keep shared contracts platform-independent. Mobile implementation
  remains future scope; do not add a mobile app without an explicit request.
- Define database schemas and migrations only when the relevant feature is implemented.
- Never put service credentials in Vite configuration or browser code.
- Dokploy owns ingress/TLS. Keep Compose build contexts at the monorepo root.
- Run `pnpm check`, `pnpm build`, `pnpm test`, and `pnpm test:integration` for workspace changes.
- Report unavailable container/runtime verification separately from static checks.

See `architecture.md`, `docs/workspace_implementation_plan.md`, and `docs/standards/workspace.md`.
