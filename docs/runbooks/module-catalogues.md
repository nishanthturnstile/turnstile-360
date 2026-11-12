# Central module catalogue operations

MOD-I02 provides `/modules` and staff-only `/api/module-catalogues` administration.
Admin can import verified code metadata, create/edit classification drafts, export a
release plan and publish an attested classification. Operator/Viewer can read and export
metadata but cannot mutate. All mutations require current Admin MFA, a reason, expected
revision where applicable and a stable request ID. This does not assign modules to a
customer or change current customer activation; use the separate assignment/transition workflows.

## Preparation and public release trust

Apply the owning central migrations through the established private migration procedure
before starting the new central release. Migrations 0010/0011 create module storage,
append-only receipt/audit privileges and a released-catalogue immutability trigger. They
are not applied by application startup. Keep database volumes and existing staff/registry
records. Readiness now also checks the new catalogue storage.

Provision a separate release-pipeline PUBLIC trust document, for example:

```json
{
  "issuer": "https://releases.thaarei.example",
  "keys": [
    {
      "kid": "release-key-id",
      "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----"
    }
  ]
}
```

Use an absolute regular file, at most 32 KiB, containing one to eight unique key IDs and
SPKI RSA public keys. The private signing keys stay with trusted release tooling, never
in central or the browser. This trust is independently provisioned from central deployment
approval keys. No token-controlled URLs, embedded keys or network key retrieval are used.

Direct runtime uses `CONTROL_PLANE_MODULE_RELEASE_TRUST_FILE`. For Dokploy/Compose apply
`deploy/compose.control-plane-modules.yaml` as an additional `-f` overlay after the base
central Compose and supply `CONTROL_PLANE_MODULE_RELEASE_TRUST_HOST_FILE` with the absolute
host public-trust file. The overlay maps it read-only to `/run/module-release-trust.json`.
Keep the existing central ingress/TLS/secret configuration. No extra host port is added.
The base deployment can still run without module trust; imports/publication then fail
closed until trust is configured. Malformed/missing configured trust returns availability
failure; incorrect or expired token evidence returns invalid-evidence failure.

Key changes are loaded on new verification attempts. An exact committed receipt remains
recoverable without renewing its expired token, but only under current admitted Admin/MFA
authority. This historical receipt cannot make a draft or released version mutable.
Removing trust does not retroactively rewrite catalogue history. Future assignment/
activation must observe owning recovery and trust policy; this increment issues no module
grant. Publication is also blocked by existing central recovery quarantine.

## Pipeline attestation contract

Use a compact RS256 JWT with a known `kid`, type `thaarei-module-catalogue+jwt`, configured
issuer, audience `urn:thaarei:module-catalogue`, and integer `iat`, `nbf`, `exp`. Admission
requires current validity and at most 24 hours between issuance and expiry. Claims outside
the registered fields and strict evidence body below are rejected. No private artifacts,
commands, customer credentials or executable import paths belong in an attestation.

Code attestation body is `{version:1, kind:"code", catalogue:<strict catalogue v1>}`.
It certifies code-supported IDs, exact versions, dependencies and source/platform bounds.
The release pipeline is responsible for its source evidence. Central verifies the
signature/schema and stores the immutable body, digest, proof digest and key ID; it does
not execute or independently inspect source code. No production Incident/Risk catalogue
is seeded from the synthetic test fixture.

Classification attestation body is
`{version:1, kind:"classification", catalogueId, catalogueDigest, codeCatalogueDigest, draftRevision}`.
The pipeline must verify the exported candidate against the original code evidence and
return this exact digest/source/revision tuple. A proof for an older draft revision cannot
publish a later revision, even if classification edits returned to the same categories.
Publication certifies a catalogue, not availability of all selected image combinations;
selected artifact inventory/building belongs to MOD-I04.

## Staff workflow and recovery

1. Open Module catalogues from the staff workspace. Import the signed code attestation
   using Review, then Confirm. No raw executable upload or custom command is accepted.
2. Choose the verified code catalogue and create a new classification draft with a reason.
   Only categories are editable; source facts, versions and dependencies remain unchanged.
3. Review required/optional links and proposed changes. Foundation stays Core. A Core
   module cannot require an Individual module; promote its mandatory dependency too or
   keep the original classification. Invalid changes are rejected by both UI and server.
4. Save the reviewed change, then export the exact release/build-plan JSON. It contains
   known source/catalogue IDs, digest, candidate and revision, without commands or secrets.
5. Obtain the matching signed classification evidence from the trusted external pipeline.
   Review and publish with current MFA. The released version cannot be edited/deleted.
   Create another version to propose a later promotion/demotion; installed customers keep
   their existing version. Cloning uses the saved source/classification, not unsaved edits.

Core means required in future resolved profiles for that catalogue; Individual means
separately selectable. Neither is a user permission. Customer selection is MOD-I03.

On an unknown outcome keep the pending review tab open and retry the same request.
Reauthenticate in a separate tab when MFA expires. A committed exact retry returns its
original receipt; navigation/readback loads the current catalogue, including an intervening
publication. A changed body under that request ID conflicts. For a stale revision reload
the current saved version, review its impact and start a new operation. No failed request
silently regenerates a catalogue identity, weakens dependencies or reruns a release build.

Lists are bounded to 50 code and 50 classification summaries with independent UUID cursors.
Catalogue metadata is limited to 64 modules/512 edges; incoming JSON is bounded to 256 KiB
and stored documents to 128 KiB. Signed input is never stored as a browser credential or
persisted token; central keeps only its digest and safe attestation metadata. Audit stores
actor/reason, before/after digest/revision/category summaries and commit time atomically.

## Verification boundary

The owning central integration suite uses real Next HTTPS/proxy handlers, PostgreSQL,
separate ephemeral release keys and normal admitted staff sessions. It exercises roles,
MFA/CSRF, signature/draft matching, concurrent revisions, lost acknowledgements, expiry-safe
receipts, immutable storage and audit rollback. A headless browser drives the production
classification review/confirm component using a disposable authenticated fixture session.
Its browser-only certificate exception is scoped to that private fixture; normal Node
HTTPS verifies the fixture CA and production TLS is unchanged.

No live central database migration/redeployment is implied by source tests. Exact container
rollout, production trust custody and selected customer-image verification remain their
own release/target gates. MOD-I03 adds the
[product assignment and dependency workflow](module-assignments.md).
