/**
 * WF-0087 D5 — concluded workflow-state checksum manifest (ADR-0148).
 *
 * A workflow filed in a `done/` lane is concluded: its `workflow-state.json`
 * must not change again without a governing ADR. The I2 invariant cannot guard
 * this — it stays `skipped` on the legacy `reconciled-by-inference` corpus (no
 * task-status journal) — so this independent sha256 manifest is the drift net
 * the devops review required. `--check` fails closed on any pinned-file change;
 * `--allow-with-adr <id>` is the explicit governed override seam.
 *
 * Modes:
 *   (default)               print the manifest to stdout.
 *   --write <path>          persist the manifest JSON.
 *   --check <path>          recompute + compare; exit 1 on any drift.
 *   --allow-with-adr <id>   with --check, downgrade drift to a warning (0).
 *
 * Read-only over the corpus; deterministic (sorted paths, no wall-clock in the
 * digest body). Zero-dep beyond `node:*`.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import { pathsFor } from '../../runtime/config/paths.mjs';

/** sha256 of the raw file bytes, prefixed (matches the tasks-migrate convention). */
function sha256(bytes) {
  return `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
}

/**
 * Enumerate every `workflow-state.json` physically filed under a `done/` lane
 * anywhere below the memory root — the concluded set. A full recursive walk so
 * no lane is silently missed (§8).
 *
 * @param {string} root project/worktree root
 * @returns {string[]} absolute state-file paths (sorted)
 */
function concludedStateFiles(root) {
  const memoryRoot = pathsFor(root).memory;
  if (!memoryRoot || !existsSync(memoryRoot)) return [];
  const files = [];
  const stack = [memoryRoot];
  while (stack.length > 0) {
    const current = stack.pop();
    let entries;
    try {
      entries = readdirSync(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const child = join(current, entry.name);
      const statePath = join(child, 'workflow-state.json');
      // A workflow dir sitting directly inside a `done/` lane is concluded.
      if (/[\\/]done$/.test(current) && existsSync(statePath)) files.push(statePath);
      stack.push(child);
    }
  }
  return [...new Set(files)].sort();
}

/**
 * Build the deterministic checksum manifest over the concluded corpus.
 *
 * @param {string} root project/worktree root
 * @returns {{ kind: string, count: number, entries: Array<{ path: string, digest: string }> }}
 */
export function buildChecksumManifest(root) {
  const entries = concludedStateFiles(root).map((absolute) => ({
    path: relative(root, absolute).replace(/\\/g, '/'),
    digest: sha256(readFileSync(absolute)),
  }));
  return { kind: 'wf-0087-concluded-state-checksum', count: entries.length, entries };
}

/**
 * Compare a stored manifest against the live corpus.
 *
 * @param {string} root project/worktree root
 * @param {object} stored a previously written manifest
 * @returns {{ ok: boolean, changed: string[], added: string[], removed: string[] }}
 */
export function checkAgainstManifest(root, stored) {
  const live = buildChecksumManifest(root);
  const liveByPath = new Map(live.entries.map((entry) => [entry.path, entry.digest]));
  const storedByPath = new Map((stored.entries || []).map((entry) => [entry.path, entry.digest]));
  const changed = [];
  const removed = [];
  for (const [path, digest] of storedByPath) {
    if (!liveByPath.has(path)) removed.push(path);
    else if (liveByPath.get(path) !== digest) changed.push(path);
  }
  // A newly-concluded workflow (`added`) is normal corpus growth, not drift —
  // it is reported for a manifest refresh but never fails the guard. Only a
  // pinned file whose bytes CHANGED, or a pinned file that was REMOVED, is drift.
  const added = [...liveByPath.keys()].filter((path) => !storedByPath.has(path));
  return { ok: changed.length === 0 && removed.length === 0, changed, added, removed };
}

/** CLI. */
if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const argv = process.argv.slice(2);
  const arg = (flag) => (argv.includes(flag) ? argv[argv.indexOf(flag) + 1] : null);
  const writePath = arg('--write');
  const checkPath = arg('--check');
  const allowAdr = arg('--allow-with-adr');
  const root = process.cwd();

  if (checkPath) {
    // ADR-0125 graceful degradation: an absent manifest (fresh install, or a
    // main checkout with no gitignored memory corpus) is `skipped`, never a
    // fail-closed block. The manifest is a per-project artifact, populated only
    // where a concluded corpus exists to guard.
    if (!existsSync(checkPath)) {
      console.log(`- concluded-state checksum: manifest absent (${checkPath}) — skipped (no concluded corpus to guard)`);
      process.exit(0);
    }
    const stored = JSON.parse(readFileSync(checkPath, 'utf8').replace(/^﻿/, ''));
    const result = checkAgainstManifest(root, stored);
    if (result.ok) {
      console.log(`✓ concluded-state checksum: ${stored.count} file(s) unchanged`);
      process.exit(0);
    }
    console.error('✗ concluded workflow-state drift detected:');
    for (const path of result.changed) console.error(`  changed:  ${path}`);
    for (const path of result.removed) console.error(`  removed:  ${path}`);
    for (const path of result.added) console.error(`  added:    ${path}`);
    if (allowAdr) {
      console.error(`  (allowed by --allow-with-adr ${allowAdr} — governed override)`);
      process.exit(0);
    }
    console.error('  a concluded workflow-state changed without an ADR — re-pin via the engine and cite the ADR, or run with --allow-with-adr <id>.');
    process.exit(1);
  }

  const manifest = buildChecksumManifest(root);
  const text = `${JSON.stringify(manifest, null, 2)}\n`;
  if (writePath) {
    writeFileSync(writePath, text, 'utf8');
    console.log(`checksum manifest written to ${writePath} — ${manifest.count} concluded state(s)`);
  } else {
    process.stdout.write(text);
  }
}
