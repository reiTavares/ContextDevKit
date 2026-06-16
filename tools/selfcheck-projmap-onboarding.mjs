#!/usr/bin/env node
/**
 * Selfcheck — PMB-02: setup-complete project-map baseline generation.
 *
 * Asserts that `setup-complete.mjs` generates the project-map baseline when
 * the project has source files and skips when the project is greenfield.
 * Fail-open invariant: a generator failure must not prevent the setup flag.
 *
 * Run: node tools/selfcheck-projmap-onboarding.mjs   (exit 0 = healthy)
 *
 * Intentionally NOT registered in selfcheck-suites.mjs / selfcheck.mjs —
 * post-swarm consolidation per SPEC §Coordination (WF0033, card 334).
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT = resolve(fileURLToPath(import.meta.url), '..', '..');
const node = process.execPath;

let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { console.error(`  ✗ ${m}`); failures++; };

/**
 * Creates a minimal temp project with the kit installed (Level 1 is enough).
 * @param {string} label - identifies the fixture in test output.
 * @returns {{ proj: string, cleanup: () => void, script: (rel: string, ...args: string[]) => import('node:child_process').SpawnSyncReturns<string> }}
 */
function makeFixture(label) {
  const proj = join(tmpdir(), `sc-pmb02-${label}-${Date.now()}`);
  mkdirSync(proj, { recursive: true });
  // Init git so install.mjs doesn't complain.
  spawnSync('git', ['init', '-b', 'main'], { cwd: proj });
  spawnSync('git', ['config', 'user.email', 'test@example.com'], { cwd: proj });
  spawnSync('git', ['config', 'user.name', 'Test'], { cwd: proj });
  const inst = spawnSync(node, [join(KIT, 'install.mjs'), '--target', proj, '--level', '1', '--name', label, '--yes'], { encoding: 'utf-8' });
  if (inst.status !== 0) bad(`install failed for ${label}: ${inst.stderr}`);
  const script = (rel, ...args) => spawnSync(node, [join(proj, 'contextkit', 'tools', 'scripts', rel), ...args], { cwd: proj, encoding: 'utf-8' });
  const cleanup = () => rmSync(proj, { recursive: true, force: true });
  return { proj, script, cleanup };
}

console.log('\n🌀 Selfcheck — PMB-02 setup-complete project-map baseline\n');

// ── Fixture A: project WITH source files ─────────────────────────────────────
{
  const { proj, script, cleanup } = makeFixture('with-source');
  try {
    // Add a source file so the project is NOT greenfield.
    mkdirSync(join(proj, 'src'), { recursive: true });
    writeFileSync(join(proj, 'src', 'index.ts'), 'export const hello = () => "hi";\n', 'utf-8');

    const manifestPath = join(proj, 'contextkit', 'memory', 'project-map', 'manifest.json');

    // Confirm baseline absent before running setup-complete.
    existsSync(manifestPath)
      ? bad('manifest.json already exists before setup-complete (fixture is dirty)')
      : ok('manifest absent before setup-complete (fixture clean)');

    // Run setup-complete — this should generate the baseline.
    const result = script('setup-complete.mjs');
    result.status === 0
      ? ok('setup-complete exits 0 with source files present')
      : bad(`setup-complete exited ${result.status}: ${result.stderr}`);

    // Primary acceptance: manifest.json must have been written.
    existsSync(manifestPath)
      ? ok('setup-complete generates project-map/manifest.json for a source project')
      : bad('setup-complete did NOT generate manifest.json for a source project');

    // Setup flag must still be flipped regardless.
    let cfg = {};
    try { cfg = JSON.parse(readFileSync(join(proj, 'contextkit', 'config.json'), 'utf-8')); } catch { /**/ }
    cfg?.setup?.completed === true
      ? ok('config.setup.completed = true after setup-complete with source')
      : bad('config.setup.completed was not set to true after setup-complete with source');

    // Idempotency: running again must not overwrite an existing baseline.
    const before = existsSync(manifestPath) ? readFileSync(manifestPath, 'utf-8') : null;
    script('setup-complete.mjs');
    const after = existsSync(manifestPath) ? readFileSync(manifestPath, 'utf-8') : null;
    before !== null && before === after
      ? ok('setup-complete does not overwrite an existing project-map baseline (idempotent)')
      : bad('setup-complete rewrote the existing manifest.json on a second run');
  } finally {
    cleanup();
  }
}

// ── Fixture B: greenfield project (no source files) ──────────────────────────
{
  const { proj, script, cleanup } = makeFixture('greenfield');
  try {
    const manifestPath = join(proj, 'contextkit', 'memory', 'project-map', 'manifest.json');

    // Run setup-complete on a project with no source files.
    const result = script('setup-complete.mjs');
    result.status === 0
      ? ok('setup-complete exits 0 on greenfield project')
      : bad(`setup-complete exited ${result.status} on greenfield: ${result.stderr}`);

    // Baseline must NOT be generated for greenfield.
    existsSync(manifestPath)
      ? bad('setup-complete generated manifest.json for a greenfield project (should skip)')
      : ok('setup-complete skips project-map baseline for greenfield project');

    // Setup flag must still be flipped.
    let cfg = {};
    try { cfg = JSON.parse(readFileSync(join(proj, 'contextkit', 'config.json'), 'utf-8')); } catch { /**/ }
    cfg?.setup?.completed === true
      ? ok('config.setup.completed = true after setup-complete on greenfield')
      : bad('config.setup.completed was not set to true after setup-complete on greenfield');
  } finally {
    cleanup();
  }
}

// ── Fail-open: generator error must not prevent setup completion ──────────────
{
  const { proj, script, cleanup } = makeFixture('fail-open');
  try {
    // Add source so the generator would be attempted.
    mkdirSync(join(proj, 'src'), { recursive: true });
    writeFileSync(join(proj, 'src', 'app.js'), 'module.exports = {};\n', 'utf-8');

    // Corrupt the project-map script so it exits non-zero.
    const pmScript = join(proj, 'contextkit', 'tools', 'scripts', 'project-map.mjs');
    if (existsSync(pmScript)) {
      writeFileSync(pmScript, '#!/usr/bin/env node\nprocess.exit(1);\n', 'utf-8');
    }

    const result = script('setup-complete.mjs');
    result.status === 0
      ? ok('setup-complete exits 0 even when project-map generator fails (fail-open)')
      : bad(`setup-complete exited ${result.status} on generator failure — not fail-open`);

    let cfg = {};
    try { cfg = JSON.parse(readFileSync(join(proj, 'contextkit', 'config.json'), 'utf-8')); } catch { /**/ }
    cfg?.setup?.completed === true
      ? ok('config.setup.completed = true even when project-map generation fails')
      : bad('config.setup.completed was not set when generator failed — setup must be atomic');
  } finally {
    cleanup();
  }
}

console.log(failures === 0
  ? '\n✅ All PMB-02 selfchecks passed.\n'
  : `\n❌ ${failures} PMB-02 selfcheck(s) failed.\n`);
process.exit(failures === 0 ? 0 : 1);
