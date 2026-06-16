#!/usr/bin/env node
/**
 * Integration test for ADR-0094 automatic model routing — STANDALONE (exit 0/1).
 *
 * Exercises the routing layer as an integrated system end-to-end: config
 * resolution → classification → decision/guard → telemetry, plus the real
 * artifacts it wires (the ledger schema field, the `/log-session` posture, and
 * the `/token-report` routing surface). Covers the 20 acceptance scenarios from
 * the ADR-0094 brief. Zero-dep, `node:*` only, Windows-safe.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
const S = resolve(KIT, 'templates/contextkit/tools/scripts');
const imp = (rel) => import(pathToFileURL(resolve(S, rel)).href);

let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { console.error(`  ✗ ${m}`); failures += 1; };
const check = (cond, m) => (cond ? ok(m) : bad(m));

async function main() {
  console.log('\n🌀 ADR-0094 automatic routing — integration test\n');

  const { classifyTask } = await imp('routing/task-classifier.mjs');
  const { resolveRoutingConfig, routingBannerLine } = await imp('routing/routing-config.mjs');
  const { decideRoute } = await imp('routing/routing-decision.mjs');
  const { decisionRecord, routingTelemetrySummary } = await imp('routing/routing-telemetry.mjs');
  const { freshLedger } = await imp('../../runtime/hooks/ledger.mjs');

  const cfg = resolveRoutingConfig({ level: 7 }).config;
  const route = (sig, ctx = {}, c = cfg) => decideRoute(classifyTask(sig, c), ctx, c);

  // 1. standard session starts with routing ACTIVE (no swarm anywhere)
  const std = resolveRoutingConfig({ level: 7 });
  check(std.active === true && std.config.applyToStandardSessions === true, '1. standard session → routing active, no swarm needed');

  // 2. activation does not depend on swarm config at all
  check(routingBannerLine(std)?.includes('shadow'), '2. boot banner surfaces routing without swarm');

  // 3-4. search ops → haiku
  check(route({ kind: 'grep' }, { batch: true }).executor === 'haiku', '3. grep → Haiku');
  check(route({ kind: 'glob' }, { batch: true }).executor === 'haiku', '4. glob → Haiku');

  // 5. a single deterministic bash command → runner (no agent), batch → haiku
  check(route({ kind: 'shell' }, { commandCount: 1, expectedOutput: 'short' }).executor === 'runner', '5. single deterministic command → runner-first (no agent)');

  // 6. tests + lint → haiku
  check(route({ kind: 'test' }, { batch: true }).executor === 'haiku', '6. tests/lint → Haiku');

  // 7. simple implementation → sonnet
  const simple = route({ kind: 'implement', modulesTouched: 1, changeSize: 's' });
  check(simple.executor === 'sonnet', '7. simple implementation → Sonnet');

  // 8. moderate work routes to Sonnet with an execution rationale (Opus → contract)
  const moderate = classifyTask({ kind: 'implement', modulesTouched: 2, changeSize: 'm' }, cfg);
  check(moderate.executor === 'sonnet' && moderate.reasons.length > 0, '8. moderate work → Sonnet with rationale (Opus authors contract)');

  // 9. critical change stays on Opus
  check(route({ kind: 'implement', touchesAuth: true, sensitiveData: true }).executor === 'opus', '9. critical change → stays on Opus');

  // 10. Opus implements directly (allowOpusCoding) on critical code
  check(cfg.allowOpusCoding === true && route({ kind: 'implement', migration: true }).executor === 'opus', '10. Opus implements critical code directly');

  // 11. Fable is NEVER auto-selected (classifier + decision clamp)
  const fableNever = ['grep', 'implement', 'decision'].every((k) => classifyTask({ kind: k }, cfg).executor !== 'fable')
    && decideRoute({ complexity: 'complex', risk: 'high', executor: 'fable' }, {}, cfg).executor !== 'fable';
  check(fableNever, '11. Fable never auto-selected');

  // 12. Haiku/early failure can escalate (priorFailures ≥ 2)
  const escalated = classifyTask({ kind: 'implement', priorFailures: 2 }, cfg);
  check(escalated.escalate === true, '12. repeated failure → escalation suggested');

  // 13. escalation ladder is Haiku→Sonnet→Opus
  const dec = route({ kind: 'implement', causeClear: false, ambiguous: true });
  check(JSON.stringify(dec.escalation.order) === JSON.stringify(['haiku', 'sonnet', 'opus']), '13. escalation ladder Haiku→Sonnet→Opus');

  // 14. explicit user rules prevail (session override > project)
  const overridden = resolveRoutingConfig({ project: { mode: 'shadow' }, session: { mode: 'active' }, level: 7 });
  check(overridden.mode === 'active', '14. explicit session override wins over project config');

  // 15. compact-handoff posture is on (avoid re-reading unchanged files)
  check(cfg.compactHandoffs === true && cfg.useProjectMapFirst === true, '15. compact-handoff + project-map-first posture active');

  // 16. handoffs respect a size limit + telemetry records handoff size
  const rec = decisionRecord(simple, { handoffTokens: 1200 });
  check(typeof cfg.handoffMaxTokens === 'number' && rec.handoffTokens === 1200, '16. handoff size bounded + recorded in telemetry');

  // 17. /log-session prompt routes deterministic collection to runner/Haiku
  const logSession = readFileSync(resolve(KIT, 'templates/claude/commands/log-session.md'), 'utf-8');
  check(logSession.includes('ADR-0094') && /Haiku/.test(logSession) && /runner/.test(logSession), '17. /log-session collects via runner/Haiku (ADR-0094)');

  // 18. old sessions keep working — routing is an additive, optional ledger field
  const fresh = freshLedger('sid-x');
  check('routing' in fresh && fresh.routing === null, '18. legacy sessions unaffected (routing field additive, defaults null)');

  // 19. Token Report attributes routing telemetry (real --json run)
  const emptyDir = mkdtempSync(resolve(tmpdir(), 'routing-it-'));
  try {
    const out = execFileSync('node', [resolve(S, 'token-report.mjs'), '--json', '--from', emptyDir], { encoding: 'utf-8', cwd: KIT });
    const json = JSON.parse(out);
    check('routingTelemetry' in json && json.routingTelemetry.schemaVersion === 'routing-telemetry/1', '19. /token-report --json carries routingTelemetry');
  } catch (err) {
    bad(`19. token-report --json failed: ${err?.message ?? err}`);
  } finally {
    try { rmSync(emptyDir, { recursive: true, force: true }); } catch { /* best effort */ }
  }

  // 20. disabling via config turns the whole layer off
  const disabled = resolveRoutingConfig({ project: { enabled: false }, level: 7 });
  check(disabled.active === false && routingBannerLine(disabled) === null, '20. routing.enabled=false → inactive + no banner');

  // sanity: telemetry summary keeps the fable invariant at zero
  const sum = routingTelemetrySummary([rec, decisionRecord(route({ kind: 'grep' }, { batch: true }))]);
  check(sum.fableAutoSelected === 0, 'invariant: telemetry fableAutoSelected stays 0');

  console.log(failures === 0 ? '\n✅ routing integration test passed.\n' : `\n❌ ${failures} check(s) failed.\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error('routing integration test crashed:', err); process.exit(1); });
