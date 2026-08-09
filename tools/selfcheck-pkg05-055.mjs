#!/usr/bin/env node
/**
 * CDK-055 self-test — rule-archive.mjs (PKG-05).
 *
 * Verifies six invariants:
 *   (1) record + reload round-trips — a recorded rule is found in loadRules.
 *   (2) A deprecated rule retains reason, deprecatedAt, and supersededBy.
 *   (3) Re-recording the same text transitions status (active→deprecated)
 *       without duplicating the entry.
 *   (4) Atomic write leaves no tmp file after success.
 *   (5) Malformed ledger JSON causes loadRules to return empty buckets,
 *       not throw.
 *   (6) searchRules finds a rule by a substring of its text or reason.
 *
 * Standalone runnable: node tools/selfcheck-pkg05-055.mjs
 * Exit 0 = PASS, exit 1 = at least one failure.
 *
 * Uses a unique temp directory (mkdtempSync) to avoid collision with
 * parallel test runs. Cleaned up unconditionally on exit.
 */
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

// ---------------------------------------------------------------------------
// Locate the module under test.
// ---------------------------------------------------------------------------
const __dirname = dirname(fileURLToPath(import.meta.url));
const MODULE_PATH = resolve(__dirname, '../templates/contextkit/tools/scripts/rule-archive.mjs');

