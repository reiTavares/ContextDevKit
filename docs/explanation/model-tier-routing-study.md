# Model-tier routing study — expensive models think, cheap models execute

> Status: **study + Phase 1 shipped**. Companion to the swarm study
> ([swarm-feasibility-study.md](swarm-feasibility-study.md)) — swarm workstreams
> will resolve tiers through this same policy.
> Date: 2026-06-11.

## 1. Verdict

**Feasible, and mostly already designed by accident.** Three disconnected pieces of
the kit, wired together, give ~80% of the value with zero new engine code:

1. **The tier vocabulary + resolver contract already shipped.** The squad-pipeline
   DSL defines `model_tier: fast | powerful | reasoning`, forbids vendor model names
   in `pipeline.yaml`, and names the model-router as "the single resolver from tier
   → concrete model" (`docs/SQUAD-PIPELINE-FORMAT.md`).
2. **The routing engine exists.** `squads/agent-forge/lib/router.mjs` is pure,
   zero-dep, tested; `capability-matrix.json` carries `cheap|balanced|premium` tiers
   and per-MTok prices, dated and ADR-gated (ADR-0012 §6). It was consumed only by
   forged packages — and its prices had already rotted (Opus 4.7 listed at 3× the
   current Opus price), proving the staleness risk is real, and the governance for
   it already exists.
3. **Host enforcement is native.** Claude Code honors `model:
   haiku|sonnet|opus|inherit` in agent frontmatter on every Task dispatch, plus a
   per-call `model` override on the Agent tool. Until ADR-0052, none of the kit's 34
   agents declared it — every subagent burned session-model (premium) tokens.

## 2. The architecture

Three layers, deterministic-first:

```
L1 — STATIC DEFAULT   model: frontmatter per agent (Claude Code enforces natively)
L2 — CANONICAL POLICY ADR-0052 tier table; selfcheck pins frontmatter to it
                      (Phase 2: routing-policy.json + model-policy.mjs resolver)
L3 — DISPATCH OVERRIDE the orchestrator (main session, already premium) classifies
                      the TASK (think vs execute) by a fixed ≤10-line rule list in
                      skill text and passes `model` on the Agent tool, bounded by
                      floors
```

**Cache-safe by construction.** Anthropic's agent-design guidance warns against
switching models *mid-session* (invalidates the prompt cache of the continuing
context) and prescribes exactly this shape: keep the main loop on one model, spawn
subagents on cheaper models — each subagent is a fresh context with its own cache
namespace. Claude Code's own Explore subagents run Haiku this way.

**The "deliberative governor" question, answered deterministically.** A per-dispatch
LLM judge was rejected: it costs roughly what the downgrade saves, adds latency, and
a shipped judge prompt would freeze quality opinions into the kit. The only
deliberative element is the orchestrator itself — already premium, already holding
the task context. `/debate` applies to changing the POLICY (the tier table, floors,
thresholds → ADR amendment), never to a per-call choice.

**Escalation / de-escalation (all deterministic):**

- QA gate fails twice on a fast/powerful dispatch → one re-dispatch, one tier up
  (cap `reasoning`), reported in the run digest.
- Session budget exhausted → one tier down — downgrades, never blocks.
- Floor: security / code-security / infra-security / privacy-lgpd never below
  `powerful`. Floor beats de-escalation; the escalation cap beats everything.

## 3. The tier table

| Tier | Model alias | Agents (34 total) |
| --- | --- | --- |
| reasoning | `opus` | architect, security, code-security, infra-security, privacy-lgpd, code-reviewer, agent-architect |
| powerful | `sonnet` | devops, test-engineer, qa-e2e, qa-perf, qa-fuzzer, prompt-engineer, tool-designer, eval-designer, rag-designer, governance-officer, model-router, ui-designer, ux-designer, accessibility, landing-architect, seo-specialist, growth, retention, product-owner, conversion-strategist, tracking-integrator |
| fast | `haiku` | qa-unit, qa-integration, packager, context-keeper |
| — | `inherit` | qa-orchestrator, forge-orchestrator (dispatchers need session-grade judgment) |

Aliases only — never versioned model IDs in frontmatter. The dated capability matrix
owns concrete IDs and prices; that split is the structural defence against price/ID
rot.

## 4. Economics (2026-06 list prices)

