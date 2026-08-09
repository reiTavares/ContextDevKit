---
name: "source-command-pipeline-retro"
description: "Read-only learning review that proposes governance improvements from durable evidence."
---

# source-command-pipeline-retro

Use this skill when the user asks to run the migrated source command `retro`.

## Command Template

# Retro

Review recent authored session memory, Git history, current canonical task state,
and deterministic code-health reports. Find repeated patterns rather than
one-offs, then propose the smallest durable improvement.

Useful signals:

- `node contextkit/tools/scripts/stats.mjs --json`
- `node contextkit/tools/scripts/tech-debt-scan.mjs --json`
- `node contextkit/tools/scripts/session-digest.mjs --last 10`
- `git log` for the same period
- the read-only v4 authority snapshot exposed by `/pipeline`

Rank proposals by evidence and impact. A proposal may recommend a documentation
change, ADR, config adjustment, or operating habit, but this command applies
nothing and creates no task, workflow, receipt, or hidden state. If the user
accepts a proposal, process that follow-up as a separate mutation.
