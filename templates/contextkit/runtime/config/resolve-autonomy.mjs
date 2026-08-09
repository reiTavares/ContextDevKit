/**
 * Advisory execution posture and real-risk acknowledgement metadata (ADR-0158).
 *
 * Legacy autonomy grades remain readable only as migration/audit context. They
 * never authorize work, require an agent, raise a gate, or condition swarm use.
 * Platform-owned security, credential, secret, and destructive-operation
 * confirmations remain outside ContextDevKit and cannot be bypassed here.
 */
import { join } from 'node:path';
import { matchSecret } from '../hooks/path-classification.mjs';
import { readJsonSafe } from '../hooks/safe-io.mjs';

/** Areas retained as compatibility vocabulary for existing callers. */
export const AREAS = Object.freeze([
  'edit', 'commit', 'push', 'pipeline-move', 'adr', 'session-log', 'ship-checkpoint', 'grade-change',
  'swarm-dispatch', 'feature-deliberation', 'decision-deliberation', 'destructive-production', 'secret-rotation',
]);

/** Historical grade descriptions. They are display-only migration guidance. */
export const CONSEQUENCE_TEXT = Object.freeze({
  1: 'Legacy grade 1 is recorded for migration only; current owner instruction controls the task.',
  2: 'Legacy grade 2 is recorded for migration only; current owner instruction controls the task.',
  3: 'Legacy grade 3 is recorded for migration only; current owner instruction controls the task.',
  4: 'Legacy grade 4 is recorded for migration only; current owner instruction controls the task.',
});

/** Risks that require explicit acknowledgement while real platform controls remain intact. */
export const RISK_ACKNOWLEDGEMENT_KINDS = Object.freeze([
  'destructive-production',
  'force-push',
  'secret-rotation',
]);

/**
 * Reads an unexpired legacy session override for migration/display only.
 *
 * @param {string} root project root.
 * @returns {number|null} historical grade or null.
 */
export function readAutonomyOverride(root) {
  const override = readJsonSafe(join(root, '.claude', '.workspace', 'autonomy-session.json'), null);
  if (!override || !Number.isInteger(override.grade)) return null;
  return Date.now() < Number(override.expiresAt || 0) ? override.grade : null;
}

/**
 * Normalizes a legacy grade without giving it runtime authority.
 * @param {unknown} value grade candidate.
 * @returns {number|null} grade metadata or null.
 */
function parseLegacyGrade(value) {
  const grade = Number(value);
  return Number.isInteger(grade) && grade >= 1 && grade <= 4 ? grade : null;
}

/**
 * Identifies the narrow risks named by the v4 owner contract.
 *
 * @param {string} area requested compatibility area.
 * @param {object} context action context.
 * @param {object} config project configuration.
 * @returns {'destructive-production'|'force-push'|'secret-rotation'|null}
 */
function acknowledgementKind(area, context, config) {
  if (area === 'force-push' || (area === 'push' && context.force === true)) return 'force-push';
  if (area === 'destructive-production' || (context.destructive === true && context.environment === 'production')) {
    return 'destructive-production';
  }
  if (area === 'secret-rotation') return 'secret-rotation';
  const path = typeof context.path === 'string' ? context.path.replaceAll('\\', '/') : '';
  if (path && matchSecret(path, config?.autonomy?.extraSecretPaths ?? [])) return 'secret-rotation';
  return null;
}

/**
 * Resolves advisory execution metadata without acting as an authorization gate.
 * Invalid/contradictory legacy grades are diagnosed and ignored. A listed real
 * risk receives acknowledgement metadata; the caller/platform still owns the
 * actual confirmation and must not infer acknowledgement from this result.
 *
 * @param {string} area compatibility action area.
 * @param {object} [config] loaded project config.
 * @param {number|null} [sessionOverride] legacy session grade.
 * @param {object} [context] action facts and optional explicit acknowledgement.
 * @returns {Readonly<object>} non-binding posture and acknowledgement request.
 */
export function resolveAutonomy(area, config = {}, sessionOverride = null, context = {}) {
  const knownArea = AREAS.includes(area);
  const configuredGrade = parseLegacyGrade(config?.autonomy?.grade);
  const sessionGrade = parseLegacyGrade(sessionOverride);
  const flagGrade = parseLegacyGrade(context.flagGrade);
  const legacyGrade = flagGrade ?? sessionGrade ?? configuredGrade;
  const legacySource = flagGrade !== null ? 'flag'
    : sessionGrade !== null ? 'session'
      : configuredGrade !== null ? 'config'
        : 'none';
  const kind = acknowledgementKind(area, context, config);
  const acknowledged = kind !== null
    && typeof context.acknowledgedBy === 'string'
    && typeof context.acknowledgedAt === 'string'
    && typeof context.reason === 'string'
    && context.reason.trim().length > 0;
  const diagnostics = [];
  if (!knownArea) diagnostics.push(`unknown-area:${String(area)}`);
  if (config?.autonomy?.grade !== undefined && configuredGrade === null) diagnostics.push('legacy-grade-invalid');
  if (legacyGrade !== null) diagnostics.push(`legacy-grade-${legacyGrade}-ignored`);
  if (config?.deliberations?.active === false) diagnostics.push('legacy-deliberation-setting-ignored');

  return Object.freeze({
    grade: legacyGrade,
    mode: 'advisory',
    source: 'current-owner-instruction',
    reason: kind ? `risk-acknowledgement:${kind}` : 'autonomy-grade-not-an-authorization-boundary',
    binding: false,
    blocking: false,
    legacy: Object.freeze({ grade: legacyGrade, source: legacySource, diagnostics: Object.freeze(diagnostics) }),
    riskAcknowledgement: Object.freeze({
      required: kind !== null,
      kind,
      message: kind ? `Confirm ${kind} through the real host/platform safety boundary before execution.` : null,
      acknowledged,
      acknowledgedBy: acknowledged ? context.acknowledgedBy : null,
      acknowledgedAt: acknowledged ? context.acknowledgedAt : null,
      reason: acknowledged ? context.reason.trim() : null,
    }),
    continuation: Object.freeze({ allowed: true, reason: 'project-autonomy-is-advisory' }),
  });
}
