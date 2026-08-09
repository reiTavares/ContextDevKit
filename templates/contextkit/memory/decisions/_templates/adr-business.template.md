---
schemaVersion: 2
id: {{ID}}
title: {{TITLE}}
status: {{STATUS}}
contextType: business
primaryContext:
  type: business
  id: {{PRIMARY_CONTEXT_ID}}
relatedContexts: []
decisionKind: {{DECISION_KIND}}
decisionScope: {{DECISION_SCOPE}}
valueIntents:
  primary: {{VALUE_INTENT_PRIMARY}}
  secondary: []
product:
  productId: {{PRODUCT_ID}}
  area: {{PRODUCT_AREA}}
  capability: {{PRODUCT_CAPABILITY}}
approvalSource:
  type: business
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

_State the decision in one or two sentences._

## Decision authority

- Primary context: {{PRIMARY_CONTEXT_ID}} (business)
- Approval source: {{APPROVAL_ID}} revision {{APPROVAL_REVISION}}, decisionHash `{{DECISION_HASH}}`
- Status: {{STATUS}} (mirrors the approved Business — no second approval ceremony).

## Scope

### Applies to
_What this decision governs._

### Does not apply to
_Explicit exclusions; legacy artifacts remain unchanged._

## Context references

_Link the Business package, workflows, and prior decisions this refines/relates to._

## Decision drivers

_Why now; the value intent(s) this serves._

## Alternatives considered

_Options weighed and why they were rejected._

## Consequences

### Positive
_What improves._

### Negative
_What it costs._

### Trade-offs
_The balance struck._

## Constraints and invariants

_Hard limits this decision must preserve._

## Verification

_How adherence is checked (tests, gates, evidence)._

## Supersession conditions

_What would have to change for a future ADR to supersede this one._
