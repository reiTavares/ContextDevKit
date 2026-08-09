/**
 * Versioned, auditable owner-preference memory (ADR-0158).
 *
 * Preferences rank recommendations only. They never authorize work, create a
 * gate, lower platform safety, or outrank a current instruction. Mutations are
 * dry-run by default and use same-volume atomic replacement when `write:true`.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

export const OWNER_PREFERENCES_SCHEMA_VERSION = 1;
export const OWNER_PREFERENCES_AUTHORITY = 'recommendation-only';

const ALLOWED_SOURCES = Object.freeze(['explicit', 'inferred']);
const ALLOWED_SCOPES = Object.freeze(['project', 'session', 'workflow']);
const ALLOWED_ACTORS = Object.freeze(['owner', 'human', 'system']);
const KEY_PATTERN = /^(workflow|ambiguity|execution|swarm|routing|graph|context|qa|documentation)\.[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*)*$/;
const SENSITIVE_KEY_PATTERN = /(secret|token|password|credential|private|email|phone|cpf|health|medical)/i;
const SENSITIVE_VALUE_PATTERNS = Object.freeze([
  /\bsk-[a-z0-9_-]{6,}/i,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/,
  /\b(?:bearer|password|token|secret)\s*[:=]\s*\S+/i,
  /\b[\w.+-]+@[\w.-]+\.[a-z]{2,}\b/i,
  /\b\d{3}\.\d{3}\.\d{3}-\d{2}\b/,
]);

/**
 * Returns canonical preference and audit paths contained by the project root.
 * @param {string} root project root.
 * @returns {{ directory:string, store:string, audit:string }} contained paths.
 */
function preferencePaths(root) {
  const projectRoot = resolve(root);
  const directory = resolve(projectRoot, 'contextkit', 'memory', 'preferences');
  if (directory !== projectRoot && !directory.startsWith(`${projectRoot}\\`) && !directory.startsWith(`${projectRoot}/`)) {
    throw new TypeError('owner-preferences: resolved path escaped the project root');
  }
  return {
    directory,
    store: resolve(directory, 'owner-preferences.json'),
    audit: resolve(directory, 'owner-preferences.audit.jsonl'),
  };
}

/** @returns {object} new empty preference store. */
function emptyStore() {
  return { schemaVersion: OWNER_PREFERENCES_SCHEMA_VERSION, revision: 0, preferences: [], audit: [] };
}

/**
 * Parses and validates a stored preferences document.
 * @param {string} root project root.
 * @returns {object} read status, store, and paths.
 */
function readStore(root) {
  const paths = preferencePaths(root);
  if (!existsSync(paths.store)) return { store: emptyStore(), paths, status: 'available', diagnostic: null };
  try {
    const parsed = JSON.parse(readFileSync(paths.store, 'utf8').replace(/^\uFEFF/, ''));
    if (parsed?.schemaVersion !== OWNER_PREFERENCES_SCHEMA_VERSION
      || !Number.isInteger(parsed?.revision)
      || parsed.revision < 0
      || !Array.isArray(parsed?.preferences)
      || (parsed.audit !== undefined && !Array.isArray(parsed.audit))) {
      throw new TypeError('invalid schemaVersion, revision, preferences, or audit');
    }
    return { store: { ...parsed, audit: parsed.audit ?? [] }, paths, status: 'available', diagnostic: null };
  } catch (error) {
    return { store: emptyStore(), paths, status: 'unavailable', diagnostic: error?.message || String(error) };
  }
}

/**
 * Writes UTF-8 content through a sibling temporary file and rename.
 * @param {string} path destination path.
 * @param {string} content serialized content.
 * @param {number} revision revision used in the temporary filename.
 * @returns {void}
 * @throws {Error} when staging or rename fails.
 */
