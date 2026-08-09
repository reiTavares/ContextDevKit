/**
 * Self-check — EACP Wave 3 pressure + map-effectiveness layer (cards #236/#237).
 *
 * Asserts the session-pressure scorer, map-effectiveness analyzer, and
 * report-advisories surfacing seam are internally sound:
 * - Schema version constants for both modules.
 * - deriveSignals: present-array correctness + cacheReadPerTurn not in present.
 * - pressureScore: healthy/critical bands, skipped marker, single-signal inferred.
 * - readFacts: empty → skipped; full scenario (map, searches, repeated reads);
 *   path redaction format; no-map scenario.
 * - normalizeToolUse: Read→read, project-map Read→map, Glob/Grep→search,
 *   unknown→null, non-string name→null.
 * - advisorySummary: empty perSession → pressure skipped; populated → bands +
 *   hottest + schemaVersion; empty toolEvents → mapEffectiveness skipped; with
 *   toolEvents → mapEffectiveness facts.
 * - presentAdvisories: skipped markers emit "skipped"; populated emits known labels.
 * - Zero-dep invariant on all three new modules.
 *
 * Mirrors the structure of selfcheck-eacp-cost.mjs exactly.
 *
 * Cohesion note (constitution §1, +10% tolerance): this is one cohesive
 * assertion suite for a single wave — splitting the ok()/bad() list across files
 * would be premature abstraction with no second consumer. Kept under the 308 cap.
 *
 * Zero runtime dependencies — node:* only.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** @private — copy from selfcheck-eacp.mjs (not exported there). */
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
 * Runs EACP Wave 3 (session-pressure + map-effectiveness + advisories) checks.
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} reporter
 * @param {{ KIT: string }} ctx - repo root
 */
