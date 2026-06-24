---
name: "source-command-pipeline-dev-start"
description: "Start a focused session on one objective — locks scope, blocks opportunistic refactors."
---

# source-command-pipeline-dev-start

Use this skill when the user asks to run the migrated source command `dev-start`.

## Command Template

# 🎯 Mode: Focused Dev

You just entered **dev-start** mode with the objective:

> **$ARGUMENTS**

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
   node contextkit/tools/scripts/complexity-rubric.mjs classify "$ARGUMENTS"
   ```
   It returns a **tier** (trivial → no ADR/no story · feature → story · architectural
   → `/new-adr` FIRST) and detects a **regulated domain**. If it flags a domain
   (LGPD / fintech / healthcare …), **auto-route to the named agents** (e.g.
   `@privacy-lgpd` + `@security`) and treat the work as architectural. The tier is
   advisory, not a cage — state it and adjust with the user if it misreads.

   **Auto-start a referenced task** [ADR-0034]: if the objective names a backlog
   task id (e.g. "fix 042" / "ticket 058"), move it into `working/` and attach it
   to this session so the board tracks it live:
   ```
   node contextkit/tools/scripts/pipeline.mjs start <id>
   ```
   While you work, the task's heartbeat is renewed on every edit; when you finish,
   **check off its acceptance criteria** — the Stop hook then auto-concludes it
   (working → conclusion). No manual `move` needed.

   **Model routing is active** [ADR-0094] — the boot banner shows the mode
   (`shadow` by default). Apply the posture *Haiku operates · Sonnet executes ·
   Opus decides* without being re-prompted: run ≤3 simple deterministic commands
   **directly** (runner-first — never spawn an agent for one trivial command);
   **batch** mechanical investigation (grep/glob/tests/lint/log triage) to a
   **Haiku** agent that returns a compact pack; delegate bounded low/medium-risk
   implementation to **Sonnet** under a short contract; keep **Opus** for decisions
   and for implementing high/critical-risk code directly (auth/RLS, migrations,
   concurrency, public contracts). Never auto-select Fable. Minimize *total* task
   cost, not just per-token price — don't delegate when coordination costs more
   than direct execution. Disable per session via `routing.enabled=false`.

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

6. **Break the objective into 3–7 concrete tasks** and track them with task plan/checklist.

7. **Workflow spec pack context** [ADR-0057]: if the objective names a workflow
   slug or the task card has `workflow:` / `spec:` metadata, read
   `contextkit/memory/workflows/<slug>/prd.md`, `spec.md`, `tasks.md`, and
   `memory.md` before editing. Do not duplicate those artifacts in the task;
   link them and keep implementation evidence in the card/report.

8. **Per-task scratch (optional)**: if you accumulate ephemeral notes while a
   ticket is in `contextkit/pipeline/testing/`, drop them in a sibling file named
   `NNN-*.scratch.md` next to the ticket. The pipeline's `.gitignore` excludes
   `*.scratch.md` — scratches are local-only. At conclude time, summarise the
   useful parts into the ticket body and let the scratch be discarded.

9. **Before opening a PR — re-check sync** [ADR-0026]. Run
   `node contextkit/tools/scripts/sync-check.mjs prepr --fetch` (or just use `/git pr`,
   which runs it): it re-confirms you are not behind `main` and that **no open PR
   already exists for this branch** before you create one. (`--fetch` refreshes
   remote refs — read-only checks skip the fetch by default, ticket 065.) Don't duplicate a PR;
   push to update the existing one.

10. **At the end**: offer `/log-session` (or `/new-adr` if an architectural decision was made).

## Why this mode exists

Sessions without a defined focus tend to become giant refactors that mix intentional change with
incidental cleanup — impossible to review, and the changelog becomes a patchwork. Scope-locking
fixes that at the root.
