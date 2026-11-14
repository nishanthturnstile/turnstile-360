# Titan customer rehearsal — 2026-11-12

The supported local module-POC onboarding journey and the checks below are complete.
The full acceptance matrix remains open; this report is not production sign-off. The [manual deployment guide](customer_deployment_guide.md) contains the ordered
procedure; the [original matrix](titan_fresh_install_validation_plan.md) preserves the full
scope. Source baseline was `development` c75b4cb; this rehearsal also tests the uncommitted
fixes listed below. No commit, push or merge was performed.

## Environment and data custody

The explicitly selected old local installation was removed: 19 containers, 8 owned volumes,
11 networks and its private procedure/state directory. Unrelated projects, shared images
and unproven qualification volumes were preserved. The original root LICENSE and third-party
notices remain intact. The fresh control plane has its own database and Compose project;
Titan lives outside the checkout in `/home/dev/titan-local-20261112` with a separate database,
fixed tenant and independently paired DMS/Turnstile products.

Titan's reviewed Compose entry point is
`/home/dev/titan-local-20261112/compose-reviewed/customer.yaml`, using its protected
`project.env`. It runs the six exported runtime services and a separate nonroot gateway.
The external database volume and networks were retained across both Compose transfers.
The gateway receives no Docker socket or customer credentials and publishes no host port.
TLS remains at the local operator ingress. No sudo password or TLS-verification bypass was
needed; user-level browser trust was installed for this disposable local CA.

Canonical local browser origins are `https://central.localhost:23600`,
`https://turnstile.localhost:23600` and `https://mail.localhost:23600`.
Secrets and diagnostic artifacts stay in ignored/private files, not this report.

## Browser observations

| Case                                   | Actual result                                                                                                                                                                                                                                                                                                                                                                       |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Empty central, first administrator     | Email verification, normal login and TOTP enrollment succeeded. No MFA bypass.                                                                                                                                                                                                                                                                                                      |
| Titan registration                     | Client, reserved installation and independent DMS/Turnstile products created through the UI.                                                                                                                                                                                                                                                                                        |
| Catalogue and module choice            | Signed catalogue imported/classified/published. Foundation is required Core; Incident/Risk Individual. Foundation checkbox is disabled. Dependency closure was explicitly reviewed.                                                                                                                                                                                                 |
| Pairing and approval                   | Real UI-downloaded pairing files used. Both independent approvals and signed acknowledgements observed. Pairing itself did not authorize modules.                                                                                                                                                                                                                                   |
| Initial customer identity              | Real email verification and normal customer login succeeded. Private operator established distinct clients/enrollment.                                                                                                                                                                                                                                                              |
| Administrator rights                   | Protected administrator bootstrap succeeded with actual normal-login proof. No module appeared merely because the user was an administrator.                                                                                                                                                                                                                                        |
| Company setup                          | Titan, Asia/Kolkata, first site Titan Headquarters, review and Finish setup completed through the UI. Workspace readiness survived service recreation.                                                                                                                                                                                                                              |
| Explicit permissions                   | Incident-only reader grant showed Incident and denied bookmarked Risk. Granting Risk then showed both links. Both guarded pages returned successful entry responses and displayed their module titles.                                                                                                                                                                              |
| Central Risk removal (M02)             | Draft alone did not remove authority. Approved removal followed by signed sync hid Risk and denied its bookmarked page; Incident remained.                                                                                                                                                                                                                                          |
| Remove both (M04)                      | Foundation/workspace remained; both Individual links disappeared and bookmarked Incident was denied.                                                                                                                                                                                                                                                                                |
| Restore desired selection (M05)        | Desired restoration alone kept modules denied. Separate reviewed activation and signed sync restored both, with existing user grants retained.                                                                                                                                                                                                                                      |
| Recent MFA expiry                      | Sensitive activation returned 403 when recent MFA expired. Normal login/TOTP restored the ability to confirm.                                                                                                                                                                                                                                                                       |
| Natural signed expiry (M16)            | Central issued a real 120-second decision through its production signing/sync handler. Both modules worked before expiry. With central stopped, the grant expired naturally; current customer login and allowed foundation reads remained, restricted banner appeared, both module links disappeared and bookmarked Risk was denied. No host-clock change or authentication bypass. |
| Renewal after outage (M19)             | Central restored with default 604800-second lifetime. New signed sync restored both module links.                                                                                                                                                                                                                                                                                   |
| DMS connection                         | Browser Check connection reported Connected when DMS approved.                                                                                                                                                                                                                                                                                                                      |
| Independent DMS suspension (M14)       | Browser reported DMS restricted while both Turnstile module links remained. DMS reapproval and owning signed sync completed. This is capability/status evidence, not a document write test.                                                                                                                                                                                         |
| Independent Turnstile suspension (M13) | Both module links disappeared and bookmarked Incident was denied after signed sync. Reapproval and signed sync restored both.                                                                                                                                                                                                                                                       |

