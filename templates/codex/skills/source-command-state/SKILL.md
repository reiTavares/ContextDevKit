---
name: "source-command-state"
description: "Quick summary of current project state (latest session + Unreleased + key rules)"
---

# source-command-state

Use this skill when the user asks to run the migrated source command `state`.

## Command Template

> ⚠️ **Deprecated (1.0):** prefer **/audit** for a fuller, prioritized health
> view. This quick state read still works for now.

Summarize the current state of this project in at most 12 lines. To do so:

1. Run `node contextkit/tools/scripts/context-pack.mjs` [ADR-0027] — **one** bounded
   bundle with the latest-session digest, `[Unreleased]`, the immutable rules, the
   open backlog, and recent ADRs. Reason over the pack instead of opening those
   files separately; open a full file only if the pack flags something to inspect.

2. **(Level ≥ 7 only — fleet capability, ADR-0097)** Optionally add a one-line
   **Fleet/Agents** read by running `node contextkit/tools/scripts/fleet-compliance.mjs`
   and `node contextkit/tools/scripts/agent-registry.mjs` (both `--json`, advisory,
   read-only, fail-open). Surface just the headline — fleet repos scanned + weakest
   compliance, and agent count + agents without a briefing. Omit the line entirely
   when the fleet registry is empty or the data is unavailable (never invent).

Structure the answer in 3 blocks:

- **State**: what is done, what is in progress.
- **Natural next step**: based on `[Unreleased]` and the current phase.
- **Do NOT touch**: the 1–2 most critical immutable rules to remember.

Do not invent — only cite what is in the files. If something is empty, say "empty".
