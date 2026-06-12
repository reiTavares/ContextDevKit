# Architecture

How ContextDevKit works internally — for anyone extending the engine.

## Install Locations (Three Hosts, One Engine)

Claude Code reads settings, slash commands, and agents from **hardcoded** paths
under `.claude/`. Everything else — the engine, memory, scripts, providers —
lives under a single rebrandable folder, `contextkit/` (a "bounded context"
separate from your product code). The only literal reference to that folder
name is `PLATFORM_DIR` in `contextkit/runtime/config/paths.mjs`.

Since v1.14 the same engine also powers a second native host, **Google
Antigravity** (`.agents/` assets + the `ctx.mjs`/`agy` runner +
`INSTRUCTIONS.md` boot context, generated 1:1 from the Claude sources) — see
[ANTIGRAVITY.md](ANTIGRAVITY.md). Codex is the third host: `AGENTS.md`,
`.codex/` hooks/subagents, `source-command-*` skills, and `cdx.mjs` are generated
from the same Claude source — see [CODEX.md](CODEX.md). The tree below shows the
host surfaces plus the shared engine:

```
.agents/             # Antigravity host (skills/personas/playbooks/workflows)
INSTRUCTIONS.md           # Antigravity boot context · ctx.mjs = the agy runner
.codex/                   # Codex host (hooks + TOML subagents)
AGENTS.md                 # Codex boot context · cdx.mjs = the Codex runner
.claude/                  # fixed by Claude Code
  settings.json           # hook wiring (composed by the installer per level)
  commands/               # 73 slash commands, organised in domain packs
    audit/                # tech-debt, security, deps, SEO/AISO
    pipeline/             # DevPipeline + ship + dev-start + plan-week + retro + runs
    qa/                   # qa-signoff, test-plan, scaffold-tests, visual-test
    vcs/                  # git, claim, release, worktree-new, gh-triage, draft-changelog
    forge/                # 14 agent-forge lifecycle commands
    setup/                # setupcontextdevkit, context-doctor, context-level
    *.md                  # daily commands at root
  agents/                 # 32 sub-agent archetypes (frontmatter: name + description)
  .sessions/              # per-session ledgers (gitignored runtime state)
  .workspace/             # per-session claim files (gitignored runtime state)
contextkit/
  .env.example            # optional credentials template (media-gen)
  runtime/hooks/          # the four hooks + shared ledger/classification/readers
  runtime/config/         # paths, defaults, zero-dep loader, settings composer, zod (opt)
  runtime/git-hooks/      # pre-commit (reindex), commit-msg, pre-push (conflict block)
  runtime/providers/
    review/               # PR/review CLI adapters (gh ships; glab/bb adapters fit the contract)
    media/                # Veo + Nano Banana image/video adapters
  runtime/state/          # canonical state.json substrate for tasks + runs
  tools/scripts/          # 76 helpers (reindex, dashboard, sync-check, guard, audits, …)
  runtime/antigravity/    # session-manager (explicit lifecycle), ctx-menu, convert-all
  runtime/codex/          # Codex converters (Claude source -> skills/TOML)
  memory/                 # decisions/, sessions/, business-rules/, GLOSSARY.md, generated indices
  pipeline/               # DevPipeline lanes: backlog / working / testing / conclusion
  workflows/playbooks/    # tanstack, landing-page, seo-aiso, tech-debt-sweep, …
  squads/agent-forge/     # the L6+ "agent that builds agents"
  config.json             # level + ledger path lists + L5 params
```

Claude Code's command resolver picks by **file basename** — `/qa-signoff` finds
`qa/qa-signoff.md` exactly as well as a flat `qa-signoff.md`. The packs are
pure human navigation (see [ticket 047 conclusion](../contextkit/pipeline/conclusion/047-skill-packs-by-domain-subfolders.md)).

## The hooks (the engine)

Wired in `.claude/settings.json`, each is a `node` script fed the tool payload on
stdin. **Contract for every hook: never throw, exit 0 on error, stay silent
unless it has something to say.** A broken hook must never block real work.

| Hook | Event | File | Job |
| --- | --- | --- | --- |
| Boot context | `SessionStart` | `session-start.mjs` | git fetch + divergence; drift banner; inject latest session + `[Unreleased]` + active claims |
| Edit ledger | `PostToolUse` (Edit\|Write\|MultiEdit) | `track-edits.mjs` | append edit to per-session ledger; renew claim heartbeat; cross-claim warning |
| Drift nudge | `Stop` | `check-registration.mjs` | block stop if ≥ 2 important files changed and session unregistered; L5 archive + distill-detect nudge |
| Concurrency guard (L3) | `PreToolUse` (Edit\|Write\|MultiEdit) | `concurrency-guard.mjs` | warn when another session/external change touched the same file (no clobber) |
| Risk gate (L5) | `PreToolUse` (Edit\|Write\|MultiEdit) | `simulate-gate.mjs` | block edits to `highRiskPaths` without a covering `/simulate-impact` |

