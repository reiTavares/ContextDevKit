#!/usr/bin/env node
/**
 * ContextDevKit integration test — wave-workflow engine PACKAGING (WF0035).
 *
 * Proves the universal wave-based workflow engine is correctly DISTRIBUTED to
 * installed projects and works cross-platform. The engine source lives under
 * `templates/contextkit/tools/scripts/workflow/` (+ `workflow.mjs`); the
 * installer's `copyEngine()` mirrors `templates/contextkit/tools` → an installed
 * `contextkit/tools` (ADR-0037). This suite is a CONSUMER of the existing
 * distribution machinery — it never reimplements the installer. It asserts:
 *   1. the engine SOURCE tree is present (modules + registry JSONs);
 *   2. a fresh install carries the engine into `contextkit/tools/scripts/workflow/`;
 *   3. the INSTALLED CLI works (`required-files`, `explain-file`);
 *   4. wave creation works in the installed project (`new --profile basic`);
 *   5. a second `--update` is idempotent and leaves the engine intact;
 *   6. the CLI survives a project path that contains a SPACE (Windows path hygiene).
 *
 * Run:  node tools/integration-test-workflow-packaging.mjs   (exit 0 = healthy)
 * Zero deps beyond `node:*` + it-helpers (ADR-0001). Self-cleaning temp dirs.
 */
