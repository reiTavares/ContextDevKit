/**
 * Canonical ContextDevKit 4 governance gate registry (ADR-0158).
 *
 * This is the single authority for gate ids, default modes, blocking moments,
 * and human-override metadata. It deliberately contains no project I/O and no
 * third-party dependency so every host can consume the same immutable matrix.
 */
import { createHash } from 'node:crypto';

export const GATE_POLICY_VERSION = '4.0.0-rc.1';

export const OVERRIDE_METADATA_FIELDS = Object.freeze([
  'actor',
  'reason',
  'scope',
  'policyVersion',
  'policyHash',
  'baseRevision',
  'timestamp',
  'outcome',
]);

const GUARDED_GATE_ID_LIST = ['qa-signoff', 'ddd-invariants', 'technical-debt'];
export const GUARDED_GATE_IDS = Object.freeze([...GUARDED_GATE_ID_LIST]);

const RAW_GATE_REGISTRY = {
  'qa-signoff': {
    defaultMode: 'guarded',
    evidenceKind: 'deterministic',
    blockingMoments: ['completion'],
    evaluationMoments: ['completion'],
    overrideAllowed: true,
  },
  'ddd-invariants': {
    defaultMode: 'guarded',
    evidenceKind: 'deterministic',
    blockingMoments: ['write-preflight', 'completion'],
    evaluationMoments: ['write-preflight', 'completion'],
    overrideAllowed: true,
  },
  'technical-debt': {
    defaultMode: 'guarded',
    evidenceKind: 'deterministic',
    blockingMoments: ['completion'],
    evaluationMoments: ['completion'],
    overrideAllowed: true,
  },
  'architecture-debt': { defaultMode: 'canary', evidenceKind: 'predictive', evaluationMoments: ['write-preflight', 'postflight'] },
  'privacy-lgpd': { defaultMode: 'shadow', evidenceKind: 'predictive', evaluationMoments: ['write-preflight', 'postflight'] },
  'graph-first': { defaultMode: 'canary', evidenceKind: 'auxiliary', evaluationMoments: ['prompt-preflight', 'write-preflight'] },
  intake: { defaultMode: 'canary', evidenceKind: 'predictive', evaluationMoments: ['prompt-preflight'] },
  journey: { defaultMode: 'canary', evidenceKind: 'predictive', evaluationMoments: ['write-preflight'] },
  'workflow-presence': { defaultMode: 'canary', evidenceKind: 'predictive', evaluationMoments: ['write-preflight'] },
  simulation: { defaultMode: 'canary', evidenceKind: 'auxiliary', evaluationMoments: ['write-preflight'] },
  deliberation: { defaultMode: 'canary', evidenceKind: 'predictive', evaluationMoments: ['write-preflight'] },
  'agent-routing': { defaultMode: 'canary', evidenceKind: 'predictive', evaluationMoments: ['prompt-preflight', 'write-preflight'] },
  'subagent-scope': { defaultMode: 'canary', evidenceKind: 'predictive', evaluationMoments: ['write-preflight'] },
  economy: { defaultMode: 'canary', evidenceKind: 'auxiliary', evaluationMoments: ['prompt-preflight', 'write-preflight', 'postflight'] },
  'context-pack': { defaultMode: 'canary', evidenceKind: 'auxiliary', evaluationMoments: ['write-preflight'] },
  completion: { defaultMode: 'canary', evidenceKind: 'predictive', evaluationMoments: ['completion'] },
};

/**
 * Recursively freezes a registry value so consumers cannot create a second
 * in-process policy authority by mutating a nested entry.
 *
 * @param {unknown} value registry value
 * @returns {unknown} the frozen value
 */
function freezeRegistryValue(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeRegistryValue(child);
  return Object.freeze(value);
}

export const GATE_REGISTRY = /** @type {Readonly<Record<string, object>>} */ (
  freezeRegistryValue(Object.fromEntries(
    Object.entries(RAW_GATE_REGISTRY).map(([id, definition]) => [id, {
      id,
      evaluatorId: id,
      blockingMoments: [],
      evaluationMoments: [],
      overrideAllowed: false,
      overrideMetadata: [],
      ...definition,
      overrideMetadata: definition.overrideAllowed ? OVERRIDE_METADATA_FIELDS : [],
    }]),
  ))
);

export const GATE_IDS = Object.freeze(Object.keys(GATE_REGISTRY));

const POLICY_DOCUMENT = JSON.stringify({
  policyVersion: GATE_POLICY_VERSION,
  guardedAllowlist: GUARDED_GATE_ID_LIST,
  gates: GATE_REGISTRY,
});

export const GATE_POLICY_HASH = createHash('sha256').update(POLICY_DOCUMENT).digest('hex');

export const DEFAULT_GOVERNANCE_CONFIG = freezeRegistryValue({
  defaultMode: 'canary',
  failurePolicy: 'continue',
  humanAuthority: 'owner-wins',
  gates: Object.fromEntries(GATE_IDS.map((id) => [id, GATE_REGISTRY[id].defaultMode])),
});

/**
 * Returns a canonical gate definition, or null for an unknown id.
 *
 * @param {string} gateId canonical gate id
 * @returns {Readonly<object>|null} immutable gate definition
 */
export function getGateDefinition(gateId) {
  return typeof gateId === 'string' && Object.hasOwn(GATE_REGISTRY, gateId)
    ? GATE_REGISTRY[gateId]
    : null;
}

/**
 * Decides whether an evidenced violation is permitted to deny at this moment.
 * All fields are explicit so missing/unknown evidence fails open to canary.
 *
 * @param {string} gateId canonical gate id
 * @param {string} moment lifecycle moment
 * @param {object} [violation] deterministic evidence facts
 * @returns {boolean} true only for the three guarded domains and exact facts
 */
export function canGateDeny(gateId, moment, violation = {}) {
  const definition = getGateDefinition(gateId);
  if (!definition || !GUARDED_GATE_IDS.includes(gateId)) return false;
  const canonicalMoment = moment === 'beforeWrite'
    ? 'write-preflight'
    : moment === 'beforeCompletion'
      ? 'completion'
      : moment;
  if (!definition.blockingMoments.includes(canonicalMoment)) return false;
  if (violation.deterministic !== true || violation.applicable !== true || violation.evidenced !== true) return false;

  if (gateId === 'qa-signoff') return violation.transition === 'done';
  if (gateId === 'ddd-invariants') return violation.invariantClass === 'A';
  if (gateId === 'technical-debt') {
    return violation.introducedByCurrentDiff === true
      && violation.newDebt === true
      && ['high', 'critical'].includes(violation.severity);
  }
  return false;
}
