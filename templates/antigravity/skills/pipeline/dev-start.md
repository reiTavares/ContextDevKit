# Skill: dev-start

> Start a focused session on one objective — locks scope, blocks opportunistic refactors.
> Argument: <session objective>
# 🎯 Mode: Focused Dev

You just entered **dev-start** mode with the objective:

> **<user-specified argument>**

## Posture for this session (until told otherwise)

1. **Sync preflight — look at GitHub *before* coding** [ADR-0026]. Run:
   ```
   node contextkit/tools/scripts/sync-check.mjs preflight
   ```
   It reports ahead/behind, recent **in-flight branches**, and **open PRs with
   their CI/review status** (flagging any *awaiting status*). If an open PR or a
   recent branch overlaps this objective, **surface it and confirm with the user
   before duplicating work** — coordinate or `/claim` first. `gh` missing/unauthed
   degrades to the git-only view; it never blocks. Behind upstream? `git pull`
   before editing.

2. **Read the current state first** — run `node contextkit/tools/scripts/context-pack.mjs`
   [ADR-0027]: **one** bounded bundle (latest-session digest + `[Unreleased]` +
   immutable rules + open backlog + recent ADRs) in a single call instead of
   opening each file. Open a full source only if the pack flags something to inspect.

3. **Right-size the work** [ADR-0030]. Classify the objective before committing
   to a process — don't over-engineer a typo or under-plan a migration:
   ```
   node contextkit/tools/scripts/complexity-rubric.mjs classify "<user-specified argument>"
   ```
   It returns a **tier** (trivial → no ADR/no story · feature → story · architectural
   → `/new-adr` FIRST) and detects a **regulated domain**. If it flags a domain
   (LGPD / fintech / healthcare …), **auto-route to the named agents** (e.g.
   `@privacy-lgpd` + `@security`) and treat the work as architectural. The tier is
   advisory, not a cage — state it and adjust with the user if it misreads.

4. **Define IN-SCOPE / OUT-OF-SCOPE explicitly** from the objective. Show the user:
   ```
   ✅ IN-SCOPE: <what we will touch>
   ❌ OUT-OF-SCOPE: <what we will NOT touch, even if tempting>
   ```
   Ask for confirmation before proceeding if there is ambiguity.

5. **Scope lock during the session**:
   - Do NOT suggest refactors in files outside IN-SCOPE.
   - Do NOT "while we're here" rename/reorganize adjacent code.
   - Do NOT add new dependencies without asking.
   - If you spot a problem out of scope, **note it** and mention it at the END
     ("for next session: X, Y, Z") — do not act on it now.
   - **Correct-course checkpoint** [ADR-0030]: if mid-session the work clearly
     outgrows the agreed scope (a feature turns out to need a migration, a new
     dependency, or an auth change), STOP and re-classify with the user before
     continuing — don't silently let scope creep past the tier you agreed on.

6. **Break the objective into 3–7 concrete tasks** and track them with task.md artifact (or equivalent tracking).

7. **Per-task scratch (optional)**: if you accumulate ephemeral notes while a
   ticket is in `contextkit/pipeline/testing/`, drop them in a sibling file named
   `NNN-*.scratch.md` next to the ticket. The pipeline's `.gitignore` excludes
   `*.scratch.md` — scratches are local-only. At conclude time, summarise the
   useful parts into the ticket body and let the scratch be discarded.

8. **Before opening a PR — re-check sync** [ADR-0026]. Run
   `node contextkit/tools/scripts/sync-check.mjs prepr` (or just use `/git pr`, which
   runs it): it re-confirms you are not behind `main` and that **no open PR
   already exists for this branch** before you create one. Don't duplicate a PR;
   push to update the existing one.

9. **At the end**: offer `/log-session` (or `/new-adr` if an architectural decision was made).

## Why this mode exists

Sessions without a defined focus tend to become giant refactors that mix intentional change with
incidental cleanup — impossible to review, and the changelog becomes a patchwork. Scope-locking
fixes that at the root.
