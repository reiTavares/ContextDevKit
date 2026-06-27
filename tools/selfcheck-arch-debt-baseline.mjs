#!/usr/bin/env node
/**
 * WF-0057 W3 (ADR-0122) — selftest for the baseline & ratchet classifier.
 * Asserts the DELTA-evaluation contract (§25/§26): unchanged legacy debt does
 * NOT block unrelated work (§34.15); worsened legacy debt may block/review
 * (§34.16); a newly INTRODUCED violation blocks (§34); debt repayment is recorded
 * as positive evidence (§34.17); a TRANSFERRED (moved) finding is flagged for
 * analysis; evaluation is scoped to changed files (an untouched large legacy file
 * is PRE_EXISTING → REPORT).
 * Zero-dep, node:/relative only, Windows-safe. Standalone entrypoint (exit 0/1).
 */
import { resolve } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dir = resolve(fileURLToPath(import.meta.url), '..');
const KIT = resolve(__dir, '..');
let passes = 0, failures = 0;
const ok = (m) => { passes++; console.log('  ok ' + m); };
const bad = (m) => { failures++; console.error('  XX ' + m); };

const SCRIPTS = 'templates/contextkit/tools/scripts/arch-debt';
const ratchetPath = resolve(KIT, SCRIPTS + '/baseline-ratchet.mjs');
const findingPath = resolve(KIT, SCRIPTS + '/finding.mjs');
existsSync(ratchetPath) ? ok('baseline-ratchet.mjs exists') : bad('baseline-ratchet.mjs NOT FOUND');

let mod, fmod;
try {
  mod = await import(pathToFileURL(ratchetPath).href);
  fmod = await import(pathToFileURL(findingPath).href);
} catch (err) {
  bad('Failed to import: ' + (err && err.message || err));
  console.error('Aborting.');
  process.exit(1);
}
const { classifyAgainstBaseline, applyRatchet, positiveEvidence, scopeToChanged, stableKey } = mod;
const { makeFinding, BaselineClass } = fmod;

for (const [n, f] of [
  ['classifyAgainstBaseline', classifyAgainstBaseline], ['applyRatchet', applyRatchet],
  ['positiveEvidence', positiveEvidence], ['scopeToChanged', scopeToChanged], ['stableKey', stableKey],
]) {
  typeof f === 'function' ? ok(n + ' exported as function') : bad(n + ' not a function');
}

// --- Fixtures: a small legacy baseline + a proposed-result set. ----------------
// makeFinding does not carry a `symbol` field; the ratchet keys off whatever
// is present, so we attach `symbol` to the validated finding for move-detection.
const mk = (over) => {
  const f = makeFinding({
    id: over.id ?? `${over.ruleId}:${over.path}:${over.line ?? 'file'}`,
    ruleId: over.ruleId, path: over.path, line: over.line, status: over.status ?? 'VIOLATION',
    message: over.message ?? '',
    ...(over.evidence ? { evidence: over.evidence } : {}),
  });
  return over.symbol ? { ...f, symbol: over.symbol } : f;
};

// Baseline: a big legacy file with a line-budget smell + a forbidden cycle.
const legacyBig = mk({ ruleId: 'line-budget', path: 'src/legacy/huge.js', line: 600, status: 'OBSERVATION', message: '600 lines' });
const legacyCycle = mk({ ruleId: 'forbidden-cycle', path: 'src/legacy/a.js', status: 'VIOLATION', message: 'a→b→a' });
const legacyBoundary = mk({ ruleId: 'boundary-violation', path: 'src/legacy/b.js', symbol: 'reachInternals', status: 'WARNING', message: 'deep import' });
const baseline = [legacyBig, legacyCycle, legacyBoundary];

console.log('\n§34.15 — unchanged legacy debt does NOT block unrelated work');
{
  // Developer touches ONLY an unrelated new file; legacy smells persist verbatim.
  const newWork = mk({ ruleId: 'naming', path: 'src/feature/new.js', line: 4, status: 'OBSERVATION', message: 'tmp var' });
  const current = [legacyBig, legacyCycle, legacyBoundary, newWork];
  const classified = classifyAgainstBaseline(current, baseline);
  const bigEntry = classified.find((c) => c.finding.path === 'src/legacy/huge.js');
  bigEntry && bigEntry.delta === BaselineClass.PRE_EXISTING ? ok('unchanged legacy huge.js → PRE_EXISTING') : bad('legacy delta: ' + (bigEntry && bigEntry.delta));
  const ruled = applyRatchet(classified, { changedSet: ['src/feature/new.js'] });
  const bigRuled = ruled.find((r) => r.finding.path === 'src/legacy/huge.js');
  const cycleRuled = ruled.find((r) => r.finding.path === 'src/legacy/a.js');
  bigRuled && bigRuled.disposition === 'REPORT' ? ok('unchanged legacy → REPORT (not blocking)') : bad('legacy disposition: ' + (bigRuled && bigRuled.disposition));
  cycleRuled && cycleRuled.disposition === 'REPORT' ? ok('out-of-scope legacy VIOLATION demoted to REPORT') : bad('legacy cycle disposition: ' + (cycleRuled && cycleRuled.disposition));
  const anyBlock = ruled.some((r) => r.disposition === 'BLOCK' || r.disposition === 'REVIEW');
  anyBlock === false ? ok('NO finding blocks/reviews when only unrelated work changed (§34.15)') : bad('unrelated work was blocked!');
}

