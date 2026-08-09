# Levels reference

<!-- GENRE: Reference (information-oriented) -->

`contextkit/config.json` contains an integer `level` from 1 through 7. The level
is a capability selector only.

| Level | Stable capability boundary | Host/runtime effect |
| --- | --- | --- |
| 1 | memory and decisions | installs base context and documentation tools |
| 2 | mutation governance | composes the four single-process governance events |
| 3 | coordination | enables claims, worktrees, and multi-session views |
| 4 | specialists | installs declared agent/squad projections |
| 5 | proactive analysis | exposes impact, audit, contract, and quality tooling |
| 6 | delivery automation | exposes ship, swarm, retro, and bounded suite orchestration |
| 7 | ecosystem | exposes fleet, playbooks, visual QA, agent packages, and advanced metrics |

All levels share these invariants:

- conversation/exploration is a zero-write no-op;
- a real mutation attempt activates governance once;
- missing/invalid gate configuration becomes canary/continue;
- only QA at done, Class A DDD invariants, and current-diff high/critical debt
  can deny;
- graph, routing, agents, swarm, economy, and preferences are advisory;
- LGPD is shadow;
- level is not consent.

The level command is the supported writer because it updates configuration and
host projection wiring together. Directly editing the integer can leave a host
projection stale.

See [Capability levels](../LEVELS.md) for the conceptual overview.
