# ContextDevKit capability levels

Levels select capabilities; they do not increase a model's authority. ContextDevKit
4.0 is mutation-only, fail-open operationally, and human-sovereign at every level.

| Level | Capability | Reference |
| --- | --- | --- |
| L1 | Read-only boot context and static project instructions | [L1](L1-static-loading.md) |
| L2 | Consolidated governance dispatch for real mutation events | [L2](L2-governance-dispatch.md) |
| L3 | Explicit workspace claims and transactional JSON state | [L3](L3-multi-session.md) |
| L4 | Optional agent and skill recommendations | [L4](L4-squads.md) |
| L5 | Advisory analysis plus the guarded invariant allowlist | [L5](L5-proactive.md) |
| L6/L7 | Optional learning, economics, and automation tools | project documentation |

Normal runtime entrypoints are the session-context loader and one dispatcher for
prompt preflight, write preflight, postflight, and completion. Historical 3.x
formats are understood only by the explicit offline migrator.
