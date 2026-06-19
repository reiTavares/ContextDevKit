#!/usr/bin/env node
/**
 * ContextDevKit integration test — EACP economics (WF0018 Waves 1-7).
 *
 * Split from `integration-test-token-economy.mjs` when the EACP block exceeded
 * the 307-line budget (Wave tech-debt, spec §E.1). One suite, one concern.
 * Covers Waves 1-7: adapter/buckets/lenses, registry/cost, token-report keys,
 * pressure, map-effectiveness, budget→resolver, routing ROI, quota snapshots,
 * autonomy multiplier, benchmark comparePilot, and the Wave 7 baseline harness.
 *
 * Run:  node tools/integration-test-eacp.mjs   (exit 0 = healthy)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { reporter, installFixture } from './it-helpers.mjs';

const rep = reporter();
const { ok, bad } = rep;
console.log('\n🏦  ContextDevKit integration test — EACP economics (Waves 1-7)\n');
const fx = installFixture(rep);
const { proj, script } = fx;

/** Builds a file:// URL for an economics module installed in the fixture project. */
const econUrl = (rel) =>
  'file://' + resolve(proj, `contextkit/tools/scripts/economics/${rel}`).replaceAll('\\', '/');

try {
  // Own transcript fixture for EACP tests (token totals = 475, Wave 3 tool_use events).
  const ttx = join(proj, '_ttx_eacp');
  mkdirSync(ttx, { recursive: true });
  const mkLine = (i, o, extra = {}) => { const { model, ...rest } = extra; return JSON.stringify({ type: 'assistant', sessionId: 'eacp1', timestamp: '2026-05-24T00:00:00Z', cwd: proj, ...rest, message: { role: 'assistant', model, usage: { input_tokens: i, output_tokens: o, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }); };
  const line1 = JSON.stringify({ type: 'assistant', sessionId: 'eacp1', timestamp: '2026-05-24T00:00:00Z', cwd: proj, message: { role: 'assistant', model: 'claude-opus-4-8', content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/proj/contextkit/project-map.md' } }, { type: 'tool_use', name: 'Grep', input: { pattern: 'export function' } }, { type: 'tool_use', name: 'Read', input: { file_path: '/proj/src/engine.mjs' } }, { type: 'tool_use', name: 'Read', input: { file_path: '/proj/src/engine.mjs' } }], usage: { input_tokens: 100, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } });
  writeFileSync(join(ttx, 'eacp1.jsonl'), [line1, mkLine(50, 25, { attributionSkill: 'ship', model: 'claude-opus-4-8' }), mkLine(40, 60, { isSidechain: true, attributionSkill: 'debate', model: 'claude-haiku-4-5' }), '{ bad json'].join('\n'));
  const tr = script('token-report.mjs', '--from', ttx, '--json');

  // ── Wave 1: adapter → normalize → bucketsClose + lenses ──────────────────────
  const [bucketsLib, lensesLib, adapterLib] = await Promise.all([
    import(econUrl('usage-buckets.mjs')),
    import(econUrl('attribution-lenses.mjs')),
    import(econUrl('adapters/claude-code.mjs')),
  ]);
  (() => { try { const a = adapterLib.adapt({ message: { model: 'claude-opus-4-1', usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 800, cache_creation_input_tokens: 150 } }, sessionId: 's', timestamp: Date.now() }); return a && bucketsLib.bucketsClose(a); } catch { return false; } })()
    ? ok('economics: adapter → normalize → bucketsClose path holds') : bad('economics: adapter/normalize/bucketsClose pipeline failed');
  (() => { try { const evs = [{ buckets: { freshInput: 100, output: 50, cacheRead: 800, cacheWrite: 150, reasoning: 0 }, bucketMode: 'cumulative', total: 1100 }, { buckets: { freshInput: 150, output: 100, cacheRead: 1500, cacheWrite: 250, reasoning: 0 }, bucketMode: 'cumulative', total: 2000 }]; const naive = evs.reduce((s, e) => s + bucketsLib.throughput(e.buckets), 0); const norm = bucketsLib.toDelta(evs).reduce((s, e) => s + bucketsLib.throughput(e.buckets), 0); return naive > norm; } catch { return false; } })()
    ? ok('economics: cumulative trap neutralized by toDelta') : bad('economics: cumulative trap not neutralized');
  (() => { try { return lensesLib.inclusive([{ buckets: { freshInput: 100, output: 50, cacheRead: 800, cacheWrite: 150, reasoning: 0 }, agentScope: 'main' }, { buckets: { freshInput: 50, output: 30, cacheRead: 400, cacheWrite: 75, reasoning: 0 }, agentScope: 'subagent' }]).confidence === 'direct'; } catch { return false; } })()
    ? ok('economics: inclusive lens returns confidence="direct"') : bad('economics: inclusive lens confidence wrong');

  // ── Wave 2: registry → cost → token-report financial block ───────────────────
  const [regLib, costLib] = await Promise.all([
    import(econUrl('pricing/pricing-registry.mjs')),
    import(econUrl('cost-engine.mjs')),
  ]);
  (() => { try { const reg = regLib.loadRegistry(); const s = regLib.registrySummary(reg); return reg?.models?.length === 4 && s.inferredCount === 1; } catch { return false; } })()
    ? ok('economics Wave 2: registry 4 models, inferredCount=1') : bad('economics Wave 2: registry model count or inferredCount wrong');
  (() => { try { const reg = regLib.loadRegistry(); const b = { freshInput: 200, output: 100, cacheRead: 1000, cacheWrite: 1000, reasoning: 0 }; return costLib.grossCacheValue(b, regLib.priceFor(reg, 'opus')).usd > 0 && costLib.actualCost(b, regLib.priceFor(reg, 'fable-5')).usd === null; } catch { return false; } })()
    ? ok('economics Wave 2: grossCacheValue > 0 and inferred fable → usd null') : bad('economics Wave 2: cost engine golden or inferred gate failed');
  (() => { try { const j = JSON.parse(tr.stdout); return j.schemaVersion === 'eacp-token-report/2' && j.financial != null && typeof j.financial.confidence === 'string' && j.financial.totals != null; } catch { return false; } })()
    ? ok('economics Wave 2: token-report carries schemaVersion="eacp-token-report/2" and financial block') : bad(`economics Wave 2: schemaVersion or financial missing: ${tr.stdout?.slice(0, 200)}`);
  (() => { try { const fin = JSON.parse(tr.stdout).financial; return fin.confidence === 'direct' && typeof fin.totals.actualUsd === 'number' && fin.totals.actualUsd > 0; } catch { return false; } })()
    ? ok('economics Wave 2: financial.confidence="direct", totals.actualUsd > 0') : bad(`economics Wave 2: financial confidence or actualUsd wrong: ${tr.stdout?.slice(0, 300)}`);

  // ── Wave 3: pressure + map-effectiveness ─────────────────────────────────────
  (() => { try { const j = JSON.parse(tr.stdout); return j.schemaVersion === 'eacp-token-report/2' && j.totals.total === 475; } catch { return false; } })()
    ? ok('economics Wave 3: schemaVersion and totals.total===475 preserved') : bad(`economics Wave 3: regression in schemaVersion or totals.total: ${tr.stdout?.slice(0, 200)}`);
  (() => { try { const p = JSON.parse(tr.stdout).pressure; return p?.schemaVersion === 'eacp-pressure/1' && typeof p.sessions === 'number' && p.bands != null && ['healthy', 'elevated', 'hot', 'critical'].includes(p.hottest?.band); } catch { return false; } })()
    ? ok('economics Wave 3: pressure block schemaVersion, sessions, bands, hottest.band') : bad(`economics Wave 3: pressure block malformed: ${tr.stdout?.slice(0, 400)}`);
  (() => { try { const me = JSON.parse(tr.stdout).mapEffectiveness; if (me?.schemaVersion !== 'eacp-map-effectiveness/1' || typeof me.mapConsulted !== 'boolean' || !Array.isArray(me.repeatedReads)) return false; const rr = me.repeatedReads.find((r) => r.path.endsWith('engine.mjs')); return rr && rr.count >= 2 && /^\[[0-9a-f]{8}\]\/engine\.mjs$/.test(rr.path); } catch { return false; } })()
    ? ok('economics Wave 3: mapEffectiveness schemaVersion, engine.mjs repeated+redacted') : bad(`economics Wave 3: mapEffectiveness wrong: ${JSON.stringify(JSON.parse(tr.stdout || '{}').mapEffectiveness)?.slice(0, 400)}`);

  // ── Wave 4: budget→resolver + routing ROI + token-report keys ────────────────
  await (async () => {
    try {
      const budLib = await import('file://' + resolve(proj, 'contextkit/tools/scripts/economics/budgets.mjs').replaceAll('\\', '/'));
      const resLib = await import('file://' + resolve(proj, 'contextkit/runtime/config/resolve-autonomy.mjs').replaceAll('\\', '/'));
      const adv = budLib.evaluateBudget({ tokens: 200 }, { scope: 'session', limit: 100, hardCap: 150 }, {});
      if (adv.budgetExhausted !== true) { bad('Wave 4 budget: budgetExhausted should be true for 200/100/150'); return; }
      ok('economics Wave 4: evaluateBudget 200/100 hardCap 150 → budgetExhausted true');
      resLib.resolveAutonomy('edit', { autonomy: { grade: 4 }, deliberations: { active: true } }, null, { budgetExhausted: true }).mode === 'suggest'
        ? ok('economics Wave 4: grade-4 + budgetExhausted → mode "suggest"') : bad('Wave 4 budget→resolver: expected mode "suggest"');
      resLib.resolveAutonomy('edit', { autonomy: { grade: 4 }, deliberations: { active: true } }, null, {}).mode === 'auto'
        ? ok('economics Wave 4: grade-4 without budgetExhausted → mode "auto"') : bad('Wave 4 budget→resolver: expected "auto"');
      resLib.resolveAutonomy('adr', { autonomy: { grade: 4 }, deliberations: { active: true } }, null, {}).mode === 'manual'
        ? ok('economics Wave 4: area "adr" → mode "manual" (floor holds)') : bad('Wave 4 budget→resolver: adr floor broken');
    } catch (err) { bad(`Wave 4 budget→resolver crashed: ${err?.message ?? err}`); }
  })();
  await (async () => {
    try {
      const routLib = await import(econUrl('routing-economics.mjs'));
      const roiNoQa = routLib.routingROI({ usd: 1 }, { usd: 0.4 }, {});
      roiNoQa.savings === null ? ok('economics Wave 4: routingROI no qa → savings null') : bad(`Wave 4 routingROI: savings should be null, got ${roiNoQa.savings}`);
      const roiEq = routLib.routingROI({ usd: 1 }, { usd: 0.4 }, { baselinePassRate: 0.9, routedPassRate: 0.9 });
      typeof roiEq.savings === 'number' && roiEq.savings > 0 ? ok('economics Wave 4: routingROI equivalent quality → savings > 0') : bad(`Wave 4 routingROI equiv: ${roiEq.savings}`);
      const fv = routLib.fableAudit(regLib.loadRegistry(), {});
      fv?.status === 'skipped' ? ok('economics Wave 4: fableAudit → skipped (degrade-to-skip)') : (fv.price?.input === 10 ? ok('economics Wave 4: fableAudit price.input===10') : bad(`Wave 4 fableAudit: got ${fv.price?.input}`));
    } catch (err) { bad(`Wave 4 routing crashed: ${err?.message ?? err}`); }
  })();
  (() => { try { const j = JSON.parse(tr.stdout); ('budgetGuard' in j ? ok : bad)('economics Wave 4: token-report has "budgetGuard" key'); (j.routing != null && Array.isArray(j.routing.premiumModels) && j.routing.premiumModels.includes('claude-opus-4-8') ? ok : bad)('economics Wave 4: routing.premiumModels includes "claude-opus-4-8"'); } catch (err) { bad(`Wave 4 JSON parse crashed: ${err?.message ?? err}`); } })();

  // ── Wave 5: quota snapshots + autonomy multiplier ─────────────────────────────
  await (async () => {
    try {
      const qL = await import(econUrl('quota-snapshots.mjs'));
      const aL = await import(econUrl('autonomy-multiplier.mjs'));
      const sf = join(proj, 'contextkit', 'memory', 'quota-snapshots.jsonl');
      qL.appendSnapshot(qL.buildSnapshot({ host: 'claude', remainingPct: 55, captureMethod: 'manual' }), sf);
      qL.appendSnapshot(qL.buildSnapshot({ host: 'cursor', captureMethod: 'manual' }), sf);
      const recs = qL.readSnapshots(sf);
      recs.length === 2 && recs[0].confidence === 'inferred' && recs[1].confidence === 'unknown'
        ? ok('economics Wave 5: appendSnapshot+readSnapshots round-trip (inferred+unknown)') : bad(`Wave 5 quota round-trip wrong: ${JSON.stringify(recs)}`);
      const trW5 = script('token-report.mjs', '--from', ttx, '--json');
      (() => { try { const j = JSON.parse(trW5.stdout); return j.schemaVersion === 'eacp-token-report/2' && 'quota' in j && 'autonomy' in j; } catch { return false; } })()
        ? ok('economics Wave 5: token-report carries "quota" and "autonomy" keys') : bad(`Wave 5 token-report: keys missing — ${trW5.stdout?.slice(0, 200)}`);
      (() => { try { const j = JSON.parse(trW5.stdout); return j.quota && j.quota.status !== 'skipped' && j.quota.hosts >= 1; } catch { return false; } })()
        ? ok('economics Wave 5: token-report quota block populated (hosts>=1)') : bad(`Wave 5 quota block not populated: ${JSON.stringify(JSON.parse(trW5.stdout || '{}').quota)?.slice?.(0, 200)}`);
      const mD = aL.autonomyMultiplier({ qaGreen: 10, units: 5 }, { qaGreen: 6, units: 5 }, { unit: 'quota' });
      typeof mD.multiplier === 'number' && Math.abs(mD.multiplier - 10 / 6) < 0.001 && mD.confidence === 'derived' && mD.claim === null
        ? ok('economics Wave 5: autonomyMultiplier derived ratio≈1.667, confidence="derived", claim===null') : bad(`Wave 5 autonomy derived wrong: ${JSON.stringify(mD)?.slice(0, 200)}`);
      aL.autonomyMultiplier({ qaGreen: 10, units: 5 }, { qaGreen: 6, units: 5 }, { unit: 'effective-mtok' }).confidence === 'inferred'
        ? ok('economics Wave 5: autonomyMultiplier substitute unit → confidence "inferred"') : bad('Wave 5 autonomy: substitute unit should produce "inferred"');
      aL.usefulAutonomy({ acceptanceMet: true, testsRun: true, qaGreen: true, criticalBypass: true }) === false
        ? ok('economics Wave 5: usefulAutonomy Goodhart guard blocks criticalBypass') : bad('Wave 5 autonomy: criticalBypass should block usefulAutonomy');
      const goodTask = { acceptanceMet: true, testsRun: true, qaGreen: true, externalCriteria: true, evaluatorNotOperator: true };
      const ct = aL.countUseful([{ ...goodTask }, { ...goodTask }, { acceptanceMet: false }]);
      ct.greenCount === 2 && ct.total === 3 ? ok('economics Wave 5: countUseful greenCount===2 of 3') : bad(`Wave 5 countUseful wrong: ${JSON.stringify(ct)}`);
    } catch (err) { bad(`Wave 5 crashed: ${err?.message ?? err}`); }
  })();

  // ── Wave 6: benchmark comparePilot degrades without #176 baseline ─────────────
  const benchRep = await import(econUrl('benchmark-report.mjs'));
  const benchCmp = benchRep.comparePilot({ A: { qaGreen: 6, units: 5, mock: true }, C: { qaGreen: 10, units: 5 } });
  benchCmp.confidence === 'unknown' && benchCmp.claim === null
    ? ok('economics Wave 6: comparePilot degrades to "unknown"+claim null (no #176 baseline)')
    : bad(`Wave 6 benchmark: comparePilot should degrade — ${JSON.stringify(benchCmp)?.slice(0, 140)}`);

  // ── Wave 7 (#176 / CDK-003): baseline harness + scenarios ────────────────────
  await (async () => {
    try {
      const hL = await import(econUrl('baseline-harness.mjs'));
      const sL = await import(econUrl('baseline-scenarios.mjs'));
      const rL = await import(econUrl('baseline-report.mjs'));
      // (a) unknown scenario id → skipped
      hL.buildBaselineSpec('unknown-id')?.status === 'skipped'
        ? ok('economics Wave 7 (a): buildBaselineSpec("unknown-id") → "skipped"')
        : bad('Wave 7 (a): unknown scenario id should return skipped');
      // (b) no events → skipped
      const spec = hL.buildBaselineSpec('typo-fix-readme');
      hL.recordBaseline(spec, {})?.status === 'skipped'
        ? ok('economics Wave 7 (b): recordBaseline no events → "skipped"')
        : bad('Wave 7 (b): no-events recordBaseline should skip');
      // (c) mock events → confidence 'mock', claim null
      const rec = hL.recordBaseline(spec, { events: { tokens: 100, qaOutcome: 'pass', costUsd: 0.05 }, mock: true });
      rec?.confidence === 'mock' && rec?.claim === null
        ? ok('economics Wave 7 (c): recordBaseline mock → confidence "mock", claim null')
        : bad(`Wave 7 (c): mock record wrong — ${JSON.stringify(rec)}`);
      // (d) costPerCompletedTask([]) → value null, claim null
      const cpt = hL.costPerCompletedTask([]);
      cpt?.value === null && cpt?.claim === null
        ? ok('economics Wave 7 (d): costPerCompletedTask([]) → value null, claim null')
        : bad(`Wave 7 (d): costPerCompletedTask([]) wrong — ${JSON.stringify(cpt)}`);
      // (e) baselineStatus absent ledger → pending true, recorded 0, claim null
      const status = rL.baselineStatus(join(proj, 'contextkit', 'memory', 'baseline-absent.jsonl'));
      status?.pending === true && status?.recorded === 0 && status?.claim === null
        ? ok('economics Wave 7 (e): baselineStatus(absent) → pending true, recorded 0, claim null')
        : bad(`Wave 7 (e): baselineStatus wrong — ${JSON.stringify(status)}`);
      // (f) SCENARIOS.length >= 10, all SCENARIO_KINDS covered
      const kinds = new Set(sL.SCENARIOS.map((s) => s.kind));
      sL.SCENARIOS.length >= 10 && sL.SCENARIO_KINDS.every((k) => kinds.has(k))
        ? ok(`economics Wave 7 (f): SCENARIOS.length=${sL.SCENARIOS.length} ≥ 10, all kinds covered`)
        : bad(`Wave 7 (f): scenarios wrong — length=${sL.SCENARIOS.length}, missing: ${sL.SCENARIO_KINDS.filter((k) => !kinds.has(k)).join(',')}`);
    } catch (err) { bad(`Wave 7 crashed: ${err?.message ?? err}`); }
  })();
} catch (err) {
  bad(`crashed: ${err?.stack || err}`);
} finally {
  fx.cleanup();
}

rep.finish('Integration (EACP economics Waves 1-7)');
