/**
 * Emit the governance-contract envelope for a work context (BIZ-0006 / WF-0088 /
 * ADR-0148 position 11).
 *
 * This is the IO edge that serializes the resolved ceremony shape to
 * `governance-contract.json` at a context root. It CONSUMES the resolved axes +
 * shape from its caller (the create verb / the transition command) — it never
 * re-runs the classifier or the resolver. It ships NO runtime, dispatcher, or
 * adapter: BIZ-0002's `GovernedExecutionEnvelope` wraps the contract this writes;
 * that runtime is not built here.
 *
 * Contract discipline (see reports/gc0-report.md + gc2-report.md):
 *   - RESOLVE, NEVER ENFORCE. This module writes a projection; it reads no gate
 *     and blocks nothing.
 *   - VALIDATE-BEFORE-WRITE. A contract that fails its own validator is never
 *     written — a fail-open false-negative (a stale/malformed contract) is worse
 *     than an absent one (constitution §8).
 *   - DIFF-AWARE. The semantic payload (everything but `emittedAt`/`emittedBy`) is
 *     compared with canonical key order; an unchanged transition never rewrites.
 *   - ATOMIC. tmp + same-dir rename.
 *   - FAIL-OPEN. `emitGovernanceContract` NEVER throws; on any error it returns a
 *     skipped result. A broken emit must never break real work (immutable rule 2).
 *
 * Zero runtime dependencies on the hot path (node:* only).
 */
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { stripBom } from '../../runtime/work/enums.mjs';
import { validateGovernanceContract, GOVERNANCE_CONTRACT_FILENAME } from '../../runtime/work/schema-governance-contract.mjs';

// Re-export so existing importers of the filename from this module keep working;
// the schema module owns the canonical definition (single-source).
export { GOVERNANCE_CONTRACT_FILENAME };

/** Where truth actually lives — the contract points away from itself. */
const STATE_AUTHORITY = 'workflow-state.json (fold of the ADR-0043 event journal)';

/** The producers this contract is a fold of. */
const DERIVED_FROM = Object.freeze({ resolver: 'resolveCeremonyShape', classifier: 'work-classifier' });

/**
 * Serialize any JSON value with recursively sorted object keys, so a diff never
 * fires on key-ordering noise alone.
 *
 * @param {unknown} value the value to canonicalize
 * @returns {string} stable JSON serialization
 */
function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
    return `{${entries.join(',')}}`;
  }
  return JSON.stringify(value);
}

/**
 * Reduce a contract to its semantic payload for diff-aware comparison — the
 * emission stamp (`emittedAt`/`emittedBy`) is excluded so a no-op transition never
 * churns the file.
 *
 * @param {object} contract a contract object
 * @returns {string} canonical serialization of the semantic payload
 */
function semanticPayload(contract) {
  const { emittedAt, emittedBy, ...rest } = contract;
  return canonicalJson(rest);
}

/**
 * Normalize the override slot to the full value-object shape. An absent override
 * becomes the all-null "not applied" form; an applied override sets the effective
 * shape to its target and records the resolved shape alongside.
 *
 * @param {object|null|undefined} override caller-supplied override
 * @param {string} resolvedShape the shape resolveCeremonyShape produced
 * @returns {{override:object, effectiveShape:string}}
 */
function normalizeOverride(override, resolvedShape) {
  if (override && override.applied === true) {
    return {
      override: {
        applied: true,
        resolvedShape,
        shape: override.shape ?? null,
        reason: override.reason ?? null,
        authorizedBy: override.authorizedBy ?? null,
        authorizedAt: override.authorizedAt ?? null,
      },
      effectiveShape: override.shape ?? resolvedShape,
    };
  }
  return {
    override: { applied: false, resolvedShape: null, shape: null, reason: null, authorizedBy: null, authorizedAt: null },
    effectiveShape: resolvedShape,
  };
}

/**
 * Build the governance-contract object from resolved inputs. Pure — returns the
 * object, or `null` when a load-bearing input is missing (the caller then skips).
 *
 * @param {object} inputs resolved-axis inputs (see emitGovernanceContract)
 * @returns {object|null} the contract, or null when it cannot be assembled
 */
export function buildGovernanceContract(inputs) {
  const { contextRef, nature, executionMode, tier, kind, shape, governingDecision, override, emittedBy, now } = inputs;
  if (!contextRef || !nature || !executionMode || !tier || !kind || !shape) return null;
  // governingDecision is required as an object but may be the uncovered form
  // { ref: null, status: null } — a context created before its ADR exists.
  if (!governingDecision || typeof governingDecision !== 'object') return null;
  if (!now || (emittedBy !== 'create' && emittedBy !== 'transition')) return null;
  const { override: normalizedOverride, effectiveShape } = normalizeOverride(override, shape);
  // Normalize the governing decision to the covered { ref, status } form or the
  // uncovered { ref: null, status: null } form — ref and status always co-occur.
  const decision = governingDecision.ref
    ? { ref: governingDecision.ref, status: governingDecision.status }
    : { ref: null, status: null };
  return {
    schemaVersion: 1,
    contextRef,
    ceremonyShape: effectiveShape,
    resolvedAxes: { nature, executionMode, tier, kind },
    ceremonyOverride: normalizedOverride,
    governingDecision: decision,
    stateAuthority: STATE_AUTHORITY,
    derivedFrom: { ...DERIVED_FROM },
    emittedAt: now,
    emittedBy,
  };
}

