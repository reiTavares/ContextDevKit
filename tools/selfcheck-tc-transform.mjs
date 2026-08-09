/**
 * Self-check — Task-Compiler deterministic transforms (WF0022 / ADR-0089).
 *
 * Covers tc-transform.mjs (patch-plan applier) AND tc-codemod.mjs (recipe runner).
 *
 * tc-transform checks:
 *   1.  TC_TRANSFORM_SCHEMA_VERSION === 'cdk-tc-transform/1'.
 *   2.  '// consumes: economy/tc-transform' annotation in tc-codemod source.
 *   3.  Zero hot-path dep invariant — both files import only node:/* or relative paths.
 *   4.  null plan → TransformValidationError (no I/O).
 *   5.  missing recipeId → TransformValidationError.
 *   6.  empty allowedPaths → TransformValidationError.
 *   7.  out-of-scope path → TransformScopeError (no I/O).
 *   8.  valid plan, dry-run → dryRun:true, receipts:[] preview non-empty.
 *   9.  valid plan, write:true → receipts.length === patches.length, beforeSha256 set.
 *  10.  atomic write: file content matches newContent after write.
 *  11.  CDK-032 advisory: economy signal emitted in advisoryLines (large-file scenario).
 *  12.  presentTransform on dry-run → string containing 'DRY-RUN'.
 *  13.  presentTransform on null → safe string (no throw).
 *
 * tc-codemod checks:
 *  14.  TC_CODEMOD_SCHEMA_VERSION === 'cdk-tc-codemod/1'.
 *  15.  RECIPE_COUNT >= 1 (seed recipe present).
 *  16.  unknown recipeId → CodemodRecipeNotFoundError.
 *  17.  seed recipe dry-run → dryRun:true, no write attempted.
 *  18.  seed recipe with allowMissingTargets → does not throw on missing targets.
 *  19.  findRecipe('seed-noop-comment') → recipe with id and version.
 *  20.  presentCodemod on valid result → string containing recipe id.
 *  21.  presentCodemod on null → safe string (no throw).
 *
 * ADR-0089. Zero runtime dependencies — node:* only.
 */
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync }                        from 'node:fs';
import { resolve, join, dirname }            from 'node:path';
import { tmpdir }                            from 'node:os';
import { fileURLToPath, pathToFileURL }      from 'node:url';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Checks that a module file imports only node:/* and relative paths.
 * @param {string} label
 * @param {string} filePath
 * @param {{ ok:(m:string)=>void, bad:(m:string)=>void }} reporter
 */
async function checkZeroDep(label, filePath, { ok, bad }) {
  let src = '';
  try { src = await readFile(filePath, 'utf-8'); } catch (e) {
    bad(`${label}: cannot read — ${e?.message}`); return;
  }
  const re = /^import\s+(?:[^"'`]*\s+)?from\s+['"`]([^'"`]+)['"`]/gm;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (!m[1].startsWith('.') && !m[1].startsWith('node:')) {
      bad(`${label}: imports from "${m[1]}"`); return;
    }
  }
  ok(`${label}: zero-dep invariant`);
}

/**
 * Returns a minimal valid PatchPlan targeting a real file under tmpDir.
 * @param {string} tmpDir @param {string} content
 * @returns {{ plan: object, targetPath: string }}
 */
function makeMinimalPlan(tmpDir, content = 'hello world') {
  const relPath = 'contextkit/pipeline/scratch/test-target.txt';
  return {
    plan: {
      recipeId:     'test-recipe',
      version:      '1.0.0',
      allowedPaths: ['contextkit/pipeline/scratch/'],
      patches:      [{ path: relPath, newContent: content }],
    },
    targetPath: resolve(tmpDir, relPath),
    relPath,
  };
}

// ---------------------------------------------------------------------------
// Exported runner
// ---------------------------------------------------------------------------

/**
 * Runs Task-Compiler deterministic transform self-checks (tc-transform + tc-codemod).
 * @param {{ ok:(m:string)=>void, bad:(m:string)=>void }} reporter
 * @param {{ KIT: string }} ctx
 */
