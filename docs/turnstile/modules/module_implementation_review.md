# MOD-I01–08 accumulated implementation review

Date: 2026-11-11. Reviewer and fix owner: Codex review sub-agent. Confidential and proprietary.

This is the historical MOD-I01–08 review. Statements below about unimplemented MOD-I09
status/handover describe that review boundary; subsequent work is recorded in the
[installation qualification](module_installation_qualification.md) and
[progress](../../../IN_PROGRESS.md).

## Scope and coverage

Reviewed all original working-tree changes against HEAD `c3e5fa5e5aaf0600da25fac02051835858aecbd9` on `development`: **206 paths**, comprising **73 tracked modifications and 133 new files**. OCR delegation preview/rules ran successfully with concise business context and no external model/source upload. Its 167 reviewable paths and 39 excluded paths were all included. **Reviewed 206; skipped 0; coverage 100%.** This report is one additional review artifact, outside the original inventory.

The review spans catalogue/resolver, central catalogue and assignment, authority/decision/transition services, selected builds and bundles, combined preparation, customer permissions/entries, private cutover, SQL ownership, configuration, tests, contracts and docs. Production source and new fixtures were read in bounded areas; tracked patches used Git with external diff/text conversion disabled. Untracked code was read directly. Generated database snapshots were parsed in full, all journal indices/tags/files and previous-ID chains verified, and incremental table/column/index/FK/constraint changes compared with owning SQL/schema. Generated API documents were parsed, local references resolved, changed semantics checked against generators/contracts, and regeneration parity checked by `pnpm check`. Lockfile changes were confined to the declared workspace dependency/importer additions.

## Confirmed finding and fix

**MOD-IMPL-REV01 — High, security — fixed.** `scripts/module-cutover.mjs` reconstructed the installed release trust from the delivery verification trust during the archive-to-prepared phase. It marked every key active and reused the installation's existing trust revision. If the source remained trusted but the target signer was absent, revoked, or retired before target issuance in installed trust while still present in delivery trust, cutover could stage the target and silently undo installed key policy without an independent trust revision/change.

The helper now verifies the exact target descriptor against independently provisioned installed release trust before any closure, stop, quarantine or migration, using the production `verifyInstalledModuleRelease` verifier. It preserves the installed trust file instead of synthesizing a replacement. Reviewed key provisioning remains an independent operator action. The real cutover/browser fixture signs otherwise identical target evidence with an additional signer and tests absent, revoked and late-retired installed-key states. It requires the specific trust rejection, byte-preserved trust, no committed cutover journal, open prior release and running old processes. No handler is replaced or mocked.

Source fix: [module-cutover.mjs](../../../scripts/module-cutover.mjs). Regression: [test-module-cutover-browser.mjs](../../../scripts/test-module-cutover-browser.mjs). Architecture and transition runbook now state the independent-trust preservation boundary.

Several older operational references still described implemented v2 observation/restriction/activation as unavailable. Assignment, decision, access, catalogue, intent and contract references now describe current behavior and link the owning transition workflow. Historical plan/review records remain attributed to their original increments. The central acknowledged/effective status fields are still intentionally unintegrated; the docs distinguish them from the current inventory claim and central authority projection.

No additional confirmed critical/high/medium implementation defect remains from this review. This is a review result, not a guarantee that no undiscovered defect exists.

## Verification

- `pnpm check`: passed after the helper/regression changes; includes Biome, dependency boundaries, generated contract parity, TypeScript, Ruff/mypy, deployment checks and offline auth generation. The final precise-rejection regression assertions also pass check.
- `pnpm build`: passed (valid Turbo cache reused).
- `pnpm test`: passed (valid Turbo cache reused where applicable; root script tests also ran).
- `pnpm test:integration`: passed, including real central HTTPS/PostgreSQL/browser module checks, owned database migration/bootstrap/isolation and authenticated SeaweedFS browser/Node/Python storage verification. Six existing conditional database cases were skipped: two native OCR and one native assessment case, plus two standalone-profile cases and one standalone-image case. No module test was skipped.
- `pnpm test:module:cutover /tmp/mod-i08-cutover-final-20261111 --resume`: passed on the final exact helper/regression version. Its log confirms all three specific installed-trust rejections before closure, followed by actual selected API/web/reporter ordinary-login add/remove/Core-classification cutovers, interruption/resume, role-change review, retained identity/setup/grants/floors, customer archive restore and central restore fencing. The earlier run also passed; runs were sequential and each used its own run directory. No further qualifier rerun is needed.
- 387 relative file links in changed Markdown resolve. Git whitespace checks and original-vs-current path reconciliation pass: all 206 original paths remain, with only this report added.

