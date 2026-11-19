# Permit to Work policy decisions

**Status** · Proposed product defaults for PTW discovery, 2026-11-19.

Turnstile records who authorized defined work, where and when it may occur, the checks
that support the decision, and who returns the site or equipment to operations. Each
site's accountable duty holder approves the operational policy before the site can issue
permits through Turnstile. The site policy identifies the applicable jurisdiction,
industry rules and customer procedures. The examples below draw on Great Britain
HSE guidance and specified US OSHA standards. Applicability depends on the work
and jurisdiction.
[HSE Permit to Work systems](https://www.hse.gov.uk/humanfactors/topics/ptw.htm)

## Site approval and software defaults

| Decision              | Proposed Turnstile default                                                                                                                                                                                                                                               | Accountable site decision before use                                                                                                                                                                    |
| --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Scope                 | A permit covers named work, a defined work boundary, a responsible crew, and a bounded validity window. Identify the site, work area and affected assets or infrastructure.                                                                                              | Which activities need permits, procedure-only exceptions, local work boundaries and prohibited work.                                                                                                    |
| Duration              | Plan execution within one staffed shift and end no later than the earliest applicable task, shift, type, linked control, or required qualification deadline. Recheck current conditions at start. Continuation across shifts requires a new authorized execution window. | Shift calendar and clock, type-specific limits, earliest start, handover or reissue rules, cumulative time limits and legally required renewals.                                                        |
| Authority             | An on-duty site-delegated issuer authorizes issue, a different work lead accepts, and an independent reviewer signs where required. Area authority coordinates concurrent work and acknowledges handback.                                                                | Named delegates, shift cover, permitted role combinations, competent specialist checks and escalation by permit type, hazard and scope.                                                                 |
| Competency and people | Evaluate verified role, evidence, scope and current availability at each action. Require at least two distinct assigned workers and a designated watcher who personally holds current first-aid competency throughout the execution window.                              | Valid evidence and training levels, expiry, role compatibility, response arrangements, site induction, contractor sponsorship and stricter staffing requirements, including any additional first aider. |
| Field controls        | Require current signed checks and structured proof for the applicable task and type. Block issue and start on missing, failed, stale, unverified or contradictory required evidence.                                                                                     | Checklist and monitoring intervals, thresholds with units, accountable checker, approved alternatives, stop and restart conditions, and evidence retention.                                             |
| Concurrent work       | Show planned, issued, active, suspended and unresolved expired work against the same asset, shared isolation, work area, affected area and time window. Unresolved conflicts block issue and start.                                                                      | Area boundaries, conflict relationships, incompatible combinations, supervisor capacity, and coordination procedures.                                                                                   |

Publish a site policy as an approved revision with a named owner and effective date.
Keep the requirements and procedure versions applied to each permit in its history.
Apply a new policy or withdrawal to open work through an explicit impact review.
When a new restriction affects an active permit, ensure work is stopped or made safe
under site procedure and require the applicable checks again before continuation.
Use examples and conditionally enabled templates during setup. Issuance requires an
approved policy for that site, type and pathway.

## Validity, handover and handback

- Plan separate times for the requested work, the authorized start and expiry, actual
  start, stop, handover, and release. Issue prepares the signed permit and actual work
  starts after acceptance and field verification. Display local site time with its offset
  and zone. Suggest eight hours while preparing a draft only when both the approved
  type and shift permit it. At the cutoff, work permission ends even if a notice has
  yet to arrive.
- Default to no routine extensions. If a site policy and applicable rule permit a
  same-shift extension, require a reason, a fresh risk assessment and on-site evidence,
  confirmed crew and isolation coverage, updated conflict review and a new issuer
  decision before expiry.
  Keep prior expiry and authority visible. An expired permit requires a new issue or
  revalidation decision under site policy before work can resume. Where the applicable
  rules require cancellation and a new permit, enforce that path. US general-industry
  permit-space rules cap the entry permit at the assigned task duration and require
  cancellation when a prohibited condition arises. [OSHA 29 CFR 1910.146(e)](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.146)
- Carryover links the new execution window to the earlier work. Record unfinished work,
  safe condition, open hazards and controls, shared isolations and adjacent permits.
  Incoming area authority and work lead acknowledge the handover, verify changed crew
  and conditions, and authorize only the next bounded window through the site's issuer.
  Work remains paused until this is complete. Change of scope, work boundary or method
  that changes hazards requires reassessment and fresh authorization. [HSE Shift handover](https://www.hse.gov.uk/humanfactors/topics/shift-handover.htm)
- Stop immediately under site procedure for an alarm, loss of crew or observer coverage,
  failed required control, changed conditions, unsafe concurrent work or withdrawal of
  authority. Site-confirmed stop, the condition of equipment and follow-up checks remain
  visible during suspension or expiry. Keep permits with unresolved field status on the
  area board and keep dependent isolation holds until accountable handback and release.
- The work lead returns the work, including incomplete work and any remaining hazards.
  The issuer or area authority verifies the condition and operations accepts custody.
  A separate authorized operation can release isolations or return equipment to service
  once dependent work and physical restoration checks are cleared. HSE guidance calls
  for issuer visits at the start and completion of the task, with interim checks scaled
  to the hazard, complexity and duration. Set those checks in the pilot site policy.
  [HSE HSG250 §§23–28](https://www.hse.gov.uk/pubns/priced/hsg250.pdf)

## Competency, contractors and role combinations

- Operational authority requires a current identity, explicit action and scope,
  named site delegation where the role requires it, and appropriate verified competency.
  Use grants scoped by site, work area or asset class, work type, role and effective
  dates. Record verifier, evidence provenance, verification and expiration dates,
  restrictions and revocations. A course record or job title can support assessment.
  The designated verifier confirms evidence and practical competence before it grants
  eligibility. Validate during assignment, issue, start, resume, handover and other
  relevant decisions. Recheck affected work on revocation or loss of access.
- Register each contractor as an identified person with an employer, host sponsor,
  approved work boundary, site induction, required verified trade credentials and a
  time-bounded assignment. Use individual acknowledgements and a named contractor lead.
  The host issuer retains area authority. Contractors can request or accept within
  their delegation. Pilot policy reserves issue to the host. Any later delegation to
  a contractor requires an explicit site decision, current training, competency and
  scope, and the same independence checks as an employee. Record host–contractor
  hazard briefing, coordination, and handback or debrief where applicable.
  [HSE Contractor management](https://www.hse.gov.uk/humanfactors/topics/contractors.htm), [OSHA 29 CFR 1910.146(c)(8)–(9)](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.146)
- The crew minimum counts two distinct, present people authorized and competent for
  assigned worker duties. The designated first-aid watcher personally holds current
  first-aid competency recognized by the site. They monitor the work as assigned, can
  respond within the approved arrangements and initiate the site's emergency response.
  The site can require a separate first aider or additional trained cover. A person
  counts toward the two-worker minimum only when they can perform an assigned worker
  duty alongside their safety role. Add staff where watching, rescue readiness or other
  specialist duties require dedicated coverage. Higher legal or site staffing and
  qualification minima apply. HSE bases workplace provision on a first-aid needs
  assessment. Some US electrical power work has specific staffing and first-aid rules.
  [HSE First-aid needs assessment](https://www.hse.gov.uk/firstaid/what-employers-need-to-do.htm), [OSHA 29 CFR 1910.269(b), (l)](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.269)
- An issuer may also be the area authority in a site-approved profile. The requestor
  may serve as the work lead when qualified. A permit originator who is also an issuer
  may issue only to a different work lead and crew. Keep the issuer independent of
  the performing team on that permit. For the initial High and Critical templates,
  require a reviewer distinct from the issuer and performing team. Record each person
  in the actual capacity they sign for. A platform administrator needs the same
  operational delegation as anyone else. [HSE HSG250 §§25–30](https://www.hse.gov.uk/pubns/priced/hsg250.pdf)
- Protect watch and rescue independence at the duty level. A confined-space attendant
  remains outside the space and has no interfering assignment during entry. Fire watch,
  first-aid watcher, spotter, standby rescue and radiography boundary duties each have
  their own requirements. Permit concurrent role assignment only where law and approved
  site policy allow it and the person can fulfil both throughout the same window.
  Include overlaps with duties on other permits in the check.
  [OSHA 29 CFR 1910.146(i)–(j)](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.146)

## Field controls and thresholds

Record where the job starts and ends, equipment and energy sources, credible hazards,
control owners, location and affected boundaries, and stop triggers. Require the approved
task risk assessment and methods, current control verification, toolbox briefing with
required crew acknowledgements, applicable rescue and emergency details, and access to
the current permit at the point of work. Record issuer or qualified specialist checks
with the timestamp and field evidence. Where useful, store the evidence source,
instrument identification and calibration status, reading and unit, threshold and
validity window. Templates may suggest controls and record fields for confirmation.
[HSE HSG250 §§19–28, 38–41](https://www.hse.gov.uk/pubns/priced/hsg250.pdf)

Require qualified site owners to approve parameters, including valid ranges and boundary
comparisons, test cadence, calibration requirements, escalation and what to do when a
reading is unavailable. Version thresholds by site, task, type, asset or area as needed.
Examples include atmospheric readings and retest intervals, hot work proximity and
post-work watch, electrical boundaries, work at height triggers, ground disturbance
limits, lift characteristics, weather and exposure limits. Each operative threshold
records its source and units. An unresolved question about whether a type or threshold
applies requires a competent review before issue. If a required limit is not configured,
missing data blocks issue. Regulatory numbers depend on the applicable regime, operation
and conditions. [OSHA Hot work, 29 CFR 1910.252(a)](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.252/), [HSE Work at height](https://www.hse.gov.uk/work-at-height/step-by-step-guide.htm)

## Permit types and supporting controls

Ship the five base templates for site review. Work spanning types carries every relevant
control and linked authorization. For example, hot work in a confined space requires
both reviews and controls, with the same affected area visible to the issuer. A dashboard
or single permit presentation can group them while keeping type-specific decisions and
their dependent holds clear. The site determines whether a specialty needs its own permit,
a supporting certificate or authorization under an approved procedure.

| Base type       | Minimum design coverage for site review                                                                                                                                                                                                                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Hot Work        | Ignition and exposure assessment, field inspection, combustible and nearby process controls, qualified fire watch when required, any gas testing and post-work watch, and verification before handback. [OSHA 29 CFR 1910.252(a)](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.252/)                      |
| Confined Space  | Identified space and purpose, entrants and separate attendant coverage, entry supervisor, isolation, acceptable conditions and current test evidence, monitoring, communications, available rescue and entry termination. [OSHA 29 CFR 1910.146(d)–(k)](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.146) |
| Electrical Work | Equipment and circuit boundary, qualified people, proven deenergization and isolation where required, other electrical hazards and controls, and path to the site-approved Live Work exception if exposure remains. [OSHA 29 CFR 1910.333](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.333)              |
| Work at Height  | Site-approved justification, prevention and protection measures, work surface/access or equipment checks, people affected below, and rescue arrangements. [HSE Work at height](https://www.hse.gov.uk/Construction/faq-height.htm)                                                                                               |
| Excavation      | Defined location and extent, utility records and field identification, exclusion and protective measures, competent inspections and interface with nearby work or traffic. [HSE HSG47](https://www.hse.gov.uk/pubns/books/hsg47.htm), [HSE Excavations](https://www.hse.gov.uk/construction/safetytopics/excavations.htm)        |

| Specialty or alternative       | Proposed treatment                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Live Work                      | Controlled energized electrical exception linked to Electrical Work, disabled at setup. Require documented justification to work live, competent specialist review and independent authorization, and all local protective and emergency arrangements. No direct issue path. Address non-electrical energized or pressurized work through the site's approved process or mechanical policy. [HSE HSG85](https://www.hse.gov.uk/pubns/priced/hsg85.pdf), [OSHA 29 CFR 1910.333](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.333)                  |
| Lifting Operations             | Site-enabled specialty for lifts meeting the site's permit criteria. Require the approved lift plan, equipment and inspection evidence, competent roles, work boundary and coordination. Define how people lifts, complex lifts and lifts over occupied or critical areas escalate. [HSE Planning lifting operations](https://www.hse.gov.uk/work-equipment-machinery/loler-overview.htm)                                                                                                                                                                                |
| General and Cold               | Model a site-enabled General template for defined residual permit-required work. Use Cold as an alias or separately approved profile where the site has a substantive cold-work procedure. Require hazard screening, including work that can create an ignition source. The more specific required controls take precedence. [HSE Permit to Work technical measures](https://www.hse.gov.uk/comah/sragtech/techmeaspermit.htm)                                                                                                                                           |
| Mechanical or Energy Isolation | Default to a separately controlled isolation certificate linked to affected permits, with physical isolation verification by a competent authority, shared use, hold and release tracking. A site can adopt a separate Mechanical Work permit when its activity policy calls for one. Powered testing or temporary energization gets a distinct controlled step with all affected work coordinated. [HSE HSG253](https://www.hse.gov.uk/pubns/priced/hsg253.pdf), [OSHA 29 CFR 1910.147(e)–(f)](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.147) |
| Radiography                    | Disabled at setup. Enable with specialist policy for applicable consent or licensing, qualified crew, boundary and surveillance plan, access restrictions, emergency provisions and verified area release. Resolve affected-area conflicts before issue. No direct issue path. [HSE Industrial radiography](https://www.hse.gov.uk/radiation/ionising/indradiography.htm), [HSE Radiation protection sheet IRP1](https://www.hse.gov.uk/pubns/irp1.pdf)                                                                                                                  |
| Chemical Handling              | Use site-approved chemical assessment controls on the parent work. Enable a specialty for site-defined hazardous or non-routine chemical work. Require task-specific assessment, current SDS and exposure and emergency controls. Cross-reference isolation, hot work or confined-space requirements where present. [HSE COSHH assessment](https://www.hse.gov.uk/coshh/basics/assessment.htm), [HSE Safety data sheets](https://www.hse.gov.uk/COSHH/basics/datasheets.htm)                                                                                             |

## Direct competency-based issue

The initial five templates use standard issue. For a later release, consider direct
issue only for a site-approved allowlist of predictable, repeatable tasks by site, area,
asset or class, type and approved procedure revision. A qualified work lead can initiate
the request. An on-duty issuer with current delegation and task competency may originate
and issue to a different competent work lead without a separate approval queue when that
exact profile authorizes it. Use the same live crew, field verification, risk, competency,
inspection, evidence, acceptance and conflict checks as standard issue. Record the issuer,
rationale and matched rule. Independent review, exceptions, uncertain classification,
stale evidence and conflicting conditions send the request to the relevant review path
or block it. Preserve independent human issue and acceptance for every work instance
and obtain the second decision where the site's risk rules require one.
[HSE HSG250 §§25–30](https://www.hse.gov.uk/pubns/priced/hsg250.pdf)

## Machine, shift and document journeys

| Entry point      | User journey and decision boundary                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Machine or asset | A search, equipment tag or work order opens a draft for the specific asset and task. Confirm the physical equipment ID and affected work boundary. Show open permits, operational state, isolation dependencies and adjacent work. Routine operating authorization and work requiring PTW follow separate site criteria. Maintenance, cleaning, unjamming or a test may trigger PTW or isolation when the approved procedure designates it. A scan, machine signal or job completion never authorizes work, unlocks equipment or commands machinery. [HSE Work equipment maintenance](https://www.hse.gov.uk/work-equipment-machinery/maintenance.htm), [OSHA 29 CFR 1910.147(a)](https://www.osha.gov/laws-regs/regulations/standardnumber/1910/1910.147) |
| Shift            | Start from the area board or an open handover. Review incoming crew, roles, physical checks, isolations, dependencies and changed conditions. Create or attest a new bounded work instance per site policy. A shift roster, calendar event or unattended job supplies context only.                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Document         | A procedure, work pack, SDS or risk assessment opens a draft with a reference to the exact approved revision. Verify its applicability at the worksite. Extracted content or uploaded legacy permit can assist review or recording historical evidence. It never creates current authority. Replaced or withdrawn required evidence prompts active work review.                                                                                                                                                                                                                                                                                                                                                                                            |

For example, an asset tag starts a maintenance draft for one pump. A verified isolation
certificate supports the specified work. At shift change, the area board carries the pump's
safe condition and outstanding isolation into the linked next execution window for personal
handover and renewed approval. An approved work pack remains pinned in both records. The
area authority clears the outstanding work through handback before operations can release
the isolation and return the pump to service.

## Integration policy and pilot acceptance

- Source references from People and Structure for known identities and sites, approved
  evidence sources for verified competency, Assets or work orders for machine and job
  context, and DMS for exact document versions. Grant the integration only the
  needed access and verify site, person, asset, document and revision mappings. Require
  current authoritative evidence for safety-critical gates. Allow site-approved manual
  verification of required facts only where the published policy explicitly supports it.
  Incidents, risk, training and maintenance integrations can exchange references and
  notify responsible people when present. See the [architecture](../../architecture.md#turnstile-application-architecture).
- Failed alerts or upstream synchronization remain visible to operators and cannot
  change permit authority. With required evidence unavailable, block new issue/start
  on that path and follow the site's stop, emergency and reconciled fallback procedures
  for work already underway. Trial continuity and reconciliation before going live.
  Physical stop-work and emergency arrangements remain accessible at the worksite.
  [HSE Permit to Work systems](https://www.hse.gov.uk/humanfactors/topics/ptw.htm)
- Before pilot issue, the named duty holder and site safety authority sign the local
  policy, including limits, roles, template applicability, evidence, crew and watcher
  rules, conflicts and handover. Operations, contractor representatives where relevant,
  and permit users rehearse a normal job, attempted self-issue, an expired credential,
  an unqualified or absent designated watcher, shift handover, simultaneous work with
  shared isolation, stop-work, and system unavailability. Capture acceptance against
  the exact policy revision.
