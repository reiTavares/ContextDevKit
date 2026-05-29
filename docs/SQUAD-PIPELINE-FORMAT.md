# Squad Pipeline Format v1

> The declarative, opt-in pipeline a squad ships at
> `templates/vibekit/squads/<squad>/pipeline.yaml`. Turns the orchestrator's
> implicit choreography into a **diffable, dry-runnable, simulate-impact-
> mappable plan**. First consumer: `agent-forge` (Fase 6, [ADR-0015](../vibekit/memory/decisions/0015-pipeline-dsl-working-stage-and-multi-session-work-claims.md) Part A).
>
> **Opt-in per squad.** A squad with no `pipeline.yaml` keeps working as
> today; the engine never runs on its own. Hot-path zero-dep stays — the
> parser uses `lib/yaml.mjs` (ADR-0013 dynamic import) and refuses with an
> informative exit-0 message when `yaml` is absent.

## Where the file lives

```
templates/vibekit/squads/<squad>/pipeline.yaml
```

The engine — `templates/vibekit/tools/scripts/squad-pipeline.mjs` — discovers
pipelines by walking that directory.

## File schema

```yaml
pipeline:
  squad: <kebab-case>          # must match the directory name
  version: "1.0.0"             # semver
  description: >               # multiline OK
    Human-readable one-paragraph summary of the pipeline's job.
  steps:
    - id: <kebab-case>         # unique within this pipeline
      agent: <briefing-key>    # matches .claude/agents/<id>.md  (omit on checkpoint)
      execution: inline | subagent
      model_tier: fast | powerful | reasoning
      condition: <expr>        # optional; whitelisted grammar (see below)
      on_reject: <step-id>     # optional; loop back target
      max_review_cycles: <int> # required when on_reject is set; hard cap
      type: checkpoint         # only for non-agent steps
      outputFile: <repo-relative-path>   # checkpoint only
```

### Required fields per step

| Step kind | Required | Forbidden |
|---|---|---|
| Agent step | `id`, `agent`, `execution`, `model_tier` | `type`, `outputFile` |
| Checkpoint | `id`, `type: checkpoint`, `outputFile` | `agent`, `execution`, `model_tier` |

Future step kinds (`type: render`, `type: parallel`) land behind their own
ADRs when a real use case arrives — v1 is **linear with `condition` +
`on_reject`** by deliberate choice.

## `execution`

| Value | Meaning |
|---|---|
| `inline` | The `forge-orchestrator` (or equivalent) persona-switches into this agent in the same conversation turn. |
| `subagent` | The orchestrator spawns a background `Agent({ subagent_type })` call. Results return as a structured message. |

The engine itself never decides; it passes the value through to the
orchestrator's dispatch layer.

## `model_tier`

```
fast       — cheap & quick (e.g. Haiku-class)
powerful   — high-quality general (e.g. Sonnet-class)
reasoning  — deep reasoning (e.g. Opus-class or o-series)
```

**Vendor model names are forbidden in `pipeline.yaml`.** The engine refuses
on bare model strings (`model: claude-sonnet-4-6` and friends). The
[`model-router`](../templates/vibekit/squads/agent-forge/lib/router.mjs)
(ADR-0012 §4) is the single resolver from tier → concrete model, honouring
the capability matrix, residency constraints, and budget policy. Pipelines
declare *intent*; the router decides *implementation*.

## `condition` — whitelisted grammar

The expression that decides whether a step runs. v1 grammar is deliberately
tiny — no arbitrary expression evaluation, no function calls, no boolean
chaining.

```
condition := dotted_id <op> literal
           | dotted_id ".length" <op> int

dotted_id := identifier ( "." identifier )*
identifier := /[a-zA-Z_][a-zA-Z0-9_]*/
op        := "==" | "!=" | ">" | "<" | ">=" | "<="
literal   := string | int | float | bool | "null"
string    := '"' /[^"]*/ '"'    # single quotes also accepted
bool      := "true" | "false"
```

### Examples that parse

```yaml
condition: blueprint.tools.length > 0
condition: capabilities.rag == true
condition: intent.domain == "medical"
condition: budget.monthly_cap_usd <= 100
condition: deployment.residency != null
```

### Examples that **refuse**

```yaml
# function call
condition: hasTools(blueprint)

# boolean chaining
condition: blueprint.tools.length > 0 && capabilities.rag == true

# arithmetic
condition: budget.monthly_cap_usd / 30 < 5

# bare identifier (no comparison)
condition: blueprint.tools
```

Anything outside the grammar exits 1 at parse time with `condition refused:
grammar violation at <step-id>`.

### Evaluation rules

- `dotted_id` resolves against the pipeline **context** (the blueprint +
  router decision + accumulated step outputs).
- An unknown identifier resolves to `undefined`. `undefined <op> <literal>`
  is **always false** (the step does not run).
- `.length` is special-cased for arrays and strings. On non-array, non-string
  values it yields `undefined` → false.
- No coercion: `"5" == 5` is **false**.

A bigger grammar (`&&`, `||`, function calls, arithmetic) is recorded as
deliberately rejected in [ADR-0015 §A.2](../vibekit/memory/decisions/0015-pipeline-dsl-working-stage-and-multi-session-work-claims.md).
Expanding it needs a new ADR with the real use case attached.

