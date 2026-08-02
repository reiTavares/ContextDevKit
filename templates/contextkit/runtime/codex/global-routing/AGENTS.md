<!-- contextdevkit:codex-global-routing:start -->
# Global Codex subagent routing

This is a binding personal harness rule for every project. Project instructions
may add stricter admission gates, but must not silently weaken this routing gate.

Before every subagent invocation, the primary agent MUST:

1. Classify both `complexity` and `risk` itself. Canonical values are `low`,
   `moderate`, `high`, `xhigh`, and `critical`.
2. Run:
   `node "{{CODEX_HOME}}/harness/resolve-subagent-route.mjs" --project-root "<cwd>" --agent "<agent-or-role>" --complexity <value> --risk <value>`
3. Spawn only when the receipt has `decision: "dispatch"`; pass its exact
   `model` and `effort`. Any null field, nonzero exit, refusal, malformed output,
   or policy drift blocks the invocation.
4. If a custom agent profile pins conflicting routing, use the neutral `default`
   profile and carry the specialist role in the prompt.

Classification guide:

- Complexity: `low` bounded/simple; `moderate` localized multi-step; `high`
  cross-module or architectural; `xhigh` broad-system/migration/uncertain
  integration; `critical` control-plane, irreversible, or safety-critical.
- Risk: `low` reversible/isolated; `moderate` localized and recoverable; `high`
  security/data/contracts/releases/user behavior; `xhigh` production, tenants,
  PII, or wide blast radius; `critical` catastrophic, irreversible, or
  credential/control-plane compromise.
- Classify conservatively. Never omit a dimension to get a cheaper route.
  Critical risk with non-critical complexity is refused until reclassified.

ContextKit is authoritative when present and must match the global snapshot.
Only ContextKit absence enables fallback. Complete dimensions outrank task kind,
role defaults, budget downgrade, QA escalation, session model, and defaults.
`ultra` is legal only for `critical × critical` on Sol.

| Complexity | Low risk | Moderate risk | High risk | Xhigh risk | Critical risk |
| --- | --- | --- | --- | --- | --- |
| Low | Luna/low | Luna/medium | Luna/max | Sol/high | refuse |
| Moderate | Luna/high | Luna/max | Luna/max | Sol/high | refuse |
| High | Luna/max | Luna/max | Sol/high | Sol/xhigh | refuse |
| Xhigh | Luna/max | Sol/high | Sol/xhigh | Sol/max | refuse |
| Critical | Sol/xhigh | Sol/xhigh | Sol/xhigh | Sol/max | Sol/ultra |
<!-- contextdevkit:codex-global-routing:end -->
