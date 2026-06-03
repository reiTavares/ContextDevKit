# agent-forge — the factory squad

> Public reference for the optional L4+ squad that forges portable, multi-provider
> **Agent Packages (APF v1)** for projects *outside* the kit. The kit gains an
> agent-that-builds-agents whose output ships independently — zero ContextDevKit
> dependency at consume time.

## When to enable

Add `agent-forge` when a project's purpose includes shipping production AI
agents (chatbots, extractors, RAG, classifiers, etc.) as standalone artefacts —
typically `project_type: ai-product`. Stays inert otherwise.

## Approval + constraints

- **[ADR-0012](../../contextkit/memory/decisions/0012-agent-forge-squad-for-portable-agent-packages.md)** — 7 binding constraints (portable zero-dep output, hot path stays zero-dep, reuse `squadOf`, no phantom prerequisite, **eval-as-authority**, owned matrix freshness, mandatory tests).
- **[ADR-0013](../../contextkit/memory/decisions/0013-agent-forge-yaml-via-optional-dynamic-import.md)** — YAML strategy: optional `yaml` dep behind a dynamic import (the `zod` precedent).

## Pipeline

```
/forge-new
  → agent-architect      (interview → blueprint)
  → model-router         (capability-matrix × decision-rules → primary/fallback/cheap/premium + rationale)
  → prompt-engineer      (canonical → Anthropic+OpenAI+Gemini+DeepSeek+Ollama)
  → tool-designer        (canonical JSON Schema → 5 provider adapters)
  → eval-designer        (golden + red-team + rubric + thresholds)
  → governance-officer   (three pillars + fallback chain; refuses under-configured)
  → packager             (assembles APF, stamps provenance, writes 5 prompts + 5 tool adapters)
  → eval gate            (optional `runEval` → stamps `eval_passed_at` only on PASS)
```

## Maintenance commands (Fase 4)

| Command | What it does |
| --- | --- |
| `/forge-list` | Every package + version + routed primary + eval-stamp status |
| `/forge-show <agent>` | Manifest + provenance + last eval timestamp |
| `/forge-doctor` | Integrity check; fails on missing files or `{{TOKEN}}` placeholders |
| `/forge-policy <agent>` | Resolved cost / compliance / quality + fallback chain |
| `/forge-budget` | Aggregate monthly target + hard cap |
| `/forge-audit <agent>` | Audit-log tally (ok / refused / error / killed / fallbacks / cost) |
| `/forge-eval <agent>` | Re-run golden + red-team |
| `/forge-redteam <agent>` | Red-team only |
| `/forge-route <agent>` | Re-run router, diff vs current manifest |
| `/forge-fallback-test <agent>` | Chaos: primary 503 on first call |
| `/forge-refresh-matrix` | Stamp `updated`; model adds require an ADR |
| `/forge-killswitch <agent> <on\|off>` | Toggle quality kill switch (atomic) |
| `/forge-deprecate <agent>` | Stamp `metadata.deprecated_at`; recommend an ADR |

Read `/context-stats` for the aggregate Forge Stats section.

## Where each piece lives

- **Squad source** — [`templates/contextkit/squads/agent-forge/`](../../templates/contextkit/squads/agent-forge/)
- **Status map** — [`ROADMAP.md`](../../templates/contextkit/squads/agent-forge/ROADMAP.md) (the section-by-section blueprint coverage)
- **Best-practices bar** — [`best-practices.md`](../../templates/contextkit/squads/agent-forge/best-practices.md)
- **APF v1 template** — [`templates/contextkit/squads/agent-forge/templates/agent-package/`](../../templates/contextkit/squads/agent-forge/templates/agent-package/) (45 files)
- **APF format reference** — [`docs/AGENT-PACKAGE-FORMAT.md`](AGENT-PACKAGE-FORMAT.md)

## Boundary

This squad's *clients* are external projects, not Claude Code. Every other squad
in the kit (devteam / qa-team / security-team / …) services the developer; this
one services *the developer's product*.
