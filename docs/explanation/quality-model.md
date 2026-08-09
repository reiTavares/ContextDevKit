# Quality model

<!-- GENRE: Explanation (understanding-oriented) -->

ContextDevKit 4 separates observations from authority. A useful warning may be
heuristic; a denial must be deterministic, applicable, evidenced, current, and
inside the central blocking allowlist.

## Three guarded domains

Only three domains can deny by default:

1. **QA sign-off** protects only the transition to `done`. It consumes real
   runner/test evidence and never blocks implementation start.
2. **DDD invariants** protect explicit Class A business invariants at
   write-preflight and completion. A classifier opinion or inferred domain shape
   is not sufficient evidence.
3. **Technical debt** protects completion from new high or critical debt
   introduced by the current diff. Existing debt elsewhere is not a reason to
   block unrelated work.

Every denial supports a simple, scoped owner override. The override records the
decision; it does not pretend the evidence passed.

## Architecture is broader than file size

File size is a prompt to investigate, never a quality verdict. A large cohesive
module can be healthy; a small module can mix authorities, leak layers, or hide
an irreversible failure mode. Artificial fragmentation is also debt when it
adds wrappers and navigation without protecting a real boundary.

Review architecture across responsibilities, state ownership, dependency
direction, public contracts, security, reliability, testability, operations,
and rollback. Split only for a real reason for change or boundary. Merge only
when important boundaries remain protected.

Architecture-debt analysis is canary. It may produce evidence that a dedicated
technical-debt evaluator later classifies, but it cannot silently become a
fourth guarded gate.

## Evidence states

- `passed`: verified evidence satisfies the check;
- `violated`: verified evidence demonstrates a violation;
- `unknown`: required evidence is unavailable or cannot be interpreted;
- `skipped`: the check is not applicable or an optional provider is absent;
- `error`: the evaluator failed internally.

`unknown`, `skipped`, and `error` are never fabricated passes. They also do not
deny unless an allowlisted domain receives its complete deterministic predicate,
which those states do not provide. Internal runtime failure follows `continue`
and remains visible in diagnostics.

## Current-diff ratchet

Technical-debt enforcement is a ratchet, not an absolute cleanliness score. A
finding blocks only when the current diff introduces new high/critical debt.
Paying down debt is recorded positively; pre-existing findings remain visible
without preventing unrelated completion.

The same principle applies to contracts and state: there must be one current
authority, and derived projections are repairable output. A second writer is a
real architecture defect because it makes correctness unknowable.

## Related

- [Governance contract](../reference/governance-contract.md)
- [Architecture](../ARCHITECTURE.md)
- [Audit and test](../how-to/audit-and-test.md)
- [Configuration](../reference/config.md)
