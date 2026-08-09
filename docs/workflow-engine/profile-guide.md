# Profile and pattern guidance

Profiles and patterns are optional topology suggestions. They do not change the
required workflow package, mandate agents, set an autonomy floor, or create a
second gate registry.

When supplied to `workflow new`, a profile may select a default pattern. The
pattern seeds `workflow.json.structure.waves` with ids and dependencies. Task
status still lives only in `pipeline/tasks.json`, and every workflow still gets
the complete canonical artifact set.

Common intent:

| Profile | Suggested use |
| --- | --- |
| `basic` | small ordered delivery |
| `standard` | discovery, build, and validation |
| `advanced` | cross-cutting architecture/integration |
| `program` | explicitly authored multi-wave topology |

Patterns such as incident hotfix, database migration, release upgrade, and
multi-host integration are starting shapes. Review and simplify the generated
waves for the real objective. Do not retain a wave or gate merely because a
template supplied it.

Parallelism is decided by the active agent and host capacity. There is no
profile-derived agent cap or required role set.
