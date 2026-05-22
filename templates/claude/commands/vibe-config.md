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

How to act:
- `show [dotted.path]` — read `vibekit/config.json` and print the requested value (or the whole file).
- `set <dotted.path> <value>` — load the JSON, set the value (parse arrays/numbers/booleans
  appropriately), and write it back with 2-space indent.

If `zod` is installed in the project, validate the result against
`vibekit/runtime/config/schema.mjs` before writing and report any errors. If `zod` is not installed,
do a basic structural sanity check (correct types, no absolute/backslashed paths) and proceed.
Never write a malformed config — the hooks fall back to defaults, but a clean file is the contract.
