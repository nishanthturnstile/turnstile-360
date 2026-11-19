# Permit to Work build readiness

2026-11-19 · Turnstile 360 · Thaarei confidential and proprietary

Permit to Work (PTW) can use the current Individual module delivery path. The repository
supports Incident Management and Risk Management as guarded placeholder modules. It has
no registered PTW module or permit workflow. The 2026-11-12 disposable Permit exercise
qualified the third-module delivery mechanism. Building PTW requires an accepted business
specification and extensions to the platform for a module with scoped actions, persistent
records and multiple routes. The candidate ID `permit-management` matches the disposable
fixture and needs confirmation before publication. [Module registry](../../packages/turnstile-contracts/src/module-registry.ts),
[installation evidence](../deployment/titan_acceptance_results.md#scoped-foundation-fixes--2026-11-12)

## What the repository supports

| Boundary                  | Current implementation and evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Registration              | The shared registry owns active IDs, versions, labels, a single read permission and dependency facts. Active source is mapped to `apps/turnstile-api/src/features/<id>/<id>.module.ts` and `apps/turnstile-web/src/features/<id>/entry.tsx`. `pnpm modules:sync` checks entrypoints, adds the immutable permission to the ledger, generates a company-only permission migration, and refreshes module and People OpenAPI. Central classification remains a separate staff decision. [Registration tooling](../../scripts/module-registry.mjs), [registration architecture](../../architecture.md#configurable-business-module-registration-2026-11-12)                                                                                                                                                                                                                                   |
| Selected builds           | With no selection the containers build Core. For a selected release, `compose-selected-modules.mjs` checks the declarative build request against the source digest, catalogue, profile and platform. It prunes unselected feature source inside the Docker stage before Nest and Vite compile, then writes the selected API/web entries and compiled API profile. The runtime ships the API allowlist and selected Vite output. The release verifier inspects ownership, archive/image identities and signed inventory. [Build composition](../../scripts/compose-selected-modules.mjs), [artifact inspection](../../scripts/module-artifacts.mjs), [delivery runbook](../deployment/thaarei_ecosystem_guide.md#delivery)                                                                                                                                                                |
| Assignment and activation | Staff publishes verified code facts and reviewed classification, approves the resolved selection for one Turnstile product, and gets a matching signed release. The operator applies the supported installer or retained-installation cutover. Staff activates against the reported installed release, and the customer reporter applies and acknowledges the signed decision. The intended customer users also need explicit local rights. DMS has independent deployment approval and resource authority. [Module delivery requirements](modules/module_delivery_specification.md), [transition runbook](../runbooks/module-transitions.md)                                                                                                                                                                                                                                            |
| Incident and Risk         | Incident is a Nest `GET /api/modules/incident-management/entry` endpoint and a React `/modules/incident-management` page that render one guarded message. Risk follows the same pattern. There are no incident records, incident lifecycle operations or integration interfaces for PTW. The shared module access service rechecks live membership, setup, the access-release barrier, verified installed profile, current signed v2 authority, local reductions and company-scope read rights. The web intersects this backend capability projection with selected routes. [Incident API](../../apps/turnstile-api/src/features/incident-management/incident-management.controller.ts), [Incident web entry](../../apps/turnstile-web/src/features/incident-management/entry.tsx), [runtime module access](../../apps/turnstile-api/src/modules/module-access/module-access.service.ts) |
| Third-module evidence     | The disposable script copies the source and renames Risk's placeholder as Permit. It registers and generates the known permission, exercises selected API/web images with ordinary login, and retires the fixture by setting `enabled: false`. The checks cover guarded entry, a company-only scope check, local disablement, revocation and expiry, retired direct routes, retained permission parsing, and zero-active-module contract generation. They exercise a generic module entry and its gates. [Fixture implementation](../../scripts/test-module-registration.mjs), [reported execution](../deployment/titan_acceptance_results.md#scoped-foundation-fixes--2026-11-12)                                                                                                                                                                                                       |

The November 11 [frozen release evidence](../qualification/module-release-20261111.json)
ties four selected profile pairs to a historical source inventory, together with fresh
handover, cutover and recovery evidence. The November 12 follow-up records a combined
profile `DEPLOYMENT_RESTRICTED` response that passed an isolated rerun with the same
images. Record any recurrence with its exact profile, signed decision, reporting phase
and observed clock. [Release handover](modules/module_release_handover.md),
[foundation review](../deployment/titan_acceptance_results.md#foundation-review--2026-11-12-baseline-before-scoped-fixes)

## Work required for a full module

- **Separate module admission from action and resource checks.** The registry models
  one `turnstile:<feature>:read` permission per module and `modules:sync` marks those
  permissions company-only. `ModuleAccessService.entry()` provides the synchronous
  read projection for the landing page. Define how a member with valid access to one site
  discovers the module without receiving a company-wide record read. Implement explicit
  action and resource authorization for the accepted PTW policy. For state changes,
  recheck current module authority, product write access, role/resource scope, and
  workflow preconditions in the owning transaction. Classify admitted background tasks,
  downloads and private recovery explicitly. Test stale access and signed policy races.
  [Permission generation](../../scripts/module-registry.mjs), [access policy](../../apps/turnstile-api/src/infrastructure/access-policy.ts),
  [deployment mode](../../apps/turnstile-api/src/modules/deployment/access.ts)
- **Close the optional migration and packaging gap.** The API image ships the complete
  `database` directory and all `pnpm deploy --prod` dependencies. The owning migrator
  runs one Drizzle journal, and the catalogue tooling currently fixes `migrationVersion`
  at `1`. Define and qualify a profile-aware path for feature-owned SQL, executable
  assets and any private dependencies under MOD-R07. Preserve the immutable shared
  permission ledger and a single deterministic core migration history. Record how
  selected feature migrations are ordered, verified and applied during fresh installation
  and cutover, how omitted/retired records stay recoverable, and what compatibility
  barrier governs older images. Keep paths and digests in the release evidence and
  check them against the actual image and private tooling. [API Dockerfile](../../apps/turnstile-api/Dockerfile),
  [runtime assembly](../../scripts/assemble-module-runtime.mjs), [migrator](../../apps/turnstile-api/src/infrastructure/database/migrate.ts),
  [build source](../../scripts/module-build-source.mjs), [MOD-R07](modules/module_delivery_specification.md#requirements-and-acceptance)
- **Enforce ownership for every registered module.** The dependency rules fence only
  Incident and Risk today. Extend them to the accepted PTW layout and retain checks
  for retired IDs. Shared source inventories and contracts can describe a supported
  ID while its implementation stays out of the image. Inspect excluded SQL, executable
  docs/assets, runtime dependencies, source maps, modules and private tool entrypoints.
  The API verifier currently expects each selected feature to expose a standalone
  `entry.js` message function, and Vite inspection looks at JavaScript chunk inputs.
  Keep the compatible entry or update the selected-image proof for the real entrypoint
  and its generated CSS/assets. [Dependency rules](../../tooling/dependency-rules/config.cjs),
  [image verifier](../../scripts/module-artifacts.mjs), [Vite ownership plugin](../../apps/turnstile-web/vite.config.ts)
- **Support the business routes and a versioned client contract.** The shell resolves an
  exact `/modules/<id>` route, and module OpenAPI generation covers capability and
  placeholder entry responses. Provide an owned route strategy for PTW record deep links
  and refreshes. Expose platform-independent contracts for actual business operations.
  Check strict older client parsers against new module IDs and permission names in saved
  sessions and People responses. Use an explicit compatibility boundary where the
  existing apps need one. [Web shell](../../apps/turnstile-web/src/App.tsx),
  [module API generator](../../scripts/generate-module-openapi.mjs), [module contracts](../../packages/turnstile-contracts/src/modules.ts),
  [People permission contracts](../../packages/turnstile-contracts/src/people-common.ts)
- **Keep integrations independently authorized.** The current Incident slice gives
  PTW no lookup or case-linking interface. Keep PTW usable with Core unless the accepted
  design establishes a required deployment dependency. Any later cross-module link needs
  a published integration contract, current authority at both ends and tests across module
  absence, disablement and revocation. For evidentiary files, use Turnstile's authorized
  server-side DMS HTTP integration with explicit resource grants and durable references to
  the required versions. Qualify against a DMS distribution that actually provides those
  operations. [Module dependency policy](modules/module_delivery_specification.md),
  [Documents integration requirements](documents/documents_validation_specification.md)

## Proposed qualification sequence

1. **Approve module and safety workflow design.** Record the exact version and ID,
   dependencies, action/resource model, site authorization and command/recovery boundaries.
   Confirm PTW's owned SQL, record retention and compatibility design before building the
   first persistent slice. Use the existing workspace handoff to record any later work.
2. **Qualify the first persisted vertical slice.** Use real Fastify/PostgreSQL with
   normal sessions and separately assigned scope. Exercise accepted transitions from
   ordinary UI and direct API, with denial for a site mismatch, missing action, stale
   authority, forbidden self-approval where policy requires separation, and invalid
   state. Verify concurrent commands, lost acknowledgements, replay after an intervening
   decision and atomic readback/audit. Check RLS and the runtime role against real SQL.
3. **Qualify selected production artifacts.** In addition to the workspace checks, build
   and verify exact Core, Core+PTW, Core+Incident, and Core+PTW+Incident API/web pairs if
   PTW and Incident are independently selectable. Preserve the existing Risk selections
   in the regression suite. Explicitly select profiles because the default image suite
   only enumerates the original four, and `--all-registered` builds one combined profile.
   Use `pnpm test:images:modules` and `pnpm test:browser:modules` with a new private
   absolute fixture directory and `--modules=permit-management` for the single-PTW case
   after registration. Extend the harness to cover PTW business routes and migrations.
   Verify positive and excluded requests, enabled and disabled deep links, image assets,
   absence of unselected implementation and exact signed archive/content identity. Run
   a packaged older browser through a compatible upgrade where the clients can overlap.
   [Selected-image runner](../../scripts/test-selected-module-images.mjs),
   [current browser harness](../../scripts/test-modules-browser.mjs)
4. **Qualify customer lifecycle on disposable installations.** Exercise central signed
   publication, assignment, build request, artifact-only installation, acknowledgement,
   explicit grants and normal-login PTW work. Exercise missing/wrong package, expiry,
   suspension, local disable, and signed restriction while central is reachable and when
   its cached authority expires offline. Run the retained-installation cutover using
   actual old/new images, and extend its retained-data comparison to PTW records and
   receipts. Demonstrate removal without record loss, profile rollback/recovery fences,
   and deliberate re-add with a newer approval and current rights. Verify lost report or
   command acknowledgement against owning handlers and retries. [Cutover runner](../../scripts/test-module-cutover.mjs),
   [installer qualification](modules/module_installation_qualification.md)
5. **Record release and site acceptance.** Keep source, contract, migration, profile,
   exact image, archive, release, assignment/acknowledgement and log hashes. Separate
   source checks from actual selected-image runs and the intended Linux/Dokploy target.
   Record authorized site workflow acceptance, independent human installer use, off-host
   recovery and protected distribution before claiming production readiness. Keep customer
   identifiers, credentials and permit content out of general release evidence. [Release handover](modules/module_release_handover.md)

This audit ran the source registry check and both focused registry tests on
Node 24.21.0 and pnpm 12.16.1. The registry reported two active modules and two retained
permission identities. Selected images, installation, and cutover results above refer
to the dated repository evidence. Production PTW functionality and its qualification
remain prospective.
