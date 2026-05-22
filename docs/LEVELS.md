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

## L2 — Ledger (recommended start)

**Goal:** stop work from silently going unrecorded.

- `PostToolUse` hook records every edit in a per-session ledger
  (`.claude/.sessions/<sid>.json`).
- `Stop` hook **blocks** the session from ending if ≥ 2 important files changed
  and the session wasn't registered — nudging you to `/log-session`.
- The boot context now also reports **drift** from earlier sessions that ended
  without registering.

**Use when:** you want the kit to actively keep memory honest (most projects).

## L3 — Multi-session

**Goal:** run several Claude sessions in parallel without collisions.

- `/claim` / `/release` reserve paths; the `PostToolUse` hook warns when you edit
  a path another active session claimed.
- `/worktree-new` creates an isolated git worktree (its own ledger) for a
  parallel chat on the same machine.
- `SESSIONS.md` and `WORKSPACE.md` become auto-generated indices.
- Git hooks: `pre-commit` regenerates the indices; `commit-msg` enforces
  Conventional Commits (bypass with `[skip-cc]`).

**Use when:** more than one session/developer, or you use worktrees.

## L4 — Squads

**Goal:** specialized review and design instead of one generalist.

- Sub-agents land in `.claude/agents/`: `code-reviewer` (constitution audit),
  `context-keeper` (the platform + memory), `architect` (cross-cutting design),
  `test-engineer`, `security`, plus the **QA squad** — `qa-orchestrator` (router
  + sign-off) with `qa-unit` / `qa-integration` / `qa-fuzzer` specialists. Use
  `_TEMPLATE.md` to grow your own domain agents.
- QA commands `/test-plan`, `/scaffold-tests`, `/qa-signoff` route through
  `qa-orchestrator`. Claude picks the right specialist from each `description`.

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

## Climbing strategy

Start at **L2**. Add **L3** the first time you open a second session. Add **L4**
once you have clear domain seams. Reserve **L5** for when a careless edit to a
core file would actually hurt — and populate `l5.highRiskPaths` with those files
first (`/vibe-config`), or the gate has nothing to protect.
