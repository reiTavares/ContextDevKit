# How to choose the right documentation altitude

## When to use this guide

You are adding or updating documentation and need to decide which folder to put
it in, which template to start from, and whether it belongs in the public or
internal surface.

## Prerequisites

- Familiarity with the docs directory layout (`docs/tutorials/`, `docs/how-to/`,
  `docs/reference/`, `docs/explanation/`, `docs/architecture/`).
- An understanding of what you are documenting: is it a task, a concept, a lookup
  table, a walkthrough, or a design map?

## The five genres at a glance

This project organises its docs into five buckets. Four follow the
[Diátaxis](https://diataxis.fr/) framework; the fifth is a project-local addition.

### Tutorial — learning-oriented

Pick this when: the reader needs to succeed at something for the **first time**
and will follow every step.

A tutorial holds the reader's hand from start to finish. It explains every
action, avoids branching ("if you prefer X, do Y instead"), and rewards the
reader with a working result by the end. Prior knowledge is kept minimal.

Template: `docs/tutorials/_TEMPLATE.md`

### How-to — task-oriented

Pick this when: the reader **already knows the basics** and needs the shortest
path to accomplishing a specific real-world goal.

A how-to assumes competence. It skips "what is X" explanations and links out
to reference or explanation docs instead of duplicating them. One goal per guide.

Template: `docs/how-to/_TEMPLATE.md`

### Reference — information-oriented

Pick this when: the reader needs to **look up** a precise fact — an option, a
field, a flag, a return value, a config key.

Reference pages are dry and complete. Every option gets one entry; nothing is
omitted. Prose explains the what, never the why (link to an explanation for that).

**Important:** the fact tables in some reference pages are generated and
regenerated from the internal registry between dedicated markers. Do not hand-edit
those regions — edit the prose sections above and below the markers, then run the
reindex command to refresh the generated block. Editing a generated region by hand
will be overwritten on the next reindex.

Template: `docs/reference/_TEMPLATE.md`

### Explanation — understanding-oriented

Pick this when: the reader needs to **build a mental model** — the why, the
history, the trade-offs — not the exact steps.

Explanation docs are discursive. They use prose over bullet lists, may include
analogies, and link out to how-to guides for the task side. They do not repeat
step-by-step instructions.

Template: `docs/explanation/_TEMPLATE.md`

### Architecture — system-shape

Pick this when: the reader needs to understand **how a subsystem is structured**,
what its components are, how data flows through it, and which design constraints
shape it.

Architecture docs describe components, boundaries, and invariants. They are
precise and structural; diagrams are preferred over long prose. They do not
contain tutorial steps or full API tables (link to those instead).

This grouping is a project-local extension alongside the four Diátaxis modes. The
docs are classified as `explanation` in the Diátaxis spine but collected in a
separate folder because structural maps serve a distinct navigation need.

Template: `docs/architecture/_TEMPLATE.md`

## Steps

1. Decide which genre fits: ask "what does the reader arrive here wanting to do?"

   | Reader arrives wanting to… | Genre |
   | --- | --- |
   | Learn by doing (first time) | Tutorial |
   | Accomplish a task they already know | How-to |
   | Look up an exact value or option | Reference |
   | Understand why something works this way | Explanation |
   | Map out how a subsystem is structured | Architecture |

2. Copy the matching `_TEMPLATE.md` from the appropriate folder into that same
   folder with a descriptive, lowercase-hyphenated filename.

   ```shell
   cp docs/how-to/_TEMPLATE.md docs/how-to/your-topic.md
   ```

3. Fill in the template. Follow the genre contract described in the template's
   header comment — do not mix genres in a single file. Link across genres
   instead of duplicating content.

4. Apply the public/internal boundary rule (see the next section).

5. Run `docs-reindex` to refresh the docs index and verify your new file is
   listed.

   ```shell
   node contextkit/tools/scripts/docs-reindex.mjs
   ```

6. Open a PR. The per-PR docs gate runs automatically (see "What the gate
   checks" below).

## The public/internal boundary

Documents under `docs/` are **public** — they are read by anyone evaluating or
using this project. Public docs must be capability-only.

**Capability-only** means:

- Explain what the feature does and how to use it.
- Do not mention internal decision tracking ids (such as ADR numbers or card
  numbers) in prose.
- Do not credit inspiration projects by name in prose — that belongs in
  `ACKNOWLEDGEMENTS.md`, not in user-facing docs.
- Do not embed paths into the internal lineage store (`contextkit/memory`) — it
  is not a public navigation target.

Internal lineage — the reasons behind decisions, the history of trade-offs, the
decision ids that tie code to choices — belongs in the internal lineage store,
not in public docs. Nothing stops you from linking from an architecture doc to an
explanation doc; that is encouraged. What is not permitted is leaking the internal
tracking layer into prose that users read.

This rule exists because a user reading the how-to for a feature should not need
to know the internal decision id that authorised it. If they want the reasoning,
link to an explanation doc.

## What the gate checks

A `docs-public-lint` check runs on every PR that touches the public path-set
(`README.md`, `docs/`, `instrucoes.md`). It scans for:

- Internal decision ids in prose — **blocks** the PR.
- Inspiration project names in prose — **blocks** the PR.
- Internal lineage paths (paths inside the internal lineage store) in prose — **blocks** the PR.
- Secret-shaped literals (API keys, private key PEM blocks) — **blocks** the PR.

The check exits non-zero on any hit, which fails the CI `test-fast` job and
prevents merge. There is no advisory mode for these violations — fix them before
pushing.

PRs that only touch `contextkit/` or other internal paths skip the public lint
entirely; those paths are not in the public path-set.

## Verify it worked

After running `docs-reindex`, open the generated docs index and confirm your
file appears with the correct genre label. After pushing, confirm the
`test-fast` CI job passes.

## Troubleshooting

**Symptom:** `docs-public-lint` fails with `[adr-citation]`.
Fix: Remove or rephrase the `[ADR-NNNN]` reference from the public doc. If the
rationale is important to surface, link to an explanation doc that contains the
reasoning without the tracking id.

**Symptom:** `docs-public-lint` fails with `[internal-path]`.
Fix: Remove the internal lineage path from public prose. If you need to point a
reader to design reasoning, write an explanation doc under `docs/explanation/`
and link to that instead.

**Symptom:** The generated fact table in a reference page was overwritten.
Fix: Do not edit between the `<!-- BEGIN GENERATED -->` / `<!-- END GENERATED -->`
markers. Edit only the prose above or below them, then run the reindex command.

**Symptom:** New file does not appear in the docs index.
Fix: Run `node contextkit/tools/scripts/docs-reindex.mjs` and commit the updated
index file.

## Related

- `docs/reference/_TEMPLATE.md` — reference template with generated-block markers
  annotated.
- `docs/.public-projection.json` — the single source of truth for which paths are
  public and which tokens are banned.
- `docs/architecture/` — architecture docs for understanding system structure.
