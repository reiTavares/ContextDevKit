# Skill: worktree-new

> Create a git worktree + branch for a parallel session on the same machine.
> Argument: <feature> [base-branch]
Create an isolated worktree so another Claude session can work in parallel without colliding on the
ledger or on live file edits.

Run:

```
node contextkit/tools/scripts/worktree-new.mjs <user-specified argument>
```

This creates branch `feat/<feature>` and a sibling worktree directory `../<repo>-<feature>`. Show
the user the output, including the `code "<path>"` command to open the new worktree in a separate
window. Remind them: each worktree has its own `.claude/.sessions/`, so the two sessions stay fully
isolated. When the feature is done: `git push -u origin feat/<feature>` then open a PR.
