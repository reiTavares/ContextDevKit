#!/usr/bin/env node
/**
 * `session-draft` — pre-fill `/log-session`'s **Done** section from the active
 * ledger (ADR-0032). The ledger already records every edited file in order
 * (`track-edits.mjs`); this turns that into a grouped draft so registering a
 * session is one confirm, not a blank-page chore — killing the recurring
 * end-of-session drift.
 *
 * Read-only; never throws (the ledger read is defensive). Zero-dep. The draft is
 * a STARTING POINT — the human still writes the narrative; it just removes the
 * "what did I touch again?" friction.
 *
 * Usage:
 *   node contextkit/tools/scripts/session-draft.mjs          # markdown draft
 *   node contextkit/tools/scripts/session-draft.mjs --json
 */
import { spawnSync } from 'node:child_process';
import { readMostRecentLedger, toRepoRelative } from '../../runtime/hooks/ledger.mjs';

function currentBranch(root) {
  try {
    const r = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: root, encoding: 'utf-8', timeout: 5000 });
    return r.status === 0 ? (r.stdout || '').trim() : '';
  } catch {
    return '';
  }
}

function slugify(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
    .slice(0, 40);
}

/**
 * Builds a draft from the most-recently-touched ledger.
 * @param {string} [root] project root
 * @returns {Promise<{ sessionId: string|null, branch: string, slug: string, files: string[], groups: Record<string,string[]> }>}
 */
export async function draftSession(root = process.cwd()) {
  let active = null;
  try {
    active = await readMostRecentLedger();
  } catch {
    /* defensive — no ledger */
  }
  const mods = active?.ledger?.modifications || [];
  const seen = new Set();
  const files = [];
  for (const m of mods) {
    const p = toRepoRelative(m?.path);
    if (p && !seen.has(p)) {
      seen.add(p);
      files.push(p);
    }
  }
  const groups = {};
  for (const f of files) {
    const dir = f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '.';
    (groups[dir] ||= []).push(f);
  }
  const domDir = Object.entries(groups).sort((a, b) => b[1].length - a[1].length)[0]?.[0] || '';
  const slug = slugify(domDir.split('/').pop()) || 'session-work';
  return { sessionId: active?.sessionId || null, branch: currentBranch(root), slug, files, groups };
}

function renderMarkdown(d) {
  if (!d.files.length) return 'ℹ️  No modifications in the active ledger — nothing to draft.';
  const lines = ['## Done (auto-drafted from the ledger — edit into a factual narrative)', ''];
  for (const [dir, fs] of Object.entries(d.groups).sort()) {
    lines.push(`- **${dir}/** — ${fs.map((f) => `\`${f.split('/').pop()}\``).join(', ')}`);
  }
  lines.push(
    '',
    `_Branch: \`${d.branch || '?'}\` · ${d.files.length} file(s) across ${Object.keys(d.groups).length} area(s) · suggested slug: \`${d.slug}\`. This is a scaffold — replace it with WHAT changed and WHY, don't just ship the file list._`,
  );
  return lines.join('\n');
}

if (process.argv[1]?.endsWith('session-draft.mjs')) {
  const draft = await draftSession(process.cwd());
  console.log(process.argv.includes('--json') ? JSON.stringify(draft, null, 2) : renderMarkdown(draft));
}