| Model | Input $/MTok | Output $/MTok |
| --- | --- | --- |
| Claude Fable 5 | 10.00 | 50.00 |
| Claude Opus 4.8 | 5.00 | 25.00 |
| Claude Sonnet 4.6 | 3.00 | 15.00 |
| Claude Haiku 4.5 | 1.00 | 5.00 |

A typical `/ship` execution fan-out (qa-unit + qa-integration + scaffolding +
explore-style reads ≈ 150K input / 25K output tokens):

- on a Fable 5 session model: 150K×$10/M + 25K×$50/M = **$2.75**
- on Opus 4.8: **$1.375**
- on Haiku 4.5: **$0.275** — 10× cheaper than Fable, 5× cheaper than Opus, on calls
  whose output is already gated by QA.

**Baseline (recorded 2026-06-11, `/token-report --json`):** 35 sessions; totals
input 4.24M / output 19.85M / cacheRead 4.29B / cacheCreate 102.7M. The D3
attribution layer (shipped in v2.0.0 the same day) splits the report per-agent
(`isSidechain`) and per-command (`attributionSkill`) — but not yet **per model**;
that last observability gap is what Phase 2's `byModel` bucket closes.

**Acceptance criterion (measured, not asserted):** subagent fan-out cost per `/ship`
run drops ≥60% with zero increase in qa-reject escalations, read from the post-D3
attribution ledger against this baseline.

## 5. Host asymmetry (stated honestly)

- **Claude Code — full enforcement.** Frontmatter covers every dispatch
  automatically; skills add the L3 classification block and pass `model` (+ low
  `effort` for fast-tier work) on the Agent tool.
- **Antigravity — documented gap.** `.agents/` personas are frontmatter-less 1:1
  conversions; the kit knows no agy per-agent or per-dispatch model API. Tier
  routing is **Claude Code only**; `docs/ANTIGRAVITY.md` carries the parity note.
  Phase 2's resolver returns `{ model: null, reason: 'host-gap' }` for
  `--host agy` — refusing to invent a Gemini mapping it cannot enforce (rule 8).

## 6. Deferrals

1. **Cross-CLI delegation** (gemini CLI etc. for selected tasks): deferred.
   `/token-report` reads Claude Code transcripts, so cross-CLI spend is invisible —
   the savings become unmeasurable, breaking the acceptance instrument; plus
   second-vendor credentials and hooks/gates that don't follow the work. Note:
   Antigravity already IS the second CLI at host level, and forged Agent Packages
   already route to Google/DeepSeek models for their own runtime — cross-provider
   needs are served where they're measurable.
2. **agy parity**: revisit when agy exposes per-dispatch model selection.
3. **Learned / per-task classification**: revisit only with eval data — the eval
   harness, not intuition, is the authority on tier quality (ADR-0012 §5).

## 7. Phasing

| Phase | Scope | Status |
| --- | --- | --- |
| 0 | Baseline `/token-report --json` snapshot (above) | ✅ done |
| 1 | `model:` frontmatter on all 34 agents + dispatch-classification block in `/ship` `/advise` `/debate` + QA skills + matrix price refresh + selfcheck | ✅ shipped with this study |
| 2 | `routing-policy.json` (~60 lines) + `model-policy.mjs` (~180 lines, reuses `loadMatrix` from router.mjs) + `selfcheck-model-policy.mjs` (frontmatter↔table agreement, floors, escalation cases) + `byModel` bucket on top of the shipped D3 attribution + `--budget-exhausted` wired into ship's budget check | 📋 backlog |
| 3 | Swarm composition (swarm-plan.mjs assigns `model_tier` per workstream, resolves through model-policy.mjs — the exact resolver contract SQUAD-PIPELINE-FORMAT already promises); agy parity; cross-CLI | deferred |

## 8. Risks

1. **Quality regression on `fast`** — bounded: ship never skips review/test stages;
   the escalation rule converts a regression into one bounded retry; floors keep
   security work off the cheap tier entirely.
2. **Price/ID staleness** — already happened once (the matrix predated Opus 4.8).
   Structural mitigation: aliases in frontmatter, prices only in the dated matrix,
   governance-gated refresh; Phase 2's resolver warns when `updated` > 90 days old.
3. **Tier sprawl** — exactly three tiers, locked by ADR-0052; the pipeline engine
   already refuses anything else.
4. **Cache** — safe: tiering applies only to spawned subagents (fresh contexts);
   the main loop never switches models.
5. **Hot path** — untouched: enforcement is frontmatter + skill text; Phase 2's
   resolver is skill-invoked tooling, never a hook.
