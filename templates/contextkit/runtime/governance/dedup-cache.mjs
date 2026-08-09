/**
 * Builds the canonical identity for one gate evaluation.
 *
 * JSON encoding avoids delimiter collisions while preserving the exact
 * `(session, workItem, revision, gate, moment)` contract from ADR-0158.
 *
 * @param {object} identity
 * @param {string} identity.sessionId
 * @param {string} identity.workItemId
 * @param {string|number} identity.revision
 * @param {string} identity.gateId
 * @param {string} identity.moment
 * @returns {string}
 * @throws {TypeError} when an identity dimension is absent
 */
export function createGateDedupKey({ sessionId, workItemId, revision, gateId, moment } = {}) {
  const dimensions = [sessionId, workItemId, revision, gateId, moment];
  if (dimensions.some((dimension) => dimension === null || dimension === undefined || String(dimension).trim() === '')) {
    throw new TypeError('Gate deduplication requires sessionId, workItemId, revision, gateId, and moment.');
  }
  return JSON.stringify(dimensions.map((dimension) => String(dimension)));
}

/**
 * Builds a session-scoped identity for visible-problem suppression.
 * A problem intentionally excludes revision so an unchanged issue is not
 * repeated merely because the work item advanced.
 *
 * @param {object} identity
 * @param {string} identity.sessionId
 * @param {string} identity.problemKey
 * @returns {string}
 * @throws {TypeError} when an identity dimension is absent
 */
export function createVisibleProblemKey({ sessionId, problemKey } = {}) {
  if (!sessionId || !problemKey) {
    throw new TypeError('Visible-problem suppression requires sessionId and problemKey.');
  }
  return JSON.stringify([String(sessionId), String(problemKey)]);
}

/**
 * Creates an in-memory, session-scoped claim cache. Claims are never evicted
 * during a session because eviction would permit a duplicate evaluation.
 * Session lifecycle owners may explicitly clear completed sessions.
 *
 * @returns {{claim:(key:string)=>boolean, has:(key:string)=>boolean, deleteWhere:(predicate:(key:string)=>boolean)=>number, clear:()=>void, size:()=>number}}
 */
export function createDedupCache() {
  const claimedKeys = new Set();

  return Object.freeze({
    claim(key) {
      if (typeof key !== 'string' || key.length === 0) {
        throw new TypeError('A non-empty deduplication key is required.');
      }
      if (claimedKeys.has(key)) return false;
      claimedKeys.add(key);
      return true;
    },
    has(key) {
      return claimedKeys.has(key);
    },
    deleteWhere(predicate) {
      if (typeof predicate !== 'function') throw new TypeError('A key predicate is required.');
      let deleted = 0;
      for (const key of claimedKeys) {
        if (!predicate(key)) continue;
        claimedKeys.delete(key);
        deleted += 1;
      }
      return deleted;
    },
    clear() {
      claimedKeys.clear();
    },
    size() {
      return claimedKeys.size;
    },
  });
}
