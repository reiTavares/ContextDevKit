# {{PROJECT_NAME}} — Instructions for Antigravity

> This file replaces `CLAUDE.md` for Antigravity sessions. It provides the same
> boot context and coding constitution, adapted for Antigravity's architecture.
> Scaffolded by ContextDevKit on {{DATE}} (mode: {{MODE}}, level: L{{LEVEL}}).
> The Knowledge Items (KIs) in `<appDataDir>/knowledge/contextdevkit-*` contain
> the detailed reference material.

## Quick Orientation

You are working on **{{PROJECT_NAME}}**.
<!-- One paragraph: what the product/project does and for whom. Replace this. -->
_Describe {{PROJECT_NAME}} in 2–3 sentences._

---

## 🔄 Complete Session Workflow (Antigravity)

### 1. Booting the Session (SessionStart)
At the start of the session, run the Session Manager:
```bash
node ctx.mjs session start
```
*(`agy session start` also works if you installed `contextdevkit` globally; otherwise use `node ctx.mjs`.)*
This runs the hook that fetches upstream git status, detects workspace claims, identifies prior unregistered sessions (drift), and injects the boot context.

### 🤖 Autonomous Execution Guidelines (For AI Agents)
- As an AI agent (Antigravity), you have direct access to run shell commands in this workspace.
- **You are expected to execute these commands autonomously** at appropriate times:
  - Run `node ctx.mjs session start` as your very first action at the beginning of a session.
  - Run `node ctx.mjs session status` periodically to check for modified files and ledger status.
  - Run `node ctx.mjs session end` followed by `node ctx.mjs log-session` at the end of the session to check rules and register work.
  - Run `node ctx.mjs guard <path>` BEFORE editing any sensitive file (config `l5.highRiskPaths`) — exit 1 means run the `simulate-impact` skill first. This replaces Claude Code's automatic PreToolUse gate on this host.
  - Run `node ctx.mjs doctor` or `node ctx.mjs tech-debt` autonomously to perform health and tech-debt audits.

### 2. Adopting a Posture (Squad Sub-agents)
If your task requires specialized knowledge, check the agent definitions in `.agents/agents/` and adopt that posture. The personas are organized into specialized squads:
- **devteam**: `architect`, `code-reviewer`, `context-keeper`, `test-engineer`
- **qa-team**: `qa-orchestrator`, `qa-unit`, `qa-integration`, `qa-fuzzer`, `qa-perf`, `qa-e2e`
- **design-team**: `ui-designer`, `ux-designer`, `accessibility`, `seo-specialist`, `landing-architect`
- **security-team**: `security`, `code-security`, `infra-security`
- **compliance-team**: `privacy-lgpd`, `governance-officer`
- **ops-team**: `devops`
- **agent-forge** (L6+): `forge-orchestrator`, `model-router`, `prompt-engineer`, `tool-designer`, `eval-designer`, `packager`, `rag-designer`, `agent-architect`
- **independent**: `engine-keeper`, `growth`, `retention`, `product-owner`

### 3. Executing a Task (DevPipeline & Playbooks)
- Run the `pipeline` skill to list outstanding backlog cards.
- Adopt the `dev-start` skill (`.agents/skills/pipeline/dev-start.md`) to checkout a branch and lock scope.
- If performing a specific routine procedure, reference and follow the playbooks in `.agents/playbooks/`:
  - `distillation-cycle.md` (distillation cycles)
  - `landing-page.md` (landing page design and audits)
  - `security-batch.md` (security audits and batch checks)
  - `seo-aiso.md` (SEO optimization checklists)
  - `simulate-impact.md` (pre-edit impact simulation)
  - `tanstack.md` (TanStack framework practices)
  - `tech-debt-sweep.md` (tech debt sweeps and remediation)
- To understand the architectural activation tier of the target workspace, refer to the workflows in `.agents/workflows/`:
  - `L1-static-loading.md`, `L2-session-ledger.md`, `L3-multi-session.md`, `L4-squads.md`, `L5-proactive.md`

### 4. Ending the Session (Stop Hook & Registration)
Before finishing:
1. Run the session status check:
   ```bash
   node ctx.mjs session status
   ```
2. If there are unregistered edits on important files, run the session end check:
   ```bash
   node ctx.mjs session end
   ```
3. Use the `log-session` command (`node ctx.mjs log-session`) to log your work, update `CHANGELOG.md`, and clear the ledger.

---

## ⛔ Immutable Rules

1. **Zero runtime dependencies on the hot path** — no npm packages in hooks/config loader.
2. **Hooks never break real work** — every hook exits 0 on error.
3. **Every addition ships with a test** — `npm test` green before any push.
4. **Stay portable & single-sourced** — no bash-isms, forward-slash paths.
5. **Conventional Commits** — enforced by the commit-msg hook.

---

## 🏛️ Coding Constitution

- **Posture**: Staff/Principal Engineer — architecture before syntax.
- **File limit**: 280 lines (+10% tolerance with documented cohesion reason in header JSDoc).
- **Single Responsibility**: no "And"/"Or" function names.
- **Clean naming**: no `data`, `temp`, `obj`, `val`, `x`, `arr`, `result`.
- **Fail fast**: validate at boundaries, typed errors, never swallow exceptions.
- **Language**: code in English; docs bilingual (English + pt-BR).
- **Self-audit**: check all rules before emitting code.

---

## 📋 Available Skills Index (`.agents/skills/`)

All 105 slash commands from Claude Code have been adapted into skills. The most common ones are:

| Pack | Skill Path | Description |
|---|---|---|
| **Root** | `state.md` | Quick project state overview |
| | `log-session.md` | Register work at session end |
| | `new-adr.md` | Create a new Architecture Decision Record |
| | `roadmap.md` | View or edit the project roadmap |
| | `simulate-impact.md` | Run pre-edit simulations on high-risk files |
| | `predictions-review.md` | Review actual changes vs impact predictions |
| **Pipeline** | `pipeline/pipeline.md` | View/manage DevPipeline boards and tasks |
| | `pipeline/dev-start.md` | Start a focused, scope-locked branch lane |
| | `pipeline/ship.md` | Run test suites, compile, and ship the lane |
| **Audit** | `audit/audit.md` | Run consolidated health audit (doctor + tech-debt) |
| | `audit/deep-analysis.md` | Deep scans + dependency audit + security sweep |
| | `audit/analyze-code-ia-practices.md` | Checks separation of concerns and file limits |
| **QA** | `qa/qa-signoff.md` | Final QA target and coverage verification |
| | `qa/scaffold-tests.md` | Scaffolds unit/integration tests for a file |
| **VCS** | `vcs/claim.md` / `release.md` | Reserve/free file paths for parallel work |
| | `vcs/gh-triage.md` | Import GitHub issues to DevPipeline backlog |
| **Forge** | `forge/forge-new.md` | Create new custom sub-agent definitions |
| | `forge/forge-eval.md` | Benchmark prompt performances and routes |

*For the complete list and documentation of every skill, refer to the [Skills README](.agents/skills/README.md) or load the `contextdevkit-skills-index` Knowledge Item.*

---

## 🛠️ Key CLI Scripts

You can execute any of these scripts via the central runner:
```bash
node ctx.mjs <command>
```

Key commands:
- **`doctor`**: Diagnose installation health
- **`stats`**: Display project size, session counts, and metrics
- **`pipeline`**: Manage DevPipeline task cards
- **`tech-debt`**: Scan codebase for TODO/FIXME markers
