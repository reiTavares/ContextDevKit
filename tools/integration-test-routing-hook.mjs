#!/usr/bin/env node
/**
 * Real-hook routing integration test — HIGH hotfix 3.0.1 (ADR-0094 §Decision).
 *
 * Proves the routing layer is wired into the ACTUAL UserPromptSubmit flow, not
 * just callable in isolation. It SPAWNS the real `execution-contract-hook.mjs`
 * with realistic payloads and asserts the full chain end-to-end:
 *
 *   prompt → UserPromptSubmit hook → intake → classification → decision →
 *   routing-decisions.jsonl → Execution Contract → /token-report
 *
 * Honesty invariants (spec §6.3/§6.8): shadow records but never applies; disabled
 * records nothing; the prompt is never persisted; `applied` is always false with a
 * host-limitation reason; a retried event is logged once; two sessions with the
 * same prompt get distinct decisions; telemetry failure never blocks the prompt.
 * Standalone (exit 0/1), zero-dep, Windows-safe.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const KIT = dirname(dirname(fileURLToPath(import.meta.url)));
const HOOK = resolve(KIT, 'templates/contextkit/runtime/hooks/execution-contract-hook.mjs');
const TOKEN_REPORT = resolve(KIT, 'templates/contextkit/tools/scripts/token-report.mjs');

let failures = 0;
const ok = (m) => console.log(`  ✓ ${m}`);
const bad = (m) => { console.error(`  ✗ ${m}`); failures += 1; };
const check = (cond, m) => (cond ? ok(m) : bad(m));

/** Build a hermetic project root with a routing config. */
function makeRoot(routing, level = 7) {
  const root = mkdtempSync(resolve(tmpdir(), 'cdk-hook-'));
  mkdirSync(resolve(root, 'contextkit', 'memory'), { recursive: true });
  mkdirSync(resolve(root, '.claude', '.sessions'), { recursive: true });
  writeFileSync(resolve(root, 'contextkit', 'config.json'), JSON.stringify({ level, routing }));
  return root;
}

/** Spawn the real hook with a UserPromptSubmit payload; returns stdout (hook always exits 0). */
function runHook(root, prompt, sessionId) {
  return execFileSync('node', [HOOK], {
    input: JSON.stringify({ prompt, session_id: sessionId }),
    cwd: root, encoding: 'utf8',
  });
}

