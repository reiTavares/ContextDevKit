#!/usr/bin/env node
/**
 * Integration test — installer project-map auto-baseline (PMB-01, ADR-0098).
 *
 * Tests `maybeGenerateBaseline` (project-map-baseline.mjs) via injectable runner
 * so no real scan or disk install is required. Covers:
 *   A missing-map + source files → runner invoked, returns a success note.
 *   B existing manifest         → runner NOT invoked, returns a skip note.
 *   C greenfield (no source)    → runner NOT invoked, returns a skip note.
 *   D runner throws             → no exception escapes, returns a skip-with-reason note.
 *   E missing generator script  → runner NOT invoked, returns a skip note.
 *
 * Run:  node tools/integration-test-projmap-baseline.mjs
 */
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { reporter } from './it-helpers.mjs';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));

const rep = reporter();
const { ok, bad } = rep;

/**
 * Loads the module under test from the install sub-directory.
 *
 * @returns {Promise<{maybeGenerateBaseline: Function}>}
 */
async function loadBaseline() {
  const filePath = resolve(KIT, 'tools/install/project-map-baseline.mjs');
  const url = 'file:///' + filePath.replaceAll('\\', '/');
  return import(url);
}

/**
 * Creates a minimal throwaway temp directory and returns its path + a cleanup fn.
 *
 * @returns {{ dir: string, cleanup: () => void }}
 */
