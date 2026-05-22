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

## Next milestone — 1.0: harden & prove (before any L7)

The kit reached **L6 in a single quarter** — context fidelity, quality gates, and
autonomy/insight all shipped. The risk now is *breadth outrunning proof*: 33
commands, 18 agents, six levels, and **no published evidence that L4–L6 actually
move the needle** on a real project. The next milestone is not a new level — it's
**earning a 1.0**:

1. **Freeze the surface.** No new levels or agent families until 1.0. Prune thin
   command wrappers (`/state`, `/vibe-doctor`, `/context-refresh` fold into
   `/audit`; `/claim`+`/release` merge). Fewer, sharper commands.
2. **Prove the value of each level.** Use `/vibe-stats` on real projects to show
   L4–L6 reduce drift/debt vs L1–L3. Trim or rework what can't justify itself —
   the honest hypothesis is that ~80% of the value lives in L1–L3.
3. **Eat our own dog food.** The kit must pass its own `/tech-debt-sweep` clean.
   (`install.mjs` refactored out of the RED ZONE in this pass; keep it green.)
4. **Lock the public contracts.** `config.json` schema, installer flags, and the
   hook payload shape become a stability promise; changes go through an ADR +
   `/contract-check`. This is what "1.0" should mean here.
5. **Deepen the thin spots.** Tier-2 agents (`qa-perf`, `qa-e2e`, `qa-unit`) get
   anti-pattern tables + concrete examples; clarify `architect`↔`security` and
   `test-engineer`↔`qa-orchestrator` routing boundaries.

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

## Design invariants (don't regress these)

- **Zero runtime deps on the hot path.** Levels 1–3 run with nothing installed.
- **Hooks never break real work.** Exit 0 on error; silent unless they must speak.
- **Everything is plain files in the repo.** Inspectable, reversible, no lock-in.
- **Config-driven, not hardcoded.** Stack specifics live in `vibekit/config.json`.
- **Advisory by default; enforce by choice.** Gates inform; you opt into blocking.
