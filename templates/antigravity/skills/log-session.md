# Skill: log-session

> Register the current session (creates a session file + updates CHANGELOG). Use at the end.
Register the current work session. Steps:

1. **Find the next session number.** List `contextkit/memory/sessions/`. Each file is
   `<YYYY-MM-DD>-<NN>-<slug>.md`. The next `NN` = highest existing + 1 (zero-padded, min 2 digits).
   If the folder is empty, start at `01`.

2. **Create the session file** `contextkit/memory/sessions/<today>-<NN>-<slug>.md` where `<slug>`
   is a short kebab-case description (lowercase `a-z0-9._-` only). Use this structure:

   ```markdown
   # <Human-readable title>

   - **Date**: <YYYY-MM-DD>
   - **Session number**: <NN>
   - **Branch**: `<git branch>`

   ## Request
   <what the user asked for>

   ## Done
   <what was implemented/decided — files, key changes>

   ## Decisions
   <any architectural choices; link ADRs as [ADR-NNNN](../decisions/NNNN-...md)>

   ## Final state
   <what works, what is pending, the natural next step>
   ```

   Derive "Done" from the actual edits this session (check the ledger at
   `.claude/.sessions/` if useful) — be factual, do not inflate.

3. **Update `docs/CHANGELOG.md`** — add bullet(s) under `## [Unreleased]` describing user-facing
   or structural changes (Keep a Changelog style: Added / Changed / Fixed / Removed).

4. **Regenerate the index**: run `node contextkit/tools/scripts/session-reindex.mjs`.

5. **Close the predicted-vs-actual loop** (if this session ran `/simulate-impact`): run
   `node contextkit/tools/scripts/predictions-review.mjs` — it fills the *Actual* section of each
   prediction file from the ledger (paths actually changed vs predicted). No-op if there were
   no simulations.

6. **Scan for rule-like phrases** (ticket 043 — *proposal-only*, never auto-applies). After the
   session file is written, run:
   ```
   node contextkit/tools/scripts/distill-detect.mjs contextkit/memory/sessions/<the-file-you-just-wrote>.md
   ```
   If the detector surfaces candidates ("we decided X" / "from now on Y" / "always Z" / "convention:" /
   "lesson learned"), pass the line through to the user verbatim. **Do not** invoke
   `/distill-sessions` yourself — the user runs it (or doesn't). Silent on neutral sessions.

7. Confirm to the user: session number, file path, and CHANGELOG lines added.

Editing `contextkit/memory/SESSIONS.md` (via reindex) and `docs/CHANGELOG.md` marks the session as
registered, which silences the Stop drift nudge.
