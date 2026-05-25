# Forge best-practices — the bar every forged agent clears

> The normative reference for `agent-forge`. This is what the blueprint called the
> "Constituição / AI-AGENT-PRACTICES" — authored **here**, inline, rather than as a
> phantom prerequisite ([ADR-0012](../../memory/decisions/0012-agent-forge-squad-for-portable-agent-packages.md),
> constraint 4). It governs the **forged agents** (the output), not this repo's own
> hot path. Conflicts resolve top-down by the five principles.

## 1. The five principles

1. **Portability is absolute.** The Agent Package depends on no VibeDevKit, Node, or
   language runtime *at consume time*. It is declarative files + optional adapters. A
   client runs it via the provider SDK, LangChain, or their own runtime — with the kit
   uninstalled.
2. **Provider-agnostic manifest, provider-specific adapter.** The `manifest.yaml`
   describes the agent abstractly (intent, capabilities, tools, RAG, policy). Adapters
   translate to each provider's wire format. Switching provider swaps an adapter; it
   never rewrites the agent.
3. **Economic choice is structured, not intuitive.** The `model-router` picks
   provider+model from a capability matrix + deterministic rules. An LLM enters only as
   a tie-breaker on genuinely ambiguous cases. Predictable cost is a design goal.
4. **Best practices are the default, not a suggestion.** Everything in §3 ships in the
   base template. To *remove* one, the dev records a reason; to *keep* it, they do
   nothing. Default-safe beats flexible.
5. **Eval before embarkation.** No package leaves the forge without passing a minimum
   golden + red-team gate. Failed → refinement loop. An unmeasured agent never reaches
   the client.

## 2. Router authority comes from eval, not frozen opinion

The decision rules may deterministically *shortlist and rank* providers — but the final
"best model for this agent" verdict is the **eval harness measured on the user's golden
set**, not a preference frozen in JSON the day it was written (ADR-0012, constraint 5).
Shipped rules carry no hardcoded quality claims (no "model X is 8pp better at PT-BR").
The capability matrix is dated, versioned, and changed only via ADR + `/forge-refresh-matrix`.

## 3. The default catalogue (every forged agent ships with these)

| Default | Why it's not optional |
| --- | --- |
| **Prompt caching** (where the provider supports it) | Largest single cost lever on long, stable prompts (glossaries, rules). |
| **Fallback chain** (≥1 provider *different* from primary) | Survives a provider outage; a single-provider agent is a single point of failure. |
| **Retry with backoff** (exponential; on 5xx/timeout/rate-limit; **never** on 4xx/safety-block) | Transient errors recover; client errors and safety decisions must not be retried blindly. |
| **Rate limiting** (per-user + global) | Caps blast radius of a bug or abuse before it becomes a bill. |
| **Audit log** (inputs after redaction, output, model, cost, fallback, PII redactions) | Without it there is no compliance story and no drift forensics. |
| **Kill switch** (cost breach, eval-below-threshold, red-team regression) | The agent must be able to refuse *itself* when a guardrail trips. |
| **Eval golden + red-team** | The only objective evidence the agent works and is safe. |
| **Structured-output validation** | A malformed payload is a failure, not a "best effort" — validate, retry once, then fail. |

## 4. Provider best-practices (condensed)

| Provider | System prompt | Tools | Notes that bite |
| --- | --- | --- | --- |
| **Anthropic** | Separate param; XML-structured sections | `tools[]` + `input_schema`; `tool_choice` to force | No native JSON mode — use a single-tool schema for structured output; mark static blocks `cache_control`. |
| **OpenAI** | First `system` message | `tools[]` type `function` | Native `response_format: json_schema` strict mode; caching is automatic >1024-tok prefix. o-series: no system msg, `reasoning_effort`. |
| **Google (Gemini)** | `systemInstruction` param | `functionDeclarations[]` (JSON-Schema **subset**) | **Set `safetySettings` explicitly** or hit surprise blocks; up to 2M ctx (RAG win); caching needs >32k tokens. |
| **DeepSeek** | OpenAI-compatible | OpenAI-compatible | Prefers explicit CoT; reasoner models split `reasoning_content`; an order of magnitude cheaper; PT-BR/vision weaker than Claude/Gemini. |
| **Self-hosted (Ollama/vLLM)** | Per-model `chat_template` | Native but less reliable → robust eval is critical | Data never leaves the client's infra — the only viable path for heavy PII + strict residency. Perf depends on their hardware. |

The runtime adapters expose **one interface** regardless of provider — `invoke`,
`invokeStream`, `preflight`, `estimate`, `onEvent`. The client switches provider by
editing `manifest.yaml → spec.model_selection.primary`; their code does not change.

## 5. Governance — three pillars, equal weight

The forge refuses to package an agent with any of the three under-configured.

- **Cost** — per-call + monthly budgets, alert tiers, caching required, rate limits,
  kill switch on hard-cap breach. *Without it the agent dies of budget politics.*
- **Compliance** — PII detection + redaction/tokenization, LGPD basis + data-subject
  rights, data residency (allow/deny providers), retention, audit. *Without it the
  agent is fined, sued, or banned in regulated work.*
- **Quality** — eval gates (golden + red-team thresholds), fallback chain, retry policy,
  drift monitoring, kill switch on quality regression. *Without it the agent is cheap
  and legal but hallucinates and burns the product.*

## 6. Eval lifecycle

1. **Pre-release** *(mandatory)* — the package does not ship unless golden + red-team
   clear thresholds (e.g. golden accuracy ≥ 0.85; PII-leak block rate = 1.00).
2. **Pre-version-bump** *(mandatory on minor/major)* — a significant change reruns eval.
3. **Shadow in production** *(recommended)* — the client evals a sample (~5%) of real
   traffic to catch upstream model drift; feeds candidates back into the golden set.

## 7. Red-team minimum

Every package carries at least: **prompt-injection**, **jailbreak**, and **PII-leak**
cases. PII-leak tolerance is zero (block rate 1.00). These run before each release and
on every version bump; bias tests are recommended where the domain warrants.
