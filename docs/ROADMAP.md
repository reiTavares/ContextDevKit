# Architecture & Roadmap

An architect's view of where ContextDevKit is, what it learned from the production
system it was distilled from (the "Ruiva" project's `devAItools/`), and where it
goes next.

> **Status key.** Every roadmap item carries a marker, kept current as work moves:
> ✅ **done** (shipped/implemented) · ⏳ **in progress** (being executed in a session
> right now) · 🟡 **partial / awaiting input** (started, or blocked on external data —
> not actively in a session) · 📋 **planned** (not started) · ➖ **dropped**
> (intentionally not ported). **Process:** when a session picks up an item, mark it
> ⏳; when it ships, switch it to ✅.

## Lineage

ContextDevKit is the **generalized, stack-agnostic distillation** of a real
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

- **Insight** — `stats.mjs` / `/context-stats`: drift rate, cadence, ADR/agent
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
  `export type { … }`). For AST precision, install `acorn` (or set `CONTEXT_CONTRACT_PARSER`):
  `contract-scan` uses it **only if importable**, so the zero-dep default holds. Residual:
  still "signal, not proof" for exotic TS without a TS-aware parser. [→ ADR-0003]

_The earlier gaps have since shipped: **two-tier briefings** (v1.1.0,
`/squad brief`), **workflow docs/playbooks** (`contextkit/workflows/`), and the
**predictions review cadence** (`/predictions-review`)._

## 1.0 — harden & prove ✅ SHIPPED (2026-05-22 · npm `contextdevkit@1.0.0`)

L6 was reached in a single quarter; **1.0 earned it by hardening, not adding
levels**:

1. ✅ **Froze the surface.** Thin wrappers (`/state`, `/context-doctor`,
   `/context-refresh`) deprecated toward `/audit`; `/release` paired with `/claim`.
