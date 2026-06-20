#!/usr/bin/env node
/**
 * Self-check — Task-Compiler content-addressed cache (WF0022 / ADR-0089).
 *
 * Verifies the static wiring and runtime invariants exported by
 * `templates/contextkit/tools/scripts/economy/tc-cache.mjs`:
 *   1.  TC_CACHE_SCHEMA_VERSION constant value.
 *   2.  taskCacheKey — valid inputs return a 64-char hex string.
 *   3.  taskCacheKey — identical inputs return the same key (determinism).
 *   4.  taskCacheKey — CRLF normalisation: CRLF source == LF source.
 *   5.  taskCacheKey — different recipeId yields a different key.
 *   6.  taskCacheKey — different recipeVersion yields a different key.
 *   7.  taskCacheKey — different options yields a different key.
 *   8.  taskCacheKey — missing sourceSlice throws TcCacheKeyError.
 *   9.  taskCacheKey — missing recipeId throws TcCacheKeyError.
 *  10.  taskCacheKey — missing recipeVersion throws TcCacheKeyError.
 *  11.  taskCacheKey — options object key-order is stable.
 *  12.  cacheSlotFor — returns an absolute path containing the key.
 *  13.  cacheSlotFor — kind 'rt' embeds .rt.json extension.
 *  14.  isCached — returns false for a non-existent slot.
 *  15.  storeInCache + isCached — round-trip: store, then isCached == true.
 *  16.  readFromCache — returns stored value after round-trip.
 *  17.  isCached — returns false after slot is tampered.
 *  18.  storeInCache — throws TcCacheRedactionError on detected secret.
 *  19.  storeInCache — throws TcCacheKeyError on missing slotPath.
 *  20.  Zero hot-path dep invariant (no non-node:/* or non-relative imports).
 *
 * ADR-0087..0090. Zero runtime dependencies — node:* only.
 */
import { readFile, writeFile, mkdir, rm } from 'node:fs/promises';
import { existsSync }                      from 'node:fs';
import { resolve, join }                   from 'node:path';
import { tmpdir }                          from 'node:os';
import { pathToFileURL }                   from 'node:url';

/**
 * Checks that a module file imports only node:/* and relative paths.
 * @param {string} modPath
 * @returns {Promise<{error:string|null}>}
 */
