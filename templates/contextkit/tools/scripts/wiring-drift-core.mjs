/**
 * Wiring-drift core (CDK-068, PKG-06) — pure compare functions.
 *
 * All functions are side-effect-free (no I/O, no process.exit). The CLI
 * orchestrator (`wiring-drift.mjs`) handles I/O and rendering; this module
 * provides hermetic, unit-testable logic that can be imported by any consumer.
 *
 * Three drift dimensions:
 *   1. Wiring     — expected hook script basenames vs installed hook script basenames.
 *   2. Config     — installed config.json keys vs the known DEFAULT_CONFIG key set.
 *   3. Instruction — installed CLAUDE.md text vs a list of required marker strings.
 *
 * Rule 4 compliance: no 'contextkit/...' literals; callers supply resolved paths.
 * @module wiring-drift-core
 */

// ────────────────────────────────────────────────────────────────────────────
// 1. Wiring drift
// ────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {{ missing: string[], unexpected: string[] }} WiringDiff
 */

/**
 * Diffs expected hook script basenames against the installed set.
 *
 * - `missing`    = scripts the source expects but the install omits.
 * - `unexpected` = scripts present in the install but not in the source output.
 *
 * Both sides are Sets of basenames (e.g. "session-start.mjs"). Pure; no I/O.
 *
 * @param {Set<string>} expectedScripts basenames from composeSettings at the project's level
 * @param {Set<string>} installedScripts basenames extracted from the installed settings.json
 * @returns {WiringDiff}
 */
export function diffWiring(expectedScripts, installedScripts) {
  const missing = [...expectedScripts].filter((s) => !installedScripts.has(s)).sort();
  const unexpected = [...installedScripts].filter((s) => !expectedScripts.has(s)).sort();
  return { missing, unexpected };
}

// ────────────────────────────────────────────────────────────────────────────
// 2. Config drift
// ────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {{ unknown: string[], missing: string[] }} ConfigDiff
 */

/**
 * Diffs installed config keys (top-level) against the schema's known key set.
 *
 * - `unknown` = keys present in the installed config but not in the known set.
 * - `missing` = required keys absent from the installed config.
 *
 * "Required" for CDK-068 purposes means every key present in the DEFAULT_CONFIG.
 * Advisory only — a project may intentionally omit optional keys. The caller
 * decides whether to surface `missing` as a problem.
 *
 * @param {Set<string>} installedKeys top-level keys of the parsed config.json
 * @param {Set<string>} knownKeys top-level keys of the DEFAULT_CONFIG
 * @returns {ConfigDiff}
 */
export function diffConfigKeys(installedKeys, knownKeys) {
  const unknown = [...installedKeys].filter((k) => !knownKeys.has(k)).sort();
  const missing = [...knownKeys].filter((k) => !installedKeys.has(k)).sort();
  return { unknown, missing };
}

// ────────────────────────────────────────────────────────────────────────────
// 3. Instruction drift
// ────────────────────────────────────────────────────────────────────────────

/**
 * @typedef {{ missing: string[] }} InstructionDiff
 */

/**
 * Checks whether a set of required marker strings is present in the CLAUDE.md text.
 *
 * Detection is lightweight: a required marker is present when the CLAUDE.md text
 * contains the EXACT marker string (substring check). This detects ABSENCE of
 * managed sections without performing content-equivalence comparisons, which
 * would produce false positives on user customisations.
 *
 * @param {string} claudeMdText full text of the installed CLAUDE.md
 * @param {string[]} requiredMarkers list of marker strings that must appear
 * @returns {InstructionDiff}
 */
export function checkInstructionMarkers(claudeMdText, requiredMarkers) {
  const missing = requiredMarkers.filter((marker) => !claudeMdText.includes(marker)).sort();
  return { missing };
}
