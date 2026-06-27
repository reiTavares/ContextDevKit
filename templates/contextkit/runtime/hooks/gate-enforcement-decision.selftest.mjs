/**
 * Self-test for gate-enforcement-decision.mjs (OP-0005 / ADR-0125, Wave 5).
 *
 * Tests the pure resolveGateAction() function exhaustively:
 *   (a) block path: all five conditions met → action='block'
 *   (b) each degrade condition alone → action='warn'
 *   (c) advisory mode overrides even a full deny → action='warn'
 *   (d) non-ceremony capability deny in guarded → degrade/warn
 *   (e) defensive: no throw on any input
 *
 * Zero dependencies. Runs under plain `node`. Exit 0 = all pass.
 */
import { resolveGateAction, isCeremonyCap } from './gate-enforcement-decision.mjs';

const failures = [];

/**
 * Records a named assertion.
 * @param {string} label
 * @param {boolean} condition
 * @param {string} [detail]
 */
function assert(label, condition, detail = '') {
  if (condition) {
    process.stdout.write(`  ok   ${label}\n`);
  } else {
    failures.push(label);
    process.stdout.write(`  FAIL ${label}${detail ? ` — ${detail}` : ''}\n`);
  }
}

// ---------------------------------------------------------------------------
// Shared base context for the happy (block) path — all five conditions met.
// ---------------------------------------------------------------------------
const BASE_BLOCK_CTX = {
  mode: 'guarded',
  contract: { signals: { tier: 'feature' } },
  decision: 'deny',
  missedCapabilities: ['intake-completed'],
  signalsWork: { nature: 'business', confidence: 'high', needsClarification: false },
  registryLoadFailed: false,
  taskRegistered: true,
};

// (a) Happy path — all conditions met → block.
{
  const result = resolveGateAction(BASE_BLOCK_CTX);
  assert('(a) block: all five conditions met → action=block', result.action === 'block', `got ${result.action}`);
  assert('(a) block: reasonCode=block:ceremony-gate', result.reasonCode === 'block:ceremony-gate', result.reasonCode);
  assert('(a) block: reason contains capability name', result.reason.includes('intake-completed'));
}

// (a2) strict mode also blocks.
{
  const ctx = { ...BASE_BLOCK_CTX, mode: 'strict' };
  const result = resolveGateAction(ctx);
  assert('(a2) strict mode: also blocks', result.action === 'block', `got ${result.action}`);
}

// (a3) adr-required is also a ceremony cap.
{
  const ctx = { ...BASE_BLOCK_CTX, missedCapabilities: ['adr-required'] };
  const result = resolveGateAction(ctx);
  assert('(a3) adr-required: blocks as ceremony cap', result.action === 'block', `got ${result.action}`);
  assert('(a3) adr-required: reason mentions it', result.reason.includes('adr-required'));
}

// (b) Degrade conditions — each alone should degrade to warn.

// (b1) advisory mode → warn.
{
  const ctx = { ...BASE_BLOCK_CTX, mode: 'advisory' };
  const result = resolveGateAction(ctx);
  assert('(b1) advisory mode → warn', result.action === 'warn', `got ${result.action}`);
  assert('(b1) advisory mode reasonCode', result.reasonCode === 'degrade:advisory-mode', result.reasonCode);
}

// (b2) no contract on disk → warn.
{
  const ctx = { ...BASE_BLOCK_CTX, contract: null };
  const result = resolveGateAction(ctx);
  assert('(b2) no contract → warn', result.action === 'warn', `got ${result.action}`);
  assert('(b2) no contract reasonCode', result.reasonCode === 'degrade:no-contract', result.reasonCode);
}

// (b3) decision is allow (not deny) → warn.
{
  const ctx = { ...BASE_BLOCK_CTX, decision: 'allow' };
  const result = resolveGateAction(ctx);
  assert('(b3) decision=allow → warn', result.action === 'warn', `got ${result.action}`);
  assert('(b3) decision=allow reasonCode', result.reasonCode === 'degrade:non-deny', result.reasonCode);
}

// (b4) decision is warn (not deny) → warn.
{
  const ctx = { ...BASE_BLOCK_CTX, decision: 'warn' };
  const result = resolveGateAction(ctx);
  assert('(b4) decision=warn → warn', result.action === 'warn', `got ${result.action}`);
}

