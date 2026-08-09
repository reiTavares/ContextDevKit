#!/usr/bin/env node
/**
 * Builds a read-only `/log-session` draft from the Git working tree. It creates
 * no session marker and does not claim that the draft itself is a durable log.
 */
import { spawnSync } from 'node:child_process';
import { relative, resolve } from 'node:path';

/** @param {string[]} argumentsList @param {string} root @returns {string[]} */
function gitPathList(argumentsList, root) {
  try {
    const response = spawnSync('git', argumentsList, {
      cwd: root,
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

/** @param {string} root @returns {string} */
function currentBranch(root) {
  try {
    const response = spawnSync('git', ['symbolic-ref', '--short', 'HEAD'], { cwd: root, encoding: 'utf8', timeout: 5000 });
    return response.status === 0 ? String(response.stdout ?? '').trim() : 'detached';
  } catch {
    return 'unknown';
  }
}

/** @param {string} value @returns {string} */
function slugify(value) {
  return String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40) || 'session-work';
}

/**
 * Builds a draft from tracked and untracked Git changes.
 * @param {string} [root]
 * @returns {Promise<{source:string,branch:string,slug:string,files:string[],groups:Record<string,string[]>}>}
 */
export async function draftSession(root = process.cwd()) {
  const tracked = gitPathList(['diff', '--name-only', '-z', 'HEAD'], root);
  const untracked = gitPathList(['ls-files', '--others', '--exclude-standard', '-z'], root);
  const files = [...new Set([...tracked, ...untracked])]
    .map((path) => relative(root, resolve(root, path)).split('\\').join('/'))
    .filter((path) => path && !path.startsWith('../'))
    .sort();
  const groups = {};
  for (const file of files) {
    const directory = file.includes('/') ? file.slice(0, file.lastIndexOf('/')) : '.';
    (groups[directory] ||= []).push(file);
  }
  const dominantDirectory = Object.entries(groups)
    .sort((left, right) => right[1].length - left[1].length || left[0].localeCompare(right[0]))[0]?.[0] ?? '';
  return {
    source: 'git-working-tree',
    branch: currentBranch(root),
    slug: slugify(dominantDirectory.split('/').pop()),
    files,
    groups,
  };
}

/** @param {Awaited<ReturnType<typeof draftSession>>} draft @returns {string} */
export function renderSessionDraft(draft) {
  if (!draft.files.length) return 'No Git working-tree changes to draft.';
  const lines = ['## Done (drafted from Git; replace this list with outcomes and rationale)', ''];
  for (const [directory, files] of Object.entries(draft.groups).sort()) {
    lines.push(`- **${directory}/** — ${files.map((file) => `\`${file.split('/').pop()}\``).join(', ')}`);
  }
  lines.push('', `_Branch: \`${draft.branch}\` · ${draft.files.length} file(s) · suggested slug: \`${draft.slug}\`._`);
  return lines.join('\n');
}

if (process.argv[1]?.endsWith('session-draft.mjs')) {
  const draft = await draftSession();
  console.log(process.argv.includes('--json') ? JSON.stringify(draft, null, 2) : renderSessionDraft(draft));
}
