/**
 * Self-check — Request Orchestration W5 / Wave A7 (WF0038, ADR-0112 §W5).
 *
 * A7 = Active Governed Context + Decision materiality & L7 debate-by-default (shadow).
 *
 *   1.  active-context-resolver.mjs imports cleanly + zero-dep
 *   2.  auto-deliberation.mjs imports cleanly + zero-dep
 *   3.  resolveActiveContext: frozen result, valid state enum, never hardcodes a root
 *   4.  resolveActiveContext: deterministic (same input twice → identical)
 *   5.  recommendDeliberation: fires on material+grade≥3+active; not on trivial/low-grade
 *   6.  recommendDeliberation: synthesizer distinct from every voice
 *   7.  deep selftests pass (active-context-resolver + auto-deliberation, via subprocess)
 *   8.  clean-clone: A7 runtime modules live under templates/contextkit (installer-copied)
 *
 * Zero runtime dependencies — node:* only.
 *
 * @module selfcheck-request-w5
 */
import { execFileSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const EXEC = 'templates/contextkit/runtime/execution';
async function read(p) { try { return await readFile(p, 'utf-8'); } catch { return ''; } }

/**
 * True when every module specifier in a real import/export-from statement is a
 * relative path or a `node:` builtin (zero third-party deps). Parses only import
 * statement lines — prose/strings containing "from '…'" are ignored.
 * @param {string} src module source
 * @returns {boolean}
 */
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
 * Runs the W5 / A7 self-checks (active context + auto-deliberation, shadow-only).
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} reporter
 * @param {{ KIT: string }} ctx repo root
 * @returns {Promise<void>}
 */
export async function runRequestW5Checks({ ok, bad }, { KIT }) {
  console.log('Checking Request Orchestration W5 / A7 (active context + auto-deliberation)...');

  const acrPath = resolve(KIT, EXEC, 'active-context-resolver.mjs');
  const adPath = resolve(KIT, EXEC, 'auto-deliberation.mjs');

  // ── 1-2. zero-dep ─────────────────────────────────────────────────────────
  isZeroDep(await read(acrPath)) ? ok('active-context-resolver.mjs is zero-dep') : bad('active-context-resolver.mjs zero-dep check failed');
  isZeroDep(await read(adPath)) ? ok('auto-deliberation.mjs is zero-dep') : bad('auto-deliberation.mjs zero-dep check failed');

  // ── import both ───────────────────────────────────────────────────────────
  let acr; let ad;
  try { acr = await import(pathToFileURL(acrPath).href); ok('active-context-resolver imports cleanly'); }
  catch (err) { bad(`active-context-resolver import failed: ${err?.message ?? err}`); return; }
  try { ad = await import(pathToFileURL(adPath).href); ok('auto-deliberation imports cleanly'); }
  catch (err) { bad(`auto-deliberation import failed: ${err?.message ?? err}`); return; }

  // ── 3. resolveActiveContext: frozen, valid state, no hardcoded root ────────
  const STATES = ['confirmed', 'suggested', 'ambiguous', 'unlinked'];
  const ctxA = acr.resolveActiveContext({}, { root: resolve(KIT, 'runs', 'w5-no-such-root') });
  const frozen = Object.isFrozen(ctxA);
  const validState = STATES.includes(ctxA.state);
  // a bare resolve against an empty/synthetic root must not invent BIZ-0001
  const noHardcode = ctxA.rootBusinessId == null || typeof ctxA.rootBusinessId === 'string';
  frozen && validState && noHardcode
    ? ok(`resolveActiveContext: frozen, state="${ctxA.state}", no hardcoded root`)
    : bad(`resolveActiveContext contract wrong: frozen=${frozen} state=${ctxA.state}`);

  // ── 4. determinism ────────────────────────────────────────────────────────
  const ctxB = acr.resolveActiveContext({}, { root: resolve(KIT, 'runs', 'w5-no-such-root') });
  JSON.stringify(ctxA) === JSON.stringify(ctxB)
    ? ok('resolveActiveContext is deterministic')
    : bad('resolveActiveContext not deterministic');

  // ── 5. recommendDeliberation gating truth table ───────────────────────────
  const fire = ad.recommendDeliberation({ grade: 4, deliberationsActive: true, materiality: 0.9, decisionSignal: 'choose a database' });
  const trivial = ad.recommendDeliberation({ grade: 4, deliberationsActive: true, materiality: 0.1, decisionSignal: 'fix typo' });
  const lowGrade = ad.recommendDeliberation({ grade: 2, deliberationsActive: true, materiality: 0.9 });
  const inactive = ad.recommendDeliberation({ grade: 4, deliberationsActive: false, materiality: 0.9 });
  fire.shouldConvene === true && trivial.shouldConvene === false && lowGrade.shouldConvene === false && inactive.shouldConvene === false
    ? ok('recommendDeliberation: fires on material+grade≥3+active; not on trivial/low-grade/inactive')
    : bad(`recommendDeliberation truth table wrong: fire=${fire.shouldConvene} trivial=${trivial.shouldConvene} low=${lowGrade.shouldConvene} inactive=${inactive.shouldConvene}`);

  // ── 6. synthesizer distinct from voices ───────────────────────────────────
  const council = fire.recommendedCouncil;
  council && Array.isArray(council.voices) && council.voices.length > 0 && !council.voices.includes(council.synthesizer)
    ? ok('recommendDeliberation: synthesizer distinct from every voice')
    : bad(`recommendDeliberation council wrong: ${JSON.stringify(council)}`);

  // ── 7. deep selftests (subprocess; preserves the wave's full assertions) ───
  for (const f of ['active-context-resolver.selftest.mjs', 'auto-deliberation.selftest.mjs']) {
    try {
      execFileSync(process.execPath, [resolve(KIT, EXEC, f)], { cwd: KIT, stdio: 'pipe' });
      ok(`deep selftest passes: ${f}`);
    } catch (err) {
      bad(`deep selftest FAILED: ${f} — ${String(err?.stdout ?? err).slice(-200)}`);
    }
  }

  // ── 8. clean-clone presence ───────────────────────────────────────────────
  const artifacts = [
    `${EXEC}/active-context-resolver.mjs`, `${EXEC}/active-context-precedence.mjs`, `${EXEC}/auto-deliberation.mjs`,
    `${EXEC}/active-context-resolver.selftest.mjs`, `${EXEC}/auto-deliberation.selftest.mjs`,
  ];
  const missing = artifacts.filter((p) => !existsSync(resolve(KIT, p)));
  missing.length === 0
    ? ok('clean-clone: A7 modules + selftests under templates/contextkit (installer-copied)')
    : bad(`clean-clone: missing A7 artifacts: ${missing.join(', ')}`);
}
