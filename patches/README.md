# Pinned dependency patches

`better-auth@1.7.14.patch` corrects the database rate limiter's window anchor. The pinned
implementation updates `lastRequest` after every allowed request, so continuous traffic
can exhaust a budget across several nominal windows and force an idle cooldown. This
also affects authenticated introspection and recurring readiness probes.

The patch retains the first request's timestamp until the configured window expires.
It preserves the existing atomic increment, request maximum, persistence and reset path;
no limiter is disabled and no database schema changes. Memory/secondary-storage modes
are untouched; this workspace uses database storage.

Apply through `pnpm install --frozen-lockfile`. Both production and development image
builds include this directory before installation. The authority database regression
advances time under continuous requests and checks both denial inside a window and
renewal afterward; the existing restart/forged-IP test retains the admission limit.

Reassess and remove the patch when upgrading Better Auth to a version with equivalent
correct behavior. Preserve the dependency's license and the repository's root notices.
