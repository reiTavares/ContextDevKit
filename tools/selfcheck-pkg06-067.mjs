#!/usr/bin/env node
/**
 * CDK-067 self-check — cache-churn-health.mjs (PKG-06).
 *
 * WHY: cache-churn-health.mjs (CDK-067) introduces cacheChurnHealth(), a pure
 * scorer that correlates EACP prompt-cache gross value with artifact churn counts
 * (from CDK-068 wiring-drift) into a cache-health band. This suite asserts EXACT
 * output shapes and band assignments on hermetic inputs — no installed files,
 * no real I/O, no network.
 *
 * Invariants verified:
 *   (a) Module exports are present (cacheChurnHealth is a function).
 *   (b) null value + zero churn → skipped (refuse-by-default §8).
 *   (c) 'healthy' band: low churn (total ≤ 1) with positive grossCacheValueUsd.
 *   (d) 'at-risk' band: high churn (total ≥ 5) with positive grossCacheValueUsd;
 *       triggers array is non-empty.
 *   (e) 'at-risk' band: total ≥ 8 regardless of USD value.
 *   (f) 'watch' band: mid-range churn (total 2–4) with known USD.
 *   (g) 'watch' band: any churn with unknown USD (null).
 *   (h) DETERMINISM: same input twice → deep-equal result (no Date.now()).
 *   (i) collectChurn fails open: resolves to numeric triple, never throws, even
 *       on a nonexistent path.
 *   (j) grossCacheValueFor returns null for unknown modelId (refuse-by-default).
 *   (k) presentCacheHealth returns a non-empty string for both healthy and skipped.
 *
 * CDK-040 lesson: ≥1 assertion checks a REAL output value, not just typeof.
 *
 * Standalone: node tools/selfcheck-pkg06-067.mjs
 * Exit 0 = PASS, exit 1 = FAIL.
 */
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MODULE_PATH = resolve(
  __dirname, '../templates/contextkit/tools/scripts/cache-churn-health.mjs'
);

// ---------------------------------------------------------------------------
// Import the module under test
// ---------------------------------------------------------------------------
let cacheChurnHealth, collectChurn, grossCacheValueFor, presentCacheHealth,
    CACHE_CHURN_SCHEMA_VERSION;
