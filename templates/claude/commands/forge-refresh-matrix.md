---
description: Bump router/capability-matrix.json's `updated` date and report the model count. Dry-run by default; pass --write to apply. Real price/model changes require an ADR. (agent-forge squad)
argument-hint: [--write] [--json]
---

# 🛠️ Mode: agent-forge — refresh capability matrix

Run `node vibekit/squads/agent-forge/cli/forge-admin.mjs refresh-matrix $ARGUMENTS`.

This command only stamps the `updated` field — adding/removing models or
changing prices is intentionally out of scope (ADR-0012 §6: matrix-freshness
is ADR-gated). The selfcheck `checkCapabilityMatrix` will fail if a regression
is committed.

## Workflow
1. Review the providers' current price/model pages.
2. Open `/new-adr "capability-matrix bump 2026-Qx"` describing the diff.
3. Hand-edit `router/capability-matrix.json` per the ADR.
4. Run this command with `--write` to stamp the date.
5. `/forge-route <agent>` for each forged agent to see who would benefit.
