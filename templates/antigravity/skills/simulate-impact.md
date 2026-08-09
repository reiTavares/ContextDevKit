# Skill: simulate-impact

> L5 pre-flight — map the blast radius of a change BEFORE editing high-risk paths.
> Argument: <one-sentence objective>
# 🔮 Simulate Impact

Objective: **<user-specified argument>**

Produce a **Blast Radius Report** before material changes on high-risk paths.

1. **Identify what the change touches.** List the concrete files/dirs you expect to modify. Cross-
   reference `contextkit/config.json` → `l5.highRiskPaths` to see which are gated.

2. **Map the blast radius.** For each touched area, reason about downstream effects: public
   contracts/exports, API/route signatures, data schema, auth surface, shared types, anything that
   other modules or external consumers depend on. If agents are installed (Level 4), delegate
   focused sub-analyses to the relevant specialists in parallel and consolidate.

3. **Materialize the reviewed prediction** with the explicit write flag:
   ```
   node contextkit/tools/scripts/mark-simulation.mjs --write "<user-specified argument>" <covered-path-or-dir/> [more ...]
   ```
   Use trailing slashes for directory coverage (e.g. `src/services/`). Then fill
   the generated **Predicted blast radius** section with the concrete risks,
   order of changes, rollback, and evidence from steps 1–2.

4. Summarize the report to the user and proceed with the change in the suggested order.

This report is advisory evidence. It never grants a hidden bypass and never
replaces host or platform safety controls.
