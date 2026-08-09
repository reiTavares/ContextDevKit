#!/usr/bin/env node
/**
 * Compares explicit blast-radius predictions with the current Git diff. It does
 * not read a session ledger or infer that every changed file belongs to a hidden
 * session authority. Dry-run is the default; `--write` updates prediction files.
 */
import { spawnSync } from 'node:child_process';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathsFor } from '../../runtime/config/paths.mjs';
import { writeFileAtomic } from '../../runtime/hooks/safe-io.mjs';

const ROOT = process.cwd();
const PREDICTIONS_PREFIX = 'contextkit/memory/predictions/';

/** @param {string[]} argumentsList @returns {string[]} */
function gitPathList(argumentsList) {
  try {
    const response = spawnSync('git', argumentsList, {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 5000,
      maxBuffer: 4 * 1024 * 1024,
    });
    if (response.status !== 0) return [];
    return String(response.stdout ?? '').split('\0').filter(Boolean);
  } catch {
    return [];
  }
}

/** @returns {string[]} */
export function actualChangedPaths() {
  return [...new Set([
    ...gitPathList(['diff', '--name-only', '-z', 'HEAD']),
    ...gitPathList(['ls-files', '--others', '--exclude-standard', '-z']),
  ])]
    .map((path) => path.replaceAll('\\', '/'))
    .filter((path) => path && !path.startsWith(PREDICTIONS_PREFIX))
    .sort();
}

/** @param {string} coveredEntry @param {string} actualPath @returns {boolean} */
function covers(coveredEntry, actualPath) {
  return coveredEntry.endsWith('/') ? actualPath.startsWith(coveredEntry) : actualPath === coveredEntry;
}

/** @param {string} content @returns {string[]} */
export function readCoveredPaths(content) {
  const raw = /^- \*\*Covered paths\*\*:\s*(.+)$/m.exec(content)?.[1] ?? '';
  if (!raw || raw === '—') return [];
  return raw.split(',').map((path) => path.trim()).filter(Boolean);
}

/** @param {string[]} paths @returns {string} */
function formatPaths(paths) {
  return paths.length ? paths.map((path) => `\`${path}\``).join(', ') : '— none';
}

/** @param {string[]} covered @param {string[]} actual @param {string} date @returns {string} */
export function renderActualSection(covered, actual, date) {
  const predictedHit = covered.filter((entry) => actual.some((path) => covers(entry, path)));
  const predictedMiss = covered.filter((entry) => !actual.some((path) => covers(entry, path)));
  const unforeseen = actual.filter((path) => !covered.some((entry) => covers(entry, path)));
  return [
    `## Actual (reviewed ${date})`,
    '',
    `- **Paths changed in the current Git diff**: ${formatPaths(actual)}`,
    `- **Predicted and changed**: ${formatPaths(predictedHit)}`,
    `- **Predicted but not changed**: ${formatPaths(predictedMiss)}`,
    `- **Changed but not predicted**: ${formatPaths(unforeseen)}`,
    '- **Risk accuracy**: _record the evidence-backed assessment here_',
    '',
  ].join('\n');
}

/** @param {string} content @param {string} section @returns {string} */
function replaceActualSection(content, section) {
  return /^## Actual/m.test(content)
    ? content.replace(/^## Actual[\s\S]*$/m, section)
    : `${content.trimEnd()}\n\n${section}`;
}

async function main() {
  const write = process.argv.includes('--write');
  const requestedId = process.argv.slice(2).find((argument) => argument !== '--write') ?? null;
  const directory = pathsFor(ROOT).predictions;
  let filenames = [];
  try {
    filenames = (await readdir(directory)).filter((filename) => filename.endsWith('.md')).sort();
  } catch {
    console.log('No prediction files to review.');
    return;
  }
  if (requestedId) filenames = filenames.filter((filename) => filename === requestedId || filename === `${requestedId}.md`);

  const actual = actualChangedPaths();
  const date = new Date().toISOString().slice(0, 10);
  const reviews = [];
  for (const filename of filenames) {
    const absolutePath = resolve(directory, filename);
    const content = await readFile(absolutePath, 'utf8');
    if (!/^## Actual — fill on review$/m.test(content) && !requestedId) continue;
    const covered = readCoveredPaths(content);
    reviews.push({ filename, covered });
    if (write) await writeFileAtomic(absolutePath, replaceActualSection(content, renderActualSection(covered, actual, date)));
  }

  if (!reviews.length) {
    console.log('No unreviewed predictions matched.');
    return;
  }
  console.log(JSON.stringify({ status: write ? 'written' : 'dry-run', actual, reviews }, null, 2));
  if (!write) console.log('Re-run with --write to close the reviewed prediction loop.');
}

main().catch((error) => {
  console.error(`predictions-review failed: ${error?.message ?? error}`);
  process.exitCode = 1;
});
