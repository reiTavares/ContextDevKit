/**
 * Git integration for the installer: drop the L≥3 git-hook wrappers, and patch
 * `.gitignore` / `.gitattributes` idempotently (never double-append).
 */
import { writeFile, chmod, rename } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDir, read } from './fs.mjs';

/**
 * Installs thin git-hook wrappers that call the engine scripts. Needs a `.git`.
 *
 * If a hook file already exists and is NOT one of ours (e.g. a husky/lint-staged
 * hook), it is backed up to `<name>.bak` before being replaced — so the user's
 * own hook is never silently clobbered. An existing `.bak` is preserved (the
 * first backup wins) so re-running the installer can't overwrite the original.
 *
 * @returns {Promise<{ installed: boolean, backedUp: string[] }>}
 */
export async function installGitHooks(target) {
  const gitDir = join(target, '.git');
  if (!existsSync(gitDir)) return { installed: false, backedUp: [] };
  const hooksDir = join(gitDir, 'hooks');
  await ensureDir(hooksDir);
  const wrappers = {
    'pre-commit': '#!/bin/sh\nnode vibekit/runtime/git-hooks/pre-commit.mjs\n',
    'commit-msg': '#!/bin/sh\nnode vibekit/runtime/git-hooks/commit-msg.mjs "$1"\n',
    'pre-push': '#!/bin/sh\nnode vibekit/runtime/git-hooks/pre-push.mjs\n',
  };
  const backedUp = [];
  for (const [name, body] of Object.entries(wrappers)) {
    const p = join(hooksDir, name);
    if (existsSync(p) && !(await read(p)).includes('vibekit/runtime/git-hooks')) {
      const backup = `${p}.bak`;
      if (!existsSync(backup)) {
        await rename(p, backup);
        backedUp.push(name);
      }
    }
    await writeFile(p, body, 'utf-8');
    await chmod(p, 0o755).catch(() => {});
  }
  return { installed: true, backedUp };
}

const GITIGNORE_BLOCK = [
  '',
  '# VibeDevKit — local runtime state (do not commit)',
  '.claude/.sessions/',
  '.claude/.workspace/',
  '.context-snapshot.md',
  '.distillation-proposal.md',
  '.agent-tuning-proposal.md',
  'vibekit/memory/tech-debt-findings.json',
  'vibekit/memory/deps-findings.json',
  'vibekit/memory/deep-analysis-findings.json',
].join('\n');

export async function patchGitignore(target) {
  const p = join(target, '.gitignore');
  let current = '';
  if (existsSync(p)) current = await read(p);
  if (current.includes('VibeDevKit — local runtime state')) return false;
  await writeFile(p, current + (current.endsWith('\n') || current === '' ? '' : '\n') + GITIGNORE_BLOCK + '\n', 'utf-8');
  return true;
}

export async function patchGitattributes(target, tplDir) {
  const tplPath = join(tplDir, 'gitattributes');
  if (!existsSync(tplPath)) return false;
  const block = await read(tplPath);
  const p = join(target, '.gitattributes');
  let current = '';
  if (existsSync(p)) current = await read(p);
  if (current.includes('VibeDevKit — keep engine scripts')) return false;
  await writeFile(p, current + (current.endsWith('\n') || current === '' ? '' : '\n') + block, 'utf-8');
  return true;
}
