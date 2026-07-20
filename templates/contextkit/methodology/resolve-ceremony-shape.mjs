/**
 * Resolve the canonical ceremony shape from the existing methodology axes.
 *
 * This module is intentionally pure: it does not read policy, inspect files, or
 * invoke a model. Callers classify the objective with work-classifier.mjs and
 * classify the ceremony tier with complexity-rubric.mjs before calling this
 * resolver. Profiles and businessKind remain parameters of the selected shape.
 */
import { EXECUTION_MODES } from '../runtime/work/enums.mjs';

/** @type {readonly string[]} */
export const CEREMONY_SHAPES = Object.freeze([
  'quick-fix',
  'batch-operation',
  'single-workflow-operation',
  'decision-only',
  'multi-workflow-program',
]);

/** @type {readonly string[]} */
export const CEREMONY_TIERS = Object.freeze(['trivial', 'feature', 'architectural']);

const NATURES = Object.freeze(['operation', 'business']);

/**
 * Validate a resolver axis at the boundary.
 *
 * @param {string} axisName axis label used in the error
 * @param {unknown} value received axis value
 * @param {readonly string[]} allowed closed-set values
 * @returns {void}
 * @throws {TypeError} when the value is not a non-empty string
 * @throws {RangeError} when the value is outside the closed set
 */
function assertAxis(axisName, value, allowed) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError('resolveCeremonyShape: ' + axisName + ' must be a non-empty string');
  }
  if (!allowed.includes(value)) {
    throw new RangeError(
      'resolveCeremonyShape: unsupported ' + axisName + ' "' + value + '" (expected ' + allowed.join(', ') + ')',
    );
  }
}

/**
 * Resolve one and only one canonical ceremony shape.
 *
 * Business work is decision-only unless it is an architectural workflow
 * program. Operation work is proportional to its existing execution mode and
 * tier: direct trivial work is a quick fix, direct non-trivial work is a
 * workflow, batch work is a batch operation, and workflow work is a single
 * workflow operation.
 *
 * @param {'operation'|'business'} nature work nature from work-classifier.mjs
 * @param {'direct'|'batch'|'workflow'} executionMode execution mode from the classifier
 * @param {'trivial'|'feature'|'architectural'} tier ceremony tier from complexity-rubric.mjs
 * @param {string} operationKind operation/business kind from work-classifier.mjs
 * @returns {'quick-fix'|'batch-operation'|'single-workflow-operation'|'decision-only'|'multi-workflow-program'} canonical shape id
 * @throws {TypeError|RangeError} when an axis is missing or unsupported
 */
export function resolveCeremonyShape(nature, executionMode, tier, operationKind) {
  assertAxis('nature', nature, NATURES);
  assertAxis('executionMode', executionMode, EXECUTION_MODES);
  assertAxis('tier', tier, CEREMONY_TIERS);
  assertAxis('operationKind', operationKind, [
    'capability', 'product', 'initiative', 'compliance',
    'change', 'fix', 'maintenance', 'investigation', 'operationalResponse',
  ]);

  if (nature === 'business') {
    return executionMode === 'workflow' && tier === 'architectural'
      ? 'multi-workflow-program'
      : 'decision-only';
  }
  if (executionMode === 'batch') return 'batch-operation';
  if (executionMode === 'workflow') return 'single-workflow-operation';
  return tier === 'trivial' ? 'quick-fix' : 'single-workflow-operation';
}
