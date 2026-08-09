/**
 * MCP Policy Engine — R0..R5 risk taxonomy + deterministic server evaluation.
 *
 * The gatekeeper that decides whether a curated MCP server may be activated for a
 * project, and under what posture. Pure and deterministic: same inputs always
 * yield the same {decision, reasons[]}. Nothing is read from disk or activated
 * here — callers load the registry/manifest and pass entries in (rule 4: one I/O
 * owner; this module is not it).
 *
 * Security contract (the reason this module exists):
 *   - DENY a literal secret value in config (never a NAME) — fail closed.
 *   - DENY an unpinned / @latest source — supply-chain pinning is mandatory.
 *   - DENY a host outside the server's allowedHosts allow-list.
 *   - DENY an R4/R5 server enabled without a RECORDED human approval.
 *   - Tool exposure is allow-list-only: a new server defaults to read-only and
 *     NEVER exposes every declared tool implicitly (least privilege).
 *   - Does not consult governance grades or advisory routing. Real MCP safety is
 *     expressed directly through pinning, secret handling, host allow-lists,
 *     explicit R4/R5 approval, and least-privilege tool exposure.
 *
 * Zero third-party dependencies (node:* only) — hot-path safe (immutable rule 1).
 *
 * @module policy
 */

import {
  RISK_CLASSES,
  classDefault,
  isHumanApprovalClass,
} from './risk-classes.mjs';
import { looksLikeSecretValue } from './secret-shape.mjs';

/** @typedef {import('./registry.mjs').RegistryEntry} RegistryEntry */
/** @typedef {import('./manifest.mjs').ManifestEntry} ManifestEntry */

/** @typedef {'allow'|'warn'|'deny'} Decision */

/**
 * @typedef {Object} PolicyEvaluation
 * @property {Decision}  decision    Worst-case across all checks: deny > warn > allow.
 * @property {string[]}  reasons     One machine-readable reason per finding (deny + warn + info).
 * @property {string}    riskClass   The resolved R-class for the server.
 * @property {string}    mode        Effective tool-exposure mode ('read-only' | 'write').
 * @property {string[]}  allowedTools Effective tool allow-list (never implicitly "all").
 */

/** A pin object is "pinned" only if it carries a concrete, non-floating ref. */
const FLOATING_REFS = new Set(['latest', '*', 'next', 'main', 'master', 'HEAD', '']);

/**
 * True when the pin resolves to a concrete, immutable artefact reference.
 * A missing pin, an empty pin object, or any floating tag fails this check.
 *
 * @param {Record<string, string>|undefined|null} pin
 * @returns {boolean}
 */
function isConcretelyPinned(pin) {
  if (!pin || typeof pin !== 'object' || Array.isArray(pin)) return false;
  const refs = [pin.npm, pin.digest, pin.sha, pin.identity].filter((v) => typeof v === 'string');
  if (refs.length === 0) return false;
  return refs.some((ref) => {
    const value = ref.trim().toLowerCase();
    if (FLOATING_REFS.has(value)) return false;
    if (value.startsWith('^') || value.startsWith('~') || value.includes('latest') || value.includes('*')) return false;
    return value.length > 0;
  });
}

/**
 * Detects a literal secret VALUE smuggled into referencedSecrets (which must hold
 * only environment-variable NAMES). Defence-in-depth: manifest.mjs already throws
 * on write, but evaluation must fail closed even if an entry reached us another way.
 *
 * @param {string[]} referencedSecrets
 * @returns {string|null} the offending entry (truncated), or null when clean
 */
function findLiteralSecret(referencedSecrets) {
  for (const candidate of referencedSecrets) {
    if (typeof candidate !== 'string') return '(non-string)';
    if (looksLikeSecretValue(candidate)) return candidate.slice(0, 8);
  }
  return null;
}

/**
 * Evaluates whether a single MCP server may be activated, and under what posture.
 * PURE + deterministic — no I/O, no clock, no randomness.
 *
 * @param {RegistryEntry} entry         Curated registry entry (risk, allowedHosts, pin, defaultMode, capabilities).
 * @param {ManifestEntry} manifestEntry Project manifest entry (mode override, referencedSecrets, allowedTools, recordedApproval).
 * @param {string}        host          Target host id (e.g. 'claude-code', 'cursor').
 * @param {object}        [options]     { allowedHosts?, recordedApproval? }
 * @returns {PolicyEvaluation}
 */
