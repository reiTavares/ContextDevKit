---
name: "source-command-token-report"
description: "Codex usage and autonomy insight from ContextDevKit receipts, without reading unstable private transcript formats."
---

# source-command-token-report

Use this skill when the user asks to run the migrated source command `token-report`.

## Command Template

# Codex Usage & Autonomy Report

Codex does not expose a stable transcript format for project tooling. Do not
scrape private `.codex` session files or invent token totals.

Use the canonical Session Autonomy Receipts produced by ContextDevKit:

```bash
node contextkit/tools/scripts/autonomy-report.mjs --latest
node contextkit/tools/scripts/autonomy-report.mjs --all
node contextkit/tools/scripts/autonomy-report.mjs --session <id> --verify
```

Report the receipt's consumption mode, measured/estimated claim type, observed
or estimated tokens, autonomy multiplier, cost evidence, confidence, and
integrity status. When no receipt exists, say that usage evidence is unavailable
and recommend finalizing the current session first. Never present an estimate as
provider-billed usage.
