# Skill: token-report

> Token economy & usage insight — report Claude Code token usage per session/week with budget warnings.
> Argument: [--all | --json]
# 🪙 Token Report

Make token cost a **measured** dimension of the project (L6 Insight).

Run:

```
node contextkit/tools/scripts/token-report.mjs
```

It reads Claude Code's local session transcripts (`~/.claude/projects/…`) and aggregates
**input / output / cache** tokens per session and per ISO week — read-only, local,
**aggregated counts only** (never content). Then:

1. Call out the **heaviest sessions** and what likely drove them (long context, big files
   re-read, repeated tool loops). A high cache-read share is normal — that's prompt caching.
2. Check usage against the budget (`tokens.budgetPerSession`). If sessions trend hot,
   suggest concrete optimizations: tighter scope per session (`/dev-start`), fewer
   full-file re-reads, a leaner boot context, cheaper models for low-stakes steps.
3. Set or adjust the budget: `/context-config set tokens.budgetPerSession <n>` (and
   `tokens.warnAtPct`).

Flags: `--all` (every project, not just this cwd) · `--json` (machine-readable) ·
`--from <dir>` (read transcripts from a specific directory).
