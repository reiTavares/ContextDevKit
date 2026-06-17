# 🌀 ContextDevKit

[![CI](https://github.com/reiTavares/ContextDevKit/actions/workflows/ci.yml/badge.svg)](https://github.com/reiTavares/ContextDevKit/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/contextdevkit)](https://www.npmjs.com/package/contextdevkit)
![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)
![Zero deps](https://img.shields.io/badge/runtime%20deps-0-success)

> A portable, **level-based AI-assisted development platform** that runs natively
> on **Claude Code**, **Antigravity**, and **Codex**. Drop it into any project —
> greenfield or existing, any stack — and the *harness* starts enforcing durable
> project memory, automatic context loading, drift detection, specialized
> sub-agents, governed deliberation, and a workflow journey it won't let you skip.
> Turn on as much or as little as you want.

ContextDevKit treats "AI-assisted coding" as **engineering**. A plain `CLAUDE.md`
is just instructions the model is free to ignore; ContextDevKit makes the harness
*enforce* the rules with hooks and gates, and records the *why* in version control
so any future session — human or AI — can pick up exactly where the last one left off.

---

## What's new in v3.1.1

> **Feature merges + hotfix.** v3.1.0 added the final Capability Enforcement package (PKG-08 fleet & agent platform, ADR-0072), PKG-04 go-live with installer policy distribution (ADR-0097), and the WF0020 Economy Runtime (advisory output/lifecycle actuation). v3.1.1 then fixes a `--update` bug that could corrupt `config.json` path lists (with `/context-doctor` detection + safe recovery), and wires automatic model routing into real prompts. Routing **recommends and measures** in `shadow` mode — it records a decision per prompt and surfaces it on the Execution Contract, but it does **not** switch the session's model (no host supports an in-session switch from a hook), so a decision's `applied` is always `false`. Recommendation, selection and observation stay distinct; no economy is ever claimed for an unapplied route.

## What's new in v3.0.0

> **Major consolidation release.** v3.0.0 completes the Capability Enforcement program (PKG-05..07) with automatic model routing ([ADR-0094](contextkit/memory/decisions/0094-automatic-model-routing-and-cost-control-defaults.md)), EACP economic measurement, and 7 lineage-graph consumers. All routing is advisory/fail-open, benchmarks are scaffolds.

---

## The 60-second mental model

Everything in the kit serves one thesis: **don't depend on the AI's goodwill — make
the environment enforce it.** Four durable artifacts, all in your repo, all plain text:

| Artifact | Question it answers | Where |
|---|---|---|
| **ADRs** | *Why* did we decide this? | `contextkit/memory/decisions/` |
| **Session logs** | *What* happened, session by session? | `contextkit/memory/sessions/` |
| **Glossary** | What does this domain word *mean* in code? | `contextkit/memory/GLOSSARY.md` |
| **Changelog** | What shipped, and when? | `CHANGELOG.md` |

Around those, **hooks** inject context at session start, track every edit, and
*block* the session from ending with unregistered work — while **gates** stop a
high-risk edit, a half-finished workflow, or an unreviewed decision from sliding
through. You adopt it gradually through **seven levels**, and a separate
**autonomy dial** decides how much the AI may do without asking.

<details>
<summary><strong>Earlier highlights (v2.7 — governance enforcement)</strong></summary>

| System | What it does | Deep dive |
|---|---|---|
| **ContextKit parity import** ([ADR-0060 → 0068](contextkit/memory/decisions/)) | Eight zero-dep, level-aware, warn-first features ported from `nolrm/contextkit`: PostToolUse auto-format, multi-language pre-push quality gates, hook-manager coexistence, an opt-in CI squad action, a ≥3-occurrence standards-promotion threshold, `/context-budget` + `@`-imports, marker-idempotent injection, and **context bridges for six more tools** (Cursor, Copilot, Gemini, Windsurf, Aider, Continue — context only, governance stays native) | [docs/explanation/contextkit-parity.md](docs/explanation/contextkit-parity.md) |
| **Deliberation council** ([ADR-0070](contextkit/memory/decisions/0070-auto-invoked-deliberation-and-tiered-council.md)) | Multi-agent deliberation is now **auto-invoked** at the two moments it matters — opening a feature and recording a decision — at autonomy grade ≥ 3. A deterministic, *named* specialist council scales to the question; a tiered research swarm gathers evidence cheaply (Haiku scouts) before the reasoning voices (Opus) argue. The ADR write itself stays manual at every grade | [docs/explanation/deliberation-council.md](docs/explanation/deliberation-council.md) |
| **Workflow governance** ([ADR-0071](contextkit/memory/decisions/0071-workflow-numbering-and-journey-gate.md)) | The `/workflow` journey is now **enforced in the engine**: `advance` refuses to leave a phase with missing deliverables (every CLI held to the same bar), `--force` is the explicit escape. Workflows are numbered `NNNN-slug` like ADRs, and the L5 mutation guard is **branch-scoped** so a parallel session no longer blocks unrelated edits | [docs/explanation/workflow-governance.md](docs/explanation/workflow-governance.md) |

</details>

<details>
<summary><strong>Earlier highlights (v2.6 — active squads)</strong></summary>

| Feature | What it does |
|---|---|
| **Active agent squads** ([ADR-0069](contextkit/memory/decisions/0069-active-agent-squads-integration.md)) | Turns passive, declared squads into a governed routing layer: deterministic routing (`squads-registry.json` + `/squad route`), explicit posture activation (`/squad activate`), stack-aware playbook templates for all 8 squads, and compliance auto-auditing at the pre-commit gate. Token-minimized posture assembly via `squad-director.mjs`. See [docs/explanation/active-squads.md](docs/explanation/active-squads.md) |
| **Stack-aware QA scaffolding** | `/test-plan` and `/scaffold-tests` start from `scaffold-tests.mjs`, a zero-dep script that detects Node/JavaScript, Python, Go, Rust, and PHP, emits happy/edge/failure cases, and writes starter harness tests only with explicit `--write` |
| **Autonomy dial** ([ADR-0041–0045, 0058](contextkit/memory/decisions/)) | `autonomy.grade` 1–4 — a consent axis orthogonal to levels, with a non-negotiable floor in code (secrets, force-push, gate self-edits, ADRs, grade changes stay human at every grade) |
| **Swarm coordinator** ([ADR-0051](contextkit/memory/decisions/)) | `/swarm` runs N disjoint backlog tasks in parallel worktrees under the full governance stack; a run finishes at `testing`, never `done` |
| **Cost-tiered model routing** ([ADR-0052](contextkit/memory/decisions/)) | Every agent declares a `model:` tier (`opus` thinks · `sonnet` builds · `haiku` executes); skills classify the task at dispatch with floors (security never below `sonnet`). Cache-safe by construction |

</details>

<details>
<summary><strong>Earlier highlights (v1.15–v2.5 — multi-host hardening)</strong></summary>

| Feature | What it does |
|---|---|
| **Codex + Antigravity native hosts** ([ADR-0036, 0056](contextkit/memory/decisions/)) | Two more first-class hosts alongside Claude Code, regenerated deterministically from the Claude sources; selfcheck parity guards fail if a host diverges |
| **`/project-map`** ([ADR-0038–0040](contextkit/memory/decisions/)) | Deterministic, zero-AI-token structural map — stack, modules, exported symbols, and a module dependency graph for blast-radius reasoning |
| **`/debate`** ([ADR-0035](contextkit/memory/decisions/0035-deliberations-multi-agent-debate-artifact.md)) | The manual deliberation artifact the v2.7 council automates: independent voices argue, a synthesizer converges, the artifact feeds an ADR |
| **Landing-page + SEO/AISO** ([ADR-0023, 0025, 0050](contextkit/memory/decisions/)) | `landing-architect` + `conversion-strategist` agents, the anti-Lovable playbook, and `/seo-audit` running 16 static SEO + AI-Search-Optimization checks |
| **Host-modular installer** ([ADR-0037](contextkit/memory/decisions/0037-host-modular-installer.md)) | `install.mjs` is a thin orchestrator over `tools/install/` — adding a host is one module + one call |

</details>

## Requirements

- **Node.js ≥ 18** — the hooks/scripts are plain `.mjs`; **Levels 1–3 need zero npm
  packages**. Node 20.6+ unlocks `--env-file` for the media-gen credentials flow.
- **git** — for divergence detection and the Level 3 git hooks.
- **Claude Code**, **Antigravity**, or **Codex** (IDE agent, CLI, desktop, or web).
- *Optional:* `gh` (GitHub CLI) for PR/sync awareness; `GOOGLE_AI_API_KEY` for `/media-gen`.

## Quickstart

**One command, from anywhere** — the repo *is* the installer.

**First, pick how the kit lives in git** (you can switch later — it's non-destructive):

| Mode | When | What it does |
| --- | --- | --- |
| **Local-only** *(default)* | Solo work, an experiment, or trying the kit | Writes a managed `.git/info/exclude` block so the installed artifacts (`contextkit/`, `.claude/`, `CLAUDE.md`, …) stay out of your git history — updates never flood your commits. Your teammates and CI **won't** see the kit. [ADR-0054] |
| **Tracked** *(`--tracked`)* | A team, multiple machines, or CI that needs the kit | Skips the exclude block so you can `git add` and commit the kit — everyone who clones gets the same memory, agents, and governance. |

Not sure? Start **local-only** (just run the command below). Move to tracked the moment a second person or machine needs the kit: re-run with `--tracked` and `git add` the artifacts — switching only toggles the exclude block, it never touches your index or edits. `/context-doctor` reports your current mode and flags a local-only kit in a repo that already has a remote.

```bash
# from npm (recommended) — auto-picks L3 for an empty folder, L7 if it already has code
npx contextdevkit --target . --yes

# or straight from GitHub (no npm needed)
npx github:reiTavares/ContextDevKit --target . --yes

# team / multi-machine / CI — commit the kit instead of keeping it local-only
npx contextdevkit --target . --tracked --yes
```

Greenfield? Run it in an empty (or `git init`-ed) folder and it scaffolds the whole
thing. Existing project? It detects your stack, **never clobbers your `CLAUDE.md`**
(it writes `CLAUDE.contextdevkit.md` to merge by hand), and preserves any hooks you
already had.

Then, **one-shot self-configuration** — open the project in Claude Code, approve the
hooks once, and the boot hook tells you it isn't configured yet. Run:

```
/setupcontextdevkit
```

This inspects the project, tunes the config to your stack (`ledger` path lists,
high-risk paths), fills in `CLAUDE.md` (rules, stack, glossary), scaffolds domain
sub-agents, records a baseline ADR, and logs the session — going from "kit installed"
to "kit fitted to *this* project" in a single pass.

```text
$ npx contextdevkit --target . --yes
✓ .claude/settings.json wired for L7
✓ engine installed (contextkit/runtime, contextkit/tools)
✓ slash commands installed · agents installed · providers installed
✓ CLAUDE.md created  ·  CHANGELOG.md created
✅ ContextDevKit installed at Level 7 (existing project — full toolkit)

> /setupcontextdevkit
  Phase 1 — Inspect ……  detected: TypeScript · Vite · React · vitest
  Phase 3 — Apply ……    ledger tuned (src/, tests/); high-risk: src/db/schema.ts
  Phase 4 — CLAUDE.md …  stack + immutable rules filled in
  Phase 7 — baseline ADR-0001 recorded; session logged
  ✅ ContextDevKit fitted to this project.
```

> **Security & trust — read before installing.** ContextDevKit is a code-execution
> tool: install it like any dependency you run. `npx` writes git hooks under
> `.git/hooks/` (L≥3) and Claude Code hooks into `.claude/settings.json`, which then
> run `node` on each session/commit/push. **Pin a tag** for a reproducible install:
> `npx github:reiTavares/ContextDevKit#v3.0.0 --target . --yes`. An existing git hook
> is never clobbered (backed up to `<hook>.bak`). `/fleet` and custom
> `contextkit/detectors/*.mjs` execute with full Node privileges — only register
> repos and add detectors you trust.

## The seven levels

| Level | Name | Adds |
| --- | --- | --- |
| **1** | Memory | Boot context injection, `/log-session`, ADRs, changelog |
| **2** | Ledger | Drift detection — tracks edits, nudges you to register the session |
| **3** | Multi-session | `/claim` · `/worktree-new`, derived indices, git hooks (Conventional Commits + conflict-blocking pre-push + multi-language quality gates) |
| **4** | Squads | Specialized sub-agents (devteam, qa-team, design-team, security-team, compliance-team, ops-team) + PostToolUse auto-format |
| **5** | Proactive | `/simulate-impact` gate on high-risk paths, branch-scoped workflow guard, `/tech-debt-sweep`, `/contract-check`, auto-distill nudge |
| **6** | Autonomy & Insight | `/ship`, `/swarm`, `/pipetest`, the auto-invoked deliberation council, `/retro`, `/context-stats`, agent-forge squad |
| **7** | Ecosystem | `/fleet` multi-repo control plane, `/tune-agents`, visual tests, playbook runner, multi-platform context bridges |

> **The autonomy dial is orthogonal to levels.** `autonomy.grade` (1 manual ·
> 2 suggest *default* · 3 auto-except-decisions · 4 full-auto, experimental) decides
> what the AI may do *without asking*, at any level — set it with `/autonomy`. A
> non-negotiable floor in code keeps secrets, force-push, gate self-edits, ADRs, and
> grade changes human at every grade. See [ADR-0041–0045, 0058](contextkit/memory/decisions/).

Change level anytime, from inside the project:

```bash
node contextkit/tools/scripts/context-level.mjs        # show
node contextkit/tools/scripts/context-level.mjs 4      # move to L4 (or /context-level 4)
```

Going up adds capability; going down cleanly removes the now-disabled hooks. See
[docs/LEVELS.md](docs/LEVELS.md).

## Governance — what the harness enforces

This is the part that doesn't rely on the AI remembering. Three layers, each
documented in its own explanation doc:

- **Hooks & gates.** Boot context injection, edit tracking, a Stop hook that blocks
  ending with unregistered work, the L5 `/simulate-impact` gate on high-risk paths,
  and (parity import) PostToolUse auto-format + multi-language pre-push quality gates.
- **Deliberation council** ([explanation](docs/explanation/deliberation-council.md)).
  At grade ≥ 3, opening a feature or recording a decision auto-convenes a
  deterministic, named specialist council that argues the question before the ADR is
  written — evidence gathered cheaply, voices never downgraded.
- **Workflow journey** ([explanation](docs/explanation/workflow-governance.md)).
  `/workflow` won't let `advance` leave a phase with empty deliverables; `--force` is
  the explicit, recorded escape. Numbered `NNNN-slug`; the mutation guard is
  branch-scoped so parallel sessions don't block each other.

For larger features, `/workflow` creates a spec pack in
`contextkit/memory/workflows/<slug>/` (`prd.md`, `spec.md`, ADR/task indexes, daily
reports). The lifecycle:

```text
intake → prd → spec → adr → roadmap(if feature) → pipeline → ship → testing → conclusion
```

Pipeline cards link back with `--workflow <slug>`; moving a card to `testing` stamps
`implemented: YYYY-MM-DD`; QA sign-off remains the governed path into `conclusion`.

## Squads — sub-agents organised by domain

Each squad has a **router agent** that picks specialists by intent. As of v2.6 the
squads are *active*: routed deterministically, given stack-aware playbooks, and
audited at the pre-commit gate — see [docs/explanation/active-squads.md](docs/explanation/active-squads.md).

| Squad | Specialists | When |
|---|---|---|
| **devteam** | `architect`, `code-reviewer`, `context-keeper`, `test-engineer` | Cross-cutting design + PR review + memory hygiene |
| **qa-team** | `qa-orchestrator` + `qa-unit` / `qa-integration` / `qa-fuzzer` / `qa-perf` / `qa-e2e` | Testing strategy + execution |
| **design-team** | `ui-designer`, `ux-designer`, `accessibility`, `seo-specialist`, `landing-architect`, `conversion-strategist`, `tracking-integrator` | UI/UX, WCAG AA, SEO + AISO, high-conversion landing pages ([ADR-0050](contextkit/memory/decisions/)) |
| **security-team** | `security`, `code-security`, `infra-security` | Auth, secrets, dependencies, IaC, supply chain |
| **compliance-team** | `privacy-lgpd`, `governance-officer` | LGPD (Brazilian data protection), policy |
| **ops-team** | `devops` | CI/CD, deploys, environments, observability |
| **agent-forge** *(L6+)* | `forge-orchestrator`, `model-router`, `prompt-engineer`, `tool-designer`, `eval-designer`, `packager`, `rag-designer`, `agent-architect` | The "agent that builds agents" — produces portable Agent Packages |

Grow your own — or new squads — from `_BRIEFING.md.tpl` via `/squad`. See
[docs/SQUADS/design-team.md](docs/SQUADS/design-team.md) and
[docs/SQUADS/agent-forge.md](docs/SQUADS/agent-forge.md) for two squads in depth.

## What gets installed into your project

```
your-project/
  CLAUDE.md                          # boot context + your coding constitution
  .claude/
    settings.json                    # hook wiring (composed for your level)
    commands/                        # the slash-command set, organised in packs
      audit/ pipeline/ qa/ vcs/ forge/ setup/   # domain packs (see Slash commands)
    agents/                          # the sub-agent archetypes, each with a cost tier (L4+)
  .agents/                           # Antigravity host (skills, personas, playbooks — built from Claude sources)
  INSTRUCTIONS.md  ·  ctx.mjs        # Antigravity boot context + central CLI runner (agy)
  .codex/  ·  AGENTS.md  ·  cdx.mjs  # Codex host (hooks + TOML subagents + boot context + runner)
  contextkit/
    .env.example                     # optional credentials template (media-gen)
    runtime/hooks/                   # the engine: boot, ledger, drift, L5 gate, auto-format, deliberation-nudge
    runtime/config/                  # zero-dep loader, defaults, settings composer
    runtime/git-hooks/               # pre-commit (reindex), commit-msg, pre-push (conflicts + quality gates)
    runtime/providers/review/        # PR/review CLI adapters (gh)
    runtime/providers/media/         # Veo + Nano Banana adapters
    runtime/state/                   # canonical append-only state.json substrate (ADR-0015/0043)
    tools/scripts/                   # reindex, dashboard, sync-check, guard, swarm, deliberation-council, audits, …
    memory/decisions/                # ADRs (the why)
    memory/sessions/                 # one file per session (the what)
    memory/workflows/                # /workflow spec packs (NNNN-slug)
    memory/GLOSSARY.md
    pipeline/                        # DevPipeline lanes: backlog / working / testing / conclusion
    workflows/playbooks/             # tanstack, landing-page, seo-aiso, tech-debt-sweep, squads/…
    squads/agent-forge/              # the "agent that builds agents" (L6+)
    config.json                      # level + ledger path lists + L5 params + autonomy grade
  CHANGELOG.md
```

## Slash commands

Organised into **domain packs** so the `/` menu doesn't read as a 60-file scroll.
The basename resolver is path-agnostic — `/qa-signoff` finds `qa/qa-signoff.md`
exactly the same as a flat layout.

**Setup:** `/aidevtool-from0` (empty project) · `/setupcontextdevkit` (existing project)

**Daily** (root pack): `/state` · `/log-session` · `/new-adr` · `/debate` · `/advise`
· `/close-version` · `/context-refresh` · `/project-map` · `/bug-hunt` · `/dashboard`
· `/watch` · `/landing-page` · `/media-gen` · `/playbook` · `/predictions-review`
· `/squad` · `/context-budget` · `/token-report` · `/tune-agents` · `/context-stats`
· `/fleet` · `/distill-sessions` · `/distill-apply` · `/simulate-impact` · `/roadmap`
· `/claude-md` · `/docs-reindex`

**`pipeline/`:** `/pipeline` · `/ship` · `/swarm` · `/pipetest` · `/dev-start`
· `/plan-week` · `/retro` · `/runs` · `/workflow` · `/workflow-assist` · `/resume`

**`vcs/`:** `/git` · `/claim` · `/release` · `/worktree-new` · `/gh-triage`
· `/draft-changelog` · `/changelog-social`

**`qa/`:** `/qa-signoff` · `/test-plan` · `/scaffold-tests` · `/visual-test`

**`audit/`:** `/audit` · `/deep-analysis` · `/security-setup` · `/deps-audit` ·
`/tech-debt-sweep` · `/analyze-code-ia-practices` · `/contract-check` · `/seo-audit`
· `/validate-doc`

**`forge/`** (L6+, agent-forge squad): `/forge-new` and 13 lifecycle commands
(`forge-{list,show,doctor,policy,budget,audit,eval,redteam,route,fallback-test,refresh-matrix,killswitch,deprecate}`)

**`setup/`:** `/setupcontextdevkit` · `/aidevtool-from0` · `/autonomy`
· `/context-doctor` · `/context-level` · `/context-config`

On **Antigravity** every command is a **skill** under `.agents/skills/` (same names,
no `/` prefix), run through the `agy` runner — see [docs/ANTIGRAVITY.md](docs/ANTIGRAVITY.md).
On **Codex**, generated skills live under `.agents/skills/`, subagents under
`.codex/agents/*.toml`, and the same scripts run through `node cdx.mjs <command>` —
see [docs/CODEX.md](docs/CODEX.md).

## Beyond governance — the rest of the toolkit

<details>
<summary><strong>Playbooks</strong> — reusable procedures (`/playbook run <name>`)</summary>

| Playbook | Authority | What it covers |
|---|---|---|
| **`landing-page.md`** | [ADR-0023](contextkit/memory/decisions/0023-landing-page-and-conversion-posture.md) | Fold rules, anti-Lovable refusals, dated package recs, Core Web Vitals budget |
| **`seo-aiso.md`** | [ADR-0025](contextkit/memory/decisions/0025-seo-and-aiso-posture.md) | SEO + AISO checklist (`llms.txt`, FAQ schema, semantic HTML5, AI-crawler robots.txt) |
| **`tanstack.md`** | [ADR-0017](contextkit/memory/decisions/0017-tanstack-stack-recognition-and-opt-in-starter.md) | TanStack family, cache-key discipline, typed router params |
| **`simulate-impact.md` / `tech-debt-sweep.md` / `distillation-cycle.md`** | L5 gates/audits | Blast-radius mapping, constitution scan, CLAUDE.md refinement |
| **`security-batch.md`** | security-team | Batch security findings → ADRs + backlog |
| **`squads/*.md`** | [ADR-0069](contextkit/memory/decisions/0069-active-agent-squads-integration.md) | Stack-aware posture guide per active squad |

</details>

<details>
<summary><strong>Provider adapters</strong> — zero-dep, refuse-on-missing-creds</summary>

Pluggable runtime adapters (`node:fetch` / `child_process.spawn`) with a typed error
contract.

- **Review** (`contextkit/runtime/providers/review/`): `gh` CLI for PR creation,
  review-comment listing, and posting. Add `glab.mjs` / `bb.mjs` / `tea.mjs` for
  GitLab / Bitbucket / Gitea — same `_adapter.mjs` contract; `detect.mjs` resolves
  from `git remote get-url origin`.
- **Media** (`contextkit/runtime/providers/media/`): `nano-banana` (Imagen 3 image,
  ~$0.04/image) and `veo` (Veo 3 video, ~$0.50/s), both on `GOOGLE_AI_API_KEY`.
  Cap per-process spend with `CONTEXTDEVKIT_MEDIA_MAX_USD=5.00`; `--dry-run` never charges.

```bash
node --env-file=contextkit/.env contextkit/tools/scripts/media-gen.mjs image \
  --prompt "editorial product hero, asymmetric grid" --out public/hero.png
```

</details>

<details>
<summary><strong>SEO + AISO audit</strong> — two static analysers, refuse-on-SPA</summary>

```bash
node contextkit/tools/scripts/seo-audit.mjs           # 8 SEO codes, exit 1 on SPA_ENTRYPOINT
node contextkit/tools/scripts/aiso-audit.mjs --json   # 8 AISO codes, machine-readable
```

SEO: `SPA_ENTRYPOINT` ⚠️, `MISSING_TITLE`, `MISSING_DESCRIPTION`, `MULTIPLE_H1`,
`MISSING_CANONICAL`, `MISSING_ALT`, `MISSING_SITEMAP`, `MISSING_ROBOTS`.
AISO: `MISSING_LLMS_TXT`, `MISSING_FAQ_SCHEMA`, `MISSING_ORG_SCHEMA`, `DIV_SOUP`,
`JS_RENDERED_CONTENT`, `MISSING_AUTHOR_SCHEMA`, `MISSING_DATE_STAMP`, `BLOCKS_AI_CRAWLERS`.
See [ADR-0025](contextkit/memory/decisions/0025-seo-and-aiso-posture.md).

</details>

<details>
<summary><strong>Visual surfaces</strong> — <code>/dashboard</code> + <code>/watch</code></summary>

```bash
node contextkit/tools/scripts/dashboard.mjs              # snapshot → dashboard.html
node contextkit/tools/scripts/dashboard.mjs --watch      # live on 127.0.0.1:4242 (SSE)
node contextkit/tools/scripts/watch.mjs --follow         # tail the ledger
```

`/dashboard` renders pipeline lanes + ADRs + sessions + roadmap + `[Unreleased]`
changelog as self-contained HTML; `/watch` tails the active session ledger.

</details>

## Roadmap vs DevPipeline

Two different artifacts. **`contextkit/memory/roadmap.md`** is the *product/business
plan* (capabilities, P-IDs, the what/why). The **DevPipeline**
(`contextkit/pipeline/`, board in `devpipeline.md`) is *execution control* — bugs,
increments, chores, and roadmap items broken into tasks with priority, SLA, DAG
dependencies, and complexity, flowing `backlog → working → testing → conclusion`.
The roadmap says *what* to build; the pipeline *runs* the work.

## Maintenance

```bash
# diagnose an install (node, config, hook wiring vs level, git hooks, onboarding)
/context-doctor          # or: agy doctor / node contextkit/tools/scripts/doctor.mjs

# safe update — refresh engine, commands, agents, configs
# (never modifies user-authored memory, CLAUDE.md, or custom settings;
#  project-map may be generated/refreshed when safe — deferred on active sessions)
npx contextdevkit@latest --target . --update

# change level (rewires settings.json, installs git hooks at L≥3)
/context-level 4

# uninstall — keeps memory (ADRs, sessions) and CLAUDE.md; add --purge to also remove the engine
node /path/to/contextdevkit/install.mjs --target . --uninstall
```

`--update` runs a conflict-safe 3-way merge against a sha256 manifest (personalized
commands/agents are never clobbered), refreshes the installed `contextkit/README.md`,
regenerates `docs/README.md`, and runs the workflow-numbering migration — but does
**not** take ownership of your project's root `README.md`.

## Develop the kit itself

### Test scripts

| Script | When to run | What it does |
|---|---|---|
| `npm run test:smoke` | Inner loop — after every local edit | Hermetic, no-install suites (~1.5 s) |
| `npm run test:impact` | Inner loop — conservative auto-selector | Runs only the suites touched by changed files; falls back to full on any uncertainty |
| `npm run test:selfcheck` | After wiring changes | Static engine checks (660+ assertions); quiet on pass (`selfcheck: N/N`) |
| `npm run test:unit` | Alias for smoke + selfcheck | `test:smoke` then `test:selfcheck` |
| `npm run test:integration` | Before opening a PR | All six integration clusters (core / installer / hosts / workflow / enforcement / ecosystem) |
| `npm run test:integration:<cluster>` | Closing a card in that area | One cluster: `core`, `installer`, `hosts`, `workflow`, `enforcement`, `ecosystem` |
| `npm run test:full` | Named alias for the full run | Identical to `npm test` — every suite, serial, fail-fast |
| `npm test` | Pre-push / CI baseline | Full suite; **behavior preserved** — external callers unaffected |
| `npm run ci:fast` | PR gate (CI runs this) | `test:impact` + tech-debt RED-line; single Node version; uploads `runs/` logs |
| `npm run ci:full` | Main/release gate (CI + pre-publish) | Full suite + tech-debt; runs on Node 18/20/22; **mandatory before release** |
| `npm run ci` | Alias for `ci:full` | Same as `ci:full` — legacy callers are safe |

`npm test`, `npm run ci`, and `npm run check` keep their exact meaning — external
`npx`/automation callers are unaffected. Logs land in the gitignored `runs/` directory;
`--verbose` on any suite restores full output; `--legacy` on `run-suites.mjs` executes
the literal pre-TEA serial chain (rollback escape hatch).

```bash
npm run test:smoke            # fast hermetic pass after an edit
npm run test:impact           # conservative selector — inner loop for larger changes
npm test                      # full suite (selfcheck + all integration tests)
npm run ci:full               # full gate + tech-debt RED-line (validate before pushing)
node tools/selfcheck.mjs      # static: loads the engine, asserts wiring per level
node tools/integration-test.mjs  # end-to-end: installs to a temp dir, drives real hooks
npm run build:antigravity     # regenerate .agents skills/personas from templates/claude
npm run build:codex           # regenerate .codex agents + source-command skills
```

The kit dogfoods itself, so the SOURCE lives under `templates/` and `tools/` — never
edit the installed `contextkit/` copies. See [CONTRIBUTING.md](CONTRIBUTING.md) for the
immutable rules (zero hot-path deps, hooks never break work, add a test for anything you add).

## Docs

Organized by [Diátaxis](https://diataxis.fr/) — see [docs/README.md](docs/README.md) for the full index.

**Explanation — the *why*:**
- [docs/explanation/contextkit-parity.md](docs/explanation/contextkit-parity.md) — the eight parity-import features and their safety posture.
- [docs/explanation/deliberation-council.md](docs/explanation/deliberation-council.md) — auto-invoked, tiered, named deliberation.
- [docs/explanation/workflow-governance.md](docs/explanation/workflow-governance.md) — the engine-enforced workflow journey.
- [docs/explanation/active-squads.md](docs/explanation/active-squads.md) — passive → actively-routed, governed squads.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the engine works internally (hooks, providers, state substrate).
- [docs/ANTIGRAVITY.md](docs/ANTIGRAVITY.md) · [docs/CODEX.md](docs/CODEX.md) — the two non-Claude native hosts.

**Reference & how-to:**
- [docs/LEVELS.md](docs/LEVELS.md) — what each level does and when to climb.
- [docs/CUSTOMIZING.md](docs/CUSTOMIZING.md) — tune config, add agents/commands, provider adapters, rebrand.
- [docs/SQUADS/design-team.md](docs/SQUADS/design-team.md) · [docs/SQUADS/agent-forge.md](docs/SQUADS/agent-forge.md) — squads in depth.
- [docs/AGENT-PACKAGE-FORMAT.md](docs/AGENT-PACKAGE-FORMAT.md) · [docs/SQUAD-PIPELINE-FORMAT.md](docs/SQUAD-PIPELINE-FORMAT.md) — agent-forge specs.
- [docs/ROADMAP.md](docs/ROADMAP.md) — architect analysis, the L6/L7 capability tiers, future directions.

🇧🇷 Guia em português: [instrucoes.md](instrucoes.md).

## License

MIT — see [LICENSE](LICENSE).
