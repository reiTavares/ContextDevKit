---
name: "source-command-vcs-gh-triage"
description: "Triage open GitHub issues into one explicit canonical task scope."
---

# source-command-vcs-gh-triage

Use this skill when the user asks to run the migrated source command `gh-triage`.

## Command Template

# GitHub issue triage

Convert selected GitHub issues into canonical v4 tasks. This is a mutation and
requires `--tasks <scope>`; there is no writable global backlog.

1. Fetch issues with authenticated `gh`. If the CLI or authentication is
   unavailable, skip, never fake a result.
2. For an incremental run, select new issues with:
   `node contextkit/tools/scripts/gh-triage.mjs select <issues.json>`.
   Existing task `evidenceRefs` entries such as `gh#42` provide deduplication.
3. Classify complexity with
   `node contextkit/tools/scripts/complexity-rubric.mjs classify "<issue gist>"`,
   then choose an explicit owner priority. Agent/model advice is optional and
   cannot deny triage.
4. Add each accepted issue through the canonical store:

   ```text
   node contextkit/tools/scripts/pipeline.mjs add --tasks <scope> \
     --priority <P0-P4> --title "<concise title>" \
     --acceptance "<criterion one>,<criterion two>" \
     --evidence-refs "gh#<number>"
   ```

5. After every selected issue is durably written, advance the watermark with
   `node contextkit/tools/scripts/gh-triage.mjs commit "<watermark-iso>"`.
   Do not advance it after a partial failure.
6. Report created task ids, duplicates, skipped issues, priority distribution,
   and the exact canonical scope. Do not close, label, or comment on GitHub
   issues without separate user authorization.
