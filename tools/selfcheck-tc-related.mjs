/**
 * Self-check — Task-Compiler related-slice (WF0022 / ADR-0087..0090).
 *
 * Verifies the slice + closure surface exported by
 * `templates/contextkit/tools/scripts/economy/tc-related.mjs`:
 *   1. TC_RELATED_SCHEMA_VERSION === 'cdk-tc-related/1'.
 *   2. Closed slice → coverage 'full', closed: true.
 *   3. Slice missing an out-of-slice symbol → coverage 'partial', closed: false,
 *      missing populated (false-negative guard).
 *   4. Source file contains the required consumes comment header.
 *   5. Zero hot-path dep invariant (no non-node:/* or non-relative imports).
 *   6. presentRelated renders key fields for a valid slice.
 *   7. presentRelated handles invalid input gracefully.
 *   8. closureGuard throws typed error on invalid input.
 *   9. relatedSlice throws typed error on missing targetPath.
 *
 * ADR-0087. Zero runtime dependencies — node:* only.
 */
import { readFile }                    from 'node:fs/promises';
import { resolve, dirname }            from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Checks that a module file imports only node:/* and relative paths.
 * @param {string} modPath
 * @returns {Promise<{error:string|null}>}
 */
async function checkModuleZeroDep(modPath) {
  let content = '';
  try { content = await readFile(modPath, 'utf-8'); } catch (err) {
    return { error: `could not read: ${err?.message ?? err}` };
  }
  const importRegex = /^import\s+(?:[^"'`]*\s+)?from\s+['"`]([^'"`]+)['"`]/gm;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const spec = match[1];
    if (!spec.startsWith('.') && !spec.startsWith('node:')) {
      return { error: `imports from "${spec}"` };
    }
  }
  return { error: null };
}

/**
 * Build a minimal in-memory modules fixture for closure tests.
 * Layout:
 *   moduleA — defines symbols: 'alpha', 'beta'  (in-slice)
 *   moduleB — defines symbols: 'gamma'           (out-of-slice, for partial test)
 * @returns {Array<object>}
 */
function buildFixtureModules() {
  return [
    {
      path:    'moduleA',
      role:    'backend',
      files:   2,
      bytes:   400,
      capped:  false,
      deps:    [],
      symbols: [
        { file: 'moduleA/index.mjs', name: 'alpha' },
        { file: 'moduleA/helpers.mjs', name: 'beta' },
      ],
    },
    {
      path:    'moduleB',
      role:    'backend',
      files:   1,
      bytes:   200,
      capped:  false,
      deps:    ['moduleA'],
      symbols: [
        { file: 'moduleB/main.mjs', name: 'gamma' },
      ],
    },
  ];
}

// ---------------------------------------------------------------------------
// Exported runner
// ---------------------------------------------------------------------------

/**
 * Runs Task-Compiler related-slice self-checks.
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} reporter
 * @param {{ KIT: string }} ctx - repo root
 */