Final logs are `/tmp/module-review-check.log`, `/tmp/module-review-build.log`, `/tmp/module-review-test.log`, `/tmp/module-review-integration.log` and `/tmp/module-review-cutover-final.log`. The qualifier's detailed private log remains in its protected fixture directory; it contains no report material to publish.

The cutover fix and its fixture live in owner tools/test orchestration, outside the selected-image build-input inventory. Existing exact signed API/web artifacts can therefore be independently reverified/reused; no claim is made that a changed built runtime was tested using old images. The qualifier also rebuilds/verifies central and independent DMS images as configured.

## Remaining planned work and evidence limits

MOD-I09 still owns the distributed combined customer launcher, complete central staff handover/status integration, and artifact-only second-operator journey. MOD-I10/owning installer gates retain broader acceptance, separate Linux/Dokploy qualification, off-host production recovery, private production distribution and rollout approval. These were not implemented as review fixes. Placeholder business domains, mobile app and future jobs remain outside MOD-I01–08.

The standalone central module fixtures use explicitly synthetic signed inventory/seeded authority where stated. Actual selected-image cutover/browser qualification is separate. Its additional legacy v1 compatibility fixture uses source; complete legacy candidate-image/reporter coverage remains with the wider TCP qualifier. The broader suite omitted its two native OCR, one native assessment, two standalone-profile and one standalone-image conditional cases. No module regression was skipped. Required module container/runtime checks were available; separate native and full legacy-image target gates were not rerun by this review.

No live/customer deployment, migration, account, signing trust, secret or preexisting volume was changed. Only disposable qualification resources were created/cleaned. No commit, push or merge occurred. Private fixture signing keys, credentials and raw sensitive logs are not included here.

## Path ledger

Each row identifies the original `(path, status)` entry. `S` means structural generated-snapshot review; `G` means generated API contract/diff/parity review; `D` means changed/new documentation compared with implementation and scoped requirements; `R` means complete tracked patch or full new source/config/fixture review with relevant callers/guards. No path was silently dropped because OCR excluded it.

