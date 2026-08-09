#!/usr/bin/env node
/**
 * Compact read-only status line backed exclusively by v4 JSON authority.
 *
 * This process never writes, never requires Git, and never interprets a missing
 * or corrupt authority as a successful empty state.
 */
import { existsSync, readdirSync } from 'node:fs';
import { pathsFor } from './config/paths.mjs';
import { readJsonSafe } from './hooks/safe-io.mjs';
import { readAuthoritySnapshot } from './authority-reader.mjs';
import { resolveGovernanceMatrix } from './governance/gate-mode.mjs';

/** Count matching direct children without throwing. */
function countFiles(directory, pattern) {
  try {
    return readdirSync(directory).filter((filename) => pattern.test(filename)).length;
  } catch {
    return 0;
  }
}

/**
 * Renders the effective governance matrix without reproducing registry defaults.
 *
 * @param {object|null} governanceMatrix resolved W01 matrix
 * @returns {string}
 */
export function computeGovernanceSegment(governanceMatrix) {
  if (!governanceMatrix || typeof governanceMatrix !== 'object') return '⚠ governance unavailable';
  const counts = governanceMatrix.counts;
  if (!counts || typeof counts !== 'object') return '⚠ governance unavailable';
  return `g:${Number(counts.guarded ?? 0)} c:${Number(counts.canary ?? 0)} s:${Number(counts.shadow ?? 0)}`;
}

/**
 * Renders task activity while preserving corrupt/partial authority explicitly.
 *
 * @param {object|null} authoritySnapshot canonical authority projection
 * @returns {string}
 */
export function computeTaskSegment(authoritySnapshot) {
  if (!authoritySnapshot || authoritySnapshot.status === 'unavailable') return '⚠ tasks unavailable';
  if (authoritySnapshot.status === 'corrupt') return '⚠ tasks corrupt';
  const counts = authoritySnapshot.counts ?? {};
  const parts = [
    Number(counts.working ?? 0) > 0 ? `${counts.working} working` : null,
    Number(counts.blocked ?? 0) > 0 ? `${counts.blocked} blocked` : null,
    Number(counts.testing ?? 0) > 0 ? `${counts.testing} testing` : null,
  ].filter(Boolean);
  if (authoritySnapshot.status === 'partial') parts.push('⚠ partial');
  return parts.length > 0 ? parts.join('/') : '0 active';
}

/** Runs the fail-safe status-line projection for the current project. */
function main() {
  const root = process.cwd();
  const projectPaths = pathsFor(root);
  try {
    if (!existsSync(projectPaths.platform)) {
      process.stdout.write('🌀 contextdevkit');
      return;
    }
    const config = readJsonSafe(projectPaths.config, {});
    const levelValue = Number(config.level);
    const level = Number.isInteger(levelValue) ? `L${levelValue}` : null;
    const sessionCount = countFiles(projectPaths.sessions, /^\d{4}-\d{2}-\d{2}-\d{2,}-.+\.md$/);
    const decisionCount = countFiles(projectPaths.decisions, /\.md$/);
    const authority = readAuthoritySnapshot(root);
    let governance = null;
    try {
      governance = resolveGovernanceMatrix(config);
    } catch {
      governance = null;
    }
    const parts = [
      level,
      `${sessionCount} sess`,
      `${decisionCount} ADR`,
      computeTaskSegment(authority),
      computeGovernanceSegment(governance),
    ].filter(Boolean);
    process.stdout.write(`🌀 ${parts.join(' · ')}`);
  } catch {
    process.stdout.write('🌀 contextdevkit · ⚠ authority unavailable');
  }
}

const isMain = process.argv[1]
  ? new URL(import.meta.url).pathname.toLowerCase()
    === new URL(`file:///${process.argv[1].replaceAll('\\', '/')}`).pathname.toLowerCase()
  : false;

if (isMain) main();
