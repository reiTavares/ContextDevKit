# .antigravity/ — Antigravity Adaptation Layer

This directory contains the **Antigravity adaptation** of ContextDevKit's Claude Code
features. It bridges the gap between Claude Code's hook-based architecture and
Antigravity's KI/skill-based architecture.

## What's here

```
.antigravity/
  skills/           ← Antigravity skills (equivalent to .claude/commands/)
    state.md        ← Quick project state summary
    log-session.md  ← Register work at session end
    new-adr.md      ← Create an Architecture Decision Record
    dev-start.md    ← Start a focused, scope-locked session
    bug-hunt.md     ← Investigate a bug with disciplined RCA
    audit.md        ← One-pass project health check
```

## How to use skills

In Antigravity, you can ask the agent to follow a skill by referencing the file.
For example:
- "Follow the dev-start skill to begin a focused session on X"
- "Use the log-session skill to register this session"
- "Run the audit skill"

## What's NOT here (and why)

The following Claude Code features have **no Antigravity equivalent** and are
intentionally omitted:

| Feature | Why it's missing |
|---|---|
| **Hooks** (SessionStart, PostToolUse, etc.) | Antigravity doesn't support lifecycle hooks |
| **Automatic drift detection** | Requires PostToolUse hook to track edits |
| **Concurrency guard** | Requires PreToolUse hook |
| **Status line** | Antigravity doesn't support custom status bars |
| **Sub-agents** (.claude/agents/) | Antigravity doesn't have dedicated sub-agent dispatch |

These features still work in Claude Code via the `.claude/` directory. This
adaptation is an **additive layer** — it doesn't remove or modify anything
that Claude Code uses.

## Knowledge Items

The project's durable memory is also available as **Knowledge Items** (KIs)
in `<appDataDir>/knowledge/`:

- `contextdevkit-boot/` — Boot context, coding constitution, project structure
- `contextdevkit-architecture/` — Architecture reference, glossary, level system

These KIs are automatically loaded by Antigravity at session start (when the
KI summaries match the task at hand).
