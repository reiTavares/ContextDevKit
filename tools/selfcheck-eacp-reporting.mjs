/**
 * Self-check — EACP Wave 9 reporting surface (card #244).
 *
 * Covers buildEconomicDashboardData (dashboard-data.mjs),
 * aggregateFleetEconomics, buildExportPackage, buildTrendSlice
 * (economic-report.mjs / economic-report-fleet.mjs via re-export).
 *
 * Assertions:
 *   - unconsented → economicSummary.status==='skipped' (explicit, never dropped)
 *   - k-anon: consentedCount < MIN_COHORT_SIZE → kAnonWithheld:true; totalRepos
 *     reflects the FULL denominator (skipped repos counted)
 *   - forbidden-field record → pushed to skippedRepos, never aggregated
 *   - buildExportPackage skips unless externalSend explicitly true
 *   - cost-trend up/skipped direction
 *   - contextHealthTrend + autonomyTrend → skipped on empty periods
 *   - zero-dep invariant on economic-report.mjs and economic-report-fleet.mjs
 *
 * Cohesion note (constitution §1): single card's reporting boundary; all
 * assertion-pairs share the same imports and fixtures. Zero runtime deps.
 */
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

/** @private — checks a module has no non-relative, non-node: imports. */
async function checkModuleZeroDep(name, modPath) {
  let content = '';
  try { content = await readFile(modPath, 'utf-8'); }
  catch (err) { return { error: `could not read: ${err?.message ?? err}` }; }
  const importRegex = /^import\s+(?:[^"'`]*\s+)?from\s+['"`]([^'"`]+)['"`]/gm;
  let match;
  while ((match = importRegex.exec(content)) !== null) {
    const spec = match[1];
    if (!spec.startsWith('.') && !spec.startsWith('node:')) return { error: `imports from "${spec}"` };
  }
  return { error: null };
}

/**
 * Runs EACP reporting surface checks (card #244).
 * @param {{ ok: (m: string) => void, bad: (m: string) => void }} reporter
 * @param {{ KIT: string }} ctx - repo root
 */
export async function runEacpReportingChecks({ ok, bad }, { KIT }) {
  console.log('Checking EACP Wave 9 reporting surface (card #244)...');
  const econ = 'templates/contextkit/tools/scripts/economics';
  const ddPath  = resolve(KIT, 'templates/contextkit/tools/scripts/dashboard-data.mjs');
  const erPath  = resolve(KIT, `${econ}/economic-report.mjs`);
  const erfPath = resolve(KIT, `${econ}/economic-report-fleet.mjs`);

  let ddLib, erLib;
  try {
    ddLib = await import(pathToFileURL(ddPath).href);
    ok('dashboard-data.mjs imports cleanly');
  } catch (err) {
    bad(`dashboard-data.mjs import failed: ${err?.message ?? err}`); return;
  }
  try {
    erLib = await import(pathToFileURL(erPath).href);
    ok('economic-report.mjs imports cleanly');
  } catch (err) {
    bad(`economic-report.mjs import failed: ${err?.message ?? err}`); return;
  }

  const { buildEconomicDashboardData } = ddLib;
  const { aggregateFleetEconomics, buildExportPackage, buildTrendSlice,
          MIN_COHORT_SIZE, ECONOMIC_REPORT_SCHEMA_VERSION } = erLib;

  // ── MIN_COHORT_SIZE constant ─────────────────────────────────────────────
  MIN_COHORT_SIZE === 3
    ? ok('MIN_COHORT_SIZE === 3 (k-anonymity threshold)')
    : bad(`MIN_COHORT_SIZE wrong: ${MIN_COHORT_SIZE}`);

  // ── buildEconomicDashboardData — unconsented → explicit skipped ───────────
  // Unconsented must produce status:'skipped' in economicSummary, not be dropped.
  const dashUnc = buildEconomicDashboardData({ repoId: 'repo-x', config: null });
  dashUnc.economicSummary?.status === 'skipped'
    ? ok('buildEconomicDashboardData: unconsented → economicSummary.status="skipped" (explicit, not dropped)')
    : bad(`buildEconomicDashboardData: unconsented must produce status:skipped, got ${JSON.stringify(dashUnc.economicSummary?.status)}`);
  dashUnc.schemaVersion === ECONOMIC_REPORT_SCHEMA_VERSION
    ? ok('buildEconomicDashboardData: schemaVersion matches ECONOMIC_REPORT_SCHEMA_VERSION')
    : bad(`buildEconomicDashboardData: schemaVersion wrong: ${dashUnc.schemaVersion}`);

  // ── cost-trend direction ──────────────────────────────────────────────────
  const cfg = { economics: { reporting: { consent: true } } };
  const dashTrend = buildEconomicDashboardData({
    repoId: 'repo-t', config: cfg,
    costPeriods: [
      { period: 'p1', financial: { totals: { actualUsd: 100 }, confidence: 'direct' } },
      { period: 'p2', financial: { totals: { actualUsd: 200 }, confidence: 'direct' } },
    ],
    contextHealthPeriods: [],
    autonomyPeriods: [],
    fleetSummaries: [],
  });
  dashTrend.costTrend?.delta?.direction === 'up'
    ? ok('buildEconomicDashboardData: cost-trend two ascending periods → direction "up"')
    : bad(`buildEconomicDashboardData: costTrend direction wrong: ${dashTrend.costTrend?.delta?.direction}`);

  // ── contextHealthTrend + autonomyTrend → skipped on empty ────────────────
  dashTrend.contextHealthTrend?.status === 'skipped'
    ? ok('buildEconomicDashboardData: contextHealthTrend skipped on empty periods')
    : bad(`buildEconomicDashboardData: contextHealthTrend should be skipped: ${JSON.stringify(dashTrend.contextHealthTrend?.status)}`);
  dashTrend.autonomyTrend?.status === 'skipped'
    ? ok('buildEconomicDashboardData: autonomyTrend skipped on empty periods')
    : bad(`buildEconomicDashboardData: autonomyTrend should be skipped: ${JSON.stringify(dashTrend.autonomyTrend?.status)}`);

  // ── aggregateFleetEconomics — k-anon withheld below MIN_COHORT_SIZE ───────
  // Safe records have only FIELD_CLASSIFICATION-registered fields (status, ts, etc.)
  // so assertNoForbiddenFields passes and they are counted as consented.
  const minSafe = { schemaVersion: ECONOMIC_REPORT_SCHEMA_VERSION, status: 'active', reason: 'ok', ts: 1 };
  const skippedRepo = { status: 'skipped', reason: 'no consent', repoId: 'repo-s' };

  // 2 consented + 1 skipped = 3 totalRepos; 2 consented < MIN_COHORT_SIZE → withheld
  const fleet2 = aggregateFleetEconomics([minSafe, minSafe, skippedRepo]);
  fleet2.kAnonWithheld === true
    ? ok('aggregateFleetEconomics: 2 consented < MIN_COHORT_SIZE → kAnonWithheld:true')
    : bad(`aggregateFleetEconomics: k-anon expected withheld, got kAnonWithheld=${fleet2.kAnonWithheld}`);
  fleet2.totalRepos === 3
    ? ok('aggregateFleetEconomics: totalRepos reflects FULL denominator (skipped repos counted)')
    : bad(`aggregateFleetEconomics: totalRepos should be 3 (full input), got ${fleet2.totalRepos}`);
  fleet2.skippedRepos.length === 1
    ? ok('aggregateFleetEconomics: skippedRepos list contains the unconsented entry')
    : bad(`aggregateFleetEconomics: skippedRepos count wrong: ${fleet2.skippedRepos.length}`);

  // 3 consented ≥ MIN_COHORT_SIZE → NOT withheld
  const fleet3 = aggregateFleetEconomics([minSafe, minSafe, minSafe]);
  fleet3.kAnonWithheld === false
    ? ok('aggregateFleetEconomics: 3 consented ≥ MIN_COHORT_SIZE → kAnonWithheld:false')
    : bad(`aggregateFleetEconomics: expected kAnonWithheld=false, got ${fleet3.kAnonWithheld}`);

  // ── forbidden-field record → skippedRepos, never aggregated ──────────────
  // A record with 'content' (forbidden) is pushed to skippedRepos; 3 safe still consented.
  const forbidden = { schemaVersion: 'x', content: 'secret-data' };
  const fleetForbid = aggregateFleetEconomics([minSafe, minSafe, minSafe, forbidden]);
  fleetForbid.consentedRepos === 3 && fleetForbid.skippedRepos.length === 1
    ? ok('aggregateFleetEconomics: forbidden-field record → pushed to skippedRepos, not aggregated')
    : bad(`aggregateFleetEconomics: forbidden-field handling wrong — consented=${fleetForbid.consentedRepos} skipped=${fleetForbid.skippedRepos.length}`);

  // ── buildExportPackage — skips unless externalSend explicitly true ────────
  const pkgNoSend = buildExportPackage({ config: null });
  pkgNoSend?.status === 'skipped'
    ? ok('buildExportPackage: skips (status="skipped") when externalSend not true')
    : bad(`buildExportPackage: should skip without consent, got status=${pkgNoSend?.status}`);

  const pkgSend = buildExportPackage({
    config: { economics: { privacy: { externalSend: true } } },
    repoSummary: minSafe,
    nowMs: 99999,
  });
  pkgSend.mode === 'metadata-only' && pkgSend.exportedAt === 99999
    ? ok('buildExportPackage: externalSend:true → mode="metadata-only", exportedAt stamped')
    : bad(`buildExportPackage: with consent wrong — mode=${pkgSend.mode} exportedAt=${pkgSend.exportedAt}`);

  // ── buildTrendSlice — skipped on empty; cost direction ───────────────────
  buildTrendSlice([])?.status === 'skipped'
    ? ok('buildTrendSlice: [] → status="skipped"')
    : bad('buildTrendSlice: empty input should skip');
  const trend = buildTrendSlice([
    { period: 'p1', financial: { totals: { actualUsd: 50 }, confidence: 'direct' } },
    { period: 'p2', financial: { totals: { actualUsd: 80 }, confidence: 'direct' } },
  ]);
  trend.delta?.direction === 'up' && trend.periodCount === 2
    ? ok('buildTrendSlice: ascending USD → direction "up", periodCount 2')
    : bad(`buildTrendSlice: direction wrong — ${trend.delta?.direction}, periodCount ${trend.periodCount}`);

  // ── Zero-dep invariant on new modules ────────────────────────────────────
  let zeroDepsOk = true;
  for (const [name, path] of [['economic-report.mjs', erPath], ['economic-report-fleet.mjs', erfPath]]) {
    const result = await checkModuleZeroDep(name, path);
    if (result.error) { bad(`zero-dep Wave 9: ${name} ${result.error}`); zeroDepsOk = false; }
  }
  if (zeroDepsOk) ok('zero-dep invariant: economic-report.mjs + economic-report-fleet.mjs are zero-dep');
}
