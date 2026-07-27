# How to forge an agent package

## When to use this guide

You need an agent that is **portable** — one that runs outside this kit, against a
provider you choose, with its cost, compliance and quality posture declared as files you
can review and version. The forge produces that as a self-contained package directory.

You do **not** need this to get an agent working inside ContextDevKit. The kit already
ships a catalog of agents wired to its own routing and squads. Read the decision tree
first; forging is the more expensive path and most requests do not need it.

## Decide first: forge, or use the catalog

The kit's own agent catalog covers nine squads — development, design, QA, security,
compliance, product, operations, growth, and the forge squad itself. Those agents are
briefings the host loads, routed by the kit's policy registry. They are free to use, are
maintained with the kit, and need no build step.

Print the catalog before deciding:

```bash
node -e "const r=require('./contextkit/policy/agent-capability-registry.json');const a=r.agents;console.log(Object.entries(a).map(([k,v])=>k+'  '+v.squad).join('\n'))"
```

Use the catalog when all of these hold:

- The work happens inside a ContextDevKit project.
- An existing squad covers the domain, or the gap is a *briefing* difference you can
  express by editing an agent's markdown.
- You do not need a declared cost ceiling, a provider fallback chain, or an audit trail
  as artifacts.
- The consumer is a host the kit already supports.

Forge a package when any of these hold:

- The agent must run **outside** this kit — in an application, a service, or another
  team's stack.
- You need the governance artifacts as reviewable files: budgets and alert thresholds, a
  personal-data handling policy, retention and residency, an audit log schema, an
  explicit fallback chain.
- You need per-provider renderings of the same prompt and the same tool schemas.
- You want the package's behaviour measured against a golden set you own, with a
  threshold file that gates release.

If you are unsure, start with the catalog. A forged package is a build artifact you now
maintain; an agent briefing is a file you edit.

### What a forged package does not give you

The forge is a scaffolding and governance pipeline. It renders the files, checks the
policy shape, and refuses to ship an under-configured package. It does **not** certify
that the agent is good at its job. The only quality signal a package carries is what the
eval gate measured on the golden set you provided — and with the providers that ship
today, that measurement runs against a deterministic stub, not a real model. Read the
"honest state" section before you treat a passing gate as evidence.

## Prerequisites

- ContextDevKit installed, and commands run from the project root.
- Node.js 18 or newer.
- The `yaml` package. It is an optional dependency and is **not installed in this repo**;
  most forge commands refuse with a message naming it until you run `npm i yaml`.
- A blueprint file describing the agent. The interview questions that define a valid
  blueprint live in the forge squad's architect library; an invalid blueprint is refused
  with the failing fields named.

## Steps

1. **Check the surface.** The command prints its usage and the default paths.

   ```bash
   node contextkit/squads/agent-forge/cli/forge-new.mjs --help
   ```

   Four flags are parsed: `--blueprint` (or `-b`), `--out` (or `-o`), `--version` (or
   `-v`), and `--help` (or `-h`). The default output root is `agent-packages` and the
   default version is `0.1.0`.

2. **Forge the package.**

   ```bash
   node contextkit/squads/agent-forge/cli/forge-new.mjs --blueprint ./my-agent.yaml
   ```

   The pipeline runs in a fixed order, and each stage can refuse:

   | Stage | What it does | Refusal |
   |---|---|---|
   | validate blueprint | Checks required fields | Throws with the field list; nothing is written. |
   | fill defaults | Normalizes optional fields | — |
   | route | Applies deterministic shortlist rules, picks primary and a cross-provider fallback | Throws when no candidate satisfies the constraints. |
   | governance | Builds the three pillars and the fallback chain | Throws naming the under-configured pillar; nothing is written. |
   | package | Copies the template tree, then overwrites the generated files | — |

   The result lands at `agent-packages/<agent-name>@<version>/`.

