#!/usr/bin/env node
/**
 * CDK-050 self-check — project-map-roots.mjs (PKG-05, configurable roots/excludes).
 *
 * Verifies four invariants:
 *   (a) Default resolveRoots reproduces the current IGNORE_DIRS deep/rootRelative split.
 *   (b) Config overrides add a custom exclude and a custom root (additive, not replacive).
 *   (c) Dogfood case: 'templates/contextkit' is NOT excluded even though the bare
 *       basename 'contextkit' is in the root-relative defaults — because the path is
 *       NOT at depth-1 relative to the scan root.
 *   (d) Malformed config (non-array roots, null, garbage) falls back to defaults.
 *
 * Standalone runnable: node tools/selfcheck-pkg05-050.mjs
 * Exit 0 on all-pass, exit 1 on any failure.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOTS_MODULE_PATH = resolve(__dirname, '../templates/contextkit/tools/scripts/project-map-roots.mjs');
const ROOTS_MODULE_URL = pathToFileURL(ROOTS_MODULE_PATH).href;

let failures = 0;
const ok  = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => { console.error(`  ✗ ${msg}`); failures += 1; };

// ---------------------------------------------------------------------------
// Import the module under test
// ---------------------------------------------------------------------------
let defaultExcludes, resolveRoots;
try {
  ({ defaultExcludes, resolveRoots } = await import(ROOTS_MODULE_URL));
} catch (err) {
  console.error(`FATAL: cannot import project-map-roots.mjs: ${err?.message ?? err}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// (a) Default excludes reproduce the canonical IGNORE_DIRS set from core
// ---------------------------------------------------------------------------
console.log('\n(a) Default exclude catalogue matches project-map-core IGNORE_DIRS\n');

/** The exact set from project-map-core.mjs (line 22-26) — kept as the reference. */
const EXPECTED_IGNORE_DIRS = new Set([
  'node_modules', '.git', '.hg', '.svn', 'dist', 'build', 'out', '.next', '.nuxt',
  '.turbo', '.expo', '.svelte-kit', 'coverage', '__pycache__', '.pytest_cache',
  'target', 'vendor', '.venv', 'venv', 'bin', 'obj', '.cache', '.idea', '.vscode',
  // NOTE: 'contextkit' moved to rootRelative in CDK-050 (dogfood fix)
  '.claude', '.agents', '.antigravity', '.tmp',
]);

const defExcludes = defaultExcludes();
// Everything in EXPECTED_IGNORE_DIRS must be covered by deep OR rootRelative.
const allDefaults = new Set([...defExcludes.deep, ...defExcludes.rootRelative]);
let missingFromDefault = 0;
for (const name of EXPECTED_IGNORE_DIRS) {
  if (!allDefaults.has(name)) {
    bad(`'${name}' from IGNORE_DIRS is missing in defaultExcludes`);
    missingFromDefault++;
  }
}
if (missingFromDefault === 0) ok('all IGNORE_DIRS names present in defaultExcludes (deep + rootRelative)');

// 'contextkit' must be in rootRelative (not deep) — that is the dogfood fix.
defExcludes.rootRelative.has('contextkit')
  ? ok("'contextkit' is in rootRelative (not deep) — dogfood fix active")
  : bad("'contextkit' should be in rootRelative, not deep");
defExcludes.deep.has('contextkit')
  ? bad("'contextkit' must NOT be in deep excludes after CDK-050")
  : ok("'contextkit' correctly absent from deep excludes");

// Default resolveRoots with no config → root '[.'], isExcluded('.git', '.git') = true
const defResolved = resolveRoots(null, '/fake/root');
Array.isArray(defResolved.roots) && defResolved.roots.length === 1 && defResolved.roots[0] === '.'
  ? ok("default roots = ['.']")
  : bad(`default roots should be ['.'], got ${JSON.stringify(defResolved.roots)}`);

// Spot-check: deep excludes work at any depth
defResolved.isExcluded('node_modules', 'node_modules')
  ? ok("isExcluded('node_modules', 'node_modules') = true (deep)")
  : bad("deep exclude 'node_modules' not matched");
defResolved.isExcluded('apps/node_modules', 'node_modules')
  ? ok("isExcluded('apps/node_modules', 'node_modules') = true (deep, nested)")
  : bad("deep exclude 'node_modules' not matched at nested depth");

