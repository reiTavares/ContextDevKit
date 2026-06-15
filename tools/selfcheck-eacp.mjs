/**
 * Self-check — EACP (Economic Capability + Privacy, WF0018 Wave 1).
 *
 * Asserts the economics measurement pipeline is internally sound:
 * - Bucket arithmetic (throughput, close-check, delta normalization).
 * - Event schema + normalization (fail-fast on invalid, deterministic stamps).
 * - Attribution lenses (confidence tiers, aggregation per agent/model/skill).
 * - Privacy guards (redaction, retention, content-read/send gates).
 * - Adapter identity + capability declaration.
 * - Zero-dep invariant (no non-node:/* imports in economics modules).
 *
 * ADR-0078 / ADR-0081. Zero runtime dependencies — node:* only.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/**
 * Checks that a module file imports only node:/* and relative paths.
 * @private
 */
async function checkModuleZeroDep(name, modPath) {
  let content = '';
  try {
    content = await readFile(modPath, 'utf-8');
  } catch (err) {
    return { error: `could not read: ${err?.message ?? err}` };
  }
  const importRegex = /^import\s+(?:[^"'`]*\s+)?from\s+['"`]([^'"`]+)['"`]/gm;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const spec = match[1];
    if (!spec.startsWith('.') && !spec.startsWith('node:')) {
      return { error: `imports from "${spec}"` };
    }
  }
  return { error: null };
}

/**
 * Runs the EACP measurement + privacy checks.
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} reporter
 * @param {{ KIT: string }} ctx - repo root
 */
