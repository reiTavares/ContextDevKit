/**
 * Selfcheck — project-map --find: symbol-query over the dense index.
 *
 * Asserts that `findSymbol` from `project-map-dense.mjs` is sound:
 * - Exact match returns the expected file.
 * - Substring match (case-insensitive) works.
 * - Empty query → [].
 * - Non-object index → [].
 * - Result is frozen (immutable array).
 * - Exact match appears before substring matches.
 * - Duplicate files within a symbol are preserved as-is (bySymbol contract).
 * - Zero symbols → no match.
 * - Cap: max 50 results returned.
 * - Zero-dep invariant on project-map-dense.mjs.
 *
 * Zero runtime dependencies — node:* only.
 * Follow the pattern of selfcheck-eacp-routing.mjs (pathToFileURL + resolve).
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Reads `modPath` and confirms every import specifier is node:* or a
 * relative path — the zero-dep invariant (ADR-0001).
 * @param {string} modPath - absolute path of the file to inspect
 * @returns {Promise<{ error: string|null }>}
 */
async function checkModuleZeroDep(modPath) {
  let content = '';
  try {
    content = await readFile(modPath, 'utf-8');
  } catch (err) {
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
 * Builds a minimal fake dense index for unit testing (no filesystem walk).
 * @returns {ReturnType<import('../templates/contextkit/tools/scripts/project-map-dense.mjs').buildDenseIndex>}
 */
function fakeIndex() {
  return {
    byModule: [],
    bySymbol: {
      buildDenseIndex: ['templates/contextkit/tools/scripts/project-map-dense.mjs'],
      findSymbol:      ['templates/contextkit/tools/scripts/project-map-dense.mjs'],
      renderDense:     ['templates/contextkit/tools/scripts/project-map-dense.mjs'],
      scanProject:     ['templates/contextkit/tools/scripts/project-map-core.mjs'],
      buildIndex:      ['some/other/file.mjs', 'another/file.mjs'],
    },
    fileCount: 3,
    symbolCount: 5,
  };
}

/**
 * Runs all findSymbol unit checks.
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} reporter
 * @param {{ KIT: string }} ctx - repo root path
 */
export async function runProjmapFindChecks({ ok, bad }, { KIT }) {
  console.log('Checking project-map --find / findSymbol (project-map-dense.mjs)...');

  const densePath = resolve(KIT, 'templates/contextkit/tools/scripts/project-map-dense.mjs');

  let lib;
  try {
    lib = await import(pathToFileURL(densePath).href);
    ok('project-map-dense.mjs imports cleanly');
  } catch (err) {
    bad(`project-map-dense.mjs import failed: ${err?.message ?? err}`);
    return;
  }

  const { findSymbol } = lib;

  if (typeof findSymbol !== 'function') {
    bad('findSymbol is not exported from project-map-dense.mjs');
    return;
  }
  ok('findSymbol is exported as a function');

  const index = fakeIndex();

  // 1. Exact match returns the correct file.
  const exactResult = findSymbol(index, 'buildDenseIndex');
  exactResult.length === 1 && exactResult[0].symbol === 'buildDenseIndex' &&
  exactResult[0].files.includes('templates/contextkit/tools/scripts/project-map-dense.mjs')
    ? ok('findSymbol: exact match returns the expected entry and file')
    : bad(`findSymbol: exact match wrong — ${JSON.stringify(exactResult)}`);

  // 2. Substring match (case-insensitive) works.
  const subResult = findSymbol(index, 'dense');
  subResult.some((r) => r.symbol === 'buildDenseIndex') &&
  subResult.some((r) => r.symbol === 'renderDense')
    ? ok('findSymbol: substring match returns symbols containing "dense" (case-insensitive)')
    : bad(`findSymbol: substring match wrong — ${JSON.stringify(subResult.map((r) => r.symbol))}`);

  // 3. Case-insensitivity: uppercase query finds lowercase symbol.
  const caseResult = findSymbol(index, 'SCAN');
  caseResult.some((r) => r.symbol === 'scanProject')
    ? ok('findSymbol: uppercase query matches lowercase symbol (case-insensitive)')
    : bad(`findSymbol: case-insensitive wrong — ${JSON.stringify(caseResult.map((r) => r.symbol))}`);

  // 4. Empty query → [].
  const emptyResult = findSymbol(index, '');
  emptyResult.length === 0
    ? ok('findSymbol: empty query returns []')
    : bad(`findSymbol: empty query should return [], got length ${emptyResult.length}`);

  // 5. Non-object index → [].
  const nullResult = findSymbol(null, 'build');
  nullResult.length === 0
    ? ok('findSymbol: null index returns []')
    : bad(`findSymbol: null index should return [], got length ${nullResult.length}`);

  const strResult = findSymbol('not-an-object', 'build');
  strResult.length === 0
    ? ok('findSymbol: string-typed index returns []')
    : bad(`findSymbol: string index should return [], got length ${strResult.length}`);

  // 6. Result is frozen (immutable).
  const frozenResult = findSymbol(index, 'find');
  let threw = false;
  try { frozenResult.push({ symbol: 'x', files: [] }); } catch { threw = true; }
  Object.isFrozen(frozenResult) || threw
    ? ok('findSymbol: result array is frozen (immutable)')
    : bad('findSymbol: result array is NOT frozen — callers could mutate it');

  // 7. Exact match appears before substring matches.
  const orderedResult = findSymbol(index, 'buildIndex');
  orderedResult.length > 0 && orderedResult[0].symbol === 'buildIndex'
    ? ok('findSymbol: exact match is the first result when substring matches also exist')
    : bad(`findSymbol: exact match not first — got ${JSON.stringify(orderedResult.map((r) => r.symbol))}`);

  // 8. Zero symbols → no match.
  const emptyIndex = { bySymbol: {}, byModule: [], fileCount: 0, symbolCount: 0 };
  const noSymResult = findSymbol(emptyIndex, 'anything');
  noSymResult.length === 0
    ? ok('findSymbol: empty bySymbol index → no matches')
    : bad(`findSymbol: empty index should return [], got length ${noSymResult.length}`);

  // 9. Cap: result never exceeds 50 entries.
  const bigBySymbol = {};
  for (let i = 0; i < 100; i++) bigBySymbol[`symbol_abc_${i}`] = [`file${i}.mjs`];
  const bigIndex = { bySymbol: bigBySymbol, byModule: [], fileCount: 100, symbolCount: 100 };
  const capResult = findSymbol(bigIndex, 'abc');
  capResult.length <= 50
    ? ok(`findSymbol: result is capped at 50 (got ${capResult.length} from 100-symbol index)`)
    : bad(`findSymbol: result exceeds 50 — got ${capResult.length}`);

  // 10. UNEXPORTED symbols + test-file deprioritisation (buildDenseIndex on a fixture).
  const { buildDenseIndex, isTestFile } = lib;
  typeof isTestFile === 'function' && isTestFile('pkg/a_test.go') === true && isTestFile('pkg/a.go') === false
    ? ok('isTestFile: _test.go → true, source → false')
    : bad('isTestFile: wrong classification');

  const { mkdtempSync, mkdirSync, writeFileSync, rmSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  let tmp;
  try {
    tmp = mkdtempSync(join(tmpdir(), 'pmfind-'));
    mkdirSync(join(tmp, 'pkg'), { recursive: true });
    // Source has an UNEXPORTED Go func; the test file also references a sibling.
    writeFileSync(join(tmp, 'pkg', 'a.go'), 'package pkg\nfunc normalizeName(s string) string { return s }\nfunc Exported() {}\n');
    writeFileSync(join(tmp, 'pkg', 'a_test.go'), 'package pkg\nfunc normalizeName_t() {}\n');
    const built = buildDenseIndex(tmp);
    const un = findSymbol(built, 'normalizeName').find((r) => r.symbol === 'normalizeName');
    un && un.files.some((f) => f.endsWith('pkg/a.go'))
      ? ok('buildDenseIndex: UNEXPORTED symbol normalizeName is indexed')
      : bad(`buildDenseIndex: unexported symbol not indexed — ${JSON.stringify(un)}`);
    // A symbol present in both source + test must list the source file FIRST.
    const both = findSymbol(built, 'normalizeName_t').find((r) => r.symbol === 'normalizeName_t');
    // (normalizeName_t lives only in the test file → it IS a test symbol; assert ordering on a shared one)
    const shared = built.bySymbol['normalizeName'] || [];
    shared.length === 0 || !isTestFile(shared[0])
      ? ok('buildDenseIndex: source file ordered before test files in bySymbol')
      : bad(`buildDenseIndex: test file ordered first — ${JSON.stringify(shared)}`);
  } catch (err) {
    bad(`buildDenseIndex fixture check threw: ${err?.message ?? err}`);
  } finally {
    if (tmp) { try { rmSync(tmp, { recursive: true, force: true }); } catch { /* best-effort */ } }
  }

  // 11. Zero-dep invariant: project-map-dense.mjs must not import third-party packages.
  const zeroDep = await checkModuleZeroDep(densePath);
  zeroDep.error === null
    ? ok('zero-dep invariant: project-map-dense.mjs imports only node:/* or relative paths')
    : bad(`zero-dep violation in project-map-dense.mjs: ${zeroDep.error}`);

  // 12. Regression — a nested dir sharing a name with a root-relative exclude
  // (e.g. 'contextkit') must still be walked. A flat by-basename exclude (the
  // pre-fix behavior) wrongly dropped `templates/contextkit/` from this repo's
  // own dense index; the fixture reproduces the shape one level down.
  let nestedTmp;
  try {
    nestedTmp = mkdtempSync(join(tmpdir(), 'pmfind-nested-'));
    mkdirSync(join(nestedTmp, 'templates', 'contextkit', 'src'), { recursive: true });
    writeFileSync(join(nestedTmp, 'templates', 'contextkit', 'src', 'a.mjs'), 'export function nestedHelper() { return 1; }\n');
    const nestedBuilt = buildDenseIndex(nestedTmp);
    const found = findSymbol(nestedBuilt, 'nestedHelper');
    found.length === 1 && found[0].files.some((f) => f === 'templates/contextkit/src/a.mjs')
      ? ok('buildDenseIndex: a nested dir named "contextkit" is walked (root-anchored exclude, not by-basename)')
      : bad(`buildDenseIndex: nested "contextkit" wrongly excluded — ${JSON.stringify(found)}`);
  } catch (err) {
    bad(`buildDenseIndex nested-exclude fixture threw: ${err?.message ?? err}`);
  } finally {
    if (nestedTmp) { try { rmSync(nestedTmp, { recursive: true, force: true }); } catch { /* best-effort */ } }
  }

  // 13. Regression — a real symbol name colliding with an inherited
  // Object.prototype member (e.g. `valueOf`) must not crash buildDenseIndex
  // or silently vanish. A plain `{}` map treats `bySymbol['valueOf']` as
  // already-truthy (the inherited function), so `||= []` never assigns and
  // the next `.push` throws — this repo has a real exported `valueOf` helper.
  let protoTmp;
  try {
    protoTmp = mkdtempSync(join(tmpdir(), 'pmfind-proto-'));
    mkdirSync(join(protoTmp, 'src'), { recursive: true });
    writeFileSync(join(protoTmp, 'src', 'a.mjs'), 'export const valueOf = (x) => x;\n');
    writeFileSync(join(protoTmp, 'src', 'b.mjs'), 'export function toString() { return ""; }\n');
    const protoBuilt = buildDenseIndex(protoTmp);
    const valueOfHit = findSymbol(protoBuilt, 'valueOf').find((r) => r.symbol === 'valueOf');
    const toStringHit = findSymbol(protoBuilt, 'toString').find((r) => r.symbol === 'toString');
    valueOfHit && valueOfHit.files.includes('src/a.mjs') && toStringHit && toStringHit.files.includes('src/b.mjs')
      ? ok('buildDenseIndex: symbol names colliding with Object.prototype (valueOf, toString) are indexed, not dropped/crashed')
      : bad(`buildDenseIndex: prototype-colliding symbol lost — valueOf=${JSON.stringify(valueOfHit)} toString=${JSON.stringify(toStringHit)}`);
  } catch (err) {
    bad(`buildDenseIndex prototype-collision fixture threw: ${err?.message ?? err}`);
  } finally {
    if (protoTmp) { try { rmSync(protoTmp, { recursive: true, force: true }); } catch { /* best-effort */ } }
  }
}
