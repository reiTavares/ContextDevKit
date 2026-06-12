---
name: "source-command-forge-forge-list"
description: "List every forged Agent Package under agent-packages/ (or --root <dir>) with version + routed primary model + eval-stamp status. Read-only. (agent-forge squad)"
---

# source-command-forge-forge-list

Use this skill when the user asks to run the migrated source command `forge-list`.

## Command Template

# 🛠️ Mode: agent-forge — list packages

Run `node contextkit/squads/agent-forge/cli/forge-ops.mjs list $ARGUMENTS`.

Read-only. Walks the registry, doesn't need the `yaml` dep for discovery — but
`primary model` + `eval-stamp` columns require it (ADR-0013). If `yaml` is
missing, the listing still shows names + versions; suggest `npm i yaml` for
the rest.

## Post-output
- Flag any package whose `eval-stamp` shows `⚠️ unevaluated` and recommend `/forge-eval <agent>`.
- If two versions of the same agent are listed, recommend `/forge-deprecate <agent>@<old>`.