export function evaluateServer(entry, manifestEntry = {}, host = '', options = {}) {
  if (!entry || typeof entry !== 'object') {
    throw new TypeError('evaluateServer: registry `entry` must be an object');
  }
  const reasons = [];
  let decision = /** @type {Decision} */ ('allow');
  const escalate = (next, reason) => {
    reasons.push(reason);
    if (next === 'deny') decision = 'deny';
    else if (next === 'warn' && decision !== 'deny') decision = 'warn';
  };

  // --- Risk class + canonical default posture ---------------------------------
  const riskClass = RISK_CLASSES.includes(entry.risk) ? entry.risk : 'R5';
  if (!RISK_CLASSES.includes(entry.risk)) escalate('deny', `risk:unknown-class(${entry.risk ?? 'missing'})-treated-as-R5`);
  const canonical = classDefault(riskClass);

  // --- DENY #1: literal secret value in config --------------------------------
  const referencedSecrets = Array.isArray(manifestEntry.referencedSecrets) ? manifestEntry.referencedSecrets : [];
  const leaked = findLiteralSecret(referencedSecrets);
  if (leaked !== null) escalate('deny', `secret:literal-value-in-config('${leaked}…')`);

  // --- DENY #2: unpinned / @latest source -------------------------------------
  const effectivePin = manifestEntry.pin ?? entry.pin;
  if (!isConcretelyPinned(effectivePin)) escalate('deny', 'supply-chain:unpinned-or-floating-source');

  // --- DENY #3: host outside the allow-list -----------------------------------
  const allowedHosts = Array.isArray(options.allowedHosts) && options.allowedHosts.length > 0
    ? options.allowedHosts
    : ['*'];
  const hostAllowed = allowedHosts.includes('*') || allowedHosts.includes(host);
  if (!hostAllowed) escalate('deny', `host:not-in-allowedHosts(${host || '(empty)'})`);

  // --- DENY #4: R4/R5 enabled without a recorded human approval ---------------
  const recordedApproval = options.recordedApproval ?? manifestEntry.recordedApproval ?? null;
  if (isHumanApprovalClass(riskClass) && !recordedApproval) {
    escalate('deny', `approval:${riskClass}-requires-recorded-human-approval`);
  }

  // --- Least privilege: tool exposure is allow-list-only ----------------------
  // Effective mode override may only TIGHTEN below the canonical class default —
  // never widen. A new server with no explicit override defaults to read-only.
  const requestedMode = manifestEntry.mode ?? canonical.mode;
  let mode = requestedMode;
  if (requestedMode === 'write' && canonical.mode === 'read-only') {
    // A write widening past a read-only canonical posture violates least
    // privilege — deny and hold the effective mode at the canonical floor.
    escalate('deny', `mode:write-override-on-${riskClass}-read-only-default-denied(least-privilege)`);
    mode = canonical.mode;
  }
  const declaredTools = Array.isArray(entry.capabilities?.tools) ? entry.capabilities.tools : [];
  const allowedTools = Array.isArray(manifestEntry.allowedTools) ? manifestEntry.allowedTools : [];
  if (allowedTools.length === 0 && declaredTools.length > 0) {
    escalate('warn', 'tools:no-allow-list-defaults-to-zero-tools(least-privilege)');
  }
  const unknownTools = allowedTools.filter((t) => !declaredTools.includes(t));
  if (unknownTools.length > 0) escalate('deny', `tools:undeclared-in-registry(${unknownTools.join(',')})`);

  // --- DENY (final, no opt-out): a blocked-by-default class cannot be cleared --
  // Checked AFTER every other gate so no approval token can shortcut it. The
  // canonical `blocked` flag (R5) escalates unconditionally to deny — there is no
  // path that returns `allow` for a blocked class (constitution §8: opt-in to permit).
  if (canonical.blocked) {
    escalate('deny', `class:${riskClass}-is-blocked-by-default-requires-explicit-unblock`);
  }

  if (decision === 'allow') reasons.push(`allow:${riskClass}:${canonical.label}`);
  return { decision, reasons, riskClass, mode, allowedTools: allowedTools.slice() };
}
