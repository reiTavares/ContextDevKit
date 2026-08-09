/**
 * no-code-prior.mjs — WF-0081 (BIZ-0006, ADR-0148 position 1).
 *
 * The shared, PURE predicates that make the intake gates intent-aware:
 *   - `isSourceWrite(path)`  — compatibility alias: is this a governed write?
 *   - `turnHasWriteAttempt(attempts, taskId)` — did THIS turn attempt a write?
 *   - `noCodePriorHolds(contract, modifications, taskId)` — should the no-code
 *     prior suppress obligations right now?
 *
 * The design (ADR-0148 §1 + §8, resolve/enforce/escape):
 *   - RESOLVE: these are pure, deterministic, I/O-free predicates.
 *   - ENFORCE: the gates that consume them stay fail-open / advisory-when-uncertain.
 *   - ESCAPE: a no-code verdict is a *prior*, not a permanent state. A real write
 *     promotes the turn and runs the minimum mutation preflight once.
 *
 * In the 4.0 contract every real project mutation is authoritative. Writes to
 * documentation, memory, configuration, and host files promote just like source
 * writes. Reads never promote.
 *
 * Zero runtime dependencies — `node:*`-free, safe on the hot path (immutable rule 1).
 */

/**
 * Compatibility name for the 4.0 rule that every project write is governed.
 * The path cannot exempt a real mutation attempt.
 *
 * @param {string} path repo-relative modified path
 * @returns {boolean} always true; paths do not exempt writes
 */
export function isSourceWrite(path) {
  void path;
  return true;
}

/**
 * Check whether a host tool can perform a real file mutation.
 * @param {string} toolName host tool name
 * @returns {boolean} true when the tool is a write primitive
 */
function isWriteTool(toolName) {
  const normalized = String(toolName ?? '').toLowerCase();
  return [
    'edit', 'write', 'multiedit', 'notebookedit', 'apply_patch', 'edit_file',
    'write_file', 'write_to_file', 'replace_file_content', 'multi_replace_file_content',
  ].includes(normalized);
}

/**
 * True when THIS task has at least one transient Edit/Write/MultiEdit attempt.
 * The F-B taskId binding (each modification is stamped with its taskId by
 * track-edits) keeps the gate reading the SAME task's writes as the contract.
 *
 * @param {Array<{tool?: string, path?: string, taskId?: string}>} modifications
 * @param {string} taskId active task id
 * @returns {boolean}
 */
export function turnHasWriteAttempt(attempts, taskId) {
  const writes = Array.isArray(attempts) ? attempts : [];
  return writes.some(
    (m) => m
      && m.taskId === taskId
      && isWriteTool(m.tool),
  );
}

/**
 * True when the current tool call is a real write attempt. The path is irrelevant:
 * at PreToolUse the current write is not yet in turn history, so a past-writes check
 * alone would suppress the preflight for the very action that promotes mutation.
 *
 * @param {string} toolName the tool being invoked
 * @param {string[]} filePaths the tool's target paths (repo-relative)
 * @returns {boolean}
 */
export function currentCallRevokes(toolName, filePaths) {
  void filePaths;
  return isWriteTool(toolName);
}

/**
 * True when the interaction is conversation, exploration, or unresolved and no
 * write has occurred for this task yet. Domain vocabulary never changes this axis.
 *
 * Fail-open: a missing/low-confidence intent verdict returns `false` (the prior does
 * NOT hold → the gate behaves exactly as today, never a false suppression). Any
 * malformed input returns `false` — the safe default is full ceremony.
 *
 * @param {object} contract the loaded execution contract (`contract.signals.intent`)
 * @param {Array} modifications transient write attempts for this turn
 * @param {string} taskId active task id
 * @returns {boolean} true when obligations should be suppressed for a no-code prior
 */
export function noCodePriorHolds(contract, modifications, taskId) {
  try {
    const interactionIntent = contract?.signals?.interaction?.intent;
    const legacyIntent = contract?.signals?.intent;
    const isReadOnlyInteraction = ['conversation', 'exploration', 'unclassified'].includes(interactionIntent)
      || (legacyIntent?.intent === 'no-code' && legacyIntent?.mutationVerb !== true);
    if (!isReadOnlyInteraction || interactionIntent === 'mutation') return false;
    if (turnHasWriteAttempt(modifications, taskId)) return false;
    return true;
  } catch {
    return false; // fail-open: never suppress on malformed input
  }
}