2. 🟡 **Prove the value of each level.** Tooling shipped (`/context-stats`, analysis →
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
- ✅ **Two-tier squad briefings** — `contextkit/squads/<team>/<agent>.md` rich briefings
  behind the lean `.claude/agents/` agents. *Shipped v1.1.0: `/squad brief <agent>`
  scaffolds a briefing, `/squad list` shows coverage.*
- ✅ **`workflows/playbooks/`** — per-level workflow docs (L1–L5) + reusable playbooks
  (tech-debt sweep, simulate-impact, distillation, security batch). *Shipped:
  installed under `contextkit/workflows/`, seeded write-if-missing. The foundation for
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
  `contextkit/squads/security-team/`.
- ✅ **Dependency control of the system** — grow `/deps-audit` from "CVEs + loose ranges" into a
  real **dependency policy**: license allow/deny + SBOM generation, lockfile-drift detection,
  unmaintained / abandoned-package flags, and a scheduled (not just on-demand) sweep. Policy
  lives in `contextkit/config.json` (allowed licenses, max package age, pinning rules); findings
  still flow into the DevPipeline backlog like every other finding.
- ✅ **GitHub / Dependabot integration** — the kit scaffolds **`.github/dependabot.yml`** + a
  **security workflow** (CodeQL + `dependency-review` on PRs + the `/deps-audit` gate),
  ecosystem auto-detected, via `/security-setup` (or folded into `/setupcontextdevkit`). The
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
new `/security-setup`. *Deferred (→ ADR-0047):* registry-backed staleness, scheduled
alert-sync, required-check enforcement.

## L7 — Ecosystem & Scale (the former "Future directions", now shipped)

These were the *candidate L7+* items. With **v1.3.0** they ship as the **L7 capability
tier** (`/context-level 7`) — cross-cutting capabilities layered on top of L6, **no new
hook** (same pattern as L6; see ADR-0008). Items #2–#8 are the L7 set; #1 shipped earlier.

1. ✅ **Design / Product / Ops squads** — **Shipped in v0.5.2:** `compliance-team`
   (LGPD), `design-team` (UX/UI/a11y), plus `product-owner` / `devops` starters,
   organized by a `contextkit/squads/` manifest with a sovereignty rule. The squad
   pattern is proven; further families (docs/data/growth/support) follow it.
2. ✅ **Fleet mode (MVP).** One control plane over many repos via `/fleet` +
   `fleet.mjs` — registry at `~/.contextdevkit/fleet.json`; aggregate `stats` / `audit`
   across a portfolio; detect CLAUDE.md rule drift (`propagate --check`, detect-only).
   *Deferred (→ ADR-0047, trigger-gated): auto-applying rule edits across repos; remote repos.*
3. ✅ **Outcome-driven agent tuning (MVP).** `/tune-agents` + `agent-tuning.mjs`
   aggregate per-agent signals (briefing coverage, usage) and **propose** briefing
   refinements (mirrors `/distill-sessions`; applies nothing). *Deferred (→ ADR-0047,
   re-evaluate after ADR-0044/F3 ships attribution): a closed auto-loop + real
   per-agent outcome capture (PR-review / test attribution).*
4. ✅ **Editor/CI surfaces (MVP).** Status-line widget (`statusline.mjs`, wired as
   `settings.statusLine`, preserves a user's own) + a **quality CI workflow**
   (`contract-scan --ci` + `tech-debt --ci`, shipped to `.github/workflows/`).
   *Deferred (→ ADR-0047, trigger-gated): the Claude-driven PR-review bot (needs
   Claude in CI); making the checks **required** is a branch-protection setting,
   not code (refused as kit code in ADR-0047).*
5. ✅ **Pluggable detectors & language packs (MVP).** Drop-in detectors from
   `contextkit/detectors/*.mjs` (loaded by `tech-debt-scan`) + stack **presets**
   (`install.mjs --preset next|go|python`, merged into config). *Deferred (→ ADR-0047,
   demand-driven): a larger preset library.*
6. ✅ **Diverse & visual testing harness (MVP).** `/visual-test` + `visual-test.mjs`
   **scaffold** a browser-driven, visual layer (screenshot / visual-regression) for
   the detected stack — **Playwright JS** (`@playwright/test`) + **Python**
   (pytest-playwright); `status` detects an existing harness. Owned by `qa-e2e`
   (+ `design-team` for baselines), wired into `/scaffold-tests`, `/qa-signoff`, and
   the `/ship` gate. The runner is a **project** dependency (the kit scaffolds, never
   bundles/runs browsers) — true to the zero-dep hot-path invariant. *Deferred
   (→ ADR-0047): real baselines/diffing (trigger-gated); browsers in the kit's own
   CI and a hosted diff service are **refused** there (invariant violations).*
   **v2.6 follow-up shipped:** `scaffold-tests.mjs` now gives the whole QA squad a
   deterministic stack map for Node/JavaScript, Python, Go, Rust, and PHP, plus
   happy/edge/failure cases and explicit-`--write` starter harnesses.
7. ✅ **Token economy & usage insight.** *Shipped (first cut):* `/token-report` +
   `token-report.mjs` read Claude Code's local session transcripts and aggregate
   **per-session token usage** (input / output / cache) and **per ISO week**, with a
   configurable **budget** (`tokens.budgetPerSession`) that flags hot sessions — the
   cost extension of L6 **Insight**. Read-only, local, zero-dep, aggregated counts
   only. Next refinements: the per-agent/command breakdown is now owned by
   **ADR-0044** (autonomy F3, task 113); automated optimization hints remain open.
8. ✅ **Playbook management.** *Shipped:* the `workflows/playbooks/` foundation is now a
   **managed, runnable** layer — `playbook.mjs` + **`/playbook`** to **list** the
   registry (discover what exists), **show** a procedure, and **run** one (records a
   tracked entry in `contextkit/memory/playbook-runs.md`, then prints the steps to
   execute). `/ship` and the squads can `run` a playbook instead of restating it.
   Turns repeatable procedures into first-class, auditable assets — same "plain files,
   advisory, inspectable" posture as the rest of the kit.

## DevPipeline `working/` stage + declarative squad pipelines (ADR-0015) — ✅ SHIPPED (v1.9.0–v1.13.0)

A single ADR opens two adjacent moves, sharing one substrate (`state.json` per
in-flight item). Inspired by a read of [opensquad](https://github.com/renatoasse/opensquad)'s
declarative pipeline, *not* a copy — the kit's zero-dep + model-router + simulate-impact
invariants reshape the grammar (no full expression eval, no vendor model names, opt-in
per squad, dry-run as a first-class mode).

- ✅ **DevPipeline gains a `working/` stage** (task **037**, ADR-0015 §B). Today
  `testing/` carries two meanings — "actively being worked on" and "code written,
  awaiting QA". That conflation hides cross-session conflicts: session A can be
  hammering on task `031` while session B has no idea unless A manually `/claim`ed
  the right paths. The new stage holds **only WIP**; `testing/` reclaims its
  sign-off meaning. `/pipeline start <id>` and `/pipeline stop <id>` move tasks
  in/out; the workspace record (`.claude/.workspace/<sid>.json`) gains a `tasks[]`
  array so the dashboard surfaces *which session owns which task, right now*. Stale
  auto-eviction (default 90m without a heartbeat) keeps the lane honest. *Shipped:
  `pipeline-session.mjs` (start/stop + ADR-0032/072 gates), `claim.mjs`
  attach/detach, stale sweep in `workspace-sync.mjs`; lifecycle automation
  (auto-start / auto-conclude) followed in ADR-0034 (v1.12.0). Residual: the
  pre-push hook still refuses on paths only — the task-id extension wasn't done.*
- ✅ **Declarative `pipeline.yaml` per squad + engine** (task **036**, ADR-0015 §A).
  Optional file per squad declaring steps, `condition`, `on_reject`,
  `max_review_cycles`, `model_tier`, `execution`, and `type: checkpoint`. Parsed
  via `lib/yaml.mjs` (ADR-0013 optional dynamic import); engine refuses *with a
  clear message* when `yaml` is absent — pipelines are opt-in, not a hot-path
  feature. First consumer is `agent-forge` (Fase 6). Dry-run is a first-class
  mode — `squad-pipeline.mjs <squad> --dry-run` prints the would-be execution
  order so `/simulate-impact` can map pipeline-edit blast radius before changes
  ship. *Shipped: `squad-pipeline.mjs` + `squad-pipeline-condition.mjs` +
  `agent-forge/pipeline.yaml` + `docs/SQUAD-PIPELINE-FORMAT.md` (session 30).
  Residual: `/ship` still runs its own staged flow (`ship-state.mjs`), it hasn't
  adopted the DSL.*
- ✅ **Canonical `state.json` substrate** (task **038**, ADR-0015 §C). One schema
  for both "task in flight" and "pipeline run", recording owner session/user/branch,
  current step, heartbeat, retry cycles. *Shipped: `runtime/state/state-io.mjs`,
  stamped by `pipeline start/stop` (`kind: task`) and `/ship` resume
  (`kind: pipeline-run`, ticket 074); `/runs` (task **039**, `runs.mjs`) lists
  recent transitions + runs. Residual: Forge Stats v2 doesn't read it yet
  (success rate + retry distribution).*

**Stays inside the invariants:** the DSL is opt-in per squad, hot-path stays
zero-dep (yaml only behind the sanctioned optional import), and `condition`
accepts a whitelisted grammar — no arbitrary expression evaluation.

## GitHub sync awareness in the dev flow (ADR-0026) — ✅ SHIPPED (v1.9.0, session 35)

The boot banner already shows **branch/commit** divergence (`checkGitDivergence`)
and the 20 most-recent remote branches (`activeBranches`), and `pre-push` blocks
real conflicts. The missing layer is **PR awareness** — nothing asks GitHub
"what PRs are open, which are awaiting CI/review, is there already a PR for this
branch?". Two moments are PR-blind: starting work (`/dev-start`) and opening a
PR (`/git pr`).

- ✅ **`sync-check.mjs` — `preflight` + `prepr` modes** (ADR-0026). One zero-dep
  script. `preflight` (run by `/dev-start`, before scope-lock): ahead/behind,
  recent branches, and **open PRs with CI/review status**, flagging PRs
  *awaiting status* that may overlap the objective. `prepr` (run by `/git pr`,
  before push): re-check divergence vs `main` and **detect a duplicate open PR**
  for the current branch. `gh` is optional — absent/unauthed degrades to the
  git-only half and reports the PR check as **skipped, never a pass** (Rule 8);
  offline ⇒ silent exit 0. *Refined in v1.13.0 (ticket 065): no implicit
  `git fetch` on read-only checks — network is opt-in via `--fetch`.*
- ✅ **Wiring** — `/dev-start` gained a step 0 (preflight) and `/git pr` a
  pre-step (prepr). PR queries stay **off** the `SessionStart` hot path (network
  + `gh` auth would violate the never-block invariant, Rule 2).

**Stays inside the invariants:** zero-dep script, `gh` optional with a graceful
skip, PR discovery only in explicit opt-in commands (never the hot path), and
the script is read-only — it never creates, edits, or merges a PR.

*Deferred (→ ADR-0047):* `glab` (GitLab) parity, a PR line in `/git status`
(bucket A — implement), a `--watch` checks poll, and a latency cache.

## Token economy: the digest layer (ADR-0027) — ✅ SHIPPED (PR #41, 2026-06-03)

The kit already **measures** token usage (`/token-report` + `token-report.mjs`,
roadmap #7) but has no **reducer**. A measurement pass over the 65 command files +
the boot hook found the lever: in this kit, tokens are spent when *the AI reads
files and reasons*, and a cluster of high-value commands still makes the AI ingest
**full raw markdown** instead of a pre-digested view — the biggest single-run cost
being the periodic L5/L6 commands that read the **last ~10 session logs raw**
(~1,100–1,300 lines ≈ 13–16K tokens *before reasoning*), and the highest-frequency
cost being the **boot banner injecting 60 raw lines of the last session every
session**. ADR-0027 adds a deterministic, zero-dep **digest layer** that pre-digests
the two artifacts the AI re-reads most (session logs, ADRs) so it reasons over
compact output. Estimated **~120–200K input tokens/week** saved on an active project
(full per-command estimate + assumptions in
[docs/token-economy-plan.md](token-economy-plan.md)).

- ✅ **Shared single-source extractor** (ADR-0027 §1). Shipped as
  `runtime/hooks/md-extract.mjs` (generic markdown primitives) +
  `runtime/hooks/session-digest-core.mjs` (session parser) — flat-module
  convention, not a `lib/digest/` dir; reused by the boot hook and the script
  wrappers, no duplicated parsing (Rule 4).
- ✅ **`session-digest.mjs`** (ADR-0027 §2). Session logs → ~6-line structured
  digest (`--last N` / `--id` / `--json`). Rewired `/distill-sessions` + `/retro`
  to read digests, not raw logs — the **biggest single-run wins**.
- ✅ **`adr-digest.mjs`** (ADR-0027 §3). An ADR catalog (status · title · one-line
  decision) + `--search`. Replaces "read 3–5 ADRs to find the relevant one" with
  "read the catalog, open at most one". Wired into `/ship`, `/new-adr`
  (dup-decision check), `/deep-analysis`.
- ✅ **`context-pack.mjs`** (ADR-0027 §4). One bounded "start of work" bundle
  (latest-session digest + `[Unreleased]` + immutable rules + open backlog +
  recent ADRs) that collapses the 3–5 sequential reads in `/dev-start`, `/state`,
  `/ship` into **one script call** — fewer tokens *and* fewer round-trips.
- ✅ **Boot hook digest** (ADR-0027 §5). `session-start.mjs` emits a ~6-line
  digest for "Last registered session" instead of 60 raw lines, **falling back to
  the raw-truncated output on any parse miss** (Rule 2/8 — degrade, never break).
  The highest-frequency saving (every session).

**Stays inside the invariants:** no new hook and no new dependency (plain scripts +
one shared pure module); digests are **deterministic extraction**, not AI-written
summaries (reproducible, free); a digest miss is a **visible raw-fallback**, never a
silent drop; each slice ships with a `selfcheck`/`integration-test` assertion and is
re-measured against `/token-report`.

*Deferred:* per-command/agent token attribution in `/token-report` — now owned by
**ADR-0044** (autonomy F3, task 113); the DevPipeline board digest for `/pipeline`
and an mtime-keyed digest cache → **ADR-0047**.

## Proactive Advisor: a six-lane improvement engine (ADR-0028) — ✅ SHIPPED

The kit ships strong *individual* analysis surfaces but no single capability that
reads the project and — **proactively, not reactively** — surfaces improvement
suggestions **before and after each change**, classified into six lanes:
**architecture · features · deepen existing · security · UX · growth/retention**.
A sweep mapped each: architecture and security are strong and (for security)
already proactive; features and UX exist but are reactive; **two lanes have no
owner at all** — *deepen existing features* and *growth/retention* (only
acquisition exists, via `seo-specialist`). And nothing **aggregates** the lanes or
fires automatically at the end of a change.

- ✅ **Core shipped** — `/advise`, the aggregator. Two modes (`--before <objective>`
  = opportunities + risks; `--after` = improvements, scoped to the changed surface),
  an optional `--lane <id>` filter. It **delegates** to the owning agent per lane
  (`/analyze-code-ia-practices`, `/deep-analysis`, `/roadmap`, the design-team) —
  it never re-implements them — and feeds every surviving finding into the
  DevPipeline backlog tagged `advise:<lane>`. It does not edit code.
- ✅ **Single-sourced taxonomy** — `advisor.lanes` in config maps each lane to an
  `owner`; `deepen` and `growth` ship as declared `owner: null` **seams** that
  `/advise` surfaces as *skipped — no owner*, never faked (rule 8/9).
- ✅ **Proactive trigger** — the Stop hook (`check-registration.mjs`) nudges
  `/advise` after a productive session (≥ 2 important paths touched, debounced 24h,
  config-gated) — the "after each implementation" moment. Mirrors the `securityMode`
  posture: active by default, silent otherwise, never blocks (Rule 2).

**Stays inside the invariants:** the expensive fan-out lives in the command, never
the hot path; the Stop nudge is cheap, zero-dep, debounced, exit-0-on-error; the
lane → owner map is config-driven; unowned lanes degrade to a visible skip.

- ✅ **Both seams filled — 6/6 lanes owned.** The **`growth-team`** squad shipped
  (`growth` lead + `retention`, with the shared `seo-specialist` for acquisition)
  wired to `growth.owner`; and **`deepen`** got an owner — the `product-owner`
  **depth lens** (maturing existing features, distinct from greenfield `features`).

*Deferred (→ ADR-0047):* a `--since <ref>` diff scope for `--after`; optional
two-tier briefings for `growth` / `retention`. *Since shipped:* recurring advisor
findings now feed `/retro` + `/tune-agents` — `advise-review.mjs` reports per-lane
hit-rate (ticket 070, PR #50).

## Behavioral discipline layer (ADR-0029) — ✅ SHIPPED

A review of the MIT-licensed [`andrej-karpathy-skills`](https://github.com/multica-ai/andrej-karpathy-skills)
repo surfaced a clean asymmetry: the kit is strong on the **structural** layer
(*what good code looks like* — `best-practices.md`, the constitution) and on
governance, but **thin on the *behavioral* layer** (*how the agent acts while
producing the diff*). Karpathy's four principles mapped to: ✅ *Simplicity first*
(had it, §9), 🟡 *Surgical changes* (only inside `/dev-start`), 🟡 *Goal-driven*
(tools but no rule), ❌ *Think before coding* (**no rule told the agent to surface
assumptions and ask when ambiguous before coding** — the biggest gap).

- ✅ **`behaviors.md` + `behaviors-examples.md`** — the behavioral sibling of
  `best-practices.md`: the four guidelines (think-before-coding · simplicity ·
  surgical · goal-driven) with Do/Don't + a "Fits the kit" map, plus before/after
  diffs of each anti-pattern. Credits the MIT source.
- ✅ **Constitution §8** (`CLAUDE.md.tpl`) — a concise behavioral-discipline
  section pointing to `behaviors.md`; **reconciles the one tension** (refactor by
  responsibility is *deliberate* via `/dev-start` / `/analyze-code-ia-practices`,
  never an opportunistic side effect).
- ✅ **`behaviors.active` (default ON)** + a ~4-line boot reminder mirroring the
  best-practices block; installer seeds both docs; `selfcheck` asserts each piece.

**Stays inside the invariants:** the boot reminder never blocks (Rule 2), the
guidance is single-sourced in one doc referenced by the constitution + boot
(Rule 4), and we adopted the proven four rather than inventing a fifth (Rule 9).

*Noticed, since fixed:* `best-practices.md` links to `review-protocol.md`, which
the installer's seed list didn't copy — `review-protocol.md` now ships in
`templates/contextkit/` and is in the engine installer's seed list (selfcheck
asserts it).

## Next — Autonomy dial: a consent axis orthogonal to levels (ADR-0041)

Six same-day deliberations (4 Gemini rounds + 2 full-staff Claude rounds, 8 voices
each — see `contextkit/memory/deliberations/2026-06-10-06-…`) converged: the kit
gains a user-configurable **autonomy degree** — `autonomy.grade` (1 manual ·
2 suggest+supervise *default* · 3 auto-except-ADR · 4 full-auto, experimental) —
as a **consent axis orthogonal to L1–L7** (levels = what the kit *can* do; grade =
what it *may* do without asking). One pure `resolveAutonomy(area)` resolver is the
only read path; **hooks stay grade-blind** (only commands + `/ship` checkpoints
consult it); a **non-negotiable floor in code** (secrets path-class, no force-push,
no gate self-edit, ADR-class always human, grade escalation always human) that
config can never lower. Five phases, hard gates between them:

The implementation sequence — ADR-0041 is the umbrella; each phase's *new*
technical contracts live in a delta-only continuation ADR (nothing repeated):

| # | Etapa | ADR | Motivo (why now) | Impacto | Tasks | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **F0 — Trust floor & hygiene** | 0041 (direct — fully specified there) | No autonomy can be built on a bypassable gate; the accidental level-4 bypass proved the failure *pattern* | Kills the "silently-disabled gate" regression class (wiring-drift selfcheck = highest-leverage control of the package); secrets path-class exists before any grade can act; selfcheck regains constitutional room | 100–105 (P0/P1) | 📋 |
| 2 | **F1 — Dial core (grades 1–3)** | **0042** — resolver contract, precedence (flag > session > config, floor clamps last), floor API, derived surfaces | The user's single trust decision is today shattered across ≥5 surfaces; displayed grade must ≡ enforced grade by construction | One stable function for every consumer; `--session` makes trying a grade cheap and reversible; repeated re-consent disappears | 106–110 (P2) | 📋 |
| 3 | **F2 — Observable substrate** | **0043** — state.json schema v1 + transition-legality matrix (accepts ADR-0015 §C) | Grade ≥3 without an append-only trail = "the LLM narrating its own success"; auto-moves were rejected precisely for lacking it | Every autonomous action gets a record, an inverse (undo) and a metric; the board becomes an observable state machine; feeds the grade-4 bar | 110 (legality), 111–112 (P3) | 📋 |
| 4 | **F3 — Token fan-out economy** | **0044** — subagent pack contract, per-command attribution (first), budget-gate semantics, deterministic memory retriever | Fan-outs are the dominant cost post-ADR-0027 (~25–80K/deliberation); the grade-4 budget gate cannot govern spend nobody attributes | ~25–80K saved per multi-agent run + ~10–20K/wk at boot; more context headroom in every session; the distill-memory seam is re-owned without inflation risk | 113–115 (P2/P3) | 📋 |
| 5 | **F4 — Grade 4, experimental** | **0045** — eligibility bar (numbers), hardened quorum (deterministic voice + security veto), session-scoping, kill-switch | Inter-AI review only becomes a *control* with deterministic anchors and a veto; eligibility must be measured, not vibed | Delivers "full-auto with rigorous inter-AI control" without inverting advisory-by-default; one-line kill-switch; branch-only blast radius | 116 (P3) | 📋 |

**Refused, on record:** ambient idle-escalation (absence ≠ consent), AI-written
self-registering plugins, Wasm sandboxing / genetic swarms / local LoRA
(deliberation 03 — violate the zero-dep and filesystem invariants).

**Stays inside the invariants:** the dial never changes hook behavior (rule 2);
the floor is code, not config (rule 8); every phase ships merge-blocking tests
(rule 3); grades 1–3 are plumbing of existing flags through one single-sourced
resolver (rule 4); grade 4 is opt-in, experimental, and reversible.

## Next — Deferred-items consolidation (ADR-0047)

📋 A roadmap verification pass (2026-06-10) confirmed every section above as
shipped and gathered the surviving *Deferred:* footnotes (from ADR-0002 / 0005 /
0006 / 0007 / 0026 / 0027 / 0028) into one decision — **ADR-0047** — explicitly
**excluding** everything the autonomy package (ADR-0041…0045, tasks 100–116)
already owns. Three buckets:

- 📋 **Bucket A — implement now** (each has a real consumer today): a PR line in
  `/git status` (facts already computed by `sync-check.mjs`) · `/advise --after
  --since <ref>` diff scope · a DevPipeline **board digest** (extends the
  ADR-0027 layer for `/pipeline` + `/plan-week`) · **scheduled alert-sync**
  (opt-in cron in the scaffolded `security.yml`, runs in the *project's* CI) ·
  **registry-backed staleness** in `/deps-audit` (opt-in `--registry`; no
  network ⇒ skipped, never a pass).
- **Bucket B — stays deferred, trigger named:** `glab` parity · `--watch` poll +
  latency cache · fleet `--apply`/remote repos · tuning closed-loop (after
  ADR-0044/F3 attribution) · PR-review bot (Claude in CI) · preset library
  (demand-driven) · visual baselines (first committed baseline) ·
  growth/retention briefings.
- **Bucket C — refused, on record:** hosted visual-diff service, browsers in the
  kit's own CI, required-check enforcement as kit code (it's branch protection).

## Conversion squad + deterministic LP scaffold (ADR-0050) — ✅ SHIPPED (PR #69, 2026-06-11)

The landing surface (ADR-0023/0025) gained its missing four fronts in one
package — strategy, legal, instrumentation and token economy:

- ✅ **`lp-scaffold.mjs` + `lp-build.mjs` + `starters/landing/`** — componentized
  source (one fold per file; `content/copy.json` is the AI's only editing
  surface) assembled into one atomic indexable `dist/`; `--check` refuses
  leftover tokens/sentinels and runs `seo-audit` + `aiso-audit` on the output
  (born green, asserted in CI). Resolves ADR-0023's deferred starter without
  inventing domain content. *Estimated ~30–60K → ~5–10K tokens per LP; baseline
  to be measured via `/token-report` on the first real page.*
- ✅ **LGPD by default** — consent banner ON (Consent Mode default-denied), GTM
  direct but ID-less (inert, consent-gated), pixels as commented consent-wrapped
  models only, privacy policy + terms generated as drafts (non-removable
  lawyer-review disclaimer), webhook-decoupled lead forms.
- ✅ **`conversion-strategist` + `tracking-integrator`** (design-team) — interview-
  first neurodesign (refuses invented proof) and consent-first instrumentation
  (pairs with `privacy-lgpd`); lean agents + tier-2 briefings.
- ✅ **Playbook + `/landing-page` v2** — fold-anatomy menu, neurodesign
  verify-don't-vibe table, legal & consent defaults, deterministic path.
  *Refused, on record: fixed Next/React stack mandate, parallel 150-line cap,
  7-fold minimum, example social proof, auto-wired pixels.*

*Deferred:* EN-language legal templates (pt-BR/LGPD market first, rule 9);
framework-variant (Astro/Next) scaffold parity; measuring the real token delta.

## Next — Agent swarm + cost-tiered model routing (ADR-0051 + ADR-0052)

Two linked decisions (session 52, 2026-06-11) ride on the completed autonomy
substrate (F0–F4, v2.0.0). Full analyses:
`docs/explanation/swarm-feasibility-study.md` and
`docs/explanation/model-tier-routing-study.md`.

**ADR-0052 — cost-tiered model routing** (Accepted; Phase 1 ✅ shipped, session 52):
expensive models think, cheap models execute. All 34 agents declare a `model:`
tier alias (7 opus · 21 sonnet · 4 haiku · 2 inherit, selfcheck-pinned);
`/ship`/`/advise`/`/debate`/`/scaffold-tests` classify think-vs-execute at
dispatch with floors (security ≥ sonnet), one-step QA escalation and budget
de-escalation; capability-matrix refreshed to 2026-06 prices (+ Fable 5).
Deterministic-first — no LLM-judge per dispatch; agy host gap on record.

| # | Etapa | ADR | Motivo (why now) | Impacto | Tasks | Status |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | **Routing Phase 1 — frontmatter tiers + dispatch rules + matrix refresh** | 0052 | Every subagent burned session-model (premium) tokens; Claude Code enforces `model:` natively, zero engine code | Execution fan-outs ~5–10× cheaper per call (Haiku $0.275 vs Fable $2.75 on a typical /ship fan-out); cache-safe by construction | — | ✅ session 52 |
| 2 | **Routing Phase 2 — deterministic resolver + per-model attribution** | 0052 (follow-up) | The ≥60%-savings acceptance needs `byModel` data on top of D3; floors/escalation deserve code, not only skill text | `routing-policy.json` + `model-policy.mjs` (reuses router `loadMatrix`) + `selfcheck-model-policy` + `byModel` in token attribution | 139 | 📋 |
| 3 | **Swarm P0 — zero-code validation run** | 0051 §9 | One afternoon answers the two killer questions (cost/task, conflict rate) before any engine code | Baseline measured: 52–61K tok/task, 0/2 conflicts, sonnet+haiku tiers; the test-file-spillover finding now drives the planner | 123 (precondition) | ✅ session 52/56 |
| 4 | **Swarm v1 — grade-3 coordinator** | **0051** | The substrate is complete; what's missing is the coordinator: nothing pulls N backlog tasks into parallel governed workstreams | `/swarm` + pure `swarm-plan.mjs` + `swarm-state.mjs` manifest; `swarm-dispatch` area; `by` field on events; worktree-per-workstream; **finishes at `testing`, never `done`** — `/swarm review` batches human approval; 23-check integration test | 123 | ✅ session 52/56 |
| 5 | **Swarm v2 — grade-4** | 0051 §8 | Only after the ADR-0045 bar **plus ≥3 clean grade-3 swarm runs** (eligibility data accumulates passively — the real bottleneck) | Per-workstream hardened quorum, branch-only auto-push; permanently-grade-3 is an acceptable outcome | post-123 | 📋 |

**Refused / deferred, on record (ADR-0052 §7):** LLM-judge per dispatch (costs
what it saves + frozen quality opinions, ADR-0012 §5) · cross-CLI delegation
(spend invisible to `/token-report` ⇒ unmeasurable savings) · invented agy
Gemini mapping (host exposes no per-dispatch model API — rule 8).

## Design invariants (don't regress these)

- **Zero runtime deps on the hot path.** Levels 1–3 run with nothing installed.
- **Hooks never break real work.** Exit 0 on error; silent unless they must speak.
- **Everything is plain files in the repo.** Inspectable, reversible, no lock-in.
- **Config-driven, not hardcoded.** Stack specifics live in `contextkit/config.json`.
- **Advisory by default; enforce by choice.** Gates inform; you opt into blocking.
