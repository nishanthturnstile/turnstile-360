# Turnstile module plan review and dispositions

**Date:** 2026-11-09. **Reviewer:** Astra (`gpt-6-astra`, requested model).
**Disposition owner:** Codex parent. Confidential and proprietary.

**Status:** Independent draft review completed; both findings corrected in the final
planning documents. There were no critical findings. The high-priority mixed-transition
gap and medium-priority expiry/read ambiguity have the dispositions below. Resolution
means corrected design/requirements/acceptance gates, not implemented application behavior.

Review source:
<t3-thread://v2/9d68c40e-f782-4ac2-9d8a-2a4bbe8678bd/thread:delegated-task:command%3Amcp%3A2de9adc6-76d5-44ea-83d3-c026899f9604%3Adelegate-task%3Aeba1d4a0-dc1c-4fdf-8aa4-7c323c1e5918>

The reviewer used the shared draft checkout read-only, checked all seven input hashes
and selectively inspected current v1 decision, owning initializer and delivery boundaries.
No implementation, edits, delegated children or test suites were performed by the reviewer.
The parent made the final corrections and consistency checks; this is not a claim that
Astra independently re-reviewed the corrected revision.

## Findings and corrections

| ID         | Priority                     | Finding                                                                                                                              | Final disposition                                                                                                                                                                                                                                                                                                    |
| ---------- | ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| MOD-REV01  | High                         | Mixed additions/removals and cross-catalogue changes could preserve explicitly removed access while delivery was delayed.            | Resolved: record active and desired catalogue/profile/assignment contexts and explicit removal intent. Commit confirmed active-dependant restrictions first, then stage additions. Pure classification changes do not imply removal. Reject stale active-basis revisions and unsupported individual removal of Core. |
| MOD-REV02  | Medium                       | Expired module reads could inherit the product-level prior-activation read exception, defeating the stated offline revocation bound. | Resolved: every catalogue-managed business operation, including reads and a business module promoted to Core, requires current approved signed authority. Fixed existing foundation exceptions remain separate. The explicit decision matrix denies module reads after expiry, suspension or invalid/restored proof. |
| MOD-NOTE01 | Implementation clarification | Existing initialization is DMS-only; complete combined initialization must not be assumed available.                                 | Clarified: MOD-I05 implements a new complete combined initializer/adapter from owning DMS and Turnstile commands, with explicit reserved-identity, secret-preservation, existing-state and interruption tests.                                                                                                       |

MOD-REV01 is reflected in the architecture's
[assignment transitions](../../../architecture.md#assignment-transitions-and-effective-access),
the specification's [policy defaults](module_delivery_specification.md#policy-defaults-for-implementation)
and [MOD-I08](module_delivery_implementation_plan.md#mod-i08-implement-change-removal-and-recovery-transitions).
The required replacement test changes Incident-only to Risk-only with delayed delivery,
lost acknowledgement and stale replay, both within and across catalogues. Incident is
restricted before Risk is available; the active/desired contexts remain attributable.

MOD-REV02 is reflected in the architecture's
[signed-policy matrix](../../../architecture.md#signed-module-decisions-and-compatibility),
the same specification policy section and
[MOD-I06](module_delivery_implementation_plan.md#mod-i06-implement-v2-signed-turnstile-module-decisions).
Required tests distinguish valid cached outage, expired approval, signed suspension,
unseen remote removal at expiry, durable removal, invalid profile and restore quarantine
from the unchanged fixed foundation behavior.

The reviewer found the remaining work reasonably assigned to implementation increments
and considered MOD-I01 startable once these corrections entered its contract gate. Domain
business schemas, production hosting and all future modules are not prerequisites to
finishing this planning task. No finding is deferred without a disposition.

## Reviewed draft identity

Base source commit: `c3e5fa5e5aaf0600da25fac02051835858aecbd9`.
These are the draft hashes verified by Astra before the parent's corrections, not hashes
of the final corrected files. The review prompt required actual central/signed POC behavior
and explicitly superseded the earlier suggestion to defer central entitlements.

| Draft file                                                    | SHA-256                                                            |
| ------------------------------------------------------------- | ------------------------------------------------------------------ |
| architecture.md                                               | `86415298b6b4f190b373c1ae7108d53911de33372b851775a272c8d77d4d8442` |
| docs/README.md                                                | `ac0a107a58adbfb71f11581a7bf0d3fbbd064b417d17d5e1fe3526cc69fea796` |
| docs/deployment/installation_specification.md                 | `7790fee786a185fbe6440cb98e61c5fb9addc2aaf875f69240b36ec66bdec488` |
| docs/deployment/installation_implementation_plan.md           | `5dd925eecfcf354167471539997369ea90dceadd03a466ab749c95167bc4f9ed` |
| docs/thaarei/control-plane-specification.md                   | `b2318d2570177fb9913f5c477ce19d9850909ffe353555a56ec42eef9033e690` |
| docs/turnstile/modules/module_delivery_specification.md       | `63229268d7936b3404c4532cdc89ebe146489e45f18480f84d94ed5229b30865` |
| docs/turnstile/modules/module_delivery_implementation_plan.md | `8d6dea0fd694fa03c9b9bacc3ed0fd4420afe408bf8d2e230f0a66292966e95c` |

## Implementation handoff

Start [MOD-I01](module_delivery_implementation_plan.md#mod-i01-freeze-contracts-and-the-dependency-resolver)
with the corrected transition/expiry matrix included in the shared strict contract and
resolver fixtures. Continue through real catalogue/assignment, selected artifacts, fresh
combined setup, v2 activation and ordinary-user placeholders. Existing installer gates
remain separate from actual customer rollout acceptance. Record runtime evidence only
when those increments are implemented and exercised.
