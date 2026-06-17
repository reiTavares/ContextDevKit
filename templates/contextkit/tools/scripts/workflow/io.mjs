/**
 * Shared safe-I/O foundation for the universal wave workflow engine (ADR-0100
 * §12, WF0035). Orchestrator-owned: every `workflow/*.mjs` module imports from
 * here, so it cannot belong to a single agent's lane.
 *
 * Builds on the kit's atomic writer (`runtime/hooks/safe-io.mjs`, ADR-0089) and
 * adds: deterministic stringify (stable JSON for machine contracts), write-if-
 * changed (no mtime churn — projections stay idempotent), idempotent managed-
 * block update (ADR-0067 markers), and content hashing (plan-hash guard).
 *
 * Zero runtime dependencies — `node:*` only (ADR-0001). Pure helpers are pure;
 * the file-touching helpers fail loudly only on real I/O errors, never on a
 * missing optional file (readJsonSafe returns the fallback).
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import {
  parseJsonSafe,
  readJsonSafe,
  writeFileAtomic,
  writeFileAtomicSync,
} from '../../../runtime/hooks/safe-io.mjs';

export { parseJsonSafe, readJsonSafe, writeFileAtomic, writeFileAtomicSync };

/**
 * Deterministically serialize a value to JSON with sorted object keys, so two
 * semantically-equal states always stringify byte-identically (stable diffs,
 * stable hashes, no churn). Arrays keep their order; primitives pass through.
 * @param {unknown} value
 * @param {number} [indent] spaces (default 2; pass 0 for compact)
 * @returns {string} stable JSON (newline-terminated when indented)
 */
export function stableStringify(value, indent = 2) {
  const seen = new WeakSet();
  const normalize = (node) => {
    if (node === null || typeof node !== 'object') return node;
    if (seen.has(node)) throw new TypeError('stableStringify: circular reference');
    seen.add(node);
    if (Array.isArray(node)) {
      const out = node.map(normalize);
      seen.delete(node);
      return out;
    }
    const out = {};
    for (const key of Object.keys(node).sort()) out[key] = normalize(node[key]);
    seen.delete(node);
    return out;
  };
  const text = JSON.stringify(normalize(value), null, indent);
  return indent > 0 ? `${text}\n` : text;
}

/**
 * Sha-256 hex digest of a string or value. Objects are hashed via their stable
 * serialization, so logically-equal plans share a hash (plan-hash guard).
 * @param {string|object} input
 * @returns {string} 64-char hex digest
 */
export function sha256Hex(input) {
  const text = typeof input === 'string' ? input : stableStringify(input, 0);
  return createHash('sha256').update(text, 'utf-8').digest('hex');
}

/**
 * Write `content` to `path` ONLY when it differs from what is already on disk.
 * Prevents mtime churn so re-rendering a projection that produced identical
 * output is a no-op. Uses the atomic writer when it does write.
 * @param {string} path
 * @param {string} content
 * @returns {{ changed: boolean }} whether a write occurred
 */
export function writeIfChanged(path, content) {
  if (existsSync(path)) {
    let current = '';
    try {
      current = readFileSync(path, 'utf-8');
    } catch {
      current = '';
    }
    if (current === content) return { changed: false };
  }
  writeFileAtomicSync(path, content);
  return { changed: true };
}

/**
 * Stable-stringify `obj` and write it only if changed. The canonical way to
 * persist a machine contract (`workflow-plan.json`, result objects).
 * @param {string} path
 * @param {object} obj
 * @returns {{ changed: boolean }}
 */
export function writeJsonStable(path, obj) {
  return writeIfChanged(path, stableStringify(obj));
}

/**
 * Build the start/end marker comments for a generated managed block.
 * @param {string} id block id (e.g. "tasks", "index-status")
 * @returns {{ start: string, end: string }}
 */
export function managedMarkers(id) {
  if (!/^[a-z0-9-]+$/.test(id)) throw new Error(`managedMarkers: invalid block id "${id}"`);
  return {
    start: `<!-- contextdevkit:generated:${id}:start -->`,
    end: `<!-- contextdevkit:generated:${id}:end -->`,
  };
}

/**
 * Idempotently set the inner content of a managed block inside `source`,
 * preserving everything outside the markers (ADR-0067). If the block is absent,
 * it is appended (with a separating blank line). Re-running with the same inner
 * content yields a byte-identical result.
 * @param {string} source full file content (may be empty)
 * @param {string} id managed-block id
 * @param {string} inner content to place between the markers (no markers)
 * @returns {string} the updated full content
 */
export function updateManagedBlock(source, id, inner) {
  const { start, end } = managedMarkers(id);
  const trimmedInner = inner.replace(/^\n+/, '').replace(/\n+$/, '');
  const block = `${start}\n${trimmedInner}\n${end}`;
  const startIdx = source.indexOf(start);
  const endIdx = source.indexOf(end);
  if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
    const before = source.slice(0, startIdx);
    const after = source.slice(endIdx + end.length);
    return `${before}${block}${after}`;
  }
  if (startIdx !== -1 || endIdx !== -1) {
    throw new Error(`updateManagedBlock: unbalanced markers for block "${id}"`);
  }
  const base = source.replace(/\n+$/, '');
  return base.length ? `${base}\n\n${block}\n` : `${block}\n`;
}

/**
 * Read the inner content of a managed block, or null when the block is absent.
 * @param {string} source
 * @param {string} id
 * @returns {string|null}
 */
export function readManagedBlock(source, id) {
  const { start, end } = managedMarkers(id);
  const startIdx = source.indexOf(start);
  const endIdx = source.indexOf(end);
  if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) return null;
  return source.slice(startIdx + start.length, endIdx).replace(/^\n+/, '').replace(/\n+$/, '');
}
