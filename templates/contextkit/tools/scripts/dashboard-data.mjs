/**
 * Dashboard data reader — single owner of "read the project's current
 * state into a structured object" (ticket 051).
 *
 * Every consumer (the snapshot generator and the live `--watch` server)
 * goes through `buildDashboardData(root)`. Files are re-read on each
 * call; there is no caching — the data object is the snapshot.
 *
 * Task state is read only through the validated v4 JSON authorities. Missing or
 * corrupt documents are surfaced in the snapshot diagnostics.
 *
 * Single-sourced paths via `paths.mjs` per rule 4.
 *
 * EACP-15 extension (card #244): exports `buildEconomicDashboardData()`
 * which surfaces economic summaries (financial, quota, autonomy, routing,
 * advisories) for the dashboard panel. Privacy: per-repo consent, k-anon,
 * metadata-only. Depends on economic-report.mjs (pure aggregator).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import {
  PLATFORM_DIR,
  CHANGELOG,
  CONFIG_FILE,
  pathsFor,
} from '../../runtime/config/paths.mjs';
import { readAuthoritySnapshot, TASK_STATUSES } from '../../runtime/authority-reader.mjs';
import { resolveGovernanceMatrix } from '../../runtime/governance/gate-mode.mjs';
import {
  buildRepoEconomicSummary,
  buildTrendSlice,
  aggregateFleetEconomics,
  ECONOMIC_REPORT_SCHEMA_VERSION,
  MIN_COHORT_SIZE,
} from './economics/economic-report.mjs';

/** Strip a leading UTF-8 BOM if present (rule 4). */
const stripBom = (s) => s.replace(/^﻿/, '');

/** Read a file as utf-8; returns '' on any failure (defensive — rule 2). */
function readSafe(path) {
  try { return stripBom(readFileSync(path, 'utf-8')); } catch { return ''; }
}

function readAdrs(paths) {
  const dir = paths.decisions;
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^\d{4}-.+\.md$/.test(f))
    .map((file) => {
      const text = readSafe(resolve(dir, file));
      const number = file.slice(0, 4);
      const titleMatch = /^#\s+ADR-\d+:\s*(.+)$/m.exec(text);
      const statusMatch = /^-\s*\*\*Status\*\*:\s*(.+)$/m.exec(text);
      const dateMatch = /^-\s*\*\*Date\*\*:\s*(.+)$/m.exec(text);
      return {
        number,
        title: titleMatch ? titleMatch[1].trim() : file.replace(/^\d{4}-/, '').replace(/\.md$/, ''),
        status: statusMatch ? statusMatch[1].trim() : 'Unknown',
        date: dateMatch ? dateMatch[1].trim() : '',
        file: resolve(dir, file),
      };
    })
    .sort((a, b) => b.number.localeCompare(a.number));
}

