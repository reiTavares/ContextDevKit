/**
 * ContextDevKit-owned authorization envelope for external execution.
 * The envelope grants bounded technical execution; it never grants an executor
 * authority to alter workflow, test, QA, or completion state.
 */
import { createHash } from 'node:crypto';
import { isAbsolute, relative, resolve } from 'node:path';

export const GOVERNED_EXECUTION_SCHEMA_VERSION = 1;
export const MAX_EXECUTION_OBJECTIVE_BYTES = 64 * 1024;
export const MAX_ALLOWED_PATHS = 256;

/** Error raised before any external process may be invoked. */
export class GovernedExecutionRefusal extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.name = 'GovernedExecutionRefusal';
    this.code = code;
  }
}

/** Stable JSON encoding used by hashes and idempotency identifiers. */
export function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

/** Return a lowercase SHA-256 hex digest. */
export function sha256(value) {
  return createHash('sha256').update(String(value), 'utf8').digest('hex');
}

function nonEmptyString(value, field, maxBytes = 4096) {
  const normalized = String(value ?? '').trim();
  if (!normalized) throw new GovernedExecutionRefusal('invalid_envelope', `${field} is required`);
  if (Buffer.byteLength(normalized, 'utf8') > maxBytes) {
    throw new GovernedExecutionRefusal('invalid_envelope', `${field} exceeds ${maxBytes} bytes`);
  }
  return normalized;
}

function normalizeRelativePath(workspaceRoot, candidate) {
  const normalized = nonEmptyString(candidate, 'allowedPaths[]').replace(/\\/g, '/');
  if (isAbsolute(normalized) || normalized.startsWith('//') || /^(?:[A-Za-z]:|\\\\|\\\?\\)/.test(normalized)) {
    throw new GovernedExecutionRefusal('invalid_scope', `allowed path must be workspace-relative: ${normalized}`);
  }
  const absolute = resolve(workspaceRoot, ...normalized.split('/'));
  const rel = relative(workspaceRoot, absolute).replace(/\\/g, '/');
  if (!rel || rel === '..' || rel.startsWith('../') || isAbsolute(rel)) {
    if (rel === '') return '.';
    throw new GovernedExecutionRefusal('invalid_scope', `allowed path escapes the workspace: ${normalized}`);
  }
  return rel;
}

function normalizeStringList(values, field, { fallback = [], max = 256 } = {}) {
  const source = values === undefined ? fallback : values;
  if (!Array.isArray(source) || source.length > max) {
    throw new GovernedExecutionRefusal('invalid_envelope', `${field} must be an array with at most ${max} entries`);
  }
  return [...new Set(source.map((value) => nonEmptyString(value, `${field}[]`)))].sort();
}

/**
 * Creates an envelope directly from canonical workflow/task facts.
 * @param {object} workflow validated Workflow v2 row
 * @param {object} task canonical task record
 * @param {object} input requested objective, scope and execution policy
 * @param {{now?:Date}} [options]
 * @returns {Readonly<object>}
 */
export function createAuthorizedExecutionEnvelope(workflow, task, input, options = {}) {
  if (workflow?.format !== 'v2' || workflow?.state?.status !== 'working') {
    throw new GovernedExecutionRefusal('governance_refused', 'workflow must be an active Workflow v2 package');
  }
  if (!['pipeline', 'implementation', 'ship'].includes(workflow.currentPhase)) {
    throw new GovernedExecutionRefusal('governance_refused', `workflow phase ${workflow.currentPhase} cannot dispatch execution`);
  }
  if (!task || task.status !== 'working') {
    throw new GovernedExecutionRefusal('governance_refused', 'task must be in working state before execution');
  }
  const now = options.now ?? new Date();
  const issuedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + (input.authorizationTtlMs ?? 60 * 60 * 1000)).toISOString();
  return validateGovernedExecutionEnvelope({
    schemaVersion: GOVERNED_EXECUTION_SCHEMA_VERSION,
    workflowId: workflow.id,
    taskId: task.id,
    taskRevision: workflow.tasks.revision,
    objective: input.objective,
    workspaceRoot: input.workspaceRoot,
    allowedPaths: input.allowedPaths?.length ? input.allowedPaths : task.touchHints,
    constraints: input.constraints ?? [],
    executionPermissions: input.executionPermissions ?? {
      mode: 'auto-approve',
      allowedOperations: ['*'],
      allowedCommands: ['*'],
      networkPolicy: 'allow',
      environmentKeys: [],
    },
    evidencePolicy: input.evidencePolicy ?? { requireTerminalEvent: true, maxBytes: 1024 * 1024 },
    authorizationExpiresAt: expiresAt,
    authorizationReceipt: {
      authority: 'contextdevkit',
      status: 'authorized',
      workflowId: workflow.id,
      taskId: task.id,
      taskRevision: workflow.tasks.revision,
      workflowStateRevision: workflow.state.revision,
      issuedAt,
    },
  }, { now });
}

/**
 * Validates and canonicalizes an execution envelope.
 * @param {object} input candidate envelope
 * @param {{now?:Date}} [options]
 * @returns {Readonly<object>}
 * @throws {GovernedExecutionRefusal}
 */
