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

AUTH-02 keeps URLs, headers and query strings out of the access-log format, suppresses
credential-page access/error logs and sends `Referrer-Policy: no-referrer`. Recovery links
and signed OAuth continuation parameters must also be excluded from Dokploy/Traefik
access logs. See [authority operations](../../docs/runbooks/authentication.md).

AUTH-07 adds `nosniff` and a same-origin Content Security Policy, including frame, base
and form restrictions. Auth, recovery, unauthorized, expired and unavailable page logs
are suppressed. The production image serves the same built UI exercised by the focused
HTTPS browser suite; actual Dokploy routing and container DNS/TLS remain target checks.