function readSessions(paths, limit = 10) {
  const dir = paths.sessions;
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => /^\d{4}-\d{2}-\d{2}-\d{2,}-.+\.md$/.test(f))
    .map((file) => {
      const text = readSafe(resolve(dir, file));
      const dateMatch = /^-\s*\*\*Date\*\*:\s*(.+)$/m.exec(text);
      const numMatch = /^-\s*\*\*Session number\*\*:\s*(.+)$/m.exec(text);
      const branchMatch = /^-\s*\*\*Branch\*\*:\s*`?([^`\n]+)`?$/m.exec(text);
      const titleMatch = /^#\s+(.+)$/m.exec(text);
      return {
        number: numMatch ? numMatch[1].trim() : file.split('-')[3] || '',
        title: titleMatch ? titleMatch[1].trim() : file.replace(/\.md$/, ''),
        date: dateMatch ? dateMatch[1].trim() : file.slice(0, 10),
        branch: branchMatch ? branchMatch[1].trim() : '',
        file: resolve(dir, file),
      };
    })
    .sort((a, b) => b.number.localeCompare(a.number, undefined, { numeric: true }))
    .slice(0, limit);
}

function readRoadmap(paths) {
  const text = readSafe(paths.roadmap);
  return { exists: text.length > 0, markdown: text };
}

function readChangelogUnreleased(root) {
  const text = readSafe(resolve(root, CHANGELOG));
  const idx = text.indexOf('## [Unreleased]');
  if (idx === -1) return '';
  const after = text.slice(idx + '## [Unreleased]'.length);
  const next = after.search(/\n## \[/);
  return (next === -1 ? after : after.slice(0, next)).trim();
}

function readConfig(root) {
  try {
    return JSON.parse(stripBom(readFileSync(resolve(root, CONFIG_FILE), 'utf-8')));
  } catch { return null; }
}

function readBranch(root) {
  try {
    return execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: root, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'], timeout: 2000,
    }).trim();
  } catch { return ''; }
}

/**
 * Build the full dashboard data object.
 *
 * @param {string} root  project root (absolute)
 * @returns {object}     plain JS data object — no Dates, no functions
 */
export function buildDashboardData(root) {
  const paths = pathsFor(root);
  const config = readConfig(root);
  const taskAuthority = readAuthoritySnapshot(root);
  let governance = null;
  try {
    governance = resolveGovernanceMatrix(config ?? {});
  } catch (error) {
    governance = {
      status: 'unavailable',
      failurePolicy: 'continue',
      error: typeof error?.message === 'string' ? error.message : 'Governance matrix unavailable.',
    };
  }
  return {
    meta: {
      project: basename(root),
      branch: readBranch(root),
      level: config?.level ?? null,
      platformDir: PLATFORM_DIR,
      generatedAt: Date.now(),
    },
    authority: {
      kind: taskAuthority.authority,
      status: taskAuthority.status,
      diagnostics: taskAuthority.diagnostics,
    },
    workflows: taskAuthority.workflows,
    batches: taskAuthority.batches,
    tasks: taskAuthority.tasksByStatus,
    counts: taskAuthority.counts,
    governance,
    adrs: readAdrs(paths),
    sessions: readSessions(paths),
    roadmap: readRoadmap(paths),
    changelogUnreleased: readChangelogUnreleased(root),
  };
}

export const DASHBOARD_TASK_STATUSES = TASK_STATUSES;

// ---------------------------------------------------------------------------
// EACP-15 / card #244 — Economic dashboard data builder
// ---------------------------------------------------------------------------

/**
 * Builds the §13.4 economic panel data for the dashboard.
 *
 * Pure composer: accepts pre-computed EACP module summaries and delegates to
 * economic-report.mjs (per-repo + trend) and economic-report-fleet.mjs (fleet).
 * No fs reads, Date.now() calls, or HTML production.
 *
 * Surfaces: economicSummary (=perProject), costTrend, contextHealthTrend,
 * autonomyTrend, fleet (cross-repo k-anon), schemaVersion, provenance notes.
 * Metadata-only export is available via buildExportPackage() from economic-report.mjs.
 *
 * Privacy: consent enforced per-repo (ADR-0081); unconsented → explicit skip,
 * never silently excluded. Fleet withheld below MIN_COHORT_SIZE (k-anonymity).
 *
 * @param {{
 *   repoId: string, config: object|null,
 *   financial?: object|null, quota?: object|null,
 *   multiplier?: object|null, routing?: object|null,
 *   pressure?: object|null, mapEffectiveness?: object|null,
 *   costPeriods?: Array<object>, contextHealthPeriods?: Array<object>,
 *   autonomyPeriods?: Array<object>, fleetSummaries?: Array<object>,
 *   nowMs?: number,
 * }} input
 * @returns {Readonly<object>}
 */
export function buildEconomicDashboardData(input) {
  const {
    repoId, config,
    financial = null, quota = null, multiplier = null,
    routing = null, pressure = null, mapEffectiveness = null,
    costPeriods = [], contextHealthPeriods = [],
    autonomyPeriods = [], fleetSummaries = [],
    nowMs,
  } = input ?? {};

  // Consent-gated per-repo summary; explicit skip when not consented.
  const economicSummary = buildRepoEconomicSummary({
    repoId, config, financial, quota, multiplier,
    routing, pressure, mapEffectiveness, nowMs,
  });

  // Trend slices — skipped() when no period data available.
  const costTrend          = buildTrendSlice(costPeriods);
  const contextHealthTrend = buildTrendSlice(contextHealthPeriods);
  const autonomyTrend      = buildTrendSlice(autonomyPeriods);

  // Cross-repo fleet (k-anon; aggregates withheld below MIN_COHORT_SIZE).
  const fleet = aggregateFleetEconomics(fleetSummaries);

  return Object.freeze({
    schemaVersion: ECONOMIC_REPORT_SCHEMA_VERSION,
    minCohortSize: MIN_COHORT_SIZE,
    generatedAt: typeof nowMs === 'number' ? nowMs : null,
    economicSummary,
    perProject: economicSummary,
    costTrend,
    contextHealthTrend,
    autonomyTrend,
    fleet,
    provenance: {
      usdNote: 'USD is estimated API-equivalent; subscription billing is not metered. Original USD always shown.',
      confidenceNote: 'Confidence reflects price-lookup quality: direct > inferred > unknown.',
      skippedNote: 'Skipped entries represent unconsented or unavailable data — never silently excluded.',
    },
  });
}
