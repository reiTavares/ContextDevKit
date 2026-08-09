# Configuration reference

<!-- GENRE: Reference (information-oriented) -->

The runtime reads `contextkit/config.json` and layers it over zero-dependency
defaults. Missing or malformed governance configuration resolves safely to
`canary` and `failurePolicy: continue`; it never promotes a gate to guarded.

Inspect and update configuration through the shipped commands:

```bash
node contextkit/tools/scripts/context-config.mjs show
node contextkit/tools/scripts/context-config.mjs show governance
node contextkit/tools/scripts/context-config.mjs set <path> <value>
node contextkit/tools/scripts/config-health.mjs
```

Strict schema validation uses an optional dynamic import. When unavailable it
reports `skipped`, never `passed`.

## Governance

The canonical default is:

```json
{
  "governance": {
    "defaultMode": "canary",
    "failurePolicy": "continue",
    "humanAuthority": "owner-wins",
    "gates": {
      "qa-signoff": "guarded",
      "ddd-invariants": "guarded",
      "technical-debt": "guarded",
      "architecture-debt": "canary",
      "privacy-lgpd": "shadow",
      "graph-first": "canary",
      "intake": "canary",
      "journey": "canary",
      "workflow-presence": "canary",
      "simulation": "canary",
      "deliberation": "canary",
      "agent-routing": "canary",
      "subagent-scope": "canary",
      "economy": "canary",
      "context-pack": "canary",
      "completion": "canary"
    }
  }
}
```

Supported modes are `off`, `shadow`, `canary`, and `guarded`. The central
registry clamps `guarded` to the three-item allowlist. `failurePolicy` is always
`continue`; `humanAuthority` is `owner-wins`.

The 3.x values `advisory` and `strict` are upgrade inputs, converted to `canary`
and `guarded` with warnings. They are not switches for legacy runtime behavior.

## Risk acknowledgement

```json
{
  "riskAcknowledgement": {
    "requiredFor": [
      "destructive-production",
      "force-push",
      "secret-rotation"
    ],
    "extraSecretPaths": []
  }
}
```

This controls non-blocking acknowledgement metadata. It does not grant or deny
authority and cannot replace the real platform confirmation.

## Level

`level` is an integer 1–7 selecting capabilities. Use `context-level.mjs` so
configuration and host projections change together. Level is not consent.

## Project Map

`projectMap.roots` and `projectMap.excludes` define index scope.
`projectMap.graph` configures the preferred graph provider and refresh policy.
Missing, stale, partial, or unavailable graph data never disables broad search.

## QA and technical debt

`qa` carries declared critical paths and coverage targets. Those values guide
test planning; the QA guarded predicate still applies only to completion.

Architecture/technical-debt analysis may configure observations and baselines.
File size signals remain advisory. Only new high/critical debt introduced by the
current diff may satisfy the guarded technical-debt predicate.

## Routing and orchestration

`routing` contains model and effort recommendations. `orchestration` contains
non-binding planning caps. Neither dispatches, denies, or grants authority.
Missing or invalid recommendations produce one warning and the current agent
continues.

## Swarm

```json
{
  "swarm": {
    "hostTechnicalLimit": null,
    "tokenBudgetPerRun": 0,
    "staleMinutes": 30
  }
}
```

`hostTechnicalLimit` is `null` unless the host reports a real scheduler limit.
There is no semantic cap based on task tier, autonomy, roles, or touch sets.

## Economy

`economy` controls optional read-only/advisory levers such as compact output,
context profiles, resume packs, and token measurement. Economy may reduce
context or output but cannot reorder governance, weaken evidence, or become a
permission system.

## Owner preferences

Owner preferences are versioned recommendations for routing and presentation.
They are written atomically, audit changes, and redact sensitive values. They
do not modify the central gate registry or become a second policy authority.

## Other areas

- `setup`: onboarding completion marker;
- `practices` and `behaviors`: advisory coding guidance;
- `l3`: branch/multi-session settings;
- `qa`: critical paths and targets;
- `securityMode`: advisory security cadence;
- `tokens`, `eacp`, and `economy`: measurement/advisory economics;
- `bridges`: optional context-only integrations;
- `mcp`: read-resource exposure and provider settings.

No configuration key can register a v3 lane writer, v1 workflow reader,
autonomy grade gate, required-agent gate, rigid route, or old multi-hook chain.

## Upgrade aliases

All 3.x key conversion is documented in
[MIGRATION-3.x-TO-4.0.md](../../MIGRATION-3.x-TO-4.0.md). Upgrade aliases are
accepted by the upgrade parser/migrator only and are written back in canonical
v4 shape.

## Generated defaults

<!-- contextdevkit:generated:config-reference:start -->
The live exhaustive value set is generated from the configuration loader during
documentation/release verification. Use `context-config.mjs show` for the
effective values of an installed project.
<!-- contextdevkit:generated:config-reference:end -->
