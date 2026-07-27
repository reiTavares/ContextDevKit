# Reference: structural knowledge graph

## Synopsis

A committed, deterministic projection of the project's structure — files, modules,
symbols, decision records, and the relations between them — plus a read-only query
surface over it. Generation and querying are two separate scripts.

```
node contextkit/tools/scripts/project-map-graph.mjs [--apply] [--extract-only]
node contextkit/tools/scripts/graph.mjs <subcommand> [id...] [--budget N] [--top N]
```

The projection is written to `contextkit/memory/project-map/graph/graph.json`. Nothing
regenerates it automatically; it is as current as the last `--apply`.

## Projection file

Top-level fields, in the order the writer emits them:

| Field | Type | Description |
|---|---|---|
| `schemaVersion` | integer | Format version. Currently `1`. |
| `graphSignature` | string | 12 hex chars. Content address of the graph *shape*. |
| `layers` | string[] | Sorted manifest of the layers actually built. |
| `grammarVersions` | object | Parser grammar versions that loaded on this build, keyed by language. `{}` when the parser tier was not reached. |
| `nodes` | object[] | Sorted by `id`. |
| `edges` | object[] | Sorted by the `source target relation` tuple. |

`graphSignature` hashes the sorted node ids and sorted edge tuples only. Source
locations, confidence scores, `layers` and `grammarVersions` are excluded, so a line
move, a confidence tweak or a grammar bump does not churn the signature.

Determinism is a contract: nodes and edges are sorted, traversal visits neighbours in
sorted id order, no clock is read in the build body, and the only randomness source is a
seeded generator.

## Node types

A node id is a prefix, a colon, and a path-derived remainder. The prefix is the type.

| Prefix | Id form | `kind` values | Represents |
|---|---|---|---|
| `mod:` | `mod:<module-path>` | `module` | A module (a directory-level unit from the project map). |
| `file:` | `file:<repo-relative-path>` | `file` | One source file. |
| `sym:` | `sym:<repo-relative-path>#<name>` | `function`, `class`, `method` | A named symbol declared in that file. |
| `adr:` | `adr:<number>` | `rationale` | One decision record, carrying its file path. |

Node fields:

| Field | Type | Description |
|---|---|---|
| `id` | string | Unique. The address every query takes and returns. |
| `kind` | string | See the table above. |
| `label` | string | Short display name. |
| `sourceFile` | string | Repo-relative owning file. Absent on `mod:` nodes. |

`unresolved:<name>` appears as a synthetic *edge target* for a call whose target could
not be resolved. It has no node. `god-nodes` excludes it from ranking, and the
incremental merge exempts it from dangling-edge pruning.

## Edge relations and layers

| Field | Type | Description |
|---|---|---|
| `source` | string | Node id. |
| `target` | string | Node id, or a synthetic `unresolved:` id. |
| `relation` | string | See below. |
| `resolution` | string | `EXTRACTED` when the endpoint was resolved; `AMBIGUOUS` when more than one candidate matched. |
| `confidenceScore` | number or null | Null unless a scored tier produced the edge. |
| `evidenceClass` | string | `DETERMINISTIC`, `GRAPH_DERIVED` or `HEURISTIC`. |
| `tier` | string | Present only on parser-derived edges, where the value is `ast`. Absent otherwise. |
| `context` | string | Optional extraction context. |

Layers are derived from the relations present, then sorted. This is a manifest of what
was built, not a request for what should be:

| Layer | Present when a relation of this set exists |
|---|---|
| `structural` | `contains`, `imports` |
| `calls` | `calls` |
| `inheritance` | `inherits`, `implements`, `extends` |
| `rationale` | `cites` |

The layer manifest is what lets a consumer degrade honestly. A projection without a
`calls` layer makes caller queries return unavailable rather than an empty list.

## Subcommands and return shapes

Every result is JSON on stdout. Every successful result carries
`"evidenceClass": "GRAPH_DERIVED"` — the query layer's own evidence class, distinct from
the per-edge `evidenceClass` recorded in the projection.

