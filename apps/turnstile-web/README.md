# Turnstile 360 web

Vite/React/TypeScript frontend for Turnstile 360, using workspace Biome and TypeScript
standards. Route, feature, and component folders own the application interface. Current
rendering shows the application name; business screens follow the product specification.

Run `pnpm dev:turnstile` from the repository root. Vite uses port 5173 and proxies `/api`
to the local Turnstile backend on port 3002. Production serves built assets through
Nginx inside the Dokploy-managed frontend container, with Traefik routing `/api` to the
backend. VITE_* settings are public build values.

This is proprietary Thaarei software under the root LICENSE.
