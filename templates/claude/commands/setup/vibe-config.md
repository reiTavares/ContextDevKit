---
description: Inspect or edit vibekit/config.json (ledger path lists, L5 high-risk paths, distill params).
argument-hint: show [path] | set <path> <value>
---

Inspect or edit `vibekit/config.json` — the single source of truth for VibeDevKit behaviour.

**$ARGUMENTS**

Sections you can tune:
- `ledger.important` / `ledger.irrelevant` / `ledger.registration` — which paths trigger the drift
  nudge, which are ignored, which count as registering a session. **Tune these to your stack** (e.g.
  Python → add `app/`, `tests/`; Go → `cmd/`, `internal/`).
- `l5.highRiskPaths` — paths the Level 5 gate protects (require `/simulate-impact` first).
- `l5.distill.*` — auto-distillation cadence.
- `level` — prefer changing via `/vibe-level`.

How to act — use the helper script (it coerces types and validates with zod when available):
- Show:  `node vibekit/tools/scripts/vibe-config.mjs show [dotted.path]`
- Set:   `node vibekit/tools/scripts/vibe-config.mjs set <dotted.path> <value>`
  (arrays/objects accept JSON, e.g. `set ledger.important '["app/","tests/"]'`).

Run the appropriate command based on `$ARGUMENTS` and show the output. The script never writes a
malformed config — if `zod` is installed it validates against `vibekit/runtime/config/schema.mjs`
first. For changing the level, prefer `/vibe-level`.
