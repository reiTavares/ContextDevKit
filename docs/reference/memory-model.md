# Reference: Memory model

The layout of `contextkit/memory/`, which files are authored and which are
generated, and what tracked-versus-ignored means for each one.

## Synopsis

```
contextkit/memory/
├── decisions/            decision records — authored
│   ├── business/         records whose primary context is a Business
│   ├── operations/       records whose primary context is an Operation
│   ├── legacy/           records written before the ownership-based filing
│   ├── _templates/       record templates
│   ├── _TEMPLATE.md      the single-file template
│   └── README.md         how the folder is organised
├── sessions/             one file per work session — authored by the ceremony
├── business/             BIZ-####-<slug>/ work contexts — authored
├── operations/           OP-####-<slug>/ work contexts — authored
├── workflows/            spec packs not nested under an owner, plus done/
├── deliberations/        one file per recorded debate — authored
├── predictions/          predicted-versus-actual records — authored
├── business-rules/       domain rule records — authored
├── project-map/          structural map + graph projection — GENERATED
├── roadmap.md            product plan — authored
├── GLOSSARY.md           internal term-to-identifier map — authored
├── SESSIONS.md           index of sessions/ — GENERATED
├── WORKSPACE.md          active-session and claim summary — GENERATED
├── DELIBERATIONS.md      index of deliberations/ — GENERATED
├── decision-registry.json      index of decisions/ — GENERATED
├── workflow-registry.json      index of every workflow — GENERATED
├── work-context-registry.json  index of business/ + operations/ — GENERATED
└── *.jsonl                     append-only telemetry journals
```

Workflows are stored inside their owner: a workflow owned by a Business lives at
`business/BIZ-####-<slug>/workflows/WF-####-<slug>/`, and a workflow owned by an
Operation at `operations/OP-####-<slug>/workflows/WF-####-<slug>/`. The top-level
`workflows/` directory holds spec packs that predate owner nesting. Concluded work
moves into a `done/` subdirectory of the same parent.

## Source files versus generated files

Two layers share the directory and they have opposite rules.

| Layer | Written by | Hand-editable | Effect of a hand edit |
| --- | --- | --- | --- |
| Source | A human, or a ceremony command acting for one | Yes — this is the record | The edit is the record |
| Generated | A generator reading the source layer | No | Overwritten on the next regeneration |

### Source files

Authored, durable, and the reason the directory exists.

| Path | Contents | Written by |
| --- | --- | --- |
| `decisions/**/ADR-NNNN-<slug>.md` | One decision: context, decision, consequences, acceptance | `/new-adr`, then `decision.mjs accept --id ADR-NNNN --actor human --apply` |
| `sessions/<YYYY-MM-DD>-<NN>-<slug>.md` | What one session did and why | `/log-session` |
| `business/BIZ-####-<slug>/business.json` | Business identity, lifecycle status, approval, intake classification | `work.mjs business` and the lifecycle verbs |
| `operations/OP-####-<slug>/operation.json` | Operation identity, kind, ceremony, decision coverage, links | `work.mjs operation` |
| `**/WF-####-<slug>/workflow-state.json` | The sole authority on a workflow's lifecycle state | `workflow.mjs` verbs |
| `**/WF-####-<slug>/workflow-plan.json` | Waves, their dependencies, gates, and tasks | `workflow.mjs` verbs |
| `**/WF-####-<slug>/{index,prd,spec,decisions,tasks,memory}.md` | The spec pack | Authored during the planning phases |
| `deliberations/<YYYY-MM-DD>-<NN>-<slug>.md` | One debate: independent positions and the synthesis | `/debate` |
| `GLOSSARY.md` | The project's own domain-term-to-identifier map | Authored |
| `roadmap.md` | The product plan | `/roadmap` |
| `predictions/`, `business-rules/` | Predicted-versus-actual records; domain rule records | Authored |

A ceremony command writing a source file does not make the file generated. The
command is a typing aid with validation; the content is the record, and editing it
later is legitimate. The distinction that matters is whether a regeneration will
overwrite it, and for these files nothing regenerates them.

### Generated files

Derived projections. Every one of them is reconstructible from the source layer,
which is exactly why editing one is pointless.