| Path                                                                                                 | Original status | Review   | Method |
| ---------------------------------------------------------------------------------------------------- | --------------- | -------- | ------ |
| `.dockerignore`                                                                                      | modified        | reviewed | R      |
| `.gitignore`                                                                                         | modified        | reviewed | R      |
| `IN_PROGRESS.md`                                                                                     | modified        | reviewed | D      |
| `README.md`                                                                                          | modified        | reviewed | D      |
| `apps/dms-api/Dockerfile`                                                                            | modified        | reviewed | R      |
| `apps/dms-api/src/infrastructure/database/migrate.ts`                                                | modified        | reviewed | R      |
| `apps/dms-api/src/infrastructure/distribution/initialize.ts`                                         | modified        | reviewed | R      |
| `apps/dms-api/test/bff-authority-fixture.mjs`                                                        | modified        | reviewed | R      |
| `apps/thaarei-control-plane/.env.example`                                                            | modified        | reviewed | R      |
| `apps/thaarei-control-plane/Dockerfile`                                                              | modified        | reviewed | R      |
| `apps/thaarei-control-plane/database/0010_module_catalogues.sql`                                     | added           | reviewed | R      |
| `apps/thaarei-control-plane/database/0011_module_privileges.sql`                                     | added           | reviewed | R      |
| `apps/thaarei-control-plane/database/0012_module_assignments.sql`                                    | added           | reviewed | R      |
| `apps/thaarei-control-plane/database/0013_module_assignment_privileges.sql`                          | added           | reviewed | R      |
| `apps/thaarei-control-plane/database/0014_module_authority.sql`                                      | added           | reviewed | R      |
| `apps/thaarei-control-plane/database/0015_module_authority_privileges.sql`                           | added           | reviewed | R      |
| `apps/thaarei-control-plane/database/0016_module_observation.sql`                                    | added           | reviewed | R      |
| `apps/thaarei-control-plane/database/0017_module_transition_privileges.sql`                          | added           | reviewed | R      |
| `apps/thaarei-control-plane/database/meta/0010_snapshot.json`                                        | added           | reviewed | S      |
| `apps/thaarei-control-plane/database/meta/0011_snapshot.json`                                        | added           | reviewed | S      |
| `apps/thaarei-control-plane/database/meta/0012_snapshot.json`                                        | added           | reviewed | S      |
| `apps/thaarei-control-plane/database/meta/0013_snapshot.json`                                        | added           | reviewed | S      |
| `apps/thaarei-control-plane/database/meta/0014_snapshot.json`                                        | added           | reviewed | S      |
| `apps/thaarei-control-plane/database/meta/0015_snapshot.json`                                        | added           | reviewed | S      |
| `apps/thaarei-control-plane/database/meta/0016_snapshot.json`                                        | added           | reviewed | S      |
| `apps/thaarei-control-plane/database/meta/0017_snapshot.json`                                        | added           | reviewed | S      |
| `apps/thaarei-control-plane/database/meta/_journal.json`                                             | modified        | reviewed | S      |
| `apps/thaarei-control-plane/drizzle.config.ts`                                                       | modified        | reviewed | R      |
| `apps/thaarei-control-plane/package.json`                                                            | modified        | reviewed | R      |
| `apps/thaarei-control-plane/src/app/api/installation-intents/status/route.ts`                        | added           | reviewed | R      |
| `apps/thaarei-control-plane/src/app/api/module-catalogues/[id]/route.ts`                             | added           | reviewed | R      |
| `apps/thaarei-control-plane/src/app/api/module-catalogues/assignable/route.ts`                       | added           | reviewed | R      |
| `apps/thaarei-control-plane/src/app/api/module-catalogues/code/[id]/route.ts`                        | added           | reviewed | R      |
| `apps/thaarei-control-plane/src/app/api/module-catalogues/route.ts`                                  | added           | reviewed | R      |
| `apps/thaarei-control-plane/src/app/api/registry/products/[id]/modules/activate/route.ts`            | added           | reviewed | R      |
| `apps/thaarei-control-plane/src/app/api/registry/products/[id]/modules/build-request/route.ts`       | added           | reviewed | R      |
| `apps/thaarei-control-plane/src/app/api/registry/products/[id]/modules/enforce/route.ts`             | added           | reviewed | R      |
| `apps/thaarei-control-plane/src/app/api/registry/products/[id]/modules/installation-intent/route.ts` | added           | reviewed | R      |
| `apps/thaarei-control-plane/src/app/api/registry/products/[id]/modules/route.ts`                     | added           | reviewed | R      |
| `apps/thaarei-control-plane/src/app/clients/ClientWorkspace.tsx`                                     | modified        | reviewed | R      |
| `apps/thaarei-control-plane/src/app/clients/ModuleAssignment.tsx`                                    | added           | reviewed | R      |
| `apps/thaarei-control-plane/src/app/clients/ModuleDependencyGraph.tsx`                               | added           | reviewed | R      |
| `apps/thaarei-control-plane/src/app/clients/[id]/products/[productId]/modules/page.tsx`              | added           | reviewed | R      |
| `apps/thaarei-control-plane/src/app/globals.css`                                                     | modified        | reviewed | R      |
| `apps/thaarei-control-plane/src/app/health/ready/route.ts`                                           | modified        | reviewed | R      |
| `apps/thaarei-control-plane/src/app/modules/CatalogueEditor.tsx`                                     | added           | reviewed | R      |
| `apps/thaarei-control-plane/src/app/modules/[id]/page.tsx`                                           | added           | reviewed | R      |
| `apps/thaarei-control-plane/src/app/modules/page.tsx`                                                | added           | reviewed | R      |
| `apps/thaarei-control-plane/src/app/page.tsx`                                                        | modified        | reviewed | R      |
| `apps/thaarei-control-plane/src/contracts/module-assignments.ts`                                     | added           | reviewed | R      |
| `apps/thaarei-control-plane/src/contracts/module-catalogues.ts`                                      | added           | reviewed | R      |
| `apps/thaarei-control-plane/src/contracts/module-transitions.ts`                                     | added           | reviewed | R      |
| `apps/thaarei-control-plane/src/contracts/registry.ts`                                               | modified        | reviewed | R      |
| `apps/thaarei-control-plane/src/server/auth.cli.ts`                                                  | modified        | reviewed | R      |
| `apps/thaarei-control-plane/src/server/config.ts`                                                    | modified        | reviewed | R      |
| `apps/thaarei-control-plane/src/server/installation-intent-service.ts`                               | added           | reviewed | R      |
| `apps/thaarei-control-plane/src/server/machine-service.ts`                                           | modified        | reviewed | R      |
| `apps/thaarei-control-plane/src/server/machine-signing.ts`                                           | modified        | reviewed | R      |
| `apps/thaarei-control-plane/src/server/machine.schema.ts`                                            | modified        | reviewed | R      |
| `apps/thaarei-control-plane/src/server/module-assignment-service.ts`                                 | added           | reviewed | R      |
| `apps/thaarei-control-plane/src/server/module-assignment.schema.ts`                                  | added           | reviewed | R      |
| `apps/thaarei-control-plane/src/server/module-decision-policy.ts`                                    | added           | reviewed | R      |
| `apps/thaarei-control-plane/src/server/module-delivery-service.ts`                                   | added           | reviewed | R      |
| `apps/thaarei-control-plane/src/server/module-enforcement-service.ts`                                | added           | reviewed | R      |
| `apps/thaarei-control-plane/src/server/module-evidence.ts`                                           | added           | reviewed | R      |
| `apps/thaarei-control-plane/src/server/module-service.ts`                                            | added           | reviewed | R      |
| `apps/thaarei-control-plane/src/server/module-transition-service.ts`                                 | added           | reviewed | R      |
| `apps/thaarei-control-plane/src/server/module.schema.ts`                                             | added           | reviewed | R      |
| `apps/thaarei-control-plane/src/server/registry-service.ts`                                          | modified        | reviewed | R      |
| `apps/thaarei-control-plane/test/module-assignment-status.test.ts`                                   | added           | reviewed | R      |
| `apps/thaarei-control-plane/test/module-decision-policy.test.ts`                                     | added           | reviewed | R      |
| `apps/turnstile-api/.env.example`                                                                    | modified        | reviewed | R      |
| `apps/turnstile-api/Dockerfile`                                                                      | modified        | reviewed | R      |
| `apps/turnstile-api/database/migrations/0030_module_permissions.sql`                                 | added           | reviewed | R      |
| `apps/turnstile-api/database/migrations/0031_module_scope_guards.sql`                                | added           | reviewed | R      |
| `apps/turnstile-api/database/migrations/0032_module_grant_receipts.sql`                              | added           | reviewed | R      |
| `apps/turnstile-api/database/migrations/meta/0030_snapshot.json`                                     | added           | reviewed | S      |
| `apps/turnstile-api/database/migrations/meta/0031_snapshot.json`                                     | added           | reviewed | S      |
| `apps/turnstile-api/database/migrations/meta/0032_snapshot.json`                                     | added           | reviewed | S      |
| `apps/turnstile-api/database/migrations/meta/_journal.json`                                          | modified        | reviewed | S      |
| `apps/turnstile-api/package.json`                                                                    | modified        | reviewed | R      |
| `apps/turnstile-api/src/app.module.ts`                                                               | modified        | reviewed | R      |
| `apps/turnstile-api/src/bootstrap.ts`                                                                | modified        | reviewed | R      |
| `apps/turnstile-api/src/features/incident-management/entry.ts`                                       | added           | reviewed | R      |
| `apps/turnstile-api/src/features/incident-management/incident-management.controller.ts`              | added           | reviewed | R      |
| `apps/turnstile-api/src/features/incident-management/incident-management.module.ts`                  | added           | reviewed | R      |
| `apps/turnstile-api/src/features/incident-management/incident-management.service.ts`                 | added           | reviewed | R      |
| `apps/turnstile-api/src/features/risk-management/entry.ts`                                           | added           | reviewed | R      |
| `apps/turnstile-api/src/features/risk-management/risk-management.controller.ts`                      | added           | reviewed | R      |
| `apps/turnstile-api/src/features/risk-management/risk-management.module.ts`                          | added           | reviewed | R      |
| `apps/turnstile-api/src/features/risk-management/risk-management.service.ts`                         | added           | reviewed | R      |
| `apps/turnstile-api/src/infrastructure/distribution/initialize.ts`                                   | added           | reviewed | R      |
| `apps/turnstile-api/src/infrastructure/module-http.ts`                                               | added           | reviewed | R      |
| `apps/turnstile-api/src/module-composition.ts`                                                       | added           | reviewed | R      |
| `apps/turnstile-api/src/module-release-profile.ts`                                                   | added           | reviewed | R      |
| `apps/turnstile-api/src/modules/access/access-evaluator.ts`                                          | modified        | reviewed | R      |
| `apps/turnstile-api/src/modules/access/access.schema.ts`                                             | modified        | reviewed | R      |
| `apps/turnstile-api/src/modules/auth/browser-auth/browser-auth.spec.ts`                              | modified        | reviewed | R      |
| `apps/turnstile-api/src/modules/deployment/access.ts`                                                | modified        | reviewed | R      |
| `apps/turnstile-api/src/modules/deployment/module-release.ts`                                        | added           | reviewed | R      |
| `apps/turnstile-api/src/modules/deployment/operator.ts`                                              | modified        | reviewed | R      |
| `apps/turnstile-api/src/modules/deployment/store.ts`                                                 | modified        | reviewed | R      |
| `apps/turnstile-api/src/modules/module-access/module-access-operator.ts`                             | added           | reviewed | R      |
| `apps/turnstile-api/src/modules/module-access/module-access.controller.ts`                           | added           | reviewed | R      |
| `apps/turnstile-api/src/modules/module-access/module-access.module.ts`                               | added           | reviewed | R      |
| `apps/turnstile-api/src/modules/module-access/module-access.service.ts`                              | added           | reviewed | R      |
| `apps/turnstile-api/src/modules/module-access/module-access.spec.ts`                                 | added           | reviewed | R      |
| `apps/turnstile-api/src/modules/people/administration.service.ts`                                    | modified        | reviewed | R      |
| `apps/turnstile-api/test/access-fixture.ts`                                                          | modified        | reviewed | R      |
| `apps/turnstile-api/test/people.database-spec.ts`                                                    | modified        | reviewed | R      |
| `apps/turnstile-api/test/recipients.database-spec.ts`                                                | modified        | reviewed | R      |
| `apps/turnstile-web/Dockerfile`                                                                      | modified        | reviewed | R      |
| `apps/turnstile-web/src/App.tsx`                                                                     | modified        | reviewed | R      |
| `apps/turnstile-web/src/components/module-entry.tsx`                                                 | added           | reviewed | R      |
| `apps/turnstile-web/src/components/workspace-navigation.tsx`                                         | modified        | reviewed | R      |
| `apps/turnstile-web/src/features/auth/product.ts`                                                    | modified        | reviewed | R      |
| `apps/turnstile-web/src/features/incident-management/entry.tsx`                                      | added           | reviewed | R      |
| `apps/turnstile-web/src/features/people/labels.ts`                                                   | modified        | reviewed | R      |
| `apps/turnstile-web/src/features/risk-management/entry.tsx`                                          | added           | reviewed | R      |
| `apps/turnstile-web/src/module-composition.ts`                                                       | added           | reviewed | R      |
| `apps/turnstile-web/test/product-session.test.ts`                                                    | modified        | reviewed | R      |
| `apps/turnstile-web/vite.config.ts`                                                                  | modified        | reviewed | R      |
| `architecture.md`                                                                                    | modified        | reviewed | D      |
| `deploy/compose.control-plane-module-deliveries.yaml`                                                | added           | reviewed | R      |
| `deploy/compose.control-plane-modules.yaml`                                                          | added           | reviewed | R      |
| `docs/README.md`                                                                                     | modified        | reviewed | D      |
| `docs/api/identity-invitations.openapi.json`                                                         | modified        | reviewed | G      |
| `docs/api/module-transitions.openapi.json`                                                           | added           | reviewed | G      |
| `docs/api/turnstile-auth.openapi.yaml`                                                               | modified        | reviewed | G      |
| `docs/api/turnstile-modules.openapi.json`                                                            | added           | reviewed | G      |
| `docs/api/turnstile-people.openapi.json`                                                             | modified        | reviewed | G      |
| `docs/deployment/installation_implementation_plan.md`                                                | modified        | reviewed | D      |
| `docs/deployment/installation_specification.md`                                                      | modified        | reviewed | D      |
| `docs/runbooks/installation-intents.md`                                                              | added           | reviewed | D      |
| `docs/runbooks/module-access.md`                                                                     | added           | reviewed | D      |
| `docs/runbooks/module-assignments.md`                                                                | added           | reviewed | D      |
| `docs/runbooks/module-catalogues.md`                                                                 | added           | reviewed | D      |
| `docs/runbooks/module-decisions.md`                                                                  | added           | reviewed | D      |
| `docs/runbooks/module-delivery.md`                                                                   | added           | reviewed | D      |
| `docs/runbooks/module-transitions.md`                                                                | added           | reviewed | D      |
| `docs/thaarei/control-plane-specification.md`                                                        | modified        | reviewed | D      |
| `docs/turnstile/modules/module_contracts.md`                                                         | added           | reviewed | D      |
| `docs/turnstile/modules/module_delivery_implementation_plan.md`                                      | added           | reviewed | D      |
| `docs/turnstile/modules/module_delivery_review.md`                                                   | added           | reviewed | D      |
| `docs/turnstile/modules/module_delivery_specification.md`                                            | added           | reviewed | D      |
| `package.json`                                                                                       | modified        | reviewed | R      |
| `packages/deployment-control/package.json`                                                           | modified        | reviewed | R      |
| `packages/deployment-control/src/client.ts`                                                          | modified        | reviewed | R      |
| `packages/deployment-control/src/cutover-contracts.ts`                                               | added           | reviewed | R      |
| `packages/deployment-control/src/index.ts`                                                           | modified        | reviewed | R      |
| `packages/deployment-control/src/module-release.ts`                                                  | added           | reviewed | R      |
| `packages/deployment-control/src/preparation.ts`                                                     | added           | reviewed | R      |
| `packages/deployment-control/src/trust.ts`                                                           | added           | reviewed | R      |
| `packages/deployment-control/src/verifier.ts`                                                        | modified        | reviewed | R      |
| `packages/deployment-control/test/module-decisions.test.mjs`                                         | added           | reviewed | R      |
| `packages/deployment-control/test/preparation.test.mjs`                                              | added           | reviewed | R      |
| `packages/module-catalog/package.json`                                                               | added           | reviewed | R      |
| `packages/module-catalog/src/contracts.ts`                                                           | added           | reviewed | R      |
| `packages/module-catalog/src/delivery.ts`                                                            | added           | reviewed | R      |
| `packages/module-catalog/src/index.ts`                                                               | added           | reviewed | R      |
| `packages/module-catalog/test/catalogue.test.mjs`                                                    | added           | reviewed | R      |
| `packages/module-catalog/test/transitions.test.mjs`                                                  | added           | reviewed | R      |
| `packages/module-catalog/tsconfig.json`                                                              | added           | reviewed | R      |
| `packages/turnstile-contracts/src/access.ts`                                                         | modified        | reviewed | R      |
| `packages/turnstile-contracts/src/index.ts`                                                          | modified        | reviewed | R      |
| `packages/turnstile-contracts/src/modules.ts`                                                        | added           | reviewed | R      |
| `packages/turnstile-contracts/src/people-common.ts`                                                  | modified        | reviewed | R      |
| `packages/turnstile-contracts/test/modules.test.mjs`                                                 | added           | reviewed | R      |
| `pnpm-lock.yaml`                                                                                     | modified        | reviewed | R      |
| `scripts/assemble-module-runtime.mjs`                                                                | added           | reviewed | R      |
| `scripts/check-deploy.mjs`                                                                           | modified        | reviewed | R      |
| `scripts/compose-selected-modules.mjs`                                                               | added           | reviewed | R      |
| `scripts/fixtures/control-plane-module-assignments.mjs`                                              | added           | reviewed | R      |
| `scripts/fixtures/control-plane-module-machines.mjs`                                                 | added           | reviewed | R      |
| `scripts/fixtures/control-plane-module-transitions.mjs`                                              | added           | reviewed | R      |
| `scripts/fixtures/control-plane-modules.mjs`                                                         | added           | reviewed | R      |
| `scripts/fixtures/control-plane-reporter.mjs`                                                        | modified        | reviewed | R      |
| `scripts/fixtures/dms-central-http.mjs`                                                              | modified        | reviewed | R      |
| `scripts/fixtures/installation-preparation.mjs`                                                      | added           | reviewed | R      |
| `scripts/fixtures/module-access.mjs`                                                                 | added           | reviewed | R      |
| `scripts/fixtures/module-cutover-browser-setup.mjs`                                                  | added           | reviewed | R      |
| `scripts/fixtures/module-cutover-control.mjs`                                                        | added           | reviewed | R      |
| `scripts/fixtures/module-cutover-restore.mjs`                                                        | added           | reviewed | R      |
| `scripts/fixtures/turnstile-module-decisions.mjs`                                                    | added           | reviewed | R      |
| `scripts/fixtures/user-management.mjs`                                                               | modified        | reviewed | R      |
| `scripts/generate-module-openapi.mjs`                                                                | added           | reviewed | R      |
| `scripts/generate-module-transition-openapi.mjs`                                                     | added           | reviewed | R      |
| `scripts/installation-intent.mjs`                                                                    | added           | reviewed | R      |
| `scripts/installation-intent.test.mjs`                                                               | added           | reviewed | R      |
| `scripts/module-artifacts.mjs`                                                                       | added           | reviewed | R      |
| `scripts/module-build-source.mjs`                                                                    | added           | reviewed | R      |
| `scripts/module-cutover.mjs`                                                                         | added           | reviewed | R      |
| `scripts/module-delivery.mjs`                                                                        | added           | reviewed | R      |
| `scripts/module-delivery.test.mjs`                                                                   | added           | reviewed | R      |
| `scripts/module-source-map.mjs`                                                                      | added           | reviewed | R      |
| `scripts/prepare-installation.mjs`                                                                   | added           | reviewed | R      |
| `scripts/test-auth-browser.mjs`                                                                      | modified        | reviewed | R      |
| `scripts/test-auth-database.mjs`                                                                     | modified        | reviewed | R      |
| `scripts/test-control-plane.mjs`                                                                     | modified        | reviewed | R      |
| `scripts/test-installation-preparation.mjs`                                                          | added           | reviewed | R      |
| `scripts/test-module-cutover-browser.mjs`                                                            | added           | reviewed | R      |
| `scripts/test-module-cutover.mjs`                                                                    | added           | reviewed | R      |
| `scripts/test-modules-browser.mjs`                                                                   | added           | reviewed | R      |
| `scripts/test-selected-module-images.mjs`                                                            | added           | reviewed | R      |
| `tooling/dependency-rules/config.cjs`                                                                | modified        | reviewed | R      |
| `turbo.json`                                                                                         | modified        | reviewed | R      |
