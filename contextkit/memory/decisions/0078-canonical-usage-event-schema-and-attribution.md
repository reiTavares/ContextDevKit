# ADR-0078: Canonical usage event schema, attribution semantics & multi-host adapters

- **Status**: Accepted
- **Date**: 2026-06-14
- **Deciders**: ContextDevKit maintainer (accepted 2026-06-26)
- **Context workflow**: [0018-economic-autonomy-control-plane](../workflows/0018-economic-autonomy-control-plane/index.md)
- **Pre-filled by**: [[deliberation: 2026-06-14-04-economic-autonomy-control-plane-scope]]

## Context

Cost and autonomy claims are only as good as the underlying measurement. Today's
attribution is **inclusive** (all context in a turn), reads only Claude Code
transcripts, and carries no confidence or delta/cumulative semantics. The §6 CRM
baseline shows the concrete hazard of summing cumulative totals as deltas, and of
calling `dev-start`/`log-session` "expensive" when they merely occurred inside
already-large sessions. Multiple hosts (Claude Code, Codex, Antigravity, Cursor,
OpenCode) and gateways (direct, OpenRouter, local) expose usage differently and
must not be forced into false parity. This builds on WF0017 card #226 (usage
event spike) and ADR-0044 (token attribution).

## Decision

We will define a **canonical usage event** as the single normalized record for
all economic computation, and a **five-lens attribution model**, each carrying a
**confidence tier**:

- **Event fields** (full dictionary in WF0018 measurement-dictionary.md):
  `schemaVersion, host, provider, sessionId, runId?, taskId?, phase?,
  modelRequested, modelEffective, fallbackUsed, agentScope(main|subagent),
  attributionSkill?, buckets{freshInput,output,cacheRead,cacheWrite,reasoning?},
  bucketMode(delta|cumulative), ts, confidence, source{adapter,raw_ref?}`.
- **Buckets close mathematically**: `total = freshInput + output + cacheRead +
  cacheWrite + (reasoning|0)`. Throughput is never auto-labeled spend.
  `cacheWrite` carries a **TTL breakdown** (`{total, ttl5m?, ttl1h?}`) when the
  host exposes it (Claude Code emits `usage.cache_creation.ephemeral_5m/1h`),
  degrading to flat + `derived` confidence otherwise — pricing needs the split
  (panel A2/E1).
- **Adapter-derived fields default `unknown`** (panel A2): real Claude Code
  transcript lines carry only `message.usage`, `message.model`, `isSidechain`,
  `attributionSkill`, `cwd`, `sessionId`, `timestamp`. So `provider` = inferred
  from model-id prefix (`anthropic`); `runId/taskId` = correlated from the
  `state-io` event substrate, **not** the transcript; `phase` = `unknown` unless
  a session-log boundary is crossed; `modelEffective = modelRequested =
  message.model` and `fallbackUsed = false` (Claude Code cannot observe a
  fallback). The 5-lens claim is honest only with these confidence defaults.
- **Delta vs cumulative** is declared per adapter and normalized to delta before
  any aggregation.
- **Attribution lenses**: exclusive, inclusive, phase, agent, model/provider —
  each annotated `direct|derived|inferred|unknown`. Exclusive attribution must
  isolate a command's own tokens before any "X is expensive" statement.
- **Adapters declare** their capabilities (buckets, delta/cumulative,
  requested/effective model, provider, cache semantics, session/run id, quota
  availability, confidence, limitations). Missing data is reported as such — no
  faked parity. Core stays provider-agnostic; no OpenRouter dependency.

## Consequences

- **Positive**: reproducible, auditable measurement; honest confidence;
  multi-host without lock-in; fixes the cumulative-summing and inclusive-blame
  hazards; foundation for cost/pressure/autonomy/benchmark.
- **Negative / trade-offs**: exclusive attribution is harder and sometimes only
  `derived`; metadata-only (ADR-0081) makes some lenses coarser; per-host adapter
  work is ongoing.
- **Follow-ups**: implement adapters host-by-host; extend
  `token-attribution.mjs` with exclusive/phase lenses + confidence; fixtures that
  reproduce §6/§7 baseline shapes. Proposed pending human review; no code in WF0018.
