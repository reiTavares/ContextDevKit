/**
 * Self-check — Request Orchestration W7 / Wave A9 (WF0038, ADR-0112 §W7).
 *
 * A9 = child execution envelope & inheritance + lazy hydration & state propagation.
 * Built atop the existing envelope + receipt + state primitives (shadow-safe).
 *
 *   1.  child-envelope.mjs + context-hydration.mjs zero-dep + import cleanly
 *   2.  deriveChildEnvelope: child inherits nature/context; canDelegate=false; depth+1
 *   3.  assertChildScope: rejects reclassify / autonomy-change / scope-expansion / createsWorkflow / acceptsADR
 *   4.  assertChildScope: accepts a faithful child; missing parent ⇒ violation
 *   5.  hydrateRolePack: role gets only its needed sections
 *   6.  hydrateRolePack: HARD token budget NEVER exceeded (oversized ⇒ truncated, tokenCount≤budget)
 *   7.  propagateState: rolls up child→…→business; pure + no-throw when no I/O target
 *   8.  deep selftests pass (child-envelope + context-hydration, via subprocess)
 *   9.  clean-clone: A9 modules + selftests under templates/contextkit
 *
 * Zero runtime dependencies — node:* only.
 *
 * @module selfcheck-request-w7
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

/**
 * Runs the W7 / A9 self-checks (child envelope + hydration + propagation, shadow).
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} reporter
 * @param {{ KIT: string }} ctx repo root
 * @returns {Promise<void>}
 */
export async function runRequestW7Checks({ ok, bad }, { KIT }) {
  console.log('Checking Request Orchestration W7 / A9 (child envelope + hydration + propagation)...');

  const cePath = resolve(KIT, EXEC, 'child-envelope.mjs');
  const chPath = resolve(KIT, EXEC, 'context-hydration.mjs');

  isZeroDep(await read(cePath)) ? ok('child-envelope.mjs is zero-dep') : bad('child-envelope.mjs zero-dep failed');
  isZeroDep(await read(chPath)) ? ok('context-hydration.mjs is zero-dep') : bad('context-hydration.mjs zero-dep failed');

  let ce; let ch;
  try { ce = await import(pathToFileURL(cePath).href); ok('child-envelope imports cleanly'); }
  catch (err) { bad(`child-envelope import failed: ${err?.message ?? err}`); return; }
  try { ch = await import(pathToFileURL(chPath).href); ok('context-hydration imports cleanly'); }
  catch (err) { bad(`context-hydration import failed: ${err?.message ?? err}`); return; }

  // ── parent envelope fixture ───────────────────────────────────────────────
  const parent = {
    requestId: 'req-parent', delegationDepth: 0,
    classification: { primaryType: 'implementation', complexity: 'feature', ceremony: 'workflow' },
    context: { rootBusinessId: 'BIZ-0001', paths: ['src/a.mjs'] },
    autonomy: { effectiveGrade: 3 },
    routing: { mode: 'shadow' }, agents: { lead: 'architect', council: ['v1'] }, playbooks: [],
    decisions: ['ADR-0112'], acceptance: ['tests green'],
  };

  // ── 2. deriveChildEnvelope inheritance ────────────────────────────────────
  const child = ce.deriveChildEnvelope(parent, { childId: 'c1', role: 'reviewer' });
  child.canDelegate === false && child.delegationDepth === 1
    && (child.classification?.primaryType ?? child.inherited?.classification?.primaryType) === 'implementation'
    ? ok('deriveChildEnvelope: inherits nature, canDelegate=false, depth=parent+1')
    : bad(`deriveChildEnvelope wrong: canDelegate=${child.canDelegate} depth=${child.delegationDepth}`);

  // ── 3. assertChildScope rejects forbidden mutations ───────────────────────
  const rejects =
    ce.assertChildScope(parent, { primaryType: 'business' }).valid === false &&
    ce.assertChildScope(parent, { effectiveGrade: 4 }).valid === false &&
    ce.assertChildScope(parent, { scope: ['src/a.mjs', 'src/NEW.mjs'] }).valid === false &&
    ce.assertChildScope(parent, { createsWorkflow: true }).valid === false &&
    ce.assertChildScope(parent, { acceptsADR: true }).valid === false;
  rejects ? ok('assertChildScope: rejects reclassify/autonomy/scope/workflow/ADR') : bad('assertChildScope failed to reject a forbidden mutation');

  // ── 4. accepts a faithful child; missing parent ⇒ violation ───────────────
  const faithful = ce.assertChildScope(parent, { primaryType: 'implementation', complexity: 'feature', effectiveGrade: 3 });
  const noParent = ce.assertChildScope(null, { primaryType: 'implementation' });
  faithful.valid === true && noParent.valid === false
    ? ok('assertChildScope: accepts faithful child; missing parent ⇒ violation')
    : bad(`assertChildScope faithful/missing wrong: faithful=${faithful.valid} noParent=${noParent.valid}`);

  // ── 5-6. hydrateRolePack role-scoping + HARD budget ───────────────────────
  const pack = ch.hydrateRolePack('reviewer', parent, { maxTokens: 1500 });
  Array.isArray(pack.sections) && pack.sections.length > 0 && pack.tokenCount <= pack.budget
    ? ok(`hydrateRolePack: reviewer pack (${pack.sections.length} sections, ${pack.tokenCount}/${pack.budget} tokens)`)
    : bad(`hydrateRolePack role-scope wrong: ${JSON.stringify({ s: pack.sections?.length, t: pack.tokenCount, b: pack.budget })}`);

  const bigText = 'x '.repeat(5000);
  const bigEnv = { ...parent, context: { ...parent.context, blob: bigText }, request: bigText };
  const tight = ch.hydrateRolePack('lead', bigEnv, { maxTokens: 50 });
  tight.tokenCount <= 50
    ? ok(`hydrateRolePack: HARD budget never exceeded (truncated=${tight.truncated}, ${tight.tokenCount}≤50)`)
    : bad(`hydrateRolePack budget VIOLATED: ${tight.tokenCount} > 50`);

  // ── 7. propagateState rollup (pure, no I/O target) ────────────────────────
  const roll = ch.propagateState('wave', { children: [{ id: 'c1', status: 'done' }, { id: 'c2', status: 'pending' }] }, {});
  roll && roll.rollup && roll.rollup.total === 2 && roll.rollup.done === 1
    ? ok(`propagateState: rollup done/total = ${roll.rollup.done}/${roll.rollup.total}`)
    : bad(`propagateState rollup wrong: ${JSON.stringify(roll?.rollup)}`);

  // ── 8. deep selftests ─────────────────────────────────────────────────────
  for (const f of ['child-envelope.selftest.mjs', 'context-hydration.selftest.mjs']) {
    try { execFileSync(process.execPath, [resolve(KIT, EXEC, f)], { cwd: KIT, stdio: 'pipe' }); ok(`deep selftest passes: ${f}`); }
    catch (err) { bad(`deep selftest FAILED: ${f} — ${String(err?.stdout ?? err).slice(-200)}`); }
  }

  // ── 9. clean-clone ────────────────────────────────────────────────────────
  const artifacts = ['child-envelope.mjs', 'context-hydration.mjs', 'child-envelope.selftest.mjs', 'context-hydration.selftest.mjs'].map((f) => `${EXEC}/${f}`);
  const missing = artifacts.filter((p) => !existsSync(resolve(KIT, p)));
  missing.length === 0
    ? ok('clean-clone: A9 modules + selftests under templates/contextkit')
    : bad(`clean-clone: missing A9 artifacts: ${missing.join(', ')}`);
}
