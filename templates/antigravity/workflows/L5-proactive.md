# L5 — advisory analysis and guarded invariants

L5 adds explicit analysis tools such as Project Map, Task Compiler,
`simulate-impact`, architecture-debt scans, contract checks, and QA helpers. Their
results inform the owner; they are not universal preconditions for a write.

Runtime enforcement is controlled by the central gate registry. Predictive or
semantic checks remain `shadow`, `canary`, or `advisory`. Only the documented
deterministic guarded allowlist may deny, and a human override remains authoritative
where platform safety does not require confirmation.

Predictions are created only by an explicit `--write`; review compares them with
Git and factual reports. No hidden ledger marker or bypass token grants authority.
