# Configure capability levels

ContextDevKit 4 has capability levels, not autonomy grades. A level controls
which local surfaces are installed; it never grants consent, requires a model,
or decides who may press the button.

```text
node cdx.mjs context-level
node cdx.mjs context-level <1-7>
```

Use `context-config` to set gate modes (`off`, `shadow`, `canary`, `guarded`)
and advisory preferences. The current owner instruction remains the authority.

Only QA at `done`, an applicable DDD Class A invariant, and new deterministic
high/critical debt introduced by the current diff can deny when guarded. Model
routing, agents, swarms, graph-first, simulations, councils, and LGPD review are
recommendations or shadow observations.
