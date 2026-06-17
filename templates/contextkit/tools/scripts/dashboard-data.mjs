/**
 * Dashboard data reader — single owner of "read the project's current
 * state into a structured object" (ticket 051).
 *
 * Every consumer (the snapshot generator and the live `--watch` server)
 * goes through `buildDashboardData(root)`. Files are re-read on each
 * call; there is no caching — the data object is the snapshot.
 *
 * Zero deps. YAML frontmatter is parsed with a small inline parser
 * (key: value pairs only — the kit's tickets/ADRs do not use nested
 * YAML).
 *
 * Single-sourced paths via `paths.mjs` per rule 4.
 *
 * EACP-15 extension (card #244): exports `buildEconomicDashboardData()`
 * which surfaces economic summaries (financial, quota, autonomy, routing,
 * advisories) for the dashboard panel. Privacy: per-repo consent, k-anon,
 * metadata-only. Depends on economic-report.mjs (pure aggregator).
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, resolve } from 'node:path';
import {
  PLATFORM_DIR,
  MEMORY_DIR,
  DECISIONS_DIR,
  SESSIONS_DIR,
  CHANGELOG,
  CONFIG_FILE,
} from '../../runtime/config/paths.mjs';
import {
  buildRepoEconomicSummary,
  buildTrendSlice,
  aggregateFleetEconomics,
  ECONOMIC_REPORT_SCHEMA_VERSION,
  MIN_COHORT_SIZE,
} from './economics/economic-report.mjs';

const PIPELINE_DIR = `${PLATFORM_DIR}/pipeline`;
const ROADMAP_FILE = `${MEMORY_DIR}/roadmap.md`;
const LANES = ['backlog', 'working', 'testing', 'conclusion'];

/** Strip a leading UTF-8 BOM if present (rule 4). */
const stripBom = (s) => s.replace(/^﻿/, '');

/** Read a file as utf-8; returns '' on any failure (defensive — rule 2). */
function readSafe(path) {
  try { return stripBom(readFileSync(path, 'utf-8')); } catch { return ''; }
}

/**
 * Parse YAML-frontmatter from a markdown file's text.
 *
 * @param {string} text
 * @returns {{ data: Record<string, string>, body: string }}
 */
export function parseFrontmatter(text) {
  if (!text.startsWith('---')) return { data: {}, body: text };
  const end = text.indexOf('\n---', 4);
  if (end === -1) return { data: {}, body: text };
  const raw = text.slice(4, end).trim();
  const body = text.slice(end + 4).replace(/^\n/, '');
  const data = {};
  for (const line of raw.split('\n')) {
    const m = /^([\w-]+):\s*(.*)$/.exec(line);
    if (m) data[m[1]] = m[2].trim();
  }
  return { data, body };
}

function readTicket(lane, file, dir) {
  const text = readSafe(resolve(dir, file));
  const { data, body } = parseFrontmatter(text);
  const lines = body.split('\n').filter((l) => l.trim().length > 0);
  const firstHeading = lines.find((l) => l.startsWith('## ')) || '';
  const bodyExcerpt = (firstHeading ? body.split(firstHeading)[1] || '' : body).slice(0, 280).trim();
  return {
    id: data.id || file.slice(0, 3),
    title: data.title || firstHeading.replace(/^##\s+/, '') || file.replace(/\.md$/, ''),
    type: data.type || '',
    priority: data.priority || '',
    sla: data.sla || '',
    status: data.status || lane,
    source: data.source || '',
    bodyExcerpt,
    file: `${PIPELINE_DIR}/${lane}/${file}`,
    lane,
  };
}

function readLane(lane, root) {
  const dir = resolve(root, PIPELINE_DIR, lane);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md') && !f.startsWith('.'))
    .map((file) => readTicket(lane, file, dir))
    .sort((a, b) => a.id.localeCompare(b.id));
}

function readPipeline(root) {
  const out = {};
  for (const lane of LANES) out[lane] = readLane(lane, root);
  return out;
}

function readAdrs(root) {
  const dir = resolve(root, DECISIONS_DIR);
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
        file: `${DECISIONS_DIR}/${file}`,
      };
    })
    .sort((a, b) => b.number.localeCompare(a.number));
}

function readSessions(root, limit = 10) {
  const dir = resolve(root, SESSIONS_DIR);
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
        file: `${SESSIONS_DIR}/${file}`,
      };
    })
    .sort((a, b) => b.number.localeCompare(a.number, undefined, { numeric: true }))
    .slice(0, limit);
}

function readRoadmap(root) {
  const text = readSafe(resolve(root, ROADMAP_FILE));
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
  const config = readConfig(root);
  const pipeline = readPipeline(root);
  return {
    meta: {
      project: basename(root),
      branch: readBranch(root),
      level: config?.level ?? null,
      platformDir: PLATFORM_DIR,
      generatedAt: Date.now(),
    },
    pipeline,
    counts: {
      backlog: pipeline.backlog.length,
      working: pipeline.working.length,
      testing: pipeline.testing.length,
      conclusion: pipeline.conclusion.length,
    },
    adrs: readAdrs(root),
    sessions: readSessions(root),
    roadmap: readRoadmap(root),
    changelogUnreleased: readChangelogUnreleased(root),
  };
}

export const DASHBOARD_LANES = LANES;

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
