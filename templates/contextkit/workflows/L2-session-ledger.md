# L2 — Session ledger + drift detection

> Level 2 of the context system. Solves: **"How do we detect that a session touched
> important files but was never registered?"**

## The problem

L1 loads context, but without instrumentation it relies on the AI's **discipline** to:
1. read the history at the start (SESSIONS, CHANGELOG, ADRs), and
2. update SESSIONS + CHANGELOG at the end (`/log-session`).

If step 2 is skipped, the next session starts blind — silent divergence between the
real state and the documented one. L2 instruments the system with hooks that
**detect drift** automatically.

## Components

### Per-session ledger

`.claude/.sessions/<sessionId>.json` — gitignored, isolated between parallel chats.
It records each modification (path, tool, timestamp), whether the session was
registered, and anti-loop flags. Shared helpers live in
[`contextkit/runtime/hooks/ledger.mjs`](../runtime/hooks/ledger.mjs).

### Claude Code hooks

Wired in `.claude/settings.json` — every script lives in `contextkit/runtime/hooks/`:

| Hook | Matcher | Script | Job |
| --- | --- | --- | --- |
| `SessionStart` | (always) | `session-start.mjs` | Boot context + drift detection. |
| `PostToolUse` | `Edit\|Write\|MultiEdit` | `track-edits.mjs` | Append to ledger + heartbeat + cross-claim check. |
| `Stop` | (always) | `check-registration.mjs` | Nudge if there is unregistered drift. |

### The Stop-hook nudge decision

```
if stop_hook_active === true        → silent (anti-loop)
if important paths < 2              → silent (small session)
if registered || SESSIONS touched   → silent (already registered)
if already warned this session      → silent
otherwise                           → decision: "block"
                                      (instructs /log-session or justify)
```

## What counts as an "important path"

Drift detection classifies paths via
[`contextkit/runtime/hooks/path-classification.mjs`](../runtime/hooks/path-classification.mjs),
driven by `contextkit/config.json` — **not hardcoded per stack**. By default, source
code, the platform folder, and CI/config files trigger drift; generated output
(`node_modules/`, `dist/`, build caches) and the platform's own runtime state
(`.claude/.sessions/`, `.claude/.workspace/`) do not. Tune the lists with `/context-config`.

## A full session flow

```
[open session]
  → SessionStart: silent fetch · list prior drift (clear registered ledgers) ·
    init fresh ledger · inject boot context
[Claude edits]
  → PostToolUse (each Edit/Write/MultiEdit): append paths · refresh heartbeat ·
    warn on cross-claim with another session
[Claude stops]
  → Stop: check drift · if ≥ 2 unregistered important paths and not yet warned →
    block with "run /log-session OR justify a discardable session"
```

## When something goes wrong

- **Hook doesn't run** → check `.claude/settings.json` points to the
  `contextkit/runtime/hooks/<name>.mjs` file and that it exists.
- **False-positive drift** → a classification may be too broad; adjust via
  `/context-config` (record an ADR if it's a real policy change).
- **Stop hook re-nudging** → the anti-loop flag lives in the ledger; if it repeats,
  the ledger may be getting recreated each Stop — investigate.
- **Two chats in one worktree** → use a `git worktree` (L3); the ledger is
  per-session but live file edits still collide on one filesystem.

## Do not

- Put business logic in a hook.
- Add external deps to `runtime/hooks/` — Node built-ins only (immutable rule #1).
- Block the user — hooks are defensive and exit 0 on error. The only intentional
  block is the Stop nudge via `decision: "block"`.
- Hand-edit `SESSIONS.md` / `WORKSPACE.md` — they are auto-generated indices.
