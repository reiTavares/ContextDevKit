/**
 * patch-economy.mjs — Patch-economy advisory signal for Economy Runtime
 * (WF0020, CDK-263 ECON-10).
 *
 * WHY this exists: when Claude Code rewrites an existing large file via the
 * Write tool where an Edit/patch would transmit only the changed diff, the
 * entire file content travels through the API twice (request + confirmation).
 * For a 10 KB file with a 2-line change this is ~200-500x the token cost of
 * a targeted Edit. This module detects that pattern and surfaces a
 * projectState-compatible advisory signal so future wiring can nudge the model
 * toward Edit (CDK-032, ADR-0082).
 *
 * Public surface:
 *   assessPatchEconomy({ tool, path, newContent, existingContent })
 *     → { suggestPatch, reason, existingBytes, newBytes, changedRatio, estimatedWaste }
 *   patchEconomySignal(action, mode='advisory')
 *     → { patchEconomy: { suggestPatch, reason, estimatedWaste, escalate } }
 *   econCheckPatchEconomy(root)
 *     → { name, pass, detail }[]   (CI self-check suite)
 *
 * Design constraints:
 *   - Advisory + fail-open: bad/missing input → { suggestPatch: false }.
 *   - UNREGISTERED: no hook or boot wiring in Phase 1.
 *   - Zero runtime dependencies — node:* only.
 *   - escalate only at mode==='strict' AND assessment.suggestPatch===true;
 *     advisory/guarded always return escalate:false — NEVER blocks.
 *
 * Split rationale: pure computation (helpers + assessPatchEconomy) lives in
 * patch-economy-core.mjs to keep both files within the 308-line constitution
 * ceiling (§1 +10% tolerance).
 */

export { assessPatchEconomy } from './patch-economy-core.mjs';
import { assessPatchEconomy } from './patch-economy-core.mjs';

// ---------------------------------------------------------------------------
// patchEconomySignal
// ---------------------------------------------------------------------------

/**
 * @typedef {Object} PatchEconomySlice
 * @property {boolean} suggestPatch   - Forwarded from assessment
 * @property {string}  reason         - Forwarded from assessment
 * @property {number}  estimatedWaste - Forwarded from assessment
 * @property {boolean} escalate       - True only in 'strict' mode when suggestPatch:true
 */

/**
 * Wraps assessPatchEconomy in a projectState-compatible shape for CDK-032
 * integration (future wiring). Advisory by design: decision is NEVER 'deny'.
 *
 * `escalate` semantics (per WF0020 spec):
 *   - 'strict' mode: escalate:true when suggestPatch is true (action is both
 *     reversible — a Write can be undone — and bypassable — Edit is available).
 *   - 'advisory' or 'guarded': escalate always false — NEVER blocks.
 *
 * Hook payload mapping: `input.new_content` and `input.existing_content` are
 * used when present (mirrors Claude Code pre-tool-use hook payload shape).
 *
 * Fail-open: any exception inside assessPatchEconomy is caught; returns
 * { patchEconomy: { suggestPatch:false, reason:'', estimatedWaste:0, escalate:false } }.
 *
 * @param {{ tool?: string, path?: string, input?: Record<string, unknown> }|null} action
 * @param {'advisory'|'guarded'|'strict'} [mode='advisory']
 * @returns {{ patchEconomy: PatchEconomySlice }}
 */
export function patchEconomySignal(action, mode = 'advisory') {
  const safeMode = (mode === 'strict' || mode === 'guarded') ? mode : 'advisory';

  let assessment;
  try {
    const safeAction = (action && typeof action === 'object') ? action : {};
    const input      = (safeAction.input && typeof safeAction.input === 'object')
      ? safeAction.input
      : {};

    assessment = assessPatchEconomy({
      tool:            typeof safeAction.tool === 'string' ? safeAction.tool : undefined,
      path:            typeof safeAction.path === 'string' ? safeAction.path : undefined,
      newContent:      typeof input.new_content      === 'string' ? input.new_content      : undefined,
      existingContent: typeof input.existing_content === 'string' ? input.existing_content : undefined,
    });
  } catch {
    assessment = { suggestPatch: false, reason: '', estimatedWaste: 0, changedRatio: 0 };
  }

  const escalate = safeMode === 'strict' && assessment.suggestPatch === true;

  return {
    patchEconomy: {
      suggestPatch:   assessment.suggestPatch,
      reason:         assessment.reason,
      estimatedWaste: assessment.estimatedWaste,
      escalate,
    },
  };
}

// ---------------------------------------------------------------------------
// CI check export
// ---------------------------------------------------------------------------

/**
 * Self-check suite for patch-economy.mjs + patch-economy-core.mjs.
 * Pure and fail-open: each assertion is caught individually; a thrown error
 * becomes a failed check, not an unhandled rejection.
 * Called by the wave selfcheck runner with the repo root path.
 *
 * Checks:
 *   1. Large file + 1-line change via Write → suggestPatch:true with a reason
 *   2. Brand-new file (no existingContent) → suggestPatch:false (fail-open)
 *   3. Edit tool → suggestPatch:false always
 *   4. Small file rewrite → suggestPatch:false
 *   5. Large file + large structural change → suggestPatch:false
 *   6. advisory mode → escalate:false
 *   7. strict mode + large file small change → escalate:true
 *   8. patchEconomySignal null action → no throw, suggestPatch:false
 *   9. changedRatio in [0,1] and estimatedWaste is non-negative integer
 *
 * @param {string} _root - Repo root path (unused; present for runner signature parity)
 * @returns {{ name: string, pass: boolean, detail: string }[]}
 */