/** Read parsed decision records from a root's telemetry ledger. */
function decisions(root) {
  const file = resolve(root, 'contextkit', 'memory', 'routing-decisions.jsonl');
  if (!existsSync(file)) return [];
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

/** Read the persisted execution contract for a task id (most recent state dir). */
function contractRouting(root, taskId) {
  const file = resolve(root, 'contextkit', 'pipeline', 'state', taskId, 'execution-contract.json');
  if (!existsSync(file)) return null;
  try { return JSON.parse(readFileSync(file, 'utf8')).routing ?? null; } catch { return null; }
}

const ARCH = 'implement OAuth2 login with database migration and authorization rules';

function main() {
  console.log('\n🌀 ADR-0094 routing — REAL UserPromptSubmit hook integration\n');

  // 1. Shadow: real prompt produces a real decision + contract routing, no apply.
  let root = makeRoot({ enabled: true, mode: 'shadow', minLevel: 4 });
  try {
    const out = runHook(root, ARCH, 'sess-aaaa1111');
    const recs = decisions(root);
    check(recs.length === 1, 'shadow: one decision recorded for a real prompt');
    const r = recs[0] || {};
    check(r.recommendedTier === 'opus', 'shadow: architectural+critical prompt → recommend opus');
    check(r.applied === false && r.reason === 'shadow_mode', 'shadow: applied=false, reason=shadow_mode (no model switch)');
    check(r.actualTier === null && r.selectedTier === null, 'shadow: selected/actual tiers are null (recommendation only)');
    check(typeof r.decisionId === 'string' && r.schemaVersion === 'routing-decision/1', 'shadow: record carries decisionId + schemaVersion');
    check(!JSON.stringify(r).includes('OAuth') && /^[0-9a-f]{8}$/.test(r.promptFingerprint), 'shadow: prompt is fingerprinted, never stored');
    check(out.includes('Routing: shadow') && out.includes('recommend opus'), 'shadow: Execution Contract surfaces the routing recommendation');
    const cr = contractRouting(root, r.taskId);
    check(cr && cr.mode === 'shadow' && cr.applied === false, 'shadow: persisted contract carries the routing summary');

    // 2. Idempotent retry — same session + same prompt = same event, logged once.
    runHook(root, ARCH, 'sess-aaaa1111');
    check(decisions(root).length === 1, 'retry of the same event does NOT duplicate the decision');

    // 9. /token-report consumes the real ledger.
    const reportRaw = execFileSync('node', [TOKEN_REPORT, '--json'], { cwd: root, encoding: 'utf8' });
    const report = JSON.parse(reportRaw);
    check(report.routingTelemetry && report.routingTelemetry.total >= 1, 'token-report consumes routing-decisions.jsonl (total ≥ 1)');
    check(report.routingTelemetry.applied === 0, 'token-report shows applied=0 (no false economy)');
  } finally { rmSync(root, { recursive: true, force: true }); }

  // 3. Disabled (master switch off) — records nothing.
  root = makeRoot({ enabled: false });
  try { runHook(root, ARCH, 'sess-bbbb'); check(decisions(root).length === 0, 'disabled (enabled:false): no decision recorded'); }
  finally { rmSync(root, { recursive: true, force: true }); }

  // 3b. Explicit mode:disabled — also records nothing.
  root = makeRoot({ enabled: true, mode: 'disabled', minLevel: 4 });
  try { runHook(root, ARCH, 'sess-bbbb2'); check(decisions(root).length === 0, 'mode:disabled: no decision recorded'); }
  finally { rmSync(root, { recursive: true, force: true }); }

  // 4. Slash command — admin, never routed.
  root = makeRoot({ enabled: true, mode: 'shadow', minLevel: 4 });
  try { runHook(root, '/state', 'sess-cccc'); check(decisions(root).length === 0, 'slash command (/state): not routed'); }
  finally { rmSync(root, { recursive: true, force: true }); }

  // 5. Pure conversation — not a task, never routed.
  root = makeRoot({ enabled: true, mode: 'shadow', minLevel: 4 });
  try { runHook(root, 'hi there', 'sess-dddd'); check(decisions(root).length === 0, 'pure conversation: not routed'); }
  finally { rmSync(root, { recursive: true, force: true }); }

  // 6. Canary — records, deterministic, never applies in this host.
  root = makeRoot({ enabled: true, mode: 'canary', minLevel: 4, canaryPct: 100 });
  try {
    runHook(root, ARCH, 'sess-eeee');
    const r = decisions(root)[0] || {};
    check(r.mode === 'canary' && r.applied === false, 'canary: recorded, applied=false (host cannot switch)');
    check(['host_does_not_support_in_session_model_switch', 'canary_not_sampled_or_ineligible'].includes(r.reason), 'canary: honest reason (host limit or not-sampled)');
  } finally { rmSync(root, { recursive: true, force: true }); }

  // 7. Active — records, never claims a model switch.
  root = makeRoot({ enabled: true, mode: 'active', minLevel: 4 });
  try {
    runHook(root, ARCH, 'sess-ffff');
    const r = decisions(root)[0] || {};
    check(r.mode === 'active' && r.applied === false && r.actualTier === null, 'active: recorded, applied=false, actualTier=null (no fake switch)');
  } finally { rmSync(root, { recursive: true, force: true }); }

  // 8. Two different sessions, same prompt → distinct decisions.
  root = makeRoot({ enabled: true, mode: 'shadow', minLevel: 4 });
  try {
    runHook(root, ARCH, 'sess-1111'); runHook(root, ARCH, 'sess-2222');
    const recs = decisions(root);
    check(recs.length === 2 && recs[0].decisionId !== recs[1].decisionId, 'two sessions, same prompt → two distinct decisions');
  } finally { rmSync(root, { recursive: true, force: true }); }

  // 10. Below routing minLevel — inert (intake still runs, routing does not).
  root = makeRoot({ enabled: true, mode: 'shadow', minLevel: 4 }, 3);
  try {
    const out = runHook(root, ARCH, 'sess-gggg');
    check(decisions(root).length === 0, 'level 3 (< routing minLevel 4): no decision recorded');
    check(!out.includes('Routing:'), 'level 3: contract has no routing line (inert)');
  } finally { rmSync(root, { recursive: true, force: true }); }

  // 11. Invalid config — hook is fail-open, never crashes.
  root = makeRoot({ enabled: true, mode: 'shadow', minLevel: 4 });
  try {
    writeFileSync(resolve(root, 'contextkit', 'config.json'), '{ this is : not json');
    let crashed = false;
    try { runHook(root, ARCH, 'sess-hhhh'); } catch { crashed = true; }
    check(!crashed, 'invalid config.json: hook stays fail-open (exit 0, no crash)');
  } finally { rmSync(root, { recursive: true, force: true }); }

  console.log(failures === 0 ? `\n✅ routing real-hook integration PASS\n` : `\n❌ ${failures} failure(s)\n`);
  process.exit(failures === 0 ? 0 : 1);
}

main();
