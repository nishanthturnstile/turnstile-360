# Installation automation specification

**Date:** 2026-11-07. **Owner:** Thaarei. Confidential and proprietary.

**Status:** Planning proposal authorized by the owner. Installer implementation and
target rollout are separate work. Existing authentication, approval, tenancy and recovery
policies retain their accepted authority. New installer and login-proof contracts require
the design gates in the [implementation plan](installation_implementation_plan.md).

The outcome is a repeatable way to prepare one customer installation from a reviewed
release, connect it to the existing Thaarei control plane, and guide its administrator
through first use. Operators supply deployment inputs once, run supported stages and
resume after interruption. Staff approval and customer identity/business decisions remain
explicit actions with a named actor.

[Architecture](../../architecture.md#proposed-installation-automation) owns the proposed
components, input/state contracts and deployment adapters. This specification owns
IA-R01–18; [progress](../../IN_PROGRESS.md) owns actual delivery and verification.

**Module extension, 2026-11-09:** The
[central module specification](../turnstile/modules/module_delivery_specification.md)
adds centrally reviewed catalogue/assignment, selected artifacts and signed Turnstile
module authority. Fresh central-first setup consumes verified reserved identities and
the selected immutable profile; existing/local-first adoption retains actual identities.
Module prerequisites apply before freezing combined release packaging and the installer
intent adapter. Host/TLS/owning-provisioning groundwork remains reusable.

## Release scope

The first delivery supports fresh Linux installations of the combined Turnstile/DMS
profile, with an isolated local test adapter and a Dokploy customer adapter using the
same engine. It reuses the existing central deployment. A complete release includes the
customer applications and every dependency required by the selected processing profile.
Existing standalone DMS delivery remains supported independently; it is not renamed or
silently converted into a Turnstile installation.

Host/cloud account creation, DNS ownership and production mail credentials are supplied
by the infrastructure operator. The installer validates those prerequisites and can
configure the authorized Dokploy application; it does not introduce a cloud provisioner,
Kubernetes cluster or remote execution service in central. Central installation/recovery
continues through its own runbook, not once per customer.

Existing-installation adoption, software upgrades and destructive resets have distinct
reviewed procedures. The first installer must recognize them and refuse fresh setup over
their state. It may direct the operator to supported recovery commands; generic installer
update/restore actions are deferred until separately qualified. It must preserve the
accepted coherent recovery and release barriers from its first delivery.

Turnstile currently implements workspace/people/configuration and a permitted DMS
connection check. Document pipeline acceptance uses the DMS API/independent consumer;
this plan does not add Turnstile document business screens or mobile functionality.

## Evidence carried forward from local setup

The 2026-11-07 local setup established staff/customer identity separation, two independently
paired and approved products, activation acknowledgements, normal customer login,
protected administrator handover, completed company setup and an authenticated Turnstile
machine request to DMS. After processing configuration, API and processing readiness passed
with authorized workers and nonempty capabilities. DMS-I20 has separate frozen local
automated qualification evidence. These are distinct checks, not a production acceptance.

The fresh installation's real-file upload through scan, extraction/OCR, retrieval and
download hash comparison remains an acceptance task. A clean second Linux/Dokploy target,
resume under injected failures, production email/TLS and off-host recovery also require
their own evidence. Dated private scripts used for this setup are prototypes, not a
distributable installer. See [fresh manual testing](../runbooks/fresh-manual-testing.md)
and the current progress handoff.

## Requirements and acceptance

| ID     | Requirement                                         | Acceptance                                                                                                                                                                                                                                                                                                                                                                                           |
| ------ | --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| IA-R01 | Complete immutable customer release                 | Install from a trusted, versioned bundle containing the exact Turnstile/DMS/dependency images, compatible migrations/private commands, notices, inventories and source-offer material. Reject missing, substituted or incompatible artifacts before mutation. The target needs supported Docker/Compose, not a source checkout or host build toolchain.                                              |
| IA-R02 | One validated installation intent                   | Validate a versioned nonsecret intent, generate and retain installation/tenant/application identities once, and export central inventory without manual UUID re-entry. Keep central products, local DMS applications and OAuth clients distinct. A changed installation binding cannot resume an existing run.                                                                                       |
| IA-R03 | Useful preflight                                    | Check required host/runtime capabilities, available resources, clock, fixed local ports or Dokploy routes, canonical DNS/TLS from browser-facing and container paths, private network isolation, SMTP and selected-profile prerequisites. Report concrete failures before the affected stage. Never choose a fallback origin/port or disable verification.                                           |
| IA-R04 | Safe rerun and resume                               | Persist intent and operation identity before effects. Reconcile authoritative state on retry; completed stages become verified no-ops. Preserve IDs, secrets, accounts, grants, volumes and business data. An ambiguous result without sufficient evidence stops for reconciliation, not a new issuance or automatic reset. Allow only one mutating installer for an installation.                   |
| IA-R05 | Owning provisioning commands                        | Provision roles, migrate/bootstrap each owned schema, configure storage and generate broker definitions through supported private commands. Keep runtime and migration credentials separate. Do not import another application's repositories/schema or edit security/domain rows directly.                                                                                                          |
| IA-R06 | Guided independent central activation               | Import/review nonsecret inventory, register separate DMS/Turnstile records, validate and privately deliver the correct pairing artifact, then require authorized staff approval with current MFA. Pairing stays closed to business use. Verify signed decisions and activation acknowledgement for each product; reports remain independent.                                                         |
| IA-R07 | Correct customer identity sequence                  | Require genuine email verification and normal password/login. Before exposing normal product sign-in, provision its actual local login client and validate policy/callback/issuer. Verification completion before that point must lead to an honest preparation screen. Expired links, unverified email and expired sessions offer their owning recovery action without revealing account existence. |
| IA-R08 | Separate local integration authority                | Issue distinct login, DMS-machine and identity-service clients, enroll the correct local DMS application, and supply only explicit supported scopes/grants. Configure four independent processing-role clients when selected. Central approval, an identity admin role and network placement grant none of those rights implicitly.                                                                  |
| IA-R09 | Accountable protected administrator                 | Retain the private administrator bootstrap/release barrier, current ordinary-login proof, live identity checks, release inventory, revision/epoch fencing and explicit opening. Provide a reviewed short-lived proof handoff instead of routine cookie copying. A browser proof endpoint cannot assign roles, open writers or receive migration authority.                                           |
| IA-R10 | Complete selected-profile processing                | Require explicit admission formats/profiles/budgets, authorized workers, storage/broker configuration and valid fresh scanner data. Capabilities must match the chosen profile. API availability alone cannot pass processing readiness; unavailable optional profiles stay unavailable. Never weaken freshness or signature validation to pass setup.                                               |
| IA-R11 | Preserve customer business choices                  | The chosen administrator supplies and confirms company name, time zone and real first unit through the normal product setup flow. Prefill only explicitly supplied valid business inputs; do not invent a plant, silently complete onboarding or overwrite edits made while the installer waits.                                                                                                     |
| IA-R12 | Honest status and evidence                          | Show each product's activation, identity/integration state, API/processing readiness, workspace readiness, outstanding actor/action and evidence age. Keep technical readiness, real-document verification and accountable target acceptance separate. Exit successfully while waiting only with an explicit machine-readable waiting state, never a claim of complete setup.                        |
| IA-R13 | Protected inputs and understandable file handling   | Use protected local files/stdin or scoped secret references, atomic writes and typed JSON/env writers. Prevent secrets in source, arguments, browser bundles, evidence and logs. Distinguish a nonsecret manifest from a pairing secret; explain missing/expired/wrong-product files. Guide WSL/Linux/Windows path conversion without guessing another user's home.                                  |
| IA-R14 | Same engine for test and production                 | Use the same owning handlers, engine and release artifacts with adapter-specific inputs. Local trusted test CA/Mailpit/disposable test actors are explicit fixture facilities. Production preserves real TLS/mail/MFA and human approvals; there is no bypass flag that marks an account verified or a product approved.                                                                             |
| IA-R15 | Independent environments and safe recovery identity | A new region/environment gets independent installation state and credentials with exactly one tenant. Replicas retain the existing identity. A recovery target preserves the coherent installation identity and uses the existing quarantine/reconciliation rules; it cannot masquerade as a fresh installation or a second active primary.                                                          |
| IA-R16 | Functional integration evidence                     | Verify the installed Turnstile-to-DMS token/service path and normal user permission checks separately. In an authorized test scope exercise real uploads, clean scan, extraction/OCR and byte-identical download, plus denied cross-application access. Label service probes, browser journeys and prior fixture evidence accurately.                                                                |
| IA-R17 | Operational handover and recoverability             | Deliver image/configuration inventory, protected secret/key custody, backup destination and coherent restore procedure, support actions and limitations. Rehearse restart and interrupted recovery in an independent target before production acceptance. No implicit volume deletion, automatic downgrade to a non-enforcing image, credential rollback or writer opening after restore.            |
| IA-R18 | Versioned operator interface                        | Provide documented plan/install/status/resume/verify actions with strict inputs, bounded safe errors, stage/operation IDs and meaningful exit/status contracts. Plan and default verification do not provision users, create documents or change grants. An evidence run binds the exact engine, bundle, intent and target.                                                                          |

## Operator and human responsibilities

| Participant             | Installer prepares or performs                                                                                                   | Explicit action retained                                                                                                      |
| ----------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Infrastructure operator | Validate target, render bounded deployment configuration, invoke authorized owning tools, inspect readiness and retain receipts. | Supply production domains/mail/secret references, approve the selected deployment intent and recovery/backup scope.           |
| Thaarei staff           | Prefill registry fields from local inventory, guide pairing-file delivery, sync and show both acknowledgement states.            | Sign in to central, complete current MFA, review real bindings and approve each product with a reason.                        |
| Customer administrator  | Guide verification/recovery, wait until login clients exist and request scoped proof for the private handover.                   | Control email/password, sign in normally, confirm the intended administrator and complete company/time-zone/first-unit setup. |
| Acceptance owner        | Produce redacted verification results and a checklist of outstanding evidence.                                                   | Authorize any test writes, review recovery/target evidence and sign the deployment-specific acceptance.                       |

The operator's existing authorization covers the approved installation stages; network
retries do not require repeated consent to the same intent. A binding change, broader
permission, new credential rotation, test-data creation, recovery or deletion is a distinct
action and must use its own supported authorization. The control plane remains registry,
approval and disclosed reporting under TCP-R13; it receives no remote shell, deployment
agent or customer migration credentials.

## Setup lessons converted into behavior

| Observed issue                                                                                                               | Required installer behavior                                                                                                                                                                                |
| ---------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Windows browser could not initially trust/reach WSL test domains.                                                            | Test Windows/browser and WSL/container paths separately; document narrowly scoped test CA/hosts changes and retain the CA private key locally. Never imply a test certificate is production TLS.           |
| Password reset succeeded while email was still unverified. Invalid/expired reset callbacks showed an unusable password form. | Keep verification, password reset and login states distinct; explain password bounds and route invalid tokens to a new email request. Preserve the existing reset-entry regression coverage.               |
| MFA expired while issuing a pairing file; the button remained disabled with a pending request.                               | Explain the current MFA requirement, reauthenticate and resume the same request while reconciling its receipt. Never issue a replacement merely because download/response was lost.                        |
| A nonsecret setup manifest or Windows UNC path was passed as a pairing file.                                                 | Identify the artifact before use, validate installation/product binding, provide a file picker or precise path guidance, and pass Linux paths to Linux tools.                                              |
| Verification redirected to product sign-in before any OAuth client existed.                                                  | Use an allowed setup-completion destination while registration is pending; expose normal sign-in only after actual clients and callback policy are verified. No verification bypass to solve the ordering. |
| A completed client setup rerun failed with a generic preflight message.                                                      | Reconcile retained receipts with actual registrations/enrollment and report already configured. A partial marker alone proves neither success nor failure.                                                 |
| HttpOnly cookie copying and stale proofs complicated administrator handover.                                                 | Design a scoped short-lived proof exchange with explicit user confirmation, live revalidation and private grant authority. Refresh proof/revisions between protected transitions.                          |
| JSON was accidentally processed as dotenv; another input had an incorrectly encoded recovery epoch.                          | Use schema-specific writers/validators, validate canonical encodings before startup and replace files atomically. Preserve valid generated secrets during repair.                                          |
| Containers ran while processing admission/workers were absent or scanner data was stale.                                     | Verify the entire selected capability/readiness profile and report the missing dependency; process liveness is insufficient.                                                                               |
| A user edited company setup during an operator check.                                                                        | Treat current application state/revision as authoritative; never restore an earlier empty snapshot over concurrent user work.                                                                              |

## Acceptance boundary

The first release must pass fresh install, unchanged rerun, restart/resume and failure-path
qualification using the production commands/handlers and exact distributed images. The
[implementation plan's evidence matrix](installation_implementation_plan.md#acceptance-evidence)
assigns each requirement to its gate. A fixture that replaces the failing production
handler cannot establish its recovery behavior.

Production acceptance additionally requires a named target, production DNS/TLS/mail and
backup custody, independent recovery evidence, real administrator/permission checks and
authorized document verification. A technical check cannot supply customer acceptance or
turn local synthetic performance into a capacity promise. Actual customer test data and
its retention/cleanup are agreed inputs, never an automatic installer side effect.
