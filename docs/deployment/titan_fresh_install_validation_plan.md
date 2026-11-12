# Titan fresh installation and browser acceptance plan

Date: 2026-11-12. Owner: Codex. Status: local execution and fixes in progress; see the current results report.

## Objective and source of truth

Reset the existing local Thaarei central and Turnstile/DMS test installation, onboard
Titan as a fresh customer, exercise supported staff/customer journeys through the browser,
and rewrite installation guidance from observed results. No deletion, provisioning,
application change or browser acceptance occurred during planning. See the execution
checkpoint below for work performed after authorization.

Use [architecture](../../architecture.md) for design, timing and topology;
[IN_PROGRESS](../../IN_PROGRESS.md) for actual execution results. Relevant scope is
TCP-R01–10, MOD-R01–20, the onboarding/user-management requirements, and IA-R01–18.
This plan does not mark the wider installer or production acceptance gates complete.

## Findings that determine execution

- Local `development` at `c75b4cb` contains remote `development` at `92f7320`
  (checked directly with `git ls-remote`). The extra local commit is documentation.
  Recheck and pin the commit before building; running image tags do not establish freshness.
- Existing local stacks are `turnstile-local` and `thaarei-manual-central`.
  The private `.dms-manual-testing-20261107/START-HERE.md` describes the old installation.
  It contains completed-step history and private-path references, so it is not a clean
  customer guide. Do not copy its private credentials/state into the new installation.
- README startup/status text is stale in places. Existing runbooks span fresh installs,
  upgrades, module POC and full DMS operations; these are different scopes.
- Current central staff admission has no public signup. The first administrator requires
  private bootstrap; verification, login, MFA and later staff admission have UI paths.
- The installer requires private operations for provisioning, pairing application, identity
  clients, initial admin handover/release opening, and some initial module reader grants.
  These are installation prerequisites, not browser-tested customer interactions.
- Incident Management and Risk Management are module placeholders with guarded landing
  pages. Test delivery, entitlement and permission enforcement; do not claim full incident
  or risk business workflows exist.
- DMS is headless. Turnstile has a DMS connection/status UI, not complete document screens.
  The controlled explorer supports only part of the DMS contract. A complete upload,
  processing and document lifecycle proof is not possible through today's UI alone.
- No browser-use/agentic-browser SKILL.md was found in the available skill roots.
  T3 shared-browser preview tools are available and are the execution mechanism; no skill
  installation is needed for planning. Start execution with preview_status, then use the
  shared browser, normal navigation, forms and downloads.

## Execution rules

All supported business actions use visible UI: staff/customer login, verification mail,
MFA enrollment, customer registration, module choices, approval, invitations, role changes,
onboarding and restrictions. Do not replace them with curl, direct SQL, scripted fetch,
API fixtures, hidden browser evaluation mutations or pre-created successful business state.
Read-only browser network observations can substantiate actions made through the UI.

Infrastructure deletion, build, migrations, private bootstrap and controlled fault injection
cannot be done through the current product UI. Record these separately as operator steps.
If strictly zero CLI/API operations are required even for setup, stop at this boundary:
additional installer/admin UI is needed before the complete requested workflow is possible.
Missing UI is a recorded gap, not a passing scenario. No new UI is authorized by this plan.

MFA stays enabled. Enroll disposable staff accounts through the actual screen, store the
seed/recovery codes privately, and enter current authenticator codes through the UI.
An isolated authenticator may generate test codes; production verification still runs.
Do not set database verification flags, mock auth or add bypass settings. User-owned
secrets, if needed, use the secure secret-input tool, never chat or recorded screenshots.

## Phase 1 — freeze the baseline and cleanup manifest

1. Recheck branch, working tree and remote; preserve unrelated edits and pin the tested SHA.
2. Inventory exact container IDs, Compose project labels, networks, volumes, bind mounts,
   image IDs, private state paths, mail capture and browser origins for both local stacks.
   Follow mounts to their actual storage; a database-only wipe is insufficient.
