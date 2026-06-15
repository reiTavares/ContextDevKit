#!/usr/bin/env node
/**
 * CDK-068 self-check — wiring-drift-core.mjs (PKG-06).
 *
 * WHY: wiring-drift-core.mjs (CDK-068) introduces three pure compare functions
 * for detecting drift between installed artifacts and source expectations. This
 * suite asserts EXACT return shapes on hermetic inputs — no installed files
 * needed, no I/O.
 *
 * Invariants verified:
 *   (a) diffWiring — missing scripts detected; no false-positives on matching sets.
 *   (b) diffWiring — unexpected scripts detected; both directions in one call.
 *   (c) diffWiring — symmetric empty sets → no drift.
 *   (d) diffWiring — correct when sets are completely disjoint.
 *   (e) checkInstructionMarkers — missing marker detected.
 *   (f) checkInstructionMarkers — present marker not flagged as missing.
 *   (g) checkInstructionMarkers — multiple markers, some present, some missing.
 *   (h) checkInstructionMarkers — empty required list → no missing.
 *   (i) diffConfigKeys — unknown keys detected.
 *   (j) diffConfigKeys — missing keys detected.
 *   (k) diffConfigKeys — identical sets → no drift.
 *
 * Standalone: node tools/selfcheck-pkg06-068.mjs
 * Exit 0 = PASS, exit 1 = FAIL.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CORE_PATH = resolve(__dirname, '../templates/contextkit/tools/scripts/wiring-drift-core.mjs');

// ---------------------------------------------------------------------------
// Import the module under test
// ---------------------------------------------------------------------------
let diffWiring, diffConfigKeys, checkInstructionMarkers;
try {
  ({ diffWiring, diffConfigKeys, checkInstructionMarkers } =
    await import(pathToFileURL(CORE_PATH).href));
} catch (err) {
  console.error(`FATAL: cannot import wiring-drift-core.mjs: ${err?.message ?? err}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Micro-assertion harness (mirrors selfcheck-pkg05-050 pattern)
// ---------------------------------------------------------------------------
let failures = 0;
const ok  = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => { console.error(`  ✗ ${msg}`); failures += 1; };

/**
 * @param {string} label
 * @param {boolean} condition
 */
function assert(label, condition) {
  condition ? ok(label) : bad(label);
}

/**
 * Deep-equals two sorted string arrays (order-insensitive comparison via sort).
 *
 * @param {string[]} actual
 * @param {string[]} expected
 * @returns {boolean}
 */
function arraysEqual(actual, expected) {
  if (actual.length !== expected.length) return false;
  const a = [...actual].sort();
  const e = [...expected].sort();
  return a.every((v, i) => v === e[i]);
}

// ---------------------------------------------------------------------------
// (a) diffWiring — missing scripts
// ---------------------------------------------------------------------------
console.log('\n(a) diffWiring — missing scripts\n');

{
  const result = diffWiring(new Set(['a', 'b']), new Set(['a']));
  assert('diffWiring({a,b}, {a}) → missing:[b]', arraysEqual(result.missing, ['b']));
  assert('diffWiring({a,b}, {a}) → unexpected:[]', arraysEqual(result.unexpected, []));
}

// ---------------------------------------------------------------------------
// (b) diffWiring — unexpected scripts
// ---------------------------------------------------------------------------
console.log('\n(b) diffWiring — unexpected scripts\n');

{
  const result = diffWiring(new Set(['a']), new Set(['a', 'c']));
  assert('diffWiring({a}, {a,c}) → missing:[]', arraysEqual(result.missing, []));
  assert('diffWiring({a}, {a,c}) → unexpected:[c]', arraysEqual(result.unexpected, ['c']));
}

// ---------------------------------------------------------------------------
// (c) diffWiring — identical sets → no drift
// ---------------------------------------------------------------------------
console.log('\n(c) diffWiring — identical sets\n');

{
  const scripts = new Set(['session-start.mjs', 'track-edits.mjs', 'check-registration.mjs']);
  const result = diffWiring(scripts, new Set(scripts));
  assert('diffWiring(same, same) → missing:[]', arraysEqual(result.missing, []));
  assert('diffWiring(same, same) → unexpected:[]', arraysEqual(result.unexpected, []));
}

// ---------------------------------------------------------------------------
// (d) diffWiring — completely disjoint sets
// ---------------------------------------------------------------------------
console.log('\n(d) diffWiring — completely disjoint sets\n');

