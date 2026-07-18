#!/usr/bin/env node
/**
 * Self-check — project-map governance-memory roots (WF-0070 / ADR-0132, Finding #6).
 *
 * Asserts the ADR-named config surface (a roots ADDITION, not a walker change):
 *   (1) resolveRoots({}, repo) includes all three contextkit/memory/{decisions,
 *       sessions,workflows} roots (they exist in this dogfood repo), additively
 *       with '.' preserved.
 *   (2) `contextkit` stays a root-relative exclude — isExcluded('contextkit',
 *       'contextkit') === true (a '.' scan still skips ./contextkit/ machinery).
 *   (3) Existence-guard + fail-open: against a bare temp dir with NO memory subtree,
 *       resolveRoots does NOT add the memory roots and does not throw.
 *   (4) Determinism: two calls return the same roots.
 *   (5) memoryRoots() honesty: returns only existing subdirs (subset of the const).
 *
 * Standalone: node tools/selfcheck-projmap-memory-roots.mjs  (exit 0 = pass).
 * Zero runtime deps — node:* only.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KIT = resolve(__dirname, '..');
const MOD_URL = pathToFileURL(resolve(KIT, 'templates/contextkit/tools/scripts/project-map-roots.mjs')).href;

let failures = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => { console.error(`  ✗ ${msg}`); failures += 1; };

console.log('\n🗺️  self-check — project-map governance-memory roots (WF-0070 / ADR-0132)\n');

let resolveRoots, memoryRoots, MEMORY_SCAN_ROOTS;
try {
  ({ resolveRoots, memoryRoots, MEMORY_SCAN_ROOTS } = await import(MOD_URL));
  ok('project-map-roots.mjs imports (resolveRoots / memoryRoots / MEMORY_SCAN_ROOTS)');
} catch (err) {
  bad(`import failed: ${err.message}`);
  process.exit(1);
}

const MEMORY = ['contextkit/memory/decisions', 'contextkit/memory/sessions', 'contextkit/memory/workflows'];

// (1) real-repo roots include the three memory roots additively, '.' preserved.
try {
  const { roots } = resolveRoots({}, KIT);
  const missing = MEMORY.filter((r) => !roots.includes(r));
  missing.length === 0
    ? ok('resolveRoots includes all three contextkit/memory roots (repo has them)')
    : bad(`resolveRoots missing memory root(s): ${missing.join(', ')}`);
  roots.includes('.') ? ok("'.' base root preserved alongside memory roots") : bad("'.' base root was dropped");
} catch (err) {
  bad(`resolveRoots(repo) threw: ${err.message}`);
}

// (2) contextkit stays a root-relative exclude.
try {
  const { isExcluded } = resolveRoots({}, KIT);
  isExcluded('contextkit', 'contextkit') === true
    ? ok('contextkit is still root-excluded (./contextkit/ machinery skipped on a . scan)')
    : bad('contextkit is no longer excluded — machinery would be scanned');
} catch (err) {
  bad(`isExcluded check threw: ${err.message}`);
}

// (3) existence-guard + fail-open on a bare dir.
try {
  const bare = mkdtempSync(resolve(tmpdir(), 'ck-projmap-bare-'));
  try {
    const { roots } = resolveRoots({}, bare);
    MEMORY.every((r) => !roots.includes(r))
      ? ok('bare dir: memory roots are NOT added (existence-guarded)')
      : bad('bare dir wrongly added non-existent memory roots');
    memoryRoots(bare).length === 0 ? ok('memoryRoots(bare) === [] (no throw)') : bad('memoryRoots(bare) not empty');
  } finally {
    rmSync(bare, { recursive: true, force: true });
  }
} catch (err) {
  bad(`fail-open check threw (must never throw): ${err.message}`);
}

// (4) determinism.
try {
  JSON.stringify(resolveRoots({}, KIT).roots) === JSON.stringify(resolveRoots({}, KIT).roots)
    ? ok('resolveRoots is deterministic across calls')
    : bad('resolveRoots roots differ across calls');
} catch (err) {
  bad(`determinism check threw: ${err.message}`);
}

// (5) memoryRoots honesty — a subset of the declared const.
try {
  const existing = memoryRoots(KIT);
  existing.every((r) => MEMORY_SCAN_ROOTS.includes(r))
    ? ok('memoryRoots returns only declared MEMORY_SCAN_ROOTS members')
    : bad('memoryRoots returned an undeclared path');
} catch (err) {
  bad(`memoryRoots check threw: ${err.message}`);
}

console.log(failures === 0 ? '\n✅ project-map memory roots self-check passed.\n' : `\n❌ ${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