import { mkdtempSync, mkdirSync, readdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { reporter, run, KIT, installFixture } from './it-helpers.mjs';

const rep = reporter();
const { ok, bad } = rep;
console.log('\n📦 ContextDevKit integration test — wave-workflow engine packaging (WF0035)\n');

/** Engine modules every installed project must carry (the WF0035 surface). */
const ENGINE_MODULES = [
  'io.mjs', 'plan.mjs', 'state.mjs', 'create.mjs', 'render.mjs', 'dag.mjs',
  'scheduler.mjs', 'ownership.mjs', 'gates.mjs', 'results.mjs', 'continuation.mjs',
  'commands.mjs', 'create-files.mjs', 'files.mjs', 'profiles.mjs', 'patterns.mjs',
  'addons.mjs', 'validate.mjs', 'glob.mjs',
];
/** The four declarative registries shipped under `workflow/registry/`. */
const REGISTRY_JSONS = [
  'profile-registry.json', 'file-catalog.json', 'wave-patterns.json', 'addon-registry.json',
];

/** Path of the engine dir under a `contextkit/tools/scripts` root. */
const engineDir = (scriptsRoot) => join(scriptsRoot, 'workflow');
/** Modules + registry files missing from a given engine dir (empty ⇒ complete). */
function missingEngineFiles(dir) {
  const gaps = [];
  for (const mod of ENGINE_MODULES) if (!existsSync(join(dir, mod))) gaps.push(mod);
  for (const reg of REGISTRY_JSONS) if (!existsSync(join(dir, 'registry', reg))) gaps.push(`registry/${reg}`);
  return gaps;
}

const cleanups = [];
try {
  // ── 1. engine SOURCE tree is present ─────────────────────────────────────
  const sourceScripts = join(KIT, 'templates', 'contextkit', 'tools', 'scripts');
  const sourceEngine = engineDir(sourceScripts);
  const sourceGaps = missingEngineFiles(sourceEngine);
  existsSync(join(sourceScripts, 'workflow.mjs'))
    ? ok('source workflow.mjs CLI present')
    : bad('source templates/.../scripts/workflow.mjs is missing');
  sourceGaps.length === 0
    ? ok(`source engine complete (${ENGINE_MODULES.length} modules + ${REGISTRY_JSONS.length} registries)`)
    : bad(`source engine incomplete — missing: ${sourceGaps.join(', ')}`);

  // ── 2. a fresh install carries the engine ────────────────────────────────
  const fix = installFixture(rep);
  cleanups.push(fix.cleanup);
  const installedScripts = join(fix.proj, 'contextkit', 'tools', 'scripts');
  const installedEngine = engineDir(installedScripts);
  const installedGaps = missingEngineFiles(installedEngine);
  existsSync(join(installedScripts, 'workflow.mjs'))
    ? ok('install carried workflow.mjs CLI')
    : bad('installed contextkit/tools/scripts/workflow.mjs is missing after install');
  installedGaps.length === 0
    ? ok('install carried the full engine (modules + registries)')
    : bad(`install left engine gaps: ${installedGaps.join(', ')}`);

  // ── 3. the INSTALLED CLI works ───────────────────────────────────────────
  const cli = join(installedEngine, '..', 'workflow.mjs');
  const reqFiles = run([cli, 'required-files', '--profile', 'basic'], { cwd: fix.proj });
  let reqArray = null;
  try { reqArray = JSON.parse(reqFiles.stdout); } catch { /* reported below */ }
  reqFiles.status === 0 && Array.isArray(reqArray) && reqArray.includes('workflow-plan')
    ? ok('installed CLI: required-files --profile basic returns a sane file list')
    : bad(`installed required-files failed (status ${reqFiles.status}): ${reqFiles.stdout}${reqFiles.stderr}`);

  const explain = run([cli, 'explain-file', 'risk-register'], { cwd: fix.proj });
  let explainObj = null;
  try { explainObj = JSON.parse(explain.stdout); } catch { /* reported below */ }
  explain.status === 0 && explainObj && explainObj.id === 'risk-register'
    ? ok('installed CLI: explain-file risk-register returns the catalog entry')
    : bad(`installed explain-file failed (status ${explain.status}): ${explain.stdout}${explain.stderr}`);

  // ── 4. wave creation works in the installed project ──────────────────────
  const created = run([cli, 'new', 'pkgdemo', '--profile', 'basic'], { cwd: fix.proj });
  const planPath = join(fix.proj, 'contextkit', 'memory', 'workflows', '0001-pkgdemo', 'workflow-plan.json');
  let plan = null;
  try { plan = JSON.parse(readFileSync(planPath, 'utf-8').replace(/^﻿/, '')); } catch { /* reported below */ }
  created.status === 0 && plan && Array.isArray(plan.waves) && plan.waves.length > 0
    ? ok('installed CLI: new --profile basic creates a pack with a valid workflow-plan.json')
    : bad(`wave creation failed (status ${created.status}): ${created.stdout}${created.stderr}`);

  // Validate the freshly-created plan THROUGH the installed engine's own
  // validator — proves the shipped validate.mjs loads and runs in-project.
  const validateUrl = JSON.stringify(pathToFileURL(join(installedEngine, 'validate.mjs')).href);
  const planUrl = JSON.stringify(pathToFileURL(join(installedEngine, 'plan.mjs')).href);
  const validatorSrc =
    `import { validatePlan } from ${validateUrl};` +
    `import { readPlan } from ${planUrl};` +
    `const r = validatePlan(readPlan(${JSON.stringify(planPath.replace(/\\/g, '/'))}));` +
    `process.stdout.write(JSON.stringify({ ok: r.valid === true, errors: r.errors || [] }));`;
  const validated = run(['--input-type=module', '-e', validatorSrc], { cwd: fix.proj });
  let verdict = null;
  try { verdict = JSON.parse(validated.stdout); } catch { /* reported below */ }
  validated.status === 0 && verdict && verdict.ok && (verdict.errors.length === 0)
    ? ok('installed engine validates its own generated plan (no errors)')
    : bad(`installed validate.mjs rejected the generated plan (status ${validated.status}): ${validated.stdout}${validated.stderr}`);

  // ── 5. a second --update is idempotent and preserves the engine ──────────
  const beforeListing = readdirSync(installedEngine).sort();
  const updated = run([
    join(KIT, 'install.mjs'), '--target', fix.proj, '--update',
    '--allow-self-update', '--allow-active-sessions',
  ]);
  const afterListing = existsSync(installedEngine) ? readdirSync(installedEngine).sort() : [];
  const stillComplete = missingEngineFiles(installedEngine).length === 0;
  const sameListing = JSON.stringify(beforeListing) === JSON.stringify(afterListing);
  updated.status === 0 && stillComplete && sameListing
    ? ok('second --update succeeds (exit 0) and the engine files are unchanged')
    : bad(`re-update regressed the engine (status ${updated.status}, sameListing ${sameListing}, complete ${stillComplete}): ${updated.stderr}`);

  // ── 6. cross-platform: a project path containing a SPACE ─────────────────
  const spaceBase = mkdtempSync(join(tmpdir(), 'contextkit-pkg-'));
  cleanups.push(() => rmSync(spaceBase, { recursive: true, force: true }));
  const spaceProj = join(spaceBase, 'with space');
  mkdirSync(spaceProj, { recursive: true });
  // Use a temp HOME so an installer self-host/global check never leaks the
  // developer's real profile (mirrors the established install-test hygiene).
  const spaceEnv = { ...process.env, HOME: spaceBase, USERPROFILE: spaceBase };
  const spaceGit = run([
    join(KIT, 'install.mjs'), '--target', spaceProj, '--level', '5', '--name', 'Spaced', '--yes',
  ], { env: spaceEnv });
  const spaceCli = join(spaceProj, 'contextkit', 'tools', 'scripts', 'workflow.mjs');
  const spaceRun = existsSync(spaceCli)
    ? run([spaceCli, 'required-files', '--profile', 'basic'], { cwd: spaceProj, env: spaceEnv })
    : { status: 1, stdout: '', stderr: 'CLI not installed under spaced path' };
  let spaceArray = null;
  try { spaceArray = JSON.parse(spaceRun.stdout); } catch { /* reported below */ }
  spaceGit.status === 0 && spaceRun.status === 0 && Array.isArray(spaceArray)
    ? ok('engine installs + the CLI runs under a path containing a space')
    : bad(`spaced-path packaging failed (install ${spaceGit.status}, cli ${spaceRun.status}): ${spaceRun.stdout}${spaceRun.stderr}`);

  // Sanity: the spaced engine dir is itself complete (path quoting didn't drop files).
  existsSync(spaceCli) && missingEngineFiles(engineDir(join(spaceProj, 'contextkit', 'tools', 'scripts'))).length === 0
    ? ok('engine under the spaced path is complete (no dropped files)')
    : bad('engine under the spaced path is missing files — path-with-space broke the copy');
} catch (err) {
  bad(`unexpected failure: ${err && err.stack ? err.stack : err}`);
} finally {
  for (const cleanup of cleanups) {
    try { cleanup(); } catch { /* best-effort temp cleanup */ }
  }
}

rep.finish('workflow-packaging');
