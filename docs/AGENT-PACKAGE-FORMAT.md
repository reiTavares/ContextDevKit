# Agent Package Format (APF) v1

> The portable, multi-provider, **zero-dep-at-consume-time** artefact that
> `agent-forge` produces. One directory per agent + semver; consumed by a
> client project's runtime adapter. The canonical template lives at
> [`templates/contextkit/squads/agent-forge/templates/agent-package/`](../templates/contextkit/squads/agent-forge/templates/agent-package/).

## Tree

```
agent-packages/
  <agent-name>@<semver>/
    manifest.yaml              # SINGLE source of truth
    README.md                  # human entry — carries the Model Selection Rationale
    CHANGELOG.md               # per-package semver chronology
    LICENSE                    # set by the author (UNLICENSED by default)
    .agentforgerc              # provenance: forge version + blueprint hash + eval run

    prompts/
      system.canonical.md      # neutral annotated source
      system.anthropic.md      # XML, cache=ephemeral
      system.openai.md         # Markdown # Role / ## Section
      system.google.md         # systemInstruction body + safetySettings note
      system.deepseek.md       # OpenAI-compat + explicit CoT cue
      system.ollama.md         # Markdown; chat_template applied by host

    tools/
      schemas.canonical.json   # JSON Schema canonical (source of truth)
      adapters/
        anthropic.tools.json   # { tools: [{ name, description, input_schema }] }
        openai.tools.json      # { tools: [{ type: "function", function: { … } }] }
        google.tools.json      # { functionDeclarations: [{ name, description, parameters }] }
        deepseek.tools.json    # OpenAI-compat
        ollama.tools.json      # OpenAI-compat

    rag/                       # only if `spec.capabilities.rag: true`
      config.yaml              # embedding model, index backend, retrieval params
      ingestion/
      retrieval/
      index/.gitkeep           # built by client, not embarked

    evals/
      golden.jsonl             # seed cases + dev-expanded set (10–50)
      red-team.jsonl           # baseline: injection / jailbreak / PII + domain
      rubric.yaml              # field-match rules
      thresholds.yaml          # release_gate + monitoring_gate
      run-eval.md              # language-neutral runner contract

    governance/
      cost.policy.yaml         # populated by governance-officer
      compliance.policy.yaml   # PII / LGPD / residency / retention / audit
      quality.policy.yaml      # eval_gates + fallback + kill_switch + retry
      fallback-chain.yaml      # ordered chain from router decision
      audit.schema.json        # audit-log line schema

    adapters/                  # only the runtimes requested by the blueprint
      node/
      python/
      go/

    examples/
      basic.node.md
      with-rag.python.md
      with-fallback.node.md
```

## manifest.yaml

```yaml
apiVersion: agentforge.contextdevkit.io/v1
kind: Agent
metadata:
  name: <agent-name>
  version: 0.1.0
  description: >
    <one-paragraph what this agent does>
  author: <email>
  created: <YYYY-MM-DD>
  provenance:
    forged_by: agent-forge@<semver>
    blueprint_hash: <sha256>
    eval_passed_at: null            # NULL until eval gate returns PASS
spec:
  intent:                            # category × complexity × multimodal × domain
  sla:                               # latency_p95_ms + availability_target
  cost:                              # per-call + monthly budgets (alerted)
  volume:                            # expected_qpd + burst_qps
  privacy:                           # PII + LGPD basis + residency + zero-retention
  capabilities:                      # tools / rag / streaming / structured_output
  model_selection:                   # PRODUCED BY router, do not hand-edit
    primary: { provider, model, temperature, max_tokens }
    fallback: [{ provider, model, condition }]
    cheap_path: { provider, model }
    premium_path: { provider, model }
    rules_applied: [<rule-id>...]
  tools: [...]
  rag:                               # block omitted if not enabled
  evals: { golden: …, thresholds: … }
  governance: { cost: …, compliance: …, quality: …, fallback: … }
  runtime_adapters: [node, python]
```

## Versioning rules

- **Major** — contract break: tool removed/renamed, `intent` shifts, input/output schema breaks.
- **Minor** — additive: new tool, new capability, no break.
- **Patch** — prompt fix, threshold tweak, model swap within same family + generation.

Every version stamps `provenance.blueprint_hash` — re-forging a hand-edited
manifest changes the hash, surfacing the drift.

## Runtime contract

Every runtime adapter exposes the same interface — switching provider is a
manifest edit, not a code change:

```ts
interface AgentRuntime {
  invoke(input): Promise<AgentOutput>
  invokeStream(input): AsyncIterable<AgentChunk>
  preflight(): Promise<HealthReport>     // checks fallback-chain providers
  estimate(input): CostEstimate
  onEvent(handler): Unsubscribe          // audit events per audit.schema.json
}
```

## Shadow-eval hook

The Node adapter ships a `createShadowEval` scaffold (see
`adapters/node/index.js`). Sample rate comes from
`quality.policy.yaml.eval_gates.drift_monitoring.sample_pct`. Real eval scoring
is delegated to the package's `evals/` + the kit's `eval-runner.mjs` so the
adapter stays thin.

## Approvals + decisions

- **[ADR-0012](../contextkit/memory/decisions/0012-agent-forge-squad-for-portable-agent-packages.md)** — adoption + 7 binding constraints.
- **[ADR-0013](../contextkit/memory/decisions/0013-agent-forge-yaml-via-optional-dynamic-import.md)** — YAML via optional dynamic import.

Full coverage map at the squad ROADMAP.
