# How to install ContextDevKit and choose a level

<!-- GENRE: How-to guide (task-oriented)
     Goal: reader installs the kit into a real project and lands on the right level.
     Voice: direct, imperative — assume competence, skip "what is X" explanations.
     Facts: installer flags come from the installer's own argument parser; level
     labels come from the canonical level table. Never hand-copy either. -->

## When to use this guide

You want the kit running in a project — either a brand-new empty folder or an existing
codebase — and you want to land on a level that fits instead of guessing.

If the kit is already installed and you want to move between levels, the shorter path
is [tune autonomy and level](tune-autonomy-and-level.md). If an install or update
misbehaved, go to [troubleshoot](troubleshoot.md).

## Prerequisites

- `node` 18 or newer on the path. Nothing else — the kit has no runtime dependencies
  on its hot path, so the memory, ledger and multi-session tiers run in a project with
  nothing installed.
- A directory you are willing to let the installer write into. It writes the platform
  directory, the host front-end files, and (from the multi-session tier upward) git
  hooks. See [footprint](../reference/footprint.md) for the file-by-file inventory.
- Git initialised, if you want the git-hook tiers. The installer degrades gracefully
  without it.

## Which level do I start at?

Answer these in order and stop at the first match. This is the whole decision — you
can change level any time afterwards without reinstalling.

| If this describes you | Start at | Why |
| --- | --- | --- |
| Empty folder, new project, you want the AI to help shape it | **3** | The installer's own default for a greenfield target. You get memory, drift detection, claims and git hooks without gates that need a codebase to be meaningful. |
| Existing codebase, you want the full toolkit available | **7** | The installer's default for a target that already has code. Higher tiers ship inert until configured, so this is additive, not intrusive. |
| You want to evaluate the kit on a repository you do not own | **1** | Memory only: boot context, session log, decision records, changelog. No hooks that alter a commit. |
| You are adding the kit to a team repository mid-project | **3**, then climb | Land the shared substrate first, agree on the conventions, then raise the level in a separate change so the diff is reviewable. |
| A previous install left you unsure what is active | run the doctor first | `node contextkit/tools/scripts/doctor.mjs` reports the real wiring before you change anything. |

The level sets **which** capabilities exist. A separate dial — the consent grade —
sets **how much** of them runs without asking you. They are independent; see
[tune autonomy and level](tune-autonomy-and-level.md).

For the authoritative per-level capability matrix, see
[levels reference](../reference/levels.md). The short version, from the canonical
level table:

| Level | Name | Adds |
| --- | --- | --- |
| 1 | Memory | Boot context, session log, decision records, changelog |
| 2 | Ledger | Drift detection — edit tracking plus an end-of-session nudge |
| 3 | Multi | Claims, worktrees, derived indices, git hooks. Recommended for a new/empty project |
| 4 | Squads | Specialised sub-agents |
| 5 | Proactive | Impact-simulation gate, technical-debt sweep, contract-drift detection |
| 6 | Autonomy and Insight | Ship pipeline, retrospective learning loop, metrics |
| 7 | Ecosystem and Scale | Fleet across repositories, agent tuning, visual tests, playbooks, token and cost insight. Recommended for an existing project with code |

Levels 1 through 5 each add host hooks. Levels 6 and 7 are capability tiers layered on
the level-5 gates — they add commands and tooling, not new hooks.

## Steps

### Install into a new, empty project

1. Run the installer from inside the folder.

   ```shell
   npx contextdevkit
   ```

   With a TTY it prompts for the project name, the mode (greenfield or existing) and
   the level, defaulting to the greenfield recommendation. Accept the defaults unless
   the table above pointed you elsewhere.

2. Skip the prompts when you already know the answers.

   ```shell
   npx contextdevkit --yes --mode greenfield --level 3 --name my-project
   ```

3. Open the project in your host and orient.

   ```shell
   node contextkit/tools/scripts/context-pack.mjs
   ```

### Install into an existing codebase

4. Run the installer against the repository root.

   ```shell
   npx contextdevkit --mode existing --level 7
   ```

   The installer detects an existing codebase on its own; passing `--mode` makes the
   intent explicit and reproducible in a script.

5. Let the kit configure itself to the project.

   Open the project in your host and run the onboarding command
   (`/setupcontextdevkit`). It inspects the stack and writes a configuration that
   matches it, rather than leaving you to fill a blank config.

### Install without npm