/**
 * Emit `governance-contract.json` at a context root. Validate-before-write,
 * diff-aware, atomic, fail-open. NEVER throws.
 *
 * @param {object} args `{ contextDir, ...buildGovernanceContract inputs }`
 * @returns {{emitted:boolean, reason:string, errors?:string[]}} skipped reasons:
 *   `insufficient-inputs` | `invalid` | `unchanged` | `error`; emit reason is the
 *   `emittedBy` value.
 */
export function emitGovernanceContract(args) {
  try {
    const { contextDir } = args;
    if (!contextDir) return { emitted: false, reason: 'insufficient-inputs' };
    const contract = buildGovernanceContract(args);
    if (!contract) return { emitted: false, reason: 'insufficient-inputs' };
    const verdict = validateGovernanceContract(contract);
    if (!verdict.ok) return { emitted: false, reason: 'invalid', errors: verdict.errors };

    const target = join(contextDir, GOVERNANCE_CONTRACT_FILENAME);
    if (existsSync(target)) {
      try {
        const existing = JSON.parse(stripBom(readFileSync(target, 'utf-8')));
        if (semanticPayload(existing) === semanticPayload(contract)) {
          return { emitted: false, reason: 'unchanged' };
        }
      } catch {
        // Unreadable/malformed existing contract → self-heal by rewriting.
      }
    }
    return writeContract(target, contract);
  } catch {
    return { emitted: false, reason: 'error' };
  }
}

/**
 * Refresh only the governing-decision status + emission stamp on an EXISTING
 * contract, reusing its resolved axes and shape verbatim. This is the transition
 * path when the ceremony cannot be re-derived from the context (a status change
 * never alters the ceremony shape — only the governing decision's status may move).
 * Validate-before-write, diff-aware, atomic, fail-open. NEVER throws.
 *
 * @param {object} args `{ contextDir, governingDecision, emittedBy, now }`
 * @returns {{emitted:boolean, reason:string, errors?:string[]}}
 */
export function refreshGovernanceContract(args) {
  try {
    // Destructure inside the try so a null/garbage arg returns skipped, never throws.
    const { contextDir, governingDecision, emittedBy, now } = args || {};
    // governingDecision may be the uncovered form { ref: null, status: null }; it
    // only needs to be a present object (never throws) — validate-before-write does
    // the rest.
    if (!contextDir || !governingDecision || typeof governingDecision !== 'object') {
      return { emitted: false, reason: 'insufficient-inputs' };
    }
    const target = join(contextDir, GOVERNANCE_CONTRACT_FILENAME);
    if (!existsSync(target)) return { emitted: false, reason: 'insufficient-inputs' };
    let existing;
    try {
      existing = JSON.parse(stripBom(readFileSync(target, 'utf-8')));
    } catch {
      return { emitted: false, reason: 'invalid' };
    }
    const refreshed = {
      ...existing,
      governingDecision: { ref: governingDecision.ref, status: governingDecision.status },
      emittedAt: now,
      emittedBy,
    };
    const verdict = validateGovernanceContract(refreshed);
    if (!verdict.ok) return { emitted: false, reason: 'invalid', errors: verdict.errors };
    if (semanticPayload(existing) === semanticPayload(refreshed)) {
      return { emitted: false, reason: 'unchanged' };
    }
    return writeContract(target, refreshed);
  } catch {
    return { emitted: false, reason: 'error' };
  }
}

/**
 * Atomic tmp + same-dir rename write of a contract.
 *
 * @param {string} target destination path
 * @param {object} contract the contract to serialize
 * @returns {{emitted:true, reason:string}}
 */
function writeContract(target, contract) {
  const tmp = `${target}.tmp`;
  // Clear any stale/pre-planted tmp first, then write with the exclusive `wx` flag
  // so writeFileSync refuses to follow a symlink planted at the tmp path (O_EXCL).
  // The caller runs inside a try that returns a skipped result on any throw, so a
  // hostile tmp fails the emit open rather than writing through the link.
  try { rmSync(tmp, { force: true }); } catch { /* best-effort cleanup */ }
  writeFileSync(tmp, `${JSON.stringify(contract, null, 2)}\n`, { flag: 'wx' });
  renameSync(tmp, target);
  return { emitted: true, reason: contract.emittedBy };
}
