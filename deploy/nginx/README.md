# Frontend HTTP server

See [architecture.md](../../architecture.md#linux-dokploy-traefik-and-nginx) for the deployment topology.

Dokploy manages deployment, domains, and TLS through Traefik. Traefik routes browser
requests to the frontend container, where Nginx serves Vite's built HTML, JavaScript,
and CSS. These responsibilities are distinct: routing a request does not serve files
from the frontend image's filesystem.

`apps/turnstile-web/Dockerfile` copies `nginx.conf` to `/etc/nginx/nginx.conf` and the Vite
build to `/usr/share/nginx/html`. Nginx runs without root privileges on container port
8080. The configuration provides SPA fallback to `index.html` for React client routes
and a process endpoint at `/health/live`.

Nginx does not manage TLS or proxy the application API. Dokploy routes `/api` directly
to `turnstile-api` with higher priority than the frontend's `/` route. The Nginx container
is part of the Dokploy-managed Compose deployment, not a separate host installation.
