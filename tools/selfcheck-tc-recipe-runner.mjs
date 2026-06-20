#!/usr/bin/env node
/**
 * Self-check — Task-Compiler recipe-runner DAG (TC-15 / WF0022 / ADR-0089).
 *
 * Verifies the orchestrator surface in tc-recipe-runner.mjs and the inert
 * seed data in tc-recipe-seed.mjs:
 *
 *  1. Module imports cleanly.
 *  2. TC_RECIPE_RUNNER_SCHEMA_VERSION constant value.
 *  3. validateRecipe — rejects null (RecipeValidationError).
 *  4. validateRecipe — rejects missing id.
 *  5. validateRecipe — rejects unknown entry step.
 *  6. validateRecipe — rejects edge to unknown target (RecipeEdgeError).
 *  7. validateRecipe — accepts valid linear recipe.
 *  8. SEED_RECIPE passes validateRecipe.
 *  9. runRecipe (dry-run) — linear 3 steps, 0 errors.
 * 10. runRecipe result is frozen.
 * 11. runRecipe default dryRun === true.
 * 12. fan-out-to-join — join step executes exactly once.
 * 13. conditional edge skipped when condition is false.
 * 14. conditional edge followed when condition is true.
 * 15. resumeFrom skips listed steps.
 * 16. stops on first step error; records in errors[].
 * 17. SEED_RECIPE dry-run succeeds with 0 errors.
 * 18. presentRecipeRun — contains schemaVersion, recipe id, mode label.
 * 19. Zero hot-path dep invariant (node:/* or relative only).
 *
 * Standalone: `node tools/selfcheck-tc-recipe-runner.mjs` → exit 0 all-pass.
 * Library: import { runTcRecipeRunnerChecks } from './selfcheck-tc-recipe-runner.mjs'
 */
import { readFile }              from 'node:fs/promises';
import { resolve, dirname }      from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname    = dirname(fileURLToPath(import.meta.url));
const KIT_DEFAULT  = resolve(__dirname, '..');

