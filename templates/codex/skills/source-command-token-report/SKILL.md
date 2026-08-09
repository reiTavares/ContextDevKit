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

Also inspect economy surfaces that do not require scraping Codex transcripts:

```bash
node contextkit/tools/scripts/token-report.mjs --json
node contextkit/tools/scripts/economics/quota-snapshot.mjs --write --source token-report --capture-method manual <quota flags>
```

Use the JSON report for routing telemetry/economics, economy lifecycle events,
and quota summaries when they exist. If quota data is not visible from the host,
report `quota-snapshot skipped: no host quota data`; do not invent quota
numbers.
