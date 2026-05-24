# L5 — Proactive engineering layer

> Level 5. Solves: **"How do we turn 'architecture before syntax' from a posture
> into executable mechanism — anticipating blast radius and instrumenting code
> health as versioned artifacts?"**

## The problem

L1–L4 give context, drift detection, multi-session coordination, and a squad. But
three frictions remain:
1. **High-blast-radius changes land silently** — no pre-flight analysis.
2. **The constitution is audited manually and the result vanishes in the chat** — no
   persistent artifact, so debt grows unseen.
3. **The system generates memory faster than it distills it** — ledgers and session
   files accumulate; the boot payload inflates.

## Components

### 1. `/simulate-impact <objective>` — parallel fan-out to the squad

An architectural pre-flight before cross-domain features. It fans `Agent()` out to
the squad in parallel and aggregates a **Blast Radius Report** shown before any edit.
It persists a file in `vibekit/memory/predictions/` and marks the ledger via
`mark-simulation.mjs`. Playbook: [`playbooks/simulate-impact.md`](playbooks/simulate-impact.md).

### 2. `/tech-debt-sweep [profile]` — audit as a versioned artifact

Runs deterministic detectors against the constitution (file-size budget, "And/Or"
naming, orphan JSDoc, framework state loops) and writes a board under
`vibekit/memory/`. Profiles are config-driven. CLI: `node
vibekit/tools/scripts/tech-debt-scan.mjs`. Playbook:
[`playbooks/tech-debt-sweep.md`](playbooks/tech-debt-sweep.md).

### 3. Contract-drift gate — shift-left on breaking changes

`/contract-check` (`contract-scan.mjs`) compares the public surface declared by
`contractGlobs` (config) between HEAD and the baseline, flagging removed/renamed
exports without a `BREAKING CHANGE:` footer. Wire it as a CI job to fail the build.

### 4. PreToolUse gate + staged auto-distill

- **PreToolUse gate** (`vibekit/runtime/hooks/simulate-gate.mjs`) blocks
  `Edit|Write|MultiEdit` on `highRiskPaths` (config) when this session has no
  `/simulate-impact` recorded in the ledger. Auditable bypass: a simulation marked
  `"BYPASS: <reason>"`.
- **Staged distill** — Stage 0: `check-registration.mjs` archives old registered
  ledgers (zero risk). Stage 1: `session-start.mjs` observes patterns over the last
  N sessions and injects an "observed patterns" boot section **without writing to
  CLAUDE.md**. Stage 2: `/distill-sessions` proposes a CLAUDE.md diff
  (`.distillation-proposal.md`); `/distill-apply` applies it and records an ADR.
  Playbook: [`playbooks/distillation-cycle.md`](playbooks/distillation-cycle.md).

### 5. `vibekit/config.json` + `/vibe-config` — cross-cutting configuration

Replaces hardcoded allowlists, cadences, and L5 parameters. Validated by an optional
zod schema (dynamic import only — the loader stays zero-dep). Inspect/edit with
`/vibe-config show|set`.

## The golden rule

> For any change touching a path in `highRiskPaths`, editing without a
> `/simulate-impact` recorded in this session's ledger is **forbidden** — not by
> convention, but by the PreToolUse gate that enforces it. Bypass requires a
> documented, deliberate act.

## When L5 does NOT apply

- **Bug fixes** — use `/bug-hunt`; there are no feature semantics to simulate.
- **Refactor with scope locked by `/dev-start`** — the scope is the predictor.
- **String/i18n/comment/internal rename** — the sweep and contract gate cover what
  matters; `/simulate-impact` explicitly declines.

## How L5 interacts with L1–L4

| Level | Interaction |
| --- | --- |
| L1 | Root `CLAUDE.md` lists the L5 commands. |
| L2 | L5 extends the ledger schema with `simulations[]`; the PreToolUse gate reads what L2 writes. |
| L3 | Predictions and the debt board are versioned, so they survive worktrees and parallel sessions. |
| L4 | `/simulate-impact` consumes the squad **in parallel** — the first feature to fan out, multiplying the ROI of specialization. |

## Calibration over time

`/simulate-impact` predictions get a "predicted vs actual" appendix from
`/log-session`; recurring misses refine the command's prompts (or become an ADR).
Sequential diffs of the debt board show the trend. After enough cycles, feed the
patterns into `/retro` (L6).
