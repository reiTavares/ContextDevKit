/**
 * Architecture-debt gate — the allowed (dimension → debtClass) taxonomy table
 * (WF-0057, ADR-0122). Split from `debt-classifier.mjs` as a cohesive seam
 * (constitution §1): this module is the FROZEN DATA (the §4 many-to-many
 * mapping + the floor-bearing-class sets), `debt-classifier.mjs` is the LOGIC
 * that validates against it. A second consumer (W3 policy, W4 registry) will
 * read this table directly, so it earns its own module.
 *
 * Every entry traces VERBATIM to `W0-contracts.md` §4 (the allowed mapping) and
 * §5 (which debt natures carry a hard security/data-integrity/operational
 * floor). Changing one is a contract change.
 *
 * Zero runtime deps, ESM, `node:`/relative imports only (immutable rule #1).
 */

import { Dimension, DebtClass } from './finding-enums.mjs';

/**
 * The allowed mapping (§4): which debt CLASSES a given DIMENSION (the lens that
 * found it) may legitimately surface. A `(dimension, debtClass)` pair outside
 * this table is a wiring bug the classifier rejects fail-fast (§4 note).
 *
 * The kit-native classes GOVERNANCE / CONTEXT / AGENT_EXECUTION attach to the
 * lens that detects them (§4 note: typically ARCHITECTURE_CONFORMANCE /
 * PERFORMANCE / COGNITIVE_COHERENCE respectively).
 *
 * @type {Readonly<Record<string, ReadonlySet<string>>>}
 */
export const DIMENSION_DEBTCLASS = Object.freeze({
  [Dimension.ARCHITECTURE_CONFORMANCE]: new Set([
    DebtClass.ARCHITECTURAL, DebtClass.DESIGN, DebtClass.CONTRACT,
    DebtClass.DATA, DebtClass.GOVERNANCE,
  ]),
  [Dimension.MODULARITY]: new Set([
    DebtClass.DESIGN, DebtClass.ARCHITECTURAL, DebtClass.CODE,
  ]),
  [Dimension.COMPLEXITY]: new Set([
    DebtClass.CODE, DebtClass.DESIGN,
  ]),
  [Dimension.TESTABILITY]: new Set([
    DebtClass.TEST, DebtClass.RELIABILITY, DebtClass.CODE,
  ]),
  [Dimension.RELIABILITY]: new Set([
    DebtClass.RELIABILITY, DebtClass.OPERATIONAL, DebtClass.DATA,
  ]),
  [Dimension.SECURITY_PRIVACY]: new Set([
    DebtClass.SECURITY, DebtClass.PRIVACY, DebtClass.DEPENDENCY,
    DebtClass.CONFIGURATION,
  ]),
  [Dimension.OBSERVABILITY]: new Set([
    DebtClass.OBSERVABILITY, DebtClass.OPERATIONAL,
  ]),
  [Dimension.PERFORMANCE]: new Set([
    DebtClass.PERFORMANCE, DebtClass.CODE, DebtClass.CONTEXT,
  ]),
  [Dimension.OPERATIONS_DELIVERY]: new Set([
    DebtClass.OPERATIONAL, DebtClass.BUILD_AND_DELIVERY, DebtClass.MIGRATION,
    DebtClass.CONFIGURATION,
  ]),
  [Dimension.DEPENDENCIES]: new Set([
    DebtClass.DEPENDENCY, DebtClass.SECURITY, DebtClass.BUILD_AND_DELIVERY,
  ]),
  [Dimension.DATA_CONTRACTS]: new Set([
    DebtClass.DATA, DebtClass.CONTRACT, DebtClass.MIGRATION,
  ]),
  [Dimension.COGNITIVE_COHERENCE]: new Set([
    DebtClass.CODE, DebtClass.DESIGN, DebtClass.DOCUMENTATION,
    DebtClass.CONTEXT, DebtClass.AGENT_EXECUTION,
  ]),
});

/**
 * Predicate: is `(dimension, debtClass)` an allowed pair per the §4 table?
 *
 * @param {string} dimension  a Dimension value (the measuring lens).
 * @param {string} debtClass  a DebtClass value (the nature of the debt).
 * @returns {boolean} true iff the pair is in the allowed mapping.
 */
export function isAllowedPair(dimension, debtClass) {
  const allowed = DIMENSION_DEBTCLASS[dimension];
  return Boolean(allowed && allowed.has(debtClass));
}

/**
 * Debt CLASSES whose nature can trip the SECURITY floor (§5.3, §9.6). A finding
 * of this class with high-confidence breach evidence forces a lexicographic max
 * disposition — no other low factor can average it away.
 * @type {ReadonlySet<string>}
 */
export const SECURITY_FLOOR_CLASSES = Object.freeze(
  new Set([DebtClass.SECURITY, DebtClass.PRIVACY]),
);

/**
 * Debt CLASSES whose nature can trip the DATA-INTEGRITY floor (§5.3): debt that
 * corrupts/duplicates canonical state.
 * @type {ReadonlySet<string>}
 */
export const DATA_INTEGRITY_FLOOR_CLASSES = Object.freeze(
  new Set([DebtClass.DATA, DebtClass.CONTRACT, DebtClass.MIGRATION]),
);

/**
 * Debt CLASSES whose nature can trip the OPERATIONAL floor (§5.3): an
 * irreversible operation shipped without rollback/receipt.
 * @type {ReadonlySet<string>}
 */
export const OPERATIONAL_FLOOR_CLASSES = Object.freeze(
  new Set([DebtClass.OPERATIONAL, DebtClass.BUILD_AND_DELIVERY]),
);
