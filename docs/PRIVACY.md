# Privacy and data posture

ContextDevKit is local-first. Normal hooks and read-only context commands do not
send repository content to a ContextDevKit service.

## Local data

| Data | Location | Purpose |
| --- | --- | --- |
| authored project memory | `contextkit/memory/` | decisions, sessions, reports, workflows |
| task authority | each scope's `pipeline/tasks.json` | task definitions and status |
| workspace claims | `.claude/.workspace/` | local collision warnings |
| project map | `contextkit/memory/project-map/` | regenerable structural index |
| economics telemetry | `contextkit/memory/economics/` | optional explicit measurements |
| cache/update staging | `contextkit/.cache/`, `contextkit/.updates/` | disposable local support data |

There is no per-tool edit ledger in 4.0. Conversation and exploration create no
task, workflow, counter, receipt, or durable session state.

## Network boundaries

Normal governance dispatchers perform no network fetch. Network access occurs
only when a user invokes a command whose job requires it, such as dependency
registry checks, GitHub alert inspection, media generation, or a Git operation.
Those commands must report skipped/unavailable data honestly.

Specialist prompts may receive a bounded context pack through the active host.
Use the host/provider's own privacy controls for that model traffic. Do not place
secrets, credentials, personal data, or raw production payloads in project
memory, reports, task titles, or agent prompts.

## Removal

Delete `.claude/.workspace/`, `contextkit/.cache/`, and `contextkit/.updates/` to
remove disposable local state. Authored memory and canonical JSON authorities
are project records; remove them only as an explicit project-data decision.

The `privacy-lgpd` specialist is shadow-only. It can flag risk and suggest
controls, but its presence is not legal approval or a write prerequisite.
