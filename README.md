# 🌀 ContextDevKit

[![CI](https://github.com/reiTavares/ContextDevKit/actions/workflows/ci.yml/badge.svg)](https://github.com/reiTavares/ContextDevKit/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/contextdevkit)](https://www.npmjs.com/package/contextdevkit)
![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen)
![License](https://img.shields.io/badge/license-MIT-blue)
![Zero deps](https://img.shields.io/badge/runtime%20deps-0-success)

> A portable, **level-based AI-assisted development platform** for **Claude Code**, **Antigravity**, and **Codex**.
> Drop it into any project — greenfield or existing, any stack — and get durable
> project memory, automatic context loading, drift detection, specialized
> sub-agents, **opinionated playbooks** (TanStack, landing pages, SEO+AISO), and
> proactive governance. Activate as much or as little as you want.

ContextDevKit is the generalized, stack-agnostic distillation of a production context
system. It treats "AI-assisted coding" as **engineering**: instead of hoping the AI
remembers things, it makes the harness *enforce* them with hooks, and it records
the *why* in version control so any future session — human or AI — can pick up
where the last one left off.

## What's new in v2.6

> **Stack-aware QA on top of governed autonomy.** v2.6 keeps the v2 control
> plane — consent dial, observable pipeline state, swarm coordination, and
> cost-aware model routing — and gives the QA squad a deterministic stack map
> before it proposes or writes tests.

| Feature | What it does |
|---|---|
| **Stack-aware QA scaffolding** | `/test-plan` and `/scaffold-tests` now start from `scaffold-tests.mjs`, a zero-dep script that detects Node/JavaScript, Python, Go, Rust, and PHP manifests, reports the existing runner/framework signals, emits happy/edge/failure QA cases, and creates starter harness tests only with explicit `--write` |
| **Autonomy dial** ([ADR-0041–0045](contextkit/memory/decisions/)) | `autonomy.grade` 1–4 — a **consent axis orthogonal to levels** (levels = what the kit *can* do; grade = what it *may* do without asking). One pure `resolveAutonomy(area)` resolver; a **non-negotiable floor in code** (secrets, force-push, gate self-edits, ADRs, grade changes stay human at every grade). Set with `/autonomy`. Grade 4 is gated by a measured eligibility bar + a per-step kill-switch |
| **Swarm coordinator** ([ADR-0051](contextkit/memory/decisions/)) | `/swarm` pulls N disjoint backlog tasks and runs each in its own git worktree, in parallel, under the full governance stack — pure `swarm-plan.mjs` planner (disjoint partition, refuse-by-default) + `swarm-state.mjs` manifest. A run **finishes at `testing`, never `done`** — you close the batch via `/swarm review` |
| **Cost-tiered model routing** ([ADR-0052](contextkit/memory/decisions/)) | Every agent declares a `model:` tier (`opus` thinks · `sonnet` builds · `haiku` executes · `inherit`); skills classify the task at dispatch (think vs execute) with floors (security never below `sonnet`) and budget-aware de-escalation. Cache-safe by construction — only spawned subagents are tiered |
| **Deterministic QA sign-off** ([ADR-0055](contextkit/memory/decisions/)) | `/pipetest` runs the suite; green + complete acceptance criteria ⇒ `qa-approve` testing cards into `conclusion` (actor `qa`, evidence on the card); red ⇒ report and bounce only attributable failures. The verdict is the **suite's exit code**, never an opinion |
| **Observable pipeline substrate** ([ADR-0043](contextkit/memory/decisions/)) | Every pipeline move appends to an **append-only `state.json` event log** (`actor: human\|auto\|qa\|evict`, recorded inverse for reversibility); `auto` can never enter `conclusion`. `/runs` reads the machine |
| **Dogfood-by-default install** ([ADR-0054](contextkit/memory/decisions/)) | Fresh installs leave **zero tracked kit files** (a managed `info/exclude` block), and `--update` runs a conflict-safe 3-way merge against a sha256 manifest — personalized commands/agents are never clobbered, no side is ever lost. Opt out with `--tracked` |

<details>
<summary><strong>Earlier highlights (v1.15–v1.17 — dual-host hardening)</strong></summary>

| Feature | What it does |
|---|---|
| **`agy guard <path>`** | Explicit L5 pre-edit checkpoint for the hook-less Antigravity host — exit 0 = allowed, exit 1 = run `/simulate-impact` first. Same gate definition as Claude Code's automatic PreToolUse hook |
| **`/project-map`** ([ADR-0038–0040](contextkit/memory/decisions/)) | Deterministic, zero-AI-token structural map — stack, modules (🎨/⚙️/🔗/🛠️), exported symbols, and a **module dependency graph** for blast-radius reasoning. Churn-free fingerprint; clone-safe staleness nudge at boot |
| **`/debate`** ([ADR-0035](contextkit/memory/decisions/0035-deliberations-multi-agent-debate-artifact.md)) | Multi-agent deliberations: independent voices argue a hard question, a synthesizer converges (or records `unresolved`), the artifact feeds an ADR's Context |
| **Deterministic host build** | `npm run build:antigravity` and `npm run build:codex` regenerate downstream host assets from the Claude sources; selfcheck parity guards fail if a host diverges |
| **Host-modular installer** ([ADR-0037](contextkit/memory/decisions/0037-host-modular-installer.md)) | `install.mjs` is a thin orchestrator over `tools/install/` (engine / claude / antigravity / codex / git) — adding a host is one module + one call |

</details>

<details>
<summary><strong>Earlier highlights (v1.7–v1.14)</strong></summary>

| Feature | What it does |
|---|---|
| **Antigravity integration** ([ADR-0036](contextkit/memory/decisions/0036-antigravity-second-native-host.md)) | Native second host: skills, personas, playbooks, workflows, `session-manager.mjs` explicit lifecycle, `INSTRUCTIONS.md` boot context |
| **Landing-page skills** ([ADR-0023](contextkit/memory/decisions/0023-landing-page-and-conversion-posture.md)) | `landing-architect` agent + `/landing-page` command + opinionated anti-Lovable playbook (fold rules min 3 / ideal 5–7 / max 9; dated package recs) |
| **Media generation** ([ADR-0024](contextkit/memory/decisions/0024-media-generation-veo-nano-banana.md)) | `/media-gen` with Veo (video) + Nano Banana (image) adapters; `.env`-based; refuse-on-missing-creds + per-process cost cap + content-addressed cache |
| **SEO + AISO** ([ADR-0025](contextkit/memory/decisions/0025-seo-and-aiso-posture.md)) | `seo-specialist` agent + `/seo-audit` running 16 static checks (SEO + AI Search Optimization); refuse-on-unindexable SPAs |
| **GitHub sync awareness** ([ADR-0026](contextkit/memory/decisions/0026-github-sync-awareness-dev-flow.md)) | `sync-check.mjs` shows open PRs with CI/review status at `/dev-start` + detects duplicate PRs pre-push |
| **`/dashboard` + `/watch`** | Visual project state (kanban + ADRs + sessions + roadmap) — self-contained HTML or live SSE (`--watch`); ledger tail |
| **Pipeline lifecycle automation** ([ADR-0034](contextkit/memory/decisions/0034-pipeline-lifecycle-automation.md)) | ADR → backlog tasks, `/dev-start` auto-starts, Stop hook auto-concludes when acceptance criteria are all checked |
| **Provider adapters** | `runtime/providers/review/` (gh) + `runtime/providers/media/` (Veo + Nano Banana) — same five-point contract |

</details>

## Why

A plain `CLAUDE.md` is just instructions the AI can ignore. ContextDevKit adds the
parts that don't depend on the AI's goodwill:

- **Hooks** inject context at session start, track every edit, and *block* the
  session from ending with unregistered work.
- **Durable memory** — ADRs (the *why*), session logs (the *what*), a glossary
  (the naming authority), and an auto-generated changelog — all in your repo.
- **Levels (1–7)** so you adopt it gradually: start with memory only, turn on
  more as the project (and your trust) grows.
- **Squads of specialists** — devteam, qa-team, design-team (with SEO + landing
  architect), agent-forge, compliance-team, ops-team — each agent sharp and narrow.

## Requirements

- **Node.js ≥ 18** (the hooks/scripts are plain `.mjs`; Levels 1–3 need **zero**
  npm packages). Node 20.6+ unlocks `--env-file` for the media-gen credentials
  flow.
- **git** (for divergence detection and the Level 3 git hooks).
- **Claude Code**, **Antigravity**, or **Codex** (IDE agent, CLI, desktop, web).
- *Optional:* `gh` (GitHub CLI) for sync-check PR awareness; `GOOGLE_AI_API_KEY`
  for `/media-gen`.

## Install

**One command, from anywhere** (the repo is the installer):

```bash
# from npm (recommended) — auto-picks L3 for an empty folder, L7 if it already has code
npx contextdevkit --target . --yes

# or straight from GitHub (no npm needed)
npx github:reiTavares/ContextDevKit --target . --yes
```

Or clone and run locally:

```bash
# interactive — asks name / mode / level
node install.mjs --target /path/to/your-project

# non-interactive (omit --level to auto-pick L3/L7; pass --level <1-7> to pin one)
node install.mjs --target /path/to/your-project --name "My App" --yes
```

Greenfield? Run it in an empty (or `git init`-ed) folder and it scaffolds the
whole thing. Existing project? It detects your stack, never clobbers your
`CLAUDE.md` (it writes `CLAUDE.contextdevkit.md` to merge by hand), and preserves
any hooks you already had.

### Security & trust (read before installing)

ContextDevKit is a code-execution tool — install it like any dependency you run:

- **`npx` runs the installer**, which writes git hooks under `.git/hooks/` (at
  L≥3) and Claude Code hooks into `.claude/settings.json`. Those hooks then run
  `node` on each session/commit/push. **Pin a tag** for a reproducible install
  rather than tracking the moving default branch:
  `npx github:reiTavares/ContextDevKit#v2.6.0 --target . --yes`.
- **An existing git hook is never clobbered** — the installer backs it up to
  `<hook>.bak` before writing its wrapper. Worktrees are detected via the
  `gitdir:` pointer and hooks are installed in the resolved real `.git/`.
- **`/fleet`** reads/executes scripts across *other* repos you register, and
  **custom detectors** in `contextkit/detectors/*.mjs` are executed by the tech-debt
  scanner with full Node privileges. Only register repos and add detectors you
  trust — treat them as code review surface.

### Then: one-shot self-configuration

Open the project in Claude Code, approve the hooks once — and **ContextDevKit tells
you it isn't configured yet** (a first-run trigger fires from the boot hook).
Run:

```
/setupcontextdevkit
```

This inspects the project, tunes the config to your stack (`ledger` path lists,
high-risk paths), fills in `CLAUDE.md` (rules, stack, glossary), scaffolds domain
sub-agents, installs what's needed (with your OK), records a baseline ADR, and
logs the session — going from "kit installed" to "kit fitted to *this* project"
in a single pass. After it finishes, the trigger stops nagging.

### What you'll see

```text
$ npx contextdevkit --target . --yes
✓ .claude/settings.json wired for L7
✓ engine installed (contextkit/runtime, contextkit/tools)
✓ slash commands installed (.claude/commands)
✓ providers installed (review/, media/)
✓ CLAUDE.md created  ·  docs/CHANGELOG.md created
✅ ContextDevKit installed at Level 7 (existing project — full toolkit)

# open in Claude Code → the boot hook greets you with:
## 🚀 First run — ContextDevKit not configured yet  →  run /setupcontextdevkit

> /setupcontextdevkit
  Phase 1 — Inspect ……  detected: TypeScript · Vite · React · vitest
  Phase 3 — Apply ……    ledger tuned (src/, tests/); high-risk: src/db/schema.ts
  Phase 4 — CLAUDE.md …  stack + immutable rules filled in
  Phase 7 — baseline ADR-0001 recorded; session logged
  ✅ ContextDevKit fitted to this project.
```

## The seven levels

| Level | Name | Adds |
| --- | --- | --- |
| **1** | Memory | Boot context injection, `/log-session`, ADRs, changelog |
| **2** | Ledger | Drift detection — tracks edits, nudges you to register the session |
| **3** | Multi-session | `/claim` · `/worktree-new`, derived indices, git hooks (Conventional Commits + conflict-blocking pre-push) |
| **4** | Squads | Specialized sub-agents — devteam, qa-team, design-team (5 specialists incl. `seo-specialist` + `landing-architect`), compliance-team, ops-team |
| **5** | Proactive | `/simulate-impact` gate on high-risk paths, `/tech-debt-sweep` (deterministic), `/contract-check`, auto-distill nudge |
| **6** | Autonomy & Insight | `/ship` (orchestrated squad pipeline), `/swarm` (parallel coordinator), `/pipetest` (deterministic QA gate), `/retro`, `/context-stats`, agent-forge squad |
| **7** | Ecosystem | `/fleet` multi-repo control plane, `/tune-agents`, visual tests, playbook runner |

> **The autonomy dial is orthogonal to levels.** `autonomy.grade` (1 manual ·
> 2 suggest *default* · 3 auto-except-decisions · 4 full-auto, experimental)
> decides what the AI may do *without asking*, at any level — set it with
> `/autonomy`. A non-negotiable floor in code keeps secrets, force-push, gate
> self-edits, ADRs, and grade changes human at every grade. See
> [ADR-0041–0045](contextkit/memory/decisions/).

Change level anytime — from inside the project:

```bash
node contextkit/tools/scripts/context-level.mjs        # show
node contextkit/tools/scripts/context-level.mjs 4      # move to L4
```

…or via the `/context-level` slash command. Going up adds capability; going down
cleanly removes the now-disabled hooks. See [docs/LEVELS.md](docs/LEVELS.md).

## What gets installed into your project

```
your-project/
  CLAUDE.md                          # boot context + your coding constitution
  .claude/
    settings.json                    # hook wiring (composed for your level)
    commands/                        # the slash-command set, organised in packs
      audit/                         # security + tech-debt + SEO/AISO audits + validate-doc
      pipeline/                      # DevPipeline + ship + swarm + pipetest + dev-start + plan-week + retro + runs
      qa/                            # qa-signoff, test-plan, scaffold-tests, visual-test
      vcs/                           # git, claim, release, worktree-new, gh-triage, draft-changelog
      forge/                         # agent-forge lifecycle commands (L6+)
      setup/                         # setupcontextdevkit, autonomy, context-doctor, context-level
    agents/                          # the sub-agent archetypes, each with a cost tier (L4+)
  .agents/                      # Antigravity host (skills, personas, playbooks, workflows — built from the Claude sources)
  INSTRUCTIONS.md                    # Antigravity boot context (the host's CLAUDE.md)
  ctx.mjs                            # Central CLI runner (accessible as agy <command> or npm run ctx)
  .codex/                            # Codex host (hooks + TOML subagents generated from Claude sources)
  AGENTS.md                          # Codex boot context
  cdx.mjs                            # Codex runner alias over the same command dispatcher
  contextkit/
    .env.example                     # optional credentials template (media-gen)
    runtime/hooks/                   # the engine: boot, ledger, drift, L5 gate
    runtime/config/                  # zero-dep loader, defaults, settings composer
    runtime/git-hooks/               # pre-commit (reindex), commit-msg, pre-push (block conflicts)
    runtime/providers/
      review/                        # PR/review CLI adapters (gh)
      media/                         # Veo + Nano Banana adapters
    runtime/state/                   # canonical append-only state.json substrate (ADR-0015/0043)
    tools/scripts/                   # helper scripts (reindex, dashboard, sync-check, guard, swarm, audits, …)
    memory/decisions/                # ADRs (the why)
    memory/sessions/                 # one file per session (the what)
    memory/GLOSSARY.md
    pipeline/                        # DevPipeline lanes: backlog / working / testing / conclusion
    workflows/playbooks/             # tanstack, landing-page, seo-aiso, tech-debt-sweep, …
    squads/agent-forge/              # the "agent that builds agents" (L6+)
    config.json                      # level + ledger path lists + L5 params
  docs/CHANGELOG.md
```

## Slash commands

Organised into **domain packs** so the `/` menu doesn't read as a 60-file scroll.
The basename resolver is path-agnostic — `/qa-signoff` finds `qa/qa-signoff.md`
exactly the same as a flat layout.

**Setup:** `/aidevtool-from0` (empty project) · `/setupcontextdevkit` (existing project)

**Daily** (root pack): `/state` · `/log-session` · `/new-adr` · `/debate` · `/advise`
· `/close-version` · `/context-refresh` · `/project-map` · `/bug-hunt` · `/dashboard`
· `/watch` · `/landing-page` · `/media-gen` · `/playbook` · `/predictions-review`
· `/squad` · `/token-report` · `/tune-agents` · `/context-stats` · `/fleet`
· `/distill-sessions` · `/distill-apply` · `/simulate-impact` · `/roadmap`
· `/claude-md` · `/docs-reindex`

**`pipeline/`:** `/pipeline` · `/ship` · `/swarm` · `/pipetest` · `/dev-start`
· `/plan-week` · `/retro` · `/runs` · `/workflow` · `/resume`

**`vcs/`:** `/git` · `/claim` · `/release` · `/worktree-new` · `/gh-triage`
· `/draft-changelog` · `/changelog-social`

**`qa/`:** `/qa-signoff` · `/test-plan` · `/scaffold-tests` · `/visual-test`

`/test-plan` and `/scaffold-tests` first run the deterministic
`scaffold-tests.mjs` stack map. It detects Node/JavaScript, Python, Go, Rust,
and PHP, proposes stack-specific happy/edge/failure coverage, and only writes
starter harness files when invoked with `--write`; domain tests still belong to
the QA specialists after they inspect the code.

**`audit/`:** `/audit` · `/deep-analysis` · `/security-setup` · `/deps-audit` ·
`/tech-debt-sweep` · `/analyze-code-ia-practices` · `/contract-check` · `/seo-audit`
· `/validate-doc`

**`forge/`** (L6+, agent-forge squad): `/forge-new` and 13 lifecycle commands
(`forge-{list,show,doctor,policy,budget,audit,eval,redteam,route,
fallback-test,refresh-matrix,killswitch,deprecate}`)

**`setup/`:** `/setupcontextdevkit` · `/aidevtool-from0` · `/autonomy`
· `/context-doctor` · `/context-level` · `/context-config`

On **Antigravity** every command above is a **skill** under `.agents/skills/`
(same names, no `/` prefix), and the engine scripts run through the `agy` runner —
see [docs/ANTIGRAVITY.md](docs/ANTIGRAVITY.md).

On **Codex**, generated `source-command-*` skills live under `.agents/skills/`,
subagents live under `.codex/agents/*.toml`, and the same deterministic scripts
run through `node cdx.mjs <command>` — see [docs/CODEX.md](docs/CODEX.md).

## Workflow spec packs

For larger features and architecture changes, `/workflow` creates a spec pack in
`contextkit/memory/workflows/<slug>/`: `prd.md`, `spec.md`, ADR/task indexes,
handoff memory, and dated daily reports. The pack organizes context and evidence;
ADRs stay in `memory/decisions/`, roadmap stays in `memory/roadmap.md`, and
execution still belongs to the DevPipeline lanes.

The lifecycle is:

```text
intake -> prd -> spec -> adr -> roadmap(if feature) -> pipeline -> ship -> testing -> conclusion
```

Pipeline cards can link back with `--workflow <slug>` and
`--spec contextkit/memory/workflows/<slug>/spec.md`. Moving a card to `testing`
stamps `implemented: YYYY-MM-DD`; QA sign-off remains the governed path into
`conclusion`.

## Squads — sub-agents organised by domain

Each squad has a **router agent** that picks specialists by intent.

| Squad | Specialists | When |
|---|---|---|
| **devteam** | `architect`, `code-reviewer`, `context-keeper`, `test-engineer` | Cross-cutting design + PR review + memory hygiene |
| **qa-team** | `qa-orchestrator` + `qa-unit` / `qa-integration` / `qa-fuzzer` / `qa-perf` / `qa-e2e` | Testing strategy + execution |
| **design-team** | `ui-designer`, `ux-designer`, `accessibility`, `seo-specialist`, `landing-architect`, `conversion-strategist`, `tracking-integrator` | UI/UX, WCAG AA, SEO + AISO, high-conversion landing pages, consent-first tracking ([ADR-0050](contextkit/memory/decisions/)) |
| **security-team** | `security`, `code-security`, `infra-security` | Auth, secrets, dependencies, IaC, supply chain |
| **compliance-team** | `privacy-lgpd`, `governance-officer` | LGPD (Brazilian data protection), policy |
| **ops-team** | `devops` | CI/CD, deploys, environments, observability |
| **agent-forge** *(L6+)* | `forge-orchestrator`, `model-router`, `prompt-engineer`, `tool-designer`, `eval-designer`, `packager`, `rag-designer`, `agent-architect` | The "agent that builds agents" — produces portable Agent Packages |

Grow your own — or new squads — from `_BRIEFING.md.tpl` via `/squad`.
See [`docs/SQUADS/design-team.md`](docs/SQUADS/design-team.md) for the
landing-page + SEO/AISO specialists in detail and
[`docs/SQUADS/agent-forge.md`](docs/SQUADS/agent-forge.md) for the L6+ squad.

## Playbooks

Reusable procedures in `contextkit/workflows/playbooks/`. Run with `/playbook
run <name>` or read on demand:

| Playbook | Authority | What it covers |
|---|---|---|
| **`landing-page.md`** | [ADR-0023](contextkit/memory/decisions/0023-landing-page-and-conversion-posture.md) | Fold rules, anti-Lovable refusals, dated package recs (Astro, Tailwind, Motion, Lucide, Plausible, GrowthBook), Core Web Vitals budget |
| **`seo-aiso.md`** | [ADR-0025](contextkit/memory/decisions/0025-seo-and-aiso-posture.md) | SEO checklist + AISO checklist (`llms.txt`, FAQ schema, semantic HTML5, AI-crawler robots.txt detection) |
| **`tanstack.md`** | [ADR-0017](contextkit/memory/decisions/0017-tanstack-stack-recognition-and-opt-in-starter.md) | TanStack family (Query/Router/Table/Form/Virtual/Start), cache-key discipline, typed router params |
| **`simulate-impact.md`** | L5 gate | Map blast radius before editing high-risk paths |
| **`tech-debt-sweep.md`** | L5 audit | Deterministic constitution scan + interpretation |
| **`distillation-cycle.md`** | L5 retro | Propose CLAUDE.md refinements from session history |
| **`security-batch.md`** | security-team | Batch security findings → ADRs + backlog |

## Provider adapters

Pluggable runtime adapters that shell out to user-installed CLIs or external
APIs. Each adapter is zero-dep (`node:fetch` or `child_process.spawn`) with a
typed error contract and refuse-on-missing-creds posture.

### Review providers — `contextkit/runtime/providers/review/`

| Adapter | Binary | What |
|---|---|---|
| **`gh`** | `gh` CLI | PR creation, review comments listing, top-level review comment posting |

Add `glab.mjs` / `bb.mjs` / `tea.mjs` for GitLab / Bitbucket / Gitea — each
follows the same `_adapter.mjs` contract. `detect.mjs` resolves the adapter
from `git remote get-url origin` and records the choice in `contextkit/config.json`.

### Media providers — `contextkit/runtime/providers/media/`

| Adapter | Kind | Auth | Cost floor (dated 2026-06-02) |
|---|---|---|---|
| **`nano-banana`** | image (Imagen 3) | `GOOGLE_AI_API_KEY` | ~$0.04 / image |
| **`veo`** | video (Veo 3) | `GOOGLE_AI_API_KEY` | ~$0.50 / second |

Run via:

```bash
node --env-file=contextkit/.env contextkit/tools/scripts/media-gen.mjs image \
  --prompt "editorial product hero, asymmetric grid" --out public/hero.png

# or video
node --env-file=contextkit/.env contextkit/tools/scripts/media-gen.mjs video \
  --prompt "macro slow-motion of ink hitting paper" --out public/hero.mp4 \
  --duration 8 --aspect-ratio 16:9

# or dry-run first (no API call, no charge)
node contextkit/tools/scripts/media-gen.mjs image --prompt "..." --out p.png --dry-run
```

Set `CONTEXTDEVKIT_MEDIA_MAX_USD=5.00` to cap per-process spend — the adapter
refuses the next call that would push the total over the cap.

## SEO + AISO audit

Two static analysers callable as a single command. Audit-first, refuse-on-SPA
on indexable surfaces (see [ADR-0025](contextkit/memory/decisions/0025-seo-and-aiso-posture.md)):

```bash
node contextkit/tools/scripts/seo-audit.mjs           # 8 SEO codes, exit 1 on SPA_ENTRYPOINT
node contextkit/tools/scripts/aiso-audit.mjs --json   # 8 AISO codes, machine-readable
```

| SEO codes | AISO codes |
|---|---|
| `SPA_ENTRYPOINT` ⚠️ critical, `MISSING_TITLE`, `MISSING_DESCRIPTION`, `MULTIPLE_H1`, `MISSING_CANONICAL`, `MISSING_ALT`, `MISSING_SITEMAP`, `MISSING_ROBOTS` | `MISSING_LLMS_TXT`, `MISSING_FAQ_SCHEMA`, `MISSING_ORG_SCHEMA`, `DIV_SOUP`, `JS_RENDERED_CONTENT`, `MISSING_AUTHOR_SCHEMA`, `MISSING_DATE_STAMP`, `BLOCKS_AI_CRAWLERS` |

## Visual surfaces — `/dashboard` + `/watch`

Two zero-dep visual surfaces over the kit's existing files:

- **`/dashboard`** writes a self-contained HTML (inline CSS + vanilla JS, no
  external assets) showing pipeline lanes + ADRs + sessions + roadmap +
  `[Unreleased]` CHANGELOG. `--watch` mode binds `127.0.0.1:4242` and pushes
  updates via Server-Sent Events when files change.
- **`/watch`** tails the active session ledger — what got edited, in order.
  `--follow` streams new entries every 500ms.

```bash
node contextkit/tools/scripts/dashboard.mjs              # snapshot → dashboard.html
node contextkit/tools/scripts/dashboard.mjs --watch      # live on 127.0.0.1:4242
node contextkit/tools/scripts/watch.mjs --follow         # tail the ledger
```

## Roadmap vs DevPipeline

Two different artifacts: **`contextkit/memory/roadmap.md`** is the *product/business
plan* (capabilities, P-IDs, the what/why). The **DevPipeline**
(`contextkit/pipeline/`, board in `devpipeline.md`) is *execution control* — bugs,
increments, chores, and roadmap items broken into tasks with priority, SLA, DAG
dependencies, and complexity, flowing `backlog → working → testing → conclusion`.
The roadmap says what to build; the pipeline runs the work.

🇧🇷 Guia em português: [instrucoes.md](instrucoes.md).

## Maintenance

```bash
# diagnose an install (node, config, hook wiring vs level, git hooks, onboarding)
/context-doctor          # or: agy doctor / node contextkit/tools/scripts/doctor.mjs

# safe update — refresh engine, commands, agents, and configs.
# NEVER touches CLAUDE.md, memory, or local custom settings.
npx contextdevkit@latest --target . --update

# change level (rewires settings.json, installs git hooks at L>=3)
/context-level 4         # or: agy context-level 4

# uninstall — keeps your memory (ADRs, sessions) and CLAUDE.md
node /path/to/contextdevkit/install.mjs --target . --uninstall
# ...or also remove the engine/commands/agents/antigravity assets:
node /path/to/contextdevkit/install.mjs --target . --uninstall --purge
```

## Customizing for your stack

The one thing worth tuning per project: **which paths matter**. Edit
`contextkit/config.json` → `ledger.*` (or use `/context-config`). A Python project adds
`app/`, `tests/`; a Go project adds `cmd/`, `internal/`. Everything else works
out of the box. See [docs/CUSTOMIZING.md](docs/CUSTOMIZING.md) for growing your
own squad of sub-agents, adding slash commands, the provider-adapter pattern, and
the media-gen credentials flow.

## Develop the kit itself

```bash
npm test                      # selfcheck + the integration-test suites (what CI runs)
npm run ci                    # npm test + the tech-debt RED-line gate (validate before pushing)
node tools/selfcheck.mjs      # static: loads the engine, asserts wiring per level
node tools/integration-test.mjs  # end-to-end: installs to a temp dir, drives real hooks
npm run build:antigravity     # regenerate .agents skills/personas from templates/claude
                              # (selfcheck fails if the two hosts drift)
npm run build:codex           # regenerate .codex agents + source-command skills
```

See [CONTRIBUTING.md](CONTRIBUTING.md) for the rules (zero hot-path deps, hooks
never break work, add a test for anything you add).

## Docs

- [docs/ANTIGRAVITY.md](docs/ANTIGRAVITY.md) — Specifications and architecture of the Antigravity integration.
- [docs/CODEX.md](docs/CODEX.md) — Specifications and architecture of the Codex integration.
- [docs/LEVELS.md](docs/LEVELS.md) — what each level does and when to climb.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the engine works internally (hooks, providers, state substrate).
- [docs/CUSTOMIZING.md](docs/CUSTOMIZING.md) — tune config, add agents/commands, provider adapters, rebrand.
- [docs/SQUADS/design-team.md](docs/SQUADS/design-team.md) — UI/UX/a11y + SEO + landing-architect specialists.
- [docs/SQUADS/agent-forge.md](docs/SQUADS/agent-forge.md) — the L6+ "agent that builds agents".
- [docs/ROADMAP.md](docs/ROADMAP.md) — architect analysis, the L6/L7 capability tiers, future directions.
- [docs/AGENT-PACKAGE-FORMAT.md](docs/AGENT-PACKAGE-FORMAT.md) + [docs/SQUAD-PIPELINE-FORMAT.md](docs/SQUAD-PIPELINE-FORMAT.md) — agent-forge specs.
- [instrucoes.md](instrucoes.md) — guia de uso em português (pt-BR).

## License

MIT — see [LICENSE](LICENSE).
