# agent-forge — blueprint → status

> The single map between the original `agent-forge` blueprint and what is actually
> shipped here. Read this **first** when working on the squad — it spares you a
> spelunk through the ADRs, the backlog, and the source. Kept current as work moves.
>
> **Status key** (same as [`docs/ROADMAP.md`](../../../../docs/ROADMAP.md)):
> ✅ done · ⏳ in progress · 🟡 partial · 📋 planned · ➖ dropped/superseded ·
> 🆕 added by ADR (not in the original blueprint).

## Anchors

- **Approved by** [ADR-0012](../../memory/decisions/0012-agent-forge-squad-for-portable-agent-packages.md) — 7 binding constraints reshape the blueprint where it collided with the kit.
- **YAML strategy** [ADR-0013](../../memory/decisions/0013-agent-forge-yaml-via-optional-dynamic-import.md) — optional `yaml` behind dynamic import (the `zod` precedent).
- **Phased delivery** on the DevPipeline as tasks **030–035** (Fases 0–5). Fase 0 ✅; Fase 1 ⏳.

## Coverage map (blueprint section → here)

| § | Blueprint | Status | Where / next |
|---|---|---|---|
| 0–1 | Exec summary + 5 principles | ✅ | [`README.md`](README.md), [`best-practices.md`](best-practices.md) |
| 2 | `squad.manifest.json` | ➖ | Dropped by ADR-0012 §3 — squads detected by `squadOf` (the `(agent-forge squad)` tag) |
| 2 | Squad folder + roster table | ✅ | [`README.md`](README.md) — agents listed by phase |
| 2 | The 8 lean agent files (`.claude/agents/forge-*.md`) | 📋 | Fase 1 (orchestrator / architect / router / prompt-engineer / tool-designer / packager) · Fase 3 (governance-officer / eval-designer) · Fase 5 (rag-designer) |
| 2 | `templates/providers/<provider>/` reusable snippets | 🟡 | Per-provider stubs currently live **inside** the APF (`prompts/system.<provider>.md` + `tools/adapters/<provider>.tools.json`). Split out only if Fase 1–2 generators need shared snippets above APF scope. |
| 2 | `policies/*.template.yaml` (squad scope) | 🟡 | The canonical policy templates ship **inside** the APF (`agent-package/governance/*.policy.yaml`). Equivalent for now; split if Fase 3's governance-officer needs squad-level partials. |
| 3 | APF v1 — full tree (45 files) | ✅ | [`templates/agent-package/`](templates/agent-package/) (commit `d5efcd2`) |
| 4.1 | Router inputs | ✅ | Documented (best-practices §4 / blueprint §4.1) — consumed in Fase 1 |
| 4.2 | `capability-matrix.json` | ✅ | [`router/capability-matrix.json`](router/capability-matrix.json) (5 providers / 11 models, dated, ADR-gated, parse/id guard — commit `3ad928a`) |
| 4.3 | `decision-rules.json` | 📋 | Fase 1 (task 031) — bounded to ≤15 rules per blueprint §12 |
| 4.4 | Rationale section in package README | ✅ slot / 📋 generator | APF README has the slot ready; the model-router fills it in Fase 1 |
| 5 | Per-provider behaviour notes | ✅ | `best-practices.md` §4 (condensed table) |
| 5 | `prompt-engineer` per-provider generators | 📋 | Fase 1 (Anthropic + OpenAI) · Fase 2 (Gemini, DeepSeek, self-hosted) |
| 5 | `tool-designer` per-provider generators | 📋 | Fase 1 · Fase 2 (same split) |
| 5 | Runtime `AgentRuntime` contract | ✅ | Documented in APF adapter READMEs + Node/Python/Go stubs |
| 6.1–6.3 | Cost / compliance / quality policy templates | ✅ | [`templates/agent-package/governance/`](templates/agent-package/governance/) |
| 6.x | `fallback-chain.yaml` + `audit.schema.json` | ✅ | Same dir |
| 6 | `governance-officer` ENFORCER ("refuse if any pillar under-configured") | 📋 | Fase 3 (task 033) |
| 6.4 | Three-pillar equal-weight rationale | ✅ | `best-practices.md` §5 |
| 7.1–7.3 | Golden / red-team / rubric / thresholds | ✅ templates | [`templates/agent-package/evals/`](templates/agent-package/evals/) |
| 7.4 | Eval lifecycle (3 moments) | ✅ docs / 📋 runner | `best-practices.md` §6; runner + gate in Fase 3 |
| 7 | Eval gate in orchestrator (≤3 retries → abort) | 📋 | Fase 3 |
| 8 | `/forge-new` | 📋 | Fase 1 |
| 8 | `/forge-refresh-matrix` `/forge-route` `/forge-budget` `/forge-killswitch` `/forge-list` `/forge-show` `/forge-eval` `/forge-redteam` `/forge-audit` `/forge-doctor` `/forge-deprecate` `/forge-policy` `/forge-fallback-test` | 📋 | Fase 4 (task 034) |
| 9 | Full lifecycle (forge → review → install → prod → maintain) | 🟡 docs / 📋 engine | Documented; the engine that runs it is Fases 1, 3, 4 |
| 10 | L4 enablement | ✅ | `README.md` "Where it sits in the levels" |
| 10 | L5 `simulate-impact` for `agent-packages/` edits | 📋 | Wire once Fase 1 emits packages |
| 10 | L6 `/vibe-stats` Forge Stats section | 📋 | Fase 4 |
| 10 | L7 `/fleet` cross-repo agent-package registry | 📋 | Fase 5 (task 035) |
| 11 | Implementation roadmap (5 fases) | ✅ | Mapped 1:1 to backlog 030–035 with sequenced SLAs |
| 12 | Risks — matrix freshness | ✅ | ADR-0012 §6 + `checkCapabilityMatrix` |
| 12 | Risks — decision-rules Frankenstein | 📋 | Enforce the 15-rule cap when writing `decision-rules.json` (Fase 1) |
| 12 | Risks — golden eval staleness | 📋 | Shadow eval feeding golden (Fase 4) |
| 12 | Risks — cross-project package divergence | 📋 | `/fleet` (Fase 5) |
| 12 | Risks — compliance vertical templates (HIPAA/PCI) | ➖ v1 | Future jurisdiction add-ons via `compliance-team` squad |
| 12 | Risks — forge self-cost | ✅ planned | Orchestrator defaults to Haiku (set in agent files, Fase 1) |
| Ap A | forge vs classic squad table | ✅ | `README.md` "The boundary (why this squad is different)" |
| Ap B | Why a separate factory squad | ✅ | Same section |
| Ap C | Glossary | 📋 low priority | Inline in best-practices for now; consolidate if it grows |

