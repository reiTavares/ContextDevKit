# Contributing to ContextDevKit

Thanks for improving ContextDevKit. It's intentionally small and dependency-free —
keep it that way.

## Ground rules

- **Zero runtime dependencies on the hot path.** The hooks (Levels 1–3) must run
  in a brand-new project with nothing installed. No npm packages in
  `templates/contextkit/runtime/hooks/**` or `runtime/config/load.mjs`. `zod` is
  allowed only behind an optional dynamic import (see `schema.mjs`).
- **Hooks never break real work.** Every hook exits 0 on error and stays silent
  unless it has something to say. Defensive I/O, always.
- **The platform folder name lives in one place.** `PLATFORM_DIR` in
  `templates/contextkit/runtime/config/paths.mjs`. Don't hardcode `contextkit/`
  elsewhere if a constant exists.
- **Keep it portable.** No bash-isms in `.mjs`; use `node:*` APIs. Strip a BOM
  before `JSON.parse`. Forward-slash paths in config.

## Public contracts (the 1.0 stability promise)

These surfaces other projects depend on are **stable**: a breaking change needs an
ADR (`/new-adr`) and must show up in `/contract-check` before release.

- **`contextkit/config.json` schema** — the keys hooks/scripts read (`level`,
  `ledger.*`, `l5.*`, `qa.*`, `practices.*`, `setup.*`). Add keys freely; never
  rename/remove without a migration.
- **Installer flags** — `--target / --level / --name / --mode / --yes / --force /
  --rewire / --update / --uninstall / --purge / --help / --version`. Don't change
  a flag's meaning.
- **Hook payload contract** — hooks read `session_id` + the tool payload on stdin
  and exit 0 **silently** on anything they don't handle.
- **The `contextkit/` layout** — `runtime/`, `tools/`, `memory/{decisions,sessions,
  business-rules}`, `squads/`, `pipeline/` — plus `.claude/{commands,agents,
  settings.json}`. Renames break installs.
- **Slash-command & agent names** — removing/renaming one breaks muscle memory and
  user scripts; **deprecate before removing**.

Point `l5.contractGlobs` at the export surface you consider public so
`/contract-check` catches an accidental break.

## Project layout

- `install.mjs` — the installer (also the `npx`/`bin` entry).
- `templates/` — everything copied into a target project (`claude/` → `.claude/`,
  `contextkit/`, `CLAUDE.md.tpl`, `docs/CHANGELOG.md.tpl`, `gitattributes`).
- `tools/` — kit-dev tooling: `selfcheck.mjs` (static), `integration-test.mjs`
  (real hooks end-to-end).
- `docs/` — LEVELS, ARCHITECTURE, CUSTOMIZING.

## Test workflow

The kit has a layered execution architecture — pick the right tier for your loop:

| Script | When | Responsibility |
|---|---|---|
| `npm run test:smoke` | Every edit | Hermetic suites only, no install (~1.5 s) |
| `npm run test:impact` | Inner loop, after larger changes | Conservative selector: maps changed files → relevant suites; falls back to full on any uncertainty; never the release gate |
| `npm run test:selfcheck` | After wiring changes | Static engine checks (660+ assertions); quiet on pass |
| `npm run test:integration:<cluster>` | Closing a card | One integration cluster: `core` / `installer` / `hosts` / `workflow` / `enforcement` / `ecosystem` |
| `npm test` | Pre-push baseline | Full suite (all suites, serial, fail-fast) — **behavior preserved** |
| `npm run ci:fast` | What CI runs on PRs | `test:impact` + tech-debt; single Node version; uploads `runs/` logs |
| `npm run ci:full` | Main / release gate | Full suite + tech-debt on Node 18/20/22 — **mandatory before release** |

Use `test:impact` or `test:smoke` for the inner loop; `ci:full` is the gate. Run
`npm run ci:full` before any push to `main`. Logs land in the gitignored `runs/`
directory.

**Compatibility guarantee:** `npm test`, `npm run ci`, and `npm run check` keep their
exact meaning — external callers and automation are unaffected.

**Rollback:** to revert to the pre-TEA execution chain, run `run-suites.mjs` with the
`--legacy` flag; `selfcheck.mjs --verbose` restores the full 660-line output if the
quiet mode hides something.

**Impact selector (explainable).** `node tools/test-impact.mjs` prints *why* each
suite was picked (or why a change forced a full run) — run it to debug a selection.
The selector is false-negative-averse: an unmapped source path, a missing Project
Map, or any test-infra/config edit escalates to a full run. It is the inner-loop
accelerator only — `ci:full` always runs everything and is the gate (ADR-0093).
Large `selfcheck` blocks are split into their own selectable suites so a scoped edit
runs seconds, not the 8-min monolith: editing `runtime/execution/*` selects the
fast `selfcheck-request` shard (ADR-0113), while `selfcheck.mjs` still runs the same
block inline on a full pass. An `--impact` run records its narrowing (selected/total)
into `runs/history.jsonl`; see `node tools/test-telemetry.mjs`.

## Before you push

```bash
npm run ci:full     # full suite + tech-debt RED-line gate
```

This must be green before any push to `main`. CI runs it on Node 18/20/22. If you
add a hook, slash command, script, or change the level wiring, **add a check** to
`tools/selfcheck.mjs` or `tools/integration-test.mjs` that would fail if it regressed.

## Adding things

- **Slash command** → `templates/claude/commands/<name>.md` (frontmatter
  `description` + prompt body; `$ARGUMENTS` interpolates).
- **Sub-agent** → `templates/claude/agents/<name>.md` from `_TEMPLATE.md`; sharp,
  narrow `description` (that's how routing works).
- **Test suite** → register it in `tools/test-suites.mjs` (or a spread sub-module
  like `test-suites-infra.mjs`) with conservative `touches[]` source seeds so the
  impact selector can pick it; `tools/selfcheck-suites.mjs` fails loudly if a suite
  file on disk is unregistered. Keep `touches[]` honest — under-selecting is worse
  than over-selecting.
- **Engine change** → keep files under the 280-line constitution; update the
  relevant doc and add a test.

## Commits

Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`, `chore:`,
`ci:`). The kit ships its own `commit-msg` hook that enforces this in installed
projects — please follow it here too.
