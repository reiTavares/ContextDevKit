---
description: Detect breaking changes to the public contract (removed/renamed exports) vs the baseline.
argument-hint: [--save]
---

Check the project's public contract for drift.

- **First time / after an intentional breaking change:** save the baseline
  `node contextkit/tools/scripts/contract-scan.mjs --save` (commit
  `contextkit/memory/contract-baseline.json`).
- **Normally:** `node contextkit/tools/scripts/contract-scan.mjs` — flags any
  exported symbol that was **removed or renamed** since the baseline (additions
  are fine). Exits non-zero on drift, so it can gate CI.

The contract is whatever you declare in `contextkit/config.json` → `l5.contractGlobs`
(e.g. `["packages/shared/", "src/api/"]`). If it's empty, set it first via
`/context-config` — there's nothing to track until you do.

Run the right variant based on `$ARGUMENTS`, show the result, and if there's
drift: confirm whether it's intentional. If yes → bump the version (BREAKING
CHANGE) and re-save the baseline. If no → restore the removed export.