## Net additions (ADR-driven, not in the original blueprint)

🆕 **No `squad.manifest.json`** (ADR-0012 §3) — reuse the kit's `squadOf` detection.
🆕 **No phantom `AI-AGENT-PRACTICES.md`** (ADR-0012 §4) — authored inline as `best-practices.md`.
🆕 **Eval-as-authority** (ADR-0012 §5) — router rules are deterministic shortlists; the eval harness measured on the user's golden set decides.
🆕 **Matrix-freshness guard** (ADR-0012 §6) — `checkCapabilityMatrix` rejects malformed / duplicate / disallowed model ids.
🆕 **Hot-path zero-yaml** (ADR-0013) — `checkHotPathNoYaml` enforces rule 1.
🆕 **`lib/yaml.mjs` loader** (ADR-0013) — the single touchpoint for the optional `yaml` dep.

## How this stays current

A session that touches agent-forge **updates the markers here** as work moves (✅⏳🟡📋➖) — same convention as `docs/ROADMAP.md`. New architectural decisions → a new ADR, then a row update here cross-referencing it. The DevPipeline tasks 030–035 are the *executable* counterpart; this is the **map** that ties them to the original spec + the ADRs + the source files.

## Quick refs

- Approval + constraints: [ADR-0012](../../memory/decisions/0012-agent-forge-squad-for-portable-agent-packages.md)
- YAML strategy: [ADR-0013](../../memory/decisions/0013-agent-forge-yaml-via-optional-dynamic-import.md)
- Backlog: `vibekit/pipeline/backlog/031..035-*.md` · concluded: `conclusion/030-*.md`
- Sessions: 17 (initial review + ADR + Fase 0 + Fase 1 foundation)
- Branches: `feat/agent-forge-fase0` (PR #18) · `feat/agent-forge-fase1` (current)
