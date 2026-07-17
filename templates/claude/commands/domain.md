---
description: Domain Engineering diagnostic — shows what the classifier decides for an objective (CMIS/DAS/profile/skills/mode). Observation-only; never mutates or blocks.
argument-hint: "\"<objective>\" [--json]"
allowed-tools: Bash(node:*)
---

`/domain` is an **observation-only** diagnostic (ADR-0128 §27). It prints what the
Domain Engineering classifier decides for an objective — **it changes nothing**: no
write, no gate, no state mutation. Normal activation never needs it; the hooks +
classifier fire by deterministic signal. Use `/domain` when calibrating the rollout
to *see* the decision the gate would make.

## When to use

- **Calibrating the rollout** — inspect CMIS/DAS/profile/mode for real objectives
  before advancing `enforcement.rolloutStage`.
- **Debugging a classification** — confirm why a request did (or didn't) require the
  implementation-engineer, an Implementation Packet, or a simulate-impact receipt.
- **Never for normal work** — activation is by signal, not by remembering this command.

## What it shows

- **CMIS** — code-mutation intent score + verdict (ask/code/structural).
- **DAS** — domain applicability score.
- **profile** — the resolved implementation profile (no-code / modular / domain-driven
  / distributed-domain).
- **required agents / skills / artifacts** — the proportional squad + skill fan-out.
- **effective mode** — the enforcement mode for THIS project's level + config
  (default-OFF ⇒ `shadow`, zero authority, until `domainEngineering.enabled`).

## Commands

Human-readable:

```bash
node contextkit/tools/scripts/domain-inspect.mjs "<objective>"
```

Machine-readable:

```bash
node contextkit/tools/scripts/domain-inspect.mjs "<objective>" --json
```

## Integration

`/domain` reuses the SAME pure `buildImplementationBlock` (§15) the lifecycle + gates
read, and the SAME `resolveDomainMode` ladder the code gate uses — zero new
classification logic (reuse-over-rebuild). The implementation profile IS a field of
this one block, so there is no separate `/implementation` command — it is folded
here (constitution §9: no command without a distinct consumer).

## Other hosts

From **Claude Code** use this slash command (host-neutral CLI:
`node contextkit/tools/scripts/domain-inspect.mjs "<objective>"`) — **never `ctx`/`cdx`**.
Antigravity/Codex users invoke the same script via `node ctx.mjs` / `node cdx.mjs`.
