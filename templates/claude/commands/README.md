# Slash commands — domain taxonomy

> Closes [ticket 047](../../../vibekit/pipeline/conclusion/047-skill-packs-by-domain-subfolders.md).
> Claude Code resolves commands by **file basename**, not by path — so
> `/qa-signoff` finds `qa/qa-signoff.md` just as well as the flat layout.
> Subfolders are pure human navigation: the directory listing is no longer
> a 50-file scroll.

## Layout

```
templates/claude/commands/
├── README.md                        ← you are here
│
│   Daily commands at the root — discovered first when you type `/`
├── state.md, log-session.md, new-adr.md, bug-hunt.md
├── roadmap.md, close-version.md, context-refresh.md
├── claude-md.md, distill-apply.md, distill-sessions.md
├── fleet.md, playbook.md, predictions-review.md, simulate-impact.md
├── squad.md, token-report.md, tune-agents.md, vibe-stats.md
├── dashboard.md, watch.md
│
├── qa/                              ← test strategy + execution
│   ├── qa-signoff.md
│   ├── test-plan.md
│   ├── scaffold-tests.md
│   └── visual-test.md
│
├── vcs/                             ← version control + parallel sessions
│   ├── git.md
│   ├── claim.md
│   ├── release.md
│   └── worktree-new.md
│
├── forge/                           ← agent-forge squad lifecycle
│   ├── forge-new.md
│   └── forge-{list,show,doctor,policy,budget,audit,
│              eval,redteam,route,fallback-test,
│              refresh-matrix,killswitch,deprecate}.md
│
├── pipeline/                        ← DevPipeline + autonomy
│   ├── pipeline.md
│   ├── ship.md
│   ├── dev-start.md
│   ├── retro.md
│   └── runs.md
│
├── audit/                           ← deep scans + security + policy
│   ├── audit.md
│   ├── deep-analysis.md
│   ├── security-setup.md
│   ├── deps-audit.md
│   ├── tech-debt-sweep.md
│   ├── analyze-code-ia-practices.md
│   └── contract-check.md
│
└── setup/                           ← installer + diagnostics
    ├── setupvibedevkit.md
    ├── aidevtool-from0.md
    ├── vibe-doctor.md
    ├── vibe-level.md
    └── vibe-config.md
```

## Selection criteria for the root vs a pack

A command stays at the **root** when it's a *daily* invocation that you'd
type at the start of any session — `/state`, `/log-session`, `/new-adr`.
Everything else moves into a pack so the root list reads as "what most
sessions do, most days".

## Why not deeper nesting?

One level of subfolder is the budget. Two levels would re-create the
50-file scroll inside each pack, and Claude Code's command discovery
output (`/` autocomplete) flattens at one level anyway.

## What about basename collisions?

Forbidden by design — Claude Code's resolver picks the first match by
basename and the order isn't promised. A selfcheck assertion
(`tools/selfcheck-source.mjs`, `no command basename collides across
packs`) keeps the invariant honest.

## Adding a new command

1. Pick the pack (or stay at root for daily).
2. Drop `<name>.md` into the chosen directory.
3. Run `npm test` — the basename-collision check will catch any clash.

That's it. No registry, no manifest, no `_index.md`. Discovery is the
directory tree.