Customer UI work used shared-browser navigation, forms and buttons. Infrastructure build,
provisioning/migrations, signing, pairing application, client setup, initial private grants,
release handover and explicit fault/sync operations used their private operator workflows.
They are not labelled browser business acceptance. Read-only diagnostics explain failures;
they do not replace the recorded UI outcomes.

Additional observation: locally setting `TURNSTILE_DISABLED_MODULES` to
`["incident-management"]` and recreating the API left Risk's guarded page working, hid
Incident and denied its bookmarked page (M11, Risk-only visibility). The setting was then
removed. Signed Turnstile suspension also remained denied after an API restart (M18).
This does not substitute for a Risk-only central assignment/package cutover (M03/M06).

Additional browser journeys through the new customer gateway:

- **Invited non-administrator:** UI approval queued an Incident-only invitation to
  `reader@titan.test`. The actual Mailpit link led to account creation, email verification,
  normal login and explicit acceptance. Incident opened; Risk was absent and its direct
  URL denied. People/Settings controls were not shown to this reader.
- **Membership suspension:** reviewed suspension immediately blocked the reader's existing
  session and also denied workspace entry after sign-out/normal sign-in. Reviewed
  reactivation restored the retained Incident-only membership. Identity-wide session
  revocation is a separate, untested case.
- **Central outage before expiry (M15):** central was stopped while the normal grant was
  unexpired. The administrator's Risk entry returned 200, and the reader completed
  invitation acceptance using local authority. Central was then restarted.

The final runtime has seven customer services running, both products approved, both
Individual modules active, no local module-disable override and the normal seven-day
central issuance setting. Temporary ingress proof capture code and its mount were removed;
transient proof-bearing operator inputs and consumed pairing files were deleted. Persistent
volumes, private operational credentials, trust and installer receipts are retained.

## Problems found and fixes

1. **Stale handover proof blocked the installer.** Bootstrap changed the access context,
   regenerating the browser cookie. The next release-open used the old proof and failed;
   the installer correctly stopped but lacked an explicit recovery adapter. Added narrow
   `retry-open`, preserving original operation key/revision/non-proof input and using the
   owning release receipt with fresh normal proof. The actual retained failed Titan job
   completed on attempt two; no live SQL/session/journal fabrication was used. Existing
   signed bundle files were not modified. The recovery engine was run from reviewed source;
   new bundles include the updated launcher. Old-engine upgrade distribution is separate.
2. **Private handover still needs inconvenient proof custody.** Shared preview tools cannot
   expose HttpOnly cookies. A temporary, armed, one-shot local ingress capture supplied
   only the genuine normal-session proof to mode-0600 files. It was removed after use.
   The planned scoped browser-to-operator exchange remains the proper product improvement.
3. **Expiry was impractical at seven days.** Added bounded shorter central decision lifetime
   with the seven-day default/maximum preserved. Existing longer cached decisions are not
   reused after lowering the setting; actual signed 120-second issuance/expiry was observed.
   Normal seven-day issuance was restored after the test.
4. **Removal wording contradicted active authority.** The review said no active authority
   had been reported while listing active removals. Updated it to explain signed sync and
   the offline expiry bound. Normal reporter scheduling is roughly 15 minutes; restarting
   a reporter does not bypass its durable next-attempt election. Explicit owning sync was
   used to apply reviewed changes promptly.