export async function runEacpPressureChecks({ ok, bad }, { KIT }) {
  console.log('Checking EACP Wave 3 pressure + map-effectiveness layer (cards #236/#237)...');
  const econ = 'templates/contextkit/tools/scripts/economics';
  const modDefs = [
    ['session-pressure.mjs',  resolve(KIT, `${econ}/session-pressure.mjs`)],
    ['map-effectiveness.mjs', resolve(KIT, `${econ}/map-effectiveness.mjs`)],
    ['report-advisories.mjs', resolve(KIT, `${econ}/report-advisories.mjs`)],
  ];

  const libs = {};
  for (const [name, path] of modDefs) {
    try {
      libs[name] = await import(pathToFileURL(path).href);
      ok(`${name} imports cleanly`);
    } catch (err) {
      bad(`${name} import failed: ${err?.message ?? err}`);
      return; // Cannot assert anything without the modules.
    }
  }

  const pressLib = libs['session-pressure.mjs'];
  const mapLib   = libs['map-effectiveness.mjs'];
  const repLib   = libs['report-advisories.mjs'];

  // ── Schema version constants ──────────────────────────────────────────────

  // 1. Pressure schema version
  pressLib.PRESSURE_SCHEMA_VERSION === 'eacp-pressure/1'
    ? ok('pressure: PRESSURE_SCHEMA_VERSION === "eacp-pressure/1"')
    : bad(`pressure: PRESSURE_SCHEMA_VERSION is "${pressLib.PRESSURE_SCHEMA_VERSION}"`);

  // 2. Map-effectiveness schema version
  mapLib.MAP_EFFECTIVENESS_SCHEMA_VERSION === 'eacp-map-effectiveness/1'
    ? ok('map-effectiveness: MAP_EFFECTIVENESS_SCHEMA_VERSION === "eacp-map-effectiveness/1"')
    : bad(`map-effectiveness: MAP_EFFECTIVENESS_SCHEMA_VERSION is "${mapLib.MAP_EFFECTIVENESS_SCHEMA_VERSION}"`);

  // ── deriveSignals ─────────────────────────────────────────────────────────

  // 3. Full row: present array has 4 scored keys; cacheReadPerTurn NOT in present
  const fullRow = { sid: 'a', total: 1000000, turns: 10, cacheRead: 900000, cacheCreate: 50000 };
  const sig = pressLib.deriveSignals(fullRow);
  const presentSet = new Set(sig.present);
  (presentSet.has('totalTokens') && presentSet.has('turns') &&
   presentSet.has('meanTokensPerTurn') && presentSet.has('cacheWriteRatio'))
    ? ok('deriveSignals: full row has totalTokens, turns, meanTokensPerTurn, cacheWriteRatio in present')
    : bad(`deriveSignals: present array wrong: ${JSON.stringify(sig.present)}`);

  !presentSet.has('cacheReadPerTurn')
    ? ok('deriveSignals: cacheReadPerTurn is NOT in present (observed-only, not scored)')
    : bad('deriveSignals: cacheReadPerTurn must not be in present (would dilute scoring)');

  // cacheReadPerTurn is still computed on the signals object for dashboard use
  typeof sig.cacheReadPerTurn === 'number'
    ? ok('deriveSignals: cacheReadPerTurn is computed on the signals object for dashboards')
    : bad(`deriveSignals: cacheReadPerTurn should be a number, got ${typeof sig.cacheReadPerTurn}`);

  // ── pressureScore ─────────────────────────────────────────────────────────

  // 4. Healthy example (low-volume session)
  const healthySig = pressLib.deriveSignals({ sid: 'a', total: 1000000, turns: 10, cacheRead: 900000, cacheCreate: 50000 });
  const healthyResult = pressLib.pressureScore(healthySig);
  healthyResult.band === 'healthy' && healthyResult.splitRecommended === false
    ? ok('pressureScore: healthy low-volume session → band "healthy", splitRecommended false')
    : bad(`pressureScore: healthy expected, got band="${healthyResult.band}" splitRecommended=${healthyResult.splitRecommended}`);

  // 5. Critical example — verifies band, splitRecommended, recommendations×4, triggers non-empty
  const critSig = pressLib.deriveSignals({ sid: 'b', total: 80000000, turns: 200, cacheRead: 60000000, cacheCreate: 19000000 });
  const critResult = pressLib.pressureScore(critSig);
  critResult.band === 'critical'
    ? ok('pressureScore: critical session → band "critical"')
    : bad(`pressureScore: critical session expected band "critical", got "${critResult.band}"`);
  critResult.splitRecommended === true
    ? ok('pressureScore: critical session → splitRecommended true')
    : bad(`pressureScore: critical session splitRecommended should be true, got ${critResult.splitRecommended}`);
  critResult.recommendations.length === 4
    ? ok('pressureScore: critical session → exactly 4 recommendations')
    : bad(`pressureScore: critical recommendations.length should be 4, got ${critResult.recommendations.length}`);
  critResult.triggers.length > 0
    ? ok(`pressureScore: critical session → triggers non-empty (${critResult.triggers.length} triggers)`)
    : bad('pressureScore: critical session triggers should be non-empty');

  // 6. {present:[]} → skipped marker (constitution §8 refuse-by-default)
  const skipResult = pressLib.pressureScore({ present: [] });
  skipResult?.status === 'skipped'
    ? ok('pressureScore: {present:[]} → skipped marker (no false-positive band)')
    : bad(`pressureScore: expected skipped, got ${JSON.stringify(skipResult)}`);

  // 7. Single-signal row → confidence "inferred"
  const singleSig = pressLib.deriveSignals({ sid: 'c', total: 5000000 });
  const singleResult = pressLib.pressureScore(singleSig);
  singleResult.confidence === 'inferred'
    ? ok('pressureScore: single-signal row → confidence "inferred"')
    : bad(`pressureScore: single-signal confidence should be "inferred", got "${singleResult.confidence}"`);

  // ── readFacts ─────────────────────────────────────────────────────────────

  // 8. Empty array → skipped (never fabricate observations)
  const rfEmpty = mapLib.readFacts([]);
  rfEmpty?.status === 'skipped'
    ? ok('readFacts: empty array → skipped marker')
    : bad(`readFacts: empty array should return skipped, got ${JSON.stringify(rfEmpty)}`);

  // 9. Full scenario (spec-mandated): map, 2 searches before map, 2 reads of same file after map
  const fullToolEvents = [
    { tool: 'search' },
    { tool: 'search' },
    { tool: 'map' },
    { tool: 'read', path: '/a/foo.mjs' },
    { tool: 'read', path: '/a/foo.mjs' },
  ];
  const rfFull = mapLib.readFacts(fullToolEvents);
  rfFull.mapConsulted === true
    ? ok('readFacts: full scenario → mapConsulted true')
    : bad(`readFacts: mapConsulted should be true, got ${rfFull.mapConsulted}`);
  rfFull.broadSearchesBeforeMap === 2
    ? ok('readFacts: full scenario → broadSearchesBeforeMap === 2')
    : bad(`readFacts: broadSearchesBeforeMap should be 2, got ${rfFull.broadSearchesBeforeMap}`);
  rfFull.filesOpenedAfterMap === 2
    ? ok('readFacts: full scenario → filesOpenedAfterMap === 2')
    : bad(`readFacts: filesOpenedAfterMap should be 2, got ${rfFull.filesOpenedAfterMap}`);
  rfFull.repeatedReads.length >= 1
    ? ok('readFacts: full scenario → repeatedReads has at least one entry')
    : bad('readFacts: full scenario repeatedReads should be non-empty');

  // 10. Path redaction: repeatedReads[0].path must NOT contain raw '/a/' and
  //     must match the [8hex]/basename format.
  const rr0Path = rfFull.repeatedReads[0]?.path ?? '';
  !rr0Path.includes('/a/')
    ? ok('readFacts: repeatedReads[0].path does not contain the raw directory component')
    : bad(`readFacts: raw path leaked into repeatedReads: "${rr0Path}"`);
  /^\[[0-9a-f]{8}\]\//.test(rr0Path)
    ? ok('readFacts: repeatedReads[0].path matches [8hex]/basename redaction format')
    : bad(`readFacts: redaction format wrong for "${rr0Path}"`);

  // 11. No-map scenario: mapConsulted false, broadSearchesBeforeMap === searchCount
  const noMapEvents = [
    { tool: 'search' },
    { tool: 'search' },
    { tool: 'search' },
    { tool: 'read', path: '/b/bar.mjs' },
  ];
  const rfNoMap = mapLib.readFacts(noMapEvents);
  rfNoMap.mapConsulted === false
    ? ok('readFacts: no-map scenario → mapConsulted false')
    : bad(`readFacts: no-map mapConsulted should be false, got ${rfNoMap.mapConsulted}`);
  rfNoMap.broadSearchesBeforeMap === rfNoMap.searchCount
    ? ok('readFacts: no-map scenario → broadSearchesBeforeMap === searchCount (all searches sans map)')
    : bad(`readFacts: no-map broadSearchesBeforeMap(${rfNoMap.broadSearchesBeforeMap}) !== searchCount(${rfNoMap.searchCount})`);

  // ── normalizeToolUse ──────────────────────────────────────────────────────

  // 12. Read → read
  const ntRead = repLib.normalizeToolUse('Read', { file_path: '/x/some-file.mjs' });
  ntRead?.tool === 'read'
    ? ok('normalizeToolUse: Read → {tool:"read",...}')
    : bad(`normalizeToolUse: Read should produce tool "read", got ${JSON.stringify(ntRead)}`);

  // 13. Read of project-map path → map
  const ntMap = repLib.normalizeToolUse('Read', { file_path: '/some/project-map/index.mjs' });
  ntMap?.tool === 'map'
    ? ok('normalizeToolUse: Read of /project-map/ path → {tool:"map",...}')
    : bad(`normalizeToolUse: project-map Read should produce tool "map", got ${JSON.stringify(ntMap)}`);

  // 14. Glob → search, Grep → search
  const ntGlob = repLib.normalizeToolUse('Glob', { pattern: '**/*.mjs' });
  const ntGrep = repLib.normalizeToolUse('Grep', { pattern: 'export function' });
  ntGlob?.tool === 'search' && ntGrep?.tool === 'search'
    ? ok('normalizeToolUse: Glob and Grep → {tool:"search",...}')
    : bad(`normalizeToolUse: Glob→${JSON.stringify(ntGlob)}, Grep→${JSON.stringify(ntGrep)}`);

  // 15. Unknown tool name → null
  const ntUnknown = repLib.normalizeToolUse('Write', { file_path: '/x/y.mjs' });
  ntUnknown === null
    ? ok('normalizeToolUse: unknown tool name → null')
    : bad(`normalizeToolUse: unknown should be null, got ${JSON.stringify(ntUnknown)}`);

  // 16. Non-string name → null
  const ntNonString = repLib.normalizeToolUse(42, {});
  ntNonString === null
    ? ok('normalizeToolUse: non-string name → null (defensive guard)')
    : bad(`normalizeToolUse: non-string name should be null, got ${JSON.stringify(ntNonString)}`);

  // ── advisorySummary ───────────────────────────────────────────────────────

  // 17. Empty perSession → pressure skipped
  const sumEmpty = repLib.advisorySummary({ perSession: [], toolEvents: [] });
  sumEmpty.pressure?.status === 'skipped'
    ? ok('advisorySummary: empty perSession → pressure skipped marker')
    : bad(`advisorySummary: empty perSession should skip pressure, got ${JSON.stringify(sumEmpty.pressure)}`);

  // 18. Populated perSession → bands + hottest + schemaVersion
  const session2Rows = [
    { sid: 'rowA', total: 1000000, turns: 10, cacheRead: 900000, cacheCreate: 50000 },
    { sid: 'rowB', total: 80000000, turns: 200, cacheRead: 60000000, cacheCreate: 19000000 },
  ];
  const sumPop = repLib.advisorySummary({ perSession: session2Rows, toolEvents: [] });
  sumPop.pressure?.schemaVersion === 'eacp-pressure/1'
    ? ok('advisorySummary: populated → pressure.schemaVersion === "eacp-pressure/1"')
    : bad(`advisorySummary: pressure.schemaVersion wrong: "${sumPop.pressure?.schemaVersion}"`);
  typeof sumPop.pressure?.sessions === 'number' && sumPop.pressure.sessions >= 1
    ? ok('advisorySummary: populated → pressure.sessions is a positive number')
    : bad(`advisorySummary: pressure.sessions wrong: ${sumPop.pressure?.sessions}`);
  sumPop.pressure?.bands && typeof sumPop.pressure.bands === 'object'
    ? ok('advisorySummary: populated → pressure.bands is an object')
    : bad('advisorySummary: pressure.bands missing or wrong type');
  sumPop.pressure?.hottest?.sid !== undefined
    ? ok('advisorySummary: populated → pressure.hottest.sid is set')
    : bad(`advisorySummary: hottest.sid should be defined, got ${JSON.stringify(sumPop.pressure?.hottest)}`);

  // 19. Empty toolEvents → mapEffectiveness skipped
  sumEmpty.mapEffectiveness?.status === 'skipped'
    ? ok('advisorySummary: empty toolEvents → mapEffectiveness skipped marker')
    : bad(`advisorySummary: empty toolEvents should skip mapEffectiveness, got ${JSON.stringify(sumEmpty.mapEffectiveness)}`);

  // 20. Populated toolEvents → mapEffectiveness facts
  const sumWithTools = repLib.advisorySummary(
    { perSession: [], toolEvents: fullToolEvents },
  );
  sumWithTools.mapEffectiveness?.schemaVersion === 'eacp-map-effectiveness/1'
    ? ok('advisorySummary: populated toolEvents → mapEffectiveness.schemaVersion correct')
    : bad(`advisorySummary: mapEffectiveness.schemaVersion wrong: "${sumWithTools.mapEffectiveness?.schemaVersion}"`);

  // ── presentAdvisories ─────────────────────────────────────────────────────

  // 21. Skipped markers → output contains "skipped"
  const paSkipped = repLib.presentAdvisories(sumEmpty);
  typeof paSkipped === 'string' && paSkipped.includes('skipped')
    ? ok('presentAdvisories: fully-skipped summary → string contains "skipped"')
    : bad(`presentAdvisories: expected "skipped" in output, got: ${paSkipped}`);

  // 22. Populated summary → output contains pressure and map labels
  const paFull = repLib.presentAdvisories(sumPop);
  paFull.includes('Session pressure')
    ? ok('presentAdvisories: populated → contains "Session pressure"')
    : bad(`presentAdvisories: missing "Session pressure" in: ${paFull.slice(0, 200)}`);
  paFull.includes('Map effectiveness')
    ? ok('presentAdvisories: populated → contains "Map effectiveness"')
    : bad(`presentAdvisories: missing "Map effectiveness" in: ${paFull.slice(0, 200)}`);

  // ── Zero-dep invariant ────────────────────────────────────────────────────

  // 23. All three new modules satisfy the zero-dep contract
  let zeroDepsOk = true;
  for (const [name, path] of modDefs) {
    const result = await checkModuleZeroDep(name, path);
    if (result.error) {
      bad(`zero-dep Wave 3: ${name} ${result.error}`);
      zeroDepsOk = false;
    }
  }
  if (zeroDepsOk) ok('zero-dep invariant: all Wave 3 modules import only node:/* or relative paths');
}