Git hooks (installed at L≥3): `pre-commit` (regenerate indices), `commit-msg`
(Conventional Commits), `pre-push` (fetch upstream + **block real conflicts** via
`git merge-tree` — the cross-machine guarantee). Worktrees are detected via the
`.git` file containing `gitdir:` and hooks install into the resolved real
`.git/hooks/`.

Shared modules:

- **`ledger.mjs`** — per-session JSON ledger (read/write/list), simulation
  records, session-id resolution, `readMostRecentLedger`. One ledger file per
  session so parallel chats never stomp each other (and worktrees isolate naturally).
- **`path-classification.mjs`** — `isTrackable` / `isImportant` /
  `isRegistrationFile`, driven by `config.json` → `ledger.*`. **This is the seam
  that makes the kit stack-agnostic.**
- **`boot-context-readers.mjs`** — pure readers for the session/changelog/
  workspace artifacts.
- **`safe-io.mjs`** — atomic write (`writeFileAtomic`), defensive JSON read.

## Configuration (zero-dependency by design)

The hot path (hooks) must run on a brand-new project with nothing installed, so
`runtime/config/load.mjs` is **plain JSON + a recursive deep-merge over
`defaults.mjs`** — no `zod`, no npm packages. Arrays replace; objects merge. A
leading UTF-8 BOM is stripped (common on Windows). On any failure it returns the
frozen defaults — config is best-effort, never fatal.

Strict validation (`runtime/config/schema.mjs`, zod) is **optional** and used
only by `/context-config`; it degrades gracefully when zod isn't present.

## Level system

`config.json` → `level` (1–7) is the single switch. See [`LEVELS.md`](LEVELS.md)
for what each level adds.

- The **installer** and the in-project **`context-level.mjs`** both call the shared
  `composeSettings(existing, level)` (`runtime/config/settings-compose.mjs`) to
  rebuild the `hooks` block — preserving your own hooks, stripping previously
  installed ContextDevKit entries so going down a level cleanly removes them. It is
  idempotent: re-running never duplicates entries.
- Hooks also read the level at runtime and self-gate (e.g. the Stop hook only
  runs L5 distill-detect when `level >= 5`), so the wiring and the behaviour can
  never disagree.

## Derived indices

`SESSIONS.md` (session index) and `WORKSPACE.md` (active claims) are **generated**
from source-of-truth files (`sessions/*.md` and `.claude/.workspace/*.json`).
This avoids merge conflicts between parallel sessions. The `pre-commit` git hook
regenerates them before each commit. Never hand-edit a generated file.

## DevPipeline + state.json substrate

The DevPipeline (`contextkit/pipeline/`) is the execution board — tickets flow
`backlog/ → working/ → testing/ → conclusion/`. Each ticket is a markdown file
with YAML frontmatter (id, title, type, priority, severity, SLA, dependencies
DAG, complexity).

The **state.json substrate** (`runtime/state/state-io.mjs`, [ADR-0015 §C](../contextkit/memory/decisions/0015-pipeline-dsl-working-stage-and-multi-session-work-claims.md))
gives every task and pipeline run a single readable state file (`startedAt`,
`endedAt`, `lastHeartbeat`, `kind`, `status`). The `/runs` command reads from
this substrate. `pipeline-session.mjs` stamps state on start/stop;
`workspace-sync.mjs` mirrors heartbeats into the state.

Every transition appends to an **append-only event log** on that state file
([ADR-0043](../contextkit/memory/decisions/)): `{ ts, from, to, actor, inverse }`
where `actor ∈ human | auto | qa | evict` and `inverse` records the undo, so the
board is reversible by construction. The legality matrix is enforced in
`pipeline-transitions.mjs`: `auto` may advance `backlog→working→testing` but can
**never enter or leave `conclusion`** (sign-off stays human/QA); `qa-reject` is
the only `testing→working` bounce (it must carry feedback); and `qa-approve`
([ADR-0055](../contextkit/memory/decisions/)) is the only deterministic
`testing→conclusion` path — it refuses without suite evidence or with incomplete
acceptance criteria. `appendEvent` is the single writer; a swarm run attributes
its moves with an optional `by: { runId, workstream, agent }` field.

The **board renderer** (`pipeline-board.mjs`) generates `devpipeline.md` and
hints `↘ blocked by N` on tickets with unresolved dependencies.

## Autonomy dial + the swarm coordinator

