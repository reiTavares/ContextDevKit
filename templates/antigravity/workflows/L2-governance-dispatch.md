# L2 — mutation-only governance dispatch

L2 adds four consolidated event entrypoints:

- prompt preflight;
- write preflight;
- postflight;
- completion.

Conversation and exploration are no-ops. A definite mutation request or a real
write attempt activates governance once. Gate modes come from the central registry;
only guarded, deterministic invariants in its deny allowlist may refuse an action.
Internal errors remain visible diagnostics and fail open.

The anti-loop runtime is bounded by deduplication, time budget, cancellation, and a
circuit breaker. It creates transient state only after mutation is established.