console.log('\n§34.16 — worsened legacy debt may block/review');
{
  // Same legacy file, but the smell got WORSE (OBSERVATION → VIOLATION) AND it
  // is now in the changed set (the dev edited it).
  const worsened = mk({ ruleId: 'line-budget', path: 'src/legacy/huge.js', line: 900, status: 'VIOLATION', message: '900 lines' });
  const current = [worsened, legacyCycle, legacyBoundary];
  const classified = classifyAgainstBaseline(current, baseline);
  const w = classified.find((c) => c.finding.path === 'src/legacy/huge.js');
  w && w.delta === BaselineClass.WORSENED ? ok('legacy smell got worse → WORSENED') : bad('worsened delta: ' + (w && w.delta));
  const ruled = applyRatchet(classified, { changedSet: ['src/legacy/huge.js'] });
  const wr = ruled.find((r) => r.finding.path === 'src/legacy/huge.js');
  wr && wr.disposition === 'REVIEW' ? ok('worsened + in-scope + unacceptable → REVIEW (§34.16)') : bad('worsened disposition: ' + (wr && wr.disposition));
}

console.log('\n§34 — a newly INTRODUCED violation blocks');
{
  const introduced = mk({ ruleId: 'forbidden-cycle', path: 'src/feature/new.js', status: 'VIOLATION', message: 'new→x→new' });
  const current = [...baseline, introduced];
  const classified = classifyAgainstBaseline(current, baseline);
  const intro = classified.find((c) => c.finding.path === 'src/feature/new.js');
  intro && intro.delta === BaselineClass.INTRODUCED ? ok('new finding → INTRODUCED') : bad('introduced delta: ' + (intro && intro.delta));
  const ruled = applyRatchet(classified, { changedSet: ['src/feature/new.js'] });
  const ir = ruled.find((r) => r.finding.path === 'src/feature/new.js');
  ir && ir.disposition === 'BLOCK' ? ok('introduced + unacceptable + in-scope → BLOCK (§34)') : bad('introduced disposition: ' + (ir && ir.disposition));
  // And an INTRODUCED-but-acceptable (non-violation) new finding only REPORTs.
  const introObs = mk({ ruleId: 'naming', path: 'src/feature/new2.js', line: 1, status: 'OBSERVATION' });
  const ruled2 = applyRatchet(classifyAgainstBaseline([...baseline, introObs], baseline), { changedSet: ['src/feature/new2.js'] });
  const ir2 = ruled2.find((r) => r.finding.path === 'src/feature/new2.js');
  ir2 && ir2.disposition === 'REPORT' ? ok('introduced + acceptable → REPORT (only violations block)') : bad('introduced-acceptable disposition: ' + (ir2 && ir2.disposition));
}

console.log('\n§34.17 — debt repayment recorded as positive evidence');
{
  // The forbidden cycle in a.js was REMOVED but the file is STILL analysed (it
  // now carries only a minor naming smell) → REDUCED. The boundary smell file
  // b.js was DELETED entirely → PAID.
  const aResidual = mk({ ruleId: 'naming', path: 'src/legacy/a.js', line: 2, status: 'OBSERVATION', message: 'tmp' });
  const current = [legacyBig, aResidual]; // cycle gone (a.js still analysed); b.js gone
  const classified = classifyAgainstBaseline(current, baseline);
  const cycle = classified.find((c) => c.finding.ruleId === 'forbidden-cycle');
  const boundary = classified.find((c) => c.finding.ruleId === 'boundary-violation');
  cycle && cycle.delta === BaselineClass.REDUCED ? ok('removed cycle (file still analysed) → REDUCED') : bad('repaid cycle delta: ' + (cycle && cycle.delta));
  boundary && boundary.delta === BaselineClass.PAID ? ok('removed boundary (file gone) → PAID') : bad('repaid boundary delta: ' + (boundary && boundary.delta));
  const evidence = positiveEvidence(classified);
  evidence.length === 2 ? ok('positiveEvidence surfaces 2 repayments (§26)') : bad('positiveEvidence count: ' + evidence.length);
  evidence.some((e) => e.ruleId === 'forbidden-cycle' && e.delta === BaselineClass.REDUCED) ? ok('repayment carries ruleId + delta') : bad('repayment evidence shape wrong');
  const ruled = applyRatchet(classified, { changedSet: ['src/legacy/a.js', 'src/legacy/b.js'] });
  ruled.filter((r) => r.disposition === 'POSITIVE').length === 2 ? ok('repaid findings → POSITIVE disposition') : bad('POSITIVE count: ' + ruled.filter((r) => r.disposition === 'POSITIVE').length);
}

