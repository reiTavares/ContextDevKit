/**
 * Self-check — Task-Compiler scaffold-from-pattern (WF0022 / ADR-0089).
 *
 * Verifies the static wiring and runtime invariants exported by
 * `templates/contextkit/tools/scripts/economy/tc-scaffold.mjs`:
 *
 *  1.  TC_SCAFFOLD_SCHEMA_VERSION === 'cdk-tc-scaffold/1'.
 *  2.  PATTERN_COUNT >= 1 (seed pattern present).
 *  3.  '// consumes: economy/tc-transform' annotation in source.
 *  4.  Zero hot-path dep invariant (node:/* or relative only).
 *  5.  null request → ScaffoldValidationError (before any I/O).
 *  6.  missing patternId → ScaffoldValidationError.
 *  7.  vars with non-string value → ScaffoldValidationError.
 *  8.  unknown patternId → ScaffoldPatternNotFoundError.
 *  9.  findPattern('seed-inert-module') → id + version.
 * 10.  seed dry-run → dryRun:true, receipts:[], preview non-empty.
 * 11.  seed write:true → receipts.length >= 1, afterSha256 present.
 * 12.  written file content matches rendered template.
 * 13.  secret in vars → REFUSED in dry-run (refused list non-empty).
 * 14.  secret in vars + write:true → ScaffoldSecretError (no write).
 * 15.  presentScaffold dry-run result contains 'DRY-RUN'.
 * 16.  presentScaffold(null) → safe non-empty string (no throw).
 *
 * ADR-0089. Zero runtime dependencies — node:* only.
 */
import { readFile, mkdtemp, rm }     from 'node:fs/promises';
import { existsSync }                 from 'node:fs';
import { resolve, join, dirname }     from 'node:path';
import { tmpdir }                     from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Checks that a module file imports only node:/* and relative paths.
 * @param {string} filePath
 * @param {{ ok:(m:string)=>void, bad:(m:string)=>void }} reporter
 */
