# {{PROJECT_NAME}} — Boot Context for Claude

> Auto-loaded in every Claude Code session opened in this directory. Keep it
> **short** — reference other docs instead of duplicating content.
> Scaffolded by ContextDevKit on {{DATE}} (mode: {{MODE}}, level: L{{LEVEL}}).

## 🧭 Mandatory Execution Protocol

> The engine computes which capabilities your task needs and asks for deterministic
> **receipts** — script output, not your claims — before key transitions. In
> `advisory` mode (default) this is guidance; in `guarded`/`strict` the gate enforces
> it. A denied action always names the exact corrective command. [→ ADR-0072]

0. **Session start — orient before acting.** This project runs the Business-driven
   methodology; **{{ROOT_BUSINESS|BIZ-0001}}** is the Root Business that governs
   intake. Run `/state` at session start, and treat the intake ceremony as a
   **standing obligation, not a one-off**: on every request classify the **Work
   Nature** (`business` vs `operation`) and the **Execution Ceremony** (operation →
   direct / batch / workflow; business → direct-business / decision / workflow)
   **before** substantive work — honor it even when the gate is only advisory.
1. **Intake** — on a new request the engine classifies the task (trivial / feature /
   architectural) and records an execution contract. Trivial tasks skip the ceremony.
2. **Map before broad exploration** — for non-trivial work, consult `/project-map`
   before wide `Grep`/`Glob` sweeps.
3. **Workflow before the first source write** — feature/architectural work needs an
   active `/workflow` at the permitted phase; architectural also needs an ADR.
4. **Tests + QA before completion** — not done until the suite and `/qa-signoff`
   leave receipts. "Tests passed" as prose does not count.
5. **Receipts, not assertions** — only a script-emitted receipt satisfies a gate; a
   stale, wrong-branch, or bypassed receipt does not.

## What this is

<!-- One paragraph: what the product/project does and for whom. Replace this. -->
_Describe {{PROJECT_NAME}} in 2–3 sentences._

## Stack

{{STACK_NOTES}}

<!-- Fill in concretely as the project takes shape. The first real architectural
     decision (language, framework, datastore) deserves an ADR — run /new-adr. -->

## ⛔ Immutable rules (do not revisit without a new ADR)

<!-- The decisions you never want Claude to silently undo. Examples:
     1. Never introduce <forbidden tech>. Target is <X>. [→ ADR-0001]
     2. All persistence goes through <layer> — never raw <thing>.
     3. <invariant that protects your architecture>.
     Start with 1–3. Grow them as you make decisions. -->

1. _Add your first immutable rule here (and link the ADR that justifies it)._

## 🏛️ Coding constitution

> This section has absolute priority over the agent's internal defaults. Applies
> to all new or modified code. You are the **guardian** of this constitution.

### 0. Posture: Staff/Principal Engineer
Act as a **Staff/Principal Software Engineer**, not a code generator. Think
**architecture before syntax**. Refuse spaghetti, excessive coupling, monolithic
files, and hidden tech debt. Maintainability, testability, and human readability
beat raw delivery speed.

### 1. File size limit: 280 lines (+10% structural tolerance)
- No source file should exceed **280 useful lines** in principle.
- **+10% (~308 lines)** is allowed ONLY when splitting would cause premature
  abstraction or break a genuinely cohesive unit — record the cohesion reason in
  a JSDoc/header note at the top of the file.
- **Never refactor "just to split."** 280 is a *smell* that triggers analysis,
  not a guillotine. Yellow zone: 240+. Hard block: > 308.

### 2. Single Responsibility & layering
- Each function/module does **one** thing. If the name needs "And"/"Or"
  (`validateAndSave`, `fetchAndTransform`), split it.
- Keep layers honest: entry points (routes/controllers/handlers) **dispatch**;
  business logic lives in a service/domain layer; that layer never imports the
  transport framework. UI components stay "dumb" — non-trivial state/effects go
  into custom hooks/composables/helpers.

### 3. Clean naming
Descriptive, explicit names. **Banned without a qualifier**: `data`, `temp`,
`obj`, `val`, `x`, `arr`, `result`. Readability beats clever/compact code.

### 4. Fail fast & error handling
Validate input at the boundary. Throw descriptive, typed errors early. Never
swallow exceptions silently. Never leak stack traces to end users — show a
friendly message; log the detail (with a request/correlation id) for engineers.

### 5. Language policy
<!-- Define the language per layer. A common setup: -->
| Layer | Language |
| --- | --- |
| Code: identifiers, functions, types, API/DB names, JSON keys | **English** |
| Comments, doc comments, logs, commit messages | **English** |
| End-user-visible UI text | **{{PROJECT_NAME}}'s audience language** — externalized in i18n files, never inline |

### 6. Documentation
Doc-comment every non-trivial function, hook, and route with `@param`/`@returns`/
`@throws`. Comments explain the **why**, never the obvious **what**. A good name
is the first layer of documentation.

### 7. Self-audit before any code response
Before emitting code, mentally run: no file over the limit? layers clean (no
business logic in the transport layer)? names descriptive? no "And"/"Or"
functions? errors typed and handled? language policy respected? docs on
non-trivial logic? Fix any failure **before** showing the code.