3. **Read what the router decided.** The package README carries a generated *Model
   Selection Rationale* block: the constraints that were applied, which shortlist rule
   matched, and whether the fallback is on a different provider than the primary. It
   states its own limits — the rationale records structural facts (capabilities,
   residency, tool use, rule trace), never a judgment that one model is better than
   another. That judgment belongs to the eval harness measured on your data.

   ```bash
   node contextkit/squads/agent-forge/cli/forge-eval-cli.mjs route <agent>
   ```

   This re-runs routing against the current matrix and diffs it against the manifest.
   Read-only; it never touches the manifest.

4. **Check package integrity.**

   ```bash
   node contextkit/squads/agent-forge/cli/forge-ops.mjs doctor
   ```

   It verifies that eleven required files exist and that no unresolved template
   placeholders remain in the three policy files. Exit code is 1 when any package is
   unhealthy.

5. **Run the eval gate.**

   ```bash
   node contextkit/squads/agent-forge/cli/forge-eval-cli.mjs eval <agent>
   ```

   Two suites run. The golden suite scores each case field-by-field against its rubric
   rule — exact match, order-insensitive set match, numeric tolerance, or semantic
   similarity — and a case passes only when every counted field passes. The red-team
   suite runs a fixed baseline covering prompt injection, jailbreak, and personal-data
   leak, scored by substring and regular-expression checks on the output.

   Thresholds live in the package at `evals/thresholds.yaml`, derived from the blueprint:
   a minimum golden accuracy, per-category red-team block rates (stricter when the
   blueprint declares personal data present), and latency and per-call cost ceilings. A
   failing verdict prints each reason and exits 1.

6. **Expand the golden set.** The generator ships **one** seed case shaped by the
   agent's category, plus three fixed red-team cases. That is a scaffold, not a test
   suite. Growing it to a set that actually discriminates is work you do against your own
   domain, with the eval-designer agent if you want help.

7. **Review the governance posture, then decide on release.**

   ```bash
   node contextkit/squads/agent-forge/cli/forge-ops.mjs policy <agent>
   node contextkit/squads/agent-forge/cli/forge-ops.mjs budget
   ```

## Command index, and the gate each one serves

Fourteen commands ship. Every read-only command is safe to run at any time; every mutator
is dry-run by default and applies only with `--write`.

| Command | Class | Gate it serves |
|---|---|---|
| `forge-new` | mutator | The whole pipeline. Refuses on an invalid blueprint or an under-configured pillar. |
| `forge-list` | read-only | Inventory: which packages exist, the routed primary, whether an eval stamp is present. |
| `forge-show` | read-only | Manifest, provenance, last eval timestamp. |
| `forge-doctor` | read-only | Structural integrity: required files present, no leftover placeholders. Exits 1 on a problem. |
| `forge-policy` | read-only | The three governance pillars plus the resolved fallback chain. |
| `forge-budget` | read-only | Cost pillar, aggregated: monthly target and hard cap across packages. |
| `forge-audit` | read-only | Audit-log pillar: tallies the package's log by outcome, with fallback rate and cost. |
| `forge-eval` | read-only | Release gate: golden accuracy plus red-team block rates against the thresholds. Exits 1 on fail. |
| `forge-redteam` | read-only | Red-team only — injection, jailbreak, personal-data leak. Exits 1 on a leak. |
| `forge-route` | read-only | Routing conformance: re-route and diff against the manifest. |
| `forge-fallback-test` | read-only | Resilience scaffold: simulates an upstream failure on the first call. |
| `forge-refresh-matrix` | dry-run default | Freshness stamp on the capability matrix. Only the date; model and price changes need a governing decision. |
| `forge-killswitch` | dry-run default | Quality pillar's kill switch, on or off. |
| `forge-deprecate` | dry-run default | Lifecycle: stamps a deprecation timestamp in the manifest. |

### What the governance pillars require

The pipeline refuses to ship unless each pillar carries every one of its sections. This is
the shape check, not a compliance verdict:

| Pillar | Required sections |
|---|---|
| cost | budgets, alerts, caching, rate limiting, kill switch |
| compliance | personal-data handling, data-protection basis, residency, retention, audit, red team |
| quality | eval gates, fallback chain, kill switch, retry, observability |

The fallback chain declares a primary, an ordered chain with a trigger condition per
entry, and one explicit refusal: a safety block never falls through to another model. The
audit schema requires a timestamp, the agent, the model actually used, and an outcome from
a closed set covering success, refusal, error, and kill.

## Verify it worked

```bash
node contextkit/squads/agent-forge/cli/forge-ops.mjs list
node contextkit/squads/agent-forge/cli/forge-ops.mjs doctor
```

`list` shows each package with its routed primary model and whether an eval stamp is
present; `doctor` exits 0 when every package has its required files and no unresolved
placeholders in the policy files. On a repository with no packages both print a
"no packages found" line and exit 0 — that is the honest empty state, not a failure.

## Troubleshooting

**Symptom:** a command exits 1 with a message asking you to install `yaml`.
Fix: `npm i yaml`. It is an optional dependency and is not installed here by default, so
most forge commands are unusable until it is present.

**Symptom:** the pipeline refuses with a list of under-configured pillars.
Fix: this is the intended refusal. The blueprint is missing the inputs a pillar needs.
Nothing was written; fix the blueprint and re-run.

**Symptom:** a freshly forged package shows no eval stamp.
Expected, and worth understanding. The forge command does not run the eval gate — it
prints a reminder to run it. And the eval command does not write the stamp back into the
package. So the provenance field stays empty until something sets it, and nothing in the
codebase currently does. Treat the stamp as unimplemented rather than as a signal.

**Symptom:** `forge-killswitch --write` leaves two kill-switch blocks in the quality
policy.
Cause: the generated quality policy declares kill-switch triggers but no enabled flag, so
the first toggle appends a new block instead of editing one. A second run edits the
appended block. Review the file after the first toggle.

**Symptom:** a mutator with `--json --write` prints JSON and changes nothing.
Cause: the JSON branch returns before the write in the admin commands. Drop `--json` when
you intend to apply.

**Symptom:** the eval gate passes but you do not trust it.
You are right not to. See below.

## Honest state of this subsystem

The pipeline, the refusals, the rendering and the policy shape checks are real and
exercised. The measurement layer is thinner than the command names suggest:

- **No real provider adapters exist.** The provider flag accepts a deterministic stub and
  a failure-injecting variant, and rejects anything else with a message saying real
  adapters need credentials and are out of scope. The stub is built to satisfy the seed
  case, so a passing golden run on a freshly forged package proves the harness executes —
  not that a model performed.
- **The eval command ignores the package's own eval files.** It reconstructs a synthetic
  blueprint from the manifest and re-derives the seed cases and thresholds, so a golden
  set you expanded on disk and a threshold file you tuned are not what it scores.
- **Semantic-similarity rules are inert.** No similarity callback is supplied anywhere, so
  those fields are skipped and uncounted. A package whose rubric relies on them evaluates
  zero fields, and the golden check then does not apply at all.
- **The failure-injection command does not exercise the fallback chain.** Its own output
  says the chain wiring lives in the consuming runtime adapter; the command only checks
  that the harness survives an upstream failure.
- **Every package ships an unpopulated provenance side-file.** The integrity check does
  not scan it, so it passes with template placeholders intact.
- **Adapter directories for all supported runtimes are copied regardless** of which
  runtimes the blueprint asked for; only the requested ones get their placeholders filled.
- **The capability matrix carries price data for only some entries**, and it is explicitly
  labelled illustrative and date-stamped. It is not a pricing source.
- **The bounded refinement loop is not code.** The retry-then-abort cycle around a
  rejected eval is declarative metadata plus an agent's judgment, not a loop in the
  pipeline.

## Related

- Reference: `docs/AGENT-PACKAGE-FORMAT.md` — the package layout and manifest fields.
- Reference: `docs/reference/agents.md` — the kit's own agent catalog, the alternative to
  forging.
