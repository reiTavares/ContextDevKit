/**
 * no-code-prior.mjs — WF-0081 (BIZ-0006, ADR-0148 position 1).
 *
 * The shared, PURE predicates that make the intake gates intent-aware:
 *   - `isSourceWrite(path)`  — does a write to this path count as SOURCE code?
 *   - `sessionHasSourceWrite(modifications, taskId)` — did THIS task write source?
 *   - `noCodePriorHolds(contract, modifications, taskId)` — should the no-code
 *     prior suppress obligations right now?
 *
 * The design (ADR-0148 §1 + §8, resolve/enforce/escape):
 *   - RESOLVE: these are pure, deterministic, I/O-free predicates.
 *   - ENFORCE: the gates that consume them stay fail-open / advisory-when-uncertain.
 *   - ESCAPE: a no-code verdict is a *prior*, not a permanent state. A real SOURCE
 *     write REVOKES it (OP-0008 F-A) and the full ceremony returns.
 *
 * "source write" definition (default-to-source = default-to-ceremony, the safe
 * bias against an over-permissive exemption, risk R1): a write is NON-source only
 * when its repo-relative path matches a known governance/docs/scratch surface;
 * every other tracked path (runtime/tooling/templates code + real config) is source.
 * An unknown path defaults to SOURCE — so a genuine config change still draws the
 * ceremony (risk R2), never silently exempt.
 *
 * Zero runtime dependencies — `node:*`-free, safe on the hot path (immutable rule 1).
 */

/**
 * Repo-relative path prefixes/patterns that are NON-source (a write here does NOT
 * revoke the no-code prior): governance memory, docs, per-workflow reports, scratch,
 * VCS/host artifacts, and dependency dirs. Everything else is source.
 */
export const NON_SOURCE_PATTERNS = Object.freeze([
  /(^|\/)contextkit\/memory\//,   // governance memory + business/op/workflow artifacts
  /(^|\/)docs\//,                  // documentation
  /(^|\/)reports\//,               // per-workflow reports/ (wave evidence)
  /\.scratch\.md$/,                // pipeline scratch (gitignored by convention)
  /(^|\/)\.git\//,                 // VCS internals
  /(^|\/)node_modules\//,          // dependencies
  /(^|\/)\.claude\//,              // host artifacts (Claude Code)
  /(^|\/)\.agents\//,              // host artifacts (Antigravity)
  /(^|\/)\.codex\//,               // host artifacts (Codex)
]);

/** Normalize a path to forward slashes for pattern matching (portability rule 4). */
function normalizePath(path) {
  return typeof path === 'string' ? path.replace(/\\/g, '/') : '';
}

/**
 * True when a write to `path` counts as a SOURCE write (and therefore revokes a
 * no-code prior). Defensive: a missing/non-string path defaults to `true` (source)
 * so an unreadable receipt never silently grants an exemption (default-to-refuse).
 *
 * @param {string} path repo-relative modified path
 * @returns {boolean} true when the write is source (revokes the no-code prior)
 */
export function isSourceWrite(path) {
  const normalized = normalizePath(path);
  if (normalized === '') return true; // unknown → treat as source (safe bias)
  return !NON_SOURCE_PATTERNS.some((pattern) => pattern.test(normalized));
}

/**
 * True when THIS task has at least one SOURCE Edit/Write/MultiEdit in the ledger.
 * The F-B taskId binding (each modification is stamped with its taskId by
 * track-edits) keeps the gate reading the SAME task's writes as the contract.
 *
 * @param {Array<{tool?: string, path?: string, taskId?: string}>} modifications
 * @param {string} taskId active task id
 * @returns {boolean}
 */
export function sessionHasSourceWrite(modifications, taskId) {
  const mods = Array.isArray(modifications) ? modifications : [];
  return mods.some(
    (m) => m
      && m.taskId === taskId
      && ['Edit', 'Write', 'MultiEdit'].includes(m.tool)
      && isSourceWrite(m.path),
  );
}

/**
 * True when the CURRENT tool call is itself a revoking SOURCE write — an
 * `Edit`/`Write`/`MultiEdit` targeting at least one source path. The pre-write gate
 * needs this because at PreToolUse the current write is not yet in the ledger, so a
 * past-writes check alone would wrongly suppress the ceremony for the very write that
 * revokes the prior.
 *
 * @param {string} toolName the tool being invoked
 * @param {string[]} filePaths the tool's target paths (repo-relative)
 * @returns {boolean}
 */
export function currentCallRevokes(toolName, filePaths) {
  if (!['Edit', 'Write', 'MultiEdit'].includes(toolName)) return false;
  const paths = Array.isArray(filePaths) ? filePaths : [];
  return paths.some((p) => isSourceWrite(p));
}

/**
 * True when the no-code prior should suppress obligations right now: the contract's
 * language-aware intent verdict is `no-code` (not a mutation verb), the domain is
 * general (never invert on a regulated domain — ADR-0131), AND no SOURCE write has
 * occurred for this task yet (an F-A revoking write clears the prior).
 *
 * Fail-open: a missing/low-confidence intent verdict returns `false` (the prior does
 * NOT hold → the gate behaves exactly as today, never a false suppression). Any
 * malformed input returns `false` — the safe default is full ceremony.
 *
 * @param {object} contract the loaded execution contract (`contract.signals.intent`)
 * @param {Array} modifications the session ledger's `modifications[]`
 * @param {string} taskId active task id
 * @returns {boolean} true when obligations should be suppressed for a no-code prior
 */
export function noCodePriorHolds(contract, modifications, taskId) {
  try {
    const intent = contract?.signals?.intent;
    if (!intent || intent.intent !== 'no-code' || intent.mutationVerb === true) return false;
    const domain = contract?.signals?.domain;
    if (domain && domain !== 'general') return false; // regulated domains keep ceremony
    if (sessionHasSourceWrite(modifications, taskId)) return false; // F-A: real write revokes
    return true;
  } catch {
    return false; // fail-open: never suppress on malformed input
  }
}