export function econCheckPatchEconomy(_root) {
  const checks = [];

  /** @param {string} name @param {()=>void} fn */
  function check(name, fn) {
    try {
      fn();
      checks.push({ name, pass: true, detail: 'ok' });
    } catch (err) {
      checks.push({ name, pass: false, detail: err?.message ?? String(err) });
    }
  }

  /** @param {boolean} cond @param {string} msg */
  function assert(cond, msg) {
    if (!cond) throw new Error(msg);
  }

  // ---- shared fixtures ----

  // Large existing file: 120 lines × ~50 chars = ~6000 chars >> 2048 B.
  const largeBase = Array.from({ length: 120 }, (_, i) =>
    `  const value${i} = computeSomething(input${i}); // line ${i}`
  ).join('\n');

  // Version with only one line changed (line 0 tweaked) — very low changedRatio.
  const largeOneLineDiff = largeBase.replace('computeSomething(input0)', 'computeOther(input0)');

  // Completely new content with no overlapping lines — high changedRatio.
  const completelyNewContent = Array.from({ length: 100 }, (_, i) =>
    `export const brand_new_${i} = ${i * 7};`
  ).join('\n');

  // Small file well below the 2048 B threshold.
  const smallFile = 'const x = 1;\nconst y = 2;\n';

  // ---- check 1 ----
  check('large file + 1-line change via Write → suggestPatch:true with reason', () => {
    const result = assessPatchEconomy({
      tool:            'Write',
      newContent:      largeOneLineDiff,
      existingContent: largeBase,
    });
    assert(result.suggestPatch === true,
      `expected suggestPatch:true, got ${result.suggestPatch} (changedRatio=${result.changedRatio.toFixed(3)})`);
    assert(typeof result.reason === 'string' && result.reason.length > 0,
      `expected non-empty reason, got "${result.reason}"`);
    assert(result.estimatedWaste > 0,
      `expected estimatedWaste > 0, got ${result.estimatedWaste}`);
  });

  // ---- check 2 ----
  check('new file (no existingContent) → suggestPatch:false', () => {
    const result = assessPatchEconomy({ tool: 'Write', newContent: largeBase });
    assert(result.suggestPatch === false,
      `expected suggestPatch:false for new file, got ${result.suggestPatch}`);
  });

  // ---- check 3 ----
  check('Edit tool → suggestPatch:false always', () => {
    const result = assessPatchEconomy({
      tool: 'Edit', newContent: largeOneLineDiff, existingContent: largeBase,
    });
    assert(result.suggestPatch === false,
      `expected suggestPatch:false for Edit tool, got ${result.suggestPatch}`);
  });

  // ---- check 4 ----
  check('small file rewrite → suggestPatch:false', () => {
    const result = assessPatchEconomy({
      tool: 'Write', newContent: smallFile + 'const z = 3;\n', existingContent: smallFile,
    });
    assert(result.suggestPatch === false,
      `expected suggestPatch:false for small file, got ${result.suggestPatch}`);
  });

  // ---- check 5 ----
  check('large file + large structural change → suggestPatch:false', () => {
    const result = assessPatchEconomy({
      tool: 'Write', newContent: completelyNewContent, existingContent: largeBase,
    });
    assert(result.suggestPatch === false,
      `expected suggestPatch:false for large change, got ${result.suggestPatch} ` +
      `(changedRatio=${result.changedRatio.toFixed(3)})`);
  });

  // ---- check 6 ----
  check('advisory mode → escalate:false', () => {
    const signal = patchEconomySignal(
      { tool: 'Write', input: { new_content: largeOneLineDiff, existing_content: largeBase } },
      'advisory',
    );
    assert(signal.patchEconomy.escalate === false,
      `expected escalate:false in advisory mode, got ${signal.patchEconomy.escalate}`);
  });

  // ---- check 7 ----
  check('strict mode + large file 1-line change → escalate:true', () => {
    const signal = patchEconomySignal(
      { tool: 'Write', input: { new_content: largeOneLineDiff, existing_content: largeBase } },
      'strict',
    );
    assert(signal.patchEconomy.escalate === true,
      `expected escalate:true in strict mode, got ${signal.patchEconomy.escalate}`);
    assert(signal.patchEconomy.suggestPatch === true,
      `expected suggestPatch:true in strict mode, got ${signal.patchEconomy.suggestPatch}`);
  });

  // ---- check 8 ----
  check('patchEconomySignal null action → no throw, suggestPatch:false', () => {
    let threw = false;
    let signal;
    try { signal = patchEconomySignal(null); } catch { threw = true; }
    assert(!threw, 'patchEconomySignal must not throw on null action');
    assert(signal?.patchEconomy?.suggestPatch === false,
      `expected suggestPatch:false, got ${signal?.patchEconomy?.suggestPatch}`);
  });

  // ---- check 9 ----
  check('changedRatio in [0,1] and estimatedWaste is non-negative integer', () => {
    const result = assessPatchEconomy({
      tool: 'Write', newContent: largeOneLineDiff, existingContent: largeBase,
    });
    assert(result.changedRatio >= 0 && result.changedRatio <= 1,
      `changedRatio must be in [0,1], got ${result.changedRatio}`);
    assert(Number.isInteger(result.estimatedWaste) && result.estimatedWaste >= 0,
      `estimatedWaste must be a non-negative integer, got ${result.estimatedWaste}`);
    assert(result.existingBytes > 0,
      `existingBytes must be positive, got ${result.existingBytes}`);
  });

  return checks;
}
