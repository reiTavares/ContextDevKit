# Playbook: squad-qa

> Reusable procedure. Follow the steps below when invoked.

# 🧪 Playbook: qa-team

This playbook directs adversarial verification and regression testing.

## 👥 Members
* `qa-orchestrator`: Routes testing requests, manages `/test-plan` and `/qa-signoff`.
* `qa-unit`: Designs isolated unit tests with mock objects.
* `qa-integration`: Exercises database, networks, and file system boundaries.
* `qa-fuzzer`: Runs adversarial boundary input testing on validators and parsers.
* `qa-perf`: Profiles hot paths and audits resource usage.
* `qa-e2e`: Runs end-to-end browser workflows simulating critical user flows.

## 📝 Best Practices
1. **Three-Layer Plans:** Ensure testing includes Happy Path, Edge Cases, and Failure Scenarios.
2. **Deterministic Runs:** Avoid flaky tests. Mock out temporal functions and network dependencies.
3. **QA Verification Commands:**
   * Run full suite: `npm test` or `npm run test`
   * Test scaffolding: `node cdx.mjs scaffold-tests <file>`
   * QA Signoff check: `node cdx.mjs qa-signoff`