// (b5) no signals.work (null) → warn.
{
  const ctx = { ...BASE_BLOCK_CTX, signalsWork: null };
  const result = resolveGateAction(ctx);
  assert('(b5) no signals.work → warn', result.action === 'warn', `got ${result.action}`);
  assert('(b5) no signals.work reasonCode', result.reasonCode === 'degrade:no-signals-work', result.reasonCode);
}

// (b6) signals.work.confidence === 'ask' → warn.
{
  const ctx = { ...BASE_BLOCK_CTX, signalsWork: { nature: 'operation', confidence: 'ask', needsClarification: true } };
  const result = resolveGateAction(ctx);
  assert('(b6) confidence=ask → warn', result.action === 'warn', `got ${result.action}`);
  assert('(b6) confidence=ask reasonCode', result.reasonCode === 'degrade:signals-ask', result.reasonCode);
}

// (b7) registry load failed → warn.
{
  const ctx = { ...BASE_BLOCK_CTX, registryLoadFailed: true };
  const result = resolveGateAction(ctx);
  assert('(b7) registryLoadFailed → warn', result.action === 'warn', `got ${result.action}`);
  assert('(b7) registryLoadFailed reasonCode', result.reasonCode === 'degrade:registry-fail', result.reasonCode);
}

// (b8) task not registered → warn.
{
  const ctx = { ...BASE_BLOCK_CTX, taskRegistered: false };
  const result = resolveGateAction(ctx);
  assert('(b8) unregistered task → warn', result.action === 'warn', `got ${result.action}`);
  assert('(b8) unregistered task reasonCode', result.reasonCode === 'degrade:unregistered-task', result.reasonCode);
}

// (c) Advisory mode always warns even when deny + ceremony cap missing.
{
  const ctx = { ...BASE_BLOCK_CTX, mode: 'advisory', decision: 'deny' };
  const result = resolveGateAction(ctx);
  assert('(c) advisory + deny: never blocks', result.action === 'warn', `got ${result.action}`);
}

// (d) Non-ceremony capability deny in guarded → degrade/warn.
{
  const ctx = { ...BASE_BLOCK_CTX, missedCapabilities: ['workflow-required', 'project-map-fresh'] };
  const result = resolveGateAction(ctx);
  assert('(d) non-ceremony cap in guarded → warn', result.action === 'warn', `got ${result.action}`);
  assert('(d) non-ceremony cap reasonCode', result.reasonCode === 'degrade:non-ceremony-cap', result.reasonCode);
}

// (d2) empty missedCapabilities → warn (non-ceremony path).
{
  const ctx = { ...BASE_BLOCK_CTX, missedCapabilities: [] };
  const result = resolveGateAction(ctx);
  assert('(d2) empty missedCapabilities → warn', result.action === 'warn', `got ${result.action}`);
}

// (d3) mixed: ceremony + non-ceremony → blocks (ceremony cap present satisfies cond 4).
{
  const ctx = { ...BASE_BLOCK_CTX, missedCapabilities: ['intake-completed', 'workflow-required'] };
  const result = resolveGateAction(ctx);
  assert('(d3) mixed caps: blocks when ceremony cap present', result.action === 'block', `got ${result.action}`);
  assert('(d3) mixed caps: reason mentions intake-completed', result.reason.includes('intake-completed'));
}

// (e) Defensive — never throws on hostile/missing inputs.
{
  let threw = false;
  try {
    resolveGateAction({});
    resolveGateAction(null);
    resolveGateAction({ mode: 'advisory' });
    resolveGateAction({ mode: 'guarded', contract: null, decision: 'deny', missedCapabilities: null });
  } catch {
    threw = true;
  }
  assert('(e) defensive: no throw on hostile inputs', threw === false);
}

// isCeremonyCap helper.
{
  assert('isCeremonyCap: intake-completed → true', isCeremonyCap('intake-completed'));
  assert('isCeremonyCap: adr-required → true', isCeremonyCap('adr-required'));
  assert('isCeremonyCap: workflow-required → false', !isCeremonyCap('workflow-required'));
  assert('isCeremonyCap: empty → false', !isCeremonyCap(''));
  assert('isCeremonyCap: undefined → false', !isCeremonyCap(undefined));
}

process.stdout.write(failures.length ? `\nFAILED (${failures.length})\n` : '\nPASSED\n');
process.exit(failures.length ? 1 : 0);
