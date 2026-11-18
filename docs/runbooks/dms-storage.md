# DMS storage boundary

The [architecture](../../architecture.md#seaweedfs-storage-and-upload-protocol) defines
roles, limits and the transfer contract. I04 supplies internal adapter primitives and a
separate transfer ingress; document admission/capability issuance comes in I05–I06.
No document or processing operation is advertised by installing this profile.

Use [compose.storage.yaml](../../deploy/compose.storage.yaml) as the secured optional
storage profile. Its volume is new and separate; it does not adopt or change the existing
local SeaweedFS volume. The older local infrastructure fixture is not an authenticated
DMS transfer target. Do not expose its raw S3 endpoint for document use.

1. Build the matching DMS release. From
   [the protected configuration template](../../apps/dms-api/.env.storage.example),
   create a mode-0600 installation file with three distinct bucket names, explicit region,
   path style, private S3 origin and canonical public HTTPS transfer origin. Supply seven
   distinct key/secret pairs: bootstrap plus six runtime/maintenance roles. Access key IDs
   contain 16–64 alphanumeric characters; secrets contain 32–128 characters. Do not place
   credentials in command arguments. No AWS default credential chain is used.
2. Generate the exclusive private identity file before starting storage:

   ```sh
   node --env-file=/protected/storage-install.env apps/dms-api/dist/modules/storage/storage-provision.js identity-file .env.storage-identities.json
   ```

   This refuses an existing file rather than rotating credentials silently. Protect and
   back up the identity file. The profile mounts it only into the storage service.
3. Create `.env.storage-transfer` from
   [the credential-free ingress template](../../deploy/storage-transfer.env.example).
   Copy access key IDs, never secret keys, into this file. The ingress uses public URLs
   unchanged and forwards their signed Host header to the private S3 endpoint.
4. Start the secured profile with `docker compose -f deploy/compose.storage.yaml up --build -d`.
   Its internal network has no published ports. SeaweedFS filer/master/volume interfaces
   bind only to container loopback; only authenticated S3 binds to the private network.
   WebDAV, admin UI and embedded S3 IAM administration are disabled.
5. From a trusted one-off attached to the private storage network, run
   `node dist/modules/storage/storage-provision.js buckets` with the protected bootstrap
   environment. An installed checkout with private S3 access can use:

   ```sh
   node --env-file=/protected/storage-install.env apps/dms-api/dist/modules/storage/storage-provision.js buckets
   ```

   This explicitly creates the buckets and exact-origin CORS rules; API startup does
   neither. Existing buckets owned by another identity fail. Do not reuse buckets from
   unrelated applications. Bootstrap credentials stay with installation tooling.
6. Dokploy routes only the transfer hostname to `dms-transfer:8333`. Never route it to
   `storage:8333` or expose internal/non-S3 ports. Keep TLS at ingress. For an explicitly
   selected local profile, use only the reserved loopback port `23608:8333` for transfer;
   a conflicting existing service must be stopped by its operator first. Never substitute
   another application service port. Test runners use disposable loopback transports.

Distribute only the roles each trusted process needs. Consumer backends and browsers
receive expiring object capabilities, never S3 secret keys. Parser services receive
neither general storage credentials nor original-write/delete authority. Snapshot and
cleanup credentials are private coordinator/maintenance inputs, not API defaults.

A staging PUT capability signs Content-Length, Content-Type and If-None-Match `*` along
with Host. Browser code passes a known-size Blob/File and the returned headers; it must
let the browser generate Content-Length. Node's known-size Buffer and the independent
[Python example](../../examples/dms/transfer.py) honor the same signed length and type.
No multipart, chunked, ACL, tagging, archive extraction, copy, listing or vendor extension
is accepted on transfer ingress. Repeated PUT returns 412. The adapter snapshots the
ETag-matching source to a newly generated private original key; the caller never chooses
its destination. ETags are opaque concurrency tokens, not cryptographic checksums.

Python uses standard-library HTTP, disables ambient proxies and redirects, reads bounded
capability JSON from stdin and transfers a private file:

```sh
python examples/dms/transfer.py /protected/input.bin < /protected/put-capability.json
python examples/dms/transfer.py /protected/new-output.bin < /protected/get-capability.json
python examples/dms/transfer.py /protected/new-range.bin bytes=0-1023 < /protected/get-capability.json
```

Output files are exclusive mode 0600. Protect capability files as temporary bearer
credentials, remove them after use and never log their URLs. The ingress suppresses S3
error bodies, logs no URLs and returns no redirects. Adapter operations and ingress
forwarding require a direct anonymous object probe to return 403; an unauthenticated or
unavailable backend is rejected, including after restart. Every GET is attachment/no-store
with a restrictive content security policy. Origin allowlists are exact; cookies and
credentialed CORS are not used. Range GET supports a single explicit byte range.

`pnpm test:storage` starts the pinned disposable SeaweedFS image with fresh private
identities/buckets and exercises native S3 plus the actual streaming ingress. It includes
real Chromium and Node transfers and the independent Python program. The workspace
`pnpm test:integration` includes this lane. It never uses installed customer credentials
or storage. Storage enablement still requires admission/resource authorization and the
security publication pipeline in subsequent increments.
