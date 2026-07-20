/**
 * selfcheck-autonomy-posture.mjs — WF-0077 acceptance checks (BIZ-0005, ADR-0144).
 * Exports `runAutonomyPostureChecks({ ok, bad }, { KIT })` for the selfcheck hub
 * (mirrors selfcheck-madm.mjs); self-runs too (`node tools/selfcheck-autonomy-posture.mjs
 * <root>`) and exits non-zero on any bad, so a phantom pass cannot hide a failure.
 *
 * Proves: (1) the gate verdict is GRADE-BLIND BY CONSTRUCTION — `decide()` takes no
 * grade/autonomy input, so its verdict cannot vary by autonomy.grade; (2) decide() is
 * deterministic (identical input → byte-identical verdict); (3) the standing session
 * posture renders with the cross-squad obligation + a grade contract; (4) posture is
 * fail-open (bad root → '', no throw); (5) zero-config — the deprecated `l5.lineBudget`
 * alias is gone from the shipped defaults.
 *
 * Zero runtime deps beyond node:* + the modules under test.
 */
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { readFileSync } from 'node:fs';

const RT = 'templates/contextkit/runtime';

/**
 * @param {{ ok:(m:string)=>void, bad:(m:string)=>void }} counters
 * @param {{ KIT: string }} ctx  KIT = project/worktree root.
 */
export async function runAutonomyPostureChecks({ ok, bad }, { KIT }) {
  let enf; let signals; let defaults;
  try {
    enf = await import(pathToFileURL(resolve(KIT, RT, 'execution/enforcement-modes.mjs')).href);
    signals = await import(pathToFileURL(resolve(KIT, RT, 'hooks/autonomy-signals.mjs')).href);
    defaults = await import(pathToFileURL(resolve(KIT, RT, 'config/defaults.mjs')).href);
    ok('WF-0077 modules import cleanly (enforcement-modes, autonomy-signals, defaults)');
  } catch (err) {
    bad(`WF-0077 import failed: ${err?.message ?? err}`);
    return;
  }

  // (1) GRADE-BLIND BY CONSTRUCTION: decide()'s parameter object names no grade/autonomy.
  const src = readFileSync(resolve(KIT, RT, 'execution/enforcement-modes.mjs'), 'utf-8');
  const decideParams = (src.match(/export function decide\(\{([^}]*)\}/) || [])[1] || '';
  if (decideParams && !/grade|autonomy/i.test(decideParams)) {
    ok('(1) decide() is grade-blind by construction — no grade/autonomy in its signature');
  } else {
    bad(`(1) decide() signature references grade/autonomy (grade-blind invariant broken): "${decideParams.trim()}"`);
  }

  // (2) decide() determinism: identical input → byte-identical verdict (no grade to vary on).
  if (typeof enf.decide === 'function') {
    const input = { mode: 'guarded', contract: null, moment: 'beforeWrite', scope: { path: 'x.mjs' }, root: KIT, now: 1 };
    const a = JSON.stringify(enf.decide({ ...input }));
    const b = JSON.stringify(enf.decide({ ...input }));
    a === b
      ? ok('(2) decide() verdict is deterministic + byte-identical on identical input')
      : bad('(2) decide() verdict varied across identical calls (non-determinism)');
  } else {
    bad('(2) decide is not an exported function');
  }

  // (3) posture renders with the cross-squad obligation + a grade contract.
  if (typeof signals.renderSessionPosture === 'function') {
    const posture = signals.renderSessionPosture(KIT);
    const hasObligation = /ALL teams/i.test(posture) && /activate/i.test(posture);
    const hasGradeContract = /copilot|autopilot/i.test(posture);
    const doesNotSelect = !/lead=|reviewers=|council:/i.test(posture); // installs, never selects
    if (posture && hasObligation && hasGradeContract && doesNotSelect) {
      ok('(3) session posture installs the cross-squad obligation + grade contract, selects no council');
    } else {
      bad(`(3) posture incomplete: obligation=${hasObligation} gradeContract=${hasGradeContract} selectsNothing=${doesNotSelect}`);
    }
  } else {
    bad('(3) renderSessionPosture is not exported');
  }

  // (4) fail-open: a bad root yields '' and never throws.
  try {
    const empty = signals.renderSessionPosture(resolve(KIT, 'no-such-root-xyz'));
    typeof empty === 'string'
      ? ok('(4) posture fail-open: bad root → string (no throw)')
      : bad('(4) posture on bad root returned a non-string');
  } catch (err) {
    bad(`(4) posture threw on a bad root instead of failing open: ${err?.message ?? err}`);
  }

  // (5) zero-config: the deprecated l5.lineBudget alias is gone from shipped defaults.
  const cfg = defaults.DEFAULT_CONFIG || defaults.default || {};
  const alias = cfg?.l5?.lineBudget;
  alias === undefined
    ? ok('(5) zero-config: l5.lineBudget alias removed from shipped defaults')
    : bad(`(5) l5.lineBudget alias still shipped: ${JSON.stringify(alias)}`);
}

// --- self-run guard: prove the suite executes (no phantom pass) ------------------
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const KIT = process.argv[2] || process.cwd();
  let okN = 0; let badN = 0;
  const ok = (m) => { okN += 1; console.log(`  ok  ${m}`); };
  const bad = (m) => { badN += 1; console.log(`  BAD ${m}`); };
  await runAutonomyPostureChecks({ ok, bad }, { KIT });
  console.log(`\nselfcheck-autonomy-posture: ${okN} ok / ${badN} bad`);
  process.exit(badN === 0 ? 0 : 1);
}
