# Governance and enforcement

ContextDevKit 4 separates deterministic safety checks from advisory engineering
guidance.

Each lifecycle event starts one dispatcher. The dispatcher resolves a central
gate plan with modes `off`, `shadow`, `canary`, or `guarded`. Missing config,
internal errors, timeouts, unknown observations, and optional context degrade to
canary/continue; hooks never break real work because the governance engine failed.

Only three domains may deny, and only when the gate is both applicable and
guarded:

1. deterministic QA evidence for a transition to `done`;
2. a proven DDD Class A invariant violation;
3. new deterministic high/critical technical debt introduced by the current diff.

Graph results, model routing, specialist selection, economy hints, simulations,
councils, autonomy preferences, and LGPD observations are advisory or shadow.
They cannot become hidden prerequisites.

A human override is explicit data: actor, reason, timestamp, scope, and risk
acknowledgement. It is distinguishable from evidence and never fabricated by
automation.
