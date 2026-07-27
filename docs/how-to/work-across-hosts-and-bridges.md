# How to work across hosts and bridges

## When to use this guide

Your team does not all use the same AI coding tool, and you want the same commands, the
same agents and the same governance to hold wherever the work happens. Or you are on one
host and need to know what a teammate on another actually gets.

Three hosts are **native**: they receive the commands, the agent briefings and the
enforcing hooks. Six other tools can receive an opt-in **context bridge**: a generated
block of project rules, and nothing else. This guide covers both, and is explicit about
the difference — because a bridge that looked like a governed host would be the most
expensive misunderstanding in the kit.

## Prerequisites

- ContextDevKit installed, and commands run from the project root.
- Node.js 18 or newer.
- For bridge setup: write access to `contextkit/config.json` and the ability to re-run the
  installer.

## The three native hosts

All three install on every installer run. There is no per-host flag, and no way to skip
one; the installer's only relevant knob is `--level`.

| | Claude Code | Antigravity | Codex |
|---|---|---|---|
| Boot context file | `CLAUDE.md` | `INSTRUCTIONS.md` | `AGENTS.md` |
| Command artifact | slash command | skill | skill folder |
| Command location | `.claude/commands/` | `.agents/skills/` | `.agents/skills/` |
| Agent artifact | `.claude/agents/*.md` | `.agents/agents/*.md` | `.codex/agents/*.toml` |
| Hook wiring file | `.claude/settings.json` | `.agents/hooks.json` | `.codex/hooks.json` |
| Runner | — | `ctx.mjs` | `cdx.mjs` |

Enforcement is real on all three. Each host's hook file is composed for the installed
level and wires the same underlying scripts — session start and end, edit tracking,
concurrency, formatting, the domain gates, and at the upper levels the simulate, journey,
execution, completion and sweep gates. Every hook command carries a host flag so the
shared adapter translates the block verb into the shape that host understands.

Two host-specific notes that surprise people. Codex skills are written into the
**Antigravity** skill directory, so after a full install that one directory holds both
hosts' artifacts side by side. And a boot context file is never clobbered: on a name
collision the installer writes a `.contextdevkit.md` side file for you to merge, and on
an update it leaves your existing file alone.

### Same command, three shapes

One source command becomes three artifacts. Taking a command that lives at
`.claude/commands/pipeline/ship.md`:

| Host | Artifact path | Header shape |
|---|---|---|
| Claude Code | `.claude/commands/pipeline/ship.md` | Frontmatter with a description and an argument hint. |
| Antigravity | `.agents/skills/pipeline/ship.md`, plus a copy at `.agents/skills/ship.md` | A skill heading and quoted description, no frontmatter. |
| Codex | `.agents/skills/source-command-pipeline-ship/SKILL.md` | Frontmatter with a name and description, then a command-template section. |

The Antigravity root copy is deliberate: that IDE's command lookup is not recursive, so
every nested command is also written flat at the skill root.

The conversion is textual and mechanical. Argument placeholders, tool names, and path
references are rewritten per host, so a command that says "slash command" on Claude Code
says "skill" on Antigravity, and a path under `.claude/commands/` becomes the host's own
location. The Codex converter additionally replaces the body of the commands that would
otherwise instruct the agent to read Claude Code's own transcripts, and reads the routing
policy to project model tiers into its agent files.

## Steps

1. **Install, and read the report.** Every native host is installed in one pass; the
   report lines name each boot file, hook file and tree that was written.

   ```bash
   node install.mjs --level 5
   ```

2. **Regenerate a host's artifacts after changing a command.** The converters are the
   single path; never hand-edit a generated tree. Both take exactly two flags,
   `--dry-run` and `--templates`, and **write by default** — dry run first.

   ```bash
   node templates/contextkit/runtime/antigravity/convert-all.mjs --templates --dry-run
   node templates/contextkit/runtime/codex/convert-all.mjs --templates --dry-run
   ```

   Drop `--dry-run` to apply. The `--templates` form regenerates the kit's shipped
   templates; without it the converter reads the *installed* `.claude/` tree and writes
   the installed host trees.

3. **Use the build scripts for the template pass.** They are the same two commands with
   `--templates` already set.

   ```bash
   npm run build:antigravity
   npm run build:codex
   ```

4. **Enable a bridge, if a teammate uses a non-native tool.** Add the tool ids to
   `contextkit/config.json`. The key is an array; there is no boolean form and no per-tool
   sub-object.

   ```json
   {
     "bridges": {
       "enabled": ["cursor", "copilot"]
     }
   }
   ```

   Valid ids and the file each one writes:

   | Id | Tool | File written |
   |---|---|---|
   | `cursor` | Cursor | `.cursor/rules/contextdevkit.mdc` |
   | `copilot` | GitHub Copilot | `.github/copilot-instructions.md` |
   | `gemini` | Gemini CLI | `GEMINI.md` |
   | `windsurf` | Windsurf | `.windsurfrules` |
   | `aider` | Aider | `CONVENTIONS.md` |
   | `continue` | Continue | `.continue/rules/contextdevkit.md` |

