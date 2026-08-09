---
description: Draft a [Unreleased] CHANGELOG skeleton from Conventional Commits since the last tag. Drafts only — never writes the file.
argument-hint: [--since <tag>]
---

# 📝 Draft the changelog

Build a `[Unreleased]` skeleton from the commits since the last release [ADR-0030].

1. Run the drafter:
   ```
   node contextkit/tools/scripts/draft-changelog.mjs $ARGUMENTS
   ```
   It reads `git log <lastTag>..HEAD`, parses Conventional Commit subjects, and
   groups them into Keep-a-Changelog sections (Added / Changed / Fixed / Removed /
   Security / Documentation / Chores). `--since <tag>` overrides the range.

2. **Review and humanise.** The output is a *skeleton*, not the final entry:
   - Merge duplicate/noisy lines; drop pure-chore churn the reader won't care about.
   - Promote any ⚠️ BREAKING change to the top and explain the migration.
   - Reference the relevant ADR(s) where a line records a decision.

3. **Paste into `docs/CHANGELOG.md`** under `[Unreleased]` yourself. This command
   **never writes the file** — drafting is automated, the editorial call is yours.
   To cut the version when ready, use `/close-version`.

> Pairs with `/changelog-social` (turn the finished entry into announcement copy)
> and `/close-version` (stamp `[Unreleased]` → `[X.Y.Z]` and tag).
