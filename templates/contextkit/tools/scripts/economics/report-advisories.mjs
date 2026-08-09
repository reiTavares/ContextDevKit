/**
 * EACP Wave 3 advisory surfacing seam for token-report.mjs (mirrors
 * token-report-cost.mjs). Builds and presents the session-pressure (#236) and
 * map-effectiveness (#237) advisory blocks. Advisory-only; degrades to
 * skipped() on any missing or invalid input — never fabricates a pass result
 * (constitution §8).
 *
 * Responsibility split:
 *   - normalizeToolUse(): maps a single raw transcript tool_use event to a
 *     normalized {tool, path?} event or null. Defensive against malformed input.
 *   - advisorySummary(): aggregates per-session pressure scores and map-
 *     effectiveness facts from the already-collected metadata.
 *   - presentAdvisories(): renders both advisory blocks as a multi-line string
 *     for the token-report table view.
 *
 * DETERMINISTIC: no Date.now() / Math.random() calls. All exported functions
 * are pure and reproducible given the same inputs.
 * Zero runtime dependencies: node:* or relative imports only.
 */

import { deriveSignals, pressureScore, PRESSURE_SCHEMA_VERSION } from './session-pressure.mjs';
import { readFacts } from './map-effectiveness.mjs';
import { resolvePrivacyConfig, skipped } from './privacy.mjs';

// ---------------------------------------------------------------------------
// Public: tool-use normalizer
// ---------------------------------------------------------------------------

/**
 * Maps one raw transcript tool_use item to a normalized tool event or null.
 *
 * Only tool kinds relevant to map-effectiveness analysis are emitted. Unknown
 * tool names or malformed inputs produce null so callers can safely filter.
 * Defensive against null/non-string name and missing/wrong-typed input fields.
 *
 * @param {string} name - The tool_use item's `name` field (e.g. 'Read', 'Glob').
 * @param {object|null|undefined} input - The tool_use item's `input` field.
 * @returns {{ tool: 'read'|'search'|'map', path?: string } | null}
 */
export function normalizeToolUse(name, input) {
  if (typeof name !== 'string') return null;

  switch (name) {
    case 'Read': {
      const fp = input?.file_path;
      if (typeof fp === 'string' && /project-map/i.test(fp)) {
        return { tool: 'map', path: fp };
      }
      return { tool: 'read', path: typeof fp === 'string' ? fp : undefined };
    }

    case 'Glob':
    case 'Grep': {
      const pattern = input?.pattern;
      return { tool: 'search', path: typeof pattern === 'string' ? pattern : undefined };
    }

    case 'Skill': {
      const skillName = input?.skill;
      if (typeof skillName === 'string' && /project-map/i.test(skillName)) {
        return { tool: 'map' };
      }
      return null;
    }

    case 'Bash': {
      const cmd = input?.command;
      if (typeof cmd === 'string' && /project-map/.test(cmd)) {
        return { tool: 'map' };
      }
      return null;
    }

    default:
      return null;
  }
}

// ---------------------------------------------------------------------------
// Internal: privacy resolution guard
// ---------------------------------------------------------------------------

/**
 * Resolves a privacy config from opts.privacy, handling both pre-resolved
 * objects (which have a boolean `redactPaths` field) and raw configs that
 * still need resolution. Falls back to resolvePrivacyConfig(null) for any
 * missing or unrecognized shape.
 *
 * @param {object|null|undefined} rawPrivacy - opts.privacy value from caller.
 * @returns {ReturnType<typeof resolvePrivacyConfig>} Resolved config.
 */
function resolvePrivacy(rawPrivacy) {
  // Already resolved if it has the boolean redactPaths sentinel.
  if (rawPrivacy !== null && rawPrivacy !== undefined && typeof rawPrivacy === 'object' && typeof rawPrivacy.redactPaths === 'boolean') {
    return rawPrivacy;
  }
  return resolvePrivacyConfig(rawPrivacy ?? null);
}

// ---------------------------------------------------------------------------
// Internal: pressure aggregator
// ---------------------------------------------------------------------------