5. **Re-run the installer to materialize the bridges.** The bridge step reads the target
   project's config during install, so enabling is always two passes on a fresh project:
   install, edit the config, install again.

   ```bash
   node install.mjs --update
   ```

   Each bridge file is written as a marked block between start and end comments. Content
   above and below the markers is preserved verbatim, and a re-run is byte-identical, so a
   bridge file is safe to keep in version control alongside your own rules. A bridge that
   cannot be written reports as skipped and never fails the install.

## What a bridge is not

The default install ships **zero** bridges, and enabling one grants context, not
governance. The generated block says so in its own opening lines, and the installer
repeats it in the report. Concretely, a bridged tool does not get:

- hooks of any kind, at any level;
- the session ledger, or any session registration;
- the level gates, the execution contract, or the completion gate;
- the pre-push quality gate.

The registry marks every bridge as unenforced explicitly, so that nothing in the code
path can mistake one for a governed host. Treat a bridge as documentation the tool happens
to read.

## Verify it worked

For the native hosts, confirm each one has its boot file and its hook wiring:

```bash
ls CLAUDE.md INSTRUCTIONS.md AGENTS.md
ls .claude/settings.json .agents/hooks.json .codex/hooks.json
```

For the converters, read the summary line each one prints. The Antigravity converter ends
with a block counting skills, agents, playbooks and workflows; the Codex converter ends
with a single line counting skills, skipped items and agents. Compare the skill count
against the number of source commands — they should match, modulo the command index the
converters skip.

For a bridge, confirm the file exists and contains a marked block:

```bash
grep -c "ContextDevKit:start" .cursor/rules/contextdevkit.mdc
```

A count of 1 means the block was injected. Re-running the installer should leave that file
byte-identical.

## Troubleshooting

**Symptom:** a boot file was not updated, and a `.contextdevkit.md` side file appeared.
Expected. The installer refuses to overwrite your boot context. Merge the side file by
hand and delete it.

**Symptom:** the Antigravity converter printed errors but exited 0.
Cause, and it matters: per-file failures are collected and printed under an errors block,
but the run still exits 0. A partially converted tree therefore looks like a success in
CI. Read the errors block, do not trust the exit code alone. The Codex converter does exit
1 in the same situation.

**Symptom:** `.agents/skills/` contains both flat markdown files and `source-command-*`
folders.
Expected. Two hosts share that directory, and neither prunes the other's artifacts. If
you regenerate one host's skills, the other's remain.

**Symptom:** you enabled a bridge in the config but no file appeared.
Fix: re-run the installer. The bridge step reads the config at install time, so a config
edit alone changes nothing.

**Symptom:** you removed a tool from `bridges.enabled` and its file is still there.
Cause: there is no bridge uninstall path. The uninstaller does not touch bridge files,
even though the marker library can strip a block. Delete the marked block, or the file, by
hand.

**Symptom:** a legacy `.antigravity/` directory disappeared after an install.
Expected. The Antigravity host directory moved, and the installer removes the old tree
when it finds one.

## Honest parity gaps

- **No per-host install control.** All three native hosts install unconditionally on
  every run; the only knob is `--level`. You cannot install one host and skip another.
- **Level gating is inconsistent across hosts.** Claude Code's agent tree and the Codex
  agent tree are only installed at level 4 and above. Antigravity's personas ship at every
  level, because they ride an unconditional directory copy.
- **Codex gets no playbooks and no workflow projections.** The Antigravity converter emits
  both; the Codex converter handles commands and agents only.
- **Codex has no host-specific runtime modules.** Antigravity ships a session manager, a
  boot-context bridge and a menu module alongside its converter; Codex relies on the shared
  hooks plus its runner.
- **Antigravity has no host-specific command projections.** Where the Codex converter
  rewrites the commands that do not apply to it, the Antigravity converter applies only
  generic substitutions, so a host-inapplicable command converts verbatim.
- **Antigravity model-tier routing is absent.** Its personas are converted without
  frontmatter, so no model tier travels with them.
- **Every nested Antigravity skill exists twice on disk.** The converter writes both
  copies, so a regeneration keeps them consistent — but a manual edit to one drifts from
  the other.
- **Proposed hosts are not hosts.** Additional editors have been proposed as native hosts;
  those proposals are not implemented and are not part of this surface. Three native hosts
  ship, and six bridges.

## Related

- Reference: `docs/reference/hosts.md` — the host matrix.
- Reference: `docs/reference/config.md` — the `bridges` key and the surrounding schema.
- How-to: `docs/how-to/install-and-choose-a-level.md` — the level that determines which
  hooks each host receives.
