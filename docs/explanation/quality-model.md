# Quality model

ContextDevKit 4 separates observations from authority. A useful warning may be heuristic; a denial must be deterministic, applicable, evidenced, current, and inside the central blocking allowlist.

Quality is therefore evaluated in layers rather than collapsed into one score.

## Three guarded quality floors

Only three domains can deny by default:

1. **QA sign-off** protects completion. It consumes real runner/test evidence and never blocks implementation start.
2. **DDD invariants** protect explicit, applicable Class A business invariants at write-preflight and completion. A classifier opinion or an auto-inferred domain shape is not sufficient evidence.
3. **Technical debt** protects completion from new high or critical debt introduced by the current diff. Existing debt elsewhere is not a reason to block unrelated work.

Every guarded denial supports a scoped owner override. The override records the decision; it does not pretend the evidence passed.

## Architecture Debt is canary

Architecture quality is broader than a deterministic completion predicate.

Architecture Debt analysis can inspect responsibilities, state ownership, dependency direction, public contracts, security, reliability, testability, operations, rollback, cohesion, and fragmentation.

It is **canary by default**.

That means it can:

- report structural findings;
- rank concerns;
- produce evidence;
- inform the active agent or a specialist review;
- contribute evidence that a later Technical Debt evaluation may classify.

It cannot silently become a fourth guarded domain.

A structural observation only reaches the guarded Technical Debt floor when the current diff deterministically introduces new high/critical debt under that domain's predicate.

## Lean code is not terse code

ContextDevKit treats unnecessary complexity as an engineering concern without turning simplistic metrics into blockers.

Useful lean-code observations include:

- speculative abstractions with no second real consumer;
- pass-through layers that add a hop without protecting a boundary;
- dead or unreachable code;
- finished feature flags;
- duplicated business rules;
- premature optimization without a measured hot path;
- artificial fragmentation that increases navigation without increasing clarity.

The goal is the smallest structure that preserves real behavior and boundaries.

Names, boundary validation, tests, explicit error handling, and useful comments are not waste merely because they add lines.

## File size is an investigation signal

File length is never a quality verdict by itself.

A large cohesive module can be healthy. A small module can mix state authorities, cross boundaries, or hide a dangerous failure mode. Splitting a file only to satisfy a number can create new debt.

File-size bands therefore remain advisory investigation signals.

## Code review is an engineering responsibility

A material diff should receive a review pass for structure, naming, dependency direction, SRP, state ownership, waste, error handling, and relevant project decisions.

When a host can delegate, `code-reviewer` is the specialized review tool and is an explicit stage in the full `/ship` pipeline.

Outside that pipeline, agent routing remains advisory. If the specialist is unavailable, the active agent performs the review responsibility itself.

The subagent is not the quality evidence. The review findings and resulting code are.

## Evidence states

Evaluators distinguish:

- `passed`: verified evidence satisfies the check;
- `violated`: verified evidence demonstrates a violation;
- `unknown`: required evidence is unavailable or cannot be interpreted;
- `skipped`: the check is not applicable or an optional provider is absent;
- `error`: the evaluator failed internally.

`unknown`, `skipped`, and `error` are never fabricated passes.

They also do not deny unless an allowlisted guarded domain receives its complete deterministic predicate.

Internal runtime failure follows `continue` and remains visible in diagnostics.

## Current-diff ratchet

Technical-debt enforcement is a ratchet, not an absolute cleanliness score.

A finding blocks only when the current diff introduces new high/critical debt under the guarded predicate.

Paying down debt is recorded positively. Pre-existing findings remain visible without preventing unrelated completion.

The same principle applies to state and contracts: one current authority is healthier than parallel writers whose truth cannot be reconciled.

## Fresh evidence after correction

Evidence belongs to the implementation revision/cycle it evaluated.

When QA rejects a task from `testing` or `done`, the new backlog cycle clears stale current-cycle evidence before the task returns through implementation and testing.

Historical events remain as audit history, but an old PASS cannot automatically approve the corrected implementation.

This is the evidence discipline behind ContextDevKit's engineering loops.

## Adaptive depth

Not every quality dimension needs to run on every change.

The active agent selects relevant evaluation depth from complexity, risk, blast radius, contracts, domain weight, critical paths, and the owner's requested outcome.

The three guarded floors remain the default quality boundary; additional canary or specialist evaluations deepen confidence when the work justifies them.

## Related

- [Evidence-Driven Loop Engineering](loop-engineering.md)
- [Governance and enforcement](governance-and-enforcement.md)
- [Architecture](../ARCHITECTURE.md)
- [Audit and test](../how-to/audit-and-test.md)
- [Configuration](../reference/config.md)
