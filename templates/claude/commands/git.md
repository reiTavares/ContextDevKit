---
description: Version-control skill — git workflow + connect a remote (GitHub/GitLab/other) with the CLI, fully integrated.
argument-hint: [status | setup-remote | new-branch <name> | commit | pr | sync | release]
---

# 🔧 Git / Version Control

The disciplined git workflow for this project, integrated with the kit's hooks
(`commit-msg` enforces Conventional Commits, `pre-push` blocks real conflicts)
and commands (`/worktree-new`, `/close-version`). Always start by reading the
facts: `node vibekit/tools/scripts/git.mjs status`.

Act on **$ARGUMENTS**:

## status (default)
Run `git.mjs status` and summarize: repo/commits, branch, remote + provider,
ahead/behind, and whether `gh`/`glab` are installed + authed. Flag what's missing
and recommend the single next action.

## setup-remote — connect GitHub / GitLab / other
If there's no `origin` (or the user wants to add one):
1. Ask which provider: **GitHub**, **GitLab**, or **other** (plain git URL).
2. Make sure the provider CLI is installed + authed (offer the install command
   for the user's OS — confirm before running anything that installs):
   - **GitHub** → `gh`. Install: macOS `brew install gh` · Windows `winget install
     GitHub.cli` · Linux see cli.github.com. Auth: `gh auth login`.
   - **GitLab** → `glab`. Install: macOS `brew install glab` · Windows `winget
     install glab` · Linux see gitlab.com/gitlab-org/cli. Auth: `glab auth login`.
   - **other** → just `git remote add origin <url>`.
3. Create the repo + wire the remote (confirm first — this is outward-facing):
   - GitHub: `gh repo create <name> --private --source . --remote origin --push`
   - GitLab: `glab repo create <name> --private` then `git push -u origin <branch>`
   - other: `git remote add origin <url>` then `git push -u origin <branch>`
   Default to **private** unless the user asks for public (public is hard to undo).
4. Recommend branch protection on the default branch (PRs + green CI before merge)
   — via the provider's settings or `gh`/`glab` API.

## new-branch <name>
`git checkout -b <type>/<name>` using a Conventional type
(feat/fix/chore/docs/refactor/test/ci/build/perf/style/revert). Never work on the
default branch directly.

## commit
Stage intentionally and commit with Conventional Commits
(`<type>(<scope>)?: <subject>`, ≤100 chars, no trailing period) — the `commit-msg`
hook enforces this; `[skip-cc]` bypasses. Keep commits small and coherent.

## pr
Push the branch (`git push -u origin <branch>` — the `pre-push` hook checks for
conflicts first) and open a PR: `gh pr create` / `glab mr create`. Summarize the
change; wait for CI green before merge. Don't push to the default branch directly.

## sync
`git fetch` then `git pull --rebase origin <default>` to replay your work on top
and resolve conflicts cleanly (keeping BOTH sides' changes — never clobber).

## release
Defer to `/close-version <x.y.z>` (CHANGELOG + tag); a `v*` tag triggers the
release workflow if configured.

Confirm before any push, repo creation, or install — those are outward-facing.