/**
 * Scores all per-session rows and returns the aggregated pressure block.
 * Skips individual rows where pressureScore() returns a skipped marker.
 * Returns a skipped() marker when perSession is empty or non-array.
 *
 * @param {Array<object>} perSession - Per-session rows from token-report.
 * @returns {{ schemaVersion: string, sessions: number, bands: object, hottest: object|null }
 *   | Readonly<{ status: 'skipped', reason: string }>}
 */
function aggregatePressure(perSession) {
  if (!Array.isArray(perSession) || perSession.length === 0) {
    return skipped('no sessions to score');
  }

  const bands = { healthy: 0, elevated: 0, hot: 0, critical: 0 };
  let hottest = null;
  let scoredCount = 0;

  for (const row of perSession) {
    const result = pressureScore(deriveSignals(row));
    if (result?.status === 'skipped') continue;

    scoredCount += 1;
    const band = result.band;
    if (band in bands) bands[band] += 1;

    if (hottest === null || result.score > hottest.score) {
      // Spread the full pressureScore result and attach the originating sid.
      hottest = { ...result, sid: row.sid };
    }
  }

  return {
    schemaVersion: PRESSURE_SCHEMA_VERSION,
    sessions: scoredCount,
    bands,
    hottest,
  };
}

// ---------------------------------------------------------------------------
// Public: advisory summary
// ---------------------------------------------------------------------------

/**
 * Computes both advisory blocks — session pressure and map effectiveness —
 * from the token-report aggregated data.
 *
 * Input is intentionally loose: malformed or missing fields produce skipped()
 * markers for the affected advisory, not thrown errors (constitution §8).
 *
 * @param {{ perSession: Array<object>, toolEvents: Array<{tool:string, path?:string, ts?:number}> }} input
 *   - perSession: per-session rows as produced by token-report summarize().
 *   - toolEvents: normalized tool events accumulated during aggregate().
 * @param {{ privacy?: object }} [opts]
 *   - privacy: raw or pre-resolved privacy config; resolved defensively.
 * @returns {{ pressure: object, mapEffectiveness: object }}
 */
export function advisorySummary(input, opts) {
  const { perSession, toolEvents } = input ?? {};
  const resolvedPrivacy = resolvePrivacy(opts?.privacy);

  const pressure = aggregatePressure(perSession);
  const mapEffectiveness = readFacts(
    Array.isArray(toolEvents) ? toolEvents : [],
    { privacy: resolvedPrivacy },
  );

  return { pressure, mapEffectiveness };
}

// ---------------------------------------------------------------------------
// Public: table display
// ---------------------------------------------------------------------------

/**
 * Renders the two advisory blocks as a human-readable multi-line string for
 * the token-report table view. Handles skipped markers gracefully — never
 * surfaces a missing advisory as an error or a false pass.
 *
 * @param {{ pressure: object, mapEffectiveness: object }} summary
 *   - Output of advisorySummary().
 * @returns {string} Multi-line display string (no trailing newline).
 */
export function presentAdvisories(summary) {
  const lines = [];

  // --- Session pressure block ---
  const pressure = summary?.pressure;
  if (pressure?.status === 'skipped') {
    lines.push(`Session pressure: skipped (${pressure.reason})`);
  } else if (pressure != null) {
    const h = pressure.hottest;
    const sessionsLabel = `${pressure.sessions} session(s) scored`;
    const bandLabel = h != null ? `${h.band} band, score ${h.score}/100` : 'no band';
    lines.push(`Session pressure (advisory): ${bandLabel} (${sessionsLabel})`);

    if (h?.splitRecommended && Array.isArray(h.recommendations) && h.recommendations.length > 0) {
      lines.push('  split suggested:');
      for (const rec of h.recommendations) {
        lines.push(`    ${rec}`);
      }
    }
  } else {
    lines.push('Session pressure: skipped (no data)');
  }

  // --- Map effectiveness block ---
  const mapEff = summary?.mapEffectiveness;
  if (mapEff?.status === 'skipped') {
    lines.push(`Map effectiveness: skipped (${mapEff.reason})`);
  } else if (mapEff != null) {
    lines.push('Map effectiveness (advisory):');
    const facts = Array.isArray(mapEff.observedFacts) ? mapEff.observedFacts : [];
    for (const fact of facts) {
      lines.push(`  • ${fact}`);
    }
  } else {
    lines.push('Map effectiveness: skipped (no data)');
  }

  return lines.join('\n');
}
