/**
 * Git integration for the installer: drop the L≥3 git-hook wrappers, and patch
 * `.gitignore` / `.gitattributes` idempotently (never double-append).
 */
import { writeFile, chmod } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ensureDir, read } from './fs.mjs';

/** Installs thin git-hook wrappers that call the engine scripts. Needs a `.git`. */
export async function installGitHooks(target) {
  const gitDir = join(target, '.git');
  if (!existsSync(gitDir)) return false;
  const hooksDir = join(gitDir, 'hooks');
  await ensureDir(hooksDir);
  const wrappers = {
    'pre-commit': '#!/bin/sh\nnode vibekit/runtime/git-hooks/pre-commit.mjs\n',
    'commit-msg': '#!/bin/sh\nnode vibekit/runtime/git-hooks/commit-msg.mjs "$1"\n',
    'pre-push': '#!/bin/sh\nnode vibekit/runtime/git-hooks/pre-push.mjs\n',
  };
  for (const [name, body] of Object.entries(wrappers)) {
    const p = join(hooksDir, name);
    await writeFile(p, body, 'utf-8');
    await chmod(p, 0o755).catch(() => {});
  }
  return true;
}

const GITIGNORE_BLOCK = [
  '',
  '# VibeDevKit — local runtime state (do not commit)',
  '.claude/.sessions/',
  '.claude/.workspace/',
  '.context-snapshot.md',
  '.distillation-proposal.md',
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