3. Resolve installer-labelled `thaarei-<uuid>-postgres` volumes and anonymous volumes to
   their owning run before including them. Names alone do not authorize deletion.
4. Produce a private deletion manifest with exact resource/path, owner, reason and action.
   Identify any old backups/export copies that also contain selected disposable test data.
   No retained old-data backup is needed for a deliberately empty reset; do not silently
   create one. Preserve nonsecret procedure/evidence needed to reproduce the installation.
5. Record selected HTTPS origins and fixed port bindings from architecture. Check WSL,
   host and container time stability before authentication tests.

### Cleanup scope

| Resource                                                                         | Planned action                                                                                                                                                                        |
| -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `turnstile-local` containers and dedicated networks                              | Stop writers/reporters/workers first, then remove exact owned resources.                                                                                                              |
| `thaarei-manual-central` containers and dedicated networks                       | Stop and remove exact owned resources after mapping mounts.                                                                                                                           |
| `turnstile-local_postgres-data`                                                  | Delete selected local auth, DMS and Turnstile persistence by removing its dedicated volume.                                                                                           |
| `thaarei-manual-central_central-data`                                            | Delete local staff, MFA/session, registry, pairing, catalogue, assignment and audit state.                                                                                            |
| `turnstile-local_storage-data`, `storage-config`                                 | Remove owned object data and generated storage configuration.                                                                                                                         |
| `turnstile-local_work-broker-data`, `broker-config`, `work-scratch`              | Remove queued jobs, broker state/configuration and temporary processing files.                                                                                                        |
| `turnstile-local_dms-signatures`                                                 | Reset local scanner signature volume and recreate/update through supported initialization.                                                                                            |
| Old private test directory and other proven owned generated paths                | Remove credentials, manifests, pairing files, receipts, trust/denial state, journals, local dumps and generated Compose files after extracting nonsecret procedure notes.             |
| Captured mail, downloaded pairing/setup files, browser state                     | Clear only the test installation's inbox/storage/downloads/cookies/site data.                                                                                                         |
| Project-only old images                                                          | Remove obsolete tags/images only after checking references; rebuild selected release from pinned code. Shared base images and build cache need not be deleted to clear customer data. |
| Tracked Dockerfiles, Compose definitions, migrations, source and examples        | Retain as reproducible installation inputs; review/fix after execution demonstrates a defect.                                                                                         |
| Architecture, specifications, frozen qualification evidence, LICENSE and notices | Preserve. Historical evidence is not current-installation proof.                                                                                                                      |
| Other Docker projects, unrelated volumes and browser profiles                    | Exclude. Docker inventory includes unrelated nilumi/fleet/kairn/azure resources.                                                                                                      |

“Delete Docker files” here means discard old runtime/generated deployment state. Deleting
tracked Dockerfiles/Compose inputs would remove the supported way to rebuild. Never use
host-wide Docker prune or wildcard directory removal. Revalidate the manifest at execution.

## Phase 2 — establish the empty installation

1. Execute the scoped reset; verify selected volumes/paths and old containers are gone.
2. Build/verify current central and exact selected module artifacts using pinned tooling.
   Prepare all four profiles: Core only, Core + Incident, Core + Risk, Core + both.
   Use selected production images; the legacy development-source v1 path cannot qualify v2.
3. Create separate empty central/customer persistence with supported owning migrations.
   Prepare HTTPS ingress and controlled Mailpit delivery, independent signing/trust and
   auth secrets. Keep credentials outside source and frontend configuration.
4. Bootstrap one Thaarei staff Admin privately. Do not seed Titan, products or approvals.
5. Clear old origin state and demonstrate the empty central registry in the browser.
   Fresh databases contain required migrations/system records, not zero tables/rows.

