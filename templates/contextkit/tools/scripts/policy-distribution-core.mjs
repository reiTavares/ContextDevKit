/**
 * policy-distribution-core.mjs — Pure additive-diff math for CDK-082 (PKG-08).
 *
 * Computes — without any I/O — which keys a baseline policy object WOULD ADD to
 * a target policy object and which keys are already present (untouched). Mirrors
 * the additive semantics of config-migrate.mjs#migrateConfigSections: user values
 * in the target always win; only MISSING top-level keys (or nested paths) are
 * flagged as `wouldAdd`.
 *
 * Algorithm (dot-path additive diff):
 *   - Walk every key in `baseline`. If the key is absent from `target`, record
 *     the entire dot-path as `wouldAdd` (do NOT descend further — the whole
 *     subtree would be distributed as a unit, matching migrateConfigSections).
 *   - If the key IS present in `target`, recurse into nested objects to find any
 *     deeper missing paths. Keys present in both ≥ at the current level land in
 *     `untouched` (leaf or equal-path wins rule).
 *   - Arrays are leaves — never recursed. An array key absent from target goes
 *     into `wouldAdd`; present goes into `untouched`.
 *
 * No I/O. No dependencies. Safe for unit-testing in isolation.
 *
 * Advisory, fail-open, UNREGISTERED, READ-ONLY, DRY-RUN. ADR-0072 / CDK-082.
 */

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Returns true when the value should be treated as a leaf (not recursed into).
 * Arrays are leaves; non-plain objects (Date, null, etc.) are also leaves.
 *
 * @param {unknown} value
 * @returns {boolean}
 */
function isLeaf(value) {
  if (value === null || typeof value !== 'object') return true;
  if (Array.isArray(value)) return true;
  // Plain object only — skip class instances.
  return Object.getPrototypeOf(value) !== Object.prototype
    && Object.getPrototypeOf(value) !== null;
}

/**
 * Recursive dot-path walker.
 * Mutates `wouldAdd` and `untouched` accumulators in place.
 *
 * @param {object} baseline     Baseline sub-object being walked.
 * @param {object|null} target  Corresponding target sub-object (null = entirely missing).
 * @param {string} prefix       Current dot-path prefix (empty string at root).
 * @param {string[]} wouldAdd   Accumulator for missing dot-paths.
 * @param {string[]} untouched  Accumulator for present dot-paths.
 */
function walkDiff(baseline, target, prefix, wouldAdd, untouched) {
  const baseKeys = Object.keys(baseline);
  for (const key of baseKeys) {
    const dotPath = prefix ? `${prefix}.${key}` : key;
    const baseVal = baseline[key];

    if (target === null || target === undefined || !Object.prototype.hasOwnProperty.call(target, key)) {
      // Entire key (and its subtree) is missing from target → would be added as a unit.
      wouldAdd.push(dotPath);
      continue;
    }

    const targetVal = target[key];

    // Key is present in both. If baseline value is a plain object (not a leaf),
    // recurse to find any deeper missing paths.
    if (!isLeaf(baseVal) && !isLeaf(targetVal)) {
      walkDiff(baseVal, targetVal, dotPath, wouldAdd, untouched);
    } else {
      // Leaf present in both → untouched (user value wins, no change planned).
      untouched.push(dotPath);
    }
  }
}

// ---------------------------------------------------------------------------
// Public export
// ---------------------------------------------------------------------------

/**
 * Computes the additive distribution plan between two policy store objects.
 *
 * Rules:
 * - Keys present in `baseline` but ABSENT from `target` → `wouldAdd` (whole subtree).
 * - Keys present in BOTH → `untouched` (user value always wins — never in `wouldAdd`).
 * - Keys only in `target` are irrelevant (target-only keys are ignored).
 *
 * @param {object} baseline The kit's baseline policy object.
 * @param {object} target   The installed project's current policy object.
 * @returns {{ wouldAdd: string[], untouched: string[] }}
 */
export function additivePlan(baseline, target) {
  if (!baseline || typeof baseline !== 'object' || Array.isArray(baseline)) {
    return { wouldAdd: [], untouched: [] };
  }

  const wouldAdd = /** @type {string[]} */ ([]);
  const untouched = /** @type {string[]} */ ([]);

  const safeTarget = (target && typeof target === 'object' && !Array.isArray(target))
    ? target
    : null;

  walkDiff(baseline, safeTarget, '', wouldAdd, untouched);

  return { wouldAdd, untouched };
}

/**
 * Derives a version delta label from two nullable version numbers.
 *
 * @param {number|null} baselineVersion
 * @param {number|null} targetVersion
 * @returns {'newer'|'same'|'older'|'unknown'}
 */
export function versionDelta(baselineVersion, targetVersion) {
  if (baselineVersion === null || baselineVersion === undefined
    || targetVersion === null || targetVersion === undefined) {
    return 'unknown';
  }
  if (baselineVersion > targetVersion) return 'newer';
  if (baselineVersion === targetVersion) return 'same';
  return 'older';
}

// ---------------------------------------------------------------------------
// Direct-load guard (not a full CLI — confirms the module loads cleanly)
// ---------------------------------------------------------------------------
if (process.argv[1] && process.argv[1].endsWith('policy-distribution-core.mjs')) {
  console.log('[policy-distribution-core] loaded OK — CDK-082 pure diff module.');
  process.exit(0);
}
