# Turnstile 360 web

Architecture and component boundaries: [architecture.md](../../architecture.md).

Vite/React/TypeScript frontend for Turnstile 360, using workspace Biome and TypeScript
standards. Route, feature, and component folders own the application interface. Current
authentication screens use the supported Better Auth client and signed OAuth continuation.
Login, verification resend, recovery/reset, expiry/access/outage states and an authenticated
entry are implemented. Business screens remain separate scope.

Run `pnpm dev:turnstile` from the repository root. Vite uses port 5173 and proxies `/api`
to the local Turnstile backend on port 3002. `/identity` and the required root OAuth
metadata path proxy to DMS on port 3001. Use `localhost`
consistently and `pnpm dev:auth` for the combined development workflow. Production serves built assets through
Nginx inside the Dokploy-managed frontend container, with Traefik routing `/api` to the
backend. VITE_* settings are public build values.

This is proprietary Thaarei software under the root LICENSE.

Sessions/CSRF stay in memory; HttpOnly cookies and the BFF own authorization. Passwords go
only to the authority, reset tokens are removed from the address bar before rendering,
and no credentials enter browser storage. Logout uses the BFF's CSRF-protected operation
and exposes controlled retry when account sign-out is pending. The document connection
check is gated by the current product permission and contains no machine credentials.

Run `pnpm test:browser:auth` from the root for three focused real-API/Mailpit journeys
(Docker Engine and installed Playwright Chromium are required). Follow the
[operator runbook](../../docs/runbooks/authentication.md) for setup and
[architecture](../../architecture.md#loginrecovery-ui-and-operational-boundary) for the boundary.
