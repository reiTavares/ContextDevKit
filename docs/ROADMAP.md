# Architecture & Roadmap

An architect's view of where VibeDevKit is, what it learned from the production
system it was distilled from (the "Ruiva" project's `devAItools/`), and where it
goes next.

> **Status key.** Every roadmap item carries a marker, kept current as work moves:
> ✅ **done** (shipped/implemented) · ⏳ **in progress** (being executed in a session
> right now) · 🟡 **partial / awaiting input** (started, or blocked on external data —
> not actively in a session) · 📋 **planned** (not started) · ➖ **dropped**
> (intentionally not ported). **Process:** when a session picks up an item, mark it
> ⏳; when it ships, switch it to ✅.

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

- **Contract drift: regex by default, AST optional.** The regex extractor covers the
  common JS/TS forms (named/declaration exports incl. `declare`/`abstract`/generators,
  `export default`, namespace re-exports `export * [as N] from`, type-only
  `export type { … }`). For AST precision, install `acorn` (or set `VIBE_CONTRACT_PARSER`):
  `contract-scan` uses it **only if importable**, so the zero-dep default holds. Residual:
  still "signal, not proof" for exotic TS without a TS-aware parser. [→ ADR-0003]

_The earlier gaps have since shipped: **two-tier briefings** (v1.1.0,
`/squad brief`), **workflow docs/playbooks** (`vibekit/workflows/`), and the
**predictions review cadence** (`/predictions-review`)._

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
three pieces deliberately flattened pre-1.0 (see *Honest gaps*). **All three are now
shipped** (✅ below):

- ✅ **`memory/predictions/`** — `/simulate-impact` writes a prediction file per run;
  `/predictions-review` (auto-run by `/log-session`) closes the loop, filling each
  file's *Actual* section from the ledger (changed vs predicted paths, both deltas).
  *Shipped: write half in v1.1.0; predicted-vs-actual review closed here.*
- ✅ **Two-tier squad briefings** — `vibekit/squads/<team>/<agent>.md` rich briefings
  behind the lean `.claude/agents/` agents. *Shipped v1.1.0: `/squad brief <agent>`
  scaffolds a briefing, `/squad list` shows coverage.*
- ✅ **`workflows/playbooks/`** — per-level workflow docs (L1–L5) + reusable playbooks
  (tech-debt sweep, simulate-impact, distillation, security batch). *Shipped:
  installed under `vibekit/workflows/`, seeded write-if-missing. The foundation for
  **playbook management** (Future directions #8).*

## Then — supply-chain & code security (deepen the security-team)

1.0 shipped the *foundation*: the **security-team** (`security` AppSec · `infra-security`
IaC/cloud · `devops` delivery) and `/deps-audit` (lockfile/pinning + native CVE audit →
backlog). Two things are still missing — a **code-facing** lane (today's agents own
auth/secrets and the *platform*, not the code's exposure *through* its dependencies and
third-party integrations) and any **GitHub-native** automation (the kit ships no `.github/`
scaffolding). Three moves, all on the existing rails:

- ✅ **`code-security` agent** — a security-team **sub-specialist** (mirrors `infra-security`,
  no overlap with the `security` AppSec lead). Lane: the code's *external* attack surface —
  third-party integration code (API clients / SDK usage, webhook & callback handling,
  (de)serialization of external responses), dependency **provenance / SBOM**, and SAST /
  CodeQL findings. Lean agent under `.claude/agents/` + a two-tier briefing in
  `vibekit/squads/security-team/`.
- ✅ **Dependency control of the system** — grow `/deps-audit` from "CVEs + loose ranges" into a
  real **dependency policy**: license allow/deny + SBOM generation, lockfile-drift detection,
  unmaintained / abandoned-package flags, and a scheduled (not just on-demand) sweep. Policy
  lives in `vibekit/config.json` (allowed licenses, max package age, pinning rules); findings
  still flow into the DevPipeline backlog like every other finding.
- ✅ **GitHub / Dependabot integration** — the kit scaffolds **`.github/dependabot.yml`** + a
  **security workflow** (CodeQL + `dependency-review` on PRs + the `/deps-audit` gate),
  ecosystem auto-detected, via `/security-setup` (or folded into `/setupvibedevkit`). The
  *loop-closer* (the on-brand half): a sync pulls **Dependabot / GitHub security alerts**
  (`gh api`) into the **same backlog**, where the `code-security` agent triages reachability —
  so GitHub's alerts become prioritized, owned tasks instead of an ignored tab.

**Stays inside the invariants:** the `.github/` files, SBOM and CodeQL run in the *project's*
CI, never on the kit's zero-dep hot path; the PR security workflow is **advisory by default**
(opt into blocking); everything is plain files (`dependabot.yml`, workflow YAML, findings
JSON) and **config-driven** (ecosystems + license policy in `config.json`).

✅ **Shipped** — the `code-security` agent (security-team sub-specialist),
`/deps-audit` grown with license policy + CycloneDX SBOM (`--sbom`) + lockfile-drift
and a `deps` config block, `.github/` scaffolding (Dependabot + an advisory
`security.yml`), and `gh-alerts.mjs` (GitHub alerts → DevPipeline backlog) behind a
new `/security-setup`. *Deferred:* registry-backed staleness, scheduled alert-sync,
required-check enforcement.

## L7 — Ecosystem & Scale (the former "Future directions", now shipped)

These were the *candidate L7+* items. With **v1.3.0** they ship as the **L7 capability
tier** (`/vibe-level 7`) — cross-cutting capabilities layered on top of L6, **no new
hook** (same pattern as L6; see ADR-0008). Items #2–#8 are the L7 set; #1 shipped earlier.

1. ✅ **Design / Product / Ops squads** — **Shipped in v0.5.2:** `compliance-team`
   (LGPD), `design-team` (UX/UI/a11y), plus `product-owner` / `devops` starters,
   organized by a `vibekit/squads/` manifest with a sovereignty rule. The squad
   pattern is proven; further families (docs/data/growth/support) follow it.
2. ✅ **Fleet mode (MVP).** One control plane over many repos via `/fleet` +
   `fleet.mjs` — registry at `~/.vibedevkit/fleet.json`; aggregate `stats` / `audit`
   across a portfolio; detect CLAUDE.md rule drift (`propagate --check`, detect-only).
   *Deferred: auto-applying rule edits across repos; remote repos.*
3. ✅ **Outcome-driven agent tuning (MVP).** `/tune-agents` + `agent-tuning.mjs`
   aggregate per-agent signals (briefing coverage, usage) and **propose** briefing
   refinements (mirrors `/distill-sessions`; applies nothing). *Deferred: a closed
   auto-loop + real per-agent outcome capture (PR-review / test attribution).*
4. ✅ **Editor/CI surfaces (MVP).** Status-line widget (`statusline.mjs`, wired as
   `settings.statusLine`, preserves a user's own) + a **quality CI workflow**
   (`contract-scan --ci` + `tech-debt --ci`, shipped to `.github/workflows/`).
   *Deferred: the Claude-driven PR-review bot (needs Claude in CI); making the
   checks **required** is a branch-protection setting, not code.*
5. ✅ **Pluggable detectors & language packs (MVP).** Drop-in detectors from
   `vibekit/detectors/*.mjs` (loaded by `tech-debt-scan`) + stack **presets**
   (`install.mjs --preset next|go|python`, merged into config). *Deferred: a larger
   preset library.*
6. ✅ **Diverse & visual testing harness (MVP).** `/visual-test` + `visual-test.mjs`
   **scaffold** a browser-driven, visual layer (screenshot / visual-regression) for
   the detected stack — **Playwright JS** (`@playwright/test`) + **Python**
   (pytest-playwright); `status` detects an existing harness. Owned by `qa-e2e`
   (+ `design-team` for baselines), wired into `/scaffold-tests`, `/qa-signoff`, and
   the `/ship` gate. The runner is a **project** dependency (the kit scaffolds, never
   bundles/runs browsers) — true to the zero-dep hot-path invariant. *Deferred:
   running browsers in the kit's own CI; real baselines/diffing; a hosted diff service.*
7. ✅ **Token economy & usage insight.** *Shipped (first cut):* `/token-report` +
   `token-report.mjs` read Claude Code's local session transcripts and aggregate
   **per-session token usage** (input / output / cache) and **per ISO week**, with a
   configurable **budget** (`tokens.budgetPerSession`) that flags hot sessions — the
   cost extension of L6 **Insight**. Read-only, local, zero-dep, aggregated counts
   only. Next refinements (not yet done): per-agent/command breakdown and feeding the
   data into automated optimization hints.
8. ✅ **Playbook management.** *Shipped:* the `workflows/playbooks/` foundation is now a
   **managed, runnable** layer — `playbook.mjs` + **`/playbook`** to **list** the
   registry (discover what exists), **show** a procedure, and **run** one (records a
   tracked entry in `vibekit/memory/playbook-runs.md`, then prints the steps to
   execute). `/ship` and the squads can `run` a playbook instead of restating it.
   Turns repeatable procedures into first-class, auditable assets — same "plain files,
   advisory, inspectable" posture as the rest of the kit.

## Next — DevPipeline `working/` stage + declarative squad pipelines (ADR-0015)

A single ADR opens two adjacent moves, sharing one substrate (`state.json` per
in-flight item). Inspired by a read of [opensquad](https://github.com/renatoasse/opensquad)'s
declarative pipeline, *not* a copy — the kit's zero-dep + model-router + simulate-impact
invariants reshape the grammar (no full expression eval, no vendor model names, opt-in
per squad, dry-run as a first-class mode).

- 📋 **DevPipeline gains a `working/` stage** (task **037**, ADR-0015 §B). Today
  `testing/` carries two meanings — "actively being worked on" and "code written,
  awaiting QA". That conflation hides cross-session conflicts: session A can be
  hammering on task `031` while session B has no idea unless A manually `/claim`ed
  the right paths. The new stage holds **only WIP**; `testing/` reclaims its
  sign-off meaning. `/pipeline start <id>` and `/pipeline stop <id>` move tasks
  in/out; the workspace record (`.claude/.workspace/<sid>.json`) gains a `tasks[]`
  array so the dashboard surfaces *which session owns which task, right now*. Stale
  auto-eviction (default 90m without a heartbeat) keeps the lane honest. The
  pre-push hook already refuses cross-session conflicts on paths; ADR-0015 extends
  it to task ids.
- 📋 **Declarative `pipeline.yaml` per squad + engine** (task **036**, ADR-0015 §A).
  Optional file per squad declaring steps, `condition`, `on_reject`,
  `max_review_cycles`, `model_tier`, `execution`, and `type: checkpoint`. Parsed
  via `lib/yaml.mjs` (ADR-0013 optional dynamic import); engine refuses *with a
  clear message* when `yaml` is absent — pipelines are opt-in, not a hot-path
  feature. First consumer is `agent-forge` (Fase 6); `/ship` adopts the same DSL
  when ready. Dry-run is a first-class mode — `squad-pipeline.mjs <squad>
  --dry-run` prints the would-be execution order so `/simulate-impact` can map
  pipeline-edit blast radius before changes ship.
- 📋 **Canonical `state.json` substrate** (task **038**, ADR-0015 §C). One schema
  for both "task in flight" and "pipeline run", recording owner session/user/branch,
  current step, heartbeat, retry cycles. Forge Stats v2 reads it for success rate
  + retry distribution; `/runs` (task **039**) lists the last N across squads.

**Stays inside the invariants:** the DSL is opt-in per squad, hot-path stays
zero-dep (yaml only behind the sanctioned optional import), and `condition`
accepts a whitelisted grammar — no arbitrary expression evaluation.

## Design invariants (don't regress these)

- **Zero runtime deps on the hot path.** Levels 1–3 run with nothing installed.
- **Hooks never break real work.** Exit 0 on error; silent unless they must speak.
- **Everything is plain files in the repo.** Inspectable, reversible, no lock-in.
- **Config-driven, not hardcoded.** Stack specifics live in `vibekit/config.json`.
- **Advisory by default; enforce by choice.** Gates inform; you opt into blocking.
