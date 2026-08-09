/**
 * Review-provider adapter contract — ADR-0021.
 *
 * Each `*.mjs` file in this directory (except this one and `detect.mjs`) is a
 * concrete adapter. An adapter is a thin shell around an external CLI binary
 * the user already has installed (`gh`, `glab`, `bb`, `tea` …). No SDK
 * dependencies. No HTTP clients. No network probes during detection.
 *
 * Five contract points (recorded inline so a new adapter author reads them
 * before opening the file):
 *
 *   1. No SDK dependency. Adapters `child_process.spawn` their CLI.
 *   2. `detectsRemote` is a pure function over the `origin` URL.
 *   3. `createPullRequest` returns `{ url, number }` or throws ProviderError
 *      with `code` and a human-readable `message`.
 *   4. A missing CLI is a refusal, not a fallback. No silent degradation.
 *   5. The selected adapter is recorded in `contextkit/config.json` →
 *      `providers.review`. `detect.mjs` auto-resolves on first use.
 *
 * Adapter shape (all five fields required):
 *
 *   export const id = 'gh';
 *   export const cliBinary = 'gh';
 *   export const detectsRemote = (remoteUrl) => /github\.com/.test(remoteUrl);
 *   export async function createPullRequest({ title, body, baseBranch }) { … }
 *   export async function listOpenReviewComments({ prNumber }) { … }
 *   export async function postReviewComment({ prNumber, body }) { … }
 *
 * Additions to the contract require an ADR-style paragraph in this file and
 * a matching selfcheck assertion. The current surface is the minimum useful.
 */

/**
 * Typed error every adapter throws on a failure path.
 *
 * @param {string} code     short stable code (e.g. 'CLI_MISSING', 'AUTH', 'REMOTE_REJECTED')
 * @param {string} message  human-readable message (no stack-leaking)
 */
export class ProviderError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProviderError';
    this.code = code;
  }
}

/**
 * Validate the shape of an adapter module. Used by selfcheck and by
 * `detect.mjs` before treating a discovered file as a real adapter.
 *
 * @param {object} mod  the imported module
 * @returns {{ ok: true } | { ok: false, reasons: string[] }}
 */
export function validateAdapter(mod) {
  const reasons = [];
  if (typeof mod.id !== 'string' || mod.id.length === 0) {
    reasons.push('missing or empty `id` export');
  }
  if (typeof mod.cliBinary !== 'string' || mod.cliBinary.length === 0) {
    reasons.push('missing or empty `cliBinary` export');
  }
  if (typeof mod.detectsRemote !== 'function') {
    reasons.push('missing `detectsRemote(remoteUrl)` export');
  }
  for (const fn of ['createPullRequest', 'listOpenReviewComments', 'postReviewComment']) {
    if (typeof mod[fn] !== 'function') {
      reasons.push(`missing async \`${fn}(...)\` export`);
    }
  }
  return reasons.length === 0 ? { ok: true } : { ok: false, reasons };
}