export async function runEacpChecks({ ok, bad }, { KIT }) {
  console.log('Checking EACP measurement core + privacy (WF0018 Wave 1)...');
  const econ = 'templates/contextkit/tools/scripts/economics';
  const mods = [
    ['usage-buckets.mjs', resolve(KIT, `${econ}/usage-buckets.mjs`)],
    ['usage-event.mjs', resolve(KIT, `${econ}/usage-event.mjs`)],
    ['attribution-lenses.mjs', resolve(KIT, `${econ}/attribution-lenses.mjs`)],
    ['privacy.mjs', resolve(KIT, `${econ}/privacy.mjs`)],
    ['retention.mjs', resolve(KIT, `${econ}/retention.mjs`)],
    ['adapters/claude-code.mjs', resolve(KIT, `${econ}/adapters/claude-code.mjs`)],
    ['fixtures/load-fixtures.mjs', resolve(KIT, `${econ}/fixtures/load-fixtures.mjs`)],
  ];

  const libs = {};
  for (const [name, path] of mods) {
    try {
      libs[name] = await import(pathToFileURL(path).href);
      ok(`${name} imports cleanly`);
    } catch (err) {
      bad(`${name} import failed: ${err?.message ?? err}`);
      return;
    }
  }

  const [bucketsLib, eventLib, lensesLib, privacyLib, retentionLib, adapterLib, fixtureLib] = Object.values(libs);
  const { delta, cumulative, golden } = (() => {
    try {
      return fixtureLib.loadFixtures();
    } catch (err) {
      bad(`loadFixtures() failed: ${err?.message ?? err}`);
      throw err;
    }
  })();

  // === ASSERTION 1: Bucket-close (consistency gate) ===
  const {
    emptyBuckets, throughput, bucketsClose, toDelta, BUCKET_KEYS
  } = bucketsLib;
  const { normalizeEvent, SCHEMA_VERSION } = eventLib;

  let bucketClosePass = true;
  for (const event of delta) {
    if (!bucketsClose(event)) {
      bad(`bucketsClose failed on delta event: ${JSON.stringify(event)}`);
      bucketClosePass = false;
      break;
    }
  }
  if (bucketClosePass) ok('bucketsClose: all delta events satisfy the platform invariant');

  // Test hand-built event with disagreeing total
  const fakeBad = {
    buckets: { freshInput: 10, output: 20, cacheRead: 30, cacheWrite: 0, reasoning: 0 },
    total: 999, // Lies; should be 60.
  };
  !bucketsClose(fakeBad)
    ? ok('bucketsClose: rejects an event where total ≠ sum(buckets)')
    : bad('bucketsClose: should have rejected mismatched total');

  // === ASSERTION 2: Fail-fast normalization ===
  let normalizeThrew = false;
  try {
    normalizeEvent({});
  } catch {
    normalizeThrew = true;
  }
  normalizeThrew
    ? ok('normalizeEvent: throws on missing required fields (fail-fast)')
    : bad('normalizeEvent: should throw on empty object');

  let normValid = false;
  try {
    const normalized = normalizeEvent(delta[0]);
    normValid = normalized.schemaVersion === SCHEMA_VERSION;
  } catch {
    // Intentional: test fixture should normalize cleanly.
  }
  normValid
    ? ok('normalizeEvent: fixture event normalizes and stamps schemaVersion')
    : bad('normalizeEvent: fixture event failed to normalize');

  // === ASSERTION 3: Cumulative-trap regression (keystone) ===
  const deltaTotal = delta.reduce((sum, e) => sum + throughput(e.buckets), 0);
  const naiveSum = cumulative.reduce((sum, e) => sum + throughput(e.buckets), 0);
  const normalizedDelta = toDelta(cumulative);
  const normalizedSum = normalizedDelta.reduce((sum, e) => sum + throughput(e.buckets), 0);

  if (naiveSum > deltaTotal && normalizedSum === deltaTotal) {
    ok(`cumulative-trap: naive ${naiveSum} > delta ${deltaTotal}, toDelta normalizes to ${normalizedSum}`);
  } else {
    bad(
      `cumulative-trap: expected naive > delta and normalized == delta; ` +
      `got naive=${naiveSum} delta=${deltaTotal} normalized=${normalizedSum}`
    );
  }

  // Golden-number agreement
  if (
    deltaTotal === golden.deltaTotalThroughput &&
    naiveSum === golden.naiveCumulativeSum &&
    normalizedSum === golden.normalizedCumulativeTotal
  ) {
    ok(`cumulative-trap golden numbers match (regression frozen)`);
  } else {
    bad(
      `cumulative-trap golden mismatch: ` +
      `expected [${golden.deltaTotalThroughput}, ${golden.naiveCumulativeSum}, ${golden.normalizedCumulativeTotal}] ` +
      `got [${deltaTotal}, ${naiveSum}, ${normalizedSum}]`
    );
  }

  // === ASSERTION 4: Attribution confidence ===
  const { inclusive, exclusiveBySkill, byAgent, byModel, CONFIDENCE } = lensesLib;

  const incRes = inclusive(delta);
  incRes.confidence === CONFIDENCE.DIRECT
    ? ok('attribution: inclusive returns confidence="direct"')
    : bad(`attribution: inclusive confidence is ${incRes.confidence}, expected "direct"`);

  const exRes = exclusiveBySkill(delta, 'log-session');
  exRes.confidence === CONFIDENCE.DERIVED
    ? ok('attribution: exclusiveBySkill returns confidence="derived"')
    : bad(`attribution: exclusiveBySkill confidence is ${exRes.confidence}, expected "derived"`);

  const agRes = byAgent(delta);
  agRes.main && agRes.subagent
    ? ok('attribution: byAgent returns both main and subagent buckets')
    : bad('attribution: byAgent missing main or subagent bucket');

  const modRes = byModel(delta);
  const models = Object.keys(modRes.byModel || {});
  models.length > 0 && models.some((m) => delta.some((e) => e.modelEffective === m))
    ? ok(`attribution: byModel includes fixture models (${models.join(', ')})`)
    : bad('attribution: byModel missing fixture models');

  // === ASSERTION 5: Privacy defaults fail-safe ===
  const {
    PRIVACY_DEFAULTS, resolvePrivacyConfig, contentReadsAllowed, externalSendAllowed, redactPath, skipped
  } = privacyLib;

  PRIVACY_DEFAULTS.mode === 'metadata-only' && !PRIVACY_DEFAULTS.contentReads && !PRIVACY_DEFAULTS.externalSend
    ? ok('privacy: PRIVACY_DEFAULTS enforces metadata-only + no external send')
    : bad(`privacy: PRIVACY_DEFAULTS wrong (mode=${PRIVACY_DEFAULTS.mode})`);

  const resolved = resolvePrivacyConfig({});
  !contentReadsAllowed(resolved) && !externalSendAllowed(resolved)
    ? ok('privacy: resolvePrivacyConfig(garbage) → safe defaults')
    : bad('privacy: resolvePrivacyConfig did not apply safe defaults');

  const path1 = redactPath('a/b/secret.txt', resolved);
  const path2 = redactPath('a/b/secret.txt', resolved);
  path1 === path2 && path1 !== 'a/b/secret.txt'
    ? ok('privacy: redactPath is deterministic and redacts when enabled')
    : bad(`privacy: redactPath not deterministic or not redacting (${path1} vs ${path2})`);

  const skipped1 = skipped('test reason');
  skipped1.status === 'skipped' && skipped1.reason === 'test reason'
    ? ok('privacy: skipped() returns the freeze-dried marker')
    : bad('privacy: skipped() returned wrong shape');

  // === ASSERTION 6: Retention ===
  const { withinRetention, purge } = retentionLib;

  const now = Date.now();
  const recent = { ts: now - 1000 }; // 1 second ago
  const ancient = { ts: now - 100 * 24 * 60 * 60 * 1000 }; // 100 days ago
  const noTs = { foo: 'bar' };

  withinRetention(recent, now, resolved)
    ? ok('retention: withinRetention accepts recent records')
    : bad('retention: withinRetention rejected a recent record');

  !withinRetention(ancient, now, resolved)
    ? ok('retention: withinRetention rejects old records (> retentionDays)')
    : bad('retention: withinRetention accepted an ancient record');

  !withinRetention(noTs, now, resolved)
    ? ok('retention: withinRetention rejects records without ts (fail-closed)')
    : bad('retention: withinRetention accepted a record without ts');

  const records = [recent, ancient, noTs];
  const purged = purge(records, now, resolved);
  purged.kept.length === 1 && purged.purgedCount === 2
    ? ok(`retention: purge filters correctly (kept 1, purged 2)`)
    : bad(`retention: purge result wrong (kept ${purged.kept.length}, purged ${purged.purgedCount})`);

  // === ASSERTION 7: Adapter ===
  const { ADAPTER, declares, adapt } = adapterLib;

  ADAPTER === 'claude-code'
    ? ok('adapter: ADAPTER identity stamped correctly')
    : bad(`adapter: ADAPTER is ${ADAPTER}, expected "claude-code"`);

  adapt(null) === null && adapt({}) === null
    ? ok('adapter: adapt(null/empty) returns null (no throw)')
    : bad('adapter: adapt did not return null on empty input');

  // Synthesize a usage line and adapt it
  const syntheticLine = {
    message: {
      model: 'claude-opus-4-1',
      usage: {
        input_tokens: 100,
        output_tokens: 50,
        cache_read_input_tokens: 1000,
        cache_creation_input_tokens: 200,
      },
    },
    isSidechain: false,
    sessionId: 'test-sess',
    timestamp: now,
  };
  const adapted = adapt(syntheticLine);
  adapted && bucketsClose(adapted) && adapted.agentScope === 'main'
    ? ok('adapter: adapt + bucketsClose pass on synthetic usage line')
    : bad('adapter: adapted event failed bucketsClose or has wrong agentScope');

  const decl = declares();
  decl.quotaAvailable === false
    ? ok('adapter: declares().quotaAvailable === false (quota not in transcript)')
    : bad(`adapter: declares().quotaAvailable should be false, got ${decl.quotaAvailable}`);

  // === ASSERTION 8: Zero-dep invariant ===
  let zeroDepsOk = true;
  for (const [name, path] of mods) {
    const result = await checkModuleZeroDep(name, path);
    if (result.error) {
      bad(`zero-dep: ${name} ${result.error}`);
      zeroDepsOk = false;
    }
  }
  if (zeroDepsOk) ok('zero-dep invariant: all economics modules import only node:/* or relative paths');
}
