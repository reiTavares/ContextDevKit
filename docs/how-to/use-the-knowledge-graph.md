# How to use the structural knowledge graph

## When to use this guide

You are about to answer a structural question about the codebase — who calls this
function, what breaks if I rename this export, which files sit near this symbol — and
the reflex is a wide `Grep` sweep. The kit already holds a committed graph of the
project's symbols and their relations. Querying it costs one command and returns node
ids, not file dumps.

This guide covers generating the graph, querying it, and reading the answer honestly
(including when the answer is "unknown"). For the field-by-field shape of the
projection and of each query result, see the graph reference.

## Prerequisites

- ContextDevKit installed, and commands run from the project root — every script
  resolves paths from the current working directory.
- Node.js 18 or newer. Graph generation and querying pull no runtime dependencies.
- Optional, for higher-precision call edges: the `web-tree-sitter` optional
  dependency and its grammar blobs. Absent, extraction stays on its regex tier and
  says so in the output rather than failing.

## Steps

1. **Generate the projection as a dry run first.** Without a write flag the builder
   prints the whole projection to stdout and touches nothing on disk.

   ```bash
   node contextkit/tools/scripts/project-map-graph.mjs
   ```

   Pipe it to a JSON reader if you only want the header. The interesting fields are
   `graphSignature`, `layers` and `grammarVersions`.

2. **Write it.** `--apply` composes the resolver output (structural and call
   relations) with the rationale layer, then writes atomically to
   `<memory>/project-map/graph/graph.json` via a temporary file and a rename.

   ```bash
   node contextkit/tools/scripts/project-map-graph.mjs --apply
   ```

   It prints one summary line: node count, edge count, the layers actually built, and
   the signature.

   > `--extract-only` builds the extraction tier alone. That projection has no
   > resolved `calls` layer, and the query surface will refuse to answer caller
   > questions against it rather than return an empty list. Prefer the default.

3. **Ask the question through the query command.** Every surface routes through this
   one entry point; it never parses source, it only reads the committed projection.

   ```bash
   node contextkit/tools/scripts/graph.mjs callers "sym:path/to/file.mjs#myFunction"
   ```

   Output is JSON on stdout, always:

   ```json
   {
     "available": true,
     "callers": [
       "file:path/to/other.mjs"
     ],
     "evidenceClass": "GRAPH_DERIVED"
   }
   ```

4. **Pick the subcommand that matches the question.** Seven exist, and the argument is
   a node id in every case except `god-nodes`.

   | Subcommand | Question it answers |
   |---|---|
   | `callers <id>` | which nodes call this symbol |
   | `affected <id>` | who breaks if this disappears (inbound calls, imports, references) |
   | `impact <id>` | callers plus consumers plus a blast-radius count |
   | `neighbors <id>` | the bounded neighbourhood around this node |
   | `path <from> <to>` | the shortest connection between two nodes |
   | `god-nodes` | the most-connected nodes in the graph |
   | `query <substring>` | node ids containing a substring |

   Two flags exist and no others: `--budget N` bounds `neighbors` (default 40) and
   `--top N` bounds `god-nodes` (default 10).

5. **Find the id before you query it.** Ids are not guessable; `query` is the lookup
   step, and it caps at 50 matches.

   ```bash
   node contextkit/tools/scripts/graph.mjs query "myFunction"
   ```

6. **Refresh after structural change.** The projection is a committed artifact, not a
   live view. Re-running step 2 after adding or deleting files keeps the signature
   honest; the signature is derived from graph shape alone, so a line move or a
   confidence tweak does not churn it.

## Verify it worked

Run the ranking query — it needs no id and exercises the whole read path:

```bash
node contextkit/tools/scripts/graph.mjs god-nodes --top 3
```

A working graph returns `"available": true` with a `godNodes` array of `{id, degree}`
objects and exit code 0. Three exit codes are distinguishable on purpose:

| Exit | Meaning |
|---|---|
| 0 | the query ran |
| 2 | usage error (no subcommand, unknown subcommand, missing argument) |
| 3 | no usable projection; the payload is `{"available": false, "reason": ...}` |

Exit 3 is the honest branch. A caller can tell "no graph yet" from "bad invocation",
and neither is ever dressed up as an empty answer.

## Troubleshooting

**Symptom:** `{"available": false, "reason": "no committed graph projection"}`, exit 3.
Fix: you have not run step 2. The query surface reads the committed file only and never
builds one implicitly.

**Symptom:** `{"available": false, "reason": "calls layer not built in this projection"}`.
Fix: the projection on disk is extraction-only. Rebuild with `--apply` and no
`--extract-only`. This refusal exists because returning an empty caller list would be a
false negative wearing the costume of an answer.

**Symptom:** `impact` or `callers` on a `file:` id returns empty arrays with
`"available": true`. This is not a bug and not a graph gap. Caller and consumer
questions look for edges pointing *into* the id you passed; a file node's edges mostly
point outward to the symbols it contains. Ask these questions about `sym:` ids, and use
`neighbors` or `affected` for file-level questions.

**Symptom:** `neighbors` returns fewer nodes than the budget and lists ids under
`excludedHubs`. Expected. Traversal refuses to expand *through* a highly connected
node, so a neighbourhood stays about your symbol instead of dissolving into the whole
repo. The hub itself is kept when it is reached as a neighbour.

**Symptom:** `grammarVersions` is `{}` after `--apply`. The parser tier did not load —
no optional dependency installed, or no grammar for those languages. Extraction fell
back to its regex tier. This is recorded rather than hidden, and the graph is still
usable; call edges from the regex tier are simply not marked as parser-derived.

## Configuration, and what it does not gate

The graph block lives under `projectMap.graph` in `contextkit/config.json`:

| Key | Type | Effect |
|---|---|---|
| `enabled` | boolean | Only an explicit `true` enables the capability. Any other shape resolves to off. |
| `mode` | string | One of `off`, `shadow`, `advisory`, `guarded`, `strict`. |
| `humanFlip` | boolean | Required for a blocking mode. Without it, a configured `guarded` or `strict` clamps down to `advisory`. |
| `autoIndex` | boolean | Ships in the default config. No code path reads it today. |

Two limits are worth stating plainly. `mode` needs level 4 or higher to leave `off` at
all, and the two blocking modes additionally need level 7 plus `humanFlip`; a
misconfiguration clamps toward advisory rather than silently blocking work. And the
`enabled` flag gates the *consumers* that read the graph during governance — the query
command itself reads the committed file directly, so `graph.mjs` answers whether or not
the flag is set.

## Honest limits of this subsystem

- The graph is a build artifact with no watcher. Nothing regenerates it on a file save;
  it is as fresh as your last `--apply`.
- The `/project-map` command and its documentation do not surface the graph at all.
  There is no `--graph` flag on `project-map.mjs`; generation and querying are the two
  separate scripts named above.
- `query` is a substring match over node ids, capped at 50 results. There is no
  free-text or semantic search over the graph.
- Call edges carry a resolution and an evidence class, and some are recorded as
  ambiguous or heuristic. Treat a caller list as a strong lead for a rename, not as a
  compiler-grade guarantee.

## Related

- Reference: `docs/reference/graph.md` — node types, layers, per-subcommand return
  shapes, evidence classes.
- How-to: `docs/how-to/reduce-token-cost.md` — where the graph fits among the other
  levers that replace exploration with lookup.