Exit: clean reset inventory, pinned artifact identities, healthy prerequisite services,
empty business registry and a usable first-admin verification message.

## Phase 3 — Thaarei staff and Titan registration, through the browser

1. Open Mailpit, follow the real first-admin verification link, sign in and enroll TOTP.
   Sign out/in to prove normal MFA; verify recovery codes without exposing them in evidence.
2. Admit a test Operator and Viewer through Staff; complete their real verification,
   password setup and MFA in separate browser sessions. Check their authority boundaries.
3. Publish the supported signed module catalogue through its staff UI after supplying
   genuine release metadata/evidence from the build owner. Foundation remains Core.
   Begin with Incident and Risk as Individual modules; separately test classification.
4. Create client **Titan** with a stable test code, reserve one installation and register
   independent DMS and Turnstile products using the current central-first intent flow.
   Both belong to the same customer installation/tenant; application credentials differ.
5. Select both modules, review the full dependency selection, save and approve the desired
   assignment. Check that a draft or approved desired selection alone grants no access.
6. Obtain the matching verified package and signed installation intent through the staff
   flow. Observe awaiting-package/error states when evidence is absent or mismatched.

## Phase 4 — install, pair and activate

1. Operator runs the supported fresh installer using the actual intent and matching bundle.
   It must refuse stale/mismatched inputs and existing unknown state rather than reset it.
2. Through central UI issue/download independent one-use DMS and Turnstile pairing files.
   Operator applies them to the owning products. Pairing alone must leave business closed.
3. Through central UI independently approve each product with current MFA. Allow actual
   sync/acknowledgement; distinguish central Approved from applied local authority.
4. Observe fresh installed inventory and matching delivery in central. Explicitly activate
   the installed module profile, then await applied signed v2 authority.
5. Verify independent DMS/Turnstile reports and stale/unknown states. A green report is not
   proof that browser access, module permission or document processing works.

## Phase 5 — Titan customer setup and baseline access

1. Operator provisions the first Titan identity and distinct identity/login/machine clients
   using supported private flows. Verify email in the browser; do not seed verified status.
2. Sign in through ordinary Turnstile login. Perform the existing private first-admin
   handover/release opening; keep any required session proof private and unrecorded.
3. Complete company setup in UI: Titan profile, country/time zone/units and required first
   organizational unit. Refresh midway, resume, finish, then verify Settings persistence.
4. Invite Titan users through People: a both-module reader, Incident-only reader, Risk-only
   reader and a shell-only user. Accept invites/verify/login normally. Bootstrap missing
   reader authority with the documented private owning grant, then exercise UI role
   administration where supported; log that prerequisite separately.
5. Confirm both modules for the both-reader, only the permitted module for each limited
   reader, and neither for shell-only. Administrator status alone must not grant modules.
6. Check the DMS connection/status UI with and without its explicit permission. Record
   full DMS upload/OCR/lifecycle tests as unavailable through current business UI.

## Phase 6 — entitlement and enforcement matrix

For each change, keep a Titan session/tab open, also test a fresh login, reload navigation,
open a bookmarked module URL and trigger the normal landing-page request. Capture visible
results and browser-observed server denial. Hidden navigation alone is not a pass.

