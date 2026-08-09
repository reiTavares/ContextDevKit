# Audit and test a change

<!-- GENRE: How-to (task-oriented) -->

Use audits to collect evidence, then decide explicitly whether any finding should
become work. Audit commands are read-only by default and never create tasks.

## 1. Run the relevant analysis

Choose the narrowest command that covers the question:

```shell
node contextkit/tools/scripts/doctor.mjs
node contextkit/tools/scripts/tech-debt-scan.mjs
node contextkit/tools/scripts/security-audit.mjs
```

Treat a missing optional tool as `skipped`, not as a pass. Keep facts,
inferences, and unknown external state separate in the report.

## 2. Create follow-up work only when requested

When the owner asks to retain a finding, target one existing workflow or batch
store explicitly:

```shell
node contextkit/tools/scripts/pipeline.mjs add \
  --tasks contextkit/memory/operations/OP-0001-example/workflows/WF-0001-example \
  --title "Fix the observed issue" \
  --priority P1 \
  --evidence-refs reports/audit.json
```

There is no global writable backlog. The command writes the selected canonical
`tasks.json` through CAS and updates its Markdown projection.

## 3. Test the changed contract

Start with the focused suite that would fail for the regression. Then run the
repository's registered integration and global gates through the compact runner:

```shell
node contextkit/tools/scripts/economy/run-compact.mjs npm test --kind test --capture-full
```

A timeout, skipped suite, or stale receipt is not green evidence. Record the
actual command, exit code, duration, and any remaining limitation.

## 4. Finish with QA evidence

Run the project's QA sign-off command after focused and global tests. Completion
may be denied only by the central guarded QA predicate; missing agents, routing
recommendations, graph data, or optional reports never substitute for test
evidence.

See [Use the pipeline board](use-the-pipeline-board.md) and
[Governance contract](../reference/governance-contract.md).