5. **Customer deployment lacked one reproducible entry point.** Added exact-service Compose
   export plus dedicated gateway Dockerfile/Compose. Fixed YAML quoting and Nginx temporary
   paths during actual container startup. Retained the database across recreation and
   verified customer navigation through the gateway.
6. **Ingress network attachment was not durable.** Recreating the local ingress while
   removing its temporary proof mount dropped a previously manual customer-edge attachment,
   causing a login 502. Added the external network and canonical aliases to its owning
   Compose definition and recreated ingress. The controlled relay attachment is also now
   declared. The guide requires declarative attachments across recreation.
7. **Operator selection and local trust mistakes were visible.** An earlier form default
   caused an accidental Turnstile Reject; it was corrected through explicit Approve.
   Mailpit required its DNS name in the local certificate. The manual guide now calls out
   explicit decision selection, exact origins, private inputs and current proof per command.

## Verification and remaining acceptance

Targeted installer recovery and central configuration tests pass. The actual production
central image and customer gateway were built and deployed locally. The regression suite
has been extended to check a real release-open receipt after an intervening close using a
fresh normal login. Final `pnpm check`, `pnpm build`, `pnpm test` and
`pnpm test:integration` all passed on 2026-11-12, including real PostgreSQL release
receipt replay after an intervening close and authenticated SeaweedFS transfer checks.
Logs are `/tmp/titan-final-{check,build,test,test-integration}.log`. The initial new Compose
formatting failure was corrected before the successful check. These automated suites are
separate from the manual shared-browser acceptance observations.

