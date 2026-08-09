# Installed footprint

## Canonical installed files

```text
AGENTS.md / CLAUDE.md / INSTRUCTIONS.md
.claude/settings.json
.codex/hooks.json
.agents/hooks.json
contextkit/config.json
contextkit/runtime/
contextkit/tools/
contextkit/policy/
contextkit/memory/
```

Host agents, skills, workflows, and playbooks are generated projections. The npm
package includes runtime diagnostics and the explicit `tools/migrations/v3-to-v4`
upgrade path, but excludes selftests, fixtures, golden files, dogfood memory,
release reports, and developer-only scratch data.

## Local mutable paths

- `.claude/.workspace/`: explicit claims and task associations.
- `contextkit/memory/project-map/`: regenerable structural graph.
- `contextkit/memory/economics/`: optional explicit measurements.
- `contextkit/.cache/`: disposable cache.
- `contextkit/.updates/`: active update staging only.

There are no active `contextkit/pipeline/<status>/` lanes, workflow `done/`
directory, session edit-ledger folders, or global-routing harness files.

Before an update mutates installed files, the updater creates a verified
out-of-tree backup under `~/.contextdevkit/projects/<projectId>/backups/` for
current config, host settings, install metadata, engine version, and explicit
workspace claims. The v3-to-v4 migrator creates its own single migration bundle
and manifest for rollback.
