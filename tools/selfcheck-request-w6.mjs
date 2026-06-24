/**
 * Self-check — Request Orchestration W6 / Wave A8 (WF0038, ADR-0112 §W6).
 *
 * A8 = per-tier over-orchestration guard + explicit dispatch plan & gate (shadow).
 * Extends the W1–W4 selection pipeline; does not rebuild it.
 *
 *   1.  agent-orchestration-guard.mjs + dispatch-plan.mjs zero-dep + import cleanly
 *   2.  applyOverOrchestrationGuard: trivial⇒0, feature⇒≤3, architectural⇒≤5 sub-agents
 *   3.  guard: input selection not mutated; reason codes present on trim
 *   4.  buildDispatchPlan: shadow ⇒ willDispatch=false; active+flag ⇒ true; flag off ⇒ false
 *   5.  buildDispatchPlan: steps ordered lead→council→scouts→reviewers→synthesizer
 *   6.  reconcileDispatch: missing + extra + matched
 *   7.  deep selftests pass (guard + dispatch-plan, via subprocess)
 *   8.  clean-clone: A8 modules + selftests under templates/contextkit
 *
 * Zero runtime dependencies — node:* only.
 *
 * @module selfcheck-request-w6
 */
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const EXEC = 'templates/contextkit/runtime/execution';
async function read(p) { try { return await readFile(p, 'utf-8'); } catch { return ''; } }
function isZeroDep(src) {
  const specs = [];
  const re = /^\s*(?:import|export)\b[^\n]*?\bfrom\s+['"`]([^'"`]+)['"`]/gm;
  const reSide = /^\s*import\s+['"`]([^'"`]+)['"`]/gm;
  let m;
  while ((m = re.exec(src))) specs.push(m[1]);
  while ((m = reSide.exec(src))) specs.push(m[1]);
  return specs.every((s) => s.startsWith('.') || s.startsWith('node:'));
}
function subAgentCount(sel) {
  return ['supporting', 'scouts', 'reviewers', 'council'].reduce((n, k) => n + (Array.isArray(sel[k]) ? sel[k].length : 0), 0);
}

/**
 * Runs the W6 / A8 self-checks (over-orchestration guard + dispatch plan, shadow).
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} reporter
 * @param {{ KIT: string }} ctx repo root
 * @returns {Promise<void>}
 */
export async function runRequestW6Checks({ ok, bad }, { KIT }) {
  console.log('Checking Request Orchestration W6 / A8 (over-orchestration guard + dispatch plan)...');

  const guardPath = resolve(KIT, EXEC, 'agent-orchestration-guard.mjs');
  const planPath = resolve(KIT, EXEC, 'dispatch-plan.mjs');

  isZeroDep(await read(guardPath)) ? ok('agent-orchestration-guard.mjs is zero-dep') : bad('agent-orchestration-guard.mjs zero-dep failed');
  isZeroDep(await read(planPath)) ? ok('dispatch-plan.mjs is zero-dep') : bad('dispatch-plan.mjs zero-dep failed');

  let guard; let plan;
  try { guard = await import(pathToFileURL(guardPath).href); ok('agent-orchestration-guard imports cleanly'); }
  catch (err) { bad(`agent-orchestration-guard import failed: ${err?.message ?? err}`); return; }
  try { plan = await import(pathToFileURL(planPath).href); ok('dispatch-plan imports cleanly'); }
  catch (err) { bad(`dispatch-plan import failed: ${err?.message ?? err}`); return; }

  // ── 2-3. per-tier guard ───────────────────────────────────────────────────
  const heavy = () => ({ lead: 'architect', supporting: ['s1', 's2'], scouts: ['c1', 'c2'], reviewers: ['r1', 'r2'], council: ['v1', 'v2'], synthesizer: 'syn', reasonCodes: [] });
  const cfg = { orchestration: { overOrchestrationGuard: {}, specialists: { autoDispatch: true }, executeDispatchPlan: true }, deliberations: { council: { min: 3 } } };
  const triv = guard.applyOverOrchestrationGuard(heavy(), { complexity: 'trivial', needsDebate: false }, cfg);
  const feat = guard.applyOverOrchestrationGuard(heavy(), { complexity: 'feature', needsDebate: false }, cfg);
  const arch = guard.applyOverOrchestrationGuard(heavy(), { complexity: 'architectural', needsDebate: false }, cfg);
  subAgentCount(triv) === 0 && subAgentCount(feat) <= 3 && subAgentCount(arch) <= 5
    ? ok(`guard caps by tier: trivial=${subAgentCount(triv)} feature=${subAgentCount(feat)} architectural=${subAgentCount(arch)}`)
    : bad(`guard caps wrong: trivial=${subAgentCount(triv)} feature=${subAgentCount(feat)} architectural=${subAgentCount(arch)}`);

  const original = heavy();
  guard.applyOverOrchestrationGuard(original, { complexity: 'trivial', needsDebate: false }, cfg);
  subAgentCount(original) === 8 && Array.isArray(feat.reasonCodes) && feat.guard && feat.guard.plannedAfter <= 3
    ? ok('guard: input not mutated; reasonCodes + guard meta present')
    : bad('guard mutated input or missing meta');

  // ── 4. dispatch plan gate ─────────────────────────────────────────────────
  const envOf = (mode) => ({ requestId: 'req-1', dispatchPlanId: 'dispatch-req-1', routing: { mode }, classification: { complexity: 'feature' }, agents: { lead: 'architect', council: ['v1', 'v2'], scouts: ['c1'], reviewers: ['r1'], synthesizer: 'syn' }, playbooks: [] });
  const shadow = plan.buildDispatchPlan(envOf('shadow'), cfg);
  const active = plan.buildDispatchPlan(envOf('active'), cfg);
  const flagOff = plan.buildDispatchPlan(envOf('active'), { orchestration: { executeDispatchPlan: false, specialists: { autoDispatch: true } } });
  shadow.willDispatch === false && active.willDispatch === true && flagOff.willDispatch === false
    ? ok('buildDispatchPlan gate: shadow=false, active+flag=true, flag-off=false')
    : bad(`dispatch gate wrong: shadow=${shadow.willDispatch} active=${active.willDispatch} flagOff=${flagOff.willDispatch}`);

  // ── 5. step ordering ──────────────────────────────────────────────────────
  const roles = active.steps.map((s) => s.role);
  const idxLead = roles.indexOf('lead'); const idxSyn = roles.lastIndexOf('synthesizer');
  idxLead === 0 && (idxSyn === -1 || idxSyn === roles.length - 1) && active.plannedAgents.includes('architect')
    ? ok(`dispatch steps ordered lead→…→synthesizer (${roles.join('>')})`)
    : bad(`dispatch step order wrong: ${roles.join('>')}`);

  // ── 6. reconcile ──────────────────────────────────────────────────────────
  const rec = plan.reconcileDispatch(active, ['architect', 'v1', 'x-extra']);
  rec.missing.length > 0 && rec.extra.includes('x-extra') && rec.matched === false
    ? ok('reconcileDispatch: detects missing + extra + matched=false')
    : bad(`reconcileDispatch wrong: ${JSON.stringify({ m: rec.missing, e: rec.extra, ok: rec.matched })}`);

  // ── 7. deep selftests ─────────────────────────────────────────────────────
  for (const f of ['agent-orchestration-guard.selftest.mjs', 'dispatch-plan.selftest.mjs']) {
    try { execFileSync(process.execPath, [resolve(KIT, EXEC, f)], { cwd: KIT, stdio: 'pipe' }); ok(`deep selftest passes: ${f}`); }
    catch (err) { bad(`deep selftest FAILED: ${f} — ${String(err?.stdout ?? err).slice(-200)}`); }
  }

  // ── 8. clean-clone ────────────────────────────────────────────────────────
  const artifacts = ['agent-orchestration-guard.mjs', 'dispatch-plan.mjs', 'agent-orchestration-guard.selftest.mjs', 'dispatch-plan.selftest.mjs'].map((f) => `${EXEC}/${f}`);
  const missing = artifacts.filter((p) => !existsSync(resolve(KIT, p)));
  missing.length === 0
    ? ok('clean-clone: A8 modules + selftests under templates/contextkit')
    : bad(`clean-clone: missing A8 artifacts: ${missing.join(', ')}`);
}