{
  const result = diffWiring(new Set(['x.mjs', 'y.mjs']), new Set(['p.mjs', 'q.mjs']));
  assert('disjoint → missing includes x.mjs', result.missing.includes('x.mjs'));
  assert('disjoint → missing includes y.mjs', result.missing.includes('y.mjs'));
  assert('disjoint → unexpected includes p.mjs', result.unexpected.includes('p.mjs'));
  assert('disjoint → unexpected includes q.mjs', result.unexpected.includes('q.mjs'));
  assert('disjoint → missing.length === 2', result.missing.length === 2);
  assert('disjoint → unexpected.length === 2', result.unexpected.length === 2);
}

// ---------------------------------------------------------------------------
// (e) checkInstructionMarkers — missing marker detected
// ---------------------------------------------------------------------------
console.log('\n(e) checkInstructionMarkers — missing marker\n');

{
  const result = checkInstructionMarkers('# Title\n', ['## Stack']);
  assert("missing('## Stack') → missing:['## Stack']", arraysEqual(result.missing, ['## Stack']));
}

// ---------------------------------------------------------------------------
// (f) checkInstructionMarkers — present marker not flagged
// ---------------------------------------------------------------------------
console.log('\n(f) checkInstructionMarkers — present marker\n');

{
  const result = checkInstructionMarkers('## Stack\nSome content\n', ['## Stack']);
  assert("present('## Stack') → missing:[]", arraysEqual(result.missing, []));
}

// ---------------------------------------------------------------------------
// (g) checkInstructionMarkers — multiple markers, partial presence
// ---------------------------------------------------------------------------
console.log('\n(g) checkInstructionMarkers — partial presence\n');

{
  const text = '# Title\n## Stack\nSome stack content\n';
  const markers = ['## Stack', '## ⛔ Immutable rules', '## 🤖 ContextDevKit'];
  const result = checkInstructionMarkers(text, markers);
  assert('partial: missing length === 2', result.missing.length === 2);
  assert("partial: missing includes '## ⛔ Immutable rules'", result.missing.includes('## ⛔ Immutable rules'));
  assert("partial: missing includes '## 🤖 ContextDevKit'", result.missing.includes('## 🤖 ContextDevKit'));
  assert("partial: does NOT include '## Stack'", !result.missing.includes('## Stack'));
}

// ---------------------------------------------------------------------------
// (h) checkInstructionMarkers — empty required list
// ---------------------------------------------------------------------------
console.log('\n(h) checkInstructionMarkers — empty markers list\n');

{
  const result = checkInstructionMarkers('anything goes here', []);
  assert('empty markers → missing:[]', arraysEqual(result.missing, []));
}

// ---------------------------------------------------------------------------
// (i) diffConfigKeys — unknown keys detected
// ---------------------------------------------------------------------------
console.log('\n(i) diffConfigKeys — unknown keys\n');

{
  const result = diffConfigKeys(new Set(['level', 'custom']), new Set(['level']));
  assert('unknown:[custom]', arraysEqual(result.unknown, ['custom']));
  assert('missing:[] (level is present)', arraysEqual(result.missing, []));
}

// ---------------------------------------------------------------------------
// (j) diffConfigKeys — missing keys detected
// ---------------------------------------------------------------------------
console.log('\n(j) diffConfigKeys — missing keys\n');

{
  const result = diffConfigKeys(new Set(['level']), new Set(['level', 'autonomy']));
  assert('missing:[autonomy]', arraysEqual(result.missing, ['autonomy']));
  assert('unknown:[] (level is known)', arraysEqual(result.unknown, []));
}

// ---------------------------------------------------------------------------
// (k) diffConfigKeys — identical sets → no drift
// ---------------------------------------------------------------------------
console.log('\n(k) diffConfigKeys — identical sets\n');

{
  const keys = new Set(['level', 'autonomy', 'ledger']);
  const result = diffConfigKeys(new Set(keys), new Set(keys));
  assert('identical → unknown:[]', arraysEqual(result.unknown, []));
  assert('identical → missing:[]', arraysEqual(result.missing, []));
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(
  failures === 0
    ? '\n  PASS — CDK-068 wiring-drift-core self-check: all checks passed.\n'
    : `\n  FAIL — CDK-068 wiring-drift-core self-check: ${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
