/**
 * File-system helpers for the ContextDevKit installer.
 *
 * Thin wrappers over `node:fs`: idempotent writes, BOM-stripped reads
 * (Windows-safe), recursive copies (clobbering vs write-if-missing), and
 * `{{var}}` template rendering. Zero third-party deps — the installer must run
 * via `npx` on a machine with nothing else installed.
 */
import { cp, mkdir, readFile, writeFile } from 'node:fs/promises';
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
