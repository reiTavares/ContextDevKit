# {{AGENT_NAME}} — Agent Package

> Forged by **agent-forge**. Portable + provider-agnostic — runs with no ContextDevKit
> installed. The single source of truth is [`manifest.yaml`](manifest.yaml).

## What it does

{{ONE_PARAGRAPH_WHAT_THIS_AGENT_DOES}}

## Quick start

See [`examples/basic.node.md`](examples/basic.node.md). Switch provider by editing
`spec.model_selection.primary` in `manifest.yaml` — your calling code does not change
(every runtime adapter exposes the same `AgentRuntime` interface).

## Model Selection Rationale

<!-- Filled by model-router (agent-forge best-practices §4.4). The authority for
     "best model" is the EVAL HARNESS measured on the golden set, not opinion. -->

- **Primary:** `{{provider/model}}` — {{why: category + complexity + constraints}}
- **Fallback:** `{{provider/model}}` — {{why: a DIFFERENT provider, outage defense}}
- **Cheap path:** `{{provider/model}}` — {{for cheap sub-tasks}}
- **Not chosen:** `{{provider/model}}` — {{measured reason, e.g. golden accuracy gap}}

## Governance (three pillars, equal weight)

Enforced — see [`governance/`](governance/). The agent refuses to run if **any** of
cost / compliance / quality is under-configured.

## Eval

Release gate + red-team live in [`evals/`](evals/). Run per
[`evals/run-eval.md`](evals/run-eval.md). No version ships without passing.

## Provenance

`.agentforgerc` records the forge version, blueprint hash, and eval run that produced
this package. See [`CHANGELOG.md`](CHANGELOG.md) for the version history + semver rules.