| ID  | Scenario                                                               | Expected observation                                                                                          |
| --- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| M01 | Both installed, approved, active, enabled; reader has both permissions | Both module links and guarded landing pages work.                                                             |
| M02 | Remove Risk centrally and approve; apply signed change                 | Incident works; Risk disappears and bookmarked access fails.                                                  |
| M03 | Remove Incident instead                                                | Risk works; Incident denied.                                                                                  |
| M04 | Remove both Individual modules                                         | Foundation remains subject to its own rules; neither business module works.                                   |
| M05 | Restore an entitlement                                                 | Requires current desired/installed activation authority and user permission; stale success cannot restore it. |
| M06 | Core-only, Incident-only, Risk-only, both image profiles               | Excluded code/routes absent; installed-but-denied routes reject access.                                       |
| M07 | Attempt to deselect foundation/Core                                    | UI prevents it and canonical selection remains valid.                                                         |
| M08 | Promote/demote a business module across catalogues                     | Supported release/profile cutover; no customer-level Core override or licensing exemption.                    |
| M09 | Dependency removal/addition                                            | Required closure is reviewed; draft/optional dependency does not silently grant access.                       |
| M10 | Remove only user permission, suspend user, revoke session              | Next protected interaction denies affected user despite valid product/module approval.                        |
| M11 | Locally disable a module                                               | Access narrows; removing local disablement cannot exceed current signed/user authority.                       |
| M12 | Approve wrong package/profile or stale installed inventory             | Activation remains closed with actionable error.                                                              |
| M13 | Suspend/reject Turnstile independently                                 | Business modules deny after applied signed restriction; DMS approval remains independent.                     |
| M14 | Suspend DMS independently                                              | DMS new work blocked; Turnstile module entitlement is not inferred from DMS state.                            |
| M15 | Central outage before grant expiry                                     | Existing valid module authority continues; no additions or fabricated success.                                |
| M16 | Grant expires during outage                                            | All catalogue-managed business module reads/writes denied. Identity/recovery exceptions remain.               |
| M17 | Removal while customer offline                                         | Old valid grant may continue until sync/expiry; record actual latency, not instantaneous-revocation claims.   |
| M18 | Applied denial followed by restart/expiry                              | Denial persists; expired denial never becomes approval.                                                       |
| M19 | Reapprove/reconnect after restriction                                  | Only newer valid current-bound authority reopens permitted access.                                            |

DMS and existing foundation policy differ from module policy: previously activated products
can retain qualifying authorized reads/downloads after expiry/suspension while new work is
blocked. Pending/never-approved/corrupt-proof states gain no such exception. If the intended
commercial requirement is to deny every DMS read too, record a specification change request;
do not silently call the implemented exception a failure or change it during testing.

## Phase 7 — expiry, outages and recovery without false evidence

There is no verified browser control for shortening the signed grant lifetime. The accepted
model has seven-day maximum grants, daily renewal and fifteen-minute reporting. Reporting
cadence is not a guarantee of immediate local policy application.

1. Perform suspension/removal/reapproval through central UI and measure actual applied
   acknowledgement and customer behavior. These prove restriction, not elapsed expiry.
2. For literal expiry, retain a genuine signed approval, prevent renewal only for the
   isolated Titan deployment, and observe before/at/after its actual signed expiry.
   Keep local identity/mail functioning so login failure does not mask module enforcement.
3. A faster separate expiry test needs a reviewed disposable time-controlled environment
   or supported short-lived issuer configuration. Confirm capability first; do not invent
   an existing setting. Preserve real signing, verification, persistence and request handlers.
   Never change host-wide time, edit signed claims/SQL, or describe synthetic-clock evidence
   as an unmodified seven-day deployment run. Until then mark accelerated expiry blocked.
4. Operator-controlled faults may stop a specific dependency, break only customer-to-central
   connectivity or interrupt a download. Record injection separately; observations/actions
   still use normal UI. Do not take down unrelated projects.
5. Exercise lost response after commit with real handler execution, then UI retry/reload.
   Repeat after an intervening restrictive change: receipt replay must not restore access.
6. Test restart and supported coherent restore in an isolated clone: fresh recovery fencing,
   epoch/rebind and reviewed reapproval required; stale snapshots cannot reopen modules.
   Restore operations themselves are private operator tests, not browser-only evidence.

## Phase 8 — additional negative cases and evidence

Prioritize these after the main flow; mark unsupported injection/UI paths explicitly.

- Identity: wrong password/code, expired/reused verification/reset/invite link, incomplete
  verification/MFA, expired recent-MFA window, idle/absolute session expiry, logout/back,
  password reset revoking prior sessions, used recovery code and disabled staff.
