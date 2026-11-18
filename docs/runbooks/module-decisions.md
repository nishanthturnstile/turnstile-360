# Signed module decisions

The accepted authority, expiry/read matrix and compatibility policy are in
[architecture.md](../../architecture.md#signed-module-decisions-and-compatibility).
MOD-I06 source supports dual-version central sync and verified selected-image context.
MOD-I06 is locally qualified against real central/selected containers and PostgreSQL,
including the two-customer mixed-version matrix and all four workspace gates.
No existing customer installation was migrated or upgraded. IN_PROGRESS.md owns the evidence.

## Staged rollout

1. Qualify and deploy central dual-version support with migrations `0014_module_authority`
   and `0015_module_authority_privileges`. Existing DMS and legacy Turnstile v1 continue.
2. Build and independently verify a fresh selected release. Fresh private preparation
   writes `module-release.json` and `module-release-trust.json`, with their file digests
   in its completion receipt. The latter is a deployment-control public trust bundle,
   initially revision 1. Independent release-key revocation/rotation must advance its
   revision and retain required key history. Keep it separate from central decision trust.
3. Through an admitted central Admin session with current MFA, explicitly require v2:
   `POST /api/registry/products/{productId}/modules/enforce`, same-origin JSON:

   ```json
   {
     "operationId": "<fresh UUID>",
     "expectedRevision": 4,
     "reason": "Reviewed upgrade to the verified enforcing release"
   }
   ```

   Use the actual current registry product revision. This permanent restriction increments
   it once and writes audit plus receipt atomically. On lost response, retry exactly the
   same body and operation ID. Changed retry input conflicts. Viewer, Operator, customer
   credentials and machine credentials cannot perform this Admin operation. There is no
   downgrade/delete endpoint. This call does not activate modules.
4. Mount both public release files read-only into the selected API and reporter. Use
   `TURNSTILE_MODULE_RELEASE_FILE=/run/thaarei/module-release.json` and
   `TURNSTILE_MODULE_RELEASE_TRUST_FILE=/run/thaarei/module-release-trust.json`, alongside
   the existing separate central trust/marker settings. The release file contains only
   `request` and `attestation`. Selected images contain their exact compiled profile;
   configuration cannot turn them into v1 images. Missing/invalid/revoked release proof
   closes business access. Legacy development source retains its v1 behavior.
5. Pair/sync through the existing machine endpoint. Request/response bodies now have
   strict v1/v2 alternatives at `/api/machine/v1/sync`. A fenced product rejects v1;
   a v2 request without the reviewed central fence also conflicts. Pairing and rotation
   keep their existing v1 credential/receipt protocol. Retry journals retain exact v2
   context and must be reconciled before an installed release changes.
6. Expect a signed **pending** decision until active module authority exists for that
   machine epoch. Ordinary product approval, desired assignment, package availability
   and reported inventory do not activate modules. Use the implemented current-MFA
   [staff activation/cutover workflow](module-transitions.md) next. Direct runtime
   active-policy updates remain denied; its reviewed SQL writer owns transitions.

## Persistence and recovery

The central `module_authority` row is independent of machine credentials and persists
across replacement/rebind. Runtime can insert only its product ID (a closed v2 fence);
it cannot directly update active authority or delete/downgrade the row. Persisted active context,
when provided by the owning activation flow, is validated against its exact request and
reported installed context before signing. A different machine epoch receives pending.
Active assignment changes use the reviewed transition flow and atomic restriction writer.

The Turnstile store re-verifies signed context before SQL application, including unchanged
proof saves. SQL remains authoritative after interrupted private file promotion. The
shared state retains decision ordering, minimum version, release trust revision, clock
and quarantine history. Foundation read exceptions remain separate from module access.
Restore still requires the independent marker/current-epoch recovery protocol. Never
clear a journal, version floor or quarantine to make an old approval usable.

## Qualification

Run all four workspace gates. The central integration harness now includes
`verifyModuleMachines`, exercising actual HTTPS handlers/PostgreSQL for Admin enforcement
and lost receipt, unknown/v1 versions, pending activation, signed context, lost sync,
removal/stale replay and replacement epochs. It explicitly seeds synthetic active authority
through the private fixture database; it does not claim to test staff activation or a
selected installed image. Shared signature/policy unit tests likewise do not qualify
installed SQL/image behavior. Selected-image/installed-adapter, expiry/outage and restore checks are locally qualified
as described below. Ordinary module HTTP/login and staff activation qualification follow
the [access](module-access.md) and [transition](module-transitions.md) runbooks;
production rollout remains deployment-specific.


To repeat selected-image qualification, supply a private fixture JSON containing the
verified bundle's `bundleDirectory`, exact `request` and independent public `releaseTrust`.
Use the candidate central image and known v1 compatibility images, then run:

```bash
CONTROL_PLANE_TEST_IMAGE="$CENTRAL_CANDIDATE_IMAGE" \
CONTROL_PLANE_QUALIFY_CONTAINERS=true \
CONTROL_PLANE_QUALIFY_TWO_CLIENTS=true \
DMS_CONTROL_TEST_IMAGE="$LEGACY_DMS_IMAGE" \
TURNSTILE_CONTROL_TEST_IMAGE="$LEGACY_TURNSTILE_IMAGE" \
MOD_I06_SELECTED_FIXTURE=/absolute/private/fixture.json \
node scripts/test-control-plane.mjs
```

The selected fixture runs real owning CLI/store/API evaluator functions in the signed
Incident image, with separate migration/operator/runtime SQL credentials and no private
machine credential mounted into the API evaluator. It starts the shipped reporter under
read-only mounts and requires both owning SQL completion and a central report. Expiry
uses a controlled clock inside fresh customer processes; the production evaluator itself
runs unchanged. Restore checks inject an old approval row with a changed independent host
marker, then exercise quarantine and reviewed rebind. The central suite additionally
performs an actual pre-denial database backup/restore. Activation authority is private
fixture seed data; this particular fixture does not qualify ordinary staff activation or module UI.
A private `selected-qualification.json` is written beside the fixture bundle store on success.
It also covers a real private-file rename failure after SQL commit and reconciliation of
the old restored file against current SQL restriction.
