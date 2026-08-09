/**
 * Cross-process, session-scoped anti-loop state for the v4 governance runtime.
 *
 * The store is deliberately ephemeral and outside the project tree. It is opened
 * lazily only after a definite mutation attempt; conversation and exploration do
 * not create a directory, file, task, ledger, or marker.
 */
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

export const GOVERNANCE_SESSION_STATE_SCHEMA = 'governance-session-state/1';
export const DEFAULT_SESSION_STATE_TTL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_STALE_LOCK_MS = 30 * 1000;
const MAX_SESSION_FILE_TOKEN_LENGTH = 180;

/** @param {unknown} value @returns {string} */
function errorMessage(value) {
  return value instanceof Error ? value.message : String(value);
}

/** @param {unknown} value @returns {boolean} */
function isRecord(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

/**
 * Encodes, rather than hashes, the session identity so the hot path has no
 * mandatory digest computation and persisted state remains attributable.
 *
 * @param {string} sessionId canonical session identity
 * @returns {string|null} filesystem-safe reversible token
 */
function sessionFileToken(sessionId) {
  const token = Buffer.from(String(sessionId), 'utf8').toString('base64url');
  return token.length > 0 && token.length <= MAX_SESSION_FILE_TOKEN_LENGTH ? token : null;
}

/** @param {Record<string, number>} claims @param {number} nowMs @returns {Record<string, number>} */
function pruneClaims(claims, nowMs) {
  return Object.fromEntries(
    Object.entries(isRecord(claims) ? claims : {})
      .filter(([, expiresAt]) => Number.isFinite(expiresAt) && expiresAt > nowMs),
  );
}

/** @param {string} sessionId @param {number} nowMs @param {number} ttlMs @returns {object} */
function emptyState(sessionId, nowMs, ttlMs) {
  return {
    schemaVersion: GOVERNANCE_SESSION_STATE_SCHEMA,
    sessionId,
    expiresAt: nowMs + ttlMs,
    evaluationClaims: {},
    visibleProblemClaims: {},
    circuit: { failures: 0, open: false },
  };
}

/**
 * Creates a lazy state store. Merely constructing or querying a missing session
 * performs no write, which is the mutation-only artifact boundary.
 *
 * @param {object} [options]
 * @param {string} [options.baseDirectory]
 * @param {()=>number} [options.now]
 * @param {number} [options.ttlMs]
 * @param {number} [options.staleLockMs]
 * @returns {Readonly<object>}
 */
export function createGovernanceSessionStateStore({
  baseDirectory = process.env.CONTEXTKIT_GOVERNANCE_STATE_DIR
    || join(tmpdir(), 'contextdevkit-governance-v4'),
  now = Date.now,
  ttlMs = DEFAULT_SESSION_STATE_TTL_MS,
  staleLockMs = DEFAULT_STALE_LOCK_MS,
} = {}) {
  if (!Number.isFinite(ttlMs) || ttlMs <= 0) throw new RangeError('ttlMs must be positive');
  if (!Number.isFinite(staleLockMs) || staleLockMs <= 0) throw new RangeError('staleLockMs must be positive');
  const absoluteBaseDirectory = resolve(baseDirectory);

  /** @param {string} sessionId @returns {string|null} */
  function statePath(sessionId) {
    const token = sessionFileToken(sessionId);
    return token ? join(absoluteBaseDirectory, `${token}.json`) : null;
  }

  /** @param {string} filePath @returns {number|null} */
  function acquireLock(filePath) {
    const lockPath = `${filePath}.lock`;
    try {
      return openSync(lockPath, 'wx', 0o600);
    } catch (error) {
      if (error?.code !== 'EEXIST') throw error;
      try {
        if (now() - statSync(lockPath).mtimeMs > staleLockMs) rmSync(lockPath, { force: true });
        else return null;
      } catch {
        return null;
      }
      try {
        return openSync(lockPath, 'wx', 0o600);
      } catch {
        return null;
      }
    }
  }

  /** @param {string} filePath @param {string} sessionId @returns {object} */
  function readState(filePath, sessionId) {
    const nowMs = now();
    if (!existsSync(filePath)) return emptyState(sessionId, nowMs, ttlMs);
    const parsed = JSON.parse(readFileSync(filePath, 'utf8').replace(/^\uFEFF/, ''));
    if (parsed?.schemaVersion !== GOVERNANCE_SESSION_STATE_SCHEMA
      || parsed?.sessionId !== sessionId
      || !Number.isFinite(parsed?.expiresAt)
      || parsed.expiresAt <= nowMs) {
      return emptyState(sessionId, nowMs, ttlMs);
    }
    return {
      ...parsed,
      evaluationClaims: pruneClaims(parsed.evaluationClaims, nowMs),
      visibleProblemClaims: pruneClaims(parsed.visibleProblemClaims, nowMs),
      circuit: isRecord(parsed.circuit)
        ? { failures: Number(parsed.circuit.failures) || 0, open: parsed.circuit.open === true }
        : { failures: 0, open: false },
    };
  }

  /** @param {string} filePath @param {object} state @returns {void} */
  function writeState(filePath, state) {
    const temporaryPath = `${filePath}.tmp-${process.pid}-${now()}`;
    try {
      writeFileSync(temporaryPath, `${JSON.stringify(state)}\n`, { encoding: 'utf8', flag: 'wx', mode: 0o600 });
      renameSync(temporaryPath, filePath);
    } catch (error) {
      rmSync(temporaryPath, { force: true });
      throw error;
    }
  }

  /**
   * @param {string} sessionId
   * @param {(state:object)=>{changed:boolean,value:object}} mutate
   * @returns {object}
   */
  function transact(sessionId, mutate) {
    const canonicalSessionId = String(sessionId ?? '').trim();
    const filePath = statePath(canonicalSessionId);
    if (!canonicalSessionId || !filePath) return { status: 'unavailable', reason: 'invalid session identity' };
    let lockDescriptor = null;
    try {
      mkdirSync(dirname(filePath), { recursive: true });
      lockDescriptor = acquireLock(filePath);
      if (lockDescriptor === null) return { status: 'busy', reason: 'session state is locked' };
      const state = readState(filePath, canonicalSessionId);
      const mutation = mutate(state);
      if (mutation.changed) {
        state.expiresAt = now() + ttlMs;
        writeState(filePath, state);
      }
      return { status: 'ok', ...mutation.value };
    } catch (error) {
      return { status: 'unavailable', reason: errorMessage(error) };
    } finally {
      if (lockDescriptor !== null) {
        closeSync(lockDescriptor);
        rmSync(`${filePath}.lock`, { force: true });
      }
    }
  }

  /** @param {'evaluationClaims'|'visibleProblemClaims'} collection @param {string} sessionId @param {string} key @returns {object} */
  function claim(collection, sessionId, key) {
    if (typeof key !== 'string' || key.length === 0) return { status: 'unavailable', reason: 'claim key missing' };
    return transact(sessionId, (state) => {
      const claims = state[collection];
      if (Object.hasOwn(claims, key)) return { changed: false, value: { claimed: false } };
      claims[key] = now() + ttlMs;
      return { changed: true, value: { claimed: true } };
    });
  }

  return Object.freeze({
    baseDirectory: absoluteBaseDirectory,
    hasSession(sessionId) {
      const filePath = statePath(String(sessionId ?? '').trim());
      return Boolean(filePath && existsSync(filePath));
    },
    claimEvaluation(sessionId, key) {
      return claim('evaluationClaims', sessionId, key);
    },
    claimVisibleProblem(sessionId, key) {
      return claim('visibleProblemClaims', sessionId, key);
    },
    circuitSnapshot(sessionId) {
      const canonicalSessionId = String(sessionId ?? '').trim();
      const filePath = statePath(canonicalSessionId);
      if (!canonicalSessionId || !filePath) return { status: 'unavailable', reason: 'invalid session identity' };
      if (!existsSync(filePath)) return { status: 'ok', failures: 0, open: false };
      try {
        const state = readState(filePath, canonicalSessionId);
        return { status: 'ok', failures: state.circuit.failures, open: state.circuit.open };
      } catch (error) {
        return { status: 'unavailable', reason: errorMessage(error) };
      }
    },
    recordCircuitFailure(sessionId, failureThreshold) {
      return transact(sessionId, (state) => {
        state.circuit.failures += 1;
        state.circuit.open = state.circuit.failures >= failureThreshold;
        return { changed: true, value: { ...state.circuit } };
      });
    },
    recordCircuitSuccess(sessionId) {
      return transact(sessionId, (state) => {
        const changed = !state.circuit.open && state.circuit.failures !== 0;
        if (changed) state.circuit.failures = 0;
        return { changed, value: { ...state.circuit } };
      });
    },
    clearSession(sessionId) {
      const filePath = statePath(String(sessionId ?? '').trim());
      if (!filePath) return false;
      rmSync(filePath, { force: true });
      rmSync(`${filePath}.lock`, { force: true });
      return true;
    },
  });
}
