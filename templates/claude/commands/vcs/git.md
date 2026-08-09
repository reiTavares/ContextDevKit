---
description: Version-control command — git workflow + connect a remote (GitHub/GitLab/other) with the CLI, fully integrated.
argument-hint: [status | setup-remote | new-branch <name> | commit | pr | sync | release]
---

# 🔧 Git / Version Control

The disciplined git workflow for this project, integrated with the kit's hooks
(`commit-msg` enforces Conventional Commits, `pre-push` blocks real conflicts)
and commands (`/worktree-new`, `/close-version`). Always start by reading the
facts: `node contextkit/tools/scripts/git.mjs status`.

Act on **$ARGUMENTS**:

## status (default)
Run `git.mjs status` and summarize: repo/commits, branch, remote + provider,
ahead/behind, and whether `gh`/`glab` are installed + authed. Flag what's missing
and recommend the single next action.

## setup-remote — the decision tree (detect → connect or create)
**Always start by detecting** — read `git.mjs status` (`remoteUrl`, `isRepo`,
`hasCommits`, `cli`). Then follow the branch that matches:

**0. Not a git repo yet?** → `git init` first (and make an initial commit once
there are files).

**A. A remote ALREADY exists** (`remoteUrl` not null) → say so, show the URL +
provider, confirm it's the intended one, and stop. Nothing to set up. (Only fix
it if the user says it's wrong.)

**B. No remote → ASK: "Do you already have a repository for this
   (GitHub/GitLab/other) to connect, or should we create a new one?"**

  - **B1 — they HAVE one to connect** → ask for the URL (or `owner/repo`) and wire
    it: `git remote add origin <url>`, then `git fetch origin` and either
    `git push -u origin <branch>` (local has the history) or
    `git pull --rebase origin <default>` (remote has history) — reconcile if both
    do, keeping BOTH sides.

  - **B2 — they DON'T have one → suggest creating it.** Ask provider
    (GitHub/GitLab/other) + visibility (**private by default**; public is hard to
    undo — confirm explicitly). Ensure the CLI is installed + authed first (offer
    the OS-aware install; confirm before installing):
    - **GitHub** → `gh`: macOS `brew install gh` · Windows `winget install
      GitHub.cli` · Linux cli.github.com. Auth: `gh auth login`.
    - **GitLab** → `glab`: macOS `brew install glab` · Windows `winget install
      glab` · Linux gitlab.com/gitlab-org/cli. Auth: `glab auth login`.
    Then create + wire + push (confirm — outward-facing):
    - GitHub: `gh repo create <name> --private --source . --remote origin --push`
    - GitLab: `glab repo create <name> --private` then `git push -u origin <branch>`
    - other: create in the UI, then `git remote add origin <url>` + push.

Finally, recommend branch protection on the default branch (PRs + green CI before
merge). Never push/create without the user's explicit OK.

## new-branch <name>
`git checkout -b <type>/<name>` using a Conventional type
(feat/fix/chore/docs/refactor/test/ci/build/perf/style/revert). Never work on the
default branch directly.

## commit
Stage intentionally and commit with Conventional Commits
(`<type>(<scope>)?: <subject>`, ≤100 chars, no trailing period) — the `commit-msg`
hook enforces this; `[skip-cc]` bypasses. Keep commits small and coherent.

## pr
**First, re-check sync** [ADR-0026]: `node contextkit/tools/scripts/sync-check.mjs
prepr --fetch` (the `--fetch` refreshes remote refs — read-only checks don't fetch
by default, ticket 065, so pass it here when a fresh ahead/behind matters). It
re-confirms you are not behind the default branch (rebase first if you are) and detects whether an **open PR already exists for this branch** — if so,
just push to update it instead of creating a duplicate. Then push the branch
(`git push -u origin <branch>` — the `pre-push` hook checks for conflicts first)
and open a PR: `gh pr create` / `glab mr create`. Summarize the change; wait for
CI green before merge. Don't push to the default branch directly.

## sync
`git fetch` then `git pull --rebase origin <default>` to replay your work on top
and resolve conflicts cleanly (keeping BOTH sides' changes — never clobber).

## release
Defer to `/close-version <x.y.z>` (CHANGELOG + tag); a `v*` tag triggers the
release workflow if configured.

Confirm before any push, repo creation, or install — those are outward-facing.