export async function runTcRelatedChecks({ ok, bad }, { KIT }) {
  console.log('Checking Task-Compiler related-slice (WF0022)...');

  const modPath = resolve(KIT, 'templates/contextkit/tools/scripts/economy/tc-related.mjs');
  let lib;
  try {
    lib = await import(pathToFileURL(modPath).href);
    ok('tc-related.mjs imports cleanly');
  } catch (err) {
    bad(`tc-related.mjs import failed: ${err?.message ?? err}`);
    return;
  }

  const {
    TC_RELATED_SCHEMA_VERSION,
    relatedSlice,
    closureGuard,
    presentRelated,
  } = lib;

  // ── 1. Schema version ─────────────────────────────────────────────────────
  TC_RELATED_SCHEMA_VERSION === 'cdk-tc-related/1'
    ? ok('schema version is "cdk-tc-related/1"')
    : bad(`schema version wrong: ${TC_RELATED_SCHEMA_VERSION}`);

  const fixtureModules = buildFixtureModules();

  // ── 2. Closed slice → coverage 'full', closed: true ──────────────────────
  const closedSlice = {
    files:       ['moduleA'],
    symbols:     fixtureModules[0].symbols,
    _modules:    fixtureModules,
    _slicePaths: new Set(['moduleA']),
  };
  const closedGuard = closureGuard(closedSlice);
  closedGuard.closed === true && closedGuard.coverage === 'full'
    ? ok('closed slice: coverage=full, closed=true')
    : bad(`closed slice wrong: closed=${closedGuard.closed} coverage=${closedGuard.coverage}`);
  closedGuard.missing.length === 0
    ? ok('closed slice: missing array is empty')
    : bad(`closed slice: missing should be empty, got ${JSON.stringify(closedGuard.missing)}`);

  // ── 3. Partial slice → coverage 'partial', closed: false, missing populated
  const partialSlice = {
    files:       ['moduleB'],
    symbols:     [
      { file: 'moduleB/main.mjs', name: 'gamma' },  // owned by moduleB  → OK
      { file: 'moduleB/main.mjs', name: 'alpha' },  // owned by moduleA  → MISSING
    ],
    _modules:    fixtureModules,
    _slicePaths: new Set(['moduleB']),
  };
  const partialGuard = closureGuard(partialSlice);
  partialGuard.closed === false && partialGuard.coverage === 'partial'
    ? ok('partial slice: coverage=partial, closed=false (false-negative guard)')
    : bad(`partial slice wrong: closed=${partialGuard.closed} coverage=${partialGuard.coverage}`);
  partialGuard.missing.includes('alpha')
    ? ok('partial slice: missing includes "alpha" (defined outside slice)')
    : bad(`partial slice: "alpha" should be in missing, got ${JSON.stringify(partialGuard.missing)}`);

  // ── 4. consumes comment header present in source ──────────────────────────
  const srcContent = await readFile(modPath, 'utf-8');
  srcContent.includes('// consumes: project-map-core,project-map-symbols,project-map-insights')
    ? ok('source contains "// consumes: project-map-core,project-map-symbols,project-map-insights"')
    : bad('source missing required consumes comment');

  // ── 5. Zero hot-path dep invariant ───────────────────────────────────────
  const depResult = await checkModuleZeroDep(modPath);
  depResult.error === null
    ? ok('zero-dep invariant: tc-related.mjs imports only node:/* or relative paths')
    : bad(`zero-dep invariant: tc-related.mjs ${depResult.error}`);

  // ── 6. presentRelated — renders key fields ───────────────────────────────
  const sampleResult = Object.freeze({
    schemaVersion: 'cdk-tc-related/1',
    target:        'moduleA',
    files:         Object.freeze(['moduleA']),
    symbols:       Object.freeze([{ file: 'moduleA/index.mjs', name: 'alpha' }]),
    subgraph:      null,
    coverage:      'full',
    closure:       true,
    confidence:    'derived',
    reasons:       Object.freeze(['target: moduleA']),
  });
  const rendered = presentRelated(sampleResult);
  const hasAllKeys = rendered.includes('cdk-tc-related/1')
    && rendered.includes('moduleA')
    && rendered.includes('full')
    && rendered.includes('derived');
  hasAllKeys
    ? ok('presentRelated: rendered string contains schemaVersion, target, coverage, confidence')
    : bad(`presentRelated: missing expected fields:\n${rendered}`);

  // ── 7. presentRelated — graceful on invalid input ────────────────────────
  const invalidStr = presentRelated(null);
  invalidStr === 'related-slice: invalid'
    ? ok('presentRelated: null returns "related-slice: invalid"')
    : bad(`presentRelated: invalid input render wrong: "${invalidStr}"`);

  // ── 8. closureGuard throws TypeError on invalid input ────────────────────
  let guardThrew = false;
  try { closureGuard(null); } catch (err) { guardThrew = err instanceof TypeError; }
  guardThrew
    ? ok('closureGuard: throws TypeError on null input')
    : bad('closureGuard: should throw TypeError on null input');

  // ── 9. relatedSlice throws TypeError on empty targetPath ─────────────────
  let sliceThrew = false;
  try { relatedSlice('', { modules: fixtureModules }); } catch (err) {
    sliceThrew = err instanceof TypeError;
  }
  sliceThrew
    ? ok('relatedSlice: throws TypeError on empty targetPath')
    : bad('relatedSlice: should throw TypeError on empty targetPath');
}

// ---------------------------------------------------------------------------
// Standalone guard — mirrors selfcheck-tc-packet.mjs pattern
// ---------------------------------------------------------------------------

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let failures = 0;
  const ok  = (_m) => {};
  const bad = (m) => { failures++; console.error(`FAIL: ${m}`); };
  const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  runTcRelatedChecks({ ok, bad }, { KIT })
    .then(() => process.exit(failures ? 1 : 0))
    .catch((err) => { console.error('selfcheck-tc-related: unexpected error:', err); process.exit(1); });
}
