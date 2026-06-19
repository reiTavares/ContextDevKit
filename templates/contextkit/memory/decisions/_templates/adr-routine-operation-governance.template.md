---
schemaVersion: 2
id: {{ID}}
title: {{TITLE}}
status: {{STATUS}}
contextType: platform
primaryContext:
  type: platform
  id: {{PRIMARY_CONTEXT_ID}}
relatedContexts: []
decisionKind: ROUTINE_OPERATION_GOVERNANCE
decisionScope: operation
valueIntents:
  primary: {{VALUE_INTENT_PRIMARY}}
  secondary: []
product:
  productId: {{PRODUCT_ID}}
  area: {{PRODUCT_AREA}}
  capability: {{PRODUCT_CAPABILITY}}
approvalSource:
  type: platform
  id: {{APPROVAL_ID}}
  revision: {{APPROVAL_REVISION}}
  decisionHash: {{DECISION_HASH}}
  approvedAt: {{APPROVED_AT}}
  actor: human
governs:
  workflows: []
  operations: []
  business: []
supersedes: []
supersededBy: null
tags: []
createdAt: {{CREATED_AT}}
acceptedAt: {{ACCEPTED_AT}}
updatedAt: {{UPDATED_AT}}
---

# {{ID}} — {{TITLE}}

## Decision

This standing decision pre-authorizes a defined class of **routine, low-materiality
operations** so each instance needs no fresh ADR: a routine Operation whose kind
and scope fall inside the registered routine-class set below is covered by this ADR
(coverage mode `ROUTINE_COVERED`) instead of triggering `NEEDS_DECISION`.

## Routine-class registry

_EMPTY by default. Each routine class is added by an explicit developer decision —
adding or widening a class is itself an ADR act (constitution §9); it is reviewable
policy, never invented here. A class entry records: name, Operation kind(s),
materiality ceiling, allowed execution mode(s), and the standing constraints that
keep it routine._

| Routine class | Operation kind(s) | Materiality ceiling | Execution mode(s) | Standing constraints |
|---|---|---|---|---|
| _(none registered)_ | — | — | — | — |

## Decision authority

- Primary context: {{PRIMARY_CONTEXT_ID}} (platform)
- Approval source: {{APPROVAL_ID}} revision {{APPROVAL_REVISION}}, decisionHash `{{DECISION_HASH}}`
- Status: {{STATUS}}. Acceptance stays manual (rides the existing autonomy floor — no new gate).

## Scope

### Applies to
Operations matching a registered routine class. Coverage is granted by THIS ADR; no
per-instance ADR is required while the instance stays inside the class envelope.

### Does not apply to
Any operation outside a registered class (→ `NEEDS_DECISION`), material decisions,
emergency actions, and all legacy artifacts (unchanged).

## Constraints and invariants

- An instance that exceeds its class's materiality ceiling or execution-mode set is
  NOT routine-covered and must obtain its own decision.
- Adding/removing/widening a routine class requires a human-approved ADR revision.
- No new autonomy gate is introduced.

## Verification

Decision-coverage checks (B3) resolve a routine instance to `ROUTINE_COVERED` only
when it matches a registered class; otherwise `NEEDS_DECISION`.

## Supersession conditions

Superseded by a future ADR that redefines the routine-governance mechanism or the
coverage model, recorded with explicit supersession links and a human decision.
