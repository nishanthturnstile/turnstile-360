# Turnstile deployment activation

Use [architecture.md](../../architecture.md#turnstile-deployment-control-integration-tcp-i06)
for the design and [IN_PROGRESS.md](../../IN_PROGRESS.md) for actual qualification.

Use the complete `deploy/compose.customer-complete.yaml` entry. It includes separate
DMS and Turnstile approval overlays and the existing customer-local identity integration.
Rebuild the central and DMS candidates from compatible current contracts before using the
Turnstile reporter; coordinated image inventory and target acceptance remain TCP-I08. An
older DMS without the opt-in status field supplies connectivity, not an approval assertion.
Keep the canonical customer issuer, login callback, private identity-service audience and
its dedicated client/scopes unchanged. Central URLs never supply customer OAuth values.

For a fresh installation, private provisioning creates `thaarei_turnstile_reporter` using
`TURNSTILE_REPORTER_DATABASE_URL` from protected configuration. For an existing installation,
run `scripts/provision-auth-database.mjs --turnstile-reporter-only` using the dedicated
operator connection and that new role credential before migrating through 0029. The command
refuses existing roles; it does not rotate credentials. Apply owned migrations and bootstrap
before running the new API. Export the DMS installation manifest with its private owning
command, then set private bootstrap `INSTALLATION_LOCAL_ID` to that exported UUID (and
verify the same tenant/customer key). Bootstrap fixes that durable UUID and the existing
application identity and rejects replacement on retry. Register Turnstile under the same
central installation as DMS, with its own product/application binding and credential.
Runtime/reporters cannot create or rewrite the installation UUID. Coordinated customer rollout and inventories remain TCP-I08.

Copy `deploy/turnstile-reporter.env.example` to protected `.env.turnstile.reporter`, replacing
its values with this installation's real identities and dedicated reporter connection.
Never supply that connection to the API. Configure the Turnstile-prefixed host settings in
`deploy/deployment-control.env.example`. Public trust and the independent marker are readable
by image UID 1000 and protected against other users' writes. The private directory is owned
by UID 1000, mode 0700; credential/journal files are mode 0600. Deliver public trust through
the independent operator/release channel. The marker lives outside all restore sets.

Private `turnstile-deployment` tools run `dist/modules/deployment/operator.js` with bounded
JSON stdin. Export a new absolute manifest file with `{"action":"manifest",
"outputFile":"/run/turnstile-private/local-manifest.json","environment":"production"}`.
Register its exact Turnstile application/local-installation/tenant tuple centrally, then
privately deliver the resulting pairing file (0600) into the writable private directory.
Supply `{"action":"setup","pairingFile":"/run/turnstile-private/pairing.json"}`.
Pairing never approves the product, creates a user session or changes local grants.
Staff explicitly approves, then `{"action":"sync"}` applies and acknowledges the signed
policy. The dedicated reporter normally synchronizes every 15 minutes over trusted HTTPS.
Use `CUSTOMER_EXTRA_CA_HOST_FILE` for a bundle containing customer and central roots.

Keep the journal after uncertain responses. `sync` resumes the existing activation/rotation
candidate; `rotate` uses generation fencing and authenticated confirmation before atomic
promotion. All replicas and private commands share the PostgreSQL operation lock. The
read-only reporter uses SQL receipts and reloads owner-promoted credentials without writing
its mount. SQL contains verified public evidence and safe metadata, never machine secrets.

Missing/invalid proof closes business access. Local login, sign-out, identity setup and
operator recovery remain independently protected. The signed-in activation page offers a
status recheck; it never sends central credentials or performs pairing. Previously activated
suspension/expiry allows existing authorized reads, while mutations, invitation issuance,
new mail dispatch and acceptance require current approval. Recipient identity setup/recovery
stays available independently of membership acceptance. Every business transaction keeps its
existing local permission checks. The DMS connection action reports DMS restriction separately.

For supported restore, stop business/reporters and rotate the independent marker before
restoring data. Old state cannot reopen approval. Obtain Admin-reviewed replacement pairing
and run `rebind` with that new pairing file. Old quarantine stays closed until a fresh
verified online epoch is applied. `sync` can resume that durable reviewed intent. New pending
policy still needs explicit staff approval. Deliver trust revocation independently; recreate
containers after atomic replacement of individually bind-mounted trust/marker/CA files.
Arbitrary root/host rollback remains outside the guarantee. Restore drills and target
DNS/TLS/SMTP acceptance remain TCP-I08.