| Path | Rebuilt by | Reads from |
| --- | --- | --- |
| `SESSIONS.md` | `node contextkit/tools/scripts/session-reindex.mjs` | `sessions/` |
| `DELIBERATIONS.md` | `node contextkit/tools/scripts/deliberations-reindex.mjs` | `deliberations/` |
| `WORKSPACE.md` | `node contextkit/tools/scripts/workspace-sync.mjs` | `.claude/.workspace/<sessionId>.json` |
| `decision-registry.json` | `node contextkit/tools/scripts/work.mjs reconcile --apply` | `decisions/` |
| `workflow-registry.json` | `node contextkit/tools/scripts/work.mjs reconcile --apply` | every workflow directory |
| `work-context-registry.json` | `node contextkit/tools/scripts/work.mjs reconcile --apply` | `business/`, `operations/` |
| `project-map/` | `node contextkit/tools/scripts/project-map.mjs` | the repository's source tree |

The three reindexers also run from the pre-commit git hook at level 3 and above, so
a commit that adds a session or a debate carries the refreshed index with it. Each
generated markdown file opens with a do-not-edit banner naming its generator, and each
registry carries a `generator` field in its JSON. Those markers are the contract:
if a file states a generator, a hand edit to it is a change that will disappear.

`work.mjs reconcile` is dry-run by default and rebuilds all three registries
atomically under `--apply`. `--check` reports which registry files are present
without rebuilding anything.

## Reading the record

Read the record before acting on non-trivial work. These are the read paths.

| Goal | Command |
| --- | --- |
| Find whether a decision already exists on a topic | `node contextkit/tools/scripts/adr-digest.mjs --search "<terms>"` |
| List decisions as data | `node contextkit/tools/scripts/decision.mjs registry --json` |
| Read one work context's state and gate | `node contextkit/tools/scripts/work.mjs status --id BIZ-####` |
| Read a workflow's phase and deliverables | `node contextkit/tools/scripts/workflow.mjs status <slug>` |
| Resolve the next required step | `node contextkit/tools/scripts/work.mjs next` |
| Check the install's wiring and config | `node contextkit/tools/scripts/doctor.mjs` |

The latest session file and the decision record governing the area you are about to
change are the two reads that pay for themselves most often. The registries are for
machines and for breadth; the authored files are for understanding.

## Version control posture

Ignored is not the same as unimportant, and this is the single most misread property
of the memory directory.

### What is ignored, and why

The installer adds a committed ignore block covering the generated layer and local
runtime state: `SESSIONS.md`, `WORKSPACE.md`, `DELIBERATIONS.md`, the three
registries, `project-map/`, scan-output files such as `deep-analysis-findings.json`,
and the per-session directories `.claude/.sessions/` and `.claude/.workspace/`.

The reason is merge churn, not disposability. A regenerable index committed by two
parallel sessions conflicts on every line and resolves to nothing anyone authored.
Leaving it out of the index costs nothing, because any clone can rebuild it with one
command.

The authored layer — `decisions/`, `sessions/`, the work contexts, the spec packs —
stays trackable in a project's own repository and is meant to be committed there.

### When the whole tree is kept out of a public repository

A project can go further and keep the entire memory tree out of the repository it
publishes, while keeping it fully present on disk. The platform's own repository does
this: the memory tree is excluded from the public remote and pushed instead to a
private remote the maintainer controls, using a second git directory over the same
working tree. This is plain git configuration, not a platform command — the kit ships
no mirroring command.

### The rule that follows

**A memory file absent from `git status`, absent from `git log`, or absent from the
published branch is behaving as designed. That is never a reason to treat it as
absent from the project.**

On disk the memory tree is the project's authoritative documentation. It is where the
decisions, the session narrative, and the workflow state actually live. An agent or a
reader who concludes "it is not in git, so it does not count" will reconstruct a
plausible history instead of the real one — which is the specific failure the whole
directory exists to prevent. When the tracked state and the disk disagree about
whether something exists, the disk is right.

## Error conditions

| Condition | Behaviour |
| --- | --- |
| A generated file was hand-edited | The edit survives until the next regeneration, then disappears. Fix the source file or the generator instead. |
| A registry disagrees with the disk | The disk is authoritative. Rebuild with `work.mjs reconcile --apply`. |
| A registry file is missing | `work.mjs reconcile --check` reports it as absent; `--apply` creates it. A missing registry is never treated as an empty project. |
| An owned workflow sits outside its owner's directory | The placement gate refuses the write and names the corrective command. |
| An accepted decision needs to change | Write a new record that supersedes it and mark the old one superseded. Accepted records are not edited. |

## See also

- [The work domain model](../explanation/domain-model.md) — the entities these files
  hold and the invariants that constrain them.
- [Glossary](glossary.md) — the term-to-identifier mapping.
- [Changelog policy](changelog-policy.md) — the release chronology, which is a
  separate record from the session log.
- [How to record a decision](../how-to/record-a-decision.md).
