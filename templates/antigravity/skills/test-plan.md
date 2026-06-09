# Skill: test-plan

> QA — generate a 3-layer test plan (happy / edge / failure) for a scope, before writing test code.
> Argument: <what to test>
# 🧪 Test plan

Produce a shift-left test plan for: **<user-specified argument>** (if empty, infer from the
current change / recent edits).

Act as **qa-orchestrator**:
1. Read `vibekit/config.json` → `qa` (`criticalPaths`, `coverageTarget`) and the
   project's existing test setup so the plan fits the stack.
2. Identify the units, boundaries, and invariants in scope. Note which fall on
   `qa.criticalPaths` (these get priority).
3. Output the plan in **three layers**, each with concrete, specific cases (not
   generic boilerplate):
   - **Happy path** — the expected successful flows.
   - **Edge cases** — boundaries: empty/max/negative, unicode, timezones,
     concurrency, off-by-one.
   - **Failure modes** — invalid input, dependency errors, partial failure,
     timeouts, idempotency/retries.
4. For each case, note the right layer (unit / integration / fuzz) so
   `/scaffold-tests` can route it.

Do not write test code here — this is the plan. Offer `/scaffold-tests` next.
