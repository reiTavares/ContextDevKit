/**
 * Config-section auto-migration for `npx contextdevkit --update`.
 *
 * When a project installed with an OLDER ContextDevKit runs `--update`, this
 * module additively merges NEW default config sections (e.g. the `routing:`
 * block shipped in 3.0.0) into the project's saved `contextkit/config.json`,
 * WITHOUT ever clobbering a user's existing value.
 *
 * Design constraints (ADR-0095):
 *   - Clone-not-mutate: inputs are never modified; `defaults` may be frozen.
 *   - Additive-only: existing user values survive verbatim (primitives, arrays,
 *     or any type mismatch against the default).
 *   - Dot-path recording at the HIGHEST missing node: if "routing" is absent we
 *     record "routing", not all of its children.  If the parent is present but a
 *     nested key is absent (e.g. cfg.qa exists but cfg.qa.criticalPaths is
 *     missing) we record "qa.criticalPaths".
 *   - Arrays are leaves: never merged element-wise.  A missing array key copies
 *     the default array (cloned); a present one stays.
 *   - Idempotent: running twice on the same object produces no further additions.
 *   - Zero runtime dependencies.
 *
 * @module config-migrate
 */

/**
 * Returns true when `value` is a plain object (not null, not Array, not Date,
 * not any other built-in).  Used to decide whether a key pair should recurse or
 * be treated as a leaf.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

/**
 * Recursively walks `defaultSubtree` and copies any key that is MISSING from
 * `targetSubtree` (deep-cloned).  When both sides have a plain-object value the
 * function recurses instead of replacing.  Records the dot-path of the HIGHEST
 * missing ancestor (not every missing leaf beneath it).
 *
 * @param {Record<string, unknown>} targetSubtree  - mutable clone being built up
 * @param {Record<string, unknown>} defaultSubtree - frozen-safe defaults source
 * @param {string}                  parentPath     - dot-joined path to this node
 * @param {string[]}                addedPaths     - accumulator for recorded paths
 * @returns {void}
 */
function mergeSubtree(targetSubtree, defaultSubtree, parentPath, addedPaths) {
  for (const key of Object.keys(defaultSubtree)) {
    const dotPath = parentPath ? `${parentPath}.${key}` : key;
    const defaultValue = defaultSubtree[key];

    if (!Object.prototype.hasOwnProperty.call(targetSubtree, key)) {
      // Key is entirely missing — copy the whole subtree and record the path.
      targetSubtree[key] = structuredClone(defaultValue);
      addedPaths.push(dotPath);
      continue;
    }

    const targetValue = targetSubtree[key];

    // Both sides are plain objects → recurse (may add nested keys).
    if (isPlainObject(targetValue) && isPlainObject(defaultValue)) {
      mergeSubtree(targetValue, defaultValue, dotPath, addedPaths);
      continue;
    }

    // Type mismatch, array, primitive, null on either side → keep user's value.
    // (Arrays are leaves per ADR-0095; never merge element-wise.)
  }
}

/**
 * Additively merges new default config sections into a project's saved config.
 *
 * Keys present in `cfg` are NEVER overwritten, regardless of type.  Only keys
 * that are entirely absent (at any nesting depth) are added from `defaults`.
 * Arrays, primitives, and null values are treated as opaque leaves.
 *
 * @param {Record<string, unknown>} cfg      - the project's existing config object
 * @param {Record<string, unknown>} defaults - the kit's current default config
 * @returns {{ cfg: Record<string, unknown>, added: string[] }}
 *   `cfg`   — a deep-cloned, merged config (input is never mutated).
 *   `added` — dot-paths of the highest-level keys that were added; empty when
 *             nothing was missing (idempotent: re-running adds nothing).
 */
export function migrateConfigSections(cfg, defaults) {
  if (!isPlainObject(defaults)) {
    return { cfg: structuredClone(cfg), added: [] };
  }

  const clonedCfg = structuredClone(cfg);
  const addedPaths = [];

  mergeSubtree(clonedCfg, defaults, '', addedPaths);

  return { cfg: clonedCfg, added: addedPaths };
}
