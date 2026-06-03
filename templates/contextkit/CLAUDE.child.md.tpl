# {{MODULE_NAME}} — local context for Claude

> Scoped CLAUDE.md for `{{MODULE_PATH}}`. Claude Code loads the file **closest**
> to the code being edited, so this carries the rules specific to this
> module/app. It **inherits** the root [`CLAUDE.md`](../../CLAUDE.md) constitution
> — don't repeat it here; only add what's local.
> Scaffolded by ContextDevKit ({{DATE}}). Fill in the TODOs.

## What this is

<!-- One line: this module's role (backend API / web frontend / mobile app /
     shared library / service X) and its single responsibility. -->
_TODO: describe `{{MODULE_PATH}}` and its role in the system._

## Local stack & tooling

{{MODULE_STACK}}

## Local conventions (what's different here)

<!-- Rules that apply ONLY to this module — folder layout, where things go, the
     patterns to follow, the traps to avoid. Examples:
     - Routes are thin controllers; business logic lives in `services/`.
     - Components stay presentational; state/effects go into `hooks/`.
     - Public API of this package is the barrel `src/index.ts` — keep it stable. -->
- _TODO: add this module's local rules._

## Boundaries

- **Depends on:** _TODO (which modules/packages this one consumes)._
- **Consumed by:** _TODO (who depends on this module's public surface)._
- Changes to the public surface are contract changes — see `/contract-check`.

## Pointers

- Root constitution & immutable rules: [`CLAUDE.md`](../../CLAUDE.md)
- Architecture decisions: `contextkit/memory/decisions/`
- Glossary (naming): `contextkit/memory/GLOSSARY.md`
