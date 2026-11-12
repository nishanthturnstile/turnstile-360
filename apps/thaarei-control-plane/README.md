# Thaarei control plane

Private central Next.js application with its own staff identity and PostgreSQL ownership.
Generated using the installed create-next-app 16.4.5 CLI; workspace pins and Biome replace
scaffold defaults. Follow the [central operator runbook](../../docs/runbooks/control-plane.md)
and [architecture](../../architecture.md#thaarei-central-control-plane-proposal).

The [UI redesign plan](../../docs/thaarei/control-plane-ui-redesign.md) records the screen
and conditional-state inventory, UX research and reviewed workflow/navigation design.
Actual implementation and verification are tracked under TCP-UX-01 in IN_PROGRESS.md.

The production image supplies both Next and private one-off maintenance entrypoints.
The customer stack does not host this application. Do not run `dev` on the active customer
development machine; its fixed port belongs to a separately isolated central environment.
Build/check commands use no real credentials. Integration verification creates/removes
its own PostgreSQL/Mailpit containers and ephemeral HTTP/HTTPS ports.
