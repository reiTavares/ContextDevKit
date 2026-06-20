/**
 * Raw skeleton strings for Business work-context documents (BIZ-0001 / WF-0036 A3-T1).
 *
 * Single-responsibility split from `business-templates.mjs`: this module owns
 * the verbatim Markdown skeleton text; the builder module owns the API surface
 * (`buildBusinessPrompt`, `buildBusinessJson`, `BUSINESS_PROMPT_KINDS`).
 *
 * Splitting is justified because the skeleton strings form a distinct, cohesive
 * concern (authoring content) separate from the public builder API — and keeping
 * them together would push `business-templates.mjs` past the 308-line hard limit.
 *
 * Zero runtime dependencies. Pure data — no logic, no I/O.
 */

/**
 * Skeleton for `business-case.md`.  Every placeholder is wrapped in `[FILL: …]`
 * to signal where human or agent input is required — never a plausible-sounding
 * invented value.  One managed-block seam is included for the renderer.
 */
export const BUSINESS_CASE_TEMPLATE = `# Business Case — [FILL: BIZ-####] — [FILL: Title]

> **Status: [FILL: draft | proposed | approved]** [FILL: YYYY-MM-DD].
> [FILL: one-line subtitle describing the initiative.]

<!-- contextdevkit:generated:business-summary:start -->
_Business summary generated here — do not edit between the markers._
<!-- contextdevkit:generated:business-summary:end -->

## Executive summary

_[FILL: 2–4 sentences. What changes, for whom, and why now?]_

## Business kind

\`[FILL: TRANSFORMATION | INITIATIVE | PROGRAMME | FEATURE | ENABLER]\`
(strategic facet \`[FILL: PLATFORM_CAPABILITY | MARKET | COMPLIANCE | …]\`).
_[FILL: One sentence justifying the kind choice.]_

## Problem or opportunity

_[FILL: What pain or opportunity drives this? Who is affected? What is the cost
of inaction?]_

## Product or organizational context

_[FILL: Stack, architecture constraints, existing seams this reuses vs. rebuilds.
Reference the shared-entity-contracts and source-of-truth-policy where relevant.]_

## Target users or beneficiaries

- _[FILL: Segment 1 — need/pain + expected behavior change]_
- _[FILL: Segment 2 — need/pain + expected behavior change]_

## Value proposition

### Customer or beneficiary value
_[FILL: concrete value delivered to the direct users.]_

### Product value
_[FILL: how this strengthens the product/platform.]_

### Organizational value
_[FILL: governance, quality, velocity, or strategic positioning impact.]_

### Financial value
_[FILL: cost avoided, revenue unlocked, or ROI estimate — or "not applicable"
with a brief reason. Never invent numbers; use 'unknown' or 'to-be-estimated'.]_

## Constraints and dependencies

- _[FILL: key constraint or dependency 1]_
- _[FILL: key constraint or dependency 2]_

## Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| _[FILL]_ | _[FILL]_ | _[FILL]_ | _[FILL]_ |

## Out of scope (explicit)

_[FILL: what this Business deliberately does NOT cover, to prevent scope creep.]_

## Success criteria

_[FILL: observable, falsifiable conditions that confirm this Business succeeded.
Numeric where possible; tied to the KPI tree in growth.md.]_
`;

/**
 * Skeleton for `growth.md`.  Mirrors the BIZ-0001 `growth.md` structure but
 * with placeholders instead of content (spec §10.4).
 */