The **autonomy dial** ([ADR-0041–0045](../contextkit/memory/decisions/)) is a
consent axis orthogonal to levels. `resolveAutonomy(area, config, override, ctx)`
in `runtime/config/resolve-autonomy.mjs` is the **single read path**: precedence
is per-run flag → session override → `config.autonomy.grade` → default 2, and a
**non-negotiable floor in code** clamps secrets, force-push, gate/hook self-edits,
`adr` and `grade-change` to `manual` at every grade (config may extend the floor,
never lower it). Hooks are grade-blind — only commands and `/ship`/`/swarm`
checkpoints consult the resolver; a selfcheck pins both invariants. Grade 4 is
refused unless a measured eligibility bar holds (≥30 evented transitions, ≥20
sessions, <10% rollback, zero wiring-drift, a green self-coverage stamp, D3
attribution present) and carries a per-step kill-switch.

The **swarm coordinator** ([ADR-0051](../contextkit/memory/decisions/)) is a skill
driving two pure engines (the same skill-plus-engine shape as `/ship`): the LLM
never owns state, the engine never owns judgment. `swarm-plan.mjs` ranks the
backlog, derives a touch-set per task (card `paths:` → simulate receipt → title
inference; no derivable set ⇒ refused), expands it with the task's likely
test-file homes, and greedily partitions into K disjoint workstreams (hard cap 5).
`swarm-state.mjs` writes the run manifest under `.claude/.swarm/<runId>.json`
(atomic, append-only per-workstream history, stale eviction that preserves the
worktree, a budget-park path). Each workstream runs in its own git worktree
(`worktree-new.mjs --swarm`) and **parks at `testing` — never `done`**; the human
closes the batch with `/swarm review`. The cost tier of each dispatched agent
comes from the `model:` frontmatter ([ADR-0052](../contextkit/memory/decisions/)):
`opus` thinks, `sonnet` builds, `haiku` executes — only spawned subagents are
tiered, so the main loop's prompt cache is never invalidated.

## Provider adapters — pluggable external integrations

Two adapter directories under `runtime/providers/`, sharing the same five-point
contract: no SDK dependency, refuse-on-missing-creds, typed error, refuse-on-
content-policy (where applicable), per-process cost cap (media only).

### Review providers (`runtime/providers/review/`)

Adapters for PR creation, review comment listing, and review comment posting.
Each adapter is a thin shell around an external CLI the user already has
installed (`gh`, `glab`, `bb`, `tea`).

```js
export const id = 'gh';
export const cliBinary = 'gh';
export const detectsRemote = (remoteUrl) => /github\.com[:/]/.test(remoteUrl);
export async function createPullRequest({ title, body, baseBranch }) { … }
export async function listOpenReviewComments({ prNumber }) { … }
export async function postReviewComment({ prNumber, body }) { … }
```

`detect.mjs` runs `git remote get-url origin` and picks the adapter whose
`detectsRemote` matches, then records the choice in `contextkit/config.json` →
`providers.review`. Authority: [ADR-0021](../contextkit/memory/decisions/0021-provider-strategy-review-qa.md).

### Media providers (`runtime/providers/media/`)

Adapters for image and video generation via `node:fetch` against external APIs.
Two ship today: **`nano-banana`** (Imagen 3 image) and **`veo`** (Veo 3 video),
both against Google AI Studio's REST API.

```js
export const id = 'nano-banana';
export const kind = 'image';        // or 'video'
export const envVar = 'GOOGLE_AI_API_KEY';
export const requiredEnv = ['GOOGLE_AI_API_KEY'];
export async function generate({ prompt, outPath, options }) { … }
```

`_adapter.mjs` provides `MediaProviderError` (7 codes: `NO_CREDENTIALS`,
`CONTENT_POLICY`, `COST_CAP_REACHED`, `RATE_LIMIT`, `PROVIDER_ERROR`,
`BAD_INPUT`, `IO`), `validateAdapter`, `assertCredentials` (refuses before any
network call), and `noteCostOrThrow` (shared per-process USD tally read from
`CONTEXTDEVKIT_MEDIA_MAX_USD`). Authority: [ADR-0024](../contextkit/memory/decisions/0024-media-generation-veo-nano-banana.md).

## Squads — sub-agent organisation

Each agent is a `.claude/agents/*.md` file with frontmatter (`name` +
`description`; optional `mcpServers` per [ADR-0019](../contextkit/memory/decisions/0019-mcp-injection-in-squads.md)).
Claude Code routes to an agent by matching the `description` to the user's
intent — so the description names the *concrete files/dirs/patterns* the agent
owns.

Squads group related agents:

| Squad | Specialists | Activated at |
|---|---|---|
| **devteam** | `architect`, `code-reviewer`, `context-keeper`, `test-engineer` | L4 |
| **qa-team** | `qa-orchestrator` + `qa-unit` / `qa-integration` / `qa-fuzzer` / `qa-perf` / `qa-e2e` | L4 |
| **design-team** | `ui-designer`, `ux-designer`, `accessibility`, **`seo-specialist`**, **`landing-architect`** | L4 |
| **security-team** | `security`, `code-security`, `infra-security` | L4 |
| **compliance-team** | `privacy-lgpd`, `governance-officer` | L4 |
| **ops-team** | `devops` | L4 |
| **agent-forge** | `forge-orchestrator`, `model-router`, `prompt-engineer`, `tool-designer`, `eval-designer`, `packager`, `rag-designer`, `agent-architect` | L6+ |

See [`SQUADS/design-team.md`](SQUADS/design-team.md) and
[`SQUADS/agent-forge.md`](SQUADS/agent-forge.md) for specialist briefings.

## Visual surfaces — `/dashboard` + `/watch`

Two zero-dep surfaces over the kit's existing files:

- **`/dashboard`** (`dashboard.mjs` entry; `dashboard-data.mjs` reader;
  `dashboard-html.mjs` renderer; `dashboard-server.mjs` `--watch` server) —
  writes a self-contained HTML or serves it on `127.0.0.1:4242` (override via
  `--port` or `CONTEXTDEVKIT_DASHBOARD_PORT`). Live mode uses `fs.watch` on the
  platform dir with a 200 ms debouncer and pushes data via Server-Sent Events.
- **`/watch`** (`watch.mjs`) — tails the active session ledger via the runtime's
  `readMostRecentLedger` (single-sourced — rule 4). `--follow` re-polls every
  500 ms; exits cleanly on SIGINT.

Both bind to `127.0.0.1` only — no remote access by design.

## GitHub sync awareness (sync-check)

`sync-check.mjs` ([ADR-0026](../contextkit/memory/decisions/0026-github-sync-awareness-dev-flow.md))
has two modes wired into two slash commands:

- **`preflight`** (run by `/dev-start` before scope-lock) — shows ahead/behind,
  recent branches, and **open PRs with CI/review status**, flagging PRs
  *awaiting status* that may overlap the objective.
- **`prepr`** (run by `/git pr` before push) — re-checks divergence vs the
  default branch and **detects a duplicate open PR** for the current branch.

`gh` is optional — absent or unauthed degrades to the git-only half and reports
the PR check as **skipped, never a pass** (rule 8). Offline → silent exit 0.
PR queries stay **off the `SessionStart` hot path** (rule 2 — never block
real work; network + auth would violate the never-block invariant).

## Home-scoped state (`~/.contextdevkit/`)

ADR-0020 formalises a small home directory for cross-repo state that cannot
live in any single repo. `home.mjs` is the single owner of resolution + atomic
write contract:

- `resolveHome()` — honours `CONTEXTDEVKIT_HOME`; otherwise `~/.contextdevkit/`; lazy
  `mkdirSync` on first call.
- `readHomeFile(name)` — returns `null` on absent/malformed/version mismatch;
  legacy files (without `version`) are adopted on first read.
- `writeHomeFile(name, data)` — atomic via `<path>.tmp.<pid>` + `renameSync`;
  stamps `version: 1`.

Used today only by `fleet.mjs` (cross-repo portfolio registry). Future
home-scoped consumers (preferences, telemetry cache) inherit the contract.

What does **NOT** belong there: ADRs, sessions, pipeline tickets, run state, no
SQLite, no daemon, no secrets. The kit reads secrets from `process.env`
exclusively (e.g. `GOOGLE_AI_API_KEY` for `/media-gen`).

## Extension SDK (deferred)

An external tool may connect extra sub-agents and hooks to the kit via a
**subprocess JSON-RPC contract** — implementation is parked until a concrete
consumer requests it. Contract authority: [ADR-0018](../contextkit/memory/decisions/0018-extension-sdk-subprocess-jsonrpc.md).

## Why this shape

- **Defense in depth.** Instructions (CLAUDE.md, slash commands) are advisory;
  hooks are enforced. The two layers cover each other.
- **Reversible & inspectable.** Everything is plain files in your repo. Uninstall
  by deleting `contextkit/` and the ContextDevKit block from `.claude/settings.json`.
- **No lock-in on the hot path.** Zero runtime deps for Levels 1–3. The optional
  layers (`zod` for strict validation, external APIs for `/media-gen`) are all
  opt-in and degrade gracefully when absent.
- **Read by basename, organised by domain.** Slash commands moved into packs
  in v1.7 without breaking a single invocation — Claude Code's resolver is
  path-agnostic, but humans aren't.