let loadRules, recordRule, searchRules;
try {
  ({ loadRules, recordRule, searchRules } = await import(pathToFileURL(MODULE_PATH).href));
} catch (err) {
  console.error(`FATAL: cannot import rule-archive.mjs: ${err?.message ?? err}`);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Micro-assertion harness.
// ---------------------------------------------------------------------------
let failures = 0;

const ok  = (msg) => console.log(`  ok  ${msg}`);
const bad = (msg) => { console.error(`  FAIL ${msg}`); failures += 1; };

function assert(label, condition, detail = '') {
  condition ? ok(label) : bad(label + (detail ? ` — ${detail}` : ''));
}

// ---------------------------------------------------------------------------
// Temp root — mirrors contextkit/memory/ layout so pathsFor() resolves correctly.
// ---------------------------------------------------------------------------
const tmpRoot = mkdtempSync(join(tmpdir(), 'cdk055-'));
// rule-archive writes to <root>/contextkit/memory/rule-ledger.json
// pathsFor(root).memory resolves to <root>/contextkit/memory
const memoryDir = join(tmpRoot, 'contextkit', 'memory');
mkdirSync(memoryDir, { recursive: true });
const ledgerFile = join(memoryDir, 'rule-ledger.json');

// ---------------------------------------------------------------------------
// Section 1 — record + reload round-trip.
// ---------------------------------------------------------------------------
console.log('\nSection 1: record + reload round-trip');

const RULE_TEXT = 'Always use atomic writes when persisting ledger state.';
let stored;
try {
  stored = await recordRule(tmpRoot, {
    text: RULE_TEXT,
    status: 'active',
    reason: 'Prevents partial-write corruption under concurrent sessions.',
    adrs: ['ADR-0010'],
  });
  assert('1a stored record returned', stored != null && typeof stored === 'object');
  assert('1b stored.id is a 12-char hex string', /^[0-9a-f]{12}$/.test(stored?.id ?? ''));
  assert('1c stored.status === active', stored?.status === 'active');
  assert('1d stored.recordedAt is an ISO string', typeof stored?.recordedAt === 'string' && stored.recordedAt.includes('T'));
  assert('1e stored.deprecatedAt is null for active rule', stored?.deprecatedAt === null);
  assert('1f stored.adrs contains ADR-0010', stored?.adrs?.includes('ADR-0010'));
} catch (err) {
  bad(`1 recordRule threw unexpectedly: ${err?.message ?? err}`);
}

const groups = await loadRules(tmpRoot);
assert('1g loadRules returns active array', Array.isArray(groups?.active));
const found = groups.active.find((r) => r.text === RULE_TEXT);
assert('1h recorded rule found in active bucket', found != null);
assert('1i loaded rule.id matches stored.id', found?.id === stored?.id);
assert('1j loaded rule.reason round-trips', found?.reason?.includes('partial-write'));

// ---------------------------------------------------------------------------
// Section 2 — deprecated rule retains reason, deprecatedAt, supersededBy.
// ---------------------------------------------------------------------------
console.log('\nSection 2: deprecated rule retains metadata');

const SUPERSEDED_TEXT = 'Never import third-party modules in hooks.';
await recordRule(tmpRoot, {
  text: SUPERSEDED_TEXT,
  status: 'active',
  reason: 'Original zero-dep mandate.',
});
const depRecord = await recordRule(tmpRoot, {
  text: SUPERSEDED_TEXT,
  status: 'deprecated',
  reason: 'Relaxed — optional deps behind dynamic import are now permitted (ADR-0001 §update).',
  supersededBy: '#CDK-055',
  adrs: ['ADR-0001'],
});
assert('2a status is deprecated', depRecord?.status === 'deprecated');
assert('2b reason is updated', depRecord?.reason?.includes('Relaxed'));
assert('2c supersededBy is set', depRecord?.supersededBy === '#CDK-055');
assert('2d deprecatedAt is an ISO string', typeof depRecord?.deprecatedAt === 'string' && depRecord.deprecatedAt.includes('T'));
assert('2e adrs includes ADR-0001', depRecord?.adrs?.includes('ADR-0001'));

// Verify it is in the deprecated bucket after reload.
const groups2 = await loadRules(tmpRoot);
const depFound = groups2.deprecated.find((r) => r.text === SUPERSEDED_TEXT);
assert('2f rule appears in deprecated bucket on reload', depFound != null);
assert('2g deprecatedAt persists across reload', typeof depFound?.deprecatedAt === 'string');

// ---------------------------------------------------------------------------
// Section 3 — re-recording same text transitions status without duplicating.
// ---------------------------------------------------------------------------
console.log('\nSection 3: re-recording transitions without duplication');

const UNIQUE_TEXT = 'Use conventional commits for all changes.';
await recordRule(tmpRoot, { text: UNIQUE_TEXT, status: 'active', reason: 'Consistency.' });
await recordRule(tmpRoot, { text: UNIQUE_TEXT, status: 'deprecated', reason: 'Replaced by squash-commit policy.' });

const groups3 = await loadRules(tmpRoot);
const allRules = [...groups3.active, ...groups3.deprecated, ...groups3.superseded];
const byText = allRules.filter((r) => r.text === UNIQUE_TEXT);
assert('3a only one entry exists for the same text', byText.length === 1, `found ${byText.length}`);
assert('3b entry status is deprecated', byText[0]?.status === 'deprecated');
assert('3c active bucket does not contain the transitioned rule',
  !groups3.active.find((r) => r.text === UNIQUE_TEXT));

// ---------------------------------------------------------------------------
// Section 4 — atomic write leaves no tmp file after success.
// ---------------------------------------------------------------------------
console.log('\nSection 4: atomic write leaves no residual tmp file');

await recordRule(tmpRoot, {
  text: 'Atomic write test rule — post-write no tmp file.',
  status: 'active',
  reason: 'CDK-055 atomic guarantee.',
});

const residualTmps = existsSync(memoryDir)
  ? readdirSync(memoryDir).filter((f) => f.includes('.tmp-'))
  : [];
assert('4a no .tmp- files remain in memory dir after write', residualTmps.length === 0,
  `found: ${residualTmps.join(', ')}`);
assert('4b ledger file exists', existsSync(ledgerFile));

// ---------------------------------------------------------------------------
// Section 5 — malformed ledger JSON → loadRules returns empty, no throw.
// ---------------------------------------------------------------------------
console.log('\nSection 5: malformed ledger JSON degrades gracefully');

// Overwrite ledger with invalid JSON.
writeFileSync(ledgerFile, '{ "version": 1, "rules": [INVALID JSON}', 'utf-8');

let groups5;
let threw = false;
try {
  groups5 = await loadRules(tmpRoot);
} catch (err) {
  threw = true;
  bad(`5a loadRules threw on malformed JSON: ${err?.message ?? err}`);
}
if (!threw) {
  assert('5a loadRules does not throw on malformed JSON', !threw);
  assert('5b active bucket is empty array', Array.isArray(groups5?.active) && groups5.active.length === 0);
  assert('5c deprecated bucket is empty array', Array.isArray(groups5?.deprecated) && groups5.deprecated.length === 0);
  assert('5d superseded bucket is empty array', Array.isArray(groups5?.superseded) && groups5.superseded.length === 0);
}

// ---------------------------------------------------------------------------
// Section 6 — searchRules finds by text/reason term.
// ---------------------------------------------------------------------------
console.log('\nSection 6: searchRules finds by term');

// Restore ledger to a clean state.
writeFileSync(ledgerFile, JSON.stringify({ version: 1, rules: [] }, null, 2), 'utf-8');

await recordRule(tmpRoot, {
  text: 'Always validate input at the boundary.',
  status: 'active',
  reason: 'Fail-fast principle keeps stack traces meaningful.',
});
await recordRule(tmpRoot, {
  text: 'Never swallow exceptions silently.',
  status: 'deprecated',
  reason: 'Superseded by typed error hierarchy policy.',
  supersededBy: '#CDK-042',
});

const matchByText = await searchRules(tmpRoot, 'validate input');
assert('6a searchRules finds rule by text substring', matchByText.length === 1,
  `got ${matchByText.length}`);
assert('6b matched rule has correct text', matchByText[0]?.text?.includes('validate input'));

const matchByReason = await searchRules(tmpRoot, 'Fail-fast');
assert('6c searchRules finds rule by reason substring (case-insensitive)', matchByReason.length === 1,
  `got ${matchByReason.length}`);

const noMatch = await searchRules(tmpRoot, 'xyzzy-not-present-anywhere');
assert('6d searchRules returns [] for unmatched term', noMatch.length === 0);

let searchThrew = false;
try {
  const emptyResult = await searchRules(tmpRoot, '');
  assert('6e searchRules returns [] for empty term', Array.isArray(emptyResult) && emptyResult.length === 0);
} catch {
  searchThrew = true;
  bad('6e searchRules threw on empty term');
}
if (!searchThrew) {
  // Already asserted above.
}

const multiMatch = await searchRules(tmpRoot, 'exception');
assert('6f searchRules finds deprecated rule by reason keyword', multiMatch.length >= 1 &&
  multiMatch.some((r) => r.status === 'deprecated'));

// ---------------------------------------------------------------------------
// Cleanup temp directory.
// ---------------------------------------------------------------------------
try {
  rmSync(tmpRoot, { recursive: true, force: true });
} catch {
  // Best-effort cleanup; leaving a small tmpdir behind is not a test failure.
}

// ---------------------------------------------------------------------------
// Result.
// ---------------------------------------------------------------------------
console.log(
  failures === 0
    ? '\nPASS — selfcheck-pkg05-055 all checks green.\n'
    : `\nFAIL — ${failures} check(s) failed.\n`
);
process.exit(failures === 0 ? 0 : 1);
