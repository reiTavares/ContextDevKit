/**
 * Deterministic registry serialization (BIZ-0001 / WF-0036, A1-T3).
 *
 * Single source for how every generated registry is rendered to bytes so a
 * rebuild from disk is byte-identical (source-of-truth-policy §"Indexes":
 * generated, sorted, rebuildable, byte-idempotent). Pure `node:*`, zero deps.
 *
 * Determinism contract:
 *  - object keys are emitted in a stable, recursively-sorted order;
 *  - 2-space indentation (matches the kit's other JSON artifacts);
 *  - exactly one trailing newline.
 */

/**
 * Recursively sorts object keys so JSON.stringify produces a stable byte layout
 * regardless of insertion order. Arrays keep their order (callers sort entries
 * explicitly by a domain key such as `id`); primitives pass through unchanged.
 *
 * @param {unknown} value - any JSON-serializable value.
 * @returns {unknown} a key-sorted clone (arrays preserved in order).
 */
export function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    const sorted = {};
    for (const key of Object.keys(value).sort()) sorted[key] = sortKeysDeep(value[key]);
    return sorted;
  }
  return value;
}

/**
 * Serializes a registry object to its canonical, byte-idempotent string form.
 * Keys are recursively sorted; output is 2-space indented with one trailing
 * newline. Feeding the parsed result back in yields the identical string.
 *
 * @param {object} registry - the registry payload to render.
 * @returns {string} canonical JSON text (trailing newline included).
 */
export function serializeRegistry(registry) {
  return `${JSON.stringify(sortKeysDeep(registry), null, 2)}\n`;
}