## `on_reject` + `max_review_cycles`

Bounded retry loop. When a step's output is rejected (the rejection signal
itself is the agent's contract — typically `{ verdict: 'reject', ... }` from
an eval gate or a reviewer), the engine jumps back to `on_reject`'s target
step and re-runs forward.

```yaml
- id: eval-gate
  agent: eval-designer
  execution: subagent
  model_tier: powerful
  on_reject: generate-prompt
  max_review_cycles: 3
```

`max_review_cycles` is a **hard cap**. The engine refuses to loop past it
and exits with:

```
PIPELINE HALTED — manual escalation required
   step:    eval-gate
   cycle:   3 of 3
   reason:  max_review_cycles reached
```

No silent retries. A pipeline that hits the cap means the loop is not
converging; a human picks it up.

## `type: checkpoint`

A non-agent step that **pauses execution for human approval**. The user's
decision is captured in `outputFile` (repo-relative), which subsequent steps
can `condition`-on by referencing its parsed fields.

```yaml
- id: checkpoint-shortlist
  type: checkpoint
  outputFile: pipeline/data/shortlist.md
```

The orchestrator surfaces the checkpoint by printing the step's briefing
file (looked up via the squad's directory conventions) and waiting on
stdin / a slash-command response.

## `--dry-run`

```
node templates/vibekit/tools/scripts/squad-pipeline.mjs <squad> --dry-run
```

The engine walks the graph, resolves `condition` against an empty context
(every identifier → `undefined`, so every conditional step is skipped by
default), prints the would-be execution order, and **runs no agents**.

Output shape:

```
Pipeline: agent-forge v1.0.0
  ✓  validate-blueprint        agent     forge-orchestrator   inline   fast
  ✓  route                     agent     model-router         inline   fast
  ✓  checkpoint-shortlist      checkpoint
  ✓  generate-prompt           agent     prompt-engineer      inline   powerful
  ⊘  generate-tools            agent     tool-designer        inline   powerful   (condition: blueprint.tools.length > 0 → undefined)
  ✓  governance                agent     governance-officer   inline   powerful
  ↺  eval-gate                 agent     eval-designer        subagent powerful   (on_reject → generate-prompt, max_cycles: 3)
  ✓  package                   agent     packager             inline   fast
```

`✓` runs · `⊘` skipped by condition · `↺` has retry loop.

A non-empty plan is the basic correctness check; the integration test
asserts agent-forge produces it.

## Engine refusal modes

| Situation | Exit | Behaviour |
|---|---|---|
| `yaml` package not installed | **0** | Informative message; pipelines are opt-in, this is not an error. Squad continues without the DSL. |
| `pipeline.yaml` invalid yaml | 1 | "pipeline.yaml malformed at <line>" |
| Unknown step kind / missing required field | 1 | "step <id> missing required field <field>" |
| Vendor model name instead of `model_tier` | 1 | "step <id>: vendor model names are forbidden; use model_tier" |
| `condition` violates whitelist | 1 | "condition refused: grammar violation at <step-id>" |
| `on_reject` target does not exist | 1 | "step <id>: on_reject target '<x>' not found" |
| `on_reject` without `max_review_cycles` | 1 | "step <id>: on_reject requires max_review_cycles" |
| Bare model name in `agent` (not in briefings) | 1 | "step <id>: agent '<x>' has no briefing under .claude/agents/" |

## Selfcheck

`checkSquadPipeline` runs in CI and validates each `pipeline.yaml`:

1. yaml parses (skipped when `yaml` is absent, but the file is still read
   as plain text for the briefing-existence check below);
2. every `agent` resolves to an existing briefing at
   `.claude/agents/<agent>.md`;
3. every `on_reject` target exists in the same pipeline;
4. every `condition` parses by the whitelist;
5. `model_tier` is one of `fast` | `powerful` | `reasoning`;
6. no vendor model names appear in the file.

## Boundaries with the rest of the kit

- **Squad pipelines are opt-in.** No `pipeline.yaml` → squad keeps running
  the way it does today.
- **Engine writes no shared state in v1.** Task 040 ([ADR-0015 Part C](../vibekit/memory/decisions/0015-pipeline-dsl-working-stage-and-multi-session-work-claims.md))
  introduces `state.json` per run; until then, the engine prints to stdout
  and that's it.
- **`/ship` does not adopt this yet.** Same engine, but the integration is
  a follow-up after Fase 6 ships.
- **Hot-path zero-dep stays.** The dynamic import lives behind
  [`lib/yaml.mjs`](../templates/vibekit/squads/agent-forge/lib/yaml.mjs);
  `runtime/hooks/**` and `runtime/config/load.mjs` import nothing from
  here. Pipelines are an L4+ feature.

## Cross-references

- [ADR-0012](../vibekit/memory/decisions/0012-agent-forge-squad-for-portable-agent-packages.md) — agent-forge boundary + router as single resolver
- [ADR-0013](../vibekit/memory/decisions/0013-agent-forge-yaml-via-optional-dynamic-import.md) — sanctioned optional yaml import
- [ADR-0015](../vibekit/memory/decisions/0015-pipeline-dsl-working-stage-and-multi-session-work-claims.md) — this format's authorising ADR
- [`docs/SQUADS/agent-forge.md`](SQUADS/agent-forge.md) — first consumer