function makeTempDir() {
  const dir = mkdtempSync(join(tmpdir(), 'pmb-it-'));
  return { dir, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

/**
 * Writes a fake source file inside `projectDir` to make it non-greenfield.
 *
 * @param {string} projectDir
 */
function plantSourceFile(projectDir) {
  const srcDir = join(projectDir, 'src');
  mkdirSync(srcDir, { recursive: true });
  writeFileSync(join(srcDir, 'index.ts'), 'export const hello = "world";\n');
}

/**
 * Creates the full contextkit/memory/project-map/ path and writes a stub manifest.
 *
 * @param {string} projectDir
 */
function plantManifest(projectDir) {
  const mapDir = join(projectDir, 'contextkit', 'memory', 'project-map');
  mkdirSync(mapDir, { recursive: true });
  writeFileSync(join(mapDir, 'manifest.json'), JSON.stringify({ version: 1 }));
}

/**
 * Creates the contextkit/tools/scripts/ path and writes a stub generator script.
 *
 * @param {string} projectDir
 */
function plantGenerator(projectDir) {
  const scriptsDir = join(projectDir, 'contextkit', 'tools', 'scripts');
  mkdirSync(scriptsDir, { recursive: true });
  writeFileSync(join(scriptsDir, 'project-map.mjs'), '// stub\n');
}

// ── A. Missing manifest + source files → runner invoked, success note ────────
async function caseA(maybeGenerateBaseline) {
  const { dir, cleanup } = makeTempDir();
  try {
    plantSourceFile(dir);
    plantGenerator(dir);

    let runnerCalled = false;
    const stubRunner = () => { runnerCalled = true; };

    const note = await maybeGenerateBaseline(dir, { runGenerator: stubRunner });

    runnerCalled
      ? ok('A: runner invoked when manifest is absent and source files exist')
      : bad('A: runner was NOT invoked despite missing manifest + source files');

    typeof note === 'string' && note.includes('generated')
      ? ok('A: success note contains "generated"')
      : bad(`A: expected success note with "generated"; got: ${JSON.stringify(note)}`);
  } finally {
    cleanup();
  }
}

// ── B. Existing manifest → runner NOT invoked, skip note ─────────────────────
async function caseB(maybeGenerateBaseline) {
  const { dir, cleanup } = makeTempDir();
  try {
    plantSourceFile(dir);
    plantGenerator(dir);
    plantManifest(dir); // manifest already exists

    let runnerCalled = false;
    const stubRunner = () => { runnerCalled = true; };

    const note = await maybeGenerateBaseline(dir, { runGenerator: stubRunner });

    !runnerCalled
      ? ok('B: runner NOT invoked when manifest already exists')
      : bad('B: runner was called despite existing manifest (should skip)');

    typeof note === 'string' && note.toLowerCase().includes('skip')
      ? ok('B: skip note returned when manifest already exists')
      : bad(`B: expected a skip note; got: ${JSON.stringify(note)}`);
  } finally {
    cleanup();
  }
}

// ── C. Greenfield (no source files) → runner NOT invoked, skip note ──────────
async function caseC(maybeGenerateBaseline) {
  const { dir, cleanup } = makeTempDir();
  try {
    // No source files planted; only the generator stub (to isolate the guard).
    plantGenerator(dir);

    let runnerCalled = false;
    const stubRunner = () => { runnerCalled = true; };

    const note = await maybeGenerateBaseline(dir, { runGenerator: stubRunner });

    !runnerCalled
      ? ok('C: runner NOT invoked for a greenfield project (no source files)')
      : bad('C: runner was called on a greenfield project (should skip)');

    typeof note === 'string' && note.toLowerCase().includes('skip')
      ? ok('C: skip note returned for greenfield project')
      : bad(`C: expected a skip note for greenfield; got: ${JSON.stringify(note)}`);
  } finally {
    cleanup();
  }
}

// ── D. Runner throws → no exception escapes, skip-with-reason note ───────────
async function caseD(maybeGenerateBaseline) {
  const { dir, cleanup } = makeTempDir();
  try {
    plantSourceFile(dir);
    plantGenerator(dir);

    const throwingRunner = () => { throw new Error('simulated generator failure'); };

    let threwOutside = false;
    let note;
    try {
      note = await maybeGenerateBaseline(dir, { runGenerator: throwingRunner });
    } catch {
      threwOutside = true;
    }

    !threwOutside
      ? ok('D: exception from runner does not escape maybeGenerateBaseline (fail-open)')
      : bad('D: exception escaped maybeGenerateBaseline (must be caught internally)');

    typeof note === 'string' && note.toLowerCase().includes('skip')
      ? ok('D: skip-with-reason note returned when runner throws')
      : bad(`D: expected skip-with-reason note; got: ${JSON.stringify(note)}`);
  } finally {
    cleanup();
  }
}

// ── E. Generator script missing → runner NOT invoked, skip note ──────────────
async function caseE(maybeGenerateBaseline) {
  const { dir, cleanup } = makeTempDir();
  try {
    plantSourceFile(dir);
    // Deliberately do NOT plantGenerator — the generator file is absent.

    let runnerCalled = false;
    const stubRunner = () => { runnerCalled = true; };

    const note = await maybeGenerateBaseline(dir, { runGenerator: stubRunner });

    !runnerCalled
      ? ok('E: runner NOT invoked when generator script is missing')
      : bad('E: runner was called despite missing generator script');

    typeof note === 'string' && note.toLowerCase().includes('skip')
      ? ok('E: skip note returned when generator script is absent')
      : bad(`E: expected skip note; got: ${JSON.stringify(note)}`);
  } finally {
    cleanup();
  }
}

// ── Entry point ───────────────────────────────────────────────────────────────
(async () => {
  console.log('\n🌀 Integration test — project-map auto-baseline (PMB-01, ADR-0098)\n');

  let maybeGenerateBaseline;
  try {
    ({ maybeGenerateBaseline } = await loadBaseline());
    ok('tools/install/project-map-baseline.mjs imports cleanly');
  } catch (err) {
    bad(`import failed: ${err?.message ?? err}`);
    rep.finish('project-map auto-baseline (PMB-01)');
    return;
  }

  await caseA(maybeGenerateBaseline);
  await caseB(maybeGenerateBaseline);
  await caseC(maybeGenerateBaseline);
  await caseD(maybeGenerateBaseline);
  await caseE(maybeGenerateBaseline);

  rep.finish('project-map auto-baseline (PMB-01, ADR-0098)');
})();