async function checkZeroDep(filePath, { ok, bad }) {
  let src = '';
  try { src = await readFile(filePath, 'utf-8'); } catch (e) {
    bad(`tc-scaffold.mjs: cannot read — ${e?.message}`); return;
  }
  const re = /^import\s+(?:[^"'`]*\s+)?from\s+['"`]([^'"`]+)['"`]/gm;
  let m;
  while ((m = re.exec(src)) !== null) {
    if (!m[1].startsWith('.') && !m[1].startsWith('node:')) {
      bad(`tc-scaffold.mjs: imports from "${m[1]}"`); return;
    }
  }
  ok('tc-scaffold.mjs: zero-dep invariant');
}

// ---------------------------------------------------------------------------
// Exported runner (required signature — mirrors selfcheck-tc-cache.mjs)
// ---------------------------------------------------------------------------

/**
 * Runs Task-Compiler scaffold-from-pattern self-checks.
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} reporter
 * @param {{ KIT: string }} ctx - repo root
 */
export async function runTcScaffoldChecks({ ok, bad }, { KIT }) {
  console.log('Checking Task-Compiler scaffold-from-pattern (WF0022 / ADR-0089)...');

  const modPath = resolve(KIT, 'templates/contextkit/tools/scripts/economy/tc-scaffold.mjs');
  let lib;
  try {
    lib = await import(pathToFileURL(modPath).href);
    ok('tc-scaffold.mjs imports cleanly');
  } catch (e) {
    bad(`tc-scaffold.mjs import failed: ${e?.message ?? e}`);
    return;
  }

  const {
    TC_SCAFFOLD_SCHEMA_VERSION,
    PATTERN_COUNT,
    ScaffoldValidationError,
    ScaffoldSecretError,
    ScaffoldPatternNotFoundError,
    findPattern,
    runScaffold,
    presentScaffold,
  } = lib;

  // ── 1. Schema version ─────────────────────────────────────────────────────
  TC_SCAFFOLD_SCHEMA_VERSION === 'cdk-tc-scaffold/1'
    ? ok('TC_SCAFFOLD_SCHEMA_VERSION === "cdk-tc-scaffold/1"')
    : bad(`TC_SCAFFOLD_SCHEMA_VERSION wrong: ${TC_SCAFFOLD_SCHEMA_VERSION}`);

  // ── 2. Seed pattern present ───────────────────────────────────────────────
  (typeof PATTERN_COUNT === 'number' && PATTERN_COUNT >= 1)
    ? ok(`PATTERN_COUNT=${PATTERN_COUNT} >= 1 (seed pattern present)`)
    : bad(`PATTERN_COUNT=${PATTERN_COUNT} — seed pattern missing`);

  // ── 3. '// consumes:' annotation ─────────────────────────────────────────
  const src = await readFile(modPath, 'utf-8').catch(() => '');
  src.includes('// consumes: economy/tc-transform')
    ? ok('tc-scaffold.mjs: "// consumes: economy/tc-transform" annotation present')
    : bad('tc-scaffold.mjs: missing "// consumes: economy/tc-transform" annotation');

  // ── 4. Zero-dep invariant ─────────────────────────────────────────────────
  await checkZeroDep(modPath, { ok, bad });

  // ── 5. null request → ScaffoldValidationError ────────────────────────────
  { let threw = false;
    try { runScaffold(null); } catch (e) { threw = e instanceof ScaffoldValidationError; }
    threw ? ok('runScaffold(null) → ScaffoldValidationError')
          : bad('runScaffold(null) should throw ScaffoldValidationError'); }

  // ── 6. missing patternId → ScaffoldValidationError ───────────────────────
  { let threw = false;
    try { runScaffold({ patternId: '', vars: {} }); } catch (e) {
      threw = e instanceof ScaffoldValidationError;
    }
    threw ? ok('missing patternId → ScaffoldValidationError')
          : bad('missing patternId should throw ScaffoldValidationError'); }

  // ── 7. vars with non-string value → ScaffoldValidationError ──────────────
  { let threw = false;
    try { runScaffold({ patternId: 'seed-inert-module', vars: { MODULE_NAME: 42 } }); }
    catch (e) { threw = e instanceof ScaffoldValidationError; }
    threw ? ok('non-string var value → ScaffoldValidationError')
          : bad('non-string var value should throw ScaffoldValidationError'); }

  // ── 8. unknown patternId → ScaffoldPatternNotFoundError ──────────────────
  { let threw = false;
    try { runScaffold({ patternId: 'nonexistent-xyz', vars: {} }); }
    catch (e) { threw = e instanceof ScaffoldPatternNotFoundError; }
    threw ? ok('unknown patternId → ScaffoldPatternNotFoundError')
          : bad('unknown patternId should throw ScaffoldPatternNotFoundError'); }

  // ── 9. findPattern returns the seed ──────────────────────────────────────
  { const p = findPattern('seed-inert-module');
    (p && typeof p.id === 'string' && typeof p.version === 'string')
      ? ok(`findPattern('seed-inert-module'): id=${p.id} version=${p.version}`)
      : bad(`findPattern returned unexpected: ${JSON.stringify(p)}`); }

  // ── 10–12. Write and dry-run mode using a temp directory ──────────────────
  const tmpDir = await mkdtemp(join(tmpdir(), 'tc-scaffold-selfcheck-'));
  try {
    const vars = { MODULE_NAME: 'my-module', DESCRIPTION: 'Selfcheck generated module' };

    // ── 10. Dry-run → dryRun:true, receipts:[], preview non-empty ────────
    { const r = runScaffold({ patternId: 'seed-inert-module', vars, root: tmpDir, write: false });
      (r.dryRun === true && r.receipts.length === 0 && r.preview.length > 0)
        ? ok('dry-run: dryRun=true, receipts=[], preview non-empty')
        : bad(`dry-run unexpected: dryRun=${r.dryRun} receipts=${r.receipts.length} preview=${r.preview.length}`); }

    // ── 11. Write mode → receipts.length >= 1, afterSha256 present ───────
    { const r = runScaffold({ patternId: 'seed-inert-module', vars, root: tmpDir, write: true });
      (r.dryRun === false && r.receipts.length >= 1 && typeof r.receipts[0].afterSha256 === 'string')
        ? ok('write mode: receipts.length>=1, afterSha256 present')
        : bad(`write mode unexpected: dryRun=${r.dryRun} receipts=${r.receipts.length}`);

      // ── 12. Written file content contains the rendered module name ────
      const writtenPath = resolve(tmpDir, 'contextkit/pipeline/scratch/my-module.mjs');
      const content = existsSync(writtenPath)
        ? await readFile(writtenPath, 'utf-8')
        : null;
      (content && content.includes('my-module'))
        ? ok('written file content contains rendered MODULE_NAME')
        : bad(`written file missing MODULE_NAME: ${content === null ? 'file not found' : 'content wrong'}`); }

  } finally {
    await rm(tmpDir, { recursive: true, force: true });
  }

  // ── 13. Secret in vars → refused in dry-run ───────────────────────────────
  // Inject a value that matches the AWS key pattern to trigger a refusal.
  { const r = runScaffold({
      patternId: 'seed-inert-module',
      vars: { MODULE_NAME: 'AKIAIOSFODNN7EXAMPLE', DESCRIPTION: 'test' },
      write: false,
    });
    r.refused.length > 0
      ? ok('secret in vars → refused list non-empty in dry-run')
      : bad('secret in vars → expected at least one refused path'); }

  // ── 14. Secret in vars + write:true → ScaffoldSecretError ────────────────
  { let threw = false;
    try {
      runScaffold({
        patternId: 'seed-inert-module',
        vars: { MODULE_NAME: 'AKIAIOSFODNN7EXAMPLE', DESCRIPTION: 'test' },
        write: true,
      });
    } catch (e) { threw = e instanceof ScaffoldSecretError; }
    threw ? ok('secret + write:true → ScaffoldSecretError (no write)')
          : bad('secret + write:true should throw ScaffoldSecretError'); }

  // ── 15. presentScaffold dry-run result contains 'DRY-RUN' ────────────────
  { const r = runScaffold({
      patternId: 'seed-inert-module',
      vars: { MODULE_NAME: 'test-mod', DESCRIPTION: 'test' },
      write: false,
    });
    const s = presentScaffold(r);
    (typeof s === 'string' && s.includes('DRY-RUN'))
      ? ok('presentScaffold: dry-run result contains "DRY-RUN"')
      : bad(`presentScaffold dry-run: "${s}"`); }

  // ── 16. presentScaffold(null) → safe non-empty string ────────────────────
  { let threw = false; let s = '';
    try { s = presentScaffold(null); } catch { threw = true; }
    (!threw && typeof s === 'string' && s.length > 0)
      ? ok('presentScaffold(null): safe non-empty string')
      : bad(`presentScaffold(null): threw=${threw} output="${s}"`); }
}

// ---------------------------------------------------------------------------
// Standalone runner — mirrors selfcheck-tc-transform.mjs pattern
// ---------------------------------------------------------------------------

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  let failures = 0;
  const ok  = (_m) => {};
  const bad = (m)  => { failures++; console.error(`FAIL: ${m}`); };
  const KIT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  runTcScaffoldChecks({ ok, bad }, { KIT })
    .then(() => process.exit(failures ? 1 : 0))
    .catch((err) => {
      console.error('selfcheck-tc-scaffold: unexpected error:', err);
      process.exit(1);
    });
}
