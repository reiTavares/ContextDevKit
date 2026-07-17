# How to enable and calibrate Domain Engineering

<!-- GENRE: How-to guide (task-oriented)
     Goal: a maintainer turns on the Domain Engineering capability and advances it
     safely through the rollout stages.
     Rule: one goal per guide; link to reference/explanation for the why. -->

## When to use this guide

You want the deterministic **Domain Engineering** capability (BIZ-0003, ADR-0128) to
fire on real code work — classifying code-mutation intent, requiring the
implementation-engineer on code, and checking domain-model conformance. It ships
**default-OFF**: this guide turns it on and advances it stage by stage.

If you only want to *see* what the classifier decides without changing behaviour, run
`/domain "<objective>"` — it is observation-only and needs nothing enabled.

## Prerequisites

- ContextDevKit installed at **Level 4 or higher** (the capability is inert below L4).
- A recent install (the domain policy tables under `contextkit/policy/domain-engineering/`
  ship with the engine — a fresh install or `--update` lands them).

## What ships, and what stays off

A fresh install distributes everything but activates nothing:

- The three policy table sets (`domain-engineering`, `devteam`, `domain-artifacts`) and
  the six devteam skills (`contextkit/skills/`).
- The two gate hooks — `domain-code-gate.mjs` (PreToolUse) + `domain-conformance.mjs`
  (PostToolUse) — wired at **L≥4** across Claude, Codex and Antigravity, but **inert
  until you opt in** (`domainEngineering.enabled` defaults to `false`) and **fail-open**
  (any error exits 0; a broken gate never blocks your work).
- The eight Class-A architecture-fitness rules are armed (BLOCKING) but emit **zero
  findings** until a project declares a domain map — so the arch-debt gate stays green.

## Steps

1. **See the classification first (no change).** Run the diagnostic on a real
   objective:

   ```bash
   node contextkit/tools/scripts/domain-inspect.mjs "add a field to the checkout aggregate"
   ```

   It prints CMIS (code-mutation intent), DAS (domain applicability), the resolved
   profile, the required agents/skills/artifacts, and the effective mode.

2. **Enable in shadow (records, never blocks).** In `contextkit/config.json`:

   ```json
   {
     "domainEngineering": {
       "enabled": true,
       "enforcement": { "rolloutStage": "shadow" }
     }
   }
   ```

   `rolloutStage` is a CEILING: it can only *lower* the level→mode ladder, never raise
   it. `shadow` holds every level at record-only while you gather calibration evidence.

3. **Advance to advisory** once shadow shows the classifier is not over-firing:
   set `rolloutStage` to `"advisory"` (warn, never block).

4. **Advance to guarded** (deterministic medium/high-risk blocks; trivial passes with a
   receipt) — this is the **human-gated** flip. Set `rolloutStage` to `"guarded"` only
   after advisory calibration is clean. At L5–L6 the ladder already resolves to guarded;
   at L7 the ladder is strict, so leave `rolloutStage` at `"guarded"` to hold the ceiling
   until you are ready for strict.

5. **Roll back any time** — set `rolloutStage` back to `"shadow"`, or
   `enabled: false`. No repository-state repair is needed; the capability is absent-safe.

> **Two independent activation surfaces.** `enabled` / `rolloutStage` govern the
> runtime **gate hooks**. The 8 architecture-fitness rules (in the arch-debt gate) have a
> *separate* kill switch: they are inert because there is **no declared domain map** —
> `evaluateDomainFitness({}) === []`. They emit findings only when a project both declares
> a domain map (via `domainConformance`) AND violates it. So `enabled: false` disarms the
> hooks, but the fitness rules are held inert by the absence of a declared map, not by that
> flag. On a normal install both surfaces are silent.

## The level → mode ladder

| Level | Mode (uncapped) |
|---|---|
| L1–L3 | inert (classify only) |
| L4 | advisory |
| L5–L6 | guarded |
| L7 | strict |

`enforcement.rolloutStage` caps this ladder downward. The guarded/strict fleet flip is
deliberately a human decision.

## Verify

```bash
node contextkit/tools/scripts/domain-inspect.mjs "<objective>" --json
```

The `mode` field reflects your level + `rolloutStage`. With `enabled: false` it is always
`shadow` (zero authority).

## See also

- Reference: `contextkit/memory/decisions/business/ADR-0128-*` (the capability),
  `ADR-0129-*` (adaptive enforcement authority).
- pt-BR mirror: `instrucoes.md` → “Engenharia de Domínio”.
