# DMS audit and private inspection

See [architecture](../../architecture.md#standalone-dms-delivery-target) for the owning
pool, principal/role boundaries, pagination and implemented-resource limits. This runbook
covers application enrollment audit. Document audit becomes available with the owning
document feature; no document route is currently advertised.

For a fresh installation, use the existing protected provisioning environment file. Supply
a distinct `DMS_OPERATOR_DATABASE_URL` for `thaarei_dms_operator` if private audit inspection
is needed. `DMS_COORDINATOR_DATABASE_URL` is optional; no dispatcher ships yet. Omitting a
URL provisions a NOLOGIN role. Neither URL belongs in the API environment. Both profiles
provision these DMS roles; they grant no auth or Turnstile access.

For an existing installation, take the normal backup and provision only the two new roles
before running the DMS owning migration. The private file must have the existing
`PROVISION_DATABASE_URL` plus any new, distinct role URLs. Provisioning refuses existing
roles and never rotates passwords. Use protected files; never put connection strings or
passwords in command arguments:

```sh
node --env-file=/protected/provision-dms-access.env scripts/provision-auth-database.mjs --dms-access-only
pnpm --filter @thaarei/dms-api db:migrate:dms
```

The migration command reads the application's protected `.env.migrate`. Match the existing
installation tenant/customer values; do not bootstrap a new identity or change bindings.
Build the matching release before using its private commands.

Consumers explicitly issued the additional `dms:audit:read` scope can GET `/v1/audit` with
their normal enrolled machine token. Existing clients retain their configured scopes;
none are silently widened. Cookies, docs Basic access and authority administration confer
no audit rights. The result includes only that application's events. `limit` defaults to
50 and is capped at 100; pass the returned opaque `nextCursor` as `cursor` for the next page.
Do not decode, edit or reuse a cursor for another principal/filter. Each page checks current
registration and scopes. Retries can observe newer committed state.

Operators use the existing private bootstrap/assign/revoke/recover commands documented in
[standalone setup](dms-standalone.md). Inspection additionally needs a separate protected
operator database environment file and fresh account credentials in protected JSON stdin:

```sh
node --env-file=/protected/dms-authority.env --env-file=/protected/dms-operator.env \
  apps/dms-api/dist/modules/access/manage-operator.js < /protected/audit-read.json
```

Input shape (place actual credentials only in the mode-0600 input file):

```json
{
  "action": "audit-read",
  "operatorEmail": "operator@example.test",
  "operatorPassword": "replace-in-protected-file",
  "limit": 50
}
```

Optionally provide `applicationId` and the matching `cursor`. The private generated
[command contract](../api/dms-operator.contract.json) is separate from consumer OpenAPI.
Read output uses the same bounded audit page schema. Inspection never needs the DMS
migration URL. Every read/page/retry freshly authenticates and checks the current explicit
operator grant and installation identity, then records attributed inspection evidence.
Authority administrators without a DMS grant must use the explicit protected recovery
procedure; an ordinary read cannot create a grant. Denials are sanitized; no credentials
or tokens are printed. Protect output files and remove transient credential input files
according to local operating policy.
