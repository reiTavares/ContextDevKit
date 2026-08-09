# Slash commands

Canonical Claude command sources live in this tree. Antigravity skills and
Codex skills are generated projections declared by the host-projection
manifest; do not edit those projections as independent authorities.

Claude resolves commands by file basename, so basenames must remain unique
across all folders. Folders are for human navigation only.

## Packs

- root: daily project state, decisions, documentation, diagnostics, and reports;
- `pipeline/`: task scopes, workflows, focused sessions, ship, swarm, and retro;
- `qa/`: test planning, scaffolding, visual checks, and QA sign-off;
- `vcs/`: claims, releases, worktrees, Git, changelog, and issue triage;
- `audit/`: code, architecture, dependency, security, SEO, and contract audits;
- `setup/`: installation, level, configuration, and doctor commands;
- `forge/`: portable agent-package lifecycle.

Commands describe ContextDevKit 4 behavior:

- conversation and read-only exploration persist nothing;
- mutation uses direct, batch, or workflow shape;
- tasks live in scoped `pipeline/tasks.json`, never physical lanes;
- model routing and swarm composition are recommendations;
- only the three canonical guarded gates may deny.

## Adding or removing a command

1. Change the canonical Markdown source in this tree.
2. Keep the basename unique.
3. Update the projection manifest when the declared command set changes.
4. Regenerate Antigravity and Codex projections.
5. Run host parity plus the relevant command/runtime tests.

No command registry or installed dogfood copy may preserve a removed command.
