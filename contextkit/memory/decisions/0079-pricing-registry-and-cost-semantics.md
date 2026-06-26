# ADR-0079: Pricing registry & cost semantics

- **Status**: Accepted
- **Date**: 2026-06-14
- **Deciders**: ContextDevKit maintainer (accepted 2026-06-26)
- **Context workflow**: [0018-economic-autonomy-control-plane](../workflows/0018-economic-autonomy-control-plane/index.md)
- **Pre-filled by**: [[deliberation: 2026-06-14-04-economic-autonomy-control-plane-scope]]

## Context

The only price data in the repo is a forge artifact
(`squads/agent-forge/router/capability-matrix.json`: fable-5 $10/$50, opus-4-8
$5/$25, sonnet-4-6 $3/$15, haiku-4-5 $1/$5 per MTok) — no provenance, history,
drift detection, currency handling, or TTL-aware cache pricing, and the exported
`model-policy.priceForTier` is never called. Cost must be reproducible offline.
Subscription plans are not API invoices; USD estimates are counterfactual, not
billed amounts. The cardinal hazard: presenting **gross cache value** (a provider
capability) as **kit-incremental savings**.

## Decision

We will introduce a **versioned Pricing Registry** and a precise set of **cost
semantics**:

- **Registry entry**: provider · canonical model id · aliases · `billingMode`
  (`subscription|api`) · **cache-read price + cache-write price by TTL
  (5m/1h) — REQUIRED, not optional** · input/output/reasoning prices · currency ·
  effective date · source · fetched/verified at · confidence · deprecation ·
  context window · capability metadata. Local snapshot; offline; price history;
  drift detection. **Aliases never used as a permanent benchmark reference.**
  Secrets out of repo; private override allowed. No fragile scraping as the sole
  strategy — prefer official APIs / verified manual config / adapters. Refresh
  commands only stamp dates; price/model edits are ADR-gated (constitution §9).
  *(Panel E1: the existing `capability-matrix.json` has only input/output prices
  and is self-labeled "ILLUSTRATIVE" — it cannot be the cost source as-is; the
  registry must add the cache fields with provenance before #234 can compute.)*
- **Inferred prices render `unknown` cost, never a dollar figure** (panel E3):
  any registry entry with `confidence: inferred` (e.g., **fable-5 $10/$50,
  currently unverified + ~30% tokenizer inflation**) makes the cost engine emit
  `unknown` for that model until audited (#239). Skipped-not-passed applied to
  prices. Fable provenance check is pulled forward into #233 (P0).
- **Cost formulas** (canonical):
  - *Actual estimated cost* = Σ `bucket × bucket_price` over model/provider/bucket
    — cache-write **priced at its real TTL multiplier (≈1.25× 5m / 2× 1h input),
    not 1×** (panel E1); cache-read at its real (≈0.1×) price.
  - *Estimated no-cache cost* — **open modeling decision, must be pinned by a
    fixture before #234 ships** (panel E2). Two candidate counterfactuals:
    (a) `(freshInput + cacheRead) × input_price + output × output_price` (cache
    never written in a no-cache world); (b) `(freshInput + cacheRead + cacheWrite)
    × input_price + output × output_price` (cache-write = the first-time send).
    Whichever is chosen is documented + tested; the result is **gross cache
    value, not kit contribution.**
  - *Primary unit* = **quota for `subscription` hosts**; USD shown as a labeled
    "estimated API-equivalent, not billed" amount (panel E4). The engine refuses
    to lead with USD when `billingMode = subscription`.
  - *Gross cache value* = `no_cache_cost − actual_cost`.
  - *Model-routing savings* = `baseline_cost − routed_cost`, **only at
    equivalent quality**.
  - *Cost per completed / per QA-green task*; *correct-task cost* (incl. retries,
    reopens, rework, review, rollback, subagents, test runs).
  - *Avoided rework value* — counted as events; monetized only with a consented
    hourly rate.
- **Currency**: USD canonical; presentation currency configurable; FX snapshot
  with timestamp + source; report can always show original USD.
- **Fable-5 audit** is a deliverable: confirm what it is, its real price table,
  who/why selects it, its QA rate, alternatives.

## Consequences

- **Positive**: reproducible offline cost; provenance + drift guard against
  silent price changes; honest separation of cache value from incremental
  savings; finally wires `priceForTier`.
- **Negative / trade-offs**: maintaining a registry is ongoing; estimates remain
  estimates (not invoices); TTL-aware cache pricing adds modeling complexity.
- **Follow-ups**: registry schema + snapshot + `doctor`; cost engine consuming
  ADR-0078 events; integrate with model-routing-economics follow-up (ADR-0077).
  Proposed pending human review; no code in WF0018.
