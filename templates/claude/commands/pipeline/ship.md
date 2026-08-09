---
description: L6 — autonomous feature pipeline. Drives an adaptive evidence loop: scope → design → implement → review → test → quality → record.
argument-hint: <feature / objective> [--auto]
---

# 🚢 Ship (autonomous engineering pipeline)

Objective: **$ARGUMENTS**

Run the end-to-end delivery pipeline. Use TodoWrite to track the stages.

The purpose of `/ship` is not to satisfy an agent roster. It is to drive the requested outcome through the appropriate engineering loop and preserve evidence.

## Checkpoint mode

Stages marked ◆ are checkpoints.

- **Manual (default)** — pause and ask for the user's OK at ◆.
- **Automatic (`--auto`)** — do not pause at ◆. Evaluate the same objective evidence, repair attributable red findings when they are within scope, and re-evaluate with fresh evidence. If a finding cannot be resolved honestly, surface it as unresolved.

Checkpoints do not add guarded domains. Irreversible external actions still use the host's real confirmation boundary.

## Engineering loop contract

Treat delivery as:

```text
implement
  ↓
evaluate
  ↓
findings
  ↓
correct
  ↓
re-evaluate
  ↓
fresh evidence
  ↓
done
```

Do not reuse stale completion evidence after a correction. Do not loop forever on the same unresolved finding: if evidence stops converging, identify the blocker and escalate it to the owner.

The three default guarded quality floors remain QA sign-off, applicable deterministic Class A DDD invariants, and new high/critical Technical Debt introduced by the current diff. Architecture Debt remains canary. Additional specialists/evaluators deepen confidence when complexity, risk, blast radius, affected contracts, or the owner's requested outcome justify them.

## Optional deliberation and interruption

Use `/debate` only when the decision genuinely benefits from independent specialist judgment or the owner explicitly requests it.

Councils, quorums, agent receipts, model output, and specialist presence never authorize or deny a ship step. A user message or interrupt changes the active instruction at the next safe boundary.

Token-budget telemetry may recommend a cheaper path but never changes permission. Force-push, secret rotation, and destructive production actions use explicit risk acknowledgement plus the host/platform confirmation boundary.

## Resume & progress tracking

Before anything else, check for an interrupted ship:

`node contextkit/tools/scripts/ship-state.mjs current`

If it reports an in-flight run, offer to resume from the stage it names instead of restarting from scope. Otherwise open a fresh run:

`ship-state.mjs begin "$ARGUMENTS"`

As you enter each stage, stamp it:

`ship-state.mjs step <scope|design|plan-tests|implement|self-review|test|quality-gates|record|report>`

At a manual checkpoint pause, mark `ship-state.mjs block`. When the requested outcome cannot proceed because of unresolved evidence, record the failed/unresolved state honestly. When step 9 completes, `ship-state.mjs end done`.

## Pipeline

1. **Scope & state.** (`ship-state.mjs step scope`)
   - Load relevant project context with `context-pack.mjs` and ADR search.
   - Restate the objective and IN/OUT-OF-SCOPE.
   - Use complexity/risk/domain signals as **advice for engineering depth**, not permission.
   - Conversation/exploration should never have entered `/ship`; this command is for confirmed mutation work.

2. **Design.**
   - Use `architect` when cross-cutting design, migration trade-offs, or meaningful blast radius justify it.
   - If delegation is used, provide the bounded context pack first.
   - Model recommendation is advisory. If model routing is unavailable or malformed, continue with the active agent.
   - `/simulate-impact` is useful evidence for high-risk paths, not a universal prerequisite.
   - ◆ Present design evidence in manual mode.

3. **Plan tests.**
   - Use `qa-orchestrator` for material work or when the requested outcome asks for full QA.
   - Plan happy, edge, and failure cases proportional to the change.
   - A trivial/local change may use a focused regression instead of manufacturing a full test programme.

4. **Implement.**
   - Use the active agent or relevant implementation specialist(s).
   - Make the smallest safe production diff that satisfies the objective.
   - Keep tests and evidence with the changed behavior.

5. **Self-review.**
   - A material diff should receive a code-review pass; delegate to `code-reviewer` when available.
   - Review structure, naming, dependency direction, state ownership, SRP, lean-code waste, error handling, and relevant ADRs/contracts.
   - If the specialist is unavailable, perform the same responsibility on the active agent. Agent presence is not a receipt.
   - Correct attributable review findings before continuing when they are part of the requested quality outcome.

6. **Test / QA.**
   - Run focused tests first, then the relevant project suite.
   - Use `/qa-signoff` for final evidence on material/critical work or when requested.
   - If the UI's look is part of the change, run visual QA where the project has a visual harness.
   - A QA rejection starts a fresh correction/evidence cycle; do not reuse stale PASS evidence.
   - ◆ Surface red evidence in manual mode; in `--auto`, fix attributable in-scope findings and re-run.

7. **Quality analysis.**
   - Run relevant debt/contract/architecture checks for the scope.
   - Architecture Debt is canary: use its findings to reason and improve, not as an automatic fourth guarded gate.
   - Technical Debt can block completion only under the configured guarded predicate for new high/critical debt introduced by the current diff.
   - Use domain/DDD, security, performance, accessibility, or other specialists when evidence says they materially matter.

8. **Record.**
   - Create/update an ADR only when a real material decision needs durable rationale.
   - Preserve factual reports/evidence and session context.
   - Update `[Unreleased]` changelog only when the project's release policy calls for it.

9. **Report.**
   - Summarize what shipped, tests/evidence, review/debt/architecture status, unresolved findings, and follow-ups.
   - Offer commit/PR when appropriate; do not perform destructive/external actions beyond the active owner/host boundary.

If any specialist is unavailable, continue on the active agent. The engineering responsibility remains; agent presence does not become a hidden prerequisite.

## Adaptive depth examples

```text
trivial/local
  └── focused validation

small change
  ├── focused tests
  └── self-review

material feature
  ├── tests
  ├── code review
  └── relevant architecture/debt analysis

critical/systemic change
  ├── full QA
  ├── DDD when domain invariants matter
  ├── architecture
  ├── security where applicable
  ├── technical debt
  ├── integration / E2E
  └── performance where applicable
```

This is a reasoning guide, not a rigid escalation table. The current owner instruction and actual project evidence determine the required outcome.

## Token economy

Default to delegate-to-worker for mechanical work only when delegation is actually cheaper or useful. Keep the controller responsible for scope, evidence, quality floors, and final synthesis.

Before optional subagent dispatch, use the bounded context/profile/economy tools when available. If any economy lever lacks data, record it as `skipped` rather than inventing savings.

## Core rule

> **The model may propose completion. Evidence justifies completion. The owner defines the outcome.**
