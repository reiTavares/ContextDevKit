---
name: "source-command-forge-forge-doctor"
description: "Integrity check across every forged Agent Package — required files present, no {{TOKEN}} placeholders left in governance YAMLs. Read-only; exits non-zero on any problem. (agent-forge squad)"
---

# source-command-forge-forge-doctor

Use this skill when the user asks to run the migrated source command `forge-doctor`.

## Command Template

# 🛠️ Mode: agent-forge — doctor

Run `node contextkit/squads/agent-forge/cli/forge-ops.mjs doctor $ARGUMENTS`.

Walks every package, asserts the 11 expected files exist, and verifies the 3
governance policies are *populated* (no `{{TOKEN}}` placeholders). Exits 1 if
anything is wrong.

## When issues appear
- Missing files → re-run `/forge-new` for the agent, or restore from git.
- Placeholder tokens in governance → the package was hand-edited or shipped
  before Fase 3 — re-forge it or run `/forge-policy` to see what's missing.
