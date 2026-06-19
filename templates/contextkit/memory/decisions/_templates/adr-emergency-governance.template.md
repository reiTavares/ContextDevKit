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
decisionKind: EMERGENCY_GOVERNANCE
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

Defines the **emergency path**: when an incident demands action faster than a
fresh decision can be obtained, the responder may act first under a standing,
pre-authorized envelope and RECORD the decision immediately after (act-then-record).
The recorded decision references this ADR as its emergency authority.

## Emergency envelope

_EMPTY by default. The allowed emergency actions are derived from existing standing
policy, NOT invented as a new bypass — adding an envelope entry is a human-approved
ADR act (constitution §9). Each entry records: trigger condition, allowed action(s),
the standing policy it derives from, and the mandatory post-hoc recording step._

| Trigger | Allowed action(s) | Derives from | Post-hoc record |
|---|---|---|---|
| _(none registered)_ | — | — | — |

## Decision authority

- Primary context: {{PRIMARY_CONTEXT_ID}} (platform)
- Approval source: {{APPROVAL_ID}} revision {{APPROVAL_REVISION}}, decisionHash `{{DECISION_HASH}}`
- Status: {{STATUS}}. Acceptance stays manual; the emergency path is a recording
  discipline, not a new autonomy gate.

## Scope

### Applies to
Incidents matching a registered emergency envelope entry.

### Does not apply to
Any action outside a registered envelope (→ obtain a decision normally), and all
legacy artifacts (unchanged).

## Constraints and invariants

- Every emergency action MUST be recorded immediately after the fact.
- An action with no matching envelope entry is NOT pre-authorized.
- No new autonomy gate is introduced.

## Verification

A post-hoc decision record referencing this ADR exists for each emergency action.

## Supersession conditions

Superseded by a future ADR that redefines the emergency-governance mechanism,
recorded with explicit supersession links and a human decision.
