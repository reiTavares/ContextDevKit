/**
 * Architecture-debt gate — StructuralSignalCollector (WF-0057 W2, ADR-0122).
 *
 * A PURE analyzer that turns raw structural inputs into `Finding[]` of the
 * single contract shape (`./finding.mjs`). It emits only WEAK signals:
 *   - §29 line-count  → ADVISORY, evidence HEURISTIC (a size trip-wire, NOT a
 *                       verdict; this REPLACES the old line-budget BLOCKER).
 *   - §19 change-amp  → OBSERVE_ONLY, evidence GRAPH_DERIVED (blast-radius delta).
 *
 * It NEVER emits BLOCKING and NEVER decides a split: a long file "requests
 * structural review; it does not determine a split" (W0-contracts §1.4 / fork #2).
 *
 * PURITY CONTRACT: every input is INJECTED. This module does NOT spawn git, walk
 * the filesystem, or read a clock — collecting those inputs is the engine's job
 * (W4). That keeps the collector deterministic and trivially testable.
 *
 * Zero runtime deps, ESM, `node:`/relative imports only (immutable rule #1).
 */

import { makeFinding } from './finding.mjs';
import {
  Enforcement, FindingStatus, EvidenceClass, RecommendedAction, Dimension,
  DebtClass, Principal,
} from './finding-enums.mjs';

/**
 * Default line-count bands (§29). A trip-wire that STARTS analysis, never a
 * guillotine — both bands stay ADVISORY. Mirrors the constitution's 240
 * yellow-zone / 308 hard-smell, but carries no blocking authority here.
 * @type {Readonly<{yellow:number, elevated:number}>}
 */
export const DEFAULT_LINE_BANDS = Object.freeze({ yellow: 240, elevated: 308 });

/** Stable reason codes the report renders and the registry indexes. */
const REASON = Object.freeze({
  YELLOW: 'FILE_SIZE_YELLOW_BAND',
  ELEVATED: 'FILE_SIZE_ELEVATED_BAND',
  AMP_IMPROVED: 'CHANGE_AMPLIFICATION_IMPROVED',
  AMP_UNCHANGED: 'CHANGE_AMPLIFICATION_UNCHANGED',
  AMP_WORSENED: 'CHANGE_AMPLIFICATION_WORSENED',
  AMP_UNKNOWN: 'CHANGE_AMPLIFICATION_UNKNOWN',
});

/**
 * Classify a line count against the bands. Returns `null` below the yellow band
 * (nothing worth recording — a small file is not a signal).
 * @param {number} lines total line count of the file
 * @param {{yellow:number, elevated:number}} bands
 * @returns {{band:'YELLOW'|'ELEVATED', reasonCode:string} | null}
 */
function classifyLineBand(lines, bands) {
  if (lines >= bands.elevated) return { band: 'ELEVATED', reasonCode: REASON.ELEVATED };
  if (lines >= bands.yellow) return { band: 'YELLOW', reasonCode: REASON.YELLOW };
  return null;
}

/**
 * §29 line-count signal — a weak ADVISORY heuristic over a file's size. It is
 * deliberately framed as a REQUEST FOR REVIEW, never a split instruction, and
 * never calls the raw count "useful lines" (W0-contracts §1.4, ADR-0122).
 *
 * @param {{path:string, lines:number, line?:number}} metrics injected file size facts
 * @param {{yellow:number, elevated:number}} [bands] configurable trip-wire bands
 * @returns {Object[]} zero or one Finding (ADVISORY, HEURISTIC). Never BLOCKING.
 * @throws {TypeError} when `path` is not a string or `lines` is not a number.
 */
export function lineCountSignal(metrics, bands = DEFAULT_LINE_BANDS) {
  if (!metrics || typeof metrics.path !== 'string' || metrics.path.length === 0) {
    throw new TypeError('lineCountSignal: metrics.path is required and must be a non-empty string');
  }
  if (typeof metrics.lines !== 'number' || !Number.isFinite(metrics.lines)) {
    throw new TypeError('lineCountSignal: metrics.lines is required and must be a finite number');
  }
  const classified = classifyLineBand(metrics.lines, bands);
  if (!classified) return [];

  const message = `File size (${metrics.lines} lines) requests structural review; `
    + 'it does not determine a split.';

  return [makeFinding({
    id: `arch-debt.line-count:${metrics.path}:${classified.band}`,
    ruleId: 'arch-debt.line-count',
    dimension: Dimension.COGNITIVE_COHERENCE,
    debtClass: DebtClass.CODE,
    status: FindingStatus.OBSERVATION,
    confidence: 0.4, // a size trip-wire is a weak signal with known false positives
    evidence: {
      class: EvidenceClass.HEURISTIC,
      source: 'arch-debt.signal-collector',
      ref: `${metrics.path}:${metrics.lines}`,
    },
    reasonCodes: [classified.reasonCode],
    principal: Principal.UNKNOWN,
    // ADVISORY, never BLOCKING — line count alone can never block (fork #2).
    enforcement: Enforcement.ADVISORY,
    recommendedAction: RecommendedAction.OBSERVE,
    message,
    path: metrics.path,
    line: typeof metrics.line === 'number' ? metrics.line : undefined,
  })];
}

/**
 * Classify a single module's blast-radius delta into a stable band. UNKNOWN is
 * emitted whenever either side is absent — we NEVER fabricate a zero from a
 * missing signal (W0-contracts §16: UNKNOWN ≠ PASS).
 * @param {number|undefined} before prior blast radius (transitive importer count)
 * @param {number|undefined} after  current blast radius
 * @returns {'IMPROVED'|'UNCHANGED'|'WORSENED'|'UNKNOWN'}
 */
