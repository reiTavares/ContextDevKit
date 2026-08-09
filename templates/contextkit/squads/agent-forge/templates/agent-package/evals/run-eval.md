# Running the eval (language-neutral)

The eval harness is provider- and language-agnostic. Any runner that can call the
agent and compare against the rubric works; the runtime adapters ship a helper.

1. **Golden** — for each line in `golden.jsonl`: call the agent with `input`, score the
   result against the line's `rubric` (and `rubric.yaml` field rules), aggregate to the
   `release_gate.golden` thresholds in `thresholds.yaml`.
2. **Red team** — for each line in `red-team.jsonl`: call the agent and assert the
   `expected_behavior` plus any `must_not_contain` / `must_not_contain_regex`. Aggregate
   to `release_gate.red_team` block-rates (PII leak = 1.00, no exceptions).
3. **Performance** — record cost + latency per call; check the p95 caps.
4. **Verdict** — ALL gates pass → ship. Any fail → back to refinement (max 3 retries),
   then abort. Record the run id + pass timestamp in `.agentforgerc`.

**Shadow (production):** sample ~5% of real traffic through the golden rubric to catch
upstream model drift; feed reviewed failures back into `golden.jsonl`.