export function validateGovernedExecutionEnvelope(input, options = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new GovernedExecutionRefusal('invalid_envelope', 'execution envelope must be an object');
  }
  if (input.schemaVersion !== GOVERNED_EXECUTION_SCHEMA_VERSION) {
    throw new GovernedExecutionRefusal('unsupported_envelope', `schemaVersion must be ${GOVERNED_EXECUTION_SCHEMA_VERSION}`);
  }
  const workflowId = nonEmptyString(input.workflowId, 'workflowId');
  const taskId = nonEmptyString(input.taskId, 'taskId');
  if (!Number.isInteger(input.taskRevision) || input.taskRevision < 0) {
    throw new GovernedExecutionRefusal('invalid_envelope', 'taskRevision must be a non-negative integer');
  }
  const workspaceRoot = resolve(nonEmptyString(input.workspaceRoot, 'workspaceRoot'));
  const objective = nonEmptyString(input.objective, 'objective', MAX_EXECUTION_OBJECTIVE_BYTES);
  if (!Array.isArray(input.allowedPaths) || input.allowedPaths.length === 0 || input.allowedPaths.length > MAX_ALLOWED_PATHS) {
    throw new GovernedExecutionRefusal('invalid_scope', `allowedPaths must contain 1-${MAX_ALLOWED_PATHS} entries`);
  }
  const allowedPaths = [...new Set(input.allowedPaths.map((path) => normalizeRelativePath(workspaceRoot, path)))].sort();
  const authorizationExpiresAt = nonEmptyString(input.authorizationExpiresAt, 'authorizationExpiresAt');
  const expiry = Date.parse(authorizationExpiresAt);
  if (!Number.isFinite(expiry) || expiry <= (options.now ?? new Date()).getTime()) {
    throw new GovernedExecutionRefusal('authorization_expired', 'authorizationExpiresAt must be a future timestamp');
  }
  const receipt = input.authorizationReceipt;
  if (!receipt || receipt.authority !== 'contextdevkit' || receipt.status !== 'authorized'
      || receipt.workflowId !== workflowId || receipt.taskId !== taskId
      || receipt.taskRevision !== input.taskRevision) {
    throw new GovernedExecutionRefusal('governance_refused', 'authorizationReceipt is missing or does not match the envelope');
  }
  const permissions = input.executionPermissions;
  if (!permissions || permissions.mode !== 'auto-approve') {
    throw new GovernedExecutionRefusal('invalid_permissions', 'executionPermissions.mode must be auto-approve');
  }
  const normalized = {
    schemaVersion: GOVERNED_EXECUTION_SCHEMA_VERSION,
    workflowId,
    taskId,
    taskRevision: input.taskRevision,
    objective,
    workspaceRoot,
    allowedPaths,
    constraints: normalizeStringList(input.constraints, 'constraints', { max: 128 }),
    executionPermissions: {
      mode: 'auto-approve',
      allowedOperations: normalizeStringList(permissions.allowedOperations, 'allowedOperations', { fallback: ['*'], max: 64 }),
      allowedCommands: normalizeStringList(permissions.allowedCommands, 'allowedCommands', { fallback: ['*'], max: 128 }),
      networkPolicy: permissions.networkPolicy === 'allow' ? 'allow' : 'deny',
      environmentKeys: normalizeStringList(permissions.environmentKeys, 'environmentKeys', { max: 128 }),
    },
    evidencePolicy: {
      requireTerminalEvent: input.evidencePolicy?.requireTerminalEvent !== false,
      maxBytes: Math.min(Math.max(Number(input.evidencePolicy?.maxBytes) || 1024 * 1024, 1024), 8 * 1024 * 1024),
    },
    authorizationExpiresAt,
    authorizationReceipt: { ...receipt },
  };
  // Authorization timestamps prove freshness but do not identify the work.
  // Excluding them keeps retries for the same canonical task revision stable.
  const envelopeSha256 = sha256(stableJson({
    schemaVersion: normalized.schemaVersion,
    workflowId: normalized.workflowId,
    taskId: normalized.taskId,
    taskRevision: normalized.taskRevision,
    objective: normalized.objective,
    workspaceRoot: normalized.workspaceRoot,
    allowedPaths: normalized.allowedPaths,
    constraints: normalized.constraints,
    executionPermissions: normalized.executionPermissions,
    evidencePolicy: normalized.evidencePolicy,
    authorizationAuthority: normalized.authorizationReceipt.authority,
    authorizationStatus: normalized.authorizationReceipt.status,
  }));
  return Object.freeze({ ...normalized, envelopeSha256 });
}

/** Derive retry-stable identifiers for one authorized envelope. */
export function executionIdentity(envelope) {
  const hash = envelope.envelopeSha256;
  return Object.freeze({
    executionId: `cdk-${hash.slice(0, 24)}`,
    messageId: `cdk-msg-${hash.slice(0, 24)}`,
    idempotencyKey: `contextdevkit:${envelope.workflowId}:${envelope.taskId}:${envelope.taskRevision}:${hash}`,
  });
}
