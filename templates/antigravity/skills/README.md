# Antigravity Skills — domain taxonomy

This directory contains the **Antigravity adaptation** of ContextDevKit's Claude Code slash commands, converted to skills.
Unlike Claude Code which uses `/` command prefix, in Antigravity these files are executed as **Skills**.

To use a skill, you can refer to it by name. For example: "run the `audit` skill" or "execute `.antigravity/skills/audit/audit.md`".

## Layout

```
.antigravity/skills/
├── README.md                        ← you are here
│
│   Daily skills at the root — discovered first when you need daily workflows
├── state.md, log-session.md, new-adr.md, bug-hunt.md
├── roadmap.md, close-version.md, context-refresh.md, docs-reindex.md
├── claude-md.md, distill-apply.md, distill-sessions.md
├── fleet.md, playbook.md, predictions-review.md, simulate-impact.md
├── squad.md, token-report.md, tune-agents.md, context-stats.md
├── dashboard.md, watch.md
├── landing-page.md, media-gen.md   ← landing architect + media generation (ADR-0023/0024)
├── advise.md                       ← proactive six-lane improvement engine (ADR-0028)
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
│   ├── worktree-new.md
│   ├── draft-changelog.md           ← commits → Keep-a-Changelog skeleton (ADR-0030)
│   ├── gh-triage.md                 ← GitHub issues → backlog, classified (ADR-0030)
│   └── changelog-social.md          ← release → announcement copy, drafts only (ADR-0030)
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
│   ├── contract-check.md
│   ├── seo-audit.md                ← SEO + AISO static analysers (ADR-0025)
│   └── validate-doc.md             ← ADR/roadmap quality rubric (ADR-0030)
│
└── setup/                           ← installer + diagnostics
    ├── setupcontextdevkit.md
    ├── aidevtool-from0.md
    ├── context-doctor.md
    ├── context-level.md
    └── context-config.md
```

## Selection criteria for the root vs a pack

A skill stays at the **root** when it's a *daily* invocation that you'd use at the start or end of any session — `state`, `log-session`, `new-adr`.
Everything else moves into a pack so the root list remains uncluttered.

## Adding a new skill

1. Pick the pack (or stay at root for daily).
2. Drop `<name>.md` into the chosen directory.
3. Run `npm test` — the basename-collision check will catch any clash.
