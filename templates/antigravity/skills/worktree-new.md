# Skill: worktree-new

> Create a git worktree + branch for a parallel session on the same machine.
> Argument: <feature> [base-branch]
Create an isolated worktree so another host session can work in parallel without colliding on
explicit workspace claims or live file edits.

Run:

```
node contextkit/tools/scripts/worktree-new.mjs <user-specified argument>
```

This creates branch `feat/<feature>` and a sibling worktree directory `../<repo>-<feature>`. Show
the user the output, including the `code "<path>"` command to open the new worktree in a separate
window. Remind them that each worktree has an isolated Git index and workspace-claim directory.
When the feature is done: `git push -u origin feat/<feature>` then open a PR.
