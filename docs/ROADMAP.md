# Architecture & Roadmap

An architect's view of where VibeDevKit is, what it learned from the production
system it was distilled from (the "Ruiva" project's `devAItools/`), and where it
goes next.

## Lineage

VibeDevKit is the **generalized, stack-agnostic distillation** of a real
single-project AI dev platform. That source system was deeply coupled to its
stack (Cloudflare Workers + Hono + Expo + Drizzle) and domain (LGPD). The kit
keeps the *engine and the discipline*, drops the *stack-specific content*, and
adds a **level system** so adoption is gradual.

## What was ported (and how it was generalized)

| Source capability | In the kit | Generalization |
| --- | --- | --- |
| Session ledger + drift hooks | ✅ L2 | path classification is **config-driven** (any stack) |
| Boot context injection | ✅ L1 | reads kit-canonical paths; project-name auto-detected |
| Multi-session (claims, worktrees, indices) | ✅ L3 | unchanged in spirit |
| Squad of agents | ✅ L4 | shipped as stack-agnostic archetypes + `_TEMPLATE` |
| L5 simulate-impact gate | ✅ L5 | `highRiskPaths` configurable |
| Deterministic tech-debt detectors | ✅ L5 | regex detectors generalized (JS/TS/py + React) |
| Contract drift gate | ✅ L5/L6 | `contractGlobs` declares the surface; export-diff |
| Session telemetry | ✅ L6 | `stats.mjs` (drift rate, cadence, ADRs) |
| Auto-distill loop | ✅ L5/L6 | `/distill-sessions` + `/distill-apply` + `/retro` |
| Config + Zod schema | ✅ | **zero-dep loader** on the hot path; zod optional |
| Zod-coupled hooks | ➖ removed | hooks must run on a fresh project with no installs |

## The new layer — L6: Autonomy & Insight

L1–L3 buy **context fidelity** (the platform never forgets). L4–L5 buy **quality
governance** (review, tests, gates). The missing frontier is making the platform
*act and learn*, not just remember and enforce. That's **L6**:

- **Insight** — `stats.mjs` / `/vibe-stats`: drift rate, cadence, ADR/agent
  counts. You can't improve a practice you don't measure.
- **Autonomy** — `/ship`: an orchestrated pipeline that drives the whole squad
  (architect → implement → code-review → QA → record) with human checkpoints.
  This is "a full team of capable agents", coordinated, not ad hoc.
- **Learning loop** — `/retro`: turns recurring drift/debt/patterns into concrete
  governance (new CLAUDE.md rules, ADRs, config tweaks). The platform gets
  smarter *about this project* over time.

L6 adds no new Claude hook (same wiring as L5) — it's a **capability tier**:
commands + metrics + orchestration on top of the L5 gates.

## Honest gaps / not yet ported

- **Two-tier agents.** The source had lean executable agents + rich sibling
  briefings. The kit ships single-tier (lean) on purpose — but a `briefings/`
  layer is a good future option for very large squads.
- **Detailed L1–L5 workflow docs / playbooks.** The kit favors `instrucoes.md` +
  these docs over a deep playbook tree. Fine for now.
- **Predictions review cadence.** `/simulate-impact` writes predictions; there's
  no scheduled "predicted vs actual" review yet.
- **Contract drift is regex/export-based**, not AST. Good signal, not proof.

## 1.0 — harden & prove ✅ SHIPPED (2026-05-22 · npm `vibedevkit@1.0.0`)

L6 was reached in a single quarter; **1.0 earned it by hardening, not adding
levels**:

1. ✅ **Froze the surface.** Thin wrappers (`/state`, `/vibe-doctor`,
   `/context-refresh`) deprecated toward `/audit`; `/release` paired with `/claim`.
2. 🟡 **Prove the value of each level.** Tooling shipped (`/vibe-stats`, analysis →
   backlog); still needs **real-world data** to confirm L4–L6 earn their keep —
   the one item that needs *usage*, not code. *Ongoing.*
3. ✅ **Ate our own dog food.** `install.mjs` refactored 487 → 234 (out of the RED
   zone); a `tech-debt-scan --ci` gate keeps it green in CI.
4. ✅ **Locked the public contracts.** Documented in `CONTRIBUTING.md`; changes
   need an ADR + `/contract-check`.
5. ✅ **Deepened the thin spots.** `qa-unit` / `qa-perf` / `qa-e2e` got anti-pattern
   tables; `architect`↔`security` and `test-engineer`↔`qa-orchestrator` clarified.
6. ✅ **Dependency & supply-chain control.** `/deps-audit` + the **security-team**
   (`security` AppSec · `infra-security` IaC/cloud · `devops` delivery).

**Also delivered in 1.0:** standardized **WSJF (SAFe) prioritization + bug severity
(S1–S4) + SLA** with a **known-bugs map** in the DevPipeline; **`/deep-analysis`**
(global sweep → report → ADRs → backlog); an **active security-mode** boot trigger
(runs every N sessions, on by default); and the **`business-rules/`** memory folder.

## Next — post-1.0 focus: ancestor parity

Complete the distillation from the source platform (`app-ruivo/devAItools`) — the
three pieces deliberately flattened pre-1.0 (see *Honest gaps*):

- **`memory/predictions/`** — `/simulate-impact` writes a prediction file per run;
  a later **predicted-vs-actual** review closes the loop. ← *starting here.*
- **Two-tier squad briefings** — `vibekit/squads/<team>/<agent>.md` rich briefings
  behind the lean `.claude/agents/` agents (`/squad brief <agent>`).
- **`workflows/playbooks/`** — per-level workflow docs (L1–L5) + reusable playbooks
  (tech-debt sweep, simulate-impact, distillation, security batch). *This is the
  foundation for **playbook management** (Future directions #8).*

## Future directions (candidate L7+ / plugins)

1. **Design / Product / Ops squads.** ✅ **Shipped in v0.5.2** — `compliance-team`
   (LGPD), `design-team` (UX/UI/a11y), plus `product-owner` / `devops` starters,
   organized by a `vibekit/squads/` manifest with a sovereignty rule. The squad
   pattern is proven; further families (docs/data/growth/support) follow it.
2. **Fleet mode.** One control plane over many repos — aggregate stats, run
   `/audit` across a portfolio, propagate CLAUDE.md rule changes.
3. **Outcome-driven agent tuning.** Feed review/test outcomes back to refine each
   agent's briefing automatically (closing the loop the source only hinted at).
4. **Editor/CI surfaces.** Status-line widget, PR-review bot using `code-reviewer`
   + `qa-orchestrator`, contract-drift as a required check.
5. **Pluggable detectors & language packs.** Drop-in detectors and stack presets
   (`--preset next`, `--preset go`) so `/setupvibedevkit` is even sharper.
6. **Diverse & visual testing harness.** Broaden the QA squad beyond unit /
   integration / fuzz with a **browser-driven, visual** layer: open the running
   app, exercise real flows, and verify changes by **screenshot / visual
   regression** — so a change isn't "done" until the UI is confirmed.
   Language-agnostic with a **Python option** (Playwright-for-Python / Selenium)
   alongside JS runners, so each project picks its stack. Owned by `qa-e2e`
   (+ `design-team` for visual baselines), wired into `/scaffold-tests`,
   `/qa-signoff`, and the `/ship` gate. Stays true to the invariants: the harness
   is a **project** dependency, never on the kit's zero-dep hot path.
7. **Token economy & usage insight.** Make token cost a first-class, *measured*
   dimension of the platform — the natural extension of L6 **Insight**
   (`stats.mjs` / `/vibe-stats`, which today tracks sessions, drift, cadence but
   not cost). Capture **per-session token usage** (input / output / cache, broken
   down by agent and by command) into a plain-files ledger
   (`vibekit/memory/usage/`), and surface it as **`/token-report`** (per session,
   per week, per agent/squad) plus a running **budget** with advisory warnings when
   a session trends hot. Then feed the data back into **optimization**: flag
   context-heavy hooks/commands, recommend cheaper models for low-stakes steps, and
   quantify what each *level* costs — so the open 1.0 question ("do L4–L6 earn their
   keep?") finally gets a data-backed answer. Invariant-safe: advisory by default,
   plain files, **zero deps on the hot path** (collection is best-effort and never
   blocks real work).
8. **Playbook management.** Promote the post-1.0 `workflows/playbooks/` foundation
   (see *ancestor parity*) from a static doc tree into a **managed, runnable**
   layer: a **playbook registry/index** (discover what exists), **`/playbook`** to
   list / show / run a named procedure (tech-debt sweep, simulate-impact,
   distillation, security batch, release), per-run **tracking** in the ledger (which
   playbook ran, when, outcome), and **composition** so `/ship` and the squads
   invoke playbooks instead of ad-hoc step lists. Turns repeatable procedures into
   first-class, versioned, auditable assets — same "plain files, advisory,
   inspectable" posture as the rest of the kit.

## Design invariants (don't regress these)

- **Zero runtime deps on the hot path.** Levels 1–3 run with nothing installed.
- **Hooks never break real work.** Exit 0 on error; silent unless they must speak.
- **Everything is plain files in the repo.** Inspectable, reversible, no lock-in.
- **Config-driven, not hardcoded.** Stack specifics live in `vibekit/config.json`.
- **Advisory by default; enforce by choice.** Gates inform; you opt into blocking.
