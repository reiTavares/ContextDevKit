#!/usr/bin/env node
/**
 * Self-check — project-map governance-memory roots (WF-0070 / ADR-0132, Finding #6).
 *
 * HERMETIC: builds its own temp memory fixture rather than reading the ambient
 * dogfood `contextkit/memory/` — that tree is gitignored, so in a worktree / fresh
 * clone / CI its subdirs are absent and an ambient-dependent assertion would
 * spuriously fail (the rebase-into-worktree bug this rewrite fixes).
 *
 * Asserts the ADR-named config surface (a roots ADDITION, not a walker change):
 *   (1) resolveRoots({}, fixture) includes all three contextkit/memory/{decisions,
 *       sessions,workflows} roots additively, with '.' preserved.
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
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
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

/** Temp project root with the three memory subdirs materialized (caller removes it). */
function buildFixture() {
  const root = mkdtempSync(resolve(tmpdir(), 'ck-projmap-fix-'));
  for (const rel of MEMORY) mkdirSync(resolve(root, rel), { recursive: true });
  return root;
}

// (1) fixture roots include the three memory roots additively, '.' preserved.
const fixture = buildFixture();
try {
  const { roots } = resolveRoots({}, fixture);
  const missing = MEMORY.filter((r) => !roots.includes(r));
  missing.length === 0
    ? ok('resolveRoots includes all three contextkit/memory roots (fixture)')
    : bad(`resolveRoots missing memory root(s): ${missing.join(', ')}`);
  roots.includes('.') ? ok("'.' base root preserved alongside memory roots") : bad("'.' base root was dropped");

  // (2) contextkit stays a root-relative exclude.
  const { isExcluded } = resolveRoots({}, fixture);
  isExcluded('contextkit', 'contextkit') === true
    ? ok('contextkit is still root-excluded (./contextkit/ machinery skipped on a . scan)')
    : bad('contextkit is no longer excluded — machinery would be scanned');

  // (4) determinism.
  JSON.stringify(resolveRoots({}, fixture).roots) === JSON.stringify(resolveRoots({}, fixture).roots)
    ? ok('resolveRoots is deterministic across calls')
    : bad('resolveRoots roots differ across calls');

  // (5) memoryRoots honesty — every returned path is a declared const member, and
  // the fully-populated fixture returns all three.
  const existing = memoryRoots(fixture);
  existing.every((r) => MEMORY_SCAN_ROOTS.includes(r)) && existing.length === MEMORY.length
    ? ok('memoryRoots returns exactly the declared MEMORY_SCAN_ROOTS members that exist')
    : bad(`memoryRoots wrong: ${JSON.stringify(existing)}`);
} catch (err) {
  bad(`fixture checks threw: ${err.message}`);
} finally {
  rmSync(fixture, { recursive: true, force: true });
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

console.log(failures === 0 ? '\n✅ project-map memory roots self-check passed.\n' : `\n❌ ${failures} check(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
