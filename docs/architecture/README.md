# architecture — system-shape and design

How ContextDevKit is structured — the decisions behind the engine's shape, the
level model, the agent package contract, and the integration bridges.

_Architecture docs explain why the system is the way it is and how its pieces
fit together. They live here and are classified as `explanation` in
`docs/.diataxis.json` (the script's Diátaxis spine keeps four canonical modes;
`architecture` is a project-local grouping within that spine)._

## In this bucket

- [Architecture](../ARCHITECTURE.md) — internal engine map; start here for a structural overview.
- [Levels](../LEVELS.md) — the progressive activation model that determines which features are live.
- [Agent Package Format (APF) v1](../AGENT-PACKAGE-FORMAT.md) — the portable contract every forged agent satisfies.
- [Squad Pipeline Format v1](../SQUAD-PIPELINE-FORMAT.md) — how multi-agent squads are declared and routed.
- [Antigravity Integration](../ANTIGRAVITY.md) — bridge design for Google Antigravity.
- [Codex Integration](../CODEX.md) — bridge design for OpenAI Codex.

_New architecture docs go in this folder or reference root-level docs above;
`/docs-reindex` will list them in the docs index._