// ---------------------------------------------------------------------------
// (b) Config overrides add an exclude and a root
// ---------------------------------------------------------------------------
console.log('\n(b) Config overrides are additive\n');

const cfgOverride = {
  projectMap: {
    roots: ['src', 'packages'],
    excludes: ['__generated__', 'storybook-static/'],
  },
};
const overrideResolved = resolveRoots(cfgOverride, '/fake/root');

JSON.stringify(overrideResolved.roots) === JSON.stringify(['src', 'packages'])
  ? ok("roots overridden to ['src', 'packages']")
  : bad(`roots not overridden correctly, got ${JSON.stringify(overrideResolved.roots)}`);

// '__generated__' is bare-name → deep
overrideResolved.excludes.deep.has('__generated__')
  ? ok("'__generated__' added to deep excludes")
  : bad("'__generated__' missing from deep excludes after config override");

// 'storybook-static/' ends with '/' → rootRelative (stripped to 'storybook-static')
overrideResolved.excludes.rootRelative.has('storybook-static')
  ? ok("'storybook-static' added to rootRelative excludes (trailing-slash form)")
  : bad("'storybook-static' missing from rootRelative after config override");

// Baseline defaults are still present (additive)
overrideResolved.excludes.deep.has('node_modules')
  ? ok("deep defaults retained after override (additive, not replacive)")
  : bad("deep defaults were wiped by config override");

// isExcluded works with the override
overrideResolved.isExcluded('__generated__', '__generated__')
  ? ok("isExcluded('__generated__', '__generated__') = true")
  : bad("custom deep exclude '__generated__' not matched by isExcluded");

// ---------------------------------------------------------------------------
// (c) Dogfood case: templates/contextkit is NOT excluded
// ---------------------------------------------------------------------------
console.log('\n(c) Dogfood self-map: templates/contextkit must NOT be excluded\n');

// Use default config (no override) — simulates the dogfood self-map scenario.
const dogfood = resolveRoots(null, '/fake/root');

// 'contextkit' at depth-1 (the installed platform folder) → MUST be excluded
dogfood.isExcluded('contextkit', 'contextkit')
  ? ok("isExcluded('contextkit', 'contextkit') = true  (installed platform dir skipped)")
  : bad("installed 'contextkit/' must be excluded by default");

// 'contextkit' nested inside 'templates/' → must NOT be excluded
dogfood.isExcluded('templates/contextkit', 'contextkit')
  ? bad("isExcluded('templates/contextkit', 'contextkit') = true — dogfood BUG still present!")
  : ok("isExcluded('templates/contextkit', 'contextkit') = false  (source tree scanned — dogfood fix working)");

// Another nested variant (extra depth)
dogfood.isExcluded('a/b/contextkit', 'contextkit')
  ? bad("isExcluded('a/b/contextkit', 'contextkit') = true — deep exclude wrongly applied")
  : ok("isExcluded('a/b/contextkit', 'contextkit') = false  (nested, 3-deep, correctly not excluded)");

// ---------------------------------------------------------------------------
// (d) Malformed config → falls back to defaults (fail-open)
// ---------------------------------------------------------------------------
console.log('\n(d) Malformed config degrades gracefully to defaults\n');

const malformedInputs = [
  [null,                         'null config'],
  [undefined,                    'undefined config'],
  [{},                           'empty object config'],
  [{ projectMap: null },         'projectMap: null'],
  [{ projectMap: 'garbage' },    'projectMap: string'],
  [{ projectMap: { roots: 'x', excludes: 42 } }, 'roots: string, excludes: number'],
  [{ projectMap: { roots: [123] } }, 'roots: non-string element'],
];

for (const [cfg, label] of malformedInputs) {
  try {
    const result = resolveRoots(cfg, '/fake/root');
    const rootsOk = Array.isArray(result.roots) && result.roots.length > 0;
    const isExcFn = typeof result.isExcluded === 'function';
    const deepHas = result.excludes?.deep?.has('node_modules');
    const noThrow = true; // we got here
    (rootsOk && isExcFn && deepHas && noThrow)
      ? ok(`malformed (${label}) → safe defaults returned, no throw`)
      : bad(`malformed (${label}) → returned unexpected shape`);
  } catch (err) {
    bad(`malformed (${label}) → threw: ${err?.message ?? err}`);
  }
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(
  failures === 0
    ? '\n  PASS — CDK-050 project-map-roots self-check: all checks passed.\n'
    : `\n  FAIL — CDK-050 project-map-roots self-check: ${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
