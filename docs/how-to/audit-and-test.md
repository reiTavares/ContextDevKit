# How to audit and test

<!-- GENRE: How-to guide (task-oriented)
     Goal: reader runs a health audit, creates a test plan, scaffolds tests,
           and produces a QA sign-off verdict.
     Voice: direct, imperative — assume competence, skip "what is X" explanations. -->

## When to use this guide

You want to assess the current health of the project before a release, after a
significant change, or as a regular weekly check. You also want to write tests for a
specific scope and obtain a formal QA verdict.

## Prerequisites

- ContextDevKit installed at level 1 or higher.
- `node` 18+ available on the path.
- A test runner is already configured in the project (if scaffolding tests).
- `contextkit/config.json` has `qa.criticalPaths` and `qa.coverageTarget` set (for
  sign-off) — run `/context-config` to check.

## Steps

### Run the health audit

1. Run the one-pass health audit.

   ```shell
   /audit
   ```

   The audit runs in sequence:
   - `node contextkit/tools/scripts/doctor.mjs` — install health, critical issues and warnings.
   - `node contextkit/tools/scripts/stats.mjs` — drift rate and session cadence.
   - `node contextkit/tools/scripts/tech-debt-scan.mjs --quick` — worst debt offenders.
   - `node contextkit/tools/scripts/contract-scan.mjs` — removed or renamed exports
     (only when `l5.contractGlobs` is configured).
   - Test suite run with coverage (when a runner exists).

   The audit output is a single prioritized list: red (do now), yellow (soon), green
   (fyi), each with the specific file and a one-line fix.

2. Ingest the mechanical findings into the backlog.

   ```shell
   node contextkit/tools/scripts/tech-debt-scan.mjs --write
   node contextkit/tools/scripts/pipeline.mjs ingest contextkit/memory/tech-debt-findings.json --type chore
   ```

   Then add the red and yellow judgment items manually:

   ```shell
   node contextkit/tools/scripts/pipeline.mjs add --type chore --priority P1 --title "fix X"
   ```

### Create a test plan

3. Run `/test-plan` for a specific scope before writing any test code.

   ```shell
   /test-plan "rate-limiting middleware"
   ```

   The skill detects the project stack and existing runners, reads `qa.criticalPaths`
   and `qa.coverageTarget` from config, and produces a three-layer plan:

   - **Happy path** — expected successful flows.
   - **Edge cases** — boundaries: empty, max, negative, unicode, timezones, off-by-one.
   - **Failure modes** — invalid input, dependency errors, partial failure, timeouts,
     idempotency, retries.

   Each case includes the appropriate test layer (unit, integration, fuzz) so the
   scaffold step can route it correctly.

4. Review the plan before proceeding.

   Do not scaffold tests for a plan you have not read. The plan is the contract; the
   scaffold materializes it.

### Scaffold the tests

5. Run `/scaffold-tests` to materialize tests from the plan.

   ```shell
   /scaffold-tests "rate-limiting middleware"
   ```

   The skill fans out to specialist sub-agents (when available) routed by layer:
   - **qa-unit** — pure functions and modules with mocked dependencies.
   - **qa-integration** — anything crossing a boundary (HTTP, DB, queue, filesystem).
   - **qa-fuzzer** — parsers, validators, schemas, and `qa.criticalPaths`.
   - **qa-e2e** — critical user journeys and visual contracts.

   To inspect what the scaffold script would generate without writing files:

   ```shell
   node contextkit/tools/scripts/scaffold-tests.mjs scaffold "your scope"
   ```

   To write the starter harness files:

   ```shell
   node contextkit/tools/scripts/scaffold-tests.mjs scaffold "your scope" --write
   ```

6. Run the suite after scaffolding to confirm the harness works.

   ```shell
   node contextkit/tools/scripts/economy/run-compact.mjs <your test command>
   ```

   Fix any harness-level failures before writing domain tests.

### Obtain QA sign-off

7. Run `/qa-signoff` to produce the final verdict.

   ```shell
   /qa-signoff
   ```

   The sign-off process:
   - Runs the full test suite through the compact runner.
   - Checks all `qa.criticalPaths` for happy-path and failure-mode coverage.
   - Verifies coverage against `qa.coverageTarget`.
   - If a visual harness exists, checks whether the visual suite passed.
   - Produces a concise report: covered items, gaps (with specific files and cases),
     and a clear PASS or NEEDS-WORK verdict.

8. Act on a NEEDS-WORK verdict before merging.

   A NEEDS-WORK on a critical path is a real blocker. Open a focused `/dev-start`
   on the gap and re-run `/qa-signoff` after fixing it.

9. Record the verdict in the session log.

   ```shell
   /log-session
   ```

## Verify it worked

- The audit output shows a prioritized list with at least one actionable item (or a
  clean green-only report).
- `contextkit/pipeline/backlog/` has new chore cards for the red and yellow audit
  findings.
- The test plan file is reviewed before the scaffold runs.
- `/qa-signoff` produces a PASS verdict with all critical paths covered.

## Troubleshooting

**Symptom:** `/audit` finishes instantly with no findings even though the project has
known issues.
Fix: Check that `contextkit/config.json` has `l5.contractGlobs` set for contract
scans, and that a test runner exists for the QA status step. The audit only runs
checks it can actually execute.

**Symptom:** `/scaffold-tests` produces tests for the wrong runner.
Fix: The scaffold detects the runner from `package.json` and existing test file
conventions. If detection fails, ensure at least one existing test file uses the
correct runner's import style.

**Symptom:** `/qa-signoff` reports a gap on a critical path that is in fact covered.
Fix: Check `qa.criticalPaths` in `contextkit/config.json`. The paths listed there are
matched against the coverage report. A path that is too broad or uses a different
pattern than the coverage tool reports will show as a gap.

**Symptom:** The compact runner exit code differs from the raw test command.
Fix: `run-compact.mjs` uses the exit code as the sole signal. Inspect
`runs/<id>/stdout.log` to see the full test output and find what caused the non-zero
exit.

## Related

- [`/dev-start`](start-a-focused-session.md) — scope lock before implementing changes the tests will cover.
- [`/pipeline`](use-the-pipeline-board.md) — move the cards that audit findings generate.
- [`/new-adr`](record-a-decision.md) — record decisions surfaced by a deep audit.
- [`/context-config`](../reference/skills.md) — set `qa.criticalPaths` and `qa.coverageTarget`.
