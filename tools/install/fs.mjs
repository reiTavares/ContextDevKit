/**
 * File-system helpers for the ContextDevKit installer.
 *
 * Thin wrappers over `node:fs`: idempotent writes, BOM-stripped reads
 * (Windows-safe), recursive copies (clobbering vs write-if-missing), and
 * `{{var}}` template rendering. Zero third-party deps — the installer must run
 * via `npx` on a machine with nothing else installed.
 */
import { cp, mkdir, readFile, writeFile, rename, copyFile } from 'node:fs/promises';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';

export async function ensureDir(p) {
  await mkdir(p, { recursive: true });
}

/** Reads a file, stripping a leading UTF-8 BOM so `JSON.parse` never trips. */
export async function read(path) {
  return (await readFile(path, 'utf-8')).replace(/^﻿/, '');
}

/** Writes `content` only if `path` is absent (or `force`). Returns whether it wrote. */
export async function writeIfMissing(path, content, force) {
  if (existsSync(path) && !force) return false;
  await ensureDir(dirname(path));
  await writeFile(path, content, 'utf-8');
  return true;
}

export async function overwrite(path, content) {
  await ensureDir(dirname(path));
  await writeFile(path, content, 'utf-8');
}

/**
 * Atomically writes `content`: a sibling tmp file + rename, so a crash mid-write
 * can never leave `path` partially written (P0 hotfix 3.0.1). On failure the
 * original file is left intact and the tmp is best-effort removed.
 * @param {string} path destination
 * @param {string} content payload
 */
export async function atomicWrite(path, content) {
  await ensureDir(dirname(path));
  const tmp = `${path}.tmp-${process.pid}`;
  try {
    await writeFile(tmp, content, 'utf-8');
    await rename(tmp, path);
  } catch (err) {
    try { const { rm } = await import('node:fs/promises'); await rm(tmp, { force: true }); } catch { /* ignore */ }
    throw err;
  }
}

/**
 * Atomically writes `content` ONLY when the file's current bytes differ from
 * `content`, eliminating spurious mtime churn that trips file-watchers on
 * host editors (the no-churn guarantee — P0-05 / 3.1.2 hotfix).
 *
 * Comparison is an exact UTF-8 string equality check against the raw on-disk
 * bytes — matching how callers serialize (JSON.stringify + '\n'). A BOM is NOT
 * stripped before comparing; callers must never write a BOM (all kit writes use
 * 'utf-8' without BOM).
 *
 * Falls through to write when the existing file cannot be read (missing,
 * permission error, etc.) so the caller always ends up with a valid file.
 *
 * @param {string} path  destination file path
 * @param {string} content  serialized content to write
 * @returns {Promise<{ written: boolean }>}  `{ written: true }` when the file
 *   was (re)written, `{ written: false }` when it was already up-to-date.
 */
export async function atomicWriteIfChanged(path, content) {
  if (existsSync(path)) {
    try {
      const current = await readFile(path, 'utf-8');
      if (current === content) return { written: false };
    } catch { /* fall through to write */ }
  }
  await atomicWrite(path, content);
  return { written: true };
}

/**
 * Copies an existing file to `${path}.bak` before a destructive repair. No-op
 * (returns false) when the source is absent. Best-effort — never throws.
 * @param {string} path file to back up
 * @returns {Promise<boolean>} true when a backup was written
 */
export async function backup(path) {
  if (!existsSync(path)) return false;
  try { await copyFile(path, `${path}.bak`); return true; } catch { return false; }
}

export async function copyTree(src, dest) {
  if (!existsSync(src)) return;
  await cp(src, dest, { recursive: true, force: true });
}

/** Recursively copies `src` into `dest`, writing each file ONLY if absent. */
export async function copyTreeIfMissing(src, dest) {
  if (!existsSync(src)) return 0;
  let count = 0;
  for (const entry of readdirSync(src, { withFileTypes: true })) {
    const from = join(src, entry.name);
    const to = join(dest, entry.name);
    if (entry.isDirectory()) count += await copyTreeIfMissing(from, to);
    else if (await writeIfMissing(to, await readFile(from, 'utf-8'), false)) count++;
  }
  return count;
}

/** Replaces `{{var}}` placeholders from `vars`; leaves unknown ones intact. */
export function render(tpl, vars) {
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k) => (k in vars ? vars[k] : `{{${k}}}`));
}
