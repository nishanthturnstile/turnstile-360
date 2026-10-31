# Turnstile 360 deployment with Dokploy

The target topology, component ownership, and current packaging limits are maintained in
[architecture.md](../../architecture.md#development-and-current-deployment). This runbook
owns deployment steps; update it when an architecture change alters those steps.

Deploy Turnstile 360 and the DMS application services on a Linux server managed by
Dokploy. The current API routes provide application identity and process liveness;
authentication, document handling, and processing must be implemented before customer
documents are accepted.

1. Create a Docker Compose service in Dokploy using this repository and
   `deploy/compose.dokploy.yaml`. Use Docker Compose mode, with repository-root build
   contexts resolved from the Compose file.
2. Route the Turnstile application domain to `turnstile-web`, container port 8080.
3. Route `/api` on the same domain to `turnstile-api`, container port 3002. Preserve the
   path: the backend already uses `/api`. Give the API route priority over `/`.
4. Expose `dms-api`, port 3001, under its intended controlled domain. Its
   application identity endpoint is at `/v1`; identity/document/internal interfaces are not implemented.
5. Use Dokploy Domains/Traefik for ingress and TLS. Attach only routed services to
   ingress networking using Dokploy's domain/isolation configuration. No host ports or
   Traefik container are declared by the application Compose file.
6. Verify `/health/live` for each backend and frontend asset/SPA fallback routing.

All image builds use the monorepo root. `pnpm deploy --prod` creates isolated backend
runtime directories. Frontend builds are served by an unprivileged Nginx process. The
Python image currently runs its processing identification command and exits; it is intentionally absent from
the long-running Compose services until actual worker roles are implemented.

Dokploy settings must explicitly map required variables into each service. Vite settings
are public build arguments and require a frontend rebuild. Future secrets must be scoped
to the relevant service, and must never enter browser build arguments.

Local infrastructure is in `deploy/compose.local.yaml`: PostgreSQL, RabbitMQ, and SeaweedFS
with loopback-only development ports and persistent volumes. These services are not yet
connected to application services. SeaweedFS development credentials/security policy and
storage capabilities must be configured and verified before the upload capability.

ClamAV/signature management, isolated Tika/native parsers, approved language/model data,
coordinator/publisher/worker services, separate database roles, explicit migrations,
backups, and recovery procedures are added with their implemented capabilities. The
accepted DMS stack remains unchanged; idle placeholders must not imply readiness.

Validate configuration before deployment:

```bash
docker compose --env-file .env.example -f deploy/compose.local.yaml config --quiet
docker compose -f deploy/compose.dokploy.yaml config --quiet
```

Image builds and server routing require Docker Engine/Dokploy verification. Keep
stateful services and backups independent of application redeployments as those services
are introduced. Use compatible immutable image sets and explicit migration steps.

The Nginx configuration is explained in [Frontend HTTP server](../../deploy/nginx/README.md).
