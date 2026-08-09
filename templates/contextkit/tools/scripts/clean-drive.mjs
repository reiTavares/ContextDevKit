#!/usr/bin/env node
/**
 * OPTIONAL utility — removes cloud-sync contamination from a git repo.
 *
 * Google Drive / OneDrive desktop clients sometimes seed `desktop.ini` files
 * recursively inside `.git/` (refs, objects, hooks). git then tries to read
 * them as refs and dies with `fatal: bad object`. They also create `.tmp.drive*`
 * working folders at the repo root. This removes both. Idempotent, defensive.
 *
 * Mostly relevant on Windows when the repo lives inside a synced folder.
 *
 * Usage (CLI):  node contextkit/tools/scripts/clean-drive.mjs
 * Library:      import { cleanCloudContamination } from './clean-drive.mjs'
 */
import { readdirSync, rmSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** @param {string} [root] @returns {{ desktopIniInGit: number, tmpFolders: number }} */
export function cleanCloudContamination(root = process.cwd()) {
  return {
    desktopIniInGit: removeDesktopIniRecursive(resolve(root, '.git')),
    tmpFolders: removeTmpFolders(root),
  };
}

function removeDesktopIniRecursive(dir) {
  let count = 0;
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    const full = join(dir, e.name);
    if (e.isDirectory()) count += removeDesktopIniRecursive(full);
    else if (e.name === 'desktop.ini') {
      try {
        unlinkSync(full);
        count++;
      } catch {
        /* best effort */
      }
    }
  }
  return count;
}

function removeTmpFolders(root) {
  let count = 0;
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return 0;
  }
  for (const e of entries) {
    if (e.isDirectory() && (e.name.startsWith('.tmp.drive') || e.name.startsWith('.tmp.onedrive'))) {
      try {
        rmSync(join(root, e.name), { recursive: true, force: true });
        count++;
      } catch {
        /* Drive may hold a lock */
      }
    }
  }
  return count;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = cleanCloudContamination(process.cwd());
  if (r.desktopIniInGit > 0 || r.tmpFolders > 0) {
    console.log(`✓ cleaned ${r.desktopIniInGit} desktop.ini in .git/, ${r.tmpFolders} .tmp.* folder(s)`);
  } else {
    console.log('✓ already clean — no cloud-sync contamination found');
  }
}
