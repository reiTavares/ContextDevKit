# Runtime data posture

This table describes the stock 4.0 hot path.

| Surface | Reads | Writes | Network | Failure posture |
| --- | --- | --- | --- | --- |
| `governance-session-context.mjs` | config, current memory/workflow summaries | none | none | continue with explicit diagnostic |
| `governance-prompt-preflight.mjs` | prompt payload, resolved gate plan | none | none | canary/continue on resolver failure |
| `governance-write-preflight.mjs` | write payload, workflow context, gate observations | none | none | only an applicable guarded gate may deny |
| `governance-postflight.mjs` | post-tool observation | none | none | continue on internal failure |
| `governance-completion.mjs` | completion observation | none | none | QA done, DDD Class A, or new high/critical debt may deny when guarded |
| statusline/dashboard/MCP readers | canonical JSON authorities | none | none | unavailable/partial/corrupt is explicit |

The runtime does not fetch Git remotes, write counters, append an edit ledger,
infer a writable global task store, or fall back to physical lanes.

Mutator CLIs are separate from hooks. They require an explicit scope, validate
before I/O, and use CAS plus atomic replacement. Migration is available only
through the explicit v3-to-v4 tool and is not imported by normal entry points.