| Subcommand | Arguments | Returns |
|---|---|---|
| `callers` | `<id>` | `{available, callers: string[], evidenceClass}` |
| `affected` | `<id>` | `{available, consumers: string[], breaks: boolean, evidenceClass}` |
| `impact` | `<id>` | `{available, callers: string[], consumers: string[], blastRadius: number, evidenceClass}` |
| `neighbors` | `<id>` `[--budget N]` | `{available, nodes: string[], excludedHubs: string[], evidenceClass}` |
| `path` | `<from> <to>` | `{available, path: string[], evidenceClass}` |
| `god-nodes` | `[--top N]` | `{available, godNodes: Array<{id, degree}>, evidenceClass}` |
| `query` | `<substring>` | `{available, matches: string[], evidenceClass}` |

Semantics that are not obvious from the shape:

- `callers` matches inbound `calls` edges only. `affected` matches inbound `calls`,
  `imports` and `references` edges. `impact` is the union plus its cardinality as
  `blastRadius`.
- `path` searches an undirected view of the edge set and returns an empty `path` array
  when the two nodes are not connected. An empty path is a real answer, not a degrade.
- `neighbors` is a bounded breadth-first walk that refuses to expand *through* a
  high-degree node; those ids are reported in `excludedHubs`. The hub threshold is the
  99th-percentile degree, floored at 50. Default budget is 40 nodes.
- `god-nodes` ranks by total degree, in and out, ties broken by id. Default is 10.
- `query` is a substring match over node ids, capped at 50 results and sorted. There is
  no free-text or semantic query.

## Degrade contract

When the projection is absent, unparsable, or missing the layer a query needs, the
result is:

```json
{
  "available": false,
  "reason": "no committed graph projection",
  "evidenceClass": "GRAPH_DERIVED"
}
```

Observed `reason` values: `no committed graph projection`, `projection missing
nodes/edges arrays`, `projection unparsable: <detail>`, `calls layer not built in this
projection`. A degrade is never rendered as an empty answer.

## Exit codes

| Exit | Condition |
|---|---|
| 0 | The query ran, including a legitimately empty result. |
| 2 | Usage error: no subcommand, unknown subcommand, or a missing positional argument. Message goes to stderr. |
| 3 | The result carries `available: false`. |

## Builder behaviour

| Invocation | Effect |
|---|---|
| no flag | Dry run. Builds the full projection and prints it. Disk untouched. |
| `--apply` | Writes the projection atomically, via a temporary file and a rename. Prints one summary line. |
| `--extract-only` | Builds the extraction tier only. Produces no resolved `calls` layer. |

The full build composes the resolver output with the rationale layer, deduplicating by
node id and edge tuple; the resolver wins an id collision.

An incremental merge path exists as a library function. It replaces the contribution of
each changed source file, prunes deleted files entirely, and carries unchanged files
forward. It throws rather than shrink silently: a file listed as changed that previously
had nodes and returns none is treated as a suspected parse failure, not a deletion.

## Configuration

Under `projectMap.graph` in `contextkit/config.json`:

| Key | Type | Default | Effect |
|---|---|---|---|
| `enabled` | boolean | `true` in the shipped config | Only an explicit `true` enables the capability. Any other shape resolves to disabled. |
| `mode` | string | `advisory` | One of `off`, `shadow`, `advisory`, `guarded`, `strict`. |
| `humanFlip` | boolean | `false` | Required for `guarded` or `strict`. |
| `autoIndex` | boolean | `true` | Present in the config. No code path reads it. |

Mode resolution, which never throws and always clamps toward the safe side:

| Condition | Resolved mode |
|---|---|
| `enabled` is not exactly `true` | `off` |
| level below 4 | `off` |
| `guarded` or `strict` requested below level 7 | `advisory` |
| `guarded` or `strict` requested without `humanFlip` | `advisory` |
| `shadow` or `advisory` requested at level 4 or above | as requested |

The mode governs consumers that read the graph during governance. It does not gate
`graph.mjs`, which reads the committed file directly.

## See also

- How-to: `docs/how-to/use-the-knowledge-graph.md` — generating and querying, with
  troubleshooting.
- Reference: `docs/reference/config.md` — the surrounding configuration schema.