console.log('\nTRANSFERRED — a moved finding is flagged for analysis');
{
  // Same rule + symbol, NEW path → the debt moved rather than being introduced.
  const moved = mk({ ruleId: 'boundary-violation', path: 'src/feature/relocated.js', symbol: 'reachInternals', status: 'WARNING', message: 'deep import (moved)' });
  const current = [legacyBig, legacyCycle, moved]; // legacyBoundary's symbol now lives at a new path
  const classified = classifyAgainstBaseline(current, baseline);
  const t = classified.find((c) => c.finding.path === 'src/feature/relocated.js');
  t && t.delta === BaselineClass.TRANSFERRED ? ok('moved finding (same rule+symbol, new path) → TRANSFERRED') : bad('transferred delta: ' + (t && t.delta));
  // It must NOT also be counted as a repayment of the old location.
  const evidence = positiveEvidence(classified);
  evidence.some((e) => e.ruleId === 'boundary-violation') === false ? ok('transferred is NOT double-counted as repayment') : bad('transferred leaked into positive evidence');
  const ruled = applyRatchet(classified, { changedSet: ['src/feature/relocated.js'] });
  const tr = ruled.find((r) => r.finding.path === 'src/feature/relocated.js');
  tr && tr.disposition === 'ANALYZE' ? ok('transferred → ANALYZE (explicit analysis, §25)') : bad('transferred disposition: ' + (tr && tr.disposition));
}

console.log('\nScope — evaluation scoped to changed files (untouched large legacy → PRE_EXISTING/REPORT)');
{
  // A genuinely worse legacy violation, but the dev did NOT touch that file.
  const worsenedButUntouched = mk({ ruleId: 'line-budget', path: 'src/legacy/huge.js', line: 999, status: 'VIOLATION', message: 'still huge' });
  const current = [worsenedButUntouched, legacyCycle, legacyBoundary];
  const classified = classifyAgainstBaseline(current, baseline);
  const ruled = applyRatchet(classified, { changedSet: ['src/feature/elsewhere.js'] });
  const hugeRuled = ruled.find((r) => r.finding.path === 'src/legacy/huge.js');
  hugeRuled && hugeRuled.inScope === false ? ok('untouched legacy file marked out-of-scope') : bad('huge.js inScope: ' + (hugeRuled && hugeRuled.inScope));
  hugeRuled && hugeRuled.disposition === 'REPORT' ? ok('untouched worsened legacy demoted to REPORT (does not block unrelated work)') : bad('untouched disposition: ' + (hugeRuled && hugeRuled.disposition));
  // scopeToChanged helper filters correctly.
  const scoped = scopeToChanged(current, ['src/legacy/a.js']);
  scoped.length === 1 && scoped[0].path === 'src/legacy/a.js' ? ok('scopeToChanged filters to changed files') : bad('scopeToChanged returned ' + scoped.length + ' findings');
  scopeToChanged(current, []).length === current.length ? ok('empty changedSet → no scoping (fail-open)') : bad('empty changedSet over-filtered');
}

console.log('\nstableKey + defensive input');
{
  stableKey({ ruleId: 'r', path: 'a\\b\\c.js', line: 5 }) === 'r::a/b/c.js' ? ok('stableKey normalises backslashes + IGNORES line (line is the measure, not identity)') : bad('stableKey: ' + stableKey({ ruleId: 'r', path: 'a\\b\\c.js', line: 5 }));
  stableKey({ ruleId: 'r', path: 'p', symbol: 'fn' }) === 'r::p::fn' ? ok('stableKey adds symbol anchor when present') : bad('symbol anchor wrong');
  Array.isArray(classifyAgainstBaseline(null, null)) ? ok('classifyAgainstBaseline(null,null) → [] (defensive)') : bad('null input crashed');
  Array.isArray(applyRatchet(null)) ? ok('applyRatchet(null) → [] (defensive)') : bad('applyRatchet(null) crashed');
  // Missing baseline → everything is INTRODUCED (no silent pass).
  const noBase = classifyAgainstBaseline([legacyCycle], []);
  noBase[0].delta === BaselineClass.INTRODUCED ? ok('no baseline → INTRODUCED (never silent pass)') : bad('no-baseline delta: ' + noBase[0].delta);
}

console.log('\nzero-dep invariant');
{
  const content = readFileSync(ratchetPath, 'utf-8');
  const re = /^import\s+(?:[^"'`]*\s+)?from\s+['"`]([^'"`]+)['"`]/gm;
  let m, dirty = null;
  while ((m = re.exec(content)) !== null) {
    if (!m[1].startsWith('.') && !m[1].startsWith('node:')) { dirty = m[1]; break; }
  }
  dirty === null ? ok('zero-dep: baseline-ratchet.mjs imports only node:/relative') : bad('zero-dep violation: imports ' + dirty);
}

console.log('\n' + (passes + failures) + ' checks -- ' + passes + ' pass / ' + failures + ' fail');
if (failures > 0) { console.error('\nFAIL'); process.exit(1); }
console.log('\nPASS');
process.exit(0);
