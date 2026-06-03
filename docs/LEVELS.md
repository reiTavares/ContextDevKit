# Levels

VibeDevKit activates progressively. The active level lives in
`vibekit/config.json` → `level` and drives both which hooks are wired in
`.claude/settings.json` and which behaviours the hooks enable at runtime.

Change level with `/vibe-level <n>` or
`node vibekit/tools/scripts/vibe-level.mjs <n>` (then restart Claude Code so it
reloads hooks).

---

## L1 — Memory

**Goal:** never lose the *why*. The minimum that makes sessions continuous.

- `SessionStart` hook injects boot context: latest session, CHANGELOG
  `[Unreleased]`, git divergence vs upstream.
- `/log-session` writes one markdown file per session under
  `vibekit/memory/sessions/`.
- `/new-adr` records architecture decisions (immutable once accepted).
- `/state`, `/close-version`, `/context-refresh`.

**Use when:** any project. This is the floor.

## L2 — Ledger

**Goal:** stop work from silently going unrecorded.

- `PostToolUse` hook records every edit in a per-session ledger
  (`.claude/.sessions/<sid>.json`).
- `Stop` hook **blocks** the session from ending if ≥ 2 important files changed
  and the session wasn't registered — nudging you to `/log-session`.
- The boot context now also reports **drift** from earlier sessions that ended
  without registering.

**Use when:** you want the kit to actively keep memory honest (most projects).

## L3 — Multi-session

**Goal:** run several Claude sessions in parallel — same machine or different
machines/devs — **without one silently overwriting another**.

- `/claim` / `/release` reserve paths; the `PostToolUse` hook warns when you edit
  a path another active session claimed.
- **Concurrency guard** (`PreToolUse`): before you write a file, it warns if
  another active session edited that exact file recently, or if it changed on
  disk since you last wrote it — so you re-read and merge instead of clobbering.
  (Claude Code's own `Edit` already refuses to edit a file changed since you read
  it; the guard adds cross-session awareness and covers full-file `Write`s.)
- **Boot awareness**: SessionStart lists other active branches — local worktrees
  and recent **remote** feature branches (author + age) — so parallel work on
  other machines is visible immediately.
- **pre-push conflict check**: before a push lands, it fetches the upstream
  (`l3.mainBranch`, default `main`) and **blocks** if your branch has a real
  textual conflict with what was pushed there (warns on auto-mergeable overlap).
  This is the cross-machine guarantee the local ledger can't give. Bypass:
  `VIBE_ALLOW_CONFLICT_PUSH=1`.
- `/worktree-new` creates an isolated git worktree (its own ledger).
- `SESSIONS.md` / `WORKSPACE.md` are auto-generated; `pre-commit` regenerates
  them; `commit-msg` enforces Conventional Commits (`[skip-cc]` to bypass).

**Use when:** more than one session/developer, or you use worktrees.

## L4 — Squads

**Goal:** specialized review and design instead of one generalist.

Sub-agents land in `.claude/agents/`, organised into **squads** (each squad has
a router specialist + a roster). The kit ships **28 agents across 7 squads**:

- **devteam** — `architect` (cross-cutting design), `code-reviewer`
  (constitution audit), `context-keeper` (platform + memory), `test-engineer`.
- **qa-team** — `qa-orchestrator` (router + sign-off) with `qa-unit` /
  `qa-integration` / `qa-fuzzer` / `qa-perf` / `qa-e2e` specialists.
- **design-team** — `ui-designer`, `ux-designer`, `accessibility`,
  **`seo-specialist`** (SEO + AISO), **`landing-architect`** (high-conversion
  landing pages with anti-Lovable posture).
- **security-team** — `security`, `code-security`, `infra-security`.
- **compliance-team** — `privacy-lgpd`, `governance-officer`.
- **ops-team** — `devops`.
- **agent-forge** *(activated at L6)* — `forge-orchestrator`, `model-router`,
  `prompt-engineer`, `tool-designer`, `eval-designer`, `packager`,
  `rag-designer`, `agent-architect`.

Routing is automatic: Claude picks an agent by matching the user's intent to
the `description` frontmatter. QA commands (`/test-plan`, `/scaffold-tests`,
`/qa-signoff`) go through `qa-orchestrator`; `/landing-page` invokes
`landing-architect`, which delegates indexability to `seo-specialist`.

Use `_TEMPLATE.md` (or `/squad`) to grow your own domain agents. See
[`docs/SQUADS/design-team.md`](SQUADS/design-team.md) and
[`docs/SQUADS/agent-forge.md`](SQUADS/agent-forge.md).

**Use when:** the codebase is big enough that domain expertise pays off.

## L5 — Proactive

**Goal:** convert "architecture before syntax" into executable governance.

- `PreToolUse` gate: editing a path in `l5.highRiskPaths` is **blocked** until
  you run `/simulate-impact` (which writes a Blast Radius Report and authorizes
  the edit). Trivial edits can record an explicit auditable bypass.
- `/tech-debt-sweep` audits the codebase against your `CLAUDE.md` constitution.
- Auto-distill: after enough sessions, the Stop hook suggests `/distill-sessions`
  to propose refinements to `CLAUDE.md`.

**Use when:** the project has high-blast-radius areas (schema, public contracts,
auth) you want protected from casual edits.

---

## L6 — Autonomy & Insight

**Goal:** make the platform *act and learn*, not just remember and enforce. A
**capability tier** — no new hook, commands on top of the L5 gates.

- `/ship` — orchestrated pipeline (design → implement → review → test → record).
- `/retro` — turns recurring drift/debt into governance (rules + ADRs).
- `/vibe-stats` — telemetry (drift rate, cadence, ADR/agent counts).

**Use when:** the practice is established and you want orchestration + insight.

---

## L7 — Ecosystem & Scale

**Goal:** operate beyond a single repo and close the quality/insight loops. Also a
**capability tier** — no new hook.

- `/fleet` — one control plane over many repos (portfolio stats, cross-repo audit).
- `/tune-agents` — propose outcome-driven refinements to agent briefings.
- `/visual-test` — scaffold a browser-driven visual / screenshot harness.
- `/playbook`, `/token-report`, `/security-setup` + pluggable detectors & stack presets.

**Use when:** an existing/active project that should use the full toolkit from day one.

---

## Where to start

The kit is **not** timid by default:

- **Vibe-coding a NEW / empty project from zero?** Start at **L3** — memory + drift +
  multi-session + git hooks. A solid base, no ceremony.
- **A project that already has code?** Start at **L7** — use everything. It's not
  intrusive: the L5 `simulate-gate` stays inert until you set `l5.highRiskPaths`; the
  rest is advisory. (See [ADR-0009].)

`/vibe-level <n>` moves up or down any time. The installer picks **L3** (greenfield) or
**L7** (existing) for you, based on whether the folder already has code.
