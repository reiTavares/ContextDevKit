---
description: QA — final evidence-backed verdict. Run the suite, check critical-path coverage vs target, write a PASS/NEEDS-WORK report.
---

# 🧪 QA sign-off

Act as **qa-orchestrator** and produce the final QA verdict.

1. Run the project's test suite (and coverage if the runner supports it).
2. Read `contextkit/config.json` → `qa.criticalPaths` and `qa.coverageTarget`.
3. Assess:
   - Do all tests pass?
   - Are the `criticalPaths` covered (happy + failure modes), not just the easy lines?
   - Is coverage at or above `coverageTarget` (where measurable)?
   - If a **visual harness** exists (`visual-test.mjs status`), did the visual suite pass? An unintended screenshot diff is a NEEDS-WORK; have design-team confirm intentional changes before refreshing baselines.
4. Write a concise report: ✅ covered, ⚠️ gaps with specific files/cases, and a clear **PASS** or **NEEDS-WORK** verdict.
5. Record evidence/report references on the active work item when one exists.

## Governance contract

QA sign-off is one of the three **guarded quality floors by default**, but only at the completion boundary. It never blocks implementation start.

A NEEDS-WORK verdict means the active agent should correct attributable findings and re-run QA when the requested outcome requires completion. Do not fabricate PASS, reuse stale evidence, or substitute agent presence for runner evidence.

The project owner remains authoritative: gate modes are configurable and a scoped human override may explicitly accept a guarded verdict. An override records the decision; it does not rewrite failed evidence into passed evidence or bypass real host/platform safety controls.

When a task is rejected after `testing` or `done`, use the canonical `qa-reject` transition so the task starts a **fresh QA cycle**. Current-cycle completion evidence is cleared where required; historical evidence remains audit history.

## Evidence-driven loop

For attributable QA findings, the expected engineering loop is:

```text
implement
  ↓
qa-signoff
  ↓
NEEDS-WORK
  ↓
correct
  ↓
fresh tests / fresh evidence
  ↓
qa-signoff
  ↓
PASS
```

If a finding is unrelated to the active scope, report it honestly instead of mass-bouncing unrelated tasks.

## Token economy (ADR-0103)

Run the test suite through the compact runner so only a bounded summary enters context, not the full log:

```
node contextkit/tools/scripts/economy/run-compact.mjs <your test command>
```

The full log is written to `runs/<id>/` (gitignored); the exit code is the pass/fail source for the test command. Skip compaction only if `economy.compaction.enabled` is false in config.

If the host exposes quota/usage data during the run, write a metadata-only quota snapshot so `/token-report` has real data:

```
node contextkit/tools/scripts/economics/quota-snapshot.mjs --write --source qa-signoff --capture-method manual <quota flags>
```

If quota data is not visible, report `quota-snapshot skipped: no host quota data`.