async function checkZeroDep(modPath) {
  let content = '';
  try { content = await readFile(modPath, 'utf-8'); } catch (err) {
    return { error: `could not read: ${err?.message ?? err}` };
  }
  const importRe = /^import\s+(?:[^"'`]*\s+)?from\s+['"`]([^'"`]+)['"`]/gm;
  let match;
  while ((match = importRe.exec(content)) !== null) {
    const spec = match[1];
    if (!spec.startsWith('.') && !spec.startsWith('node:')) {
      return { error: `imports from "${spec}"` };
    }
  }
  return { error: null };
}

/**
 * Runs Task-Compiler cache self-checks.
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} reporter
 * @param {{ KIT: string }} ctx - repo root
 */
export async function runTcCacheChecks({ ok, bad }, { KIT }) {
  console.log('Checking Task-Compiler content-cache (WF0022 / ADR-0089)...');

  const modPath = resolve(KIT, 'templates/contextkit/tools/scripts/economy/tc-cache.mjs');
  let lib;
  try {
    lib = await import(pathToFileURL(modPath).href);
    ok('tc-cache.mjs imports cleanly');
  } catch (err) {
    bad(`tc-cache.mjs import failed: ${err?.message ?? err}`);
    return;
  }

  const {
    TC_CACHE_SCHEMA_VERSION,
    TcCacheKeyError,
    TcCacheRedactionError,
    taskCacheKey,
    cacheSlotFor,
    isCached,
    readFromCache,
    storeInCache,
  } = lib;

  // ── 1. Schema version ─────────────────────────────────────────────────────
  TC_CACHE_SCHEMA_VERSION === 'cdk-tc-cache/1'
    ? ok('TC_CACHE_SCHEMA_VERSION is "cdk-tc-cache/1"')
    : bad(`TC_CACHE_SCHEMA_VERSION wrong: ${TC_CACHE_SCHEMA_VERSION}`);

  // ── Shared base inputs ────────────────────────────────────────────────────
  const baseInputs = {
    sourceSlice: 'func Foo() {\n  return\n}',
    recipeId:    'patch-plan',
    recipeVersion: '1.0.0',
    options:    { dryRun: true },
    toolVersions: { node: '20.0.0' },
  };

  // ── 2. Valid inputs → 64-char hex ─────────────────────────────────────────
  let key1;
  try {
    key1 = taskCacheKey(baseInputs);
    /^[0-9a-f]{64}$/.test(key1)
      ? ok(`taskCacheKey returns 64-char hex: ${key1.slice(0, 8)}...`)
      : bad(`taskCacheKey returned unexpected format: "${key1}"`);
  } catch (err) {
    bad(`taskCacheKey threw on valid inputs: ${err?.message ?? err}`);
  }

  // ── 3. Determinism ────────────────────────────────────────────────────────
  const key1b = taskCacheKey(baseInputs);
  key1 === key1b
    ? ok('taskCacheKey is deterministic for identical inputs')
    : bad(`taskCacheKey non-deterministic: ${key1} vs ${key1b}`);

  // ── 4. CRLF normalisation ─────────────────────────────────────────────────
  const keyCrlf = taskCacheKey({ ...baseInputs, sourceSlice: 'func Foo() {\r\n  return\r\n}' });
  keyCrlf === key1
    ? ok('taskCacheKey: CRLF source produces same key as LF source')
    : bad('taskCacheKey: CRLF normalisation failed — different keys for CRLF vs LF');

  // ── 5. Different recipeId → different key ─────────────────────────────────
  const keyDiffId = taskCacheKey({ ...baseInputs, recipeId: 'codemod-runner' });
  keyDiffId !== key1
    ? ok('taskCacheKey: different recipeId yields different key')
    : bad('taskCacheKey: different recipeId produced the same key (collision!)');

  // ── 6. Different recipeVersion → different key ────────────────────────────
  const keyDiffVer = taskCacheKey({ ...baseInputs, recipeVersion: '2.0.0' });
  keyDiffVer !== key1
    ? ok('taskCacheKey: different recipeVersion yields different key')
    : bad('taskCacheKey: different recipeVersion produced the same key');

  // ── 7. Different options → different key ──────────────────────────────────
  const keyDiffOpts = taskCacheKey({ ...baseInputs, options: { dryRun: false } });
  keyDiffOpts !== key1
    ? ok('taskCacheKey: different options yields different key')
    : bad('taskCacheKey: different options produced the same key');

  // ── 8. Missing sourceSlice → TcCacheKeyError ──────────────────────────────
  let threw8 = false;
  try { taskCacheKey({ ...baseInputs, sourceSlice: '' }); } catch (err) {
    threw8 = err instanceof TcCacheKeyError;
  }
  threw8
    ? ok('taskCacheKey throws TcCacheKeyError on empty sourceSlice')
    : bad('taskCacheKey should throw TcCacheKeyError on empty sourceSlice');

  // ── 9. Missing recipeId → TcCacheKeyError ────────────────────────────────
  let threw9 = false;
  try { taskCacheKey({ ...baseInputs, recipeId: '' }); } catch (err) {
    threw9 = err instanceof TcCacheKeyError;
  }
  threw9
    ? ok('taskCacheKey throws TcCacheKeyError on empty recipeId')
    : bad('taskCacheKey should throw TcCacheKeyError on empty recipeId');

  // ── 10. Missing recipeVersion → TcCacheKeyError ───────────────────────────
  let threw10 = false;
  try { taskCacheKey({ ...baseInputs, recipeVersion: '' }); } catch (err) {
    threw10 = err instanceof TcCacheKeyError;
  }
  threw10
    ? ok('taskCacheKey throws TcCacheKeyError on empty recipeVersion')
    : bad('taskCacheKey should throw TcCacheKeyError on empty recipeVersion');

  // ── 11. Options key-order stability ──────────────────────────────────────
  const keyOrd1 = taskCacheKey({ ...baseInputs, options: { a: 1, b: 2 } });
  const keyOrd2 = taskCacheKey({ ...baseInputs, options: { b: 2, a: 1 } });
  keyOrd1 === keyOrd2
    ? ok('taskCacheKey: options key-order is stable (sorted canonical)')
    : bad('taskCacheKey: options key-order changed the key — not canonical');

  // ── 12. cacheSlotFor — returns absolute path containing key ──────────────
  const slot = cacheSlotFor(baseInputs, KIT);
  typeof slot === 'string' && slot.includes(key1)
    ? ok(`cacheSlotFor returns path containing key: ...${slot.slice(-30)}`)
    : bad(`cacheSlotFor slot path unexpected: "${slot}"`);

  // ── 13. cacheSlotFor — kind 'rt' embeds .rt.json ─────────────────────────
  const slotRt = cacheSlotFor({ ...baseInputs, kind: 'rt' }, KIT);
  slotRt.endsWith('.rt.json')
    ? ok('cacheSlotFor: kind "rt" results in .rt.json extension')
    : bad(`cacheSlotFor: expected .rt.json, got "${slotRt.slice(-12)}"`);

  // ── 14. isCached — false for nonexistent slot ─────────────────────────────
  const missSlot = resolve(tmpdir(), `tc-cache-selfcheck-${process.pid}`, 'miss.wp.json');
  isCached(missSlot) === false
    ? ok('isCached returns false for nonexistent slot')
    : bad('isCached should return false for nonexistent slot');

  // ── 15–17. Round-trip and tampering ──────────────────────────────────────
  const tmpDir = join(tmpdir(), `tc-cache-check-${process.pid}`);
  try {
    await mkdir(tmpDir, { recursive: true });
    const testSlot = join(tmpDir, 'test-entry.wp.json');
    const testValue = { taskId: 'T-001', result: 'patch applied', score: 42 };

    const stored = storeInCache(testSlot, testValue);
    stored === true
      ? ok('storeInCache returns true on success')
      : bad(`storeInCache should return true, got: ${stored}`);

    // 15. isCached after store
    isCached(testSlot)
      ? ok('isCached returns true after storeInCache')
      : bad('isCached should return true after storeInCache');

    // 16. readFromCache returns the stored value
    const read = readFromCache(testSlot);
    JSON.stringify(read) === JSON.stringify(testValue)
      ? ok('readFromCache returns the stored value faithfully')
      : bad(`readFromCache returned unexpected: ${JSON.stringify(read)}`);

    // 17. isCached false after tampering
    const raw = await readFile(testSlot, 'utf-8');
    const tampered = raw.replace('"score":42', '"score":99');
    await writeFile(testSlot, tampered, 'utf-8');
    isCached(testSlot) === false
      ? ok('isCached returns false after slot is tampered')
      : bad('isCached should detect tampering and return false');

  } finally {
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }

  // ── 18. storeInCache — TcCacheRedactionError on secret ───────────────────
  const secretSlot = join(tmpdir(), `tc-cache-secret-${process.pid}.wp.json`);
  let threw18 = false;
  try {
    storeInCache(secretSlot, {
      key: 'AKIAIOSFODNN7EXAMPLE',
      value: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY',
    });
  } catch (err) {
    threw18 = err instanceof TcCacheRedactionError;
  }
  threw18
    ? ok('storeInCache throws TcCacheRedactionError when secret detected in value')
    : bad('storeInCache should throw TcCacheRedactionError on detected secret');
  // Cleanup in case it somehow stored
  await rm(secretSlot, { force: true }).catch(() => {});

  // ── 19. storeInCache — TcCacheKeyError on missing slotPath ───────────────
  let threw19 = false;
  try { storeInCache('', { x: 1 }); } catch (err) {
    threw19 = err instanceof TcCacheKeyError;
  }
  threw19
    ? ok('storeInCache throws TcCacheKeyError on empty slotPath')
    : bad('storeInCache should throw TcCacheKeyError on empty slotPath');

  // ── 20. Zero hot-path dep invariant ──────────────────────────────────────
  const depResult = await checkZeroDep(modPath);
  depResult.error === null
    ? ok('zero-dep: tc-cache.mjs imports only node:/* or relative paths')
    : bad(`zero-dep violation: tc-cache.mjs ${depResult.error}`);
}

// ---------------------------------------------------------------------------
// Standalone runner
// ---------------------------------------------------------------------------

if (process.argv[1] && process.argv[1].endsWith('selfcheck-tc-cache.mjs')) {
  const { dirname: _dirname, resolve: _resolve } = await import('node:path');
  const { fileURLToPath: _ftu } = await import('node:url');
  const KIT = _resolve(_dirname(_ftu(import.meta.url)), '..');
  let failures = 0;
  const ok  = (m) => console.log(`  ✓ ${m}`);
  const bad = (m) => { console.error(`  ✗ ${m}`); failures++; };
  await runTcCacheChecks({ ok, bad }, { KIT });
  process.exit(failures === 0 ? 0 : 1);
}
