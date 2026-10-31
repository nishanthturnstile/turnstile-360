# Turnstile 360 deployment with Dokploy

The target topology, component ownership, and current packaging limits are maintained in
[architecture.md](../../architecture.md#development-and-current-deployment). This runbook
owns deployment steps; update it when an architecture change alters those steps.

Each installation is scoped to one customer tenant. Use the [customer deployment
model](../../architecture.md#customer-deployment-and-application-model) when provisioning
its configuration, data, credentials, and registered applications; scaling services does
not introduce additional customer tenants.

Deploy Turnstile 360 and the DMS application services on a Linux server managed by
Dokploy. The APIs implement the persisted authority/BFF, enrollment and typed machine access. Follow
the [authentication runbook](authentication.md) for explicit database roles, migrations,
bootstrap and private account verification. Login/recovery UI is implemented; document
handling and processing remain incomplete. Real installation configuration and domain/TLS
verification remain explicit deployment work.

1. Create a Docker Compose service in Dokploy using this repository and
   `deploy/compose.dokploy.yaml`. Use Docker Compose mode, with repository-root build
   contexts resolved from the Compose file.
2. Route the Turnstile application domain to `turnstile-web`, container port 8080.
3. Route `/api` on the same domain to `turnstile-api`, container port 3002. Preserve the
   path: the backend already uses `/api`. Give the API route priority over `/`.
4. Expose `dms-api`, port 3001, under its intended controlled domain. Its
   application identity endpoint is at `/v1`. Route `/identity/*` and
   `/.well-known/oauth-authorization-server/identity` on the canonical application origin
   to DMS with priority over the SPA. Discovery/JWKS use the configured public issuer;
   private operator routes remain closed by the native handler. Document/internal job
   interfaces remain unimplemented.
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

Local infrastructure is in `deploy/compose.local.yaml`: PostgreSQL, Mailpit, RabbitMQ, and SeaweedFS
with loopback-only development ports and persistent volumes. AUTH-02 supports PostgreSQL connections with owned runtime roles after explicit setup;
RabbitMQ and SeaweedFS application integration remain pending. SeaweedFS development credentials/security policy and
storage capabilities must be configured and verified before the upload capability.

ClamAV/signature management, isolated Tika/native parsers, approved language/model data,
coordinator/publisher/worker services, broader backups and recovery procedures are added with their implemented capabilities.
Database roles/migrations are now explicit one-off AUTH-02 operator actions. Keep their
credentials out of persistent API service mappings, and keep recovery tokens/cookies out
of ingress/access logs. The
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

AUTH-07 builds all four images and verifies isolated non-root runtime startup, real
HTTPS/STARTTLS browser journeys and production Nginx assets/CSP locally. The
[release verification steps](authentication.md#browser-operation-and-release-verification)
cover the actual target environment and rollback. Docker Desktop-to-WSL host-network
reachability can be unavailable for the local canonical-container probe; that result
does not verify actual Dokploy DNS/TLS. Record the target result explicitly.

For the owner's controlled Mailpit pilot, add `deploy/compose.mailpit.yaml` with private
certificate/key/CA file paths as described in the [email setup](authentication.md#provision-an-account-and-verify-recovery).
The overlay requires SMTP STARTTLS and exposes its inbox only on host loopback.
