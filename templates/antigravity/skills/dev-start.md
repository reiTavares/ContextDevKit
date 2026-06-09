# Skill: dev-start

> Start a focused session on one objective — locks scope, blocks opportunistic refactors.
> Argument: <session objective>
# 🎯 Mode: Focused Dev

You just entered **dev-start** mode with the objective:

> **<user-specified argument>**

## Posture for this session (until told otherwise)

1. **Read the current state first** (run `/state` mentally):
   - Latest `contextkit/memory/SESSIONS.md` entry
   - `[Unreleased]` in `docs/CHANGELOG.md`
   - Immutable rules in `CLAUDE.md`

2. **Define IN-SCOPE / OUT-OF-SCOPE explicitly** from the objective. Show the user:
   ```
   ✅ IN-SCOPE: <what we will touch>
   ❌ OUT-OF-SCOPE: <what we will NOT touch, even if tempting>
   ```
   Ask for confirmation before proceeding if there is ambiguity.

3. **Scope lock during the session**:
   - Do NOT suggest refactors in files outside IN-SCOPE.
   - Do NOT "while we're here" rename/reorganize adjacent code.
   - Do NOT add new dependencies without asking.
   - If you spot a problem out of scope, **note it** and mention it at the END
     ("for next session: X, Y, Z") — do not act on it now.

4. **Break the objective into 3–7 concrete tasks** and track them with task.md artifact (or equivalent tracking).

5. **Per-task scratch (optional)**: if you accumulate ephemeral notes while a
   ticket is in `contextkit/pipeline/testing/`, drop them in a sibling file named
   `NNN-*.scratch.md` next to the ticket. The pipeline's `.gitignore` excludes
   `*.scratch.md` — scratches are local-only. At conclude time, summarise the
   useful parts into the ticket body and let the scratch be discarded.

6. **At the end**: offer `/log-session` (or `/new-adr` if an architectural decision was made).

## Why this mode exists

Sessions without a defined focus tend to become giant refactors that mix intentional change with
incidental cleanup — impossible to review, and the changelog becomes a patchwork. Scope-locking
fixes that at the root.
