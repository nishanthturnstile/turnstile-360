# Turnstile 360 Documents validation workspace specification

Date: 2026-11-17. Owner: Codex. Status: DV-I08 protected validation and selected Core release locally qualified.
Actual completion and verification are recorded in IN_PROGRESS.md; target rollout remains separate.

The owner requested a Documents entry and dedicated sidebar in Turnstile 360 web to
exercise the implemented DMS core API, validate the integration, and fix issues as
delivery proceeds. This specification defines that validation scope. It does not mark
the UI implemented or authorize deployment. Technical proposals live in
[architecture.md](../../../architecture.md#documents-validation-workspace-proposal).
Sequencing and acceptance gates live in the [implementation plan](documents_validation_implementation_plan.md).
Actual completion belongs in [IN_PROGRESS.md](../../../IN_PROGRESS.md).

## Source-backed baseline

The inventory was checked against the executable public route catalogue,
[generated OpenAPI](../../api/dms.openapi.json), Nest controllers, services and tests,
not just the older DMS README or explorer guide. The current contract contains **34
public operations**: 32 authenticated consumer operations, one public service-identity
read and one protected application-enrollment operation. Signed storage PUT/GET and
private worker/operator/identity interfaces are separate surfaces.

The DMS implements document registry, policy projection, upload/batch controls, security
and publication, originals, versions, metadata/tags/references, application sharing,
logical deletion/restore, native extraction, English OCR, processing results/reprocess,
permission-aware search and audit. Installed policy determines available formats and
profiles; source support does not establish deployment readiness.

Turnstile currently has a permission-protected `/api/dms/capabilities` adapter, a
capabilities-only machine token and a shared DMS client with `capabilities`/`enroll`
methods. There is no Documents feature, document user-permission catalogue, product
document controller or document operation history. Existing DMS tests establish useful
baseline coverage; their earlier passing runs are not current Turnstile UI verification.

Primary local references:

- [DMS public routes/contracts](../../../packages/dms-contracts/src/public.ts),
  [registry](../../../packages/dms-contracts/src/registry.ts),
  [uploads](../../../packages/dms-contracts/src/uploads.ts),
  [results](../../../packages/dms-contracts/src/results.ts) and
  [discovery](../../../packages/dms-contracts/src/discovery.ts).
- [DMS client](../../../packages/dms-client/src/client.ts),
  [product integration](../../../apps/turnstile-api/src/integrations/dms/dms.module.ts),
  [machine token](../../../apps/turnstile-api/src/integrations/dms/machine-token.service.ts),
  [product capabilities](../../../apps/turnstile-api/src/integrations/dms/capabilities.service.ts).
- [Workspace navigation](../../../apps/turnstile-web/src/components/workspace-navigation.tsx),
  [web entry](../../../apps/turnstile-web/src/App.tsx),
  [product permissions](../../../packages/turnstile-contracts/src/people-common.ts) and
  [web ingress](../../../deploy/nginx/nginx.conf).
- [DMS requirements](../../dms/headless_dms_functionality_requirements_v1.md),
  [DMS delivery plan](../../dms/dms_implementation_plan.md),
  [private operator contract](../../api/dms-operator.contract.json),
  [private work contract](../../api/dms-work.contract.json),
  [consumer explorer](../../runbooks/dms-api-explorer.md).

## Workspace and requirements

Add **Documents** to the existing workspace navigation. Within `/documents/*`, use a
dedicated contextual sidebar. On smaller screens it becomes an accessible section menu;
do not keep two expanded navigation rails on a narrow screen. Retain the workspace
header, session behavior and current page while a tab refreshes.

| Requirement | Surface                                     | Expected user outcome                                                                                                                                                                                                                                                                                |
| ----------- | ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| DV-R01      | Documents / All documents                   | Browse authorized documents with filename, title, tags, owner/shared indicator, current version and authoritative availability/searchability; exact filters and cursor paging.                                                                                                                       |
| DV-R02      | Documents / Uploads                         | Select a file, inspect allowed formats/profiles/size, upload with progress, complete, poll, refresh transfer authority and cancel eligible work. Reopen a known operation after navigation/reload.                                                                                                   |
| DV-R03      | Documents / Batches                         | Create a manifest, admit each create/new-version item, see independent progress/errors and all pages, retry eligible items, close or cancel without losing successful items.                                                                                                                         |
| DV-R04      | Document / Overview                         | View identity, current state, metadata/tags and namespaced references; edit supported fields and link/unlink references with conflict review. No business record or folder model is invented.                                                                                                        |
| DV-R05      | Document / Versions                         | Inspect paged history and individual versions, add a binary version, download current/historical originals and restore a historical version as a new assessed candidate.                                                                                                                             |
| DV-R06      | Document / Processing and Content           | Inspect exact version/run history, source coverage, warnings, independent index status and safe extracted content; select retained runs; request supported reprocessing.                                                                                                                             |
| DV-R07      | Document / Application access               | Inspect and explicitly replace application grants with READ, EDIT_METADATA and ADD_VERSION. Clearly label these as application access, distinct from Turnstile user roles.                                                                                                                           |
| DV-R08      | Documents / Recovery and document lifecycle | Soft-delete, inspect lifecycle/deadline, logically restore and poll reassessment. Initial recovery is by known document ID or recorded operation; a full Trash directory requires a new authorized discovery contract.                                                                               |
| DV-R09      | Documents / Activity and document Activity  | Browse owner-scoped application and document audit, with paging and attributed actor labels. Authorization issuance is distinct from completed byte delivery.                                                                                                                                        |
| DV-R10      | Documents / Connection and policy           | Show effective operations, formats, profiles, language, format capabilities, admission state/limits and independent product/DMS restrictions. Service identity is an optional protected diagnostic.                                                                                                  |
| DV-R11      | Documents / Validation                      | Provide an explicitly permission-protected coverage checklist and safe operation details: operation name, status, request correlation, expected/observed outcome and readback. Normal feature screens execute the same real workflows. No pasted bearer token, arbitrary URL runner or mock success. |
| DV-R12      | Complete integration                        | Keep business authorization in Turnstile, machine/resource authority in DMS, and credential-free direct byte transfer at the storage capability boundary. Honor backend validation and current access on every action.                                                                               |
| DV-R13      | Recoverability                              | Preserve operation identity across uncertain responses, reauthorize before retry/readback, retain independent stage outcomes and keep saved data/drafts coherent after conflicts or outages.                                                                                                         |
| DV-R14      | Evidence and release                        | Track every public operation and applicable transfer through contract, product adapter, real browser/integration, failure path and exact release evidence. Private surfaces receive their own evidence classification.                                                                               |
| DV-R15      | Access-contract compatibility               | Introduce the Documents permission catalogue through a staged versioned rollout. Existing open clients receive their exact supported contract before activation or a supported sign-in/refresh recovery afterward; incompatible permission payloads and destructive legacy writes never reach them.  |
| DV-R16      | First-validator handover                    | Provision the first explicit custom company validator role through a private audited product command with verified identity, expected revision, idempotency and revocation. No system-role expansion, startup grant or ordinary HTTP escalation.                                                     |
| DV-R17      | HTTP boundaries                             | Accept valid DMS upload/edit/batch controls through scoped product and gateway request limits; bound control responses and artifact transfers independently and return typed size/media errors. Preserve unrelated auth limits.                                                                      |
| DV-R18      | Expired or uncertain operations             | Bound replay to the upstream window. If IDs remain unknown at expiry, show durable unresolved/manual-review status, retain minimal retry evidence and prohibit automatic replacement. Old/pruned operation IDs cannot execute as new work.                                                           |
| DV-R19      | Validation / Contribute                     | Exercise independent shared EDIT_METADATA and ADD_VERSION rights through known-ID, owner-supplied inputs without document READ. Show only authorized mutation acknowledgement; owner verification is separate from contributor visibility.                                                           |
| DV-R20      | Restricted deployments                      | Public writes, including completion and batch controls, pause unless both products allow full access. Authorized reads and already accepted private work retain their existing rules; renewed authority never extends an expired replay window.                                                      |

Document tabs are Overview, Versions, Processing, Content, Application access, Lifecycle
and Activity. Show only authorized tabs/actions; expose permission changes through
fresh backend decisions. Upload is a primary action and has a recoverable activity view.
Search is a Documents view/toolbar mode, not an unsupported second document store.

The separate Validation view is limited to explicit validators and includes Contribute
for known-ID shared writes, with separate edit/upload action permission. The functional
screens must be real product integrations, using the same backend. A development gallery
can illustrate states with fictional content; it cannot stand in for this validation UI.

## Complete public endpoint-to-UI coverage

Paths below are DMS paths, not browser-accessible machine-token routes. Product endpoint
names are frozen in the first delivery increment. Coverage IDs are stable planning
references. Actual implemented routes and source/browser/image/target evidence are tracked
in the coverage register and IN_PROGRESS.md; the complete inventory includes future increments.

| ID     | DMS method and path                                              | UI or deliberate boundary         | Critical validation                                                                                                                             |
| ------ | ---------------------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| DV-E01 | `POST /v1/search`                                                | Search                            | Exact filters/full-text, source snippets, active result/index state, filtered pagination and immediate visibility loss after revocation/delete. |
| DV-E02 | `GET /v1/documents/{documentId}/processing`                      | Processing                        | Current/explicit version, exact active run, all history pages, partial/failed runs.                                                             |
| DV-E03 | `GET /v1/documents/{documentId}/content`                         | Content                           | Current/explicit version/run, unavailable result, artifact transfer, schema/hash/size verification.                                             |
| DV-E04 | `POST /v1/documents/{documentId}/versions/{versionId}/reprocess` | Processing action                 | Supported searchable/structured profile, stable replay, concurrent run denial and previous accepted result retention.                           |
| DV-E05 | `GET /v1/documents/{documentId}/lifecycle`                       | Lifecycle / Recovery              | Owner-only state, revision, restore deadline and fresh reassessment counts.                                                                     |
| DV-E06 | `DELETE /v1/documents/{documentId}`                              | Delete action                     | Current If-Match, immediate withdrawal, queued/late work cannot resurrect visibility.                                                           |
| DV-E07 | `PATCH /v1/documents/{documentId}`                               | Overview editor                   | Typed metadata/tags/title, replacement semantics, latest revision and uncertain-write readback.                                                 |
| DV-E08 | `GET /v1/documents/{documentId}`                                 | Overview                          | Authorized detail, ETag/revision, owner/shared distinction and unavailable/not-found behavior.                                                  |
| DV-E09 | `POST /v1/documents/{documentId}/restore`                        | Lifecycle restore                 | Same logical ID, replay after intervening delete, deadline expiry and independent original availability.                                        |
| DV-E10 | `GET /v1/documents/{documentId}/permissions`                     | Application access                | Owner-only current grants and revision.                                                                                                         |
| DV-E11 | `PUT /v1/documents/{documentId}/permissions`                     | Application access editor         | Full replacement/revoke-all, valid registered targets, current revision and live revocation.                                                    |
| DV-E12 | `POST /v1/documents/{documentId}/references`                     | Overview references               | Complete namespace/type/externalId tuple, caller attribution, duplicate behavior and If-Match.                                                  |
| DV-E13 | `DELETE /v1/documents/{documentId}/references/{referenceId}`     | Reference removal                 | Reference UUID differs from externalId; caller namespace/ownership and stale revision.                                                          |
| DV-E14 | `POST /v1/documents/{documentId}/versions/uploads`               | Add version                       | Current logical revision, stable begin identity and previous current original retained until publication.                                       |
| DV-E15 | `GET /v1/documents/{documentId}/versions`                        | Versions                          | All pages, security/availability separate, restored-from relation and current marker.                                                           |
| DV-E16 | `GET /v1/documents/{documentId}/versions/{versionId}`            | Version details                   | Explicit version binding, wrong-document rejection and upload-state projection.                                                                 |
| DV-E17 | `POST /v1/documents/{documentId}/versions/{versionId}/restore`   | Restore version                   | New reassessed binary revision, original expected revision on replay, no in-place rollback.                                                     |
| DV-E18 | `GET /v1/documents/{documentId}/download`                        | Current/history download          | Live entitlement, versionId selection, short expiry, exact bytes/hash and range behavior.                                                       |
| DV-E19 | `POST /v1/uploads`                                               | New upload / admit batch item     | Descriptor bounds, profile/type policy, quota, stable key, metadata and batch/item binding.                                                     |
| DV-E20 | `GET /v1/uploads/{uploadId}`                                     | Upload activity                   | Completion requested versus published; independent upload/security/availability/processing.                                                     |
| DV-E21 | `DELETE /v1/uploads/{uploadId}`                                  | Cancel upload                     | Eligible-session-only cancellation, contributor control and race with completion.                                                               |
| DV-E22 | `POST /v1/uploads/{uploadId}/complete`                           | Finish byte upload                | Durable intent/202, lost acknowledgement, same-key replay and poll; no immediate success claim.                                                 |
| DV-E23 | `POST /v1/uploads/{uploadId}/refresh`                            | Retry eligible transfer           | Same immutable staging identity, expiry, no revival after completion/terminal state.                                                            |
| DV-E24 | `POST /v1/upload-batches`                                        | Batch creation                    | At most 100 unique items, descriptor/manifest bounds; creates no file sessions itself.                                                          |
| DV-E25 | `GET /v1/upload-batches/{batchId}`                               | Batch details                     | All item pages, whole-manifest counters, isolated delays and current authorization.                                                             |
| DV-E26 | `DELETE /v1/upload-batches/{batchId}`                            | Cancel batch                      | Cancels eligible sessions/unstarted items, preserves published documents.                                                                       |
| DV-E27 | `POST /v1/upload-batches/{batchId}/close`                        | Close batch                       | No new unstarted items, bound sessions retain deadlines, stable replay after state changes.                                                     |
| DV-E28 | `GET /v1/documents/{documentId}/audit`                           | Document Activity                 | Document ownership plus read/audit scopes, all pages and correct application-asserted attribution.                                              |
| DV-E29 | `GET /v1/documents`                                              | All documents                     | Exact filename/title/tag/reference filters, authorized paging, no invented total/sort/trash filters.                                            |
| DV-E30 | `GET /v1/admission-policy`                                       | Connection / upload constraints   | Effective enabled/paused/not-configured/not-installed policy and current limits.                                                                |
| DV-E31 | `GET /v1/audit`                                                  | Activity                          | Current application's owner stream; no installation-wide audit claim.                                                                           |
| DV-E32 | `GET /v1`                                                        | Connection diagnostic             | Service identity is distinct from dependency, scanner or processing readiness.                                                                  |
| DV-E33 | `GET /v1/capabilities`                                           | Connection / feature availability | Scopes, installed formats/profiles and optional deployment status; preserve existing readers.                                                   |
| DV-E34 | `POST /v1/application-enrollments`                               | Provisioning evidence only        | Existing protected backend/operator flow verifies enrollment/replay. No ordinary Documents enrollment form or browser credential entry.         |

DV-E01–31 and DV-E33 are the 32 authenticated consumer operations. DV-E32 is public at
DMS, but any Turnstile diagnostic adapter still requires product authorization. DV-E34
remains part of the coverage register with private provisioning evidence rather than
being silently omitted from endpoint coverage.

Signed transfer coverage is additional: staging PUT plus preflight, original GET plus
range/preflight, and extraction-artifact GET plus preflight. Validate real configured
ingress headers, CORS, CSP, exact signed headers, expiry, denied origins, missing bytes,
create-only collisions and checksum mismatch. Browser code must not set Content-Length;
a known-size File/Blob lets the browser supply it.

## Other DMS surfaces and supported exclusions

| Surface                                                              | Validation treatment                                                                                                                                                                       |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Identity/OIDC, invitations and private identity service              | Reuse real Turnstile login/session and existing identity evidence. No second identity-management UI under Documents.                                                                       |
| Health/live, auth/API/processing readiness, deployment health        | Operator/runtime checks with appropriately projected connection status if needed; liveness alone never means ready.                                                                        |
| `/docs/*` protected explorer                                         | Retain separate operator gate. Current explorer permits GET execution only, so Documents supplies the missing product mutation journeys.                                                   |
| Private `/internal/work/*` publisher/scanner/extractor/heavy routes  | Existing separate audience/worker-grant tests plus observed production processing in the end-to-end fixture; never expose claims, heartbeats, results or scanner approval controls in web. |
| `dms:manage-operator`, application/client/admission-policy operators | Private commands retain their existing fresh authentication and explicit DMS authority. Public policy is read-only; web is not an operator-credential bridge.                              |
| Backup, restore, physical purge, disposal and redrive                | Private operational qualification. Lifecycle screen may show PURGING/PURGED when returned; no web purge/backup buttons are implied.                                                        |
| Central approval, module selection, contractual licences             | Existing signed deployment and module authority remain required. Documents cannot provision products, select tenants, extend licences or bypass either product's restriction.              |

Do not add folders, human-to-human sharing, public links, inline original previews,
comments, approvals/e-signing, archive import, multipart/resumable uploads, bulk purge,
new languages or mobile implementation. The capabilities contract explicitly reports
preview as false. Optional structured extraction is enabled only when installed,
qualified and allowed; a screen is not evidence that the heavy profile is available.

## Source-confirmed gaps and implementation dispositions

These are implementation gaps or limitations, not claims of freshly reproduced DMS
runtime bugs. Track newly reproduced defects separately with a failing production-path
test and the owning component.

| Gap                                                           | Evidence and consequence                                                                                                                                        | Planned disposition                                                                                                                                                                                                               |
| ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No document product API/client methods                        | Shared client only supports capabilities/enroll; token service requests only capabilities.                                                                      | Add typed operations and explicit least-privilege machine provisioning, retaining independent registration/issuer ceilings.                                                                                                       |
| No document user permissions                                  | Canonical permission catalogue has capabilities read but no document actions.                                                                                   | Define explicit company-wide validation roles/permissions before activation; no automatic access for all members or existing administrator templates.                                                                             |
| Strict legacy permission readers                              | Sessions, catalogue and nested People role/member/invitation payloads use closed permission sets.                                                               | DV-R15: catalogue-v3 negotiation and durable release barrier; old-bundle/new-API checks precede any new role/grant, including blocked legacy writes and rollback fencing.                                                         |
| No initial holder of Documents rights                         | Ordinary role administration cannot grant permissions the actor lacks; private administrator/module-reader commands do not grant the full Documents action set. | DV-R16: implement verified private custom-role grant/revoke/handover in DV-I02; validate real session-v3 login and access before opening the workspace.                                                                           |
| Minimal capabilities projection                               | Existing DTO drops operations, formatCapabilities and policy limits; errors collapse to denied/unavailable.                                                     | Add a separately versioned Documents bootstrap/typed error contract; preserve old capabilities consumers.                                                                                                                         |
| Transport assumes small responses                             | `jsonRequest` has a 16 KiB response bound; document pages, metadata, batch details and manifests may exceed it.                                                 | Route-specific finite control response bounds; separate bounded artifact transfer; preserve token/enrollment limits.                                                                                                              |
| Product request parser is also 16 KiB                         | Turnstile's default request limit is smaller than supported DMS upload/edit and batch controls.                                                                 | DV-R17: Documents-only request/envelope budgets, upstream inner-body validation, gateway alignment and typed parser/ingress 413/415 tests in DV-I02–05.                                                                           |
| Browser transfer blocked by current CSP                       | Web ingress has `connect-src 'self'`; transfer uses a separate configured origin.                                                                               | Coordinate narrow deployment-derived transfer-origin allowlisting and storage CORS, including exact production images. No wildcard or global relaxation.                                                                          |
| No upload/batch directory                                     | Public routes read only known IDs.                                                                                                                              | Use a product-owned durable operation register and ID lookup; it describes Turnstile-initiated work only. Broader DMS directories would be additive owning work.                                                                  |
| No deleted-document directory                                 | Document response is ACTIVE-only; no lifecycle filter/list endpoint.                                                                                            | Recovery by known ID/recorded delete, with honest coverage labels. Full Trash requires an explicitly designed DMS extension.                                                                                                      |
| No application directory                                      | Permissions accept target application UUIDs; no consumer picker/list contract.                                                                                  | Validate using operator-provisioned nonsecret fixture IDs; initial advanced UUID entry. A friendly picker needs a narrow authorized directory, not operator credentials.                                                          |
| No effective document-rights projection                       | Owner-only grants are not readable by a shared consumer; global capabilities do not disclose shared document rights.                                            | DV-R19: keep normal shared tabs read-only and use explicit Contribute for shared writes with owner-supplied revision/descriptor. No effective-rights API extension or READ grant is needed.                                       |
| Public completion is a full-access operation in both products | Product non-GET guards and DMS public write-scope transactions require full access; the private worker completion exception is separate.                        | DV-R20: retain public denial during existing-reads, preserve the operation, allow authorized reads and reauthorize same-intent resumption only after both products regain full access. Product GET search translates to DMS POST. |
| Receipt expiry with lost resource IDs                         | Upstream replay ends after 24 hours; no consumer by-key resolver or upload/batch directory exists.                                                              | DV-R18: bounded reconciliation, durable unresolved/manual review, tombstones and no replacement. Explicit expiry/pruning/restore tests are part of DV-I03.                                                                        |
| Current documentation contains historical limitations         | Explorer guide says no ETag/202 despite current handlers exposing both; some README feature/format notes are historical.                                        | Correct touched consumer guidance during first increment, retaining historical progress records. Use current contracts/handlers as inventory authority.                                                                           |
| Foundation inventory needs extension                          | DmsModule is existing foundation integration; Documents is absent from the executable composition.                                                              | Deliver Documents within the foundation DMS integration, update owning inventory and verify all selected profiles in DV-I02. A separately selectable commercial module is outside this baseline.                                  |

Initial user access is **explicit company-wide DMS validation access**.
Users granted that access can act across the Turnstile application's authorized document
set according to their action permissions. Organization-unit restrictions, private user
libraries and business-record ownership are separate requirements; a client-side filter
cannot supply them. DV-I01 encodes this baseline; it does not reopen these scope choices.

## Review findings resolved in the planning baseline

The owner requested addressing DMS-WEB-REVIEW-01 on 2026-11-17. These are settled
delivery decisions, not claims that the missing handlers or safeguards are implemented.
Exact contracts, budgets, authority and recovery policy are owned by the
[Documents architecture baseline](../../../architecture.md#documents-validation-workspace-proposal).

| Finding                                   | Resolution                                                                                                                                                                                                             | Owning increment and acceptance                                                                                                                                |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RF-01: legacy permission compatibility    | Staged catalogue-v3 negotiation; activate the private compatibility barrier before any Documents role/grant. Legacy permission-bearing requests then use supported 401 recovery rather than incompatible success data. | DV-I01–02: actual old/new bundles, assigned/unassigned users, nested People/import/invitation/receipt payloads, legacy writes, activation retry and rollback.  |
| RF-02: first validator                    | Private verified product role/assignment command; explicit company scope; normal anti-escalation and system roles unchanged.                                                                                           | DV-I02: grant/retry/conflict/revoke/handover, proof/scope denial, audit rollback and real ordinary login/readback.                                             |
| RF-03: request budgets                    | Scoped upload/edit/contribution/batch envelopes and upstream inner bounds; gateway and parser errors share typed failure behavior.                                                                                     | DV-I02–05: exact/over/UTF-8 limits, server actor overhead, valid full manifest and real ingress 413/415.                                                       |
| RF-04: receipt expiry                     | Draft intent before dispatch; finite authorized replay; durable unresolved state, manual disposition and non-reusable operation IDs/tombstones.                                                                        | DV-I03: commit/lost response/local crash/expiry, post-prune retry, restore and known-ID recovery without duplicate resources.                                  |
| RF-05: independent shared mutation rights | Known-ID Contribute for metadata/reference/new-version actions without a READ requirement; contributor cannot observe publication through forbidden reads.                                                             | DV-I06: successful edit-only/add-version-only browser actions, forbidden reads, explicit owner verification, reload and revocation.                            |
| RF-06: restricted public completion       | Preserve the existing full-access requirement in both products; do not add a public completion exception.                                                                                                              | DV-I03: each product independently restricted/closed, writes denied, reads controlled, accepted worker work independent, renewed/replayed and expired intents. |

## Validation acceptance

Every consumer row must be exercised through the real Turnstile backend, with matching
contract checks and an appropriate browser journey. Use focused automated journeys
covering several related operations, not one superficial test per button. Provision a
second isolated application to establish real sharing/namespace/owner boundaries.

Record planned, implemented, source-tested, production-image-tested and target-accepted
states separately. An endpoint is not validated merely because its request returned 200:
read back persisted state/bytes and check audit, replay and denied behavior as applicable.
No automated evidence should contain credentials, signed URLs, document bodies or real
customer data. Validate with disposable synthetic files and preserve existing installations.

## External research

The plan's conditional-write, range and conservative retry approach follows
[RFC 9110](https://www.rfc-editor.org/rfc/rfc9110.html), especially sections 9.2.2,
13.1.1 and 14. Automatic mutation replay requires established operation semantics and
stable operation identity; stale revisions require refetch/review.

File checks remain server-authoritative; authorization, bounded sizes, independent
type/content checks and safe retrieval follow the
[OWASP File Upload guidance](https://cheatsheetseries.owasp.org/cheatsheets/File_Upload_Cheat_Sheet.html).
These sources were reviewed on 2026-11-17. They support the plan's engineering choices;
they are not evidence of this installation's acceptance or a dependency upgrade proposal.
