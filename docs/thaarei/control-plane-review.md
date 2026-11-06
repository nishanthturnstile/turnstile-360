# Thaarei control plane plan review

**Date:** 2026-11-06. **Scope:** Planning review against the owner's separate Thaarei
Linux host and per-customer Linux host. Confidential and proprietary.

The independent reviewer used `gpt-6-astra`. It reported three high and four medium
planning gaps. The parent checked the findings against the proposal and source, accepted
all seven, and made the corrections below. This records document corrections, not a second
independent review of the corrected text or implemented security controls.

## Findings and corrections

| ID | Severity | Finding | Correction and implementing gates |
| --- | --- | --- | --- |
| TCP-REV01 | High | A restored database can roll back cached approval, clock and denial evidence together. | Supported customer restores start in host-marked quarantine and reconcile online/rebind before business access. Central restores stop issuance, reconcile independently retained decision evidence, and require fresh approvals when evidence is incomplete. Arbitrary root/VM snapshot rollback is outside the guarantee. TCP-I04/I08. |
| TCP-REV02 | High | Login callback compatibility alone does not ensure identity-service compatibility. | Combined customer configuration now covers the shared authority origin, identity-service audience, distinct client/secret/scopes, private token and account/invitation transport, and explicit standalone screen policies. Login plus full invitation/account flows are qualification gates. TCP-I01/I05/I06/I08. |
| TCP-REV03 | High | Signed decision state, denial persistence and equal-revision ordering were underspecified. | Sign a discriminated state plus exact binding/epoch, policy revision and monotonic decision sequence. Ignore unsigned outer status. Persist an applied denial beyond envelope expiry; only a newer approved revision clears it. Renewal ordering is deterministic. TCP-I04. |
| TCP-REV04 | Medium | Lost pairing acknowledgement after receipt expiry had no recovery path. | Durably save request ID, binding and candidate secret before request. Candidate-authenticated sync recovers current paired state even after receipt expiry; unrecognized credentials require reviewed repair. TCP-I04. |
| TCP-REV05 | Medium | Concurrent/crashed credential rotations could strand a deployment. | Shared local operation locking, durable current/candidate/generation journal, central generation compare-and-swap and fenced atomic local promotion. Test concurrent operators and crash/response-loss recovery. TCP-I04/I05/I06. |
| TCP-REV06 | Medium | A never-approved installation could inherit the proposed read exception. | Explicit state/access matrix distinguishes pending/rejected, prior-activated expiry/suspension, invalid proof, clock uncertainty and restore quarantine. Read eligibility requires verified prior activation for the current binding; document existence is insufficient. TCP-I01/I04/I05/I06. |
| TCP-REV07 | Medium | Compromised signing keys are not bounded by individual grant lifetime. | Separate ordinary credential revocation from signing-trust compromise. Require authenticated trust replacement through a protected operator/release channel independent of the compromised entitlement key; offline sites require operator delivery. TCP-I04/I08. |

Technical mechanisms and configured proposals live in
[architecture](../../architecture.md#thaarei-central-control-plane-proposal), with
requirements in the [specification](control-plane-specification.md) and corresponding
delivery/acceptance work in the [implementation plan](control-plane-implementation-plan.md).

## Parent configuration review

The parent also corrected the missing host/process/configuration inventory:

- The central Next.js application and its database live on Thaarei's host. Turnstile
  web/API, DMS/local identity and their owning persistence live on each customer host.
  Customer PostgreSQL may host separately owned auth/DMS/Turnstile schemas and roles;
  ownership does not imply three PostgreSQL server containers.
- Complete DMS operation also needs the selected storage, transfer, coordinator, broker,
  publisher, worker, scanner/signature and parser services on the customer side. The old
  three-app Compose and the later DMS-only distribution are not a complete combined
  Turnstile customer release by themselves.
- Production Dokploy routing differs from development Vite proxies. Canonical customer
  issuer/resource/callback and identity-service settings stay separate from central
  approval endpoints. Preserve public/private route boundaries and qualify customer
  container DNS/TLS as well as outbound central connectivity.
- New central settings need owning-process validation, explicit Compose mapping, durable
  protected-file secret/trust delivery and recovery. No central secrets enter Vite, workers,
  parsers or storage. API decision readers do not need a reporter's central credential.
- Coordinator network declarations alone prove neither denied egress nor working central
  DNS/TLS. Its inspected `default` network is not internal; qualify and constrain the
  chosen path while preserving private processing/storage/broker isolation.
- Process/local dependency readiness must permit pairing/sync/recovery even while business
  access is closed. A backend report does not independently prove frontend availability.

Source checks covered [customer app Compose](../../deploy/compose.dokploy.yaml),
[Nginx](../../deploy/nginx/nginx.conf),
[Vite proxies](../../apps/turnstile-web/vite.config.ts),
[Turnstile auth](../../apps/turnstile-api/src/infrastructure/auth-environment.ts),
[identity configuration](../../apps/turnstile-api/src/integrations/identity/identity-environment.ts),
[identity transport](../../apps/turnstile-api/src/integrations/identity/identity-service-transport.ts),
[DMS authority configuration](../../apps/dms-api/src/modules/platform-auth/authority-configuration.ts)
and [identity scopes](../../packages/dms-contracts/src/identity-service.ts). The later
DMS checkout's example/Compose files and current handoff were inspected read-only without
copying its uncommitted implementation or reading private environment files.

## Verification and remaining decisions

Document checks cover local links/headings, requirement references, review-to-delivery
coverage and Git whitespace. No application build/test, container or target-host verification
is claimed for this planning change. Implementation must exercise the production failure
paths specified by each gate, including actual two-host configuration.

Seven-day approval with daily renewal remains owner-selected. Read/recovery exceptions,
staff role/identity defaults, metrics/retention and environment details remain explicit
product decisions for TCP-I01. Correcting a planning gap does not accept those policies
or authorize changing an existing installation.
