/**
 * Workflow daily-report mechanics (ADR-0057). Extracted from `workflow-pack.mjs`
 * as a responsibility seam (constitution §1): the pack module owns spec-pack
 * lifecycle; this module owns the git probing + factual report rendering. Zero
 * runtime deps, node:* only.
 */
import { existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { writeFileAtomicSync } from '../../runtime/hooks/safe-io.mjs';
import { packDir, readWorkflow } from './workflow-pack.mjs';

const GIT_TIMEOUT_MS = 60000;
const SKIPPED_DIFF = 'SKIPPED: git unavailable / not a repository';

function day() { return new Date().toISOString().slice(0, 10); }

/**
 * Runs git with a hard timeout; returns trimmed stdout, or null on any failure
 * (non-zero exit, git absent, or timeout). null is the explicit "could not run"
 * signal — never coerce it to '' so callers cannot mistake it for "no changes".
 * @param {string} root project root used as cwd
 * @param {string[]} args git arguments
 * @returns {string|null}
 */
function git(root, args) {
  const out = spawnSync('git', args, { cwd: root, encoding: 'utf-8', timeout: GIT_TIMEOUT_MS });
  if (!out || out.error || out.status !== 0) return null;
  return (out.stdout || '').trim();
}

/**
 * Probes whether `root` is inside a git work tree (constitution §8: a check that
 * cannot run reports "skipped", never a false clean pass).
 * @param {string} root project root
 * @returns {boolean}
 */
function isGitRepo(root) {
  return git(root, ['rev-parse', '--is-inside-work-tree']) === 'true';
}

/**
 * Collects the union of unstaged-diff names and short-status names. Returns an
 * empty list when git could not run (the caller already surfaces the SKIPPED
 * banner, so an empty list here reads as "nothing extra to add").
 * @param {string} root project root
 * @returns {string[]}
 */
function touchedFiles(root) {
  const diffNames = (git(root, ['diff', '--name-only']) || '')
    .split('\n')
    .map((name) => name.trim())
    .filter(Boolean);
  const statusNames = (git(root, ['status', '--short']) || '')
    .split('\n')
    .map((line) => line.replace(/^\s*[ MADRCU?!]{1,2}\s+/, '').trim())
    .filter(Boolean)
    .map((name) => name.replace(/^"|"$/g, ''));
  return [...new Set([...diffNames, ...statusNames])];
}

function diffBlock(value) {
  return ['```text', value, '```'];
}

/**
 * Writes a dated factual report under `<pack>/reports/<YYYY-MM-DD>.md`.
 *
 * Refuses (throws) when the dated file already exists unless `force` is true, so
 * a re-run on the same day cannot silently destroy a human-filled `Verification`
 * section. When git is unavailable / `root` is not a repository, the diff bodies
 * are an explicit SKIPPED banner rather than a clean-pass "No working tree diff."
 *
 * @param {string} root project root
 * @param {string} slug workflow slug (must resolve to a pack workflow)
 * @param {string} [taskId] optional DevPipeline task id
 * @param {boolean} [force] overwrite a same-day report when true
 * @returns {string} the written report path
 * @throws {Error} when the workflow pack is missing, or the report exists and force is false
 */
export function writeReport(root, slug, taskId = '', force = false) {
  const workflow = readWorkflow(root, slug);
  if (!workflow || workflow.format !== 'pack') throw new Error(`workflow pack "${slug}" not found`);
  const reportPath = resolve(packDir(root, slug), 'reports', `${day()}.md`);
  if (existsSync(reportPath) && !force) {
    throw new Error(`report already exists: ${reportPath} (pass --force to overwrite; this discards any human-filled Verification section)`);
  }
  mkdirSync(resolve(reportPath, '..'), { recursive: true });
  const repo = isGitRepo(root);
  const names = repo ? touchedFiles(root) : [];
  const diffStat = repo ? (git(root, ['diff', '--stat']) || 'No working tree diff.') : SKIPPED_DIFF;
  const numstat = repo ? (git(root, ['diff', '--numstat']) || 'No working tree diff.') : SKIPPED_DIFF;
  const branch = repo ? (git(root, ['rev-parse', '--abbrev-ref', 'HEAD']) || 'unknown') : 'unknown (git unavailable)';
  const commit = repo ? (git(root, ['rev-parse', '--short', 'HEAD']) || 'unknown') : 'unknown (git unavailable)';
  const lines = [
    `# Daily Report - ${slug} - ${day()}`,
    '',
    `- **Workflow**: ${slug}`,
    `- **Task**: ${taskId || 'not specified'}`,
    `- **Branch**: ${branch}`,
    `- **Commit**: ${commit}`,
    '',
    '## Diff summary',
    '',
    ...diffBlock(diffStat),
    '',
    '## Numstat',
    '',
    ...diffBlock(numstat),
    '',
    '## Files touched',
    '',
    names.length ? names.map((name) => `- ${name}`).join('\n') : '- None',
    '',
    '## Verification',
    '',
    '- [ ] Record the suite command and exit code.',
    '',
    '## Notes',
    '',
    '- Full patches stay in git; this report records the factual summary only.',
    '',
  ];
  writeFileAtomicSync(reportPath, lines.join('\n'));
  return reportPath;
}
