# Thaarei control plane planning overview

**Date:** 2026-11-06. **Owner:** Thaarei. Confidential and proprietary.

**Status:** Proposed scope and design for review. No implementation has started.
The owner clarified that the control plane must approve customer product deployments and
receive operational summaries, beyond the earlier registry-only draft.

Thaarei will host one central Next.js web application with its own integrated server
endpoints and database. Staff registers a client and its intended DMS/Turnstile deployments,
pairs them, approves them and reviews health/usage reports. Customer software stays on
customer infrastructure with its existing local identity and business authorization.
The central app has its own Linux host; each customer Linux host contains all three
customer applications, owning persistence and required DMS storage/processing services.

## Reading order

1. [Specification](control-plane-specification.md): terminology, TCP-R01–15, employee and
   customer journeys, included controls and operating-policy choices.
2. [Architecture proposal](../../architecture.md#thaarei-central-control-plane-proposal):
   component/network boundaries, credential matrix, pairing, signed approval, restrictions,
   report sources, protocol and proposed timing/limits.
3. [Detailed implementation plan](control-plane-implementation-plan.md): TCP-I01–08,
   dependencies, changes by component and focused verification/release gates.
4. [Review findings and corrections](control-plane-review.md): independent GPT Astra
   findings and the parent review of actual customer configuration.
5. [Progress and handoff](../../IN_PROGRESS.md): what was actually changed or verified.

## What already exists and what changes

The [standalone DMS plan](../dms/dms_implementation_plan.md#3-product-and-integration-boundaries)
uses “control plane” for the DMS API/coordinator and excludes a management app. Existing
one-time DMS enrollment activates an intended consumer such as Turnstile inside one
customer installation. It does not obtain central Thaarei approval or send fleet reports.

This proposal adds that central approval as an additional product gate. Staff login,
central product credentials, signed deployment approvals and customer-local DMS machine
tokens each have a different role. Customer browsers, workers and storage never receive
central machine credentials or connect directly to the central app.

The owner selected seven-day signed approval with daily renewal on 2026-11-06, with
local verification rather than a central lookup on every business request. Read/recovery
exceptions after expiry or suspension remain proposed. It changes the earlier expectation of full independence from
central services; local customer identity, one-tenant isolation and DMS independence from
Turnstile remain intact. Do not apply the new guard to an existing installation without
coordinated registration, approval and recovery readiness.

## Delivery recommendation

Start by adopting policy and architecture, then build the single Next.js application,
staff access and deployment registry. Complete the machine pairing/approval protocol before
integrating either customer backend. Reuse the separately developed DMS operational
projections when they are ready, add Turnstile's own reporter, and qualify the full chain
with separate customer fixtures before rollout.

This planning work is isolated on feat/thaarei-control-plane-plan. The standalone DMS
branch and installed customer-test stack remain with their existing owner. No DMS source,
credentials, services or data are changed by this proposal.