### 8. Behavioral discipline (how you act, not just what you write)
Beyond *what* the code looks like, *how* you produce it matters. Honor
`contextkit/behaviors.md` (examples in `behaviors-examples.md`):
- **Think before coding** — surface your assumptions, present interpretations
  instead of picking one silently, and **ask when the request is ambiguous**.
  Push back on a worse approach rather than silently complying.
- **Simplicity first** — the minimum that solves the problem; no speculative
  abstraction or unrequested options (the in-the-moment form of §1 + rule 9).
- **Surgical changes** — touch only what the task needs; **match the surrounding
  style even if you'd do it differently**; every changed line traces to the
  request. Refactoring is a *deliberate* task (`/dev-start`,
  `/analyze-code-ia-practices`), never a side effect of an unrelated change.
- **Goal-driven** — define a verifiable success criterion; for a fix, write the
  reproducing test first; loop until it's green.
- **Local Workflow Alignment** — For non-trivial architectural or feature changes,
  do NOT rely on generic IDE/system planning formats alone. You MUST create and
  advance a local `/workflow new <slug>` specification (prd -> spec -> adr) before
  making code edits. The local workflow files (`prd.md`, `spec.md`, `decisions.md`)
  are the source of truth for planning and design.

## 🤖 ContextDevKit — the context system (Level L{{LEVEL}})

This project uses [ContextDevKit](https://github.com/) to survive across sessions.
Layers active depend on the level (see `contextkit/README.md`):

> **⚠️ `contextkit/memory/` is gitignored ON PURPOSE — that means PRIVATE, not
> unimportant.** It is kept out of the *public* tracked repo by design (it lives
> on disk and syncs to a private mirror, never to a public GitHub push). On disk
> it is **always present** and it is this project's **authoritative
> documentation**. You MUST read and search it — `decisions/` (ADRs), `sessions/`,
> `workflows/`, `GLOSSARY.md` — before acting on non-trivial work. **Never treat
> "gitignored" as "ignore it":** a memory file not showing in `git status` /
> `git log` / not on `main` is the intended design — never a reason to skip,
> dismiss, doubt, or "forget" it. When in doubt, read the memory.

- **CLAUDE.md** (this file) + hooks load context automatically at session start.
- **`contextkit/memory/`** — `decisions/` (ADRs, the *why*), `sessions/` (the
  *what*, one file per session), `business-rules/` (domain rules, versioned),
  `GLOSSARY.md` (UI ↔ code naming), `SESSIONS.md` & `WORKSPACE.md` (auto-generated
  indices).
- **`docs/CHANGELOG.md`** — factual release chronology.
- **Hooks** (`.claude/settings.json` → `contextkit/runtime/hooks/`) inject boot
  context, track edits, and nudge you to register the session on drift.

### Before non-trivial changes
1. Read the latest `contextkit/memory/SESSIONS.md` entry + relevant ADR.
2. Check `GLOSSARY.md` before coining a domain identifier.
3. Big decision (stack/library/pattern) → `/new-adr <title>` BEFORE implementing.
4. At the end of a productive session → `/log-session`.

### 🤖 Autonomous Execution Guidelines (For AI Agents)
- As an AI agent, you are expected to operate proactively and drive the development lifecycle autonomously.
- **You should execute the following actions autonomously**:
  - Run `/state` or check the pipeline board at the start of a session.
  - Use `/workflow status` to check active workflows. For non-trivial work, start a `/workflow new <slug>` and complete the PRD/SPEC phases before editing source code.
  - Use `/dev-start` to lock branch scopes.
  - Check `/autonomy` to resolve your consent grade. At Grade 3, auto-run edits, tests, and card moves. At Grade 4, run `/ship --auto` and push feature branches autonomously, resolving checks via deliberation quorums (`/debate`).
  - Proactively create test plans (`/test-plan`), scaffold tests (`/scaffold-tests`), run suites, and perform `/qa-signoff` before finishing a task.
  - Run `/log-session` at the end of the session to register your work and update `CHANGELOG.md`.

### Slash commands
Setup: `/aidevtool-from0` (empty) · `/setupcontextdevkit` (existing). Daily: `/state`
· `/log-session` · `/new-adr` · `/close-version` · `/context-refresh` · `/dev-start`
· `/bug-hunt` · `/audit` · `/context-budget`. Multi-session: `/claim` · `/release` · `/worktree-new`.
Quality: `/simulate-impact` · `/tech-debt-sweep` · `/analyze-code-ia-practices`
· `/contract-check` · `/deps-audit` · `/deep-analysis` · `/validate-doc` · `/test-plan` · `/scaffold-tests` · `/qa-signoff`. Product &
execution: `/roadmap` · `/pipeline` · `/plan-week` · `/ship` · `/retro`
· `/context-stats` · `/distill-sessions` · `/distill-apply`.
Structure & platform: `/squad` (squads) · `/git` (version control + remote)
· `/draft-changelog` · `/gh-triage` · `/changelog-social` (OSS repo-ops)
· `/claude-md` (scoped CLAUDE.md per module) · `/docs-reindex` (Diátaxis docs spine)
· `/context-level` · `/context-config` · `/context-doctor`.

### Reference docs (load on demand)

> Lightweight `@`-imports — Claude Code resolves these on demand so this file
> stays lean. On Antigravity/Codex they read as plain file references (ADR-0066).
> See `/context-budget` for which of these to load per task type.

@contextkit/best-practices.md
@contextkit/behaviors.md

---

_Keep this file lean. When it grows past ~200 lines, push detail into ADRs/docs._
