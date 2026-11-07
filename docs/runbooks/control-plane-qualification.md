# Isolated control-plane qualification

TCP-I08 is staged local qualification; it never authorizes a persistent customer cutover.
Follow [the accepted topology and recovery design](../../architecture.md#thaarei-central-control-plane-proposal)
and [operator commands](control-plane.md). Completion/evidence is recorded in
[IN_PROGRESS.md](../../IN_PROGRESS.md).

Run `node scripts/qualify-control-plane.mjs /absolute/new-evidence.json` from the workspace.
It requires Docker, pinned workspace tooling and a new output file. The runner executes all
four workspace gates, builds central/DMS/Turnstile API/web images, resolves immutable image
IDs and verifies nonroot/credential-free configuration. It records production-input,
packaging-helper and verification-helper hashes and rejects input changes during the run.
Exact results and remaining target acceptance belong in the evidence, not this procedure.

`CONTROL_PLANE_QUALIFY_TWO_CLIENTS=true` with `CONTROL_PLANE_QUALIFY_CONTAINERS=true`
runs the central image behind container HTTPS ingress in production profile with verified
STARTTLS delivery. Each customer has a separate Docker network, PostgreSQL cluster,
product registrations and protected files. Only the central ingress joins those customer
networks; the central application/database stay on their own network. The shipped DMS
coordinator and Turnstile reporter entrypoints use container DNS/TLS and owning SQL. The
DMS lost-acknowledgement check discards a real committed response, then restarts the worker
after suspension and proves durable replay. Shutdown must finish cleanly. No reporter
success establishes browser availability. Fixtures use ephemeral ports, never the reserved
persistent-development service bindings.

Central recovery restores a genuine pre-denial schema backup under an independent marker,
then reconciles with unavailable retained evidence. Restored credentials must be revoked;
fresh pairing still needs explicit approval. Both customers' DMS recovery restores the full
authority/DMS database and private journal under marker quarantine, including disconnected
recovery. Turnstile recovery separately restores its owning database/journal and exercises
the production preflight, reviewed rebind and reapproval. This Turnstile restore lane is
production-preflight evidence, not an authenticated image HTTP restore journey.

The DMS image HTTP lane stages a new public key, switches the actual central signer,
synchronizes and retires the old key. With central transport blocked, a genuine forged
renewal demonstrates the compromised-key limit. Independent protected trust revocation
must close the running product; a fresh signer, new binding epoch and explicit approval
must recover it. Separate network-disabled packaged-verifier checks use controlled clocks
for seven-day expiry. Private signing keys never enter customer runtime containers.

`AUTH_BROWSER_FULL_IMAGES=true` requires exact `AUTH_BROWSER_DMS_IMAGE`,
`AUTH_BROWSER_API_IMAGE` and `AUTH_BROWSER_WEB_IMAGE` candidates. The auth and People
journeys send actual browser requests through the DMS/Turnstile/Nginx images. Backend
canonical-issuer discovery/JWKS checks require valid container DNS/TLS. Mailpit enforces
STARTTLS for authority delivery. Fixtures provision accounts and change test state using
separate owning processes; they do not replace the runtime handlers. Private identity
traffic uses a distinct internal canonical ingress. Browser ingress blocks private identity
and work paths. The administrator handover runs the candidate's actual maintenance command
in a separate container; API containers receive neither migration credentials nor machine
journals. Restart, invitation/recipient/setup, permissions, logout and restriction journeys
exercise the candidate runtimes. Turnstile HTTP trust rollover/revocation uses genuine
fixture-signed proofs and explicit fixture-owner recovery; it is distinct from the central
pairing/preflight restore lane.

These Docker networks model separated hosts on one local machine. They do not establish
actual Dokploy ingress, external DNS/TLS/SMTP, independent off-host survival, target clock
stability or operator acceptance. The evidence keeps `releaseQualified:false` and target
acceptance pending. No existing installation or persistent credentials/data are used.

## Upgrade and rollback handover

Stage the central registry and private product manifests before opening customer business
ingress. Preserve each customer's fixed DMS installation UUID; private Turnstile bootstrap
must consume that UUID rather than minting another installation. Central migration 0009,
DMS migration 0059 and Turnstile migration 0029 are the current owned schema endpoints.
Back up schemas, protected machine journals, public trust and signing/auth material through
their respective owning processes. External quarantine markers stay outside restore sets.

A new enforcement runtime must have both independent products paired and explicitly approved
before ordinary business access opens. Verify receipt acknowledgements and owning local status;
central registration or issuance alone is insufficient. Keep identity/operator recovery private
and available according to the accepted exemptions. Check actual login, invitation/setup and
current permissions in addition to health endpoints.

There is no prior published enforcing release to qualify as a historical image downgrade.
Local verification covers owning upgrade tests, exact candidate restart, and quarantined
database/journal restore. A future compatible-image rollback requires its own exact image
and schema compatibility evidence.

Rolling back to an older runtime without enforcement is not an approved fallback. Keep
business ingress/services stopped until a compatible enforcing image, preserved credentials,
current trust and consistent schema/data have been restored and verified. Do not delete
credentials, remove guard tables, restore an old external marker or silently copy a prior
approval to reopen access. An incompatible schema downgrade needs its own reviewed recovery
procedure and data compatibility evidence; no destructive down-migration is supplied here.

An operator handover must name the accepted immutable images and source fingerprint, the
central/customer operators, private backup locations and restore points, separately retained
decision evidence, key delivery/revocation authority and outstanding acceptance failures.
Record no credentials or signed grants in the evidence JSON or repository. Dirty source
fingerprints describe local candidates, not a published release. Target rollout/publication
requires separately authorized scope even after local qualification is complete.