6. Install straight from the repository.

   ```shell
   npx github:reiTavares/ContextDevKit
   ```

   Same installer, same flags. Useful in an environment where the package registry is
   unavailable.

### Choose the git posture

7. Decide whether the kit's own files enter git history.

   The default is **local-only**: the installer writes a local git exclude so kit
   artifacts stay out of your history and updates never flood your diffs. That suits
   solo work and evaluation.

   For a team, a second machine, or CI, commit the kit instead:

   ```shell
   npx contextdevkit --tracked
   ```

   Switching is non-destructive and reversible — re-run with or without the flag. It
   only toggles the local exclude; it never touches the index or your edits.

### Every installer flag

Taken from the installer's own argument parser. `--help` prints the same list.

| Flag | Effect |
| --- | --- |
| `--target <path>` | Destination project root. Defaults to the current directory. |
| `--level <1-7>` | Activation level. Without it, an existing install keeps its current level rather than silently downgrading. |
| `--name <string>` | Project name used in the generated boot file header. |
| `--mode greenfield\|existing` | Overrides auto-detection. Drives the recommended level. |
| `--preset <name>` | Merges a stack preset into the configuration. |
| `--ci-squad` | Also installs the CI action that turns a labelled issue into a draft change. Opt-in: it costs credits and needs a repository secret. |
| `--yes`, `-y` | Non-interactive. Uses flags and defaults, asks nothing. |
| `--force` | Overwrites the boot file and memory seeds if they already exist. |
| `--tracked` | Commits the install: skips the local git exclude written by default. |
| `--update` | Safe update. See [upgrade and update](upgrade-and-update.md). |
| `--allow-active-sessions` | With `--update`: proceed even though active sessions were detected. Snapshots first. |
| `--allow-self-update` | With `--update`: proceed when updating the kit's own source repository. |
| `--rewire` | Only recomposes the host settings file for the given level, then stops. |
| `--uninstall` | Removes hook wiring and git hooks. Keeps your memory. |
| `--purge` | With `--uninstall`: also deletes the engine, commands and agents. |
| `--help`, `-h` | Prints usage and the full flag list. |
| `--version`, `-v` | Prints the kit version. |

`--allow-active-sessions` and `--allow-self-update` are separate consents on purpose:
granting one never implies the other. When both conditions apply, pass both.

### Change level later

8. Move between levels without reinstalling.

   ```shell
   node contextkit/tools/scripts/context-level.mjs <1-7>
   ```

   This rewrites the configuration and recomposes the host hook wiring. Restart the
   host afterwards — the wiring is only read at startup. Going up adds capability;
   going down cleanly removes the now-disabled hooks.

## Verify it worked

Run these three. Each either confirms the install or names the gap.

```shell
node contextkit/tools/scripts/doctor.mjs
node contextkit/tools/scripts/context-level.mjs
node contextkit/tools/scripts/context-pack.mjs
```

- The doctor reports the node version, the configuration, hook wiring against the
  level, git hooks and onboarding status. Treat any line it flags as the next task.
- The level command echoes the level you chose.
- Opening the project in your host prints a boot banner reflecting the active level
  and grade. If the banner disagrees with the level command, you have not restarted
  the host yet.

## Troubleshooting

**Symptom:** The installer prompted for nothing and picked its own level.
Fix: That is `--yes` behaviour, and `--update` implies it. Pass `--level` explicitly
when you want a specific tier in a non-interactive run.

**Symptom:** A re-run silently changed the level.
Fix: It should not — without `--level` the installer reads the current level from the
configuration and preserves it. If the level did move, the configuration was likely
unreadable; run the doctor.

**Symptom:** Hooks behave as though the old level is active.
Fix: Restart the host. Hook wiring is read once at startup.

**Symptom:** Kit files are showing up in your git status and you did not want that.
Fix: You installed with `--tracked`. Re-run without it to restore the local exclude.
Your files stay where they are.

For anything else, see [troubleshoot](troubleshoot.md).

## Related

- [Configure ContextDevKit](configure-contextkit.md) — every configuration area,
  after the install lands.
- [Upgrade and update](upgrade-and-update.md) — what `--update` does, when it defers,
  and how to roll back.
- [Levels reference](../reference/levels.md) — the authoritative capability matrix.
- [Footprint](../reference/footprint.md) — exactly what is written and executed, and
  how to remove it.
- [Tune autonomy and level](tune-autonomy-and-level.md) — the consent dial, which is
  independent of the level.