export async function runTcTransformChecks({ ok, bad }, { KIT }) {
  console.log('Checking Task-Compiler deterministic transforms (WF0022 / ADR-0089)...');

  const transformPath = resolve(KIT, 'templates/contextkit/tools/scripts/economy/tc-transform.mjs');
  const codemodPath   = resolve(KIT, 'templates/contextkit/tools/scripts/economy/tc-codemod.mjs');

  let transformLib, codemodLib;
  try {
    transformLib = await import(pathToFileURL(transformPath).href);
    ok('tc-transform.mjs imports cleanly');
  } catch (e) {
    bad(`tc-transform.mjs import failed: ${e?.message}`); return;
  }
  try {
    codemodLib = await import(pathToFileURL(codemodPath).href);
    ok('tc-codemod.mjs imports cleanly');
  } catch (e) {
    bad(`tc-codemod.mjs import failed: ${e?.message}`); return;
  }

  const {
    TC_TRANSFORM_SCHEMA_VERSION,
    applyPatchPlan,
    presentTransform,
    TransformValidationError,
    TransformScopeError,
  } = transformLib;

  const {
    TC_CODEMOD_SCHEMA_VERSION,
    RECIPE_COUNT,
    findRecipe,
    runCodemod,
    presentCodemod,
    CodemodRecipeNotFoundError,
  } = codemodLib;

  // Create a temp directory for write-mode tests.
  const tmpDir = await mkdtemp(join(tmpdir(), 'tc-transform-selfcheck-'));
  try {
    // ── 1. TC_TRANSFORM_SCHEMA_VERSION ───────────────────────────────────────
    TC_TRANSFORM_SCHEMA_VERSION === 'cdk-tc-transform/1'
      ? ok('TC_TRANSFORM_SCHEMA_VERSION === "cdk-tc-transform/1"')
      : bad(`TC_TRANSFORM_SCHEMA_VERSION wrong: ${TC_TRANSFORM_SCHEMA_VERSION}`);

    // ── 2. '// consumes:' annotation in tc-codemod source ────────────────────
    const codemodSrc = await readFile(codemodPath, 'utf-8');
    codemodSrc.includes('// consumes: economy/tc-transform')
      ? ok('tc-codemod.mjs: "// consumes: economy/tc-transform" annotation present')
      : bad('tc-codemod.mjs: missing "// consumes: economy/tc-transform" annotation');

    // ── 3. Zero-dep invariant ─────────────────────────────────────────────────
    await checkZeroDep('tc-transform.mjs', transformPath, { ok, bad });
    await checkZeroDep('tc-codemod.mjs',   codemodPath,   { ok, bad });

    // ── 4. null plan → TransformValidationError ────────────────────────────────
    { let threw = false;
      try { applyPatchPlan(null); } catch (e) { threw = e instanceof TransformValidationError; }
      threw ? ok('applyPatchPlan(null) → TransformValidationError')
            : bad('applyPatchPlan(null) should throw TransformValidationError'); }

    // ── 5. missing recipeId → TransformValidationError ────────────────────────
    { let threw = false;
      try { applyPatchPlan({ version:'1', allowedPaths:['a/'], patches:[{path:'a/f',newContent:'x'}] }); }
      catch (e) { threw = e instanceof TransformValidationError; }
      threw ? ok('missing recipeId → TransformValidationError')
            : bad('missing recipeId should throw TransformValidationError'); }

    // ── 6. empty allowedPaths → TransformValidationError ─────────────────────
    { let threw = false;
      try { applyPatchPlan({ recipeId:'r', version:'1', allowedPaths:[], patches:[{path:'a/f',newContent:'x'}] }); }
      catch (e) { threw = e instanceof TransformValidationError; }
      threw ? ok('empty allowedPaths → TransformValidationError')
            : bad('empty allowedPaths should throw TransformValidationError'); }

    // ── 7. out-of-scope path → TransformScopeError ───────────────────────────
    { let threw = false;
      try {
        applyPatchPlan({
          recipeId:'r', version:'1',
          allowedPaths:['contextkit/pipeline/'],
          patches:[{ path:'templates/some-other/file.mjs', newContent:'x' }],
        });
      } catch (e) { threw = e instanceof TransformScopeError; }
      threw ? ok('out-of-scope path → TransformScopeError (before any I/O)')
            : bad('out-of-scope path should throw TransformScopeError'); }

    // ── 8. valid plan, dry-run → dryRun:true, receipts:[], preview non-empty ──
    { const { plan } = makeMinimalPlan(tmpDir);
      const r = applyPatchPlan(plan, { write: false, root: tmpDir });
      (r.dryRun === true && r.receipts.length === 0 && r.preview.length > 0)
        ? ok('dry-run: dryRun=true, receipts=[], preview non-empty')
        : bad(`dry-run unexpected: dryRun=${r.dryRun} receipts=${r.receipts.length} preview=${r.preview.length}`); }

    // ── 9. valid plan, write:true → receipts === patches count ───────────────
    { const { plan, targetPath, relPath } = makeMinimalPlan(tmpDir, 'written content');
      // ensure parent dir
      const { mkdirSync } = await import('node:fs');
      mkdirSync(dirname(targetPath), { recursive: true });
      const r = applyPatchPlan(plan, { write: true, root: tmpDir });
      (r.dryRun === false && r.receipts.length === 1 && typeof r.receipts[0].beforeSha256 === 'string')
        ? ok('write mode: receipts.length=1, beforeSha256 present')
        : bad(`write mode unexpected: ${JSON.stringify(r.receipts)}`);

      // ── 10. File content matches newContent ───────────────────────────────
      const written = existsSync(targetPath) ? await readFile(targetPath, 'utf-8') : null;
      written === 'written content'
        ? ok('atomic write: file content matches newContent')
        : bad(`file content mismatch: got ${JSON.stringify(written)}`);

      void relPath; // used implicitly via plan
    }

    // ── 11. CDK-032 advisory: economy signal emitted for large-file scenario ──
    { // Write a large existing file (>2048 bytes) with low diff ratio.
      const largeDir  = join(tmpDir, 'contextkit/pipeline/scratch/');
      const largeFile = join(largeDir, 'large-target.txt');
      const { mkdirSync: mkdirSyncSc } = await import('node:fs');
      mkdirSyncSc(largeDir, { recursive: true });
      const existingLarge = 'x'.repeat(3000);         // 3000 bytes, high overlap
      const newLarge      = 'x'.repeat(2990) + 'y'.repeat(10); // <30% changed
      await writeFile(largeFile, existingLarge, 'utf-8');
      const planLarge = {
        recipeId:'r', version:'1',
        allowedPaths:['contextkit/pipeline/scratch/'],
        patches:[{ path: 'contextkit/pipeline/scratch/large-target.txt', newContent: newLarge }],
      };
      const r = applyPatchPlan(planLarge, { write: false, root: tmpDir });
      r.advisoryLines.length > 0
        ? ok('CDK-032 advisory: economy signal emitted for large-file low-diff scenario')
        : bad('CDK-032 advisory: expected advisory line for large-file scenario'); }

    // ── 12. presentTransform on dry-run → string containing 'DRY-RUN' ────────
    { const { plan } = makeMinimalPlan(tmpDir);
      const r = applyPatchPlan(plan, { write: false, root: tmpDir });
      const s = presentTransform(r);
      (typeof s === 'string' && s.includes('DRY-RUN'))
        ? ok('presentTransform: dry-run result contains "DRY-RUN"')
        : bad(`presentTransform dry-run: "${s}"`); }

    // ── 13. presentTransform(null) → safe string ─────────────────────────────
    { let threw = false; let s = '';
      try { s = presentTransform(null); } catch { threw = true; }
      (!threw && typeof s === 'string' && s.length > 0)
        ? ok('presentTransform(null): safe non-empty string')
        : bad(`presentTransform(null): threw=${threw} output="${s}"`); }

    // ── 14. TC_CODEMOD_SCHEMA_VERSION ─────────────────────────────────────────
    TC_CODEMOD_SCHEMA_VERSION === 'cdk-tc-codemod/1'
      ? ok('TC_CODEMOD_SCHEMA_VERSION === "cdk-tc-codemod/1"')
      : bad(`TC_CODEMOD_SCHEMA_VERSION wrong: ${TC_CODEMOD_SCHEMA_VERSION}`);

    // ── 15. RECIPE_COUNT >= 1 (seed recipe present) ───────────────────────────
    (typeof RECIPE_COUNT === 'number' && RECIPE_COUNT >= 1)
      ? ok(`RECIPE_COUNT=${RECIPE_COUNT} >= 1 (seed recipe present)`)
      : bad(`RECIPE_COUNT=${RECIPE_COUNT} — seed recipe missing from registry`);

    // ── 16. unknown recipeId → CodemodRecipeNotFoundError ────────────────────
    { let threw = false;
      try { runCodemod('nonexistent-recipe-xyz'); } catch (e) { threw = e instanceof CodemodRecipeNotFoundError; }
      threw ? ok('runCodemod unknown id → CodemodRecipeNotFoundError')
            : bad('runCodemod unknown id should throw CodemodRecipeNotFoundError'); }

    // ── 17. seed recipe dry-run → dryRun:true, no write attempted ─────────────
    { const r = runCodemod('seed-noop-comment', { write: false, root: tmpDir, allowMissingTargets: true });
      r.dryRun === true
        ? ok('seed recipe dry-run: dryRun=true')
        : bad(`seed recipe dry-run: dryRun=${r.dryRun}`); }

    // ── 18. seed recipe allowMissingTargets → no throw on missing files ────────
    { let threw = false;
      try { runCodemod('seed-noop-comment', { root: tmpDir, allowMissingTargets: true }); }
      catch { threw = true; }
      !threw ? ok('seed recipe with allowMissingTargets: no throw for missing targets')
             : bad('seed recipe with allowMissingTargets: unexpectedly threw'); }

    // ── 19. findRecipe returns seed recipe ────────────────────────────────────
    { const r = findRecipe('seed-noop-comment');
      (r && typeof r.id === 'string' && typeof r.version === 'string')
        ? ok(`findRecipe('seed-noop-comment'): id=${r.id} version=${r.version}`)
        : bad(`findRecipe('seed-noop-comment') returned unexpected: ${JSON.stringify(r)}`); }

    // ── 20. presentCodemod on valid result → contains recipe id ────────────────
    { const r = runCodemod('seed-noop-comment', { root: tmpDir, allowMissingTargets: true });
      const s = presentCodemod(r);
      (typeof s === 'string' && s.includes('seed-noop-comment'))
        ? ok('presentCodemod: output contains recipe id')
        : bad(`presentCodemod missing recipe id: "${s}"`); }

    // ── 21. presentCodemod(null) → safe string ────────────────────────────────
    { let threw = false; let s = '';
      try { s = presentCodemod(null); } catch { threw = true; }
      (!threw && typeof s === 'string' && s.length > 0)
        ? ok('presentCodemod(null): safe non-empty string')
        : bad(`presentCodemod(null): threw=${threw} output="${s}"`); }

  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------
// Standalone guard — mirrors selfcheck-tc-accept.mjs pattern
// ---------------------------------------------------------------------------

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let failures = 0;
  const ok  = (_m) => {};
  const bad = (m) => { failures++; console.error(`FAIL: ${m}`); };
  const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  runTcTransformChecks({ ok, bad }, { KIT })
    .then(() => process.exit(failures ? 1 : 0))
    .catch((err) => { console.error('selfcheck-tc-transform: unexpected error:', err); process.exit(1); });
}
