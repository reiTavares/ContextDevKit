/**
 * gate-advisory.mjs — Economy advisory text for the CDK-032 PreToolUse gate
 * (ADR-0103 activation go-live, ECON-09/ECON-10).
 *
 * WHY a sibling of the hook (not inline): keeps execution-gate.mjs within the
 * 308-line budget and makes the advisory logic unit-testable. The hook does the
 * I/O (config load, ledger read, disk read) and passes everything in;
 * `readLedger` is injected so this module never imports a runtime hook (clean
 * layering) and the test can drive it with a fake.
 *
 * SAFETY CONTRACT (immutable rule 2 + ADR-0103): this NEVER blocks. It only
 * returns a string for the hook to write to stderr (warn) or null. It does NOT
 * feed the gate's deny path — economy signals are advisory regardless of
 * enforcement.mode. Fully fail-open: any error → null.
 *
 * Signals:
 *   - patch-economy (#263): a large existing file rewritten via Write where an
 *     Edit would send only the diff → suggest Edit.
 *   - loop-breaker (#262): the same file written repeatedly this session
 *     (no-progress) → nudge a different approach. Modest by design — the richer
 *     command/error history is not captured yet; this uses the ledger's
 *     modification trail (the only honest source available).
 *
 * Zero runtime dependencies — node:* only.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { resolveEconomyFlags, rolloutGate } from './economy-governance.mjs';
import { patchEconomySignal } from './patch-economy.mjs';
import { loopBreakerSignal } from './loop-breaker.mjs';

/**
 * Builds the economy advisory text for one gated tool call, or null when there
 * is nothing to say (or the feature is off / an error occurs — fail-open).
 *
 * @param {{
 *   config: object,
 *   payload: any,
 *   toolName: string|null,
 *   root: string,
 *   sessionId: string|null,
 *   readLedger: (sid: string) => Promise<{ modifications?: Array<{tool:string,path:string}> }>
 * }} params
 * @returns {Promise<string|null>}
 */
export async function buildEconomyAdvisory({ config, payload, toolName, root, sessionId, readLedger }) {
  try {
    const flags = resolveEconomyFlags(config);
    if (flags.enabled === false) return null;

    const input = (payload && payload.tool_input && typeof payload.tool_input === 'object')
      ? payload.tool_input : {};
    const lines = [];

    // patch-economy (#263): large Write rewrite → suggest Edit/patch.
    if (rolloutGate(flags, 'patchEconomy') && toolName === 'Write') {
      const filePath = typeof input.file_path === 'string' ? input.file_path : '';
      let existing;
      try { existing = filePath ? readFileSync(resolve(root, filePath), 'utf-8') : undefined; }
      catch { existing = undefined; }
      const sig = patchEconomySignal(
        { tool: 'Write', path: filePath, input: { new_content: input.content, existing_content: existing } },
        'advisory',
      );
      if (sig.patchEconomy.suggestPatch) lines.push(`[economy] ${sig.patchEconomy.reason}`);
    }

    // loop-breaker (#262): repeated identical writes this session → no-progress nudge.
    if (rolloutGate(flags, 'loopBreaker') && typeof readLedger === 'function' && sessionId) {
      const ledger  = await readLedger(sessionId);
      const history = (Array.isArray(ledger?.modifications) ? ledger.modifications : [])
        .slice(-6)
        .map((m) => ({ cmd: `${m?.tool ?? '?'}:${m?.path ?? '?'}` }));
      const sig = loopBreakerSignal(history, 'advisory');
      if (sig.loopBreaker.detected) lines.push(`[economy] ${sig.loopBreaker.suggestion}`);
    }

    return lines.length ? lines.join('\n') + '\n' : null;
  } catch {
    return null; // fail-open: economy advisory NEVER breaks a tool call
  }
}

/**
 * Self-check suite for gate-advisory.mjs. Pure + fail-open (each assertion
 * caught). Drives buildEconomyAdvisory with a fake ledger so no disk is touched.
 *
 * @param {string} _root - repo root (unused; runner signature parity)
 * @returns {Promise<{ name: string, pass: boolean, detail: string }[]>}
 */
export async function econCheckGateAdvisory(_root) {
  const checks = [];
  const run = async (name, fn) => {
    try { await fn(); checks.push({ name, pass: true, detail: 'ok' }); }
    catch (err) { checks.push({ name, pass: false, detail: err?.message ?? String(err) }); }
  };
  const assert = (cond, msg) => { if (!cond) throw new Error(msg); };

  const largeBase = Array.from({ length: 120 }, (_, i) => `  const v${i} = f(in${i}); // ${i}`).join('\n');
  // Note: existing_content is injected via a fake — patchEconomySignal reads it
  // from input, so we exercise the signal without disk I/O by passing a payload
  // whose file content we can't read (the disk read fails → existing undefined →
  // suggestPatch:false). We assert the loop-breaker + fail-open paths here and
  // rely on econCheckPatchEconomy for the patch math itself.

  // loop-breaker: 3 identical recent writes → advisory line present.
  await run('loop-breaker: 3 identical writes → advisory text', async () => {
    const fakeLedger = async () => ({
      modifications: [
        { tool: 'Write', path: 'a.mjs' }, { tool: 'Write', path: 'a.mjs' }, { tool: 'Write', path: 'a.mjs' },
      ],
    });
    const text = await buildEconomyAdvisory({
      config: {}, payload: { tool_input: { file_path: 'a.mjs' } }, toolName: 'Edit',
      root: process.cwd(), sessionId: 'sid', readLedger: fakeLedger,
    });
    assert(typeof text === 'string' && text.includes('[economy]'), `expected advisory text, got ${text}`);
  });

  // master economy.enabled:false → null (whole stack gated off).
  await run('economy.enabled:false → null (no advisory)', async () => {
    const fakeLedger = async () => ({ modifications: [
      { tool: 'Write', path: 'a.mjs' }, { tool: 'Write', path: 'a.mjs' }, { tool: 'Write', path: 'a.mjs' },
    ] });
    const text = await buildEconomyAdvisory({
      config: { economy: { enabled: false } }, payload: { tool_input: {} }, toolName: 'Edit',
      root: process.cwd(), sessionId: 'sid', readLedger: fakeLedger,
    });
    assert(text === null, `expected null when economy disabled, got ${text}`);
  });

  // loopBreaker individually disabled → no loop line even with a repeat run.
  await run('loopBreaker disabled → no loop advisory', async () => {
    const fakeLedger = async () => ({ modifications: [
      { tool: 'Write', path: 'a.mjs' }, { tool: 'Write', path: 'a.mjs' }, { tool: 'Write', path: 'a.mjs' },
    ] });
    const text = await buildEconomyAdvisory({
      config: { economy: { loopBreaker: { enabled: false } } },
      payload: { tool_input: {} }, toolName: 'Edit',
      root: process.cwd(), sessionId: 'sid', readLedger: fakeLedger,
    });
    assert(text === null, `expected null with loopBreaker off, got ${text}`);
  });

  // fail-open: a throwing readLedger never propagates.
  await run('throwing readLedger → fail-open null (never throws)', async () => {
    const boom = async () => { throw new Error('disk gone'); };
    const text = await buildEconomyAdvisory({
      config: {}, payload: { tool_input: {} }, toolName: 'Edit',
      root: process.cwd(), sessionId: 'sid', readLedger: boom,
    });
    assert(text === null, `expected null on error, got ${text}`);
  });

  return checks;
}
