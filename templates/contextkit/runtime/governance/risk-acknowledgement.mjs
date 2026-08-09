/**
 * Non-binding acknowledgement metadata for the three real-risk classes named
 * by the ContextDevKit 4 owner contract.
 *
 * This module does not authorize an action. Host/platform confirmations remain
 * authoritative for destructive production work, force-pushes, and secrets.
 */
import { matchSecret } from '../hooks/path-classification.mjs';

export const RISK_ACKNOWLEDGEMENT_KINDS = Object.freeze([
  'destructive-production',
  'force-push',
  'secret-rotation',
]);

/** Resolve the applicable acknowledgement kind from concrete action facts. */
function resolveKind(action, context, config) {
  if (action === 'force-push' || (action === 'push' && context.force === true)) return 'force-push';
  if (action === 'destructive-production'
    || (context.destructive === true && context.environment === 'production')) {
    return 'destructive-production';
  }
  if (action === 'secret-rotation') return 'secret-rotation';
  const path = typeof context.path === 'string' ? context.path.replaceAll('\\', '/') : '';
  const extraPaths = Array.isArray(config?.riskAcknowledgement?.extraSecretPaths)
    ? config.riskAcknowledgement.extraSecretPaths
    : [];
  return path && matchSecret(path, extraPaths) ? 'secret-rotation' : null;
}

/**
 * Build auditable, non-binding acknowledgement metadata.
 * @param {string} action action name
 * @param {object} [context] concrete risk and optional owner acknowledgement
 * @param {object} [config] v4 riskAcknowledgement configuration
 * @returns {Readonly<object>}
 */
export function resolveRiskAcknowledgement(action, context = {}, config = {}) {
  const kind = resolveKind(action, context, config);
  const requiredFor = Array.isArray(config?.riskAcknowledgement?.requiredFor)
    ? config.riskAcknowledgement.requiredFor.filter((entry) => RISK_ACKNOWLEDGEMENT_KINDS.includes(entry))
    : RISK_ACKNOWLEDGEMENT_KINDS;
  const required = kind !== null && requiredFor.includes(kind);
  const acknowledged = required
    && ['human', 'owner'].includes(context.acknowledgedBy)
    && typeof context.acknowledgedAt === 'string'
    && !Number.isNaN(Date.parse(context.acknowledgedAt))
    && typeof context.reason === 'string'
    && context.reason.trim().length > 0;
  const configuredMessage = config?.riskAcknowledgement?.message;
  const message = required
    ? (typeof configuredMessage === 'string' && configuredMessage.trim()
        ? configuredMessage.trim()
        : `Confirm ${kind} through the real host/platform safety boundary before execution.`)
    : null;

  return Object.freeze({
    requiredFor: Object.freeze([...requiredFor]),
    required,
    kind,
    message,
    acknowledged,
    acknowledgedBy: acknowledged ? context.acknowledgedBy : null,
    acknowledgedAt: acknowledged ? context.acknowledgedAt : null,
    reason: acknowledged ? context.reason.trim() : null,
    binding: false,
    blocking: false,
    continuation: Object.freeze({ allowed: true, reason: 'platform-safety-boundary-remains-authoritative' }),
  });
}
