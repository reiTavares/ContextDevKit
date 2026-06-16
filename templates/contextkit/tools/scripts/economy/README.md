# Economy Runtime (WF0020) — Phase 1

Actuation layer of the token-economy program. These libraries bound **output**,
**tool cost**, **preparation**, and **context lifetime** by governing the
artifacts ContextDevKit already owns — they do **not** control the host main loop
(not possible in Claude Code), so the "lean orchestrator-only loop" is **advisory
+ controller-scoped only**.

Distinct from `../economics/` (the EACP measurement layer, WF0018): this dir is
**actuation** (spend fewer tokens per turn); it *consumes* EACP telemetry to prove
savings before/after, and writes nothing under `economics/`.

Every module here is **zero-hot-path-dep**, **advisory**, **fail-open**, and
**UNREGISTERED** (no boot/hook wiring in Phase 1). Config lives under the
`economy.*` key (flows through the config `.passthrough()` schema);
`economy-defaults.mjs` is the single source of contract defaults.

See `contextkit/memory/workflows/0020-economy-runtime-lean-loop/` (spec.md, ADR-0082..0086).
