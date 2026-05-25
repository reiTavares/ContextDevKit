# agent-forge — the agent factory squad

> A **factory** squad: unlike the internal squads (devteam, qa-team, …) whose
> client is *the developer inside Claude Code*, agent-forge produces an artifact
> that ships **out** — a portable, multi-provider **Agent Package** consumed by a
> client project's production runtime. Approved + scoped by
> [ADR-0012](../../memory/decisions/0012-agent-forge-squad-for-portable-agent-packages.md).
> Read [`best-practices.md`](best-practices.md) before forging.

## What it produces

The **Agent Package (APF)** — a versioned, self-contained folder under the client
project's `agent-packages/<name>@<semver>/` with: a single source-of-truth
`manifest.yaml`, per-provider prompts, canonical tool schemas + provider adapters,
optional RAG config, an eval harness (golden + red-team), three governance policies
(cost · compliance · quality), and optional runtime adapters (Node/Python/…).

**The output has zero dependency on VibeDevKit, Node, or any runtime at consume
time.** The forge runs here; the package runs anywhere. (ADR-0012, constraint 1–2.)

## The boundary (why this squad is different)

| Internal squad (devteam/qa-team/…) | agent-forge (factory) |
| --- | --- |
| Client = the developer, in Claude Code | Client = the client's product, in production |
| Output = edits / reviews / tests in this repo | Output = a portable Agent Package |
| Provider = Claude | Provider = Claude · OpenAI · Gemini · DeepSeek · self-hosted |

## Roster (delivered across phases — see backlog 030–035)

> Membership follows the kit convention — **no `squad.manifest.json`**. Each agent is
> a lean file in `.claude/agents/<name>.md` tagged `(agent-forge squad)` (detected by
> `squadOf`), with an optional tier-2 briefing here in `squads/agent-forge/`.

| Agent | Role | Phase |
| --- | --- | --- |
| `forge-orchestrator` | Runs the pipeline (architect → router → prompt+tool+rag → eval → governance → packager) | Fase 1 |
| `agent-architect` | Interviews the dev → produces the Agent Blueprint (YAML) | Fase 1 |
| `model-router` | Picks provider/model from the capability matrix + decision rules; writes the rationale | Fase 1 |
| `prompt-engineer` | System prompt per provider (XML for Claude, few-shot for Gemini, CoT for DeepSeek…) | Fase 1–2 |
| `tool-designer` | Canonical JSON Schema → per-provider tool/function adapters | Fase 1–2 |
| `eval-designer` | Golden dataset + red-team cases + rubric + thresholds | Fase 3 |
| `governance-officer` | Attaches the three policies + fallback chain + kill switch + audit schema | Fase 3 |
| `rag-designer` | *(opt)* chunking, embeddings, index, reranker — only if the blueprint needs retrieval | Fase 5 |
| `packager` | Assembles the APF, versions it (semver + provenance), generates runtime adapters | Fase 1 |

## The five principles (full text in `best-practices.md`)

1. **Portability absolute** — the APF depends on nothing of ours at runtime.
2. **Provider-agnostic manifest, provider-specific adapter** — switch provider = switch adapter.
3. **Economic choice is structured, not intuitive** — the router decides by matrix + rules; the LLM is only a tie-breaker.
4. **Best practices are the default, not a suggestion** — caching, fallback, retry, audit, kill switch, eval ship by default; removing one needs a reason.
5. **Eval before embarkation** — no package leaves the forge without passing a minimum golden + red-team gate.

## Where it sits in the levels

- **L4** — an optional squad; enable per project (e.g. `project_type: ai-product`).
- **L5** — edits under `agent-packages/` are a high-risk path → `/simulate-impact` applies (changing a primary model has wide blast radius).
- **L6** — `/vibe-stats` gains a Forge Stats section (agents in prod, aggregate cost, fallback rate, eval drift).
- **L7** — `/fleet` manages agent packages cross-repo (one agent serving many projects).

## Status

Fase 0 (foundations) — **complete**. This README, [`best-practices.md`](best-practices.md),
the [`router/capability-matrix.json`](router/capability-matrix.json) seed, and the
[`templates/agent-package/`](templates/agent-package/) APF v1 skeleton are in place. The
agents and the `/forge-*` commands land across Fases 1–5 — track them on the DevPipeline
(031–035).
