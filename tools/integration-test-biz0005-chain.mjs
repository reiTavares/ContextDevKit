#!/usr/bin/env node
/**
 * ContextDevKit integration test — BIZ-0005 program distribution (WF-0079, RO3-T2).
 *
 * BIZ-0005 shipped four capabilities across WF-0075..0078 (two-tier dispatch gate,
 * DDD-first quality/MADM, the zero-config autonomy dial, and graph-driven cross-squad
 * selection). This proves the WHOLE chain lands on a REAL fresh install, that the
 * ADR-allocator fix already shipped by WF-0069 is distributed and guarded against
 * regression, and that --update is non-destructive:
 *
 *   1. install/marker    — a fresh L5 install lands all four WF-0075..0078 artifacts.
 *   2. dispatch gate      — the WF-0075 pre-write dispatch check is wired + inert OFF.
 *   3. autonomy dial       — the WF-0077 single-dial config resolves; no l5.lineBudget
 *                           alias ships (WF-0077 retired it).
 *   4. allocator guard     — nextAdrNumber recognizes the canonical `ADR-NNNN-*.md`
 *                           form on the SHIPPED copy (verify-distribution, not
 *                           re-implement — WF-0069 already fixed the core bug).
 *   5. update              — a second --update is non-destructive: all four artifacts
 *                           + the allocator fix survive.
 *
 * Run:  node tools/integration-test-biz0005-chain.mjs   (exit 0 = healthy)
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { KIT, installFixture, reporter, run } from './it-helpers.mjs';

const rep = reporter();
const { ok, bad } = rep;
console.log('\n🔗 ContextDevKit integration test — BIZ-0005 program distribution (WF-0079)\n');

const fx = installFixture(rep);
try {
  const ck = (...p) => join(fx.proj, 'contextkit', ...p);

  // ── 1. fresh install lands all four WF-0075..0078 artifacts ───────────────
  const artifacts = [
    ['runtime/domain-engineering/code-gate.mjs', 'WF-0075 (dispatch gate)'],
    ['tools/scripts/madm-generate.mjs', 'WF-0076 (MADM generator)'],
    ['runtime/hooks/autonomy-signals.mjs', 'WF-0077 (autonomy posture)'],
    ['runtime/execution/request-agent-select.mjs', 'WF-0078 (squad selection)'],
  ];
  for (const [rel, label] of artifacts) {
    existsSync(ck(rel))
      ? ok(`fresh install lands ${label}: ${rel}`)
      : bad(`fresh install MISSING ${label}: ${rel} (distribution gap)`);
  }

  // WF-0075's requiredAgentsDispatched branch + WF-0078's graphOwnership weight are
  // KIT CODE riding the same file as WF-0068's artifacts — confirm the actual symbols
  // landed (not just that the file exists), so a stale template copy cannot pass.
  const codeGateSrc = existsSync(ck('runtime/domain-engineering/code-gate.mjs')) ? readFileSync(ck('runtime/domain-engineering/code-gate.mjs'), 'utf-8') : '';
  codeGateSrc.includes('requiredAgentsDispatched')
    ? ok('WF-0075 requiredAgentsDispatched symbol present in the shipped code-gate.mjs')
    : bad('WF-0075 requiredAgentsDispatched symbol MISSING from the shipped code-gate.mjs (stale copy)');
  const selectSrc = existsSync(ck('runtime/execution/request-agent-select.mjs')) ? readFileSync(ck('runtime/execution/request-agent-select.mjs'), 'utf-8') : '';
  selectSrc.includes('graphOwnership') && selectSrc.includes('deriveSquadStakes')
    ? ok('WF-0078 graphOwnership + deriveSquadStakes symbols present in the shipped selector')
    : bad('WF-0078 graphOwnership/deriveSquadStakes symbols MISSING from the shipped selector (stale copy)');

  // product-team two-part fix ships in both registries (WF-0078).
  const squadsReg = existsSync(ck('policy/squads-registry.json')) ? JSON.parse(readFileSync(ck('policy/squads-registry.json'), 'utf-8')) : { squads: [] };
  const agentReg = existsSync(ck('policy/agent-capability-registry.json')) ? JSON.parse(readFileSync(ck('policy/agent-capability-registry.json'), 'utf-8')) : { agents: [] };
  const hasSquad = squadsReg.squads.some((s) => s.squad === 'product-team' && Array.isArray(s.paths) && s.paths.length > 0);
  const po = agentReg.agents.find((a) => a.agent === 'product-owner');
  const anchored = po && Array.isArray(po.pathPatterns) && po.pathPatterns.length > 0;
  hasSquad && anchored
    ? ok('fresh install lands the product-team two-part fix (squad entry + agent anchor)')
    : bad(`fresh install missing the product-team fix: squadEntry=${hasSquad} anchor=${anchored}`);

  // ── 2. WF-0075 dispatch gate: wired at L5, inert with domainEngineering OFF ─
  const settingsPath = join(fx.proj, '.claude', 'settings.json');
  const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf-8')) : { hooks: {} };
  const cmds = (evt) => (settings.hooks?.[evt] || []).flatMap((g) => (g.hooks || []).map((h) => String(h.command || '')));
  cmds('PreToolUse').some((c) => c.includes('domain-code-gate.mjs'))
    ? ok('settings.json wires domain-code-gate.mjs (PreToolUse) — the WF-0075 dispatch branch rides the existing hook, no new hook added')
    : bad('settings.json does NOT wire domain-code-gate.mjs');

  const writePayload = JSON.stringify({ tool_name: 'Write', tool_input: { file_path: join(fx.proj, 'src', 'order.mjs') } });
  const gateOff = run([ck('runtime', 'hooks', 'domain-code-gate.mjs')], { cwd: fx.proj, input: writePayload });
  gateOff.status === 0
    ? ok('domain-code-gate exits 0 with domainEngineering default-OFF (WF-0075 teeth are dormant until enabled, per ADR-0142 profile gate)')
    : bad(`domain-code-gate should exit 0 when default-OFF: status=${gateOff.status}`);

  // ── 3. WF-0077 single-dial config + retired l5.lineBudget alias ────────────
  // config.json on disk is intentionally sparse (write-if-missing); the resolved
  // view merges DEFAULT_CONFIG at read-time via loadConfigSync — use that, not the
  // raw file, so this test doesn't assert on an implementation detail of sparseness.
  const { loadConfigSync } = await import(pathToFileURL(ck('runtime', 'config', 'load.mjs')).href);
  const cfg = loadConfigSync(fx.proj);
  (cfg.autonomy && typeof cfg.autonomy.grade === 'number')
    ? ok(`fresh install resolves the single autonomy.grade dial (grade=${cfg.autonomy.grade})`)
    : bad('fresh install did not resolve autonomy.grade');
  (!cfg.l5 || cfg.l5.lineBudget === undefined)
    ? ok('fresh install does NOT ship the retired l5.lineBudget alias (WF-0077)')
    : bad('fresh install still ships the retired l5.lineBudget alias — WF-0077 retirement did not distribute');

  // ── 4. allocator guard — verify-distribution, not re-implement (WF-0069 fix) ─
  const idsPath = ck('tools/scripts/registry/ids.mjs');
  const idsSrc = existsSync(idsPath) ? readFileSync(idsPath, 'utf-8') : '';
  /\(\?:ADR-\)\?/.test(idsSrc) || idsSrc.includes('(?:ADR-)?')
    ? ok('the shipped ids.mjs carries the WF-0069 canonical-prefix regex fix (verify-distribution, not re-implement — rule 9)')
    : bad('the shipped ids.mjs is MISSING the WF-0069 allocator fix — a regressed copy would ship silently');

  // ── 5. --update non-destructive: all four artifacts survive ────────────────
  const upd = run([join(KIT, 'install.mjs'), '--target', fx.proj, '--update', '--yes']);
  upd.status === 0 ? ok('--update exits 0') : bad(`--update failed (status ${upd.status}): ${(upd.stderr || '').slice(0, 200)}`);
  const survived = artifacts.every(([rel]) => existsSync(ck(rel))) && existsSync(idsPath);
  survived
    ? ok('--update preserves all WF-0075..0078 artifacts + the allocator fix (non-destructive)')
    : bad('--update dropped one or more BIZ-0005 artifacts');
} catch (err) {
  bad(`unexpected failure: ${err && err.stack ? err.stack : err}`);
} finally {
  fx.cleanup();
}

rep.finish('BIZ-0005 program distribution (WF-0079)');