export const GROWTH_TEMPLATE = `# Growth & Value Realization — [FILL: BIZ-####] — [FILL: Title]

> **Status: [FILL: draft | approved]** [FILL: YYYY-MM-DD].

## Growth thesis

_[FILL: Complete the causal chain —_
_If we deliver [FILL: capability/outcome], then [FILL: target beneficiary] will_
_[FILL: behavior change], producing [FILL: measurable result], which contributes_
_to the strategic outcome of [FILL: strategic goal].]_

## Primary value-realization lever

**[FILL: STRATEGIC_ENABLEMENT | OPERATIONAL_EFFICIENCY | QUALITY | COST_EFFICIENCY
| RELIABILITY | ADOPTION | other]** — _[FILL: one sentence: mechanism + evidence]_

## Secondary levers

| Lever | Expected mechanism | Evidence | Confidence |
|---|---|---|---|
| _[FILL]_ | _[FILL]_ | _[FILL]_ | _[FILL: low/medium/high]_ |

## Target segments or beneficiaries

| Segment | Need or pain | Expected behavior change | Expected value |
|---|---|---|---|
| _[FILL]_ | _[FILL]_ | _[FILL]_ | _[FILL]_ |

## Value-realization chain

_[FILL: Delivery → intermediate outcome → behavior change → business value.
Keep to 2–3 steps; longer chains are harder to falsify.]_

## North Star metric

- Metric: **[FILL: name]**
- Definition: _[FILL: numerator ÷ denominator or event counted]_
- Unit: _[FILL]_
- Source: _[FILL: system/log/test that emits this signal]_
- Baseline: \`[FILL: measured value with unit, or 'unknown' if not yet measured]\`
- Target: \`[FILL: number+unit, or 'to-be-defined' if baseline unknown]\`
- Time horizon: _[FILL]_
- Confidence: _[FILL: low/medium/high + brief rationale]_

## KPI tree

### Final outcomes

| KPI | Definition | Baseline | Target | Source | Horizon |
|---|---|---:|---:|---|---|
| _[FILL: KPI name]_ | _[FILL]_ | _[FILL: number or 'unknown']_ | _[FILL: number+unit]_ | _[FILL]_ | _[FILL]_ |

### Leading indicators

| KPI | Why it predicts value | Baseline | Target | Source |
|---|---|---:|---:|---|
| _[FILL: KPI name]_ | _[FILL]_ | _[FILL: number or 'unknown']_ | _[FILL: number+unit]_ | _[FILL]_ |

### Operational or engineering enablers

| KPI | Relationship to value | Baseline | Target | Source |
|---|---|---:|---:|---|
| _[FILL: KPI name]_ | _[FILL]_ | _[FILL: number or 'unknown']_ | _[FILL: number+unit]_ | _[FILL]_ |

### Guardrails and counter-metrics

| KPI | Harm prevented | Accepted boundary | Source |
|---|---|---:|---|
| _[FILL: KPI name]_ | _[FILL]_ | _[FILL: number+unit or 0]_ | _[FILL]_ |

## Growth or value hypotheses

| Hypothesis | Expected effect | Metric | Confidence | Validation |
|---|---|---|---|---|
| _[FILL]_ | _[FILL]_ | _[FILL]_ | _[FILL]_ | _[FILL]_ |

## Experiments or validation

_[FILL: What experiments or measurements will falsify/confirm the hypotheses?
No live A/B unless the population is large enough. For dogfood/single-maintainer
projects: fixture tests + self-use are valid evidence; name them explicitly.]_

## Measurement plan

_[FILL: When and how will baselines be measured? Who collects them? Where are
they stored? Note: targets should be set AFTER baselines are measured — never
invented. Use 'unknown' for any baseline not yet measured.]_

## Attribution and limitations

_[FILL: Single-maintainer? Dogfood-only? No revenue attribution? State the
constraints so claims are honest. A claim is null until evidence exists.]_

## Review cadence

_[FILL: how often growth data is reviewed and by whom.]_
`;

/**
 * Skeleton for `investment-decision.md`.  Forces explicit option enumeration
 * so the responsible decision-maker cannot skip the trade-off analysis.
 */
export const INVESTMENT_DECISION_TEMPLATE = `# Investment Decision — [FILL: BIZ-####] — [FILL: Title]

> **Status: [FILL: draft | proposed | approved | deferred | rejected]** [FILL: YYYY-MM-DD].
> Governing decision: [FILL: ADR-#### or 'none yet']

## Decision summary

- **Recommendation:** _[FILL: proceed-option-A | defer | reject | proceed-with-conditions]_
- **Actor:** _[FILL: human | committee | automated — who approved this]_
- **Approved at:** _[FILL: YYYY-MM-DD or 'pending']_
- **Effort estimate p50:** _[FILL: hours/days/points or 'unknown']_
- **Effort estimate p80:** _[FILL: hours/days/points or 'unknown']_
- **Forecast source:** _[FILL: system / manual-estimate / none]_

## Options evaluated

### Option A — _[FILL: short label]_

_[FILL: Describe the option. What is built, in what scope, with what approach?]_

**Pros:**
- _[FILL]_

**Cons:**
- _[FILL]_

**Cost/effort estimate:** _[FILL: number+unit or 'unknown']_

### Option B — _[FILL: short label]_

_[FILL: Describe the alternative or do-nothing option.]_

**Pros:**
- _[FILL]_

**Cons:**
- _[FILL]_

**Cost/effort estimate:** _[FILL: number+unit or 'unknown']_

## Decision rationale

_[FILL: Why was Option [A/B/…] chosen over the alternatives? Reference the value
thesis (growth.md), constraints (business-case.md §Constraints), and any
cost/risk/timeline trade-offs. Every assertion should be traceable to evidence
or flagged as a hypothesis.]_

## Conditions and gates

_[FILL: What conditions must be met before the investment is released? Reference
the Workflow gates (workflow-plan.json) and any external dependencies.]_

## Investment review trigger

_[FILL: Under what circumstances is this decision revisited? E.g. "if p50 is
exceeded by > 50%" or "if North Star metric does not move after Wave 2".]_
`;
