---
description: Fleet mode — one control plane over many ContextDevKit repos (portfolio stats, cross-repo audit, CLAUDE.md rule-drift).
argument-hint: [list | add <path> | remove <path> | stats | audit | propagate <rule-file>]
---

# 🛰️ Fleet (control plane over many repos)

Operate on a **portfolio** of ContextDevKit repos at once. The registry lives outside
any repo — `~/.contextdevkit/fleet.json` (override `CONTEXT_FLEET_FILE`). Helper:
`contextkit/tools/scripts/fleet.mjs`.

Act on **$ARGUMENTS**:

## list / add / remove
```
node contextkit/tools/scripts/fleet.mjs add <path-to-repo>
node contextkit/tools/scripts/fleet.mjs list
```
Register the repos you want the fleet to cover (absolute paths are stored).

## stats — portfolio health
```
node contextkit/tools/scripts/fleet.mjs stats          # or --json
```
Runs each repo's `stats.mjs` and aggregates: level, registered sessions, ADRs,
agents, drift rate per repo + totals. Call out the repos that look unhealthy
(high drift, no recent sessions, stuck at a low level).

## audit — findings across the portfolio
```
node contextkit/tools/scripts/fleet.mjs audit          # or --json
```
Runs each repo's `deep-analysis.mjs` and aggregates finding counts. Surface the
repos carrying the most debt/risk; suggest where to run `/deep-analysis` or
`/deps-audit` next.

## propagate — CLAUDE.md rule drift (detect-only)
```
node contextkit/tools/scripts/fleet.mjs propagate <rule-file>
```
Reports which repos' `CLAUDE.md` **lack** a given rule block. Fleet **does not
auto-edit** — for each MISSING repo, add the rule with judgment (it may need
adapting per stack), ideally via that repo's own session + PR.

## Report
Summarize the portfolio: totals, the 1–3 repos needing attention, and the
concrete next action per repo. Keep it advisory — the fleet informs, you decide.
