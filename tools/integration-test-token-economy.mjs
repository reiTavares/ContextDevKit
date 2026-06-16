#!/usr/bin/env node
/**
 * ContextDevKit integration test — token economy & the fan-out economy (ADR-0044 F3).
 *
 * Split from `integration-test.mjs` (own fixture) when the token-report + F3
 * coverage grew past that file's line budget — one suite, one concern. Covers
 * `/token-report` aggregation + the D3 per-agent/per-command attribution, the D1
 * bounded subagent pack, the D5 deterministic memory retriever, and the D2
 * count-by-type `[Unreleased]` boot digest with its raw fallback. [ADR-0027/0044]
 *
 * Run:  node tools/integration-test-token-economy.mjs   (exit 0 = healthy)
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { reporter, installFixture } from './it-helpers.mjs';

const rep = reporter();
const { ok, bad } = rep;
console.log('\n🪙  ContextDevKit integration test — token economy (F3)\n');
const fx = installFixture(rep);
const { proj, script, hook } = fx;

try {
  // Token economy (#7): token-report aggregates usage from transcripts (fake --from dir; also
  // exercises the cwd filter + defensive JSON parsing of a bad line).
  const ttx = join(proj, '_ttx');
  mkdirSync(ttx, { recursive: true });
  const usageLine = (i, o, extra = {}) => { const { model, ...rest } = extra; return JSON.stringify({ type: 'assistant', sessionId: 'sess1', timestamp: '2026-05-24T00:00:00Z', cwd: proj, ...rest, message: { role: 'assistant', model, usage: { input_tokens: i, output_tokens: o, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } }); };
  // Wave 3 (EACP #236/#237): inject tool_use content into the first line so token totals stay 475
  // while tool events (repeated reads + search) are available for map-effectiveness analysis.
  const w3ToolUseContent = [
    { type: 'tool_use', name: 'Read', input: { file_path: '/proj/contextkit/project-map.md' } },
    { type: 'tool_use', name: 'Grep', input: { pattern: 'export function' } },
    { type: 'tool_use', name: 'Read', input: { file_path: '/proj/src/engine.mjs' } },
    { type: 'tool_use', name: 'Read', input: { file_path: '/proj/src/engine.mjs' } },
  ];
  const line1WithTools = JSON.stringify({ type: 'assistant', sessionId: 'sess1', timestamp: '2026-05-24T00:00:00Z', cwd: proj, message: { role: 'assistant', model: 'claude-opus-4-8', content: w3ToolUseContent, usage: { input_tokens: 100, output_tokens: 200, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } });
  // Main-loop (opus), a /ship line (opus), and a /debate subagent on a CHEAP model (haiku) → exercises
  // ADR-0044 D3 attribution AND the ADR-0052 byModel split (premium main loop vs cheap fan-out).
  writeFileSync(join(ttx, 'sess1.jsonl'), [line1WithTools, usageLine(50, 25, { attributionSkill: 'ship', model: 'claude-opus-4-8' }), usageLine(40, 60, { isSidechain: true, attributionSkill: 'debate', model: 'claude-haiku-4-5' }), '{ bad json'].join('\n'));
  const tr = script('token-report.mjs', '--from', ttx, '--json');
  (() => { try { const j = JSON.parse(tr.stdout); return j.sessions === 1 && j.totals.total === 475 && j.totals.input === 190; } catch { return false; } })()
    ? ok('token-report aggregates token usage from transcripts') : bad(`token-report failed: ${tr.stdout || tr.stderr}`);
  // ADR-0044 D3 — per-agent (main vs subagent fan-out) and per-command attribution, transcript-derived.
  (() => { try { const a = JSON.parse(tr.stdout).attribution; return a.agents.subagent.input === 40 && a.agents.subagent.output === 60 && a.agents.main.turns === 2 && a.commands.debate && a.commands.ship; } catch { return false; } })()
    ? ok('token-report attributes tokens per-agent (sidechain) and per-command (ADR-0044 D3)') : bad(`token-report D3 attribution wrong: ${tr.stdout}`);
  // ADR-0052 Phase 2 — byModel split: the premium main loop and the cheap fan-out land in distinct buckets.
  (() => { try { const m = JSON.parse(tr.stdout).attribution.byModel; return m['claude-opus-4-8']?.turns === 2 && m['claude-opus-4-8']?.input === 150 && m['claude-haiku-4-5']?.input === 40 && m['claude-haiku-4-5']?.output === 60; } catch { return false; } })()
    ? ok('token-report splits spend per model — premium main vs cheap fan-out (ADR-0052 Phase 2)') : bad(`token-report byModel split wrong: ${tr.stdout}`);

  // ADR-0044 D1/D5 — deterministic memory retriever + bounded subagent pack.
  writeFileSync(join(proj, 'contextkit', 'memory', 'GLOSSARY.md'), '# Glossary\n\n| Domain term (UI / business) | Code identifier | Notes |\n| --- | --- | --- |\n| Pipeline | `pipeline.mjs` | the DevPipeline board |\n');
  const mr = script('memory-retrieve.mjs', '--objective', 'pipeline board', '--json');
  (() => { try { const j = JSON.parse(mr.stdout); return j.tokens.includes('pipeline') && j.glossary.some((g) => /Pipeline/.test(g)); } catch { return false; } })()
    ? ok('memory-retrieve selects the matching glossary row for the objective (ADR-0044 D5)') : bad(`memory-retrieve missed the glossary hit: ${mr.stdout || mr.stderr}`);
  const mrText = script('memory-retrieve.mjs', '--objective', 'pipeline board').stdout;
  mrText.split('\n').length <= 40 && !/TODO|TBD|<placeholder>|…\s*$/m.test(mrText.replace(/truncated/g, ''))
    ? ok('memory-retrieve output is capped at 40 lines with no placeholder markers (ADR-0044 D5)') : bad(`memory-retrieve cap/placeholder guard failed (${mrText.split('\n').length} lines)`);
  script('memory-retrieve.mjs', '--objective', 'pipeline board').stdout === mrText
    ? ok('memory-retrieve is idempotent — same objective ⇒ byte-identical output (ADR-0044 D5)') : bad('memory-retrieve output is not idempotent');
  const sp = script('context-pack.mjs', '--for-subagent', '--objective', 'pipeline board').stdout;
  sp.startsWith('# 🧭 Subagent context pack') && sp.includes('Do not re-read boot context') && sp.split('\n').length <= 130
    ? ok('context-pack --for-subagent is bounded and carries the no-re-read rule (ADR-0044 D1)') : bad(`subagent pack malformed (${sp.split('\n').length} lines)`);

  // ADR-0044 D2 — the boot banner shows a count-by-type [Unreleased] digest, with a raw fallback.
  mkdirSync(join(proj, 'docs'), { recursive: true });
  writeFileSync(join(proj, 'docs', 'CHANGELOG.md'), '# Changelog\n\n## [Unreleased]\n\n### Added\n- **Alpha.** new thing\n- **Beta.** another new thing\n\n### Fixed\n- **Gamma.** a fix\n\n## [1.0.0] - 2026-01-01\n- old\n');
  const d2Banner = hook('session-start.mjs', {});
  /Added 2 · Fixed 1 \(3 entries\)/.test(d2Banner) && !d2Banner.includes('new thing\n- **Beta')
    ? ok('boot banner digests [Unreleased] as a count-by-type tally (ADR-0044 D2)') : bad('boot banner did not show the [Unreleased] digest');
  // Audit 135: a nested sub-bullet is detail of its parent, not a new entry.
  writeFileSync(join(proj, 'docs', 'CHANGELOG.md'), '# Changelog\n\n## [Unreleased]\n\n### Added\n- **Parent.** a top-level entry\n  - nested detail under the parent\n\n## [1.0.0] - 2026-01-01\n- old\n');
  /Added 1 \(1 entry\)/.test(hook('session-start.mjs', {}))
    ? ok('boot [Unreleased] digest counts only column-0 bullets, not nested sub-bullets (audit 135)') : bad('digest inflated the count with a nested sub-bullet');
  writeFileSync(join(proj, 'docs', 'CHANGELOG.md'), '# Changelog\n\n## [Unreleased]\n\nFreeform notes without typed subsections here.\n\n## [1.0.0] - 2026-01-01\n- old\n');
  hook('session-start.mjs', {}).includes('Freeform notes without typed subsections')
    ? ok('boot banner falls back to the raw [Unreleased] section on a parse miss (ADR-0044 D2)') : bad('boot banner did not fall back to raw [Unreleased]');

  // EACP end-to-end (WF0018 Wave 1): adapter → normalize → bucketsClose → lenses (ADR-0078/0081).
  const { default: path } = await import('node:path');
  const econ = {
    bucketsLib: await import('file://' + path.resolve(proj, 'contextkit/tools/scripts/economics/usage-buckets.mjs').replaceAll('\\', '/')),
    eventLib: await import('file://' + path.resolve(proj, 'contextkit/tools/scripts/economics/usage-event.mjs').replaceAll('\\', '/')),
    lensesLib: await import('file://' + path.resolve(proj, 'contextkit/tools/scripts/economics/attribution-lenses.mjs').replaceAll('\\', '/')),
    adapterLib: await import('file://' + path.resolve(proj, 'contextkit/tools/scripts/economics/adapters/claude-code.mjs').replaceAll('\\', '/')),
  };

  // (a) Adapter → normalize → bucketsClose path on synthetic usage line
  (() => { try {
    const synLine = {
      message: { model: 'claude-opus-4-1', usage: { input_tokens: 100, output_tokens: 50, cache_read_input_tokens: 800, cache_creation_input_tokens: 150 } },
      sessionId: 'eacp-test-sess',
      timestamp: Date.now(),
    };
    const adapted = econ.adapterLib.adapt(synLine);
    return adapted && econ.bucketsLib.bucketsClose(adapted);
  } catch { return false; } })()
    ? ok('economics: adapter → normalize → bucketsClose path holds on synthetic usage line') : bad('economics: adapter/normalize/bucketsClose pipeline failed');

  // (b) Cumulative trap neutralization
  (() => { try {
    const cumEvents = [
      { buckets: { freshInput: 100, output: 50, cacheRead: 800, cacheWrite: 150, reasoning: 0 }, bucketMode: 'cumulative', total: 1100 },
      { buckets: { freshInput: 150, output: 100, cacheRead: 1500, cacheWrite: 250, reasoning: 0 }, bucketMode: 'cumulative', total: 2000 },
    ];
    const naiveSum = cumEvents.reduce((s, e) => s + econ.bucketsLib.throughput(e.buckets), 0);
    const deltaized = econ.bucketsLib.toDelta(cumEvents);
    const normalized = deltaized.reduce((s, e) => s + econ.bucketsLib.throughput(e.buckets), 0);
    return naiveSum > normalized;
  } catch { return false; } })()
    ? ok('economics: cumulative trap is neutralized by toDelta') : bad('economics: cumulative trap not neutralized');

  // (c) Inclusive lens carries direct confidence
  (() => { try {
    const events = [
      { buckets: { freshInput: 100, output: 50, cacheRead: 800, cacheWrite: 150, reasoning: 0 }, agentScope: 'main' },
      { buckets: { freshInput: 50, output: 30, cacheRead: 400, cacheWrite: 75, reasoning: 0 }, agentScope: 'subagent' },
    ];
    const res = econ.lensesLib.inclusive(events);
    return res.confidence === 'direct';
  } catch { return false; } })()
    ? ok('economics: inclusive lens returns confidence="direct"') : bad('economics: inclusive lens confidence wrong');

  // EACP Wave 2 (registry → cost → Report v2) — WF0018 / ADR-0079
  // (d) Registry loaded from installed proj: 4 models, inferredCount === 1
  await (async () => { try {
    const regLib = await import('file://' + path.resolve(proj, 'contextkit/tools/scripts/economics/pricing/pricing-registry.mjs').replaceAll('\\', '/'));
    const reg = regLib.loadRegistry();
    const summary = regLib.registrySummary(reg);
    return reg?.models?.length === 4 && summary.inferredCount === 1;
  } catch { return false; } })()
    ? ok('economics Wave 2: registry from proj has 4 models, inferredCount=1') : bad('economics Wave 2: registry model count or inferredCount wrong in installed proj');

  // (e) Cost engine golden numbers + inferred gate from installed proj
  await (async () => { try {
    const regLib = await import('file://' + path.resolve(proj, 'contextkit/tools/scripts/economics/pricing/pricing-registry.mjs').replaceAll('\\', '/'));
    const costLib = await import('file://' + path.resolve(proj, 'contextkit/tools/scripts/economics/cost-engine.mjs').replaceAll('\\', '/'));
    const reg = regLib.loadRegistry();
    const buckets = { freshInput: 200, output: 100, cacheRead: 1000, cacheWrite: 1000, reasoning: 0 };
    const opusEntry = regLib.priceFor(reg, 'opus');
    const fableEntry = regLib.priceFor(reg, 'fable-5');
    const gross = costLib.grossCacheValue(buckets, opusEntry);
    const fableCost = costLib.actualCost(buckets, fableEntry);
    return gross.usd > 0 && fableCost.usd === null;
  } catch { return false; } })()
    ? ok('economics Wave 2: grossCacheValue > 0 and inferred fable cost → usd null (installed proj)') : bad('economics Wave 2: cost engine golden or inferred gate failed in installed proj');

  // (f) token-report --json now carries schemaVersion + financial block (eacp-token-report/2)
  // NOTE: legacy assertions on totals.total===475 etc. remain and were checked above (lines 33-40).
  (() => { try {
    const j = JSON.parse(tr.stdout);
    return j.schemaVersion === 'eacp-token-report/2' &&
      j.financial != null &&
      typeof j.financial.confidence === 'string' &&
      j.financial.totals != null;
  } catch { return false; } })()
    ? ok('economics Wave 2: token-report --json carries schemaVersion="eacp-token-report/2" and financial block') : bad(`economics Wave 2: token-report missing schemaVersion or financial block: ${tr.stdout?.slice(0,200)}`);
  (() => { try {
    const fin = JSON.parse(tr.stdout).financial;
    // opus + haiku both have direct confidence → aggregate confidence direct
    return fin.confidence === 'direct' && typeof fin.totals.actualUsd === 'number' && fin.totals.actualUsd > 0;
  } catch { return false; } })()
    ? ok('economics Wave 2: financial.confidence="direct" and totals.actualUsd > 0 (opus+haiku both priced direct)') : bad(`economics Wave 2: financial confidence or actualUsd wrong: ${tr.stdout?.slice(0,300)}`);

  // EACP Wave 3 (cards #236/#237): pressure + map-effectiveness advisory blocks.
  // Legacy guard: token totals must be unchanged after adding tool_use content to line 1.
  (() => { try { const j = JSON.parse(tr.stdout); return j.schemaVersion === 'eacp-token-report/2' && j.totals.total === 475; } catch { return false; } })()
    ? ok('economics Wave 3: schemaVersion still "eacp-token-report/2" and totals.total===475 (legacy preserved)') : bad(`economics Wave 3: schemaVersion or totals.total regressed: ${tr.stdout?.slice(0,200)}`);
  // Pressure block: must be a populated object with schemaVersion, numeric sessions, bands, hottest with a valid band.
  (() => { try {
    const p = JSON.parse(tr.stdout).pressure;
    const { PRESSURE_BANDS } = { PRESSURE_BANDS: ['healthy', 'elevated', 'hot', 'critical'] };
    return p?.schemaVersion === 'eacp-pressure/1' && typeof p.sessions === 'number' &&
      p.bands != null && typeof p.bands === 'object' && PRESSURE_BANDS.includes(p.hottest?.band);
  } catch { return false; } })()
    ? ok('economics Wave 3: pressure block has schemaVersion, numeric sessions, bands object, hottest.band in PRESSURE_BANDS') : bad(`economics Wave 3: pressure block malformed: ${tr.stdout?.slice(0,400)}`);
  // Map-effectiveness block: populated (we injected tool_use events); repeatedRead detected + path redacted.
  (() => { try {
    const me = JSON.parse(tr.stdout).mapEffectiveness;
    if (me?.schemaVersion !== 'eacp-map-effectiveness/1') return false;
    if (typeof me.mapConsulted !== 'boolean') return false;
    if (!Array.isArray(me.repeatedReads)) return false;
    // engine.mjs was read twice → repeatedReads must contain an entry for it
    const rr = me.repeatedReads.find(r => r.path.endsWith('engine.mjs'));
    if (!rr || rr.count < 2) return false;
    // Path must be redacted: [8hex]/basename, not the raw /proj/src/ prefix
    return /^\[[0-9a-f]{8}\]\/engine\.mjs$/.test(rr.path);
  } catch { return false; } })()
    ? ok('economics Wave 3: mapEffectiveness has schemaVersion, repeated engine.mjs read detected, path redacted as [8hex]/basename') : bad(`economics Wave 3: mapEffectiveness block wrong: ${JSON.stringify(JSON.parse(tr.stdout || '{}').mapEffectiveness)?.slice(0,400)}`);

  // EACP Wave 4 (cards #238 / #239): budget→resolver path + routing ROI + token-report keys.

  // Wave 4 budget→resolver path (headline #238 assertion — ADR-0044 D3).
  await (async () => { try {
    const budLib      = await import('file://' + path.resolve(proj, 'contextkit/tools/scripts/economics/budgets.mjs').replaceAll('\\', '/'));
    const resolverLib = await import('file://' + path.resolve(proj, 'contextkit/runtime/config/resolve-autonomy.mjs').replaceAll('\\', '/'));
    // Over-limit spend → budgetExhausted true
    const adv = budLib.evaluateBudget({ tokens: 200 }, { scope: 'session', limit: 100, hardCap: 150 }, {});
    if (adv.budgetExhausted !== true) { bad('Wave 4 budget: budgetExhausted should be true for 200/100/150'); return; }
    ok('economics Wave 4: evaluateBudget 200/100 hardCap 150 → budgetExhausted true (#238)');
    // Grade 4 WITH budgetExhausted → mode 'suggest' (ADR-0044 D3)
    const withBudget = resolverLib.resolveAutonomy('edit', { autonomy: { grade: 4 }, deliberations: { active: true } }, null, { budgetExhausted: adv.budgetExhausted });
    withBudget.mode === 'suggest'
      ? ok('economics Wave 4: grade-4 edit + budgetExhausted → mode "suggest" (ADR-0044 D3 budget→resolver path)')
      : bad(`Wave 4 budget→resolver: expected mode "suggest", got "${withBudget.mode}"`);
    // Grade 4 WITHOUT budgetExhausted → mode 'auto'
    const withoutBudget = resolverLib.resolveAutonomy('edit', { autonomy: { grade: 4 }, deliberations: { active: true } }, null, {});
    withoutBudget.mode === 'auto'
      ? ok('economics Wave 4: grade-4 edit without budgetExhausted → mode "auto"')
      : bad(`Wave 4 budget→resolver: grade-4 no-budget expected "auto", got "${withoutBudget.mode}"`);
    // area 'adr' is ALWAYS mode 'manual' — floor holds regardless of grade
    const adrResult = resolverLib.resolveAutonomy('adr', { autonomy: { grade: 4 }, deliberations: { active: true } }, null, {});
    adrResult.mode === 'manual'
      ? ok('economics Wave 4: area "adr" → mode "manual" at grade 4 (floor holds)')
      : bad(`Wave 4 budget→resolver: adr floor broken — got "${adrResult.mode}"`);
  } catch (err) { bad(`Wave 4 budget→resolver crashed: ${err?.message ?? err}`); } })();

  // Wave 4 routing ROI + fableAudit (#239 assertion).
  await (async () => { try {
    const routLib = await import('file://' + path.resolve(proj, 'contextkit/tools/scripts/economics/routing-economics.mjs').replaceAll('\\', '/'));
    const regLib  = await import('file://' + path.resolve(proj, 'contextkit/tools/scripts/economics/pricing/pricing-registry.mjs').replaceAll('\\', '/'));
    // routingROI quality withheld → savings null
    const roiNoQa = routLib.routingROI({ usd: 1 }, { usd: 0.4 }, {});
    roiNoQa.savings === null
      ? ok('economics Wave 4: routingROI no qa signals → savings null (quality withheld)')
      : bad(`Wave 4 routingROI: savings should be null without qa, got ${roiNoQa.savings}`);
    // routingROI equivalent quality → savings > 0
    const roiEquiv = routLib.routingROI({ usd: 1 }, { usd: 0.4 }, { baselinePassRate: 0.9, routedPassRate: 0.9 });
    typeof roiEquiv.savings === 'number' && roiEquiv.savings > 0
      ? ok('economics Wave 4: routingROI equivalent quality (0.9/0.9) → savings > 0')
      : bad(`Wave 4 routingROI: equivalent-quality savings wrong: ${roiEquiv.savings}`);
    // fableAudit: price.input===10 OR skipped path (degrade-to-skip is valid per §8)
    const reg = regLib.loadRegistry();
    const fableVerdict = routLib.fableAudit(reg, {});
    if (fableVerdict?.status === 'skipped') {
      ok('economics Wave 4: fableAudit → skipped (fable-5 absent from installed registry — degrade-to-skip)');
    } else {
      fableVerdict.price?.input === 10
        ? ok('economics Wave 4: fableAudit price.input === 10 (offline registry)')
        : bad(`Wave 4 fableAudit: price.input should be 10, got ${fableVerdict.price?.input}`);
    }
  } catch (err) { bad(`Wave 4 routing crashed: ${err?.message ?? err}`); } })();

  // Wave 4 token-report JSON: budgetGuard key exists + routing.premiumModels includes opus.
  (() => { try {
    const j = JSON.parse(tr.stdout);
    // budgetGuard key must exist (value may be null if no budget configured in fixture)
    'budgetGuard' in j
      ? ok('economics Wave 4: token-report --json has top-level "budgetGuard" key (#238)')
      : bad(`Wave 4 token-report: "budgetGuard" key missing from JSON — keys: ${Object.keys(j).join(', ')}`);
    // routing key must exist and premiumModels must include the opus model from the fixture
    j.routing != null && Array.isArray(j.routing.premiumModels) &&
    j.routing.premiumModels.includes('claude-opus-4-8')
      ? ok('economics Wave 4: token-report --json has routing.premiumModels including "claude-opus-4-8" (#239)')
      : bad(`Wave 4 token-report: routing.premiumModels wrong — ${JSON.stringify(j.routing)?.slice(0,200)}`);
  } catch (err) { bad(`Wave 4 token-report JSON parse crashed: ${err?.message ?? err}`); } })();

  // EACP Wave 5 (cards #240/#241): quota snapshots + autonomy multiplier.
  await (async () => { try {
    const qL = await import('file://' + path.resolve(proj, 'contextkit/tools/scripts/economics/quota-snapshots.mjs').replaceAll('\\', '/'));
    const aL  = await import('file://' + path.resolve(proj, 'contextkit/tools/scripts/economics/autonomy-multiplier.mjs').replaceAll('\\', '/'));
    // (a) Write inferred + unknown snapshots; verify round-trip confidence.
    const sf = join(proj, 'contextkit', 'memory', 'quota-snapshots.jsonl');
    qL.appendSnapshot(qL.buildSnapshot({ host: 'claude', remainingPct: 55, captureMethod: 'manual' }), sf);
    qL.appendSnapshot(qL.buildSnapshot({ host: 'cursor', captureMethod: 'manual' }), sf);
    const recs = qL.readSnapshots(sf);
    recs.length === 2 && recs[0].confidence === 'inferred' && recs[1].confidence === 'unknown'
      ? ok('economics Wave 5: appendSnapshot+readSnapshots round-trip (inferred+unknown) from installed proj')
      : bad(`Wave 5 quota: round-trip wrong — ${JSON.stringify(recs)}`);
    // (b) token-report --json now carries quota + autonomy keys at schema v2
    const trW5 = script('token-report.mjs', '--from', ttx, '--json');
    (() => { try { const j = JSON.parse(trW5.stdout); return j.schemaVersion === 'eacp-token-report/2' && 'quota' in j && 'autonomy' in j; } catch { return false; } })()
      ? ok('economics Wave 5: token-report --json carries "quota" and "autonomy" keys at schemaVersion "eacp-token-report/2"')
      : bad(`Wave 5 token-report: quota/autonomy keys missing — ${trW5.stdout?.slice(0, 200)}`);
    // (c) quota block is populated (snapshots written above)
    (() => { try { const j = JSON.parse(trW5.stdout); return j.quota && j.quota.status !== 'skipped' && j.quota.hosts >= 1; } catch { return false; } })()
      ? ok('economics Wave 5: token-report quota block populated (hosts>=1) after writing snapshots')
      : bad(`Wave 5 token-report: quota block not populated — ${JSON.stringify(JSON.parse(trW5.stdout || '{}').quota)?.slice?.(0, 200)}`);
    // (d) autonomyMultiplier: ratio≈1.667, confidence 'derived', claim null
    const mD = aL.autonomyMultiplier({ qaGreen: 10, units: 5 }, { qaGreen: 6, units: 5 }, { unit: 'quota' });
    typeof mD.multiplier === 'number' && Math.abs(mD.multiplier - 10 / 6) < 0.001 && mD.confidence === 'derived' && mD.claim === null
      ? ok('economics Wave 5: autonomyMultiplier derived — ratio≈1.667, confidence="derived", claim===null')
      : bad(`Wave 5 autonomy: derived result wrong — ${JSON.stringify(mD)?.slice(0, 200)}`);
    // (e) substitute unit → confidence 'inferred'
    aL.autonomyMultiplier({ qaGreen: 10, units: 5 }, { qaGreen: 6, units: 5 }, { unit: 'effective-mtok' }).confidence === 'inferred'
      ? ok('economics Wave 5: autonomyMultiplier substitute unit ("effective-mtok") → confidence "inferred"')
      : bad('Wave 5 autonomy: substitute unit should produce "inferred"');
    // (f) Goodhart guard: criticalBypass blocks even with all criteria met
    aL.usefulAutonomy({ acceptanceMet: true, testsRun: true, qaGreen: true, criticalBypass: true }) === false
      ? ok('economics Wave 5: usefulAutonomy Goodhart guard — criticalBypass blocks even with full green')
      : bad('Wave 5 autonomy: criticalBypass should block usefulAutonomy');
    // (g) countUseful: 2 green out of 3 (1 failed acceptance)
    const ct = aL.countUseful([{ acceptanceMet: true, testsRun: true, qaGreen: true }, { acceptanceMet: true, testsRun: true, qaGreen: true }, { acceptanceMet: false }]);
    ct.greenCount === 2 && ct.total === 3
      ? ok('economics Wave 5: countUseful greenCount===2 over 3 tasks (1 failed acceptance)')
      : bad(`Wave 5 autonomy: countUseful wrong — ${JSON.stringify(ct)}`);
  } catch (err) { bad(`Wave 5 quota+autonomy crashed: ${err?.message ?? err}`); } })();
  const benchRep = await import('file://' + (await import('node:path')).resolve(proj, 'contextkit/tools/scripts/economics/benchmark-report.mjs').replaceAll('\\', '/')); // Wave 6 (EACP #242)
  const benchCmp = benchRep.comparePilot({ A: { qaGreen: 6, units: 5, mock: true }, C: { qaGreen: 10, units: 5 } });
  benchCmp.confidence === 'unknown' && benchCmp.claim === null ? ok('economics Wave 6: benchmark comparePilot degrades to "unknown"+claim null from installed proj (no #176 baseline)') : bad(`Wave 6 benchmark: comparePilot should degrade — ${JSON.stringify(benchCmp)?.slice(0, 140)}`);
} catch (err) {
  bad(`crashed: ${err?.stack || err}`);
} finally {
  fx.cleanup();
}

rep.finish('Integration (token economy)');
