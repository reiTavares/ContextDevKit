---
name: "source-command-vcs-gh-triage"
description: "Triage open GitHub issues into the DevPipeline backlog — classify, prioritize, dedupe. Read-from-GitHub, write-to-backlog."
---

# source-command-vcs-gh-triage

Use this skill when the user asks to run the migrated source command `gh-triage`.

## Command Template

# 🗂️ GitHub issue triage

Turn unstructured GitHub issues into actionable, prioritized backlog tasks
[ADR-0030, OSS repo-ops]. This reads from GitHub and writes to the local
DevPipeline — it does **not** close, label, or comment on issues without your OK.

1. **Fetch (incremental by default — ticket 075).** Requires `gh` (the existing
   review provider — [ADR-0021]). If it's missing or unauthed, say so and stop
   (rule 8 — skip, never fake):
   ```
   gh issue list --state open --json number,title,body,labels,createdAt,author > /tmp/gh-issues.json
   node contextkit/tools/scripts/gh-triage.mjs select /tmp/gh-issues.json > /tmp/gh-new.json
   ```
   `select` filters to issues **created after the stored watermark** and not
   already tracked (`source: gh#<n>`), so a re-run only processes what's new — use
   the `new[]` array of `/tmp/gh-new.json`; `skipped` reports how many were
   already-seen / duplicates. (For a single issue:
   `gh issue view <number> --json number,title,body,labels` — triage it directly,
   no watermark.) To re-triage everything, pass `--since ""`.

2. **Classify each issue** with the complexity rubric [ADR-0030]:
   ```
   node contextkit/tools/scripts/complexity-rubric.mjs classify "<issue title + gist>"
   ```
   - **Type** — bug / feature / chore / docs (from the body + labels).
   - **Tier & domain** — architectural tier ⇒ flag that an ADR is needed; a
     regulated domain (LGPD / fintech / …) ⇒ tag `@privacy-lgpd` / `@security`.
   - **Priority** — P0 data-loss/security/broken build · P1 broken core path · P2
     degraded · P3 cosmetic.

3. **Dedupe.** Before adding, scan the existing board
   (`node contextkit/tools/scripts/pipeline.mjs sync` then read the backlog) so you
   don't create a duplicate of a task already tracked. Note the link instead.

4. **Add to the backlog**, one per issue, cross-referencing the issue number:
   ```
   node contextkit/tools/scripts/pipeline.mjs add --type <bug|feature|chore> \
     --priority <P0-P3> --source "gh#<number>" --title "<concise title>"
   ```
   Fill each new file's context + acceptance criteria from the issue body.

5. **Commit the watermark.** After a successful triage, advance the cursor so the
   next run starts where this one ended (use the `watermark` from `/tmp/gh-new.json`):
   ```
   node contextkit/tools/scripts/gh-triage.mjs commit "<watermark-iso>"
   ```
   Skip this only if you bailed mid-triage (so the next run re-pulls the unfinished
   issues).

6. **Report.** Summarise: triaged N issues → M new tasks (K duplicates / J already-
   seen skipped), the priority spread, and any issue that needs a human decision
   before triage.