function classifyAmplification(before, after) {
  const haveBefore = typeof before === 'number' && Number.isFinite(before);
  const haveAfter = typeof after === 'number' && Number.isFinite(after);
  if (!haveBefore || !haveAfter) return 'UNKNOWN';
  if (after > before) return 'WORSENED';
  if (after < before) return 'IMPROVED';
  return 'UNCHANGED';
}

/** Map a classification band onto its stable reason code. */
const AMP_REASON = Object.freeze({
  IMPROVED: REASON.AMP_IMPROVED,
  UNCHANGED: REASON.AMP_UNCHANGED,
  WORSENED: REASON.AMP_WORSENED,
  UNKNOWN: REASON.AMP_UNKNOWN,
});

/**
 * Read the blast radius for `path` out of a `structuralSignals().perModule`
 * map, tolerating an absent map or absent entry (→ undefined, never a faked 0).
 * @param {Record<string, {blastRadius?:number}>|null|undefined} perModule
 * @param {string} path
 * @returns {number|undefined}
 */
function blastRadiusOf(perModule, path) {
  if (!perModule || typeof perModule !== 'object') return undefined;
  const entry = perModule[path];
  if (!entry || typeof entry.blastRadius !== 'number') return undefined;
  return entry.blastRadius;
}

/**
 * §19 change-amplification signal (folded in from W1.2) — for each changed
 * module, compares its blast radius before/after the change and records an
 * OBSERVE_ONLY GRAPH_DERIVED finding. When the project-map signals are
 * unavailable (missing `before`/`after` perModule maps, or the module is not in
 * the graph) the finding is UNKNOWN — the gate observes, it never fabricates.
 *
 * @param {string[]} changedModules repo-relative module paths that changed
 * @param {object} signals injected structural signals
 * @param {Record<string,{blastRadius?:number}>} [signals.before] perModule before the change
 * @param {Record<string,{blastRadius?:number}>} [signals.after]  perModule after the change
 * @returns {Object[]} one OBSERVE_ONLY Finding per changed module. Never BLOCKING.
 * @throws {TypeError} when `changedModules` is not an array.
 */
export function changeAmplificationSignal(changedModules, signals = {}) {
  if (!Array.isArray(changedModules)) {
    throw new TypeError('changeAmplificationSignal: changedModules must be an array of paths');
  }
  const before = signals.before;
  const after = signals.after;

  return changedModules
    .filter((path) => typeof path === 'string' && path.length > 0)
    .map((path) => {
      const radiusBefore = blastRadiusOf(before, path);
      const radiusAfter = blastRadiusOf(after, path);
      const band = classifyAmplification(radiusBefore, radiusAfter);
      const known = band !== 'UNKNOWN';

      const detail = known
        ? `blast radius ${radiusBefore} → ${radiusAfter}`
        : 'blast radius unavailable (graph signal missing)';
      const message = `Change amplification ${band} for ${path}: ${detail}.`;

      return makeFinding({
        id: `arch-debt.change-amplification:${path}:${band}`,
        ruleId: 'arch-debt.change-amplification',
        dimension: Dimension.MODULARITY,
        debtClass: DebtClass.ARCHITECTURAL,
        // UNKNOWN classification surfaces as a non-passing UNKNOWN status (§16).
        status: known ? FindingStatus.OBSERVATION : FindingStatus.UNKNOWN,
        confidence: known ? 0.6 : 0.3,
        evidence: {
          class: EvidenceClass.GRAPH_DERIVED,
          source: 'project-map.structuralSignals',
          ref: known ? `${path}:${radiusBefore}->${radiusAfter}` : `${path}:unavailable`,
        },
        reasonCodes: [AMP_REASON[band]],
        principal: Principal.UNKNOWN,
        // Experimental change-amp heuristic → OBSERVE_ONLY, never blocks (§12.4).
        enforcement: Enforcement.OBSERVE_ONLY,
        recommendedAction: RecommendedAction.OBSERVE,
        message,
        path,
      });
    });
}

/**
 * Run the whole StructuralSignalCollector over its injected inputs. Pure: it
 * fans the size metrics through `lineCountSignal` and the changed modules
 * through `changeAmplificationSignal`, returning the merged `Finding[]`. The
 * engine (W4) is responsible for producing `fileMetrics` and `signals`.
 *
 * @param {object} input
 * @param {Array<{path:string, lines:number, line?:number}>} [input.fileMetrics] per-file sizes
 * @param {string[]} [input.changedModules] modules whose blast radius to compare
 * @param {{before?:object, after?:object}} [input.signals] structural signals before/after
 * @param {{yellow:number, elevated:number}} [input.lineBands] override the size bands
 * @returns {Object[]} all collected ADVISORY/OBSERVE_ONLY findings. Never BLOCKING.
 */
export function collectStructuralSignals(input = {}) {
  const fileMetrics = Array.isArray(input.fileMetrics) ? input.fileMetrics : [];
  const changedModules = Array.isArray(input.changedModules) ? input.changedModules : [];
  const bands = input.lineBands || DEFAULT_LINE_BANDS;

  const findings = [];
  for (const metrics of fileMetrics) {
    for (const finding of lineCountSignal(metrics, bands)) findings.push(finding);
  }
  for (const finding of changeAmplificationSignal(changedModules, input.signals || {})) {
    findings.push(finding);
  }
  return findings;
}