function writeAtomic(path, content, revision) {
  mkdirSync(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp-${process.pid}-${revision}`;
  try {
    writeFileSync(temporaryPath, content, 'utf8');
    renameSync(temporaryPath, path);
  } catch (error) {
    try { unlinkSync(temporaryPath); } catch { /* best effort cleanup */ }
    throw error;
  }
}

/**
 * Deterministic non-cryptographic fingerprint used to omit values from audit.
 * @param {unknown} value preference value.
 * @returns {string} eight-character fingerprint.
 */
function valueFingerprint(value) {
  const text = JSON.stringify(value);
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/**
 * Validates ISO time supplied for an auditable write.
 * @param {unknown} value timestamp candidate.
 * @returns {string} normalized ISO timestamp.
 * @throws {TypeError} when the timestamp is invalid.
 */
function normalizedTime(value) {
  const candidate = value ?? new Date().toISOString();
  if (typeof candidate !== 'string' || Number.isNaN(Date.parse(candidate))) {
    throw new TypeError('owner-preferences: now must be an ISO-8601 timestamp');
  }
  return new Date(candidate).toISOString();
}

/**
 * Validates a preference without accepting secrets or unnecessary personal data.
 * @param {object} preference candidate preference.
 * @param {object|null} existing current preference with the same key.
 * @param {string} now normalized mutation time.
 * @returns {object} normalized preference.
 * @throws {TypeError} when content is invalid or sensitive.
 */
function normalizePreference(preference, existing, now) {
  if (!preference || typeof preference !== 'object') throw new TypeError('owner-preferences: preference is required');
  const key = String(preference.key ?? '').trim();
  if (!KEY_PATTERN.test(key) || SENSITIVE_KEY_PATTERN.test(key)) {
    throw new TypeError('owner-preferences: key is unsupported or sensitive');
  }
  const valueType = typeof preference.value;
  if (!['string', 'number', 'boolean'].includes(valueType)) {
    throw new TypeError('owner-preferences: value must be a string, number, or boolean');
  }
  const serializedValue = String(preference.value);
  if (serializedValue.length === 0 || serializedValue.length > 160
    || SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(serializedValue))) {
    throw new TypeError('owner-preferences: value is empty, oversized, or sensitive');
  }
  const source = ALLOWED_SOURCES.includes(preference.source) ? preference.source : null;
  if (!source) throw new TypeError('owner-preferences: source must be explicit or inferred');
  const confidence = Number(preference.confidence);
  if (!Number.isFinite(confidence) || confidence <= 0 || confidence > 1 || (source === 'explicit' && confidence !== 1)) {
    throw new TypeError('owner-preferences: confidence must be (0,1], and explicit preferences require 1');
  }
  const scope = ALLOWED_SCOPES.includes(preference.scope) ? preference.scope : 'project';
  const evidenceRefs = Array.isArray(preference.evidenceRefs) ? preference.evidenceRefs : [];
  if (evidenceRefs.some((ref) => typeof ref !== 'string' || ref.length > 200 || /[?#]|\.\.|:\/\//.test(ref))) {
    throw new TypeError('owner-preferences: evidenceRefs must be bounded local references without query data');
  }
  return {
    key,
    value: preference.value,
    scope,
    source,
    confidence,
    evidenceRefs: [...new Set(evidenceRefs)],
    firstSeenAt: existing?.firstSeenAt ?? now,
    lastConfirmedAt: source === 'explicit' ? now : existing?.lastConfirmedAt ?? null,
  };
}

/**
 * Validates optimistic revision and an audit actor.
 * @param {object} read current read result.
 * @param {object} options mutation options.
 * @returns {{ actor:string, now:string }} normalized mutation context.
 * @throws {TypeError} on unavailable state, revision conflict, or invalid actor.
 */
function mutationContext(read, options) {
  if (read.status !== 'available') {
    throw new TypeError(`owner-preferences: store unavailable (${read.diagnostic})`);
  }
  if (options.expectedRevision !== undefined && options.expectedRevision !== read.store.revision) {
    throw new TypeError(`owner-preferences: revision mismatch (expected ${options.expectedRevision}, actual ${read.store.revision})`);
  }
  const actor = ALLOWED_ACTORS.includes(options.actor) ? options.actor : null;
  if (!actor) throw new TypeError('owner-preferences: actor must be owner, human, or system');
  return { actor, now: normalizedTime(options.now) };
}

/**
 * Appends a redacted audit event through atomic replacement.
 * @param {object} paths preference paths.
 * @param {object} event redacted audit event.
 * @param {number} revision resulting store revision.
 * @returns {void}
 */
function writeAudit(paths, event, revision) {
  const current = existsSync(paths.audit) ? readFileSync(paths.audit, 'utf8') : '';
  writeAtomic(paths.audit, `${current}${JSON.stringify(event)}\n`, revision);
}

/**
 * Applies one store and redacted audit event, or returns a dry-run receipt.
 * @param {object} read current read result.
 * @param {object} nextStore proposed store.
 * @param {object} event redacted audit event.
 * @param {object} options mutation options.
 * @returns {object} dry-run or applied receipt.
 */
function applyMutation(read, nextStore, event, options) {
  const auditedStore = { ...nextStore, audit: [...(read.store.audit ?? []), event] };
  const receipt = {
    applied: false,
    authority: OWNER_PREFERENCES_AUTHORITY,
    blocking: false,
    store: auditedStore,
    auditEvent: event,
  };
  if (options.write !== true) return receipt;
  writeAtomic(read.paths.store, `${JSON.stringify(auditedStore, null, 2)}\n`, auditedStore.revision);
  writeAudit(read.paths, event, auditedStore.revision);
  return { ...receipt, applied: true };
}

/**
 * Lists preferences without writing or treating corruption as a block.
 *
 * @param {string} root project root.
 * @returns {object} current store plus authority metadata.
 */
export function listOwnerPreferences(root) {
  const read = readStore(root);
  return {
    ...read.store,
    status: read.status,
    diagnostic: read.diagnostic,
    authority: OWNER_PREFERENCES_AUTHORITY,
    blocking: false,
  };
}

/**
 * Adds or replaces one preference. Explicit memory cannot be overwritten by an
 * inferred preference; such attempts are returned as ignored recommendations.
 *
 * @param {string} root project root.
 * @param {object} preference preference record.
 * @param {object} [options] write, actor, time, and expected revision.
 * @returns {object} dry-run or applied receipt.
 */
export function editOwnerPreference(root, preference, options = {}) {
  const read = readStore(root);
  const { actor, now } = mutationContext(read, options);
  const existing = read.store.preferences.find((entry) => entry.key === preference?.key) ?? null;
  const normalized = normalizePreference(preference, existing, now);
  if (existing?.source === 'explicit' && normalized.source === 'inferred') {
    return {
      applied: false,
      authority: OWNER_PREFERENCES_AUTHORITY,
      blocking: false,
      status: 'ignored-inferred-below-explicit',
      store: read.store,
    };
  }
  const preferences = read.store.preferences.filter((entry) => entry.key !== normalized.key);
  preferences.push(normalized);
  preferences.sort((left, right) => left.key.localeCompare(right.key));
  const nextStore = { ...read.store, revision: read.store.revision + 1, preferences };
  const event = {
    schemaVersion: 1,
    action: 'edit',
    key: normalized.key,
    source: normalized.source,
    actor,
    at: now,
    revision: nextStore.revision,
    valueFingerprint: valueFingerprint(normalized.value),
    authority: OWNER_PREFERENCES_AUTHORITY,
  };
  return applyMutation(read, nextStore, event, options);
}

/**
 * Confirms an existing preference as explicit owner guidance.
 *
 * @param {string} root project root.
 * @param {string} key preference key.
 * @param {object} [options] mutation options.
 * @returns {object} dry-run or applied receipt.
 */
export function confirmOwnerPreference(root, key, options = {}) {
  const read = readStore(root);
  const { actor, now } = mutationContext(read, options);
  const existing = read.store.preferences.find((entry) => entry.key === key);
  if (!existing) throw new TypeError(`owner-preferences: unknown preference ${key}`);
  const confirmed = { ...existing, source: 'explicit', confidence: 1, lastConfirmedAt: now };
  const preferences = read.store.preferences.map((entry) => entry.key === key ? confirmed : entry);
  const nextStore = { ...read.store, revision: read.store.revision + 1, preferences };
  const event = {
    schemaVersion: 1,
    action: 'confirm',
    key,
    source: 'explicit',
    actor,
    at: now,
    revision: nextStore.revision,
    valueFingerprint: valueFingerprint(confirmed.value),
    authority: OWNER_PREFERENCES_AUTHORITY,
  };
  return applyMutation(read, nextStore, event, options);
}

/**
 * Clears all preferences while retaining revision and audit continuity.
 *
 * @param {string} root project root.
 * @param {object} [options] mutation options.
 * @returns {object} dry-run or applied receipt.
 */
export function resetOwnerPreferences(root, options = {}) {
  const read = readStore(root);
  const { actor, now } = mutationContext(read, options);
  const nextStore = { ...read.store, revision: read.store.revision + 1, preferences: [] };
  const event = {
    schemaVersion: 1,
    action: 'reset',
    key: null,
    source: 'explicit',
    actor,
    at: now,
    revision: nextStore.revision,
    clearedCount: read.store.preferences.length,
    authority: OWNER_PREFERENCES_AUTHORITY,
  };
  return applyMutation(read, nextStore, event, options);
}

/**
 * Resolves one preference for ranking. A current instruction always wins while
 * the stored preference remains visible for audit and explanation.
 *
 * @param {string} root project root.
 * @param {string} key preference key.
 * @param {object} [context] current instruction context.
 * @returns {object} non-binding ranked preference.
 */
export function resolveOwnerPreference(root, key, context = {}) {
  const listed = listOwnerPreferences(root);
  const preference = listed.preferences.find((entry) => entry.key === key) ?? null;
  const hasCurrentInstruction = typeof context.currentInstruction === 'string'
    && context.currentInstruction.trim().length > 0;
  return {
    authority: hasCurrentInstruction ? 'current-instruction' : OWNER_PREFERENCES_AUTHORITY,
    blocking: false,
    status: listed.status,
    diagnostic: listed.diagnostic,
    preference,
    effectiveValue: hasCurrentInstruction ? null : preference?.value ?? null,
    reason: hasCurrentInstruction ? 'current-instruction-outranks-stored-preference' : 'preference-is-ranking-input-only',
  };
}
