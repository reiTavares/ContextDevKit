# Tutorial: Your First ContextDevKit Session

<!-- GENRE: Tutorial (learning-oriented)
     Goal: the reader succeeds at something for the FIRST TIME.
     Voice: guide-beside — encouraging, sequential, explains every action.
     Test: run every command yourself before publishing. -->

## Overview

By the end of this tutorial you will have installed ContextDevKit into a real
project, completed the onboarding questionnaire, and registered your first
session — so the kit has something to remember the next time you open Claude Code
on this project. You need Node.js 18 or later and a Claude Code installation.
Estimated time: 20 minutes.

## Prerequisites

- Node.js 18, 20, or 22 installed and on your PATH
- Claude Code CLI installed and authenticated (`claude --version`)
- A project folder to onboard — either an existing codebase or an empty directory

## Step 1: Install ContextDevKit

ContextDevKit is distributed as an npm package and runs with a single `npx`
command. You do not need to install it globally; `npx` fetches and runs it
directly.

Open your terminal in the root of your project folder:

```shell
cd /path/to/your-project
npx contextdevkit
```

The installer detects your environment, asks which level of context tracking you
want (answer 2 for a standard project — you can raise it later), and writes the
platform files into `contextkit/` and `.claude/`. It never modifies your
application source code.

You should see a summary line such as:

```
ContextDevKit installed — level 2, 0 hooks active, setup pending.
```

## Step 2: Open Claude Code and run the onboarding command

Now open Claude Code in the same directory:

```shell
claude
```

Claude Code auto-loads `CLAUDE.md` on startup, so it immediately knows this
project uses ContextDevKit. The next thing to do is run the onboarding command
that fills in the kit's knowledge of your specific project.

**If you have an existing codebase** — type:

```
/setupcontextdevkit
```

This runs in several phases: it reads your source tree to detect the stack,
asks you a small batch of questions (project description, UI language, one or
two immutable rules you want enforced, your preferred autonomy grade), then
writes those choices into `contextkit/config.json` and fills in `CLAUDE.md`.
Follow the prompts; answer in plain language.

**If your folder is empty (a brand-new project)** — type:

```
/aidevtool-from0
```

This runs an interactive product questionnaire — what the app is, who it is for,
what platform — then proposes a stack, helps you draft a short roadmap, and seeds
the pipeline with first tasks. Answer the questions as if you were briefing a new
team-mate.

Both paths end in the same place: a configured `contextkit/config.json`, a
populated `CLAUDE.md`, and a baseline architecture decision on file.

## Step 3: Confirm the project state

With onboarding done, ask the kit for a quick summary:

```
/state
```

Claude reads the latest session digest, the `[Unreleased]` section of
`docs/CHANGELOG.md`, and the current immutable rules, then returns a three-block
answer:

- **State** — what is done, what is in progress.
- **Natural next step** — based on your pipeline and roadmap.
- **Do NOT touch** — the most critical rules to keep in mind.

If the output says "empty" for most fields that is expected — the project is
freshly configured. It gives you a baseline to compare against after your first
real work session.

## Step 4: Make a small change and let the kit track it

Try editing any file in your project — add a comment, rename a variable, anything
visible to git. The kit's file-tracking hook (active at level 3 and above) notices
edits and adds them to the session ledger automatically. At level 2, changes are
tracked through git.

This step exists so that when you register the session in the next step, there is
something real to record.

## Step 5: Register the session

At the end of every productive session, register it:

```
/log-session
```

Claude walks through a short sequence automatically:

1. Finds the next session number in `contextkit/memory/sessions/`.
2. Drafts the session file from the edit ledger — files changed, branch, a
   suggested slug.
3. Rewrites that draft into a factual narrative (what changed and why).
4. Adds a bullet under `## [Unreleased]` in `docs/CHANGELOG.md`.
5. Regenerates the session index so future sessions can search it.

After it finishes you will see a confirmation such as:

```
Session 01 registered: contextkit/memory/sessions/2026-06-25-01-first-setup.md
CHANGELOG updated.
```

That file is the kit's memory of this session. Open it to see the structure — it
will be useful as a reference when you start the next session days or weeks from now.

## What you built

You installed ContextDevKit, ran a guided onboarding that fitted the kit to your
specific project stack and rules, verified the state baseline, and registered a
first session. The kit now has a memory layer: every future `/log-session` adds
to `contextkit/memory/sessions/`, and every future session starts by loading that
history automatically through `CLAUDE.md` and the boot hook.

## Next steps

- Raise the context level when your project grows:
  `docs/reference/context-levels.md`
- Write your first architecture decision before a big change:
  `docs/tutorials/first-shipped-feature.md`
- Keep the glossary current as domain language emerges:
  `contextkit/memory/GLOSSARY.md`