The full M01–M19 matrix is **not** marked complete. Remaining local scope includes the
Risk-only entitlement variant, all four profiles deployed as separate customer journeys,
Core promotion/demotion across catalogues, stale/wrong inventory activation attempts,
full staff Viewer/Operator, recipient edge-case and identity-session-revocation matrix, and coherent
restore/recovery. All four selected profiles were built/inspected/signed earlier; that does
not establish each customer UI journey. There is no full Turnstile document UI, and this
six-service profile does not install DMS processing/storage. Full documents/OCR, a second
clean-host rehearsal, independent Dokploy/TLS and production handover remain separate gates.
The [implementation plan](installation_implementation_plan.md#titan-rehearsal-follow-up--2026-11-12)
records the resulting work and optimizations rather than treating those gaps as passing tests.


## Foundation review — 2026-11-12 (baseline before scoped fixes)

Independent source review and fresh focused tests support the local module control
foundation. This is not full customer/production acceptance. The reviewer independently
passed 23 catalogue/retry tests; the main verification passed 40 catalogue, deployment
policy and installer tests. Fresh real-image/browser runs passed Core-only, Incident-only and Risk-only. The combined
profile first failed with `403 DEPLOYMENT_RESTRICTED` from `/api/modules`, then passed an
isolated recheck against the same images. Added phase-specific diagnostics; the initial
intermittent failure remains unexplained and blocks a clean all-profile sign-off. These
fixtures use ordinary browser login and real guards, with fixture-seeded authority; they
do not replace central-to-customer assignment/cutover acceptance. Logs are retained in
`/tmp/thaarei-foundation-verification/` (profiles.log and both-recheck.log).

Confirmed issue: the installer omitted PostgreSQL's restart policy and customer Compose
preserved `restart: no`. APIs could restart without their database after a host/Docker
restart. Corrected the owning installer default and added a real-launcher fixture assertion.
Titan's retained Compose and live Docker policy now use `unless-stopped`; container ID
and start time were unchanged. No host reboot or fresh-launcher run was performed for
this fix; the new launcher assertion remains to be executed in that qualification.

At the review baseline, commercial licence expiry was unimplemented: approved online customers renew signed
grants without a contractual end date. The previous 120-second expiry test proves offline
lease expiry only. A licence end-date feature needs central entitlement dates, issuance
bounded by that date, customer enforcement and online/offline boundary tests before this
requirement can pass.

Core/Individual classification is versioned catalogue metadata. Foundation must remain
Core; other supported modules can change classification only via a new verified catalogue
and deliberate release cutover. Core means required in that catalogue, not exemption from
signed authority, membership or user permissions. Individual selections require explicit
dependency closure. Assigning desired modules does not install or activate them.

At the review baseline, adding a third module required coordinated code changes: owned backend/web
feature entries, `scripts/module-source-map.mjs`, shared business-module IDs/capability
limits, permissions, local-disable validation, selected-build registration and tests.
Publish its signed code catalogue, review classification/dependencies, approve the customer
assignment, deliver/install the matching profile, explicitly activate and sync, then grant
user permissions. Central staff cannot create executable module code in the catalogue UI.

Before implementing real business workflows, establish each module's mutation and
background-job authorization contract. Existing Incident/Risk tests prove guarded landing
pages. They do not prove CRUD, long-running jobs or document operations. Check authority
at actual execution/commit, test revocation and expiry during work, tenant/application
isolation, stale retries and coherent recovery; a hidden menu is insufficient.

The outstanding Titan M01–M19 journeys listed above remain open until executed through
that customer workflow. Automated isolated profile/transition evidence is recorded
separately and must not silently replace customer acceptance. Prioritize literal licence
expiry, third-module extensibility, repeatable private administrator handoff, activation-aware
full-DMS packaging, coherent restore and clean-host/Dokploy acceptance before production.

Final workspace verification after the restart fix: `pnpm check`, `pnpm build`,
`pnpm test` and `pnpm test:integration` passed, including PostgreSQL and SeaweedFS.
This does not erase the initial combined-profile failure or execute the newly added
fresh-installer restart assertion. Changes from this review remain local and uncommitted.


## Scoped foundation fixes — 2026-11-12

The three requested implementation changes supersede the baseline findings above:

- Contractual expiry is now a reviewed UTC date per product. Approval/renewal requires a
  future date; central clips approved signed grants to that end and refuses renewal after
  it. Customer verification closes business access at the end, including retained reads,
  and rejects removal of an established licence bound. Newer reviewed renewal can restore
  otherwise permitted access. Existing offline tokens retain their previously signed bound.
- New installer-owned PostgreSQL containers use `unless-stopped`. Titan's retained Compose
  and live policy were already corrected without restarting its database. Qualification
  now exercises an actual disposable database crash and checks committed data after recovery.
- A shared module registry drives IDs, permissions, contracts, labels, build selection and
  validation limits. `pnpm modules:sync` generates the owning permission migration and API
  references. Retirement uses `enabled: false`, preserving historical permission identities
  and customer records. Customer assignment/restriction still uses reviewed signed authority,
  explicit user permissions and the matching package/activation workflow.

Final qualification passed after recovering Docker and reclaiming workstation storage.
The actual signed installer passed PostgreSQL automatic restart with committed data retained,
then complete central/customer HTTPS/browser handover. Central HTTP tests passed licence
shortening, bounded issuance, offline closure, online renewal refusal and staff renewal.
The disposable Permit fixture passed migration/API generation, selected-image ordinary login,
permissions, SQL scope, local disablement and signed revocation/expiry. Configuration-only
retirement passed type checks, image/route exclusion and retained permission validation;
zero-active-module contracts and API generation also passed. Required workspace check,
build, test and integration gates passed earlier on this implementation.

The first fresh handover retry encountered Titan ingress on reserved port 23600; the passing
run temporarily isolated that port and restored Titan ingress afterward. Evidence is retained
privately outside Git under `/home/dev/.local/state/thaarei-qualification/` in
`restart-final.log`, `restart-20261112/qualification.log`, and `modules-20261112.log`.

These are disposable qualification results. Titan's application images and signed bundle
remain on the previous release. Roll out upgraded customer verifiers before the central
issuer, run owning migrations, and enter real contractual dates; do not rewrite a signed
bundle in place. No real contract date was invented, existing volume deleted or host reboot
performed. Broader customer/production acceptance and the earlier intermittent profile
failure remain separately recorded above.
