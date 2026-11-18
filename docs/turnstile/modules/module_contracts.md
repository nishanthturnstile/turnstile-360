# Module foundation contracts and ownership

MOD-I01 implements `@thaarei/module-catalog`: strict metadata schemas, proposal resolution,
exact-confirmation profile creation, canonical SHA-256 and active-catalogue removal closure.
Web Crypto/TextEncoder keeps hashing portable to Node 24 and browsers. No executable
entrypoints, Node builtins or server services are exported. No production catalogue is
published by the shared package. MOD-I04 owns source-backed Incident/Risk packaging and
the strict generic delivery request/result adapter; see the
[delivery runbook](../../deployment/thaarei_ecosystem_guide.md#delivery).

## Fixed foundation inventory

The virtual `foundation` ID aggregates the current product base, not a new runtime module
or database. Its source is [AppModule](../../../apps/turnstile-api/src/app.module.ts):

| Existing imports/providers              | Existing responsibility                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| AuthModule                              | OIDC/browser session, identity and CSRF checks in modules/auth.                                                    |
| AccessModule                            | Canonical access, memberships, private administration/release barriers in modules/access.                          |
| OrganizationModule and OnboardingModule | Organization, configuration, structure and readiness in modules/organization and modules/onboarding.               |
| PeopleModule                            | People, invitation and recipient administration in modules/people.                                                 |
| ProductPersistenceModule                | Single product pool/transaction host and database readiness in infrastructure/database.                            |
| IdentityModule                          | Authenticated private authority integration in integrations/identity, separate from central staff identity.        |
| DmsModule                               | Separately permission-protected DMS connection in integrations/dms; DMS remains an independent product.            |
| Root controllers/providers              | App/health/deployment endpoints, DeploymentService, telemetry, UserSessionGuard and global ApplicationAccessGuard. |

Existing exceptions are governed by infrastructure/access-policy.ts, workspace-access.ts,
ApplicationAccessGuard and owning service/private release checks. This inventory makes
no endpoint public or approval-exempt. New business modules never inherit foundation
exceptions by changing category. MOD-I01 changes no application imports, routes or schema.

## Frozen wire conventions

Catalogue v1 fixes exact module version strings (no ranges), one platform/source and exact
contract/migration versions. Required edges form a DAG; optional references may be
reciprocal and confer no entitlement. Self/duplicate/unknown edges and required/optional
overlap fail. Core requires Core; the fixed `foundation` entry must exist and remain
Core, so reclassifying another module cannot remove authentication/access infrastructure.
Limits are 64 modules
and 512 edges. Platform metadata acceptance does not qualify an actual ARM/x86 target.

Canonical JSON uses the fixed property order in the exported serializers, lexically
sorted ASCII IDs/edges, and UTF-8 SHA-256. Profile identity includes catalogue UUID/digest,
source, platform, exact compatibility versions and ID/version tuples. Callers must use
these helpers rather than hash their own JSON. `resolveSelection` proposes dependency
closure; `createProfile` requires exact confirmation of the whole resolved set.

`assignmentCommand` binds registered product/revision, operation, catalogue, requested/
confirmed sets, explicit removals, confirmed removal closure and nullable active basis.
The persistence owner checks actual active basis and receipt transactionally; parsing
cannot do that comparison. MOD-I03 uses the registry product revision as expectedRevision;
draft save and desired approval each advance it once. Initial commands target an existing
registered product with a positive revision. Draft/approved snapshots and pointers are
owned centrally, independently of future installed/effective policy. Current handlers
validate nonnull active bases/removals against the verified authority supplied by MOD-I06/08.

Intent payload v1 fixes audience `urn:thaarei:installer`, JWT type
`thaarei-installation-intent+jwt`, issuer/binding, separate DMS product, fresh/adoption mode,
desired context and release; maximum validity is 24 hours. Decision payload v2 is strictly
Turnstile-only and preserves the existing identity envelope. Approved claims add active/
desired context, change revision and allowed IDs; denials cannot carry rights. Active
and outer policy revision must agree; validity is bounded to seven days.

**Schemas and `validateDecisionContext` do not verify signatures, live time, expected
identity/epoch, ordering, revocation or actor authority.** The server-only deployment-control verifier performs these checks when supplied its
verified installed release context; owning adapters must supply and persist it before use. Context validation checks the actual catalogue,
complete installed profile, expected release and dependency-closed allowed subset including
Core. Results are not branded verified decisions. Existing runtime v1 remains unchanged.

## Ownership and retry matrix

| Fields/operation                                                  | Authority                                 | Commit and retry rule                                                                                                                  |
| ----------------------------------------------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Code IDs/versions/dependencies, source/platform, artifact digests | Trusted external release pipeline         | Immutable attestation; exact request/result reconciliation. Cryptographic intake is MOD-I02/04.                                        |
| Classification/publication                                        | Central Admin with current MFA            | New version, expected revision, reason, operation ID and atomic audit/receipt. No in-place released edit.                              |
| Desired assignment / confirmed sets                               | Central Admin/Operator with current MFA   | Compare catalogue/active basis, validate closure, atomically commit receipt/audit/policy; lost response reuses exact payload. MOD-I03. |
| Reserved IDs / intent                                             | Central registry and local initializer    | Fresh-only immutable binding; renewal preserves IDs. Adoption keeps actual local identities. MOD-I05.                                  |
| Active profile / signed allowed set                               | Central issuer and local verifier/reducer | v2 floor; signature/full binding/epoch/order/time checks before durable apply/ack. Newer revision for changed authority. MOD-I06.      |
| User grants / local enablement                                    | Customer access services                  | Local state only reduces signed rights; assignment grants no role. Existing private commands/current revisions apply. MOD-I07.         |
| Mixed replacement                                                 | Central active-policy owner               | Confirm active dependant removals first; stage additions. Stale active basis conflicts; never remove Core individually. MOD-I08.       |

## Compatibility and handoff

Legacy v1 Turnstile/DMS contracts and enforcement are unchanged. New module-managed
Turnstile requires v2 centrally and locally; DMS can stay v1. Central support precedes
enforcing customer releases and explicit activation. Unknown/malformed versions never
become default-all. Signature/replay/expiry/restore and production handshake verification
belong to MOD-I06. Architecture's expiry and mixed-change matrices remain normative.

MOD-I01 tests only contracts/resolution/hashing with synthetic data. They do not prove
staff UI/MFA, transactions, selected image exclusion, setup or real-user module access.
MOD-I02 implements catalogue persistence, verified intake/publication and staff UI.
MOD-I03 adds actual staff per-product selection, dependency confirmation and immutable
desired assignment; it does not deliver selected customer images or module authority.


## MOD-I06 shared protocol milestone

`moduleSyncRequest`/`moduleSyncResponse` are strict v2 Turnstile-only schemas; the existing
v1 schemas remain strict. The v2 request carries installed catalogue/profile/release IDs
as reported context, never activation evidence. `versionedSyncRequest`,
`versionedSyncResponse` and `versionedDecision` accept only their explicit v1/v2 variants.

Deployment-control verifies release and decision signatures separately. Its store hook
`moduleRelease()` supplies verified installed context; HTTP cannot choose the floor.
The client journals the exact v2 request before transport, rejects response downgrade,
and commits accepted decision, candidate promotion and acknowledgement together. It
refuses retries if the installed release differs from a pending v2 journal. Acceptance
persists a minimum version of 2 and a release trust revision; missing context or rollback
closes access. All module-policy facts must remain equivalent during same-revision renewal.

`evaluateDecision` retains the existing foundation read policy;
`evaluateModuleDecision` returns no module IDs after expiry or signed denial. Its result
still requires owning user/resource permissions and local enablement. The owning central issuer and Turnstile adapter now wire versioned sync, permanent
central enforcement, signed installed release loading and SQL decision evaluation.
The module evaluator supplies the implemented MOD-I07 capability/landing slice. Real signed
HTTPS/PostgreSQL and selected installed-image adapter qualification now pass MOD-I06,
including shipped reporting, private-file failure and two isolated legacy customer clusters.
The API gate invokes owning evaluator/store functions in the selected image; ordinary
module HTTP/login and staff activation are qualified separately by MOD-I07/08. See the
[decision runbook](../../runbooks/module-decisions.md).
