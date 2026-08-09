/**
 * path-classify.mjs — deterministic code-path classification (ADR-0128 §6).
 *
 * Extension is never sufficient: generated/vendor/build/fixtures are HARD
 * EXCLUSIONS that never start the full journey by themselves. Resolution order
 * (first match wins): hard exclusions → vendor → directory patterns → source
 * extension → documentation/config extension → Project-Map fallback → unknown.
 *
 * Pure: the rule table is INJECTED. Project Map is optional and only breaks ties
 * for an otherwise-unknown path. Zero runtime dependencies.
 *
 * @module domain-engineering/path-classify
 */

/**
 * Classifies one repo-relative path.
 *
 * @param {string} path repo-relative path (forward slashes).
 * @param {object} rules the path-rules table.
 * @param {object} [projectMap] optional project-map { sourcePaths?: string[] }.
 * @returns {{ pathClass: string, reasonCodes: string[], hardExcluded: boolean }}
 */
export function classifyPath(path, rules, projectMap) {
  const p = String(path ?? '').replace(/\\/g, '/').toLowerCase();
  if (!p || !rules) return { pathClass: 'unknown', reasonCodes: ['PATH_CLASS_RESOLVED'], hardExcluded: false };

  // 1. Hard exclusions — generated/build/fixtures/lockfiles.
  if (matchesExclusion(p, rules.hardExclusions)) {
    return { pathClass: rules.hardExclusions.classifyAs || 'generated', reasonCodes: ['PATH_HARD_EXCLUSION'], hardExcluded: true };
  }
  // 2. Vendor.
  if (rules.vendorPatterns && anyDirPattern(p, rules.vendorPatterns.dirPatterns)) {
    return { pathClass: rules.vendorPatterns.classifyAs || 'vendor', reasonCodes: ['PATH_HARD_EXCLUSION'], hardExcluded: true };
  }
  // 3. Directory patterns (test/migration/infra/contract/docs/config), in order.
  for (const group of rules.dirPatterns || []) {
    if (anyDirPattern(p, group.patterns)) {
      return { pathClass: group.classifyAs, reasonCodes: ['PATH_CLASS_RESOLVED'], hardExcluded: false };
    }
  }
  // 4. Source extension.
  if (endsWithAny(p, rules.sourceExtensions)) {
    return { pathClass: 'source-code', reasonCodes: ['PATH_CLASS_RESOLVED'], hardExcluded: false };
  }
  // 5. Documentation / configuration extension.
  if (endsWithAny(p, rules.documentationExtensions)) {
    return { pathClass: 'documentation', reasonCodes: ['PATH_CLASS_RESOLVED'], hardExcluded: false };
  }
  if (endsWithAny(p, rules.configExtensions)) {
    return { pathClass: 'configuration', reasonCodes: ['PATH_CLASS_RESOLVED'], hardExcluded: false };
  }
  // 6. Project-Map fallback — a path the map knows as source is source-code.
  if (projectMapKnowsSource(p, projectMap)) {
    return { pathClass: 'source-code', reasonCodes: ['PATH_CLASS_RESOLVED'], hardExcluded: false };
  }
  return { pathClass: rules.fallbackClass || 'unknown', reasonCodes: ['PATH_CLASS_RESOLVED'], hardExcluded: false };
}

/** True iff the path matches any hard-exclusion dir/suffix/exact rule. */
function matchesExclusion(p, exclusions) {
  if (!exclusions) return false;
  if (anyDirPattern(p, exclusions.dirPatterns)) return true;
  if (endsWithAny(p, exclusions.fileSuffixes)) return true;
  const base = p.split('/').pop();
  return Array.isArray(exclusions.exactFiles) && exclusions.exactFiles.includes(base);
}

/** True iff any pattern is a substring of the path. */
function anyDirPattern(p, patterns) {
  return Array.isArray(patterns) && patterns.some((pattern) => typeof pattern === 'string' && p.includes(pattern));
}

/** True iff the path ends with any of the suffixes. */
function endsWithAny(p, suffixes) {
  return Array.isArray(suffixes) && suffixes.some((suffix) => typeof suffix === 'string' && p.endsWith(suffix));
}

/** True iff the project map lists this path as a known source location. */
function projectMapKnowsSource(p, projectMap) {
  const sources = projectMap && Array.isArray(projectMap.sourcePaths) ? projectMap.sourcePaths : null;
  if (!sources) return false;
  return sources.some((sourcePath) => String(sourcePath).replace(/\\/g, '/').toLowerCase() === p);
}
