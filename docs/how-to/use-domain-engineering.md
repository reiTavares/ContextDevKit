# Use domain-engineering guidance

Domain Engineering is an advisory lens. Run:

```text
node contextkit/tools/scripts/domain-inspect.mjs "<objective>"
```

The command reports code-mutation intent, domain applicability, an implementation
shape, suggested agents/skills, and optional artifacts. It writes nothing and
cannot deny work.

Use a domain map when the change carries real business invariants, boundaries,
state authority, or transactional rules. Skip it for simple CRUD, a localized
bug, docs, or a small refactor with no domain ambiguity.

Only an applicable deterministic DDD Class A invariant may become one of the
three guarded domains. Missing specialists, artifacts, packets, graph data, or
recommendation telemetry are never a Class A violation.
