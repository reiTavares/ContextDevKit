#!/usr/bin/env node
/**
 * Materializes one explicit blast-radius prediction without creating a session
 * ledger, marker, bypass, or alternate work authority.
 *
 * Dry-run is the default. Pass `--write` only after the prediction content was
 * reviewed by the caller.
 */
import { mkdir } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { pathsFor } from '../../runtime/config/paths.mjs';
import { writeFileAtomic } from '../../runtime/hooks/safe-io.mjs';

const ROOT = process.cwd();
const SESSION_ENV_KEYS = Object.freeze([
  'CONTEXTKIT_SESSION_ID',
  'CODEX_THREAD_ID',
  'CLAUDE_SESSION_ID',
  'ANTIGRAVITY_SESSION_ID',
  'AGY_SESSION_ID',
  'GROK_SESSION_ID',
]);

/** @param {string} value @returns {string} */
function slugify(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 48) || 'prediction';
}

/** @param {NodeJS.ProcessEnv|Record<string,string|undefined>} environment @returns {string} */
function explicitRunIdentity(environment = process.env) {
  for (const key of SESSION_ENV_KEYS) {
    if (typeof environment[key] === 'string' && environment[key].trim()) return environment[key].trim();
  }
  return `manual-${process.pid}`;
}

/**
 * Converts a requested file or directory to a contained repo-relative path.
 * @param {string} requestedPath
 * @returns {string}
 * @throws {Error} when the path escapes the project root
 */
export function normalizeCoveredPath(requestedPath) {
  const trailingSlash = /[\\/]$/.test(requestedPath);
  const absolutePath = isAbsolute(requestedPath) ? resolve(requestedPath) : resolve(ROOT, requestedPath);
  const relativePath = relative(ROOT, absolutePath);
  if (relativePath === '..' || relativePath.startsWith(`..${sep}`)) {
    throw new Error(`covered path escapes the project root: ${requestedPath}`);
  }
  const normalized = (relativePath || '.').split(sep).join('/');
  return trailingSlash && !normalized.endsWith('/') ? `${normalized}/` : normalized;
}

/** @param {string} objective @param {string[]} coveredPaths @param {string} predictionId @param {string} date @returns {string} */
export function renderPrediction(objective, coveredPaths, predictionId, date) {
  return [
    `# Prediction — ${objective}`,
    '',
    `- **Date**: ${date}`,
    `- **Prediction ID**: ${predictionId}`,
    '- **Source**: explicit `/simulate-impact` command',
    `- **Covered paths**: ${coveredPaths.join(', ') || '—'}`,
    '',
    '## Predicted blast radius',
    '_Describe expected changes, affected consumers, failure modes, and rollback._',
    '',
    '## Actual — fill on review',
    '_Run `/predictions-review` after implementation to compare this prediction with Git._',
    '',
  ].join('\n');
}

async function main() {
  const write = process.argv.includes('--write');
  const positional = process.argv.slice(2).filter((argument) => argument !== '--write');
  const [objective, ...rawPaths] = positional;
  if (!objective || rawPaths.length === 0) {
    console.error('Usage: mark-simulation.mjs [--write] "<objective>" <path> [path2 ...]');
    process.exitCode = 1;
    return;
  }
  if (/^\s*bypass\s*:/i.test(objective)) {
    console.error('BYPASS predictions are retired in ContextDevKit 4; record the real objective and evidence.');
    process.exitCode = 1;
    return;
  }

  const coveredPaths = [...new Set(rawPaths.map(normalizeCoveredPath))];
  const now = new Date();
  const date = now.toISOString().slice(0, 10);
  const identity = slugify(explicitRunIdentity()).slice(0, 20);
  const predictionId = `${date}-${identity}-${slugify(objective)}`;
  const relativePath = `contextkit/memory/predictions/${predictionId}.md`;
  const content = renderPrediction(objective, coveredPaths, predictionId, date);

  if (!write) {
    console.log(JSON.stringify({ status: 'dry-run', predictionId, relativePath, coveredPaths }, null, 2));
    console.log('Re-run with --write to materialize the reviewed prediction.');
    return;
  }

  await mkdir(pathsFor(ROOT).predictions, { recursive: true });
  await writeFileAtomic(resolve(ROOT, relativePath), content);
  console.log(`Prediction written: ${relativePath}`);
}

main().catch((error) => {
  console.error(`mark-simulation failed: ${error?.message ?? error}`);
  process.exitCode = 1;
});
