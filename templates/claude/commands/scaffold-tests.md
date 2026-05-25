---
description: QA — materialize tests for the given files, routing each slice to the right specialist.
argument-hint: <files or scope>
---

# 🧪 Scaffold tests

Materialize tests for: **$ARGUMENTS**

Act as **qa-orchestrator** and route work to the specialists (fan out in parallel
for independent slices via the Agent tool when available):
- **qa-unit** → pure functions/modules in scope (fast, mocked deps).
- **qa-integration** → anything crossing a boundary (HTTP/DB/queue/fs).
- **qa-fuzzer** → parsers, validators, schemas, auth, and `qa.criticalPaths`.
- **qa-e2e** → critical user journeys, plus **visual / screenshot** checks where the
  UI's *look* is the contract (scaffold with `/visual-test`).

Rules:
1. Match the project's existing test runner and file conventions. Never add a
   second framework.
2. Place test files where the project keeps them; mirror existing naming.
3. Cover happy / edge / failure for each slice (use a prior `/test-plan` if one
   exists).
4. After writing, run the suite and report pass/fail.

If sub-agents aren't available in this environment, write the tests yourself but
keep the unit / integration / fuzz separation explicit.
