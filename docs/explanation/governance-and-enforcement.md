# Governance and enforcement

ContextDevKit 4 separates deterministic quality floors from advisory engineering guidance.

Governance exists to help the project preserve quality, state, evidence, and decisions without turning methodology into the permission system.

## Governance starts only when work becomes a mutation

Conversation and read-only exploration do not create governed work.

A confirmed mutation activates intake, existing-work resolution, and the applicable governance surfaces. If the interaction is unclear, ContextDevKit asks one short clarification instead of persisting a guessed task or context.

This keeps the governance engine out of ordinary conversation and investigation.

## One dispatcher per lifecycle event

Each governed host event enters one bounded dispatcher for one of four moments:

1. `prompt-preflight`
2. `write-preflight`
3. `postflight`
4. `completion`

The dispatcher owns deduplication, re-entry protection, time budgets, per-gate timeouts, and circuit breaking.

Internal errors, unavailable optional evidence, and timeouts follow `failurePolicy: continue`. They remain visible as diagnostics but do not fabricate PASS and do not break the user's real work merely because ContextDevKit failed internally.

## Enforcement modes

The canonical modes are:

### `off`

The evaluator is disabled.

### `shadow`

The evaluator observes without changing the execution result.

Privacy/LGPD is shadow by default.

### `canary`

The evaluator reports findings and evidence but cannot deny the action.

Architecture Debt, graph-first, intake guidance, journey, workflow presence, simulation, deliberation, routing, subagent scope, economy, and context loading are canary by default.

### `guarded`

A guarded evaluator may deny only at its documented lifecycle moment and only with a complete deterministic, applicable, evidenced predicate.

## The three default quality floors

Only three domains are guarded by default:

| Quality floor | Blocking moment | Required condition |
| --- | --- | --- |
| `qa-signoff` | completion | a `done` transition has a deterministic QA violation / missing required completion evidence |
| `ddd-invariants` | write-preflight, completion | an applicable declared Class A domain invariant is deterministically violated |
| `technical-debt` | completion | the current diff introduces new high/critical technical debt |

These quality floors exist to stop an AI agent from silently declaring completion while a known deterministic violation remains.

They are not platform sovereignty.

The project owner may configure gate modes and may provide a scoped human override when accepting a guarded condition intentionally.

## Owner sovereignty

The stock governance runtime uses:

```text
humanAuthority: owner-wins
```

A valid owner override records actor, reason, scope, policy version/hash, base revision, timestamp, expiry, and outcome.

An override does **not** rewrite failed evidence into passed evidence. It records that the owner knowingly accepted the condition.

ContextDevKit owner authority also does not bypass real system, platform, or host safety boundaries.

## Architecture Debt vs Technical Debt

Architecture Debt is `canary` by default because architecture analysis is broader and may contain predictive or contextual judgment.

It can surface dependency direction, state ownership, boundary violations, reliability concerns, fragmentation, or other structural risks.

Those findings may become evidence for another decision, but Architecture Debt cannot silently become a fourth guarded gate.

Technical Debt is the guarded completion floor only when the evidence proves **new high/critical debt introduced by the current diff**.

Existing unrelated debt does not block the current change.

## Specialists are not authorization receipts

Model routing, `code-reviewer`, `domain-modeler`, QA specialists, security roles, swarms, councils, and other agents are engineering tools.

Their availability does not grant or deny permission to work.

A material diff can strongly justify a review pass, but the invariant is the review responsibility, not the presence of a named subagent. If delegation is unavailable, the active agent continues and performs the responsibility itself.

## Evidence states stay honest

Evaluators distinguish states such as:

- `passed`;
- `violated`;
- `unknown`;
- `skipped`;
- `error`.

`unknown`, `skipped`, and `error` are never fabricated passes.

They also cannot deny unless one of the three guarded domains receives its complete deterministic predicate.

## Governance in engineering loops

Governance supports the project-level loop:

```text
implement
  ↓
evaluate
  ↓
findings
  ↓
correct
  ↓
re-evaluate
  ↓
fresh evidence
  ↓
done
```

Most evaluators improve this loop by producing evidence. The guarded floors protect specific quality boundaries. Neither should become process for its own sake.

## Core principle

> **Governance should make engineering more reliable without making useful work harder to start.**

See [Evidence-Driven Loop Engineering](loop-engineering.md), [Quality model](quality-model.md), and [Governance contract](../reference/governance-contract.md).
