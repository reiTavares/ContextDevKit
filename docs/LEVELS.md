# Capability levels

Levels select which ContextDevKit capabilities are installed or surfaced. They
do not grant consent, relax gates, choose a model, or authorize an external
action. The current owner instruction remains authoritative at every level.

| Level | Adds |
| --- | --- |
| 1 — Memory | project memory, decisions, changelog, documentation spine |
| 2 — Governance | one dispatcher per host event, mutation classification, diagnostics |
| 3 — Multi-session | claims, worktrees, branch/session coordination, derived workspace views |
| 4 — Specialists | agent projections, squads as optional expertise, QA roles |
| 5 — Proactive analysis | impact simulation, architecture/contract/security analysis, quality gates |
| 6 — Delivery | ship/swarm/retro commands, bounded runner, learning and outcome metrics |
| 7 — Ecosystem | fleet, playbooks, visual QA, agent packages, advanced observability |

Capabilities are cumulative. A lower level may expose fewer commands but uses
the same gate semantics: defaults are canary/continue, LGPD is shadow, and only
the three central guarded domains may deny.

## Changing level

Use the command so host projections are recomposed consistently:

```bash
node contextkit/tools/scripts/context-level.mjs show
node contextkit/tools/scripts/context-level.mjs set <1-7>
```

Changing a level does not create an approval token. Destructive production
actions, force-push, secret rotation, cloud changes, and credentials remain
subject to the real host/platform boundary.

## No-op at every level

Conversation and read-only exploration write nothing at levels 1 through 7.
An unclassified request asks one short question and writes nothing. Governance
begins when the interaction mutates files or governed state.

## Recommendations at every level

Project Map lookup, model policy, agent routing, swarm shape, economy hints, and
owner preferences remain recommendations. If one is unavailable, the active
agent continues within the owner's instruction. No level makes a specialist or
receipt mandatory.

See [the reference table](reference/levels.md),
[governance contract](reference/governance-contract.md), and
[installation guide](how-to/install-and-choose-a-level.md).