try {
  ({
    cacheChurnHealth, collectChurn, grossCacheValueFor, presentCacheHealth,
    CACHE_CHURN_SCHEMA_VERSION,
  } = await import(pathToFileURL(MODULE_PATH).href));
} catch (err) {
  console.error(`FATAL: cannot import cache-churn-health.mjs: ${err?.message ?? err}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Micro-assertion harness (mirrors selfcheck-pkg06-068 pattern)
// ---------------------------------------------------------------------------
let failures = 0;
const ok  = (msg) => console.log(`  ✓ ${msg}`);
const bad = (msg) => { console.error(`  ✗ ${msg}`); failures += 1; };

/**
 * Asserts a condition and emits a pass or fail line.
 * @param {string} label
 * @param {boolean} condition
 */
function assert(label, condition) {
  condition ? ok(label) : bad(label);
}

/**
 * Deep-compares two values via JSON round-trip (sufficient for plain objects).
 * @param {unknown} actual
 * @param {unknown} expected
 * @returns {boolean}
 */
function deepEqual(actual, expected) {
  return JSON.stringify(actual) === JSON.stringify(expected);
}

// ---------------------------------------------------------------------------
// (a) Module exports are present
// ---------------------------------------------------------------------------
console.log('\n(a) module exports\n');

assert('cacheChurnHealth is a function',    typeof cacheChurnHealth    === 'function');
assert('collectChurn is a function',        typeof collectChurn        === 'function');
assert('grossCacheValueFor is a function',  typeof grossCacheValueFor  === 'function');
assert('presentCacheHealth is a function',  typeof presentCacheHealth  === 'function');
assert('CACHE_CHURN_SCHEMA_VERSION is a non-empty string',
  typeof CACHE_CHURN_SCHEMA_VERSION === 'string' && CACHE_CHURN_SCHEMA_VERSION.length > 0);

// ---------------------------------------------------------------------------
// (b) skipped when no signal (null USD + zero churn)
// ---------------------------------------------------------------------------
console.log('\n(b) skipped — null USD and zero churn\n');

{
  const result = cacheChurnHealth({
    grossCacheValueUsd: null,
    churn: { instruction: 0, config: 0, wiring: 0 },
  });
  assert("status === 'skipped'", result?.status === 'skipped');
  assert('reason is a non-empty string',
    typeof result?.reason === 'string' && result.reason.length > 0);
  // CDK-040: check REAL value
  assert("reason mentions 'no cache value'",
    typeof result?.reason === 'string' && result.reason.includes('no cache value'));
}

// ---------------------------------------------------------------------------
// (c) 'healthy' band — low churn with known USD
// ---------------------------------------------------------------------------
console.log("\n(c) 'healthy' band\n");

{
  const result = cacheChurnHealth({
    grossCacheValueUsd: 1.0,
    churn: { instruction: 0, config: 1, wiring: 0 },
  });
  assert("cacheHealth === 'healthy'",       result?.cacheHealth === 'healthy');
  assert('schemaVersion correct',           result?.schemaVersion === CACHE_CHURN_SCHEMA_VERSION);
  assert("confidence === 'derived'",        result?.confidence === 'derived');
  assert('artifactChurn.total === 1',       result?.artifactChurn?.total === 1);
  assert('grossCacheValueUsd === 1.0',      result?.grossCacheValueUsd === 1.0);
  assert('triggers is empty array',         Array.isArray(result?.triggers) && result.triggers.length === 0);
}

// ---------------------------------------------------------------------------
// (d) 'at-risk' band — high churn (≥5) with positive USD
// ---------------------------------------------------------------------------
console.log("\n(d) 'at-risk' band — churn ≥ 5 + positive USD\n");

{
  const result = cacheChurnHealth({
    grossCacheValueUsd: 5.0,
    churn: { instruction: 4, config: 2, wiring: 1 },
  });
  assert("cacheHealth === 'at-risk'",       result?.cacheHealth === 'at-risk');
  assert('artifactChurn.total === 7',       result?.artifactChurn?.total === 7);
  assert('triggers is non-empty',           Array.isArray(result?.triggers) && result.triggers.length > 0);
  // CDK-040: check REAL trigger text
  assert('first trigger mentions churn',
    typeof result?.triggers?.[0] === 'string' && result.triggers[0].includes('churn'));
  assert("confidence === 'derived'",        result?.confidence === 'derived');
}

// ---------------------------------------------------------------------------
// (e) 'at-risk' band — volume floor (total ≥ 8) regardless of USD
// ---------------------------------------------------------------------------
console.log("\n(e) 'at-risk' band — volume floor (≥8)\n");

{
  const result = cacheChurnHealth({
    grossCacheValueUsd: null,
    churn: { instruction: 4, config: 3, wiring: 1 },
  });
  assert("cacheHealth === 'at-risk'",       result?.cacheHealth === 'at-risk');
  assert('artifactChurn.total === 8',       result?.artifactChurn?.total === 8);
  assert('triggers is non-empty',           Array.isArray(result?.triggers) && result.triggers.length > 0);
  assert("confidence === 'inferred' (null USD)", result?.confidence === 'inferred');
}

// ---------------------------------------------------------------------------
// (f) 'watch' band — mid-range churn (2–4) with known USD
// ---------------------------------------------------------------------------
console.log("\n(f) 'watch' band — mid-range churn + known USD\n");

{
  const result = cacheChurnHealth({
    grossCacheValueUsd: 2.5,
    churn: { instruction: 1, config: 1, wiring: 1 },
  });
  assert("cacheHealth === 'watch'",         result?.cacheHealth === 'watch');
  assert('artifactChurn.total === 3',       result?.artifactChurn?.total === 3);
  assert('triggers non-empty',              Array.isArray(result?.triggers) && result.triggers.length > 0);
}

// ---------------------------------------------------------------------------
// (g) 'watch' band — churn present + unknown USD
// ---------------------------------------------------------------------------
console.log("\n(g) 'watch' band — churn present + unknown USD\n");

{
  const result = cacheChurnHealth({
    grossCacheValueUsd: null,
    churn: { instruction: 1, config: 0, wiring: 0 },
  });
  assert("cacheHealth === 'watch'",         result?.cacheHealth === 'watch');
  assert("confidence === 'inferred'",       result?.confidence === 'inferred');
  assert('grossCacheValueUsd is null',      result?.grossCacheValueUsd === null);
}

// ---------------------------------------------------------------------------
// (h) DETERMINISM — same input twice → deep-equal
// ---------------------------------------------------------------------------
console.log('\n(h) determinism\n');

{
  const input = { grossCacheValueUsd: 1.5, churn: { instruction: 2, config: 0, wiring: 1 } };
  const first  = cacheChurnHealth(input);
  const second = cacheChurnHealth(input);
  assert('two calls produce identical JSON', deepEqual(first, second));
  // Unfreeze both for comparison safety (Object.freeze doesn't affect JSON serialization)
  assert("both results have same cacheHealth band", first?.cacheHealth === second?.cacheHealth);
}

// ---------------------------------------------------------------------------
// (i) collectChurn fails open — nonexistent root
// ---------------------------------------------------------------------------
console.log('\n(i) collectChurn fails open on nonexistent path\n');

{
  let result;
  let threw = false;
  try {
    result = await collectChurn('/nonexistent/__does_not_exist__', 7);
  } catch {
    threw = true;
  }
  assert('collectChurn did not throw',      !threw);
  assert('result is a plain object',        result !== null && typeof result === 'object');
  assert('instruction is a number',         typeof result?.instruction === 'number');
  assert('config is a number',              typeof result?.config      === 'number');
  assert('wiring is a number',              typeof result?.wiring      === 'number');
  // Degrade to zeros on unreadable path
  assert('instruction is 0',               result?.instruction === 0);
  assert('config is 0',                    result?.config      === 0);
  assert('wiring is 0',                    result?.wiring      === 0);
}

// ---------------------------------------------------------------------------
// (j) grossCacheValueFor returns null for unknown modelId
// ---------------------------------------------------------------------------
console.log('\n(j) grossCacheValueFor — unknown modelId → null\n');

{
  const buckets = {
    freshInput: 1000, output: 500, cacheRead: 200, cacheWrite: 100, reasoning: 0,
  };
  // Inject a null registry to avoid disk I/O in hermetic test
  const result = grossCacheValueFor(buckets, 'nonexistent-model-xyz', { registry: null });
  assert('returns null for unknown modelId', result === null);
}

// ---------------------------------------------------------------------------
// (k) presentCacheHealth returns non-empty string
// ---------------------------------------------------------------------------
console.log('\n(k) presentCacheHealth formatting\n');

{
  const healthyResult = cacheChurnHealth({
    grossCacheValueUsd: 0.5,
    churn: { instruction: 0, config: 0, wiring: 0 },
  });
  const healthyText = presentCacheHealth(healthyResult);
  assert('healthy result: presentCacheHealth returns a string', typeof healthyText === 'string');
  assert('healthy result: non-empty output', healthyText.length > 0);
  assert("healthy result: mentions 'HEALTHY'", healthyText.toUpperCase().includes('HEALTHY'));

  const skippedResult = cacheChurnHealth({
    grossCacheValueUsd: null,
    churn: { instruction: 0, config: 0, wiring: 0 },
  });
  const skippedText = presentCacheHealth(skippedResult);
  assert('skipped result: presentCacheHealth returns a string', typeof skippedText === 'string');
  assert("skipped result: mentions 'skipped'", skippedText.toLowerCase().includes('skipped'));
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------
console.log(
  failures === 0
    ? '\n  PASS — CDK-067 cache-churn-health self-check: all checks passed.\n'
    : `\n  FAIL — CDK-067 cache-churn-health self-check: ${failures} check(s) failed.\n`,
);
process.exit(failures === 0 ? 0 : 1);