- Authorization: Viewer attempting mutation, Operator attempting Admin-only action,
  customer credentials at central, last-admin safeguard, insufficient role delegation,
  revoked permissions with already-open tabs and retained links after logout.
- Registration: duplicate client/code, wrong installation/product binding, missing required
  fields, refresh/back/double-submit, stale revisions and concurrent staff updates.
- Pairing: expired/revoked/consumed/wrong-product file, interrupted download, replacement
  epoch, repeated submit after lost acknowledgement, independent product failure.
- Installation: missing/invalid trust, altered or unavailable bundle, wrong image/profile,
  unavailable Docker/storage/mail, occupied reserved port, interrupted phase/resume,
  expired intent, changed desired assignment, attempts to adopt existing state.
- Processing: document acceptance, malformed/oversized input, scanner failure, interrupted
  upload, queue replay and cross-application isolation remain separate DMS coverage where
  no browser workflow exists. Do not claim module placeholders exercise these paths.
- UX: keyboard navigation, narrow viewport, actionable loading/error/retry states, no
  successful toast on failed mutation, correct status after refresh, and no secret leakage
  into URLs, browser storage, screenshots or shared logs.

Every case records: ID, pinned release/profile, actor, prerequisites, exact UI steps,
expected/actual result, timestamp, central revision/acknowledgement where visible, redacted
screenshot/network evidence, and PASS/FAIL/BLOCKED/NOT RUN. Prior fixture results remain
historical and never substitute for this run. Fixes get focused regression checks plus
required workspace gates, and affected browser journeys are repeated on the fixed build.

## Phase 9 — replace installation documentation after verification

1. Write a new concise START-HERE entry linking separate staff, customer operator and
   customer administrator journeys. Keep credentials/private runtime paths out of Git.
2. Rewrite fresh local setup from the actual successful empty-install procedure, including
   inputs, expected screens/states, private operator boundaries, retry and recovery steps.
3. Update README, docs index, fresh-manual-testing, installation handover and affected
   control-plane/module runbooks. Label local POC versus production/Dokploy requirements.
4. Remove obsolete private generated guidance with the old test directory; consolidate
   tracked runbooks only after replacement links exist. Preserve specifications,
   architecture and frozen evidence; link design instead of duplicating it.
5. Repeat onboarding against another empty disposable installation using only the new
   guidance. Every undocumented prerequisite becomes a documentation defect.
6. Leave Titan in a documented healthy final state: both modules enabled for the intended
   test reader, restricted comparison users retained, independent DMS/Turnstile approvals
   applied, and no outage/clock experiment left active. Record private access handoff safely.

## Completion and current handoff

Planning is complete. No data, Docker resources or old documents were removed; no accounts
were created and no scenario is marked passed. Inspection covered repository status,
remote head, architecture/runbooks, private START-HERE guidance and live Docker metadata.

Execution must first finalize the exact cleanup manifest, then run phases in order.
Unresolved scope boundaries are private setup steps, full headless-DMS acceptance and
accelerated expiry. Browser acceptance and actual Linux/Dokploy/off-host verification
must be reported separately. This planning-only document is not evidence of runtime tests.


## Execution checkpoint — 2026-11-12

Owner: Codex. Source: development `c75b4cb1c764158d386a317020690cf2e155a1c8`;
remote development remained `92f73204e2804e4c9b6c752deab366b9993bcbaf`.

- Removed 19 exactly inventoried old central/customer containers, 8 dedicated volumes,
  11 owned networks and the old private manual-install directory. Preserved source,
  unrelated projects, shared images and unproven anonymous/qualification volumes.
  This is a reset of the selected installation, not a host-wide data purge.
- Built current central, DMS and installer images. Built, started, inspected and signed
  all four module profiles. Published the both-module package reference and assembled
  the independently verified combined installer bundle.