/** @param {string} modPath @returns {Promise<{ error: string|null }>} */
async function checkZeroDep(modPath) {
  let content = '';
  try { content = await readFile(modPath, 'utf-8'); } catch (err) {
    return { error: `could not read: ${err?.message ?? err}` };
  }
  const re = /^import\s+(?:[^"'`]*\s+)?from\s+['"`]([^'"`]+)['"`]/gm;
  let m;
  while ((m = re.exec(content)) !== null) {
    if (!m[1].startsWith('.') && !m[1].startsWith('node:')) {
      return { error: `imports from "${m[1]}"` };
    }
  }
  return { error: null };
}

/** Minimal valid linear recipe (3 noop steps). */
const LINEAR = {
  id: 'test-linear/1', version: '1.0.0', entry: 'a',
  steps: [
    { id: 'a', kind: 'noop', edges: [{ target: 'b' }] },
    { id: 'b', kind: 'noop', edges: [{ target: 'c' }] },
    { id: 'c', kind: 'noop' },
  ],
};

/** Fan-out-to-join: a → (b, c) → d → e. */
const FANOUT = {
  id: 'test-fanout/1', version: '1.0.0', entry: 'a',
  steps: [
    { id: 'a', kind: 'noop', edges: [{ target: 'b', fanOut: true }, { target: 'c', fanOut: true }] },
    { id: 'b', kind: 'noop', edges: [{ target: 'd', join: true }] },
    { id: 'c', kind: 'noop', edges: [{ target: 'd', join: true }] },
    { id: 'd', kind: 'noop', edges: [{ target: 'e' }] },
    { id: 'e', kind: 'noop' },
  ],
};

/** Conditional recipe: a → b (condition) → c. */
const cond = (expr) => ({
  id: 'test-cond/1', version: '1.0.0', entry: 'a',
  steps: [
    { id: 'a', kind: 'noop', edges: [{ target: 'b', condition: expr }] },
    { id: 'b', kind: 'noop', edges: [{ target: 'c' }] },
    { id: 'c', kind: 'noop' },
  ],
});

/**
 * Runs Task-Compiler recipe-runner DAG self-checks.
 *
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} reporter
 * @param {{ KIT: string }} ctx - repo root
 */
export async function runTcRecipeRunnerChecks({ ok, bad }, { KIT }) {
  console.log('Checking Task-Compiler recipe-runner DAG (TC-15)...');

  const ECON    = resolve(KIT, 'templates/contextkit/tools/scripts/economy');
  const modPath = resolve(ECON, 'tc-recipe-runner.mjs');

  // ── 1. Module imports cleanly ─────────────────────────────────────────────
  let lib;
  try {
    lib = await import(pathToFileURL(modPath).href);
    ok('tc-recipe-runner.mjs imports cleanly');
  } catch (err) {
    bad(`tc-recipe-runner.mjs import failed: ${err?.message ?? err}`);
    return;
  }

  const {
    TC_RECIPE_RUNNER_SCHEMA_VERSION, RecipeValidationError, RecipeEdgeError,
    validateRecipe, runRecipe, presentRecipeRun,
  } = lib;

  // ── 2. Schema version ─────────────────────────────────────────────────────
  TC_RECIPE_RUNNER_SCHEMA_VERSION === 'cdk-tc-recipe-runner/1'
    ? ok('schema version is "cdk-tc-recipe-runner/1"')
    : bad(`schema version wrong: ${TC_RECIPE_RUNNER_SCHEMA_VERSION}`);

  // ── 3. validateRecipe rejects null ────────────────────────────────────────
  try { validateRecipe(null); bad('validateRecipe(null) should throw'); }
  catch (e) {
    e instanceof RecipeValidationError
      ? ok('validateRecipe(null) throws RecipeValidationError')
      : bad(`validateRecipe(null) wrong error: ${e?.name}`);
  }

  // ── 4. validateRecipe rejects missing id ──────────────────────────────────
  try {
    validateRecipe({ id: '', version: '1', entry: 'x', steps: [{ id: 'x', kind: 'noop' }] });
    bad('validateRecipe missing id should throw');
  } catch (e) {
    e instanceof RecipeValidationError
      ? ok('validateRecipe rejects missing id')
      : bad(`validateRecipe missing id wrong error: ${e?.name}`);
  }

  // ── 5. validateRecipe rejects unknown entry ───────────────────────────────
  try {
    validateRecipe({ id: 'x', version: '1', entry: 'ghost', steps: [{ id: 'a', kind: 'noop' }] });
    bad('validateRecipe unknown entry should throw');
  } catch (e) {
    e instanceof RecipeValidationError
      ? ok('validateRecipe rejects unknown entry step')
      : bad(`validateRecipe unknown entry wrong error: ${e?.name}`);
  }

  // ── 6. validateRecipe rejects edge to unknown target ─────────────────────
  try {
    validateRecipe({
      id: 'x', version: '1', entry: 'a',
      steps: [{ id: 'a', kind: 'noop', edges: [{ target: 'ghost' }] }],
    });
    bad('validateRecipe unknown edge target should throw');
  } catch (e) {
    e instanceof RecipeEdgeError
      ? ok('validateRecipe rejects edge to unknown target (RecipeEdgeError)')
      : bad(`validateRecipe unknown edge wrong error: ${e?.name}`);
  }

  // ── 7. validateRecipe accepts valid recipe ────────────────────────────────
  try { validateRecipe(LINEAR); ok('validateRecipe accepts valid linear recipe'); }
  catch (e) { bad(`validateRecipe(valid) threw: ${e?.message ?? e}`); }

  // ── 8. SEED_RECIPE passes validateRecipe ─────────────────────────────────
  let SEED_RECIPE;
  try {
    const seedMod = await import(pathToFileURL(resolve(ECON, 'tc-recipe-seed.mjs')).href);
    SEED_RECIPE = seedMod.SEED_RECIPE;
    validateRecipe(SEED_RECIPE);
    ok('SEED_RECIPE passes validateRecipe');
  } catch (e) { bad(`SEED_RECIPE validateRecipe failed: ${e?.message ?? e}`); }

  // ── 9. runRecipe linear 3 steps, 0 errors ────────────────────────────────
  const lr = runRecipe(LINEAR);
  lr.steps.length === 3 && lr.errors.length === 0
    ? ok('runRecipe linear: 3 steps executed, 0 errors')
    : bad(`runRecipe linear: steps=${lr.steps.length} errors=${lr.errors.length}`);

  // ── 10. result is frozen ──────────────────────────────────────────────────
  let mutated = false;
  try { lr.recipeId = 'tampered'; mutated = true; } catch { /* expected */ }
  !mutated || lr.recipeId !== 'tampered'
    ? ok('runRecipe result is frozen')
    : bad('runRecipe result is NOT frozen');

  // ── 11. dryRun === true by default ───────────────────────────────────────
  lr.dryRun === true
    ? ok('runRecipe default: dryRun === true')
    : bad(`runRecipe dryRun should be true, got: ${lr.dryRun}`);

  // ── 12. fan-out-to-join: join step executes exactly once ─────────────────
  const fr = runRecipe(FANOUT);
  const dCount = fr.steps.filter((s) => s.stepId === 'd').length;
  fr.errors.length === 0 && dCount === 1
    ? ok('runRecipe fan-out-to-join: join step "d" executed exactly once')
    : bad(`runRecipe fan-out: dCount=${dCount} errors=${fr.errors.length}`);

  // ── 13. conditional edge skipped when condition false ─────────────────────
  const cf = runRecipe(cond('env.mode == "full"'), { ctx: {} });
  const cfIds = cf.steps.map((s) => s.stepId);
  cfIds.includes('a') && !cfIds.includes('b') && cf.errors.length === 0
    ? ok('runRecipe conditional: edge skipped when condition is false')
    : bad(`runRecipe cond-false: ids=${cfIds.join(',')} errors=${cf.errors.length}`);

  // ── 14. conditional edge followed when condition true ─────────────────────
  const ct = runRecipe(cond('env.mode == "full"'), { ctx: { env: { mode: 'full' } } });
  const ctIds = ct.steps.map((s) => s.stepId);
  ctIds.includes('b') && ctIds.includes('c') && ct.errors.length === 0
    ? ok('runRecipe conditional: edge followed when condition is true')
    : bad(`runRecipe cond-true: ids=${ctIds.join(',')} errors=${ct.errors.length}`);

  // ── 15. resumeFrom skips listed steps ────────────────────────────────────
  const rr = runRecipe(LINEAR, { resumeFrom: new Set(['a']) });
  rr.skipped.includes('a') && !rr.steps.some((s) => s.stepId === 'a')
    ? ok('runRecipe resumeFrom: "a" skipped, not re-executed')
    : bad(`runRecipe resumeFrom: skipped=${rr.skipped.join(',')}`);

  // ── 16. stops on first step error ────────────────────────────────────────
  // kind=patch with empty patches[] causes TransformValidationError in dispatchStep
  const errorRecipe = {
    id: 'test-err/1', version: '1.0.0', entry: 'a',
    steps: [
      { id: 'a', kind: 'patch', patchPlan: { recipeId: 'x', version: '1', allowedPaths: ['src/'], patches: [] } },
      { id: 'b', kind: 'noop' },
    ],
  };
  try {
    const er = runRecipe(errorRecipe);
    er.errors.length > 0 && !er.steps.some((s) => s.stepId === 'b')
      ? ok('runRecipe stops on first step error; "b" not reached')
      : bad(`runRecipe error-stop: errors=${er.errors.length} ids=${er.steps.map((s) => s.stepId).join(',')}`);
  } catch (e) {
    bad(`runRecipe error-stop threw unexpectedly: ${e?.message ?? e}`);
  }

  // ── 17. SEED_RECIPE dry-run 0 errors ─────────────────────────────────────
  if (SEED_RECIPE) {
    const sr = runRecipe(SEED_RECIPE, { ctx: { env: { mode: 'not-full' } } });
    sr.errors.length === 0
      ? ok(`SEED_RECIPE dry-run: ${sr.steps.length} steps, 0 errors`)
      : bad(`SEED_RECIPE dry-run errors: ${sr.errors.join('; ')}`);
  }

  // ── 18. presentRecipeRun contains expected fields ─────────────────────────
  const rendered = presentRecipeRun(lr);
  rendered.includes('cdk-tc-recipe-runner/1') && rendered.includes('test-linear/1') && rendered.includes('DRY-RUN')
    ? ok('presentRecipeRun: contains schemaVersion, recipeId, DRY-RUN')
    : bad(`presentRecipeRun missing fields:\n${rendered}`);

  // ── 19. Zero hot-path dep invariant ──────────────────────────────────────
  const dep = await checkZeroDep(modPath);
  dep.error === null
    ? ok('zero-dep: tc-recipe-runner.mjs imports only node:/* or relative')
    : bad(`zero-dep: tc-recipe-runner.mjs ${dep.error}`);
}

// ---------------------------------------------------------------------------
// Standalone runner
// ---------------------------------------------------------------------------

if (process.argv[1]?.endsWith('selfcheck-tc-recipe-runner.mjs')) {
  let failures = 0;
  const ok  = (m) => console.log(`  ok  ${m}`);
  const bad = (m) => { console.error(`  FAIL ${m}`); failures += 1; };

  await runTcRecipeRunnerChecks({ ok, bad }, { KIT: KIT_DEFAULT });

  console.log(failures === 0
    ? '\nAll tc-recipe-runner checks passed.\n'
    : `\n${failures} tc-recipe-runner check(s) FAILED.\n`);
  process.exit(failures === 0 ? 0 : 1);
}
