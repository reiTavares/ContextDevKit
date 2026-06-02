/**
 * GitHub adapter for the review-provider contract — ADR-0021.
 *
 * Shells out to the `gh` CLI. The user is expected to have authenticated
 * via `gh auth login` before any command that hits the network. We do not
 * store credentials.
 */
import { spawnSync } from 'node:child_process';
import { ProviderError } from './_adapter.mjs';

export const id = 'gh';
export const cliBinary = 'gh';

/**
 * Pure detection from the `origin` URL — no network call.
 *
 * @param {string} remoteUrl  output of `git remote get-url origin`
 * @returns {boolean}
 */
export const detectsRemote = (remoteUrl) => {
  if (typeof remoteUrl !== 'string') return false;
  return /github\.com[:/]/.test(remoteUrl);
};

function runGh(args, { stdin } = {}) {
  const result = spawnSync('gh', args, {
    input: stdin,
    encoding: 'utf8',
    shell: false,
  });
  if (result.error && result.error.code === 'ENOENT') {
    throw new ProviderError(
      'CLI_MISSING',
      '`gh` CLI not found on PATH. Install from https://cli.github.com/ or switch `providers.review` in vibekit/config.json.',
    );
  }
  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    const code = /not authenticated/i.test(stderr) ? 'AUTH'
      : /not found/i.test(stderr) ? 'NOT_FOUND'
      : 'REMOTE_REJECTED';
    throw new ProviderError(code, `gh ${args.join(' ')} failed: ${stderr || result.status}`);
  }
  return result.stdout || '';
}

/**
 * Create a pull request on GitHub.
 *
 * @param {{ title: string, body: string, baseBranch?: string }} input
 * @returns {Promise<{ url: string, number: number }>}
 */
export async function createPullRequest({ title, body, baseBranch }) {
  if (!title) throw new ProviderError('BAD_INPUT', 'createPullRequest: `title` is required');
  const args = ['pr', 'create', '--title', title, '--body-file', '-'];
  if (baseBranch) args.push('--base', baseBranch);
  const stdout = runGh(args, { stdin: body || '' });
  const url = stdout.trim().split('\n').filter(Boolean).pop() || '';
  const match = /\/pull\/(\d+)/.exec(url);
  if (!match) {
    throw new ProviderError('PARSE', `could not parse PR number from gh output: ${stdout}`);
  }
  return { url, number: Number(match[1]) };
}

/**
 * List open review comments on a PR.
 *
 * @param {{ prNumber: number }} input
 * @returns {Promise<Array<{ id: number, body: string, path?: string, line?: number }>>}
 */
export async function listOpenReviewComments({ prNumber }) {
  if (!Number.isInteger(prNumber)) {
    throw new ProviderError('BAD_INPUT', 'listOpenReviewComments: `prNumber` must be an integer');
  }
  const stdout = runGh(['api', `repos/{owner}/{repo}/pulls/${prNumber}/comments`]);
  try {
    const raw = JSON.parse(stdout);
    return raw.map(c => ({
      id: c.id,
      body: c.body,
      path: c.path,
      line: c.line ?? c.original_line ?? null,
    }));
  } catch (e) {
    throw new ProviderError('PARSE', `gh returned non-JSON for review comments: ${e.message}`);
  }
}

/**
 * Post a top-level review comment on a PR.
 *
 * @param {{ prNumber: number, body: string }} input
 * @returns {Promise<{ ok: true }>}
 */
export async function postReviewComment({ prNumber, body }) {
  if (!Number.isInteger(prNumber)) {
    throw new ProviderError('BAD_INPUT', 'postReviewComment: `prNumber` must be an integer');
  }
  if (!body) throw new ProviderError('BAD_INPUT', 'postReviewComment: `body` is required');
  runGh(['pr', 'comment', String(prNumber), '--body-file', '-'], { stdin: body });
  return { ok: true };
}