- Provisioned fresh central persistence, roles, migrations, signing authority and first
  staff administrator using documented private commands. Browser email verification,
  password login and real TOTP enrollment succeeded; empty client directory observed.
- Through the browser imported signed source metadata, created and published the
  Foundation-Core/Incident-Individual/Risk-Individual classification, registered Titan,
  reserved LOCAL with independent DMS and Turnstile products, and approved the full
  both-module desired profile after dependency confirmation.
- Through the browser enabled permanent v2 enforcement, downloaded the fresh intent and
  independent pairing files. The artifact-only installer initialized fresh customer
  databases/services and applied each pairing through its owning private operation.
- DMS approval was saved and acknowledged. Turnstile was initially rejected because the
  tester submitted a retained form default; restriction was observed, then explicit
  Approve was selected and saved. Module activation subsequently succeeded with current
  MFA; final signed sync is recorded in the active IN_PROGRESS handoff.
- Provisioned the initial Titan identity privately, followed its real verification mail
  in the browser, configured distinct identity/login/machine clients, and signed in
  normally as admin@titan.test. Private first-admin handover/open is still pending.
- Viewer and Operator staff accounts were admitted through the UI; their verification,
  password setup, MFA and role-boundary scenarios remain pending.

Observed negative cases: expired recent MFA rejected staff admission; refreshing normal
login/TOTP permitted it. Expired recent MFA also rejected activation (HTTP 403); refreshed
MFA permitted activation. Foundation selection was checked and disabled. Pending/rejected
product state did not open the customer workspace. These observations do not establish
the full M01–M19 matrix or literal license expiry.

Runtime preparation corrections: installer packaging needs versioned runtime trust, not
the catalogue-intake trust shape; Turnstile SMTP accepts `mailpit`, requiring that DNS SAN
in the local relay certificate. The relay restart cleared captured mail, so unverified
staff should request new verification links through the UI. Fresh local CA trust was
installed in Windows CurrentUser and Linux user Chromium NSS; no sudo password was used.

Blocker: the existing private handover requires the current normal-login HttpOnly
`__Host-turnstile` cookie. Shared preview tools cannot export it. A secure file input
request timed out without a value. No cookie was fabricated and no authorization rows
were edited. Resume with the real session proof using the private bootstrap-administrator
and open commands in [installation handover](customer_deployment_guide.md#customer), then
continue company onboarding, module reader grants and the remaining scenario matrix.
The proposed public handover flow is not implemented; this execution does not authorize
adding it. Documentation replacement and second clean rehearsal remain pending.

All four workspace gates (`pnpm check`, `pnpm build`, `pnpm test`,
`pnpm test:integration`) passed. The first check identified formatting in this plan;
Biome corrected it before the successful run. Automated fixtures are separate evidence
from the manual browser journey. No production/Dokploy or off-host acceptance is claimed.

Private operational state: `.dms-titan-20261112` holds central configuration, release
inputs, cleanup inventory and first-admin MFA material; `/home/dev/titan-local-20261112`
holds the transferred release, protected inputs and resumable customer state. Keep these
private and do not rerun reset or bootstrap. Local HTTPS entry points are
`https://central.localhost:23600`, `https://turnstile.localhost:23600` and
`https://mail.localhost:23600`; DMS is headless. Captured mail is reached through HTTPS
ingress because the internal-only mail network did not expose the requested host mapping.

## Current execution follow-up — 2026-11-12

The latest user instruction authorizes setup fixes, simplification, a separate customer
Compose/Dockerfile and the manual guide. Earlier planning-only restrictions do not limit
that authorization. See [the observed results](titan_acceptance_results.md) and
[manual deployment sequence](customer_deployment_guide.md). The preceding checkpoint is
historical: administrator handover/opening and browser company onboarding have now
completed; no current cookie-input or sudo blocker remains. Full wider acceptance is
not inferred from those milestones.
