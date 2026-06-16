#!/usr/bin/env node
/**
 * Self-check — boot-signals-projmap.mjs no-baseline nudge (PMB-03, ADR-0098).
 *
 * Asserts three behavioural contracts for `projectMapStale`:
 *   1. Source present + no manifest → nudge returned (string, not null).
 *   2. Greenfield (no source dirs) + no manifest → null (silent).
 *   3. Manifest present → existing staleness/violations path used (NOT the
 *      no-baseline nudge), even when the manifest has no modules.
 *
 * Uses temp fixture directories so the real project tree is never touched.
 * Standalone: `node tools/selfcheck-boot-signals-projmap.mjs`.
 * Exit 0 on all-pass, exit 1 on any failure. Zero runtime deps — node:* only.
 */
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KIT = resolve(__dirname, '..');
const HOOK_PATH = resolve(KIT, 'templates/contextkit/runtime/hooks/boot-signals-projmap.mjs');

/** Expected no-baseline nudge text (exact match against the exported constant). */
const NUDGE_TEXT = '🗺️ No project map yet — run /project-map to create the durable baseline.';

/** Source sentinel dir used by `hasSourceDirs` — must match the list in the hook. */
const A_SOURCE_DIR = 'src';

/** Platform dir name (contextkit) from paths.mjs — single-sourced there, replicated here for fixture path construction only. */
const PLATFORM_DIR = 'contextkit';

let failures = 0;
const ok = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => { console.error(`  ✗ ${msg}`); failures += 1; };

/**
 * Builds a temp fixture directory tree and returns its absolute path.
 * Caller is responsible for cleanup via `rmSync(root, { recursive: true, force: true })`.
 *
 * @param {{ hasSource?: boolean, hasManifest?: boolean, manifestContent?: object }} opts
 * @returns {string} absolute path to the temp fixture root
 */
function makeTmpRoot({ hasSource = false, hasManifest = false, manifestContent = {} }) {
  const root = join(tmpdir(), `ck-pmb03-${Date.now()}-${Math.random().toString(36).slice(2)}`);
  mkdirSync(root, { recursive: true });

  if (hasSource) {
    // Create one sentinel source directory so `hasSourceDirs` returns true.
    mkdirSync(join(root, A_SOURCE_DIR), { recursive: true });
  }

  if (hasManifest) {
    // Replicate the path contextkit/memory/project-map/manifest.json.
    const manifestDir = join(root, PLATFORM_DIR, 'memory', 'project-map');
    mkdirSync(manifestDir, { recursive: true });
    writeFileSync(join(manifestDir, 'manifest.json'), JSON.stringify(manifestContent), 'utf-8');
  }

  return root;
}

// ---------------------------------------------------------------------------
// Import the module under test
// ---------------------------------------------------------------------------

let projectMapStale;
try {
  const mod = await import(pathToFileURL(HOOK_PATH).href);
  projectMapStale = mod.projectMapStale;
  typeof projectMapStale === 'function'
    ? ok('boot-signals-projmap.mjs imports cleanly; projectMapStale exported')
    : bad('boot-signals-projmap.mjs: projectMapStale is not a function');
} catch (importErr) {
  bad(`boot-signals-projmap.mjs import failed: ${importErr?.message ?? importErr}`);
  process.exit(1); // can't run further cases without the module
}

// ---------------------------------------------------------------------------
// Case 1: source present + no manifest → nudge returned
// ---------------------------------------------------------------------------

{
  const root = makeTmpRoot({ hasSource: true, hasManifest: false });
  try {
    const signal = projectMapStale(root);
    signal === NUDGE_TEXT
      ? ok('case 1 (source + no manifest): nudge returned')
      : bad(`case 1: expected nudge text, got ${JSON.stringify(signal)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Case 2: greenfield (no source dirs) + no manifest → null
// ---------------------------------------------------------------------------

{
  const root = makeTmpRoot({ hasSource: false, hasManifest: false });
  try {
    const signal = projectMapStale(root);
    signal === null
      ? ok('case 2 (greenfield + no manifest): null (silent)')
      : bad(`case 2: expected null, got ${JSON.stringify(signal)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Case 3: manifest present (empty modules) → null, NOT the nudge text
// A manifest on disk means the baseline-missing branch must NOT fire even
// when the manifest has no modules (that edge is already handled by the
// existing `manifest.modules.length === 0 → return null` guard).
// ---------------------------------------------------------------------------

{
  const root = makeTmpRoot({ hasSource: true, hasManifest: true, manifestContent: { modules: [] } });
  try {
    const signal = projectMapStale(root);
    signal !== NUDGE_TEXT
      ? ok('case 3 (manifest present, no modules): no-baseline nudge NOT emitted')
      : bad('case 3: no-baseline nudge fired despite manifest being present');
    // The existing path returns null for an empty modules array.
    signal === null
      ? ok('case 3: returns null for manifest with empty modules (existing guard)')
      : bad(`case 3: expected null for empty modules, got ${JSON.stringify(signal)}`);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Case 4: fail-open contract — projectMapStale never throws
// ---------------------------------------------------------------------------

{
  // Pass a root where pathsFor will resolve to a nonsense path (no crash allowed).
  try {
    const signal = projectMapStale('/no/such/path/__pmb03_test__');
    // For a path with no source sentinel dirs and no manifest, expect null.
    signal === null
      ? ok('case 4 (nonexistent root): returns null (fail-open)')
      : bad(`case 4: expected null on nonexistent root, got ${JSON.stringify(signal)}`);
  } catch (thrownErr) {
    bad(`case 4: projectMapStale threw instead of returning null — ${thrownErr?.message ?? thrownErr}`);
  }
}

// ---------------------------------------------------------------------------
// File-size invariant: hook ≤ 308 non-empty lines
// ---------------------------------------------------------------------------

{
  const { readFileSync } = await import('node:fs');
  const hookText = readFileSync(HOOK_PATH, 'utf-8');
  const nonEmptyLines = hookText.split('\n').filter((l) => l.trim().length > 0).length;
  nonEmptyLines <= 308
    ? ok(`size: boot-signals-projmap.mjs has ${nonEmptyLines} non-empty lines ≤ 308`)
    : bad(`size: boot-signals-projmap.mjs has ${nonEmptyLines} lines (> 308 — RED gate)`);
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

console.log(
  failures === 0
    ? '\n✅ selfcheck-boot-signals-projmap: all checks passed.\n'
    : `\n❌ selfcheck-boot-signals-projmap: ${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
