---
description: Create a new ADR (Architecture Decision Record). Use BEFORE implementing a big decision.
argument-hint: <ADR title>
---

Create a new Architecture Decision Record for: **$ARGUMENTS**

0. **Check for an existing decision first** [ADR-0027]: run
   `node contextkit/tools/scripts/adr-digest.mjs --search "<key terms from the title>"`.
   If an ADR already covers this, extend or supersede it rather than create a duplicate.

1. Find the next ADR number: list `contextkit/memory/decisions/`, take the highest `NNNN` + 1
   (zero-padded to 4 digits). The `0000` meta-ADR and `_TEMPLATE.md` do not count as the latest
   numbered decision beyond their own number.

2. Copy the structure from `contextkit/memory/decisions/_TEMPLATE.md` into a new file
   `contextkit/memory/decisions/<NNNN>-<kebab-slug>.md`.

3. Fill in:
   - **Status**: `Proposed` (the user accepts it later).
   - **Context**: the forces at play — why a decision is needed now.
   - **Decision**: what we will do, stated plainly.
   - **Consequences**: trade-offs, what becomes easier/harder, follow-ups.
   - If this supersedes an earlier ADR, note `Supersedes ADR-XXXX` and update the old one's status
     to `Superseded by ADR-<NNNN>`.

4. Show the user the draft and ask for confirmation before marking it `Accepted`.

5. **Generate the backlog from the decision** [ADR-0034] — a decision with no tasks is
   decorative. Once `Accepted`, preview the work it implies and create it:
   ```
   node contextkit/tools/scripts/adr-tasks.mjs <NNNN>            # preview (dry-run)
   node contextkit/tools/scripts/adr-tasks.mjs <NNNN> --write    # create, tagged source: adr:NNNN
   ```
   It parses the **Decision** points into backlog tasks (auto-classified, ADR-tagged).
   Review the preview, prune/merge as needed, then `--write`. The tasks then flow
   through the pipeline (`/pipeline start` → working → conclusion on accepted criteria).

ADRs are immutable once `Accepted` — to change a decision, write a new ADR that supersedes it.
Never delete or rewrite an accepted ADR.
