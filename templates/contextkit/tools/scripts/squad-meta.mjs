/**
 * Shared squad detection — used by squad.mjs (/squad) and agent-tuning.mjs
 * (/tune-agents) so the rule lives in exactly one place:
 *   qa-* → qa-team; otherwise the `(<name> squad)` / `(<name>-team)` tag in the
 *   agent's description frontmatter; falls back to devteam.
 * Zero-dependency, defensive (never throws).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** @param {string} agentsDir absolute path to `.claude/agents` @param {string} agent bare name */
export function squadOf(agentsDir, agent) {
  if (/^qa-/.test(agent)) return 'qa-team';
  let frontmatter = null;
  try {
    frontmatter = readFileSync(resolve(agentsDir, `${agent}.md`), 'utf-8').match(/^---\n([\s\S]*?)\n---/);
  } catch {
    return 'devteam';
  }
  const desc = (frontmatter && /description:\s*(.*)/.exec(frontmatter[1])?.[1]) || '';
  const tag = desc.match(/\(([a-z][a-z0-9-]*?)(?: squad)?\)\s*$/i);
  return tag ? tag[1] : 'devteam';
}
