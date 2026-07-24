# Reference: `governance-contract.json` — the cross-agent governance seam

<!-- GENRE: Reference (information-oriented) -->

## Synopsis

`governance-contract.json` is a serialized, versioned, vendor-neutral record of the
**resolved ceremony shape** of one work context. ContextDevKit emits it per work
context (BIZ-0006 / WF-0088, ADR-0148 position 11). It is the stable seam a runtime
**other than Claude Code** reads to govern a work context **without re-running the
classifier** — the exact object BIZ-0002's `GovernedExecutionEnvelope` will wrap.

```
<context-root>/governance-contract.json
```

The contract is a **read-only projection** of the classifier axes +
`resolveCeremonyShape`. It is never a source of truth (that is the ADR-0043 event
journal → `workflow-state.json`) and never an enforcement point. A reader may parse
it, verify it, and govern on it; it must treat an **absent or stale** contract as
`skipped`/advisory, never as a hard failure.

## Fields (schema v1)

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `schemaVersion` | `number` | yes | Pinned `1`. Bump when a producer closed-set changes. |
| `contextRef` | `{ type, id }` | yes | `type` ∈ `business\|operation\|workflow`; `id` matches `BIZ-####`/`OP-####`/`WF-####`. The artifact-location taxonomy (3 values). |
| `ceremonyShape` | `string` | yes | The **EFFECTIVE** shape the reader acts on — one of the five `CEREMONY_SHAPES`. |
| `resolvedAxes.nature` | `string` | yes | `operation\|business`. |
| `resolvedAxes.executionMode` | `string` | yes | `direct\|batch\|workflow`. (NOT ceremony tokens — feeding this back to the resolver must not throw.) |
| `resolvedAxes.tier` | `string` | yes | `trivial\|feature\|architectural`. |
| `resolvedAxes.kind` | `string` | yes | The classifier `kind` vocabulary (`capability`…`operationalResponse`). |
| `ceremonyOverride` | `object` | yes | Escape-token value object; see below. |
| `governingDecision` | `{ ref, status }` | yes | The ADR that governs the schema (e.g. `ADR-0148`, `proposed\|accepted`). |
| `stateAuthority` | `string` | yes | Names where truth actually lives — this contract is not it. |
| `derivedFrom` | `object` | yes | The producers this is a fold of (`{ resolver, classifier }`). |
| `emittedAt` | `string` | yes | ISO timestamp of emission (staleness anchor). |
| `emittedBy` | `string` | yes | `create\|transition`. |

Any field outside this closed set is **rejected** by the validator — containment is
what stops the projection from silently accreting live state.

### `ceremonyOverride` (value object)

| Name | Type | Description |
|------|------|-------------|
| `applied` | `boolean` | Whether an override is in effect. |
| `resolvedShape` | `string\|null` | What `resolveCeremonyShape` produced. |
| `shape` | `string\|null` | The override target (== top-level `ceremonyShape` when `applied`). |
| `reason` | `string\|null` | Why the deviation. |
| `authorizedBy` | `string\|null` | Human id or decision/ADR ref — accountability. |
| `authorizedAt` | `string\|null` | ISO timestamp of authorization. |

**Co-occurrence invariant:** `applied === true` ⇒ all five fields non-null;
`applied === false` ⇒ all five null.

## How a non-Claude runtime reads it (read-only illustration)

These snippets **ship no executable adapter** — they demonstrate that any runtime
with a JSON parser reads the contract with zero ContextDevKit dependency.

### Shell (`jq`) — govern on the effective shape

```shell
# Read the effective ceremony shape and the governing decision, no classifier.
shape=$(jq -r '.ceremonyShape' governance-contract.json)
decision=$(jq -r '.governingDecision.ref' governance-contract.json)
echo "govern context as: $shape (under $decision)"

# Detect an authorized override and who signed it.
jq -r 'if .ceremonyOverride.applied
       then "OVERRIDE " + .ceremonyOverride.shape + " by " + .ceremonyOverride.authorizedBy
       else "no override" end' governance-contract.json
```

### Python — verify round-trip, then dispatch

```python
import json

with open("governance-contract.json", encoding="utf-8") as fh:
    contract = json.load(fh)

# The four axes are the verbatim resolveCeremonyShape inputs. A non-Claude runtime
# can re-derive/verify the shape from them — no access to classifier internals.
axes = contract["resolvedAxes"]
effective_shape = contract["ceremonyShape"]

# Govern: a runtime maps the effective shape onto its own execution policy.
policy = {
    "quick-fix": "single-step",
    "batch-operation": "fan-out",
    "single-workflow-operation": "workflow",
    "decision-only": "decision-record",
    "multi-workflow-program": "program",
}[effective_shape]

# Truth lives elsewhere — the contract points at it, it is not it.
print("policy:", policy, "| state authority:", contract["stateAuthority"])
```

## Error conditions

| Condition | Reader behavior |
|-----------|-----------------|
| File absent | Treat as `skipped`/advisory — the plane has not resolved this context yet. Never a hard failure. |
| `schemaVersion` unknown | Reject/ignore; do not guess a shape. |
| Fails `validateGovernanceContract` | Reject; do not govern on a malformed contract. |
| Stale (`emittedAt` older than context `lastUpdate`) | Treat as advisory; a fresh emission supersedes it. |

## See also

- `templates/contextkit/runtime/work/schema-governance-contract.mjs` — the schema +
  `validateGovernanceContract(contract) → { ok, errors[] }` validator (pure, never
  throws, zero deps on the hot path).
- `templates/contextkit/methodology/resolve-ceremony-shape.mjs` — the WF-0083 producer
  the contract serializes (`CEREMONY_SHAPES`, `CEREMONY_NATURES`, `CEREMONY_TIERS`,
  `CEREMONY_KINDS`).
- ADR-0148 — the governing decision (BIZ-0006, the methodology-plane integrity program).
